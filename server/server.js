require("dotenv").config();
const { connect: dbConnect, prisma } = require('./db');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

dbConnect();

const io = new Server(process.env.PORT, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const defaultValue = "";

var allClients = [];
var redisPub = [];
var redisSub = [];

var pubClient = createClient({
    url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
});

pubClient.on('ready', () => {
    console.log('Publisher connected to redis and ready to use');
});
pubClient.on('error', (err) => console.log('Publisher Client Error', err));

Promise.all([pubClient.connect()]).then(() => {
    redisPub.push(pubClient);
    console.log(`number of publishers is ${redisPub.length}`);
});

io.on("connection", (socket) => {
    const subClient = pubClient.duplicate();
    subClient.on('ready', () => {
        console.log('Subscriber connected to redis and ready to use');
    });
    subClient.on('error', (err) => console.log('Subscriber Client Error', err));

    Promise.all([subClient.connect()]).then(() => {
        console.log(`A Subscriber clients connected ${username}`);
        redisSub.push(subClient);
        console.log(`number of subscribers is ${redisSub.length}`);
    });

    allClients.push(socket);
    var username = socket.handshake.query.username;
    console.log(`A client is connected! ${username} - Number of sockets is: ${allClients.length}`);

    socket.on('disconnect', async function (reason) {
        console.log(`${username} got disconnected due to ${reason}`);
        var i = allClients.indexOf(socket);
        allClients.splice(i, 1);
        console.log(`Number of sockets now is: ${allClients.length}`);
        var subI = redisSub.indexOf(subClient);
        redisSub.splice(subI, 1);
        await subClient.unsubscribe();
        await subClient.quit();
    });

    socket.on('get-document', async (documentID) => {
        try {
            await subClient.subscribe(documentID, (message) => {
                const msg = JSON.parse(message);
                console.log(msg.sender);
                console.log(msg.data);
                console.log(username);
                if (socket.id !== msg.sender) {
                    socket.emit('receive-changes', msg.data);
                }
            });
        } catch (error) {
            console.error(error);
        }
        const document = await lookUpDocument(documentID);
        //TODO subscribe the socket to redis channel using the documentID
        socket.join(documentID);
        socket.emit("load-document", document.data);

        socket.on("send-changes", async (delta) => {
            try {
                const message = {
                    'sender': socket.id,
                    'data': delta
                };
                const sentMsg = JSON.stringify(message);
                await pubClient.publish(documentID, sentMsg);
                console.log(`${username} published`);
            } catch (error) {
                console.error(error);
            }
        });

        socket.on("save-document", async (data) => {
            try {
                await prisma.document.upsert({
                    where: { id: documentID },
                    update: { data },
                    create: { id: documentID, data }
                });
            } catch (e) {
                console.log(e);
            }
        })
        //TODO Group the last 3 minutes of changes into one 'commit'
        socket.on('commit-history', async (data) => {
        });
    });
});

async function lookUpDocument(id) {
    if (id == null) return;

    try {
        let document = await prisma.document.findUnique({
            where: { id: id },
            include: { users: true }
        });
        if (document) return document;
        return await prisma.document.create({
            data: { id: id, data: defaultValue }
        });
    } catch (e) {
        console.log(e);
    }
}

