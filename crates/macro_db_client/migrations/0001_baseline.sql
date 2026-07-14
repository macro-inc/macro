-- the baseline migration from when we migrated to using sqlx from prisma for macrodb. should never be run in
-- dev/prod as they already have the things declared in this file.
DO
$$
    DECLARE
        table_count INTEGER;
    BEGIN
        -- only run migration for empty databases
        SELECT COUNT(*)
        INTO table_count
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name != '_sqlx_migrations';

        IF table_count = 0 THEN
            CREATE TYPE "OrganizationStatus" AS ENUM ('PILOT', 'ENTERPRISE');

            CREATE TYPE "OrganizationItJobType" AS ENUM ('UPDATE', 'REMOVE');

            CREATE TYPE "SetAsDefault" AS ENUM ('ASK', 'FORCE', 'HIDE');

            CREATE TYPE "AccessLevel" AS ENUM ('view', 'comment', 'edit', 'owner');

            CREATE TYPE "anchor_table_name" AS ENUM ('PdfPlaceableCommentAnchor', 'PdfHighlightAnchor');

            CREATE TYPE "insights_backfill_job_status" AS ENUM ('Init', 'InProgress', 'Complete', 'Cancelled', 'Failed');

            CREATE TYPE "insights_backfill_batch_status" AS ENUM ('Queued', 'InProgress', 'Complete', 'Failed');

            CREATE TYPE "team_role" AS ENUM ('member', 'admin', 'owner');

            CREATE TABLE "macro_user"
            (
                "id"                 UUID NOT NULL,
                "username"           TEXT NOT NULL,
                "email"              TEXT NOT NULL,
                "stripe_customer_id" TEXT NOT NULL,

                CONSTRAINT "macro_user_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "macro_user_email_verification"
            (
                "macro_user_id" UUID    NOT NULL,
                "email"         TEXT    NOT NULL,
                "is_verified"   BOOLEAN NOT NULL DEFAULT false,

                CONSTRAINT "macro_user_email_verification_pkey" PRIMARY KEY ("macro_user_id", "email")
            );

            CREATE TABLE "macro_user_info"
            (
                "macro_user_id"        UUID NOT NULL,
                "industry"             TEXT,
                "title"                TEXT,
                "first_name"           TEXT,
                "last_name"            TEXT,
                "profile_picture"      TEXT,
                "profile_picture_hash" VARCHAR(40),

                CONSTRAINT "macro_user_info_pkey" PRIMARY KEY ("macro_user_id")
            );

            CREATE TABLE "in_progress_email_link"
            (
                "id"            UUID         NOT NULL,
                "email"         TEXT         NOT NULL,
                "macro_user_id" UUID         NOT NULL,
                "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT "in_progress_email_link_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "in_progress_user_link"
            (
                "id"            UUID         NOT NULL,
                "macro_user_id" UUID         NOT NULL,
                "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT "in_progress_user_link_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "account_merge_request"
            (
                "id"                     UUID         NOT NULL,
                "code"                   TEXT         NOT NULL,
                "macro_user_id"          UUID         NOT NULL,
                "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "to_merge_macro_user_id" UUID         NOT NULL,

                CONSTRAINT "account_merge_request_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "User"
            (
                "id"                     TEXT    NOT NULL,
                "email"                  TEXT    NOT NULL,
                "name"                   TEXT,
                "group"                  VARCHAR(1),
                "hasChromeExt"           BOOLEAN NOT NULL DEFAULT false,
                "organizationId"         INTEGER,
                "stripeCustomerId"       TEXT,
                "tutorialComplete"       BOOLEAN NOT NULL DEFAULT false,
                "hasOnboardingDocuments" BOOLEAN NOT NULL DEFAULT false,
                "industry"               VARCHAR(255),
                "title"                  VARCHAR(20),
                "firstName"              VARCHAR(100),
                "lastName"               VARCHAR(100),
                "profilePicture"         TEXT,
                "profilePictureHash"     VARCHAR(40),
                "macro_user_id"          UUID,

                CONSTRAINT "User_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "BlockedEmail"
            (
                "email" TEXT NOT NULL,

                CONSTRAINT "BlockedEmail_pkey" PRIMARY KEY ("email")
            );

            CREATE TABLE "Experiment"
            (
                "id"         TEXT    NOT NULL,
                "active"     BOOLEAN NOT NULL DEFAULT false,
                "started_at" TIMESTAMP(3),
                "ended_at"   TIMESTAMP(3),

                CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "ExperimentLog"
            (
                "experiment_id" TEXT       NOT NULL,
                "user_id"       TEXT       NOT NULL,
                "group"         VARCHAR(1) NOT NULL,
                "completed"     BOOLEAN    NOT NULL DEFAULT false,

                CONSTRAINT "ExperimentLog_pkey" PRIMARY KEY ("user_id", "experiment_id")
            );

            CREATE TABLE "UserApiKey"
            (
                "key"     TEXT NOT NULL,
                "user_id" TEXT NOT NULL,

                CONSTRAINT "UserApiKey_pkey" PRIMARY KEY ("user_id", "key")
            );

            CREATE TABLE "Organization"
            (
                "id"                  SERIAL               NOT NULL,
                "name"                TEXT                 NOT NULL,
                "emailToolDomain"     TEXT,
                "stripeCustomerId"    TEXT,
                "status"              "OrganizationStatus" NOT NULL DEFAULT 'PILOT',
                "seats"               INTEGER,
                "allowListOnly"       BOOLEAN,
                "llmProviders"        TEXT,
                "netDocumentsEnabled" BOOLEAN              NOT NULL DEFAULT false,

                CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "OrganizationInvitation"
            (
                "id"              BIGSERIAL NOT NULL,
                "email"           TEXT      NOT NULL,
                "organization_id" INTEGER   NOT NULL,

                CONSTRAINT "OrganizationInvitation_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "OrganizationDefaultSharePermission"
            (
                "id"                          BIGSERIAL NOT NULL,
                "organization_id"             INTEGER   NOT NULL,
                "is_public"                   BOOLEAN   NOT NULL DEFAULT false,
                "public_access_level"         TEXT,
                "organization_access_enabled" BOOLEAN   NOT NULL DEFAULT false,
                "organization_access_level"   TEXT,

                CONSTRAINT "OrganizationDefaultSharePermission_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "OrganizationRetentionPolicy"
            (
                "id"              BIGSERIAL NOT NULL,
                "organization_id" INTEGER   NOT NULL,
                "retention_days"  INTEGER,

                CONSTRAINT "OrganizationRetentionPolicy_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "OrganizationItJob"
            (
                "id"             SERIAL                  NOT NULL,
                "taskArn"        TEXT,
                "taskType"       "OrganizationItJobType" NOT NULL,
                "organizationId" INTEGER                 NOT NULL,

                CONSTRAINT "OrganizationItJob_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "OrganizationIT"
            (
                "email"          TEXT    NOT NULL,
                "organizationId" INTEGER NOT NULL
            );

            CREATE TABLE "OrganizationEmailMatches"
            (
                "email"          VARCHAR(100) NOT NULL,
                "organizationId" INTEGER      NOT NULL,

                CONSTRAINT "OrganizationEmailMatches_pkey" PRIMARY KEY ("email")
            );

            CREATE TABLE "EnterpriseRules"
            (
                "id"                  SERIAL         NOT NULL,
                "organizationId"      INTEGER        NOT NULL,
                "autoSetAsDefaultApp" BOOLEAN        NOT NULL DEFAULT false,
                "disableAutoUpdate"   BOOLEAN        NOT NULL DEFAULT false,
                "setAsDefault"        "SetAsDefault" NOT NULL DEFAULT 'ASK',
                "setAsDefaultDocx"    "SetAsDefault" NOT NULL DEFAULT 'ASK',

                CONSTRAINT "EnterpriseRules_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "EnterpriseIManageTenants"
            (
                "id"             SERIAL  NOT NULL,
                "organizationId" INTEGER NOT NULL,
                "tenant_uri"     TEXT    NOT NULL,
                "nickname"       TEXT    NOT NULL,

                CONSTRAINT "EnterpriseIManageTenants_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "OrganizationBilling"
            (
                "id"             SERIAL  NOT NULL,
                "organizationId" INTEGER NOT NULL,
                "email"          TEXT    NOT NULL,

                CONSTRAINT "OrganizationBilling_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "EnterpriseEmailContacts"
            (
                "id"             SERIAL  NOT NULL,
                "organizationId" INTEGER NOT NULL,
                "firstName"      TEXT    NOT NULL,
                "lastName"       TEXT    NOT NULL,
                "email"          TEXT    NOT NULL,

                CONSTRAINT "EnterpriseEmailContacts_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "Permission"
            (
                "id"          TEXT NOT NULL,
                "description" TEXT NOT NULL,

                CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "Role"
            (
                "id"          TEXT NOT NULL,
                "description" TEXT NOT NULL,

                CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "RolesOnPermissions"
            (
                "permissionId" TEXT NOT NULL,
                "roleId"       TEXT NOT NULL,

                CONSTRAINT "RolesOnPermissions_pkey" PRIMARY KEY ("permissionId", "roleId")
            );

            CREATE TABLE "RolesOnOrganizations"
            (
                "organizationId" INTEGER NOT NULL,
                "roleId"         TEXT    NOT NULL,

                CONSTRAINT "RolesOnOrganizations_pkey" PRIMARY KEY ("organizationId", "roleId")
            );

            CREATE TABLE "RolesOnUsers"
            (
                "userId" TEXT NOT NULL,
                "roleId" TEXT NOT NULL,

                CONSTRAINT "RolesOnUsers_pkey" PRIMARY KEY ("userId", "roleId")
            );

            CREATE TABLE "DocumentFamily"
            (
                "id"             BIGSERIAL NOT NULL,
                "rootDocumentId" TEXT      NOT NULL,

                CONSTRAINT "DocumentFamily_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "Project"
            (
                "id"              TEXT         NOT NULL DEFAULT gen_random_uuid(),
                "name"            TEXT         NOT NULL,
                "userId"          TEXT         NOT NULL,
                "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "parentId"        TEXT,
                "deletedAt"       TIMESTAMP(3),
                "uploadPending"   BOOLEAN      NOT NULL DEFAULT false,
                "uploadRequestId" TEXT,

                CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "Document"
            (
                "id"                    TEXT         NOT NULL DEFAULT gen_random_uuid(),
                "name"                  TEXT         NOT NULL,
                "owner"                 TEXT         NOT NULL,
                "fileType"              TEXT,
                "branchedFromId"        TEXT,
                "branchedFromVersionId" BIGINT,
                "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "deletedAt"             TIMESTAMP(3),
                "uploaded"              BOOLEAN      NOT NULL DEFAULT false,
                "documentFamilyId"      BIGINT,
                "projectId"             TEXT,

                CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "DocumentView"
            (
                "id"          BIGSERIAL    NOT NULL,
                "document_id" TEXT         NOT NULL,
                "user_id"     TEXT,
                "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT "DocumentView_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "SharePermission"
            (
                "id"                TEXT         NOT NULL DEFAULT gen_random_uuid(),
                "isPublic"          BOOLEAN      NOT NULL,
                "publicAccessLevel" TEXT,
                "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT "SharePermission_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "ChannelSharePermission"
            (
                "channel_id"          TEXT          NOT NULL,
                "share_permission_id" TEXT          NOT NULL,
                "access_level"        "AccessLevel" NOT NULL,

                CONSTRAINT "ChannelSharePermission_pkey" PRIMARY KEY ("channel_id", "share_permission_id")
            );

            CREATE TABLE "DocumentPermission"
            (
                "documentId"        TEXT NOT NULL,
                "sharePermissionId" TEXT NOT NULL,

                CONSTRAINT "DocumentPermission_pkey" PRIMARY KEY ("documentId")
            );

            CREATE TABLE "ChatPermission"
            (
                "chatId"            TEXT NOT NULL,
                "sharePermissionId" TEXT NOT NULL,

                CONSTRAINT "ChatPermission_pkey" PRIMARY KEY ("chatId")
            );

            CREATE TABLE "ProjectPermission"
            (
                "projectId"         TEXT NOT NULL,
                "sharePermissionId" TEXT NOT NULL,

                CONSTRAINT "ProjectPermission_pkey" PRIMARY KEY ("projectId")
            );

            CREATE TABLE "MacroPromptPermission"
            (
                "macro_prompt_id"     TEXT NOT NULL,
                "share_permission_id" TEXT NOT NULL,

                CONSTRAINT "MacroPromptPermission_pkey" PRIMARY KEY ("macro_prompt_id")
            );

            CREATE TABLE "EmailThreadPermission"
            (
                "threadId"          TEXT NOT NULL,
                "sharePermissionId" TEXT NOT NULL,
                "userId"            TEXT NOT NULL,
                "projectId"         TEXT,

                CONSTRAINT "EmailThreadPermission_pkey" PRIMARY KEY ("threadId")
            );

            CREATE TABLE "DocumentInstance"
            (
                "id"           BIGSERIAL    NOT NULL,
                "revisionName" TEXT,
                "documentId"   TEXT         NOT NULL,
                "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "sha"          TEXT         NOT NULL,

                CONSTRAINT "DocumentInstance_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "DocumentInstanceModificationData"
            (
                "id"                            BIGSERIAL    NOT NULL,
                "documentInstanceId"            BIGINT       NOT NULL,
                "modificationData"              JSONB        NOT NULL,
                "createdAt"                     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt"                     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "pdfPlaceableCommentMigratedAt" TIMESTAMP(3),
                "pdfHighlightMigratedAt"        TIMESTAMP(3),

                CONSTRAINT "DocumentInstanceModificationData_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "DocumentBom"
            (
                "id"           BIGSERIAL    NOT NULL,
                "revisionName" TEXT,
                "documentId"   TEXT         NOT NULL,
                "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT "DocumentBom_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "BomPart"
            (
                "id"            TEXT         NOT NULL DEFAULT gen_random_uuid(),
                "sha"           TEXT         NOT NULL,
                "path"          TEXT         NOT NULL,
                "documentBomId" BIGINT       NOT NULL,
                "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT "BomPart_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "DocumentProcessResult"
            (
                "id"         BIGSERIAL NOT NULL,
                "documentId" TEXT      NOT NULL,
                "jobType"    TEXT      NOT NULL,
                "content"    TEXT      NOT NULL,

                CONSTRAINT "DocumentProcessResult_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "JobToDocumentProcessResult"
            (
                "jobId"                   TEXT         NOT NULL,
                "documentProcessResultId" BIGINT       NOT NULL,
                "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT "JobToDocumentProcessResult_pkey" PRIMARY KEY ("jobId", "documentProcessResultId")
            );

            CREATE TABLE "UserHistory"
            (
                "userId"    TEXT         NOT NULL,
                "itemId"    TEXT         NOT NULL,
                "itemType"  TEXT         NOT NULL,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT "UserHistory_pkey" PRIMARY KEY ("userId", "itemId", "itemType")
            );

            CREATE TABLE "UserDocumentViewLocation"
            (
                "user_id"     TEXT         NOT NULL,
                "document_id" TEXT         NOT NULL,
                "location"    TEXT         NOT NULL,
                "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT "UserDocumentViewLocation_pkey" PRIMARY KEY ("user_id", "document_id")
            );

            CREATE TABLE "ItemLastAccessed"
            (
                "item_id"       TEXT         NOT NULL,
                "item_type"     TEXT         NOT NULL,
                "last_accessed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT "ItemLastAccessed_pkey" PRIMARY KEY ("item_id", "item_type")
            );

            CREATE TABLE "UploadJob"
            (
                "id"         BIGSERIAL    NOT NULL,
                "jobId"      TEXT         NOT NULL,
                "jobType"    TEXT         NOT NULL,
                "documentId" TEXT,
                "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT "UploadJob_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "Pin"
            (
                "userId"         TEXT         NOT NULL,
                "pinnedItemId"   TEXT         NOT NULL,
                "pinnedItemType" TEXT         NOT NULL,
                "pinIndex"       INTEGER      NOT NULL,
                "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT "Pin_pkey" PRIMARY KEY ("userId", "pinnedItemId", "pinnedItemType")
            );

            CREATE TABLE "Chat"
            (
                "id"           TEXT         NOT NULL DEFAULT gen_random_uuid(),
                "userId"       TEXT         NOT NULL,
                "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "deletedAt"    TIMESTAMP(3),
                "name"         TEXT         NOT NULL,
                "model"        TEXT         NOT NULL DEFAULT 'gpt-4o',
                "tokenCount"   BIGINT,
                "projectId"    TEXT,
                "isPersistent" BOOLEAN      NOT NULL DEFAULT false,

                CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "ChatAttachment"
            (
                "id"             TEXT NOT NULL DEFAULT gen_random_uuid(),
                "attachmentType" TEXT NOT NULL,
                "attachmentId"   TEXT NOT NULL,
                "chatId"         TEXT,
                "messageId"      TEXT,

                CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "ChatMessage"
            (
                "id"        TEXT         NOT NULL DEFAULT gen_random_uuid(),
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "content"   JSONB        NOT NULL,
                "role"      TEXT         NOT NULL,
                "chatId"    TEXT         NOT NULL,
                "model"     TEXT,
                "isPartial" BOOLEAN      NOT NULL DEFAULT false,

                CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "DocumentText"
            (
                "id"         BIGSERIAL NOT NULL,
                "content"    TEXT      NOT NULL,
                "documentId" TEXT      NOT NULL,
                "tokenCount" BIGINT    NOT NULL DEFAULT 0,

                CONSTRAINT "DocumentText_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "InstructionsDocuments"
            (
                "documentId" TEXT NOT NULL,
                "userId"     TEXT NOT NULL,

                CONSTRAINT "InstructionsDocuments_pkey" PRIMARY KEY ("documentId")
            );

            CREATE TABLE "Macrotation"
            (
                "id"                TEXT         NOT NULL,
                "parentId"          TEXT,
                "documentId"        TEXT         NOT NULL,
                "userId"            TEXT         NOT NULL,
                "highlightedText"   TEXT,
                "image"             TEXT,
                "comment"           TEXT,
                "hexCode"           TEXT,
                "section"           TEXT,
                "linkSharePosition" TEXT,
                "location"          TEXT,
                "order"             INTEGER,
                "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "deleted"           BOOLEAN      NOT NULL DEFAULT false,

                CONSTRAINT "Macrotation_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "WebsocketConnectionPermissions"
            (
                "connectionId" TEXT         NOT NULL,
                "userId"       TEXT,
                "permissions"  JSONB        NOT NULL,
                "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT "WebsocketConnectionPermissions_pkey" PRIMARY KEY ("connectionId")
            );

            CREATE TABLE "MacroPrompt"
            (
                "id"            TEXT         NOT NULL DEFAULT gen_random_uuid(),
                "title"         TEXT         NOT NULL,
                "prompt"        TEXT         NOT NULL,
                "icon"          TEXT         NOT NULL,
                "color"         TEXT         NOT NULL,
                "required_docs" INTEGER,
                "user_id"       TEXT         NOT NULL,
                "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT "MacroPrompt_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "MacroPromptAttachment"
            (
                "id"              TEXT NOT NULL DEFAULT gen_random_uuid(),
                "attachment_type" TEXT NOT NULL,
                "attachment_id"   TEXT NOT NULL,
                "macro_prompt_id" TEXT NOT NULL,

                CONSTRAINT "MacroPromptAttachment_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "DocumentTextParts"
            (
                "id"         TEXT NOT NULL,
                "reference"  TEXT NOT NULL,
                "documentId" TEXT NOT NULL,

                CONSTRAINT "DocumentTextParts_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "ThreadAnchor"
            (
                "threadId"        BIGINT              NOT NULL,
                "anchorId"        UUID                NOT NULL,
                "anchorTableName" "anchor_table_name" NOT NULL
            );

            CREATE TABLE "Thread"
            (
                "id"         BIGSERIAL    NOT NULL,
                "owner"      TEXT         NOT NULL,
                "documentId" TEXT         NOT NULL,
                "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "deletedAt"  TIMESTAMP(3),
                "metadata"   JSONB,
                "resolved"   BOOLEAN      NOT NULL DEFAULT false,

                CONSTRAINT "Thread_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "Comment"
            (
                "id"        BIGSERIAL    NOT NULL,
                "threadId"  BIGINT       NOT NULL,
                "owner"     TEXT         NOT NULL,
                "sender"    TEXT,
                "text"      TEXT         NOT NULL,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "deletedAt" TIMESTAMP(3),
                "order"     INTEGER,
                "metadata"  JSONB,

                CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "PdfPlaceableCommentAnchor"
            (
                "uuid"             UUID             NOT NULL DEFAULT gen_random_uuid(),
                "documentId"       TEXT             NOT NULL,
                "owner"            TEXT             NOT NULL,
                "allowableEdits"   JSONB,
                "page"             INTEGER          NOT NULL,
                "wasEdited"        BOOLEAN          NOT NULL,
                "wasDeleted"       BOOLEAN          NOT NULL,
                "shouldLockOnSave" BOOLEAN          NOT NULL,
                "originalPage"     INTEGER          NOT NULL,
                "originalIndex"    INTEGER          NOT NULL,
                "xPct"             DOUBLE PRECISION NOT NULL,
                "yPct"             DOUBLE PRECISION NOT NULL,
                "widthPct"         DOUBLE PRECISION NOT NULL,
                "heightPct"        DOUBLE PRECISION NOT NULL,
                "rotation"         DOUBLE PRECISION NOT NULL,
                "threadId"         BIGINT           NOT NULL,

                CONSTRAINT "PdfPlaceableCommentAnchor_pkey" PRIMARY KEY ("uuid")
            );

            CREATE TABLE "PdfHighlightRect"
            (
                "id"                   BIGSERIAL        NOT NULL,
                "top"                  DOUBLE PRECISION NOT NULL,
                "left"                 DOUBLE PRECISION NOT NULL,
                "width"                DOUBLE PRECISION NOT NULL,
                "height"               DOUBLE PRECISION NOT NULL,
                "pdfHighlightAnchorId" UUID             NOT NULL,

                CONSTRAINT "PdfHighlightRect_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "PdfHighlightAnchor"
            (
                "uuid"               UUID             NOT NULL DEFAULT gen_random_uuid(),
                "documentId"         TEXT             NOT NULL,
                "owner"              TEXT             NOT NULL,
                "page"               INTEGER          NOT NULL,
                "red"                INTEGER          NOT NULL,
                "green"              INTEGER          NOT NULL,
                "blue"               INTEGER          NOT NULL,
                "alpha"              DOUBLE PRECISION NOT NULL,
                "type"               INTEGER          NOT NULL,
                "text"               TEXT             NOT NULL,
                "pageViewportWidth"  DOUBLE PRECISION NOT NULL,
                "pageViewportHeight" DOUBLE PRECISION NOT NULL,
                "threadId"           BIGINT,
                "createdAt"          TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt"          TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "deletedAt"          TIMESTAMP(3),

                CONSTRAINT "PdfHighlightAnchor_pkey" PRIMARY KEY ("uuid")
            );

            CREATE TABLE "Artifact"
            (
                "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "digest"     TEXT         NOT NULL,
                "messageId"  TEXT         NOT NULL,
                "documentId" TEXT,
                "name"       TEXT,
                "userId"     TEXT         NOT NULL,

                CONSTRAINT "Artifact_pkey" PRIMARY KEY ("messageId", "digest")
            );

            CREATE TABLE "WebAnnotations"
            (
                "id"           TEXT NOT NULL DEFAULT gen_random_uuid(),
                "messageId"    TEXT,
                "url"          TEXT NOT NULL,
                "title"        TEXT NOT NULL,
                "publish_date" TIMESTAMP(3),
                "description"  TEXT,
                "favicon_url"  TEXT,
                "image_url"    TEXT,
                "chatId"       TEXT,

                CONSTRAINT "WebAnnotations_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "InsightContext"
            (
                "id"             TEXT         NOT NULL DEFAULT gen_random_uuid(),
                "providerSource" TEXT         NOT NULL,
                "userId"         TEXT         NOT NULL,
                "resourceId"     TEXT         NOT NULL,
                "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "consumed"       BOOLEAN      NOT NULL DEFAULT false,

                CONSTRAINT "InsightContext_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "UserInsights"
            (
                "id"                TEXT         NOT NULL DEFAULT gen_random_uuid(),
                "content"           TEXT         NOT NULL,
                "source"            TEXT         NOT NULL,
                "sourceLocation"    JSONB,
                "generated"         BOOLEAN      NOT NULL DEFAULT true,
                "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "spanStart"         TIMESTAMP(3),
                "spanEnd"           TIMESTAMP(3),
                "confidence"        INTEGER,
                "insightType"       TEXT,
                "relevanceKeywords" TEXT[],
                "userId"            TEXT         NOT NULL,

                CONSTRAINT "UserInsights_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "UserInsightBatch"
            (
                "id"              TEXT         NOT NULL DEFAULT gen_random_uuid(),
                "userId"          TEXT         NOT NULL,
                "insightIds"      TEXT[],
                "totalChars"      INTEGER      NOT NULL,
                "estimatedTokens" INTEGER      NOT NULL,
                "rankingContext"  JSONB,
                "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "expiresAt"       TIMESTAMP(3) NOT NULL,
                "version"         INTEGER      NOT NULL DEFAULT 1,

                CONSTRAINT "UserInsightBatch_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "DocumentSummary"
            (
                "id"          TEXT         NOT NULL DEFAULT gen_random_uuid(),
                "summary"     TEXT         NOT NULL,
                "document_id" TEXT         NOT NULL,
                "version_id"  TEXT         NOT NULL,
                "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT "DocumentSummary_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "EmailInsightsBackfillJob"
            (
                "id"                     TEXT                           NOT NULL,
                "userId"                 TEXT                           NOT NULL,
                "threadsProcessedCount"  INTEGER                        NOT NULL DEFAULT 0,
                "insightsGeneratedCount" INTEGER                        NOT NULL DEFAULT 0,
                "status"                 "insights_backfill_job_status" NOT NULL DEFAULT 'Init',
                "completedAt"            TIMESTAMP(3),
                "createdAt"              TIMESTAMP(3)                   NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt"              TIMESTAMP(3)                   NOT NULL,

                CONSTRAINT "EmailInsightsBackfillJob_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "EmailInsightsBackfillBatch"
            (
                "id"                     TEXT                             NOT NULL,
                "insightsBackfillJobId"  TEXT                             NOT NULL,
                "sqsMessageId"           TEXT,
                "threadIds"              TEXT[],
                "totalThreads"           INTEGER                          NOT NULL,
                "status"                 "insights_backfill_batch_status" NOT NULL DEFAULT 'Queued',
                "insightsGeneratedCount" INTEGER                          NOT NULL DEFAULT 0,
                "insightIds"             TEXT[],
                "errorMessage"           TEXT,
                "queuedAt"               TIMESTAMP(3),
                "startedAt"              TIMESTAMP(3),
                "completedAt"            TIMESTAMP(3),
                "createdAt"              TIMESTAMP(3)                     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt"              TIMESTAMP(3)                     NOT NULL,

                CONSTRAINT "EmailInsightsBackfillBatch_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "UserItemAccess"
            (
                "id"                      UUID          NOT NULL,
                "user_id"                 TEXT          NOT NULL,
                "item_id"                 TEXT          NOT NULL,
                "item_type"               TEXT          NOT NULL,
                "granted_from_channel_id" UUID,
                "access_level"            "AccessLevel" NOT NULL,
                "created_at"              TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updated_at"              TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT "UserItemAccess_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "team"
            (
                "id"       UUID NOT NULL,
                "name"     TEXT NOT NULL,
                "owner_id" TEXT NOT NULL,

                CONSTRAINT "team_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "team_invite"
            (
                "id"           UUID         NOT NULL,
                "email"        TEXT         NOT NULL,
                "team_id"      UUID         NOT NULL,
                "team_role"    "team_role"  NOT NULL DEFAULT 'member',
                "invited_by"   TEXT         NOT NULL,
                "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "last_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT "team_invite_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "team_user"
            (
                "user_id"   TEXT        NOT NULL,
                "team_id"   UUID        NOT NULL,
                "team_role" "team_role" NOT NULL,

                CONSTRAINT "team_user_pkey" PRIMARY KEY ("user_id", "team_id")
            );

            CREATE TABLE "saved_view"
            (
                "id"         UUID        NOT NULL,
                "user_id"    TEXT        NOT NULL,
                "name"       TEXT        NOT NULL,
                "config"     JSONB       NOT NULL,
                "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updated_at" TIMESTAMPTZ NOT NULL,

                CONSTRAINT "saved_view_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE "excluded_default_view"
            (
                "id"              UUID NOT NULL,
                "user_id"         TEXT NOT NULL,
                "default_view_id" TEXT NOT NULL,

                CONSTRAINT "excluded_default_view_pkey" PRIMARY KEY ("id")
            );

            CREATE UNIQUE INDEX "macro_user_username_key" ON "macro_user" ("username");

            CREATE UNIQUE INDEX "macro_user_email_key" ON "macro_user" ("email");

            CREATE UNIQUE INDEX "macro_user_stripe_customer_id_key" ON "macro_user" ("stripe_customer_id");

            CREATE UNIQUE INDEX "macro_user_email_verification_email_key" ON "macro_user_email_verification" ("email");

            CREATE INDEX "macro_user_email_verification_macro_user_id_idx" ON "macro_user_email_verification" ("macro_user_id");

            CREATE UNIQUE INDEX "in_progress_email_link_email_key" ON "in_progress_email_link" ("email");

            CREATE INDEX "in_progress_user_link_macro_user_id_idx" ON "in_progress_user_link" ("macro_user_id");

            CREATE UNIQUE INDEX "account_merge_request_to_merge_macro_user_id_key" ON "account_merge_request" ("to_merge_macro_user_id");

            CREATE INDEX "account_merge_request_macro_user_id_idx" ON "account_merge_request" ("macro_user_id");

            CREATE INDEX "account_merge_request_to_merge_macro_user_id_idx" ON "account_merge_request" ("to_merge_macro_user_id");

            CREATE INDEX "account_merge_request_code_idx" ON "account_merge_request" ("code");

            CREATE UNIQUE INDEX "User_id_key" ON "User" ("id");

            CREATE UNIQUE INDEX "User_email_key" ON "User" ("email");

            CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User" ("stripeCustomerId");

            CREATE INDEX "User_email_idx" ON "User" ("email");

            CREATE INDEX "User_organizationId_idx" ON "User" ("organizationId");

            CREATE UNIQUE INDEX "Experiment_id_key" ON "Experiment" ("id");

            CREATE INDEX "ExperimentLog_user_id_idx" ON "ExperimentLog" ("user_id");

            CREATE INDEX "ExperimentLog_experiment_id_idx" ON "ExperimentLog" ("experiment_id");

            CREATE UNIQUE INDEX "UserApiKey_key_key" ON "UserApiKey" ("key");

            CREATE INDEX "UserApiKey_user_id_idx" ON "UserApiKey" ("user_id");

            CREATE INDEX "UserApiKey_key_idx" ON "UserApiKey" ("key");

            CREATE UNIQUE INDEX "Organization_name_key" ON "Organization" ("name");

            CREATE UNIQUE INDEX "Organization_stripeCustomerId_key" ON "Organization" ("stripeCustomerId");

            CREATE INDEX "OrganizationInvitation_organization_id_idx" ON "OrganizationInvitation" ("organization_id");

            CREATE INDEX "OrganizationInvitation_email_idx" ON "OrganizationInvitation" ("email");

            CREATE UNIQUE INDEX "OrganizationInvitation_organization_id_email_key" ON "OrganizationInvitation" ("organization_id", "email");

            CREATE UNIQUE INDEX "OrganizationDefaultSharePermission_organization_id_key" ON "OrganizationDefaultSharePermission" ("organization_id");

            CREATE INDEX "OrganizationDefaultSharePermission_organization_id_idx" ON "OrganizationDefaultSharePermission" ("organization_id");

            CREATE UNIQUE INDEX "OrganizationRetentionPolicy_organization_id_key" ON "OrganizationRetentionPolicy" ("organization_id");

            CREATE INDEX "OrganizationRetentionPolicy_organization_id_idx" ON "OrganizationRetentionPolicy" ("organization_id");

            CREATE UNIQUE INDEX "OrganizationItJob_organizationId_key" ON "OrganizationItJob" ("organizationId");

            CREATE UNIQUE INDEX "OrganizationIT_email_key" ON "OrganizationIT" ("email");

            CREATE INDEX "OrganizationEmailMatches_organizationId_idx" ON "OrganizationEmailMatches" ("organizationId");

            CREATE UNIQUE INDEX "EnterpriseRules_organizationId_key" ON "EnterpriseRules" ("organizationId");

            CREATE UNIQUE INDEX "OrganizationBilling_email_key" ON "OrganizationBilling" ("email");

            CREATE INDEX "DocumentFamily_rootDocumentId_idx" ON "DocumentFamily" ("rootDocumentId");

            CREATE INDEX "Project_uploadPending_idx" ON "Project" ("uploadPending");

            CREATE INDEX "Project_userId_idx" ON "Project" ("userId");

            CREATE INDEX "Project_parentId_idx" ON "Project" ("parentId");

            CREATE INDEX "Document_branchedFromId_idx" ON "Document" ("branchedFromId");

            CREATE INDEX "Document_owner_idx" ON "Document" ("owner");

            CREATE INDEX "Document_owner_deletedAt_idx" ON "Document" ("owner", "deletedAt");

            CREATE INDEX "Document_documentFamilyId_idx" ON "Document" ("documentFamilyId");

            CREATE INDEX "Document_owner_fileType_idx" ON "Document" ("owner", "fileType");

            CREATE INDEX "Document_projectId_idx" ON "Document" ("projectId");

            CREATE INDEX "DocumentView_document_id_idx" ON "DocumentView" ("document_id");

            CREATE INDEX "DocumentView_user_id_idx" ON "DocumentView" ("user_id");

            CREATE INDEX "ChannelSharePermission_channel_id_idx" ON "ChannelSharePermission" ("channel_id");

            CREATE INDEX "ChannelSharePermission_share_permission_id_idx" ON "ChannelSharePermission" ("share_permission_id");

            CREATE UNIQUE INDEX "DocumentPermission_documentId_key" ON "DocumentPermission" ("documentId");

            CREATE UNIQUE INDEX "DocumentPermission_sharePermissionId_key" ON "DocumentPermission" ("sharePermissionId");

            CREATE UNIQUE INDEX "ChatPermission_chatId_key" ON "ChatPermission" ("chatId");

            CREATE UNIQUE INDEX "ChatPermission_sharePermissionId_key" ON "ChatPermission" ("sharePermissionId");

            CREATE UNIQUE INDEX "ProjectPermission_projectId_key" ON "ProjectPermission" ("projectId");

            CREATE UNIQUE INDEX "ProjectPermission_sharePermissionId_key" ON "ProjectPermission" ("sharePermissionId");

            CREATE UNIQUE INDEX "MacroPromptPermission_macro_prompt_id_key" ON "MacroPromptPermission" ("macro_prompt_id");

            CREATE UNIQUE INDEX "MacroPromptPermission_share_permission_id_key" ON "MacroPromptPermission" ("share_permission_id");

            CREATE UNIQUE INDEX "EmailThreadPermission_threadId_key" ON "EmailThreadPermission" ("threadId");

            CREATE UNIQUE INDEX "EmailThreadPermission_sharePermissionId_key" ON "EmailThreadPermission" ("sharePermissionId");

            CREATE INDEX "DocumentInstance_documentId_idx" ON "DocumentInstance" ("documentId");

            CREATE INDEX "DocumentInstanceModificationData_documentInstanceId_idx" ON "DocumentInstanceModificationData" ("documentInstanceId");

            CREATE INDEX "DocumentBom_documentId_idx" ON "DocumentBom" ("documentId");

            CREATE INDEX "BomPart_sha_idx" ON "BomPart" ("sha");

            CREATE INDEX "BomPart_documentBomId_idx" ON "BomPart" ("documentBomId");

            CREATE INDEX "DocumentProcessResult_documentId_idx" ON "DocumentProcessResult" ("documentId");

            CREATE UNIQUE INDEX "DocumentProcessResult_documentId_jobType_key" ON "DocumentProcessResult" ("documentId", "jobType");

            CREATE UNIQUE INDEX "JobToDocumentProcessResult_jobId_key" ON "JobToDocumentProcessResult" ("jobId");

            CREATE INDEX "JobToDocumentProcessResult_jobId_idx" ON "JobToDocumentProcessResult" ("jobId");

            CREATE INDEX "JobToDocumentProcessResult_documentProcessResultId_idx" ON "JobToDocumentProcessResult" ("documentProcessResultId");

            CREATE INDEX "UserHistory_userId_idx" ON "UserHistory" ("userId");

            CREATE INDEX "UserHistory_userId_itemType_idx" ON "UserHistory" ("userId", "itemType");

            CREATE INDEX "UserHistory_itemId_itemType_idx" ON "UserHistory" ("itemId", "itemType");

            CREATE INDEX "UserDocumentViewLocation_user_id_idx" ON "UserDocumentViewLocation" ("user_id");

            CREATE INDEX "UserDocumentViewLocation_document_id_idx" ON "UserDocumentViewLocation" ("document_id");

            CREATE INDEX "ItemLastAccessed_item_id_idx" ON "ItemLastAccessed" ("item_id");

            CREATE INDEX "ItemLastAccessed_item_type_idx" ON "ItemLastAccessed" ("item_type");

            CREATE INDEX "UploadJob_jobId_idx" ON "UploadJob" ("jobId");

            CREATE INDEX "UploadJob_documentId_idx" ON "UploadJob" ("documentId");

            CREATE INDEX "Pin_userId_idx" ON "Pin" ("userId");

            CREATE INDEX "Pin_pinnedItemId_idx" ON "Pin" ("pinnedItemId");

            CREATE INDEX "Chat_userId_idx" ON "Chat" ("userId");

            CREATE INDEX "Chat_projectId_idx" ON "Chat" ("projectId");

            CREATE INDEX "ChatAttachment_messageId_idx" ON "ChatAttachment" ("messageId");

            CREATE INDEX "ChatAttachment_chatId_idx" ON "ChatAttachment" ("chatId");

            CREATE INDEX "ChatAttachment_attachmentType_attachmentId_idx" ON "ChatAttachment" ("attachmentType", "attachmentId");

            CREATE INDEX "ChatMessage_chatId_idx" ON "ChatMessage" ("chatId");

            CREATE INDEX "ChatMessage_isPartial_idx" ON "ChatMessage" ("isPartial");

            CREATE UNIQUE INDEX "DocumentText_documentId_key" ON "DocumentText" ("documentId");

            CREATE INDEX "DocumentText_documentId_idx" ON "DocumentText" ("documentId");

            CREATE INDEX "InstructionsDocuments_userId_idx" ON "InstructionsDocuments" ("userId");

            CREATE UNIQUE INDEX "InstructionsDocuments_userId_key" ON "InstructionsDocuments" ("userId");

            CREATE INDEX "Macrotation_documentId_idx" ON "Macrotation" ("documentId");

            CREATE INDEX "Macrotation_parentId_idx" ON "Macrotation" ("parentId");

            CREATE INDEX "Macrotation_userId_idx" ON "Macrotation" ("userId");

            CREATE UNIQUE INDEX "WebsocketConnectionPermissions_connectionId_key" ON "WebsocketConnectionPermissions" ("connectionId");

            CREATE INDEX "MacroPrompt_user_id_idx" ON "MacroPrompt" ("user_id");

            CREATE INDEX "MacroPromptAttachment_macro_prompt_id_idx" ON "MacroPromptAttachment" ("macro_prompt_id");

            CREATE INDEX "MacroPromptAttachment_attachment_type_attachment_id_idx" ON "MacroPromptAttachment" ("attachment_type", "attachment_id");

            CREATE INDEX "DocumentTextParts_documentId_idx" ON "DocumentTextParts" ("documentId");

            CREATE UNIQUE INDEX "ThreadAnchor_threadId_key" ON "ThreadAnchor" ("threadId");

            CREATE UNIQUE INDEX "ThreadAnchor_anchorId_key" ON "ThreadAnchor" ("anchorId");

            CREATE INDEX "Thread_documentId_idx" ON "Thread" ("documentId");

            CREATE INDEX "Thread_owner_idx" ON "Thread" ("owner");

            CREATE INDEX "Comment_threadId_idx" ON "Comment" ("threadId");

            CREATE INDEX "Comment_threadId_createdAt_idx" ON "Comment" ("threadId", "createdAt");

            CREATE INDEX "Comment_owner_idx" ON "Comment" ("owner");

            CREATE INDEX "PdfPlaceableCommentAnchor_threadId_idx" ON "PdfPlaceableCommentAnchor" ("threadId");

            CREATE INDEX "PdfPlaceableCommentAnchor_documentId_idx" ON "PdfPlaceableCommentAnchor" ("documentId");

            CREATE INDEX "PdfPlaceableCommentAnchor_owner_idx" ON "PdfPlaceableCommentAnchor" ("owner");

            CREATE INDEX "PdfHighlightRect_pdfHighlightAnchorId_idx" ON "PdfHighlightRect" ("pdfHighlightAnchorId");

            CREATE INDEX "PdfHighlightAnchor_threadId_idx" ON "PdfHighlightAnchor" ("threadId");

            CREATE INDEX "PdfHighlightAnchor_documentId_idx" ON "PdfHighlightAnchor" ("documentId");

            CREATE INDEX "PdfHighlightAnchor_owner_idx" ON "PdfHighlightAnchor" ("owner");

            CREATE INDEX "Artifact_userId_idx" ON "Artifact" ("userId");

            CREATE INDEX "Artifact_digest_idx" ON "Artifact" ("digest");

            CREATE INDEX "Artifact_documentId_idx" ON "Artifact" ("documentId");

            CREATE INDEX "WebAnnotations_messageId_idx" ON "WebAnnotations" ("messageId");

            CREATE INDEX "WebAnnotations_chatId_idx" ON "WebAnnotations" ("chatId");

            CREATE INDEX "UserInsights_userId_idx" ON "UserInsights" ("userId");

            CREATE INDEX "UserInsightBatch_userId_idx" ON "UserInsightBatch" ("userId");

            CREATE INDEX "UserInsightBatch_expiresAt_idx" ON "UserInsightBatch" ("expiresAt");

            CREATE UNIQUE INDEX "UserInsightBatch_userId_key" ON "UserInsightBatch" ("userId");

            CREATE INDEX "DocumentSummary_document_id_idx" ON "DocumentSummary" ("document_id");

            CREATE INDEX "UserItemAccess_user_id_idx" ON "UserItemAccess" ("user_id");

            CREATE INDEX "UserItemAccess_item_id_idx" ON "UserItemAccess" ("item_id");

            CREATE INDEX "UserItemAccess_granted_from_channel_id_idx" ON "UserItemAccess" ("granted_from_channel_id");

            CREATE UNIQUE INDEX "UserItemAccess_user_id_item_id_item_type_granted_from_chann_key" ON "UserItemAccess" ("user_id", "item_id", "item_type", "granted_from_channel_id");

            CREATE INDEX "team_owner_id_idx" ON "team" ("owner_id");

            CREATE INDEX "team_invite_invited_by_idx" ON "team_invite" ("invited_by");

            CREATE INDEX "team_invite_team_id_idx" ON "team_invite" ("team_id");

            CREATE INDEX "team_invite_email_idx" ON "team_invite" ("email");

            CREATE UNIQUE INDEX "team_invite_email_team_id_key" ON "team_invite" ("email", "team_id");

            CREATE INDEX "team_user_team_id_idx" ON "team_user" ("team_id");

            CREATE INDEX "team_user_user_id_idx" ON "team_user" ("user_id");

            CREATE INDEX "idx_views_user_id" ON "saved_view" ("user_id");

            ALTER TABLE "macro_user_email_verification"
                ADD CONSTRAINT "macro_user_email_verification_macro_user_id_fkey" FOREIGN KEY ("macro_user_id") REFERENCES "macro_user" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "macro_user_info"
                ADD CONSTRAINT "macro_user_info_macro_user_id_fkey" FOREIGN KEY ("macro_user_id") REFERENCES "macro_user" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "in_progress_email_link"
                ADD CONSTRAINT "in_progress_email_link_macro_user_id_fkey" FOREIGN KEY ("macro_user_id") REFERENCES "macro_user" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "in_progress_user_link"
                ADD CONSTRAINT "in_progress_user_link_macro_user_id_fkey" FOREIGN KEY ("macro_user_id") REFERENCES "macro_user" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "account_merge_request"
                ADD CONSTRAINT "account_merge_request_macro_user_id_fkey" FOREIGN KEY ("macro_user_id") REFERENCES "macro_user" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "User"
                ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

            ALTER TABLE "User"
                ADD CONSTRAINT "User_macro_user_id_fkey" FOREIGN KEY ("macro_user_id") REFERENCES "macro_user" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "ExperimentLog"
                ADD CONSTRAINT "ExperimentLog_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "Experiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "ExperimentLog"
                ADD CONSTRAINT "ExperimentLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "UserApiKey"
                ADD CONSTRAINT "UserApiKey_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "OrganizationInvitation"
                ADD CONSTRAINT "OrganizationInvitation_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "OrganizationDefaultSharePermission"
                ADD CONSTRAINT "OrganizationDefaultSharePermission_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "OrganizationRetentionPolicy"
                ADD CONSTRAINT "OrganizationRetentionPolicy_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "OrganizationItJob"
                ADD CONSTRAINT "OrganizationItJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "OrganizationIT"
                ADD CONSTRAINT "OrganizationIT_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "OrganizationEmailMatches"
                ADD CONSTRAINT "OrganizationEmailMatches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "EnterpriseRules"
                ADD CONSTRAINT "EnterpriseRules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "EnterpriseIManageTenants"
                ADD CONSTRAINT "EnterpriseIManageTenants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "OrganizationBilling"
                ADD CONSTRAINT "OrganizationBilling_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "EnterpriseEmailContacts"
                ADD CONSTRAINT "EnterpriseEmailContacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "RolesOnPermissions"
                ADD CONSTRAINT "RolesOnPermissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "RolesOnPermissions"
                ADD CONSTRAINT "RolesOnPermissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "RolesOnOrganizations"
                ADD CONSTRAINT "RolesOnOrganizations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "RolesOnOrganizations"
                ADD CONSTRAINT "RolesOnOrganizations_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "RolesOnUsers"
                ADD CONSTRAINT "RolesOnUsers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "RolesOnUsers"
                ADD CONSTRAINT "RolesOnUsers_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "Project"
                ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "Project"
                ADD CONSTRAINT "Project_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "Document"
                ADD CONSTRAINT "Document_owner_fkey" FOREIGN KEY ("owner") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "Document"
                ADD CONSTRAINT "Document_documentFamilyId_fkey" FOREIGN KEY ("documentFamilyId") REFERENCES "DocumentFamily" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

            ALTER TABLE "Document"
                ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

            ALTER TABLE "DocumentView"
                ADD CONSTRAINT "DocumentView_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "DocumentView"
                ADD CONSTRAINT "DocumentView_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "ChannelSharePermission"
                ADD CONSTRAINT "ChannelSharePermission_share_permission_id_fkey" FOREIGN KEY ("share_permission_id") REFERENCES "SharePermission" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "DocumentPermission"
                ADD CONSTRAINT "DocumentPermission_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "DocumentPermission"
                ADD CONSTRAINT "DocumentPermission_sharePermissionId_fkey" FOREIGN KEY ("sharePermissionId") REFERENCES "SharePermission" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "ChatPermission"
                ADD CONSTRAINT "ChatPermission_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "ChatPermission"
                ADD CONSTRAINT "ChatPermission_sharePermissionId_fkey" FOREIGN KEY ("sharePermissionId") REFERENCES "SharePermission" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "ProjectPermission"
                ADD CONSTRAINT "ProjectPermission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "ProjectPermission"
                ADD CONSTRAINT "ProjectPermission_sharePermissionId_fkey" FOREIGN KEY ("sharePermissionId") REFERENCES "SharePermission" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "MacroPromptPermission"
                ADD CONSTRAINT "MacroPromptPermission_macro_prompt_id_fkey" FOREIGN KEY ("macro_prompt_id") REFERENCES "MacroPrompt" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "MacroPromptPermission"
                ADD CONSTRAINT "MacroPromptPermission_share_permission_id_fkey" FOREIGN KEY ("share_permission_id") REFERENCES "SharePermission" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "EmailThreadPermission"
                ADD CONSTRAINT "EmailThreadPermission_sharePermissionId_fkey" FOREIGN KEY ("sharePermissionId") REFERENCES "SharePermission" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "EmailThreadPermission"
                ADD CONSTRAINT "EmailThreadPermission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

            ALTER TABLE "DocumentInstance"
                ADD CONSTRAINT "DocumentInstance_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "DocumentInstanceModificationData"
                ADD CONSTRAINT "DocumentInstanceModificationData_documentInstanceId_fkey" FOREIGN KEY ("documentInstanceId") REFERENCES "DocumentInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "DocumentBom"
                ADD CONSTRAINT "DocumentBom_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "BomPart"
                ADD CONSTRAINT "BomPart_documentBomId_fkey" FOREIGN KEY ("documentBomId") REFERENCES "DocumentBom" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "DocumentProcessResult"
                ADD CONSTRAINT "DocumentProcessResult_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "JobToDocumentProcessResult"
                ADD CONSTRAINT "JobToDocumentProcessResult_documentProcessResultId_fkey" FOREIGN KEY ("documentProcessResultId") REFERENCES "DocumentProcessResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "UserHistory"
                ADD CONSTRAINT "UserHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "UserDocumentViewLocation"
                ADD CONSTRAINT "UserDocumentViewLocation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "UserDocumentViewLocation"
                ADD CONSTRAINT "UserDocumentViewLocation_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "Pin"
                ADD CONSTRAINT "Pin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "Chat"
                ADD CONSTRAINT "Chat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "Chat"
                ADD CONSTRAINT "Chat_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

            ALTER TABLE "ChatAttachment"
                ADD CONSTRAINT "ChatAttachment_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "ChatAttachment"
                ADD CONSTRAINT "ChatAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "ChatMessage"
                ADD CONSTRAINT "ChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "DocumentText"
                ADD CONSTRAINT "DocumentText_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "InstructionsDocuments"
                ADD CONSTRAINT "InstructionsDocuments_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "InstructionsDocuments"
                ADD CONSTRAINT "InstructionsDocuments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "Macrotation"
                ADD CONSTRAINT "Macrotation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Macrotation" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "Macrotation"
                ADD CONSTRAINT "Macrotation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "Macrotation"
                ADD CONSTRAINT "Macrotation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

            ALTER TABLE "WebsocketConnectionPermissions"
                ADD CONSTRAINT "WebsocketConnectionPermissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

            ALTER TABLE "MacroPrompt"
                ADD CONSTRAINT "MacroPrompt_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "MacroPromptAttachment"
                ADD CONSTRAINT "MacroPromptAttachment_macro_prompt_id_fkey" FOREIGN KEY ("macro_prompt_id") REFERENCES "MacroPrompt" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "DocumentTextParts"
                ADD CONSTRAINT "DocumentTextParts_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "ThreadAnchor"
                ADD CONSTRAINT "ThreadAnchor_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "Thread"
                ADD CONSTRAINT "Thread_owner_fkey" FOREIGN KEY ("owner") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "Thread"
                ADD CONSTRAINT "Thread_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "Comment"
                ADD CONSTRAINT "Comment_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "Comment"
                ADD CONSTRAINT "Comment_owner_fkey" FOREIGN KEY ("owner") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "PdfPlaceableCommentAnchor"
                ADD CONSTRAINT "PdfPlaceableCommentAnchor_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "PdfPlaceableCommentAnchor"
                ADD CONSTRAINT "PdfPlaceableCommentAnchor_owner_fkey" FOREIGN KEY ("owner") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "PdfPlaceableCommentAnchor"
                ADD CONSTRAINT "PdfPlaceableCommentAnchor_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "PdfHighlightRect"
                ADD CONSTRAINT "PdfHighlightRect_pdfHighlightAnchorId_fkey" FOREIGN KEY ("pdfHighlightAnchorId") REFERENCES "PdfHighlightAnchor" ("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "PdfHighlightAnchor"
                ADD CONSTRAINT "PdfHighlightAnchor_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "PdfHighlightAnchor"
                ADD CONSTRAINT "PdfHighlightAnchor_owner_fkey" FOREIGN KEY ("owner") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "PdfHighlightAnchor"
                ADD CONSTRAINT "PdfHighlightAnchor_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "Artifact"
                ADD CONSTRAINT "Artifact_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "Artifact"
                ADD CONSTRAINT "Artifact_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

            ALTER TABLE "Artifact"
                ADD CONSTRAINT "Artifact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "WebAnnotations"
                ADD CONSTRAINT "WebAnnotations_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "WebAnnotations"
                ADD CONSTRAINT "WebAnnotations_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

            ALTER TABLE "InsightContext"
                ADD CONSTRAINT "InsightContext_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "UserInsights"
                ADD CONSTRAINT "UserInsights_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "UserInsightBatch"
                ADD CONSTRAINT "UserInsightBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "DocumentSummary"
                ADD CONSTRAINT "DocumentSummary_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "EmailInsightsBackfillJob"
                ADD CONSTRAINT "EmailInsightsBackfillJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

            ALTER TABLE "EmailInsightsBackfillBatch"
                ADD CONSTRAINT "EmailInsightsBackfillBatch_insightsBackfillJobId_fkey" FOREIGN KEY ("insightsBackfillJobId") REFERENCES "EmailInsightsBackfillJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "team"
                ADD CONSTRAINT "team_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "team_invite"
                ADD CONSTRAINT "team_invite_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "team_invite"
                ADD CONSTRAINT "team_invite_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "team_user"
                ADD CONSTRAINT "team_user_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "team_user"
                ADD CONSTRAINT "team_user_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "saved_view"
                ADD CONSTRAINT "saved_view_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "excluded_default_view"
                ADD CONSTRAINT "excluded_default_view_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

        END IF;
    END
$$;