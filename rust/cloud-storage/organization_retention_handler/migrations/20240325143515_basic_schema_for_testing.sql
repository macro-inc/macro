-- NOTE: This is used purely to setup the testing DB
-- Changes from `database/prisma/schema.prisma` need to be converted into raw SQL
-- Changes here WILL NOT ever make it into the dev/production db.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE "Organization"
(
    "id"   INTEGER PRIMARY KEY,
    "name" TEXT UNIQUE NOT NULL
);

CREATE TABLE "OrganizationRetentionPolicy"
(
    "id"              BIGSERIAL PRIMARY KEY,
    "organization_id" INTEGER UNIQUE NOT NULL,
    "retention_days"  INTEGER,
    FOREIGN KEY ("organization_id") REFERENCES "Organization" ("id") ON DELETE CASCADE
);

CREATE TABLE "User"
(
    "id"               TEXT PRIMARY KEY,
    "email"            TEXT UNIQUE NOT NULL,
    "name"             TEXT,
    "stripeCustomerId" TEXT UNIQUE,
    "organizationId"   INTEGER,
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE SET NULL
);

CREATE TABLE "Permission"
(
    "id"          TEXT PRIMARY KEY,
    "description" TEXT
);

CREATE TABLE "Role"
(
    "id"          TEXT PRIMARY KEY,
    "description" TEXT
);

CREATE TABLE "RolesOnPermissions"
(
    "permissionId" TEXT,
    "roleId"       TEXT,
    PRIMARY KEY ("permissionId", "roleId"),
    CONSTRAINT "fk_permission" FOREIGN KEY ("permissionId") REFERENCES "Permission" ("id"),
    CONSTRAINT "fk_role_permissions" FOREIGN KEY ("roleId") REFERENCES "Role" ("id")
);

CREATE TABLE "RolesOnUsers"
(
    "userId" TEXT,
    "roleId" TEXT,
    PRIMARY KEY ("userId", "roleId"),
    CONSTRAINT "fk_user" FOREIGN KEY ("userId") REFERENCES "User" ("id"),
    CONSTRAINT "fk_role_users" FOREIGN KEY ("roleId") REFERENCES "Role" ("id")
);

CREATE TABLE "DocumentFamily"
(
    "id"             BIGSERIAL PRIMARY KEY,
    "rootDocumentId" TEXT NOT NULL
);

CREATE TABLE "Project"
(
    "id"        TEXT PRIMARY KEY     DEFAULT uuid_generate_v4(),
    "name"      TEXT        NOT NULL,
    "userId"    TEXT        NOT NULL,
    "parentId"  TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "deletedAt" TIMESTAMPTZ,
    FOREIGN KEY ("parentId") REFERENCES "Project" ("id"),
    FOREIGN KEY ("userId") REFERENCES "User" ("id")
);

-- Document table
CREATE TABLE "Document"
(
    -- Setting to type text as UUID was causing tests to fail and I didn't want to debug it
    "id"                    TEXT PRIMARY KEY     DEFAULT uuid_generate_v4(),
    "name"                  TEXT        NOT NULL,
    "owner"                 TEXT        NOT NULL,
    "fileType"              TEXT        NOT NULL,
    -- Setting to type text as UUID was causing tests to fail and I didn't want to debug it
    "branchedFromId"        TEXT,
    "branchedFromVersionId" BIGINT,
    "documentFamilyId"      BIGINT,
    "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "deletedAt"             TIMESTAMPTZ,
    "projectId"             TEXT,
    FOREIGN KEY ("owner") REFERENCES "User" ("id"),
    FOREIGN KEY ("projectId") REFERENCES "Project" ("id")
);
CREATE INDEX idx_document_project_id ON "Document" ("projectId");

CREATE TABLE "Macrotation"
(
    "id"                TEXT PRIMARY KEY,
    "parentId"          TEXT,
    "documentId"        TEXT        NOT NULL,
    "userId"            TEXT        NOT NULL,
    "linkSharePosition" TEXT,
    "highlightedText"   TEXT,
    "image"             TEXT,
    "comment"           TEXT,
    "hexCode"           TEXT,
    "section"           TEXT,
    "location"          TEXT,
    "order"             INTEGER,
    "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE,
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
    FOREIGN KEY ("parentId") REFERENCES "Macrotation" ("id") ON DELETE CASCADE
);

-- DocumentInstance table
CREATE TABLE "DocumentInstance"
(
    "id"           BIGSERIAL PRIMARY KEY,
    "revisionName" TEXT,
    -- Setting to type text as UUID was causing tests to fail and I didn't want to debug it
    "documentId"   TEXT        NOT NULL,
    "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "sha"          TEXT        NOT NULL,
    FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE
);

CREATE TABLE "DocumentInstanceModificationData"
(
    "id"                 BIGSERIAL PRIMARY KEY,
    "documentInstanceId" BIGSERIAL   NOT NULL,
    "modificationData"   JSONB       NOT NULL,
    "createdAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("documentInstanceId") REFERENCES "DocumentInstance" ("id") ON DELETE CASCADE
);

