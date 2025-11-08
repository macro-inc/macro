-- NOTE: This is used purely to setup the testing DB
-- Changes from `database/prisma/schema.prisma` need to be converted into raw SQL
-- Changes here WILL NOT ever make it into the dev/production db.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE "User" (
    "id"               TEXT PRIMARY KEY,
    "email"            TEXT UNIQUE NOT NULL,
    "name"             TEXT,
    "stripeCustomerId" TEXT UNIQUE
);

CREATE TABLE "DocumentFamily" (
    "id"           BIGSERIAL PRIMARY KEY,
    "rootDocumentId" TEXT NOT NULL
);

-- Document table
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
    FOREIGN KEY ("owner") REFERENCES "User"("id")
);

-- DocumentInstance table
CREATE TABLE "DocumentInstance" (
    "id"           BIGSERIAL PRIMARY KEY,
    "revisionName" TEXT ,
    -- Setting to type text as UUID was causing tests to fail and I didn't want to debug it
    "documentId"   TEXT NOT NULL,
    "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "sha"          TEXT NOT NULL,
    FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE
);

CREATE TABLE "DocumentBom" (
    "id"           BIGSERIAL PRIMARY KEY,
    "revisionName" TEXT ,
    -- Setting to type text as UUID was causing tests to fail and I didn't want to debug it
    "documentId"   TEXT NOT NULL,
    "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE
);

CREATE TABLE "BomPart" (
    "id"           TEXT PRIMARY KEY DEFAULT uuid_generate_v4(),
    "sha"          TEXT NOT NULL,
    "path"          TEXT NOT NULL,
    "documentBomId"   BIGSERIAL NOT NULL,
    "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("documentBomId") REFERENCES "DocumentBom"("id") ON DELETE CASCADE
);

CREATE TABLE "DocumentProcessResult" (
    "id"           BIGSERIAL PRIMARY KEY,
    "sha"          TEXT NOT NULL,
    "jobType"          TEXT NOT NULL,
    "content"          TEXT NOT NULL
);

CREATE TABLE "JobToDocumentProcessResult" (
    "jobId"           TEXT NOT NULL,
    "documentProcessResultId"   BIGSERIAL NOT NULL,
    FOREIGN KEY ("documentProcessResultId") REFERENCES "DocumentProcessResult"("id") ON DELETE CASCADE
);

CREATE TABLE "OpenedFileEvent" (
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
    FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE,
    UNIQUE ("userId", "documentId")
);

CREATE TABLE "Pin" (
    "userId" TEXT NOT NULL,
    "pinnedItemId" TEXT NOT NULL,
    "pinnedItemType" TEXT NOT NULL,
    "pinIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
    UNIQUE ("userId", "pinnedItemId", "pinnedItemType")
);

CREATE TABLE "DocxUploadJob" (
    "id"           BIGSERIAL PRIMARY KEY,
    "jobId"          TEXT NOT NULL,
    "documentId"          TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Chat" (
    "id"               TEXT PRIMARY KEY DEFAULT uuid_generate_v4(),
    "name"             TEXT NOT NULL,
    "userId"            TEXT NOT NULL,
    "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("userId") REFERENCES "User"("id")
);

CREATE TABLE "ChatMessage" (
    "id"           BIGSERIAL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "chatId"   TEXT NOT NULL,
    FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE
);

CREATE TABLE "ChatUpload" (
    "id"               TEXT PRIMARY KEY DEFAULT uuid_generate_v4(),
    "name"             TEXT NOT NULL,
    "sha"              TEXT NOT NULL,
    "fileType"         TEXT NOT NULL,
    "chatMessageId"    BIGSERIAL NOT NULL,
    "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("chatMessageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE
);
