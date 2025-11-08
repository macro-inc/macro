-- NOTE: This is used purely to setup the testing DB
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE "User" (
    "id"               TEXT PRIMARY KEY,
    "email"            TEXT UNIQUE NOT NULL,
    "name"             TEXT,
    "stripeCustomerId" TEXT UNIQUE
);

CREATE TABLE "Document" (
    -- Setting to type text as UUID was causing tests to fail and I didn't want to debug it
    "id"               TEXT PRIMARY KEY DEFAULT uuid_generate_v4(),
    "name"             TEXT NOT NULL,
    "owner"            TEXT NOT NULL,
    "fileType"         TEXT NOT NULL,
    -- Setting to type text as UUID was causing tests to fail and I didn't want to debug it
    "branchedFromId"   TEXT,
    "branchedFromVersionId" BIGINT,
    "documentFamilyId"   BIGINT,
    "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "deletedAt"        TIMESTAMPTZ,
    FOREIGN KEY ("owner") REFERENCES "User"("id")
);

CREATE TABLE "DocumentProcessResult" (
    "id"           BIGSERIAL PRIMARY KEY,
    "documentId"          TEXT NOT NULL,
    "jobType"          TEXT NOT NULL,
    "content"          TEXT NOT NULL,
    FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE
);

CREATE TABLE "JobToDocumentProcessResult" (
    "jobId"           TEXT NOT NULL,
    "documentProcessResultId"   BIGSERIAL NOT NULL,
    "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("documentProcessResultId") REFERENCES "DocumentProcessResult"("id") ON DELETE CASCADE
);
