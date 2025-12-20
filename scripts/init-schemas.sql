-- Initialize separate schemas for microservices

-- Create schema for auth service
CREATE SCHEMA IF NOT EXISTS auth;
GRANT ALL ON SCHEMA auth TO postgres;

-- Create schema for document service
CREATE SCHEMA IF NOT EXISTS documents;
GRANT ALL ON SCHEMA documents TO postgres;

-- Create schema for collaboration service
CREATE SCHEMA IF NOT EXISTS collaboration;
GRANT ALL ON SCHEMA collaboration TO postgres;

-- Set default privileges for future tables in each schema
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA documents GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA collaboration GRANT ALL ON TABLES TO postgres;
