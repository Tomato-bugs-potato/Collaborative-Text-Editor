require("dotenv").config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Upload } = require('@aws-sdk/lib-storage');
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
    s3 = new S3Client({
        region: 'us-east-1', // Required in v3 even for MinIO
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        },
        endpoint: process.env.AWS_ENDPOINT, // MinIO endpoint
        forcePathStyle: true, // Needed for MinIO
    });

    BUCKET_NAME = process.env.AWS_BUCKET_NAME || 'editor-storage';

    // Ensure bucket exists
    // Ensure bucket exists
    const createBucket = async () => {
        try {
            await s3.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
            console.log(`[${INSTANCE_ID}] Bucket ${BUCKET_NAME} ready`);
        } catch (err) {
            if (err.Code !== 'BucketAlreadyOwnedByYou' && err.name !== 'BucketAlreadyOwnedByYou') {
                console.error('Error creating bucket:', err);
            } else {
                console.log(`[${INSTANCE_ID}] Bucket ${BUCKET_NAME} ready (already exists)`);
            }
        }
    };
    createBucket();

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
    },
    logLevel: 4 // INFO level logging for more details
});

const consumer = kafka.consumer({ groupId: 'storage-group' });

const runKafka = async () => {
    try {
        await consumer.connect();
        console.log(`[${INSTANCE_ID}] Kafka consumer connected to brokers: ${process.env.KAFKA_BROKERS || 'kafka-1:9092,kafka-2:9093,kafka-3:9094'}`);
        await consumer.subscribe({ topic: 'document-snapshots', fromBeginning: false });
        console.log(`[${INSTANCE_ID}] Kafka consumer subscribed to snapshots`);

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
                        console.log(`[${INSTANCE_ID}] Attempting to save snapshot to MinIO for doc ${documentId}, version ${version}`);
                        const upload = new Upload({
                            client: s3,
                            params: params
                        });
                        await upload.done();
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
/**
 * @swagger
 * /snapshots:
 *   post:
 *     summary: Upload a snapshot file
 *     tags: [Storage]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               snapshot:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Snapshot uploaded successfully
 *       400:
 *         description: No file uploaded
 *       500:
 *         description: Upload failed
 */
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
            const upload = new Upload({
                client: s3,
                params: params
            });
            const data = await upload.done();
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
/**
 * @swagger
 * /snapshots/{filename}:
 *   get:
 *     summary: Get a snapshot by filename
 *     tags: [Storage]
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: Snapshot filename
 *     responses:
 *       302:
 *         description: Redirect to signed URL or file
 *       404:
 *         description: File not found
 */
app.get('/snapshots/:filename', async (req, res) => {
    const { filename } = req.params;

    if (STORAGE_TYPE === 's3' || STORAGE_TYPE === 'minio') {
        const params = {
            Key: filename,
            Expires: 60 * 5 // 5 minutes signed URL
        };

        try {
            const command = new GetObjectCommand(params);
            const url = await getSignedUrl(s3, command, { expiresIn: 60 * 5 });
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

// List Snapshots for a Document
/**
 * @swagger
 * /documents/{documentId}/snapshots:
 *   get:
 *     summary: List all snapshots for a document
 *     tags: [Storage]
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID
 *     responses:
 *       200:
 *         description: List of snapshots
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 snapshots:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       key:
 *                         type: string
 *                       version:
 *                         type: number
 *                       timestamp:
 *                         type: number
 *                       size:
 *                         type: number
 *                       lastModified:
 *                         type: string
 *       500:
 *         description: Failed to list snapshots
 */
app.get('/documents/:documentId/snapshots', async (req, res) => {
    const { documentId } = req.params;

    if (STORAGE_TYPE === 's3' || STORAGE_TYPE === 'minio') {
        const params = {
            Bucket: BUCKET_NAME,
            Prefix: `snapshots/${documentId}/`
        };

        try {
            const command = new ListObjectsV2Command(params);
            const data = await s3.send(command);

            const snapshots = (data.Contents || []).map(item => {
                // Key format: snapshots/{documentId}/{version}-{timestamp}.json
                const filename = item.Key.split('/').pop();
                const [version, timestampExt] = filename.split('-');
                const timestamp = timestampExt.replace('.json', '');

                return {
                    key: item.Key,
                    version: parseInt(version),
                    timestamp: parseInt(timestamp),
                    size: item.Size,
                    lastModified: item.LastModified
                };
            }).sort((a, b) => b.version - a.version); // Newest first

            res.json({ snapshots });
        } catch (err) {
            console.error('S3 List Error:', err);
            res.status(500).json({ error: 'Failed to list snapshots' });
        }
    } else {
        // Local storage listing
        const dir = path.join(__dirname, 'uploads', 'snapshots', documentId);
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            const snapshots = files.map(file => {
                const [version, timestampExt] = file.split('-');
                const timestamp = timestampExt.replace('.json', '');
                const stats = fs.statSync(path.join(dir, file));

                return {
                    key: file, // Just filename for local
                    version: parseInt(version),
                    timestamp: parseInt(timestamp),
                    size: stats.size,
                    lastModified: stats.mtime
                };
            }).sort((a, b) => b.version - a.version);

            res.json({ snapshots });
        } else {
            res.json({ snapshots: [] });
        }
    }
});

// Internal Get Snapshot (Returns JSON content directly)
/**
 * @swagger
 * /internal/snapshots/{key}:
 *   get:
 *     summary: Internal endpoint to get snapshot content as JSON
 *     tags: [Storage]
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Snapshot key/path
 *     responses:
 *       200:
 *         description: Snapshot content as JSON
 *       404:
 *         description: Snapshot not found
 *       500:
 *         description: Failed to retrieve snapshot
 */
app.get('/internal/snapshots/:key(*)', async (req, res) => {
    const { key } = req.params;

    if (STORAGE_TYPE === 's3' || STORAGE_TYPE === 'minio') {
        const params = {
            Bucket: BUCKET_NAME,
            Key: key
        };

        try {
            const command = new GetObjectCommand(params);
            const response = await s3.send(command);
            // Stream to string
            const streamToString = (stream) => new Promise((resolve, reject) => {
                const chunks = [];
                stream.on("data", (chunk) => chunks.push(chunk));
                stream.on("error", reject);
                stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            });

            const bodyContents = await streamToString(response.Body);
            res.json(JSON.parse(bodyContents));
        } catch (err) {
            console.error('S3 Internal Get Error:', err);
            res.status(404).json({ error: 'Snapshot not found' });
        }
    } else {
        // Local storage
        // Handle both full key (snapshots/docId/file) and just filename
        let filePath;
        if (key.includes('/')) {
            filePath = path.join(__dirname, 'uploads', key);
        } else {
            // Fallback/Assumption: key is just filename, but we need docId. 
            // This path is tricky for local if we don't know docId. 
            // But the list endpoint returns just filename for local.
            // Let's assume the caller passes the full relative path for local too if they got it from list.
            filePath = path.join(__dirname, 'uploads', key);
        }

        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            res.json(JSON.parse(content));
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
