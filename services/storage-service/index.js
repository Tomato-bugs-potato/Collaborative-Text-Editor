require("dotenv").config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const { Kafka } = require('kafkajs');
const { setupMetrics } = require('./shared-utils');

const app = express();
const PORT = process.env.PORT || 3006;
const INSTANCE_ID = process.env.INSTANCE_ID || 'storage-1';
const STORAGE_TYPE = process.env.STORAGE_TYPE || 'local'; // 'local', 's3', or 'minio'

// Setup Prometheus metrics
setupMetrics(app, 'storage-service', INSTANCE_ID);

app.use(cors());
app.use(express.json());

// Swagger UI
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./src/config/swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

// Configure Storage
let upload;
let s3;
let BUCKET_NAME;

if (STORAGE_TYPE === 's3' || STORAGE_TYPE === 'minio') {
    s3 = new AWS.S3({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        endpoint: process.env.AWS_ENDPOINT, // MinIO endpoint
        s3ForcePathStyle: true, // Needed for MinIO
        signatureVersion: 'v4'
    });

    BUCKET_NAME = process.env.AWS_BUCKET_NAME || 'editor-storage';

    // Ensure bucket exists
    s3.createBucket({ Bucket: BUCKET_NAME }, (err, data) => {
        if (err && err.code !== 'BucketAlreadyOwnedByYou') {
            console.error('Error creating bucket:', err);
        } else {
            console.log(`[${INSTANCE_ID}] Bucket ${BUCKET_NAME} ready`);
        }
    });

    // Use memory storage for multer, then upload buffer to S3
    const storage = multer.memoryStorage();
    upload = multer({ storage: storage });

    console.log(`[${INSTANCE_ID}] Configured for MinIO/S3 Storage`);
} else {
    // Local Storage
    const storage = multer.diskStorage({
        destination: function (req, file, cb) {
            const dir = 'uploads/';
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir);
            }
            cb(null, dir);
        },
        filename: function (req, file, cb) {
            cb(null, Date.now() + '-' + file.originalname);
        }
    });

    upload = multer({ storage: storage });
    console.log(`[${INSTANCE_ID}] Configured for Local Storage`);
}

// Kafka Configuration for Snapshots
const kafka = new Kafka({
    clientId: `storage-service-${INSTANCE_ID}`,
    brokers: (process.env.KAFKA_BROKERS || 'kafka-1:9092,kafka-2:9093,kafka-3:9094').split(','),
    retry: {
        initialRetryTime: 100,
        retries: 8
    }
});

const consumer = kafka.consumer({ groupId: 'storage-group' });

const runKafka = async () => {
    try {
        await consumer.connect();
        await consumer.subscribe({ topic: 'document-snapshots', fromBeginning: false });
        console.log(`[${INSTANCE_ID}] Kafka consumer connected for snapshots`);

        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                try {
                    const data = JSON.parse(message.value.toString());
                    const { documentId, version, timestamp } = data;

                    console.log(`[${INSTANCE_ID}] Received snapshot for doc ${documentId}, version ${version}`);

                    if (STORAGE_TYPE === 's3' || STORAGE_TYPE === 'minio') {
                        const params = {
                            Bucket: BUCKET_NAME,
                            Key: `snapshots/${documentId}/${version}-${Date.now()}.json`,
                            Body: JSON.stringify(data, null, 2),
                            ContentType: 'application/json'
                        };

                        console.log(`[${INSTANCE_ID}] Attempting to save snapshot to MinIO for doc ${documentId}, version ${version}`);
                        await s3.upload(params).promise();
                        console.log(`[${INSTANCE_ID}] Snapshot successfully saved to MinIO: ${params.Key}`);
                    } else {
                        // Local storage backup
                        const dir = path.join(__dirname, 'uploads', 'snapshots', documentId);
                        if (!fs.existsSync(dir)) {
                            fs.mkdirSync(dir, { recursive: true });
                        }
                        const filePath = path.join(dir, `${version}-${Date.now()}.json`);
                        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                        console.log(`[${INSTANCE_ID}] Snapshot saved locally: ${filePath}`);
                    }
                } catch (err) {
                    console.error(`[${INSTANCE_ID}] Error processing snapshot:`, err);
                }
            }
        });
    } catch (error) {
        console.error(`[${INSTANCE_ID}] Failed to connect Kafka:`, error);
    }
};

runKafka();

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'storage-service', instance: INSTANCE_ID, type: STORAGE_TYPE });
});

// Upload Snapshot (Manual/REST)
app.post('/snapshots', upload ? upload.single('snapshot') : (req, res, next) => next(), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    if (STORAGE_TYPE === 's3' || STORAGE_TYPE === 'minio') {
        const params = {
            Bucket: BUCKET_NAME,
            Key: `manual/${Date.now()}-${req.file.originalname}`,
            Body: req.file.buffer,
            ContentType: req.file.mimetype
        };

        try {
            const data = await s3.upload(params).promise();
            res.json({
                status: 'success',
                file: {
                    filename: params.Key,
                    path: data.Location,
                    size: req.file.size
                }
            });
        } catch (err) {
            console.error('S3 Upload Error:', err);
            res.status(500).json({ error: 'Upload failed' });
        }
    } else {
        // Local storage
        res.json({
            status: 'success',
            file: {
                filename: req.file.filename,
                path: req.file.path,
                size: req.file.size
            }
        });
    }
});

// Get Snapshot
app.get('/snapshots/:filename', async (req, res) => {
    const { filename } = req.params;

    if (STORAGE_TYPE === 's3' || STORAGE_TYPE === 'minio') {
        const params = {
            Bucket: BUCKET_NAME,
            Key: filename,
            Expires: 60 * 5 // 5 minutes signed URL
        };

        try {
            const url = await s3.getSignedUrlPromise('getObject', params);
            res.redirect(url);
        } catch (err) {
            console.error('S3 Get Error:', err);
            res.status(404).json({ error: 'File not found' });
        }
    } else {
        const filePath = path.join(__dirname, 'uploads', filename);
        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    }
});

app.listen(PORT, () => {
    console.log(`[${INSTANCE_ID}] Storage Service running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log(`[${INSTANCE_ID}] Shutting down...`);
    await consumer.disconnect();
    process.exit(0);
});
