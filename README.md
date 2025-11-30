# Multi-User-Distributed-Text-Editor
## Description

The source code for Multi-User-Distributed-Text-Editor. It is a text editor that allows several users to collaborate together in reading, and modifying documents together in a real-time environment. Basically, it is a Google documents clone. The project was made for Distributed Systems (CSE354) course.

## Stack used

| Tech     | Usage                                                                                                                                                                            |
|----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| React.js | Implementing and writing the UI.                                                                                                                                                 |
| Quill.js | Text-Editor component implementing Operational Transformation Algorithm needed for real-time collaboration.                                                                      |
| SocketIO | Web socket Node.js library for writing web socket servers. the main  component in our system.                                                                                    |
| Redis    | In-Memory Data store. We used it in implementing a Publish/Subscribe approach for achieving communication between web socket servers which successfully implemented scalability. |
| PostgreSQL | ACID-compliant relational database. We use it to store our data with JSONB for document-like storage. PostgreSQL clustering provides high availability. |
| Docker     | Container Engine that runs containers. We used it to run PostgreSQL instances with streaming replication.                                                        |

# Installing NodeJS
 Follow [Installation guide](https://nodejs.dev/learn/how-to-install-nodejs)
## Installing required NodeJS packages
> For packages used by server side
```bash
# Terminal in project's root folder
cd server
npm i
```
> For packages used by client side 
```bash
# Terminal in project's root folder
cd client
npm i
```
## Setting up Prisma with PostgreSQL

> After setting up PostgreSQL database, run these commands in the server directory:

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma db push

# Optional: Open Prisma Studio to view/edit data
npx prisma studio
```

## Environment Variables Setup

Create a `.env` file in the `server` directory with the following variables:

### Database Configuration
**For Native PostgreSQL:**
```bash
DATABASE_URL="postgresql://texteditor_user:your_password@localhost:5432/texteditor?schema=public"
```

**For Docker PostgreSQL:**
```bash
DATABASE_URL="postgresql://postgres:mypassword@localhost:5432/texteditor?schema=public"
```

**For Docker Compose:**
```bash
DATABASE_URL="postgresql://postgres:mypassword@postgres:5432/texteditor?schema=public"
```

### Redis Configuration
1. Create an account on [Redis Labs](https://app.redislabs.com/)
2. Retrieve your database `port` number and your credentials.
- `REDIS_PASSWORD` --> Your account authentication password
- `REDIS_HOST` --> Your database host address
- `REDIS_PORT` --> Your database port number


## Deploying Frontend and Backend apps on Heroku

1. Create an app for the client code
2. Create an app for the server code
3. Log into heroku cli
4. Change directory to the `client` folder, and follow instructions in the `Deploy` tab.
5. Change directory to the `server` folder, and follow instructions in the `Deploy` tab.
6. Add the server app url in the config vars for the client code. for example,
      ```
      REACT_APP_SERVER : https://dist-ws2.herokuapp.com
      ```

6. For the server the following config vars
- `DATABASE_URL` -> PostgreSQL connection string
- `REDIS_HOST` -> Redis lab host
- `REDIS_PASSWORD` -> Redis lab password
- `REDIS_PORT` -> Redis lab port number



## Database Setup Options

You have **two options** for setting up PostgreSQL and Redis - **choose based on your needs**:

| Aspect | Native Installation | Docker Installation |
|--------|-------------------|-------------------|
| **Setup Complexity** | Medium (OS-specific) | Easy (one command) |
| **Development** | ✅ Best for local dev | ✅ Good for dev |
| **Production** | ✅ Better performance | ✅ Consistent deployment |
| **Resource Usage** | Lower | Slightly higher |
| **Portability** | ❌ OS-dependent | ✅ Works anywhere |
| **Isolation** | ❌ Can conflict | ✅ Fully isolated |
| **Updates** | Manual | Via images |

**Recommendation:**
- **Development/Quick Start**: Use Docker (`docker-compose up -d`)
- **Production/Long-term**: Use Docker for consistency
- **Performance-critical**: Native installation

### Docker Installation (Recommended for Production/Isolation)
> Install Docker by following [Installation Guide.](https://docs.docker.com/engine/install/ubuntu/)

> **Quick Start with Docker Compose** (Easiest Option):
```bash
# Start all services (PostgreSQL + Redis)
docker-compose up -d

# Start with management tools (pgAdmin + Redis Commander)
docker-compose --profile tools up -d

# Stop all services
docker-compose down
```

> **Management Tools:**
- **pgAdmin**: http://localhost:5050 (admin@texteditor.com / admin)
- **Redis Commander**: http://localhost:8081

## Docker Setup (Optional - Alternative to Native Installation)

### Simple Docker Setup (Single PostgreSQL Instance)
```bash
# Run PostgreSQL container
docker run -d --name postgres-db -e POSTGRES_PASSWORD=mypassword -e POSTGRES_DB=texteditor -p 5432:5432 postgres:15

# Run Redis container
docker run -d --name redis-db -p 6379:6379 redis:7-alpine
```

### Advanced Docker Setup (Clustered PostgreSQL)
For production clustering, you can use Docker Compose (see `docker-compose.yml`) or follow these manual steps:

1. **Create network:**
```bash
sudo docker network create postgres-cluster
```

2. **Run PostgreSQL primary:**
```bash
sudo docker run -d --name postgres-primary --net postgres-cluster -e POSTGRES_PASSWORD=mypassword -e POSTGRES_DB=texteditor -p 5432:5432 postgres:15
```

3. **Run Redis:**
```bash
sudo docker run -d --name redis-cluster --net postgres-cluster -p 6379:6379 redis:7-alpine
```

### Database URL Format
For single instance:
```
postgresql://postgres:mypassword@localhost:5432/texteditor?schema=public
```

For clustered setup:
```
postgresql://postgres:mypassword@host1:5432,host2:5432,host3:5432/texteditor?schema=public&targetServerType=primary
```

## Contributing
Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

Please make sure to update tests as appropriate.

## License
[MIT](https://choosealicense.com/licenses/mit/)