CREATE TABLE "DocumentBom"
(
    "id"           BIGSERIAL PRIMARY KEY,
    "revisionName" TEXT,
    -- Setting to type text as UUID was causing tests to fail and I didn't want to debug it
    "documentId"   TEXT        NOT NULL,
    "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE
);

CREATE TABLE "BomPart"
(
    "id"            TEXT PRIMARY KEY     DEFAULT uuid_generate_v4(),
    "sha"           TEXT        NOT NULL,
    "path"          TEXT        NOT NULL,
    "documentBomId" BIGSERIAL   NOT NULL,
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("documentBomId") REFERENCES "DocumentBom" ("id") ON DELETE CASCADE
);

CREATE TABLE "DocumentProcessResult"
(
    "id"         BIGSERIAL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "jobType"    TEXT NOT NULL,
    "content"    TEXT NOT NULL,
    FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE
);

CREATE TABLE "JobToDocumentProcessResult"
(
    "jobId"                   TEXT      NOT NULL,
    "documentProcessResultId" BIGSERIAL NOT NULL,
    FOREIGN KEY ("documentProcessResultId") REFERENCES "DocumentProcessResult" ("id") ON DELETE CASCADE
);

CREATE TABLE "UserHistory"
(
    "userId"    TEXT NOT NULL,
    "itemId"    TEXT NOT NULL,
    "itemType"  TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
    UNIQUE ("userId", "itemId", "itemType")
);

CREATE TABLE "ItemLastAccessed"
(
    "item_id"       TEXT NOT NULL,
    "item_type"     TEXT NOT NULL,
    "last_accessed" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE ("item_id", "item_type")
);

CREATE TABLE "Pin"
(
    "userId"         TEXT    NOT NULL,
    "pinnedItemId"   TEXT    NOT NULL,
    "pinnedItemType" TEXT    NOT NULL,
    "pinIndex"       INTEGER NOT NULL,
    "createdAt"      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
    UNIQUE ("userId", "pinnedItemId", "pinnedItemType")
);

CREATE TABLE "DocxUploadJob"
(
    "id"         BIGSERIAL PRIMARY KEY,
    "jobId"      TEXT NOT NULL,
    "documentId" TEXT,
    "createdAt"  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Chat"
(
    "id"        TEXT PRIMARY KEY     DEFAULT uuid_generate_v4(),
    "name"      TEXT        NOT NULL,
    "userId"    TEXT        NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "projectId" TEXT,
    "model"     TEXT,
    FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL,
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);
CREATE INDEX idx_chat_project_id ON "Chat" ("projectId");

CREATE TABLE "ChatMessage"
(
    "id"        TEXT PRIMARY KEY UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    "content"   TEXT                    NOT NULL,
    "role"      TEXT                    NOT NULL,
    "chatId"    TEXT                    NOT NULL,
    "createdAt" TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("chatId") REFERENCES "Chat" ("id") ON DELETE CASCADE
);

CREATE TABLE "SharePermission"
(
    "id"                TEXT PRIMARY KEY     DEFAULT uuid_generate_v4(),
    "isPublic"          BOOLEAN     NOT NULL,
    "publicAccessLevel" TEXT,
    "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "DocumentPermission"
(
    "documentId"        TEXT NOT NULL UNIQUE,
    "sharePermissionId" TEXT NOT NULL UNIQUE,
    PRIMARY KEY ("documentId", "sharePermissionId"),
    FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE,
    FOREIGN KEY ("sharePermissionId") REFERENCES "SharePermission" ("id") ON DELETE CASCADE
);

CREATE TABLE "ChatPermission"
(
    "chatId"            TEXT NOT NULL UNIQUE,
    "sharePermissionId" TEXT NOT NULL UNIQUE,
    PRIMARY KEY ("chatId", "sharePermissionId"),
    FOREIGN KEY ("chatId") REFERENCES "Chat" ("id") ON DELETE CASCADE,
    FOREIGN KEY ("sharePermissionId") REFERENCES "SharePermission" ("id") ON DELETE CASCADE
);

CREATE TABLE "ProjectPermission"
(
    "projectId"         TEXT NOT NULL UNIQUE,
    "sharePermissionId" TEXT NOT NULL UNIQUE,
    PRIMARY KEY ("projectId", "sharePermissionId"),
    FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE,
    FOREIGN KEY ("sharePermissionId") REFERENCES "SharePermission" ("id") ON DELETE CASCADE
);
CREATE INDEX idx_project_permission_project_id ON "ProjectPermission" ("projectId");

CREATE TABLE "ChatAttachment"
(
    "id"             TEXT PRIMARY KEY DEFAULT uuid_generate_v4(),
    "attachmentType" TEXT NOT NULL,
    "attachmentId"   TEXT NOT NULL,
    "chatId"         TEXT,
    "messageId"      TEXT
);

CREATE TABLE "DocumentText"
(
    "id"         BIGSERIAL PRIMARY KEY,
    "content"    TEXT NOT NULL,
    "documentId" TEXT NOT NULL
)
