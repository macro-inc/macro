-- NOTE: This is used purely to setup the testing DB
-- Changes from `database/prisma/schema.prisma` need to be converted into raw SQL
-- Changes here WILL NOT ever make it into the dev/production db.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA public;

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE TYPE public."AccessLevel" AS ENUM (
    'view',
    'comment',
    'edit',
    'owner'
);

CREATE TYPE public."OrganizationItJobType" AS ENUM (
    'UPDATE',
    'REMOVE'
);

CREATE TYPE public."OrganizationStatus" AS ENUM (
    'PILOT',
    'ENTERPRISE'
);

CREATE TYPE public."SetAsDefault" AS ENUM (
    'ASK',
    'FORCE',
    'HIDE'
);

CREATE TYPE public.anchor_table_name AS ENUM (
    'PdfPlaceableCommentAnchor',
    'PdfHighlightAnchor'
);

CREATE TYPE public.comms_channel_type AS ENUM (
    'public',
    'organization',
    'private',
    'direct_message',
    'team'
);

CREATE TYPE public.comms_participant_role AS ENUM (
    'owner',
    'admin',
    'member'
);

CREATE TYPE public.document_sub_type_value AS ENUM (
    'task'
);

CREATE TYPE public.email_backfill_job_status AS ENUM (
    'Init',
    'InProgress',
    'Complete',
    'Cancelled',
    'Failed'
);

CREATE TYPE public.email_backfill_message_status AS ENUM (
    'InProgress',
    'Completed',
    'Failed',
    'Cancelled'
);

CREATE TYPE public.email_backfill_thread_status AS ENUM (
    'InProgress',
    'Skipped',
    'Completed',
    'Failed',
    'Cancelled'
);

CREATE TYPE public.email_label_list_visibility_enum AS ENUM (
    'LabelShow',
    'LabelShowIfUnread',
    'LabelHide'
);

CREATE TYPE public.email_label_type_enum AS ENUM (
    'System',
    'User'
);

CREATE TYPE public.email_message_list_visibility_enum AS ENUM (
    'Show',
    'Hide'
);

CREATE TYPE public.email_recipient_type AS ENUM (
    'TO',
    'CC',
    'BCC'
);

CREATE TYPE public.email_user_provider_enum AS ENUM (
    'GMAIL'
);

CREATE TYPE public.entity_access_source_type AS ENUM (
    'channel',
    'team',
    'user'
);

CREATE TYPE public.insights_backfill_batch_status AS ENUM (
    'Queued',
    'InProgress',
    'Complete',
    'Failed'
);

CREATE TYPE public.insights_backfill_job_status AS ENUM (
    'Init',
    'InProgress',
    'Complete',
    'Cancelled',
    'Failed'
);

CREATE TYPE public.notification_device_type_option AS ENUM (
    'ios',
    'android'
);

CREATE TYPE public.property_data_type AS ENUM (
    'BOOLEAN',
    'DATE',
    'NUMBER',
    'STRING',
    'SELECT_NUMBER',
    'SELECT_STRING',
    'ENTITY',
    'LINK'
);

CREATE TYPE public.property_entity_type AS ENUM (
    'CHANNEL',
    'CHAT',
    'DOCUMENT',
    'PROJECT',
    'THREAD',
    'USER',
    'COMPANY',
    'TASK'
);

CREATE TYPE public.team_role AS ENUM (
    'member',
    'admin',
    'owner'
);

CREATE TYPE public.team_user_tier AS ENUM (
    'haiku',
    'sonnet',
    'opus'
);

CREATE FUNCTION public.check_property_name_not_system() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.is_system = FALSE AND EXISTS (
        SELECT 1 FROM property_definitions 
        WHERE is_system = TRUE AND LOWER(display_name) = LOWER(NEW.display_name)
    ) THEN
        RAISE EXCEPTION 'Cannot create custom property with reserved system property name: %', NEW.display_name;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.delete_orphaned_property_definition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF NEW.organization_id IS NULL AND NEW.user_id IS NULL THEN
            DELETE FROM property_definitions WHERE id = NEW.id;
            RETURN NULL;
        END IF;
        RETURN NEW;
    END;
$$;

CREATE FUNCTION public.delete_share_permission_on_call_record_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  DELETE FROM "SharePermission" WHERE id = OLD.share_permission_id;
  RETURN OLD;
END;
$$;

CREATE FUNCTION public.ecsi_delete_message() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    DELETE FROM email_contact_search_index WHERE message_id = OLD.id;
    RETURN OLD;
END;
$$;

CREATE FUNCTION public.ecsi_delete_recipient() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    DELETE FROM email_contact_search_index
    WHERE message_id = OLD.message_id
      AND contact_type = OLD.recipient_type::text
      AND contact_email = (SELECT email_address FROM email_contacts WHERE id = OLD.contact_id);
    RETURN OLD;
END;
$$;

CREATE FUNCTION public.ecsi_populate_from() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.from_contact_id IS NOT NULL THEN
        INSERT INTO email_contact_search_index
            (link_id, thread_id, message_id, contact_name, contact_email, contact_type)
        SELECT NEW.link_id, NEW.thread_id, NEW.id,
               COALESCE(NEW.from_name, c.name), c.email_address, 'FROM'
        FROM email_contacts c
        WHERE c.id = NEW.from_contact_id
        ON CONFLICT (message_id, contact_email, contact_type) DO UPDATE SET
            contact_name = EXCLUDED.contact_name;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.ecsi_populate_recipient() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO email_contact_search_index
        (link_id, thread_id, message_id, contact_name, contact_email, contact_type)
    SELECT m.link_id, m.thread_id, m.id,
           COALESCE(NEW.name, c.name), c.email_address, NEW.recipient_type::text
    FROM email_messages m
    JOIN email_contacts c ON c.id = NEW.contact_id
    WHERE m.id = NEW.message_id
    ON CONFLICT (message_id, contact_email, contact_type) DO UPDATE SET
        contact_name = EXCLUDED.contact_name;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.ecsi_update_contact_name() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE email_contact_search_index idx
    SET contact_name = NEW.name
    FROM email_messages m
    WHERE idx.message_id = m.id
      AND idx.contact_type = 'FROM'
      AND m.from_contact_id = NEW.id
      AND m.from_name IS NULL;

    UPDATE email_contact_search_index idx
    SET contact_name = NEW.name
    FROM email_message_recipients mr
    JOIN email_messages m ON m.id = mr.message_id
    WHERE idx.message_id = mr.message_id
      AND idx.contact_type = mr.recipient_type::text
      AND mr.contact_id = NEW.id
      AND mr.name IS NULL;

    RETURN NEW;
END;
$$;

CREATE SEQUENCE _sqlx_test.database_ids
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
CREATE TABLE _sqlx_test.databases (
    db_name text NOT NULL,
    test_path text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."Artifact" (
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    digest text NOT NULL,
    "messageId" text NOT NULL,
    "documentId" text,
    name text,
    "userId" text NOT NULL
);

CREATE TABLE public."BlockedEmail" (
    email text NOT NULL
);

CREATE TABLE public."BomPart" (
    id text DEFAULT gen_random_uuid() NOT NULL,
    sha text NOT NULL,
    path text NOT NULL,
    "documentBomId" bigint NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public."ChannelSharePermission" (
    channel_id text NOT NULL,
    share_permission_id text NOT NULL,
    access_level public."AccessLevel" NOT NULL
);

CREATE TABLE public."Chat" (
    id text DEFAULT gen_random_uuid() NOT NULL,
    "userId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    name text NOT NULL,
    model text DEFAULT 'gpt-4o'::text NOT NULL,
    "tokenCount" bigint,
    "projectId" text,
    "isPersistent" boolean DEFAULT false NOT NULL
);

CREATE TABLE public."ChatAttachment" (
    id text DEFAULT gen_random_uuid() NOT NULL,
    "attachmentType" text NOT NULL,
    "attachmentId" text NOT NULL,
    "chatId" text,
    "messageId" text
);

CREATE TABLE public."ChatMessage" (
    id text DEFAULT gen_random_uuid() NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    content jsonb NOT NULL,
    role text NOT NULL,
    "chatId" text NOT NULL,
    model text
);

CREATE TABLE public."ChatPermission" (
    "chatId" text NOT NULL,
    "sharePermissionId" text NOT NULL
);

CREATE TABLE public."Comment" (
    id bigint NOT NULL,
    "threadId" bigint NOT NULL,
    owner text NOT NULL,
    sender text,
    text text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "order" integer,
    metadata jsonb
);

CREATE SEQUENCE public."Comment_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."Comment_id_seq" OWNED BY public."Comment".id;

CREATE TABLE public."Document" (
    id text DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    owner text NOT NULL,
    "fileType" text,
    "branchedFromId" text,
    "branchedFromVersionId" bigint,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    uploaded boolean DEFAULT false NOT NULL,
    "documentFamilyId" bigint,
    "projectId" text
);

CREATE TABLE public."DocumentBom" (
    id bigint NOT NULL,
    "revisionName" text,
    "documentId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE public."DocumentBom_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."DocumentBom_id_seq" OWNED BY public."DocumentBom".id;

CREATE TABLE public."DocumentFamily" (
    id bigint NOT NULL,
    "rootDocumentId" text NOT NULL
);

CREATE SEQUENCE public."DocumentFamily_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."DocumentFamily_id_seq" OWNED BY public."DocumentFamily".id;

CREATE TABLE public."DocumentInstance" (
    id bigint NOT NULL,
    "revisionName" text,
    "documentId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    sha text NOT NULL
);

CREATE TABLE public."DocumentInstanceModificationData" (
    id bigint NOT NULL,
    "documentInstanceId" bigint NOT NULL,
    "modificationData" jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "pdfPlaceableCommentMigratedAt" timestamp(3) without time zone,
    "pdfHighlightMigratedAt" timestamp(3) without time zone
);

CREATE SEQUENCE public."DocumentInstanceModificationData_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."DocumentInstanceModificationData_id_seq" OWNED BY public."DocumentInstanceModificationData".id;

CREATE SEQUENCE public."DocumentInstance_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."DocumentInstance_id_seq" OWNED BY public."DocumentInstance".id;

CREATE TABLE public."DocumentPermission" (
    "documentId" text NOT NULL,
    "sharePermissionId" text NOT NULL
);

CREATE TABLE public."DocumentProcessResult" (
    id bigint NOT NULL,
    "documentId" text NOT NULL,
    "jobType" text NOT NULL,
    content text NOT NULL
);

CREATE SEQUENCE public."DocumentProcessResult_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."DocumentProcessResult_id_seq" OWNED BY public."DocumentProcessResult".id;

CREATE TABLE public."DocumentSummary" (
    id text DEFAULT gen_random_uuid() NOT NULL,
    summary text NOT NULL,
    document_id text NOT NULL,
    version_id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public."DocumentText" (
    id bigint NOT NULL,
    content text NOT NULL,
    "documentId" text NOT NULL,
    "tokenCount" bigint DEFAULT 0 NOT NULL
);

CREATE TABLE public."DocumentTextParts" (
    id text NOT NULL,
    reference text NOT NULL,
    "documentId" text NOT NULL
);

CREATE SEQUENCE public."DocumentText_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."DocumentText_id_seq" OWNED BY public."DocumentText".id;

CREATE TABLE public."DocumentView" (
    id bigint NOT NULL,
    document_id text NOT NULL,
    user_id text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE public."DocumentView_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."DocumentView_id_seq" OWNED BY public."DocumentView".id;

CREATE TABLE public."EmailInsightsBackfillBatch" (
    id text NOT NULL,
    "insightsBackfillJobId" text NOT NULL,
    "sqsMessageId" text,
    "threadIds" text[],
    "totalThreads" integer NOT NULL,
    status public.insights_backfill_batch_status DEFAULT 'Queued'::public.insights_backfill_batch_status NOT NULL,
    "insightsGeneratedCount" integer DEFAULT 0 NOT NULL,
    "insightIds" text[],
    "errorMessage" text,
    "queuedAt" timestamp(3) without time zone,
    "startedAt" timestamp(3) without time zone,
    "completedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public."EmailInsightsBackfillJob" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "threadsProcessedCount" integer DEFAULT 0 NOT NULL,
    "insightsGeneratedCount" integer DEFAULT 0 NOT NULL,
    status public.insights_backfill_job_status DEFAULT 'Init'::public.insights_backfill_job_status NOT NULL,
    "completedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public."EmailThreadPermission" (
    "threadId" text NOT NULL,
    "sharePermissionId" text NOT NULL,
    "userId" text NOT NULL,
    "projectId" text
);

CREATE TABLE public."EnterpriseEmailContacts" (
    id integer NOT NULL,
    "organizationId" integer NOT NULL,
    "firstName" text NOT NULL,
    "lastName" text NOT NULL,
    email text NOT NULL
);

CREATE SEQUENCE public."EnterpriseEmailContacts_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."EnterpriseEmailContacts_id_seq" OWNED BY public."EnterpriseEmailContacts".id;

CREATE TABLE public."EnterpriseIManageTenants" (
    id integer NOT NULL,
    "organizationId" integer NOT NULL,
    tenant_uri text NOT NULL,
    nickname text NOT NULL
);

CREATE SEQUENCE public."EnterpriseIManageTenants_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."EnterpriseIManageTenants_id_seq" OWNED BY public."EnterpriseIManageTenants".id;

CREATE TABLE public."EnterpriseRules" (
    id integer NOT NULL,
    "organizationId" integer NOT NULL,
    "autoSetAsDefaultApp" boolean DEFAULT false NOT NULL,
    "disableAutoUpdate" boolean DEFAULT false NOT NULL,
    "setAsDefault" public."SetAsDefault" DEFAULT 'ASK'::public."SetAsDefault" NOT NULL,
    "setAsDefaultDocx" public."SetAsDefault" DEFAULT 'ASK'::public."SetAsDefault" NOT NULL
);

CREATE SEQUENCE public."EnterpriseRules_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."EnterpriseRules_id_seq" OWNED BY public."EnterpriseRules".id;

CREATE TABLE public."Experiment" (
    id text NOT NULL,
    active boolean DEFAULT false NOT NULL,
    started_at timestamp(3) without time zone,
    ended_at timestamp(3) without time zone
);

CREATE TABLE public."ExperimentLog" (
    experiment_id text NOT NULL,
    user_id text NOT NULL,
    "group" character varying(1) NOT NULL,
    completed boolean DEFAULT false NOT NULL
);

CREATE TABLE public."InsightContext" (
    id text DEFAULT gen_random_uuid() NOT NULL,
    "providerSource" text NOT NULL,
    "userId" text NOT NULL,
    "resourceId" text NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    consumed boolean DEFAULT false NOT NULL
);

CREATE TABLE public."InstructionsDocuments" (
    "documentId" text NOT NULL,
    "userId" text NOT NULL
);

CREATE TABLE public."ItemLastAccessed" (
    item_id text NOT NULL,
    item_type text NOT NULL,
    last_accessed timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public."JobToDocumentProcessResult" (
    "jobId" text NOT NULL,
    "documentProcessResultId" bigint NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public."MacroPrompt" (
    id text DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    prompt text NOT NULL,
    icon text NOT NULL,
    color text NOT NULL,
    required_docs integer,
    user_id text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public."MacroPromptAttachment" (
    id text DEFAULT gen_random_uuid() NOT NULL,
    attachment_type text NOT NULL,
    attachment_id text NOT NULL,
    macro_prompt_id text NOT NULL
);

CREATE TABLE public."MacroPromptPermission" (
    macro_prompt_id text NOT NULL,
    share_permission_id text NOT NULL
);

CREATE TABLE public."Organization" (
    id integer NOT NULL,
    name text NOT NULL,
    "emailToolDomain" text,
    "stripeCustomerId" text,
    status public."OrganizationStatus" DEFAULT 'PILOT'::public."OrganizationStatus" NOT NULL,
    seats integer,
    "allowListOnly" boolean,
    "llmProviders" text,
    "netDocumentsEnabled" boolean DEFAULT false NOT NULL
);

CREATE TABLE public."OrganizationBilling" (
    id integer NOT NULL,
    "organizationId" integer NOT NULL,
    email text NOT NULL
);

CREATE SEQUENCE public."OrganizationBilling_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."OrganizationBilling_id_seq" OWNED BY public."OrganizationBilling".id;

CREATE TABLE public."OrganizationDefaultSharePermission" (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    is_public boolean DEFAULT false NOT NULL,
    public_access_level text,
    organization_access_enabled boolean DEFAULT false NOT NULL,
    organization_access_level text
);

CREATE SEQUENCE public."OrganizationDefaultSharePermission_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."OrganizationDefaultSharePermission_id_seq" OWNED BY public."OrganizationDefaultSharePermission".id;

CREATE TABLE public."OrganizationEmailMatches" (
    email character varying(100) NOT NULL,
    "organizationId" integer NOT NULL
);

CREATE TABLE public."OrganizationIT" (
    email text NOT NULL,
    "organizationId" integer NOT NULL
);

CREATE TABLE public."OrganizationInvitation" (
    id bigint NOT NULL,
    email text NOT NULL,
    organization_id integer NOT NULL
);

CREATE SEQUENCE public."OrganizationInvitation_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."OrganizationInvitation_id_seq" OWNED BY public."OrganizationInvitation".id;

CREATE TABLE public."OrganizationItJob" (
    id integer NOT NULL,
    "taskArn" text,
    "taskType" public."OrganizationItJobType" NOT NULL,
    "organizationId" integer NOT NULL
);

CREATE SEQUENCE public."OrganizationItJob_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."OrganizationItJob_id_seq" OWNED BY public."OrganizationItJob".id;

CREATE TABLE public."OrganizationRetentionPolicy" (
    id bigint NOT NULL,
    organization_id integer NOT NULL,
    retention_days integer
);

CREATE SEQUENCE public."OrganizationRetentionPolicy_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."OrganizationRetentionPolicy_id_seq" OWNED BY public."OrganizationRetentionPolicy".id;

CREATE SEQUENCE public."Organization_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."Organization_id_seq" OWNED BY public."Organization".id;

CREATE TABLE public."PdfHighlightAnchor" (
    uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    "documentId" text NOT NULL,
    owner text NOT NULL,
    page integer NOT NULL,
    red integer NOT NULL,
    green integer NOT NULL,
    blue integer NOT NULL,
    alpha double precision NOT NULL,
    type integer NOT NULL,
    text text NOT NULL,
    "pageViewportWidth" double precision NOT NULL,
    "pageViewportHeight" double precision NOT NULL,
    "threadId" bigint,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "deletedAt" timestamp(3) without time zone
);

CREATE TABLE public."PdfHighlightRect" (
    id bigint NOT NULL,
    top double precision NOT NULL,
    "left" double precision NOT NULL,
    width double precision NOT NULL,
    height double precision NOT NULL,
    "pdfHighlightAnchorId" uuid NOT NULL
);

CREATE SEQUENCE public."PdfHighlightRect_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."PdfHighlightRect_id_seq" OWNED BY public."PdfHighlightRect".id;

CREATE TABLE public."PdfPlaceableCommentAnchor" (
    uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    "documentId" text NOT NULL,
    owner text NOT NULL,
    "allowableEdits" jsonb,
    page integer NOT NULL,
    "wasEdited" boolean NOT NULL,
    "wasDeleted" boolean NOT NULL,
    "shouldLockOnSave" boolean NOT NULL,
    "originalPage" integer NOT NULL,
    "originalIndex" integer NOT NULL,
    "xPct" double precision NOT NULL,
    "yPct" double precision NOT NULL,
    "widthPct" double precision NOT NULL,
    "heightPct" double precision NOT NULL,
    rotation double precision NOT NULL,
    "threadId" bigint NOT NULL
);

CREATE TABLE public."Permission" (
    id text NOT NULL,
    description text NOT NULL
);

CREATE TABLE public."Pin" (
    "userId" text NOT NULL,
    "pinnedItemId" text NOT NULL,
    "pinnedItemType" text NOT NULL,
    "pinIndex" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public."Project" (
    id text DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    "userId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "parentId" text,
    "deletedAt" timestamp(3) without time zone,
    "uploadPending" boolean DEFAULT false NOT NULL,
    "uploadRequestId" text
);

CREATE TABLE public."ProjectPermission" (
    "projectId" text NOT NULL,
    "sharePermissionId" text NOT NULL
);

CREATE TABLE public."Role" (
    id text NOT NULL,
    description text NOT NULL
);

CREATE TABLE public."RolesOnOrganizations" (
    "organizationId" integer NOT NULL,
    "roleId" text NOT NULL
);

CREATE TABLE public."RolesOnPermissions" (
    "permissionId" text NOT NULL,
    "roleId" text NOT NULL
);

CREATE TABLE public."RolesOnUsers" (
    "userId" text NOT NULL,
    "roleId" text NOT NULL
);

CREATE TABLE public."SharePermission" (
    id text DEFAULT gen_random_uuid() NOT NULL,
    "isPublic" boolean NOT NULL,
    "publicAccessLevel" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public."Thread" (
    id bigint NOT NULL,
    owner text NOT NULL,
    "documentId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    metadata jsonb,
    resolved boolean DEFAULT false NOT NULL
);

CREATE TABLE public."ThreadAnchor" (
    "threadId" bigint NOT NULL,
    "anchorId" uuid NOT NULL,
    "anchorTableName" public.anchor_table_name NOT NULL
);

CREATE SEQUENCE public."Thread_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."Thread_id_seq" OWNED BY public."Thread".id;

CREATE TABLE public."UploadJob" (
    id bigint NOT NULL,
    "jobId" text NOT NULL,
    "jobType" text NOT NULL,
    "documentId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE public."UploadJob_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."UploadJob_id_seq" OWNED BY public."UploadJob".id;

CREATE TABLE public."User" (
    id text NOT NULL,
    email text NOT NULL,
    name text,
    "group" character varying(1),
    "hasChromeExt" boolean DEFAULT false NOT NULL,
    "organizationId" integer,
    "stripeCustomerId" text,
    "tutorialComplete" boolean DEFAULT false NOT NULL,
    "hasOnboardingDocuments" boolean DEFAULT false NOT NULL,
    industry character varying(255),
    title character varying(20),
    "firstName" character varying(100),
    "lastName" character varying(100),
    "profilePicture" text,
    "profilePictureHash" character varying(40),
    macro_user_id uuid NOT NULL,
    "aiDataConsent" boolean DEFAULT false NOT NULL
);

CREATE TABLE public."UserApiKey" (
    key text NOT NULL,
    user_id text NOT NULL
);

CREATE TABLE public."UserDocumentViewLocation" (
    user_id text NOT NULL,
    document_id text NOT NULL,
    location text NOT NULL,
    updated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public."UserHistory" (
    "userId" text NOT NULL,
    "itemId" text NOT NULL,
    "itemType" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public."UserInsightBatch" (
    id text DEFAULT gen_random_uuid() NOT NULL,
    "userId" text NOT NULL,
    "insightIds" text[],
    "totalChars" integer NOT NULL,
    "estimatedTokens" integer NOT NULL,
    "rankingContext" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    version integer DEFAULT 1 NOT NULL
);

CREATE TABLE public."UserInsights" (
    id text DEFAULT gen_random_uuid() NOT NULL,
    content text NOT NULL,
    source text NOT NULL,
    "sourceLocation" jsonb,
    generated boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "spanStart" timestamp(3) without time zone,
    "spanEnd" timestamp(3) without time zone,
    confidence integer,
    "insightType" text,
    "relevanceKeywords" text[],
    "userId" text NOT NULL
);

CREATE TABLE public."UserItemAccess" (
    id uuid NOT NULL,
    user_id text NOT NULL,
    item_id text NOT NULL,
    item_type text NOT NULL,
    granted_from_channel_id uuid,
    access_level public."AccessLevel" NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    granted_from_team_id uuid
);

CREATE TABLE public."WebAnnotations" (
    id text DEFAULT gen_random_uuid() NOT NULL,
    "messageId" text,
    url text NOT NULL,
    title text NOT NULL,
    publish_date timestamp(3) without time zone,
    description text,
    favicon_url text,
    image_url text,
    "chatId" text
);

CREATE TABLE public."WebsocketConnectionPermissions" (
    "connectionId" text NOT NULL,
    "userId" text,
    permissions jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public._sqlx_migrations (
    version bigint NOT NULL,
    description text NOT NULL,
    installed_on timestamp with time zone DEFAULT now() NOT NULL,
    success boolean NOT NULL,
    checksum bytea NOT NULL,
    execution_time bigint NOT NULL
);

CREATE TABLE public.account_merge_request (
    id uuid NOT NULL,
    code text NOT NULL,
    macro_user_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    to_merge_macro_user_id uuid NOT NULL
);

CREATE TABLE public.active_streams (
    entity_id text NOT NULL,
    stream_key text NOT NULL
);

CREATE TABLE public.call_participants (
    call_id uuid NOT NULL,
    user_id text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    left_at timestamp with time zone
);

CREATE TABLE public.call_record_participants (
    call_record_id uuid NOT NULL,
    user_id text NOT NULL,
    joined_at timestamp with time zone NOT NULL,
    left_at timestamp with time zone
);

CREATE TABLE public.call_record_transcripts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    call_record_id uuid NOT NULL,
    segment_id text,
    speaker_id text NOT NULL,
    content text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    sequence_num integer NOT NULL
);

CREATE TABLE public.call_records (
    id uuid NOT NULL,
    channel_id uuid NOT NULL,
    room_name text NOT NULL,
    created_by text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone DEFAULT now() NOT NULL,
    duration_ms bigint NOT NULL,
    recording_url text,
    egress_id text,
    share_permission_id text NOT NULL
);

CREATE TABLE public.call_transcripts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    call_id uuid NOT NULL,
    segment_id text NOT NULL,
    speaker_id text NOT NULL,
    content text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    sequence_num integer NOT NULL
);

CREATE TABLE public.calls (
    id uuid NOT NULL,
    channel_id uuid NOT NULL,
    room_name text NOT NULL,
    created_by text NOT NULL,
    egress_id text,
    recording_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    share_permission_id text NOT NULL
);

CREATE TABLE public.channel_notification_email_sent (
    channel_id uuid NOT NULL,
    user_id text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.comms_activity (
    id uuid NOT NULL,
    user_id text NOT NULL,
    channel_id uuid NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    viewed_at timestamp without time zone,
    interacted_at timestamp without time zone
);

CREATE TABLE public.comms_attachments (
    id uuid NOT NULL,
    message_id uuid NOT NULL,
    entity_type character varying(32) NOT NULL,
    entity_id character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    channel_id uuid NOT NULL,
    width integer,
    height integer
);

CREATE TABLE public.comms_channel_participants (
    channel_id uuid NOT NULL,
    role public.comms_participant_role NOT NULL,
    user_id text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    left_at timestamp with time zone
);

CREATE TABLE public.comms_channels (
    id uuid NOT NULL,
    name character varying(255),
    channel_type public.comms_channel_type NOT NULL,
    org_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_id text NOT NULL,
    team_id uuid,
    CONSTRAINT valid_channel_name CHECK ((((channel_type = 'direct_message'::public.comms_channel_type) AND (name IS NULL)) OR ((channel_type = ANY (ARRAY['public'::public.comms_channel_type, 'organization'::public.comms_channel_type, 'team'::public.comms_channel_type])) AND (name IS NOT NULL)) OR (channel_type = 'private'::public.comms_channel_type))),
    CONSTRAINT valid_org_channel CHECK ((((channel_type = 'organization'::public.comms_channel_type) AND (org_id IS NOT NULL)) OR ((channel_type <> 'organization'::public.comms_channel_type) AND (org_id IS NULL)))),
    CONSTRAINT valid_team_channel CHECK ((((channel_type = 'team'::public.comms_channel_type) AND (team_id IS NOT NULL)) OR ((channel_type <> 'team'::public.comms_channel_type) AND (team_id IS NULL))))
);

CREATE TABLE public.comms_entity_mentions (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    entity_type character varying(32) NOT NULL,
    entity_id character varying NOT NULL,
    source_entity_type character varying(32) NOT NULL,
    source_entity_id character varying NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying
);

CREATE TABLE public.comms_messages (
    id uuid NOT NULL,
    channel_id uuid NOT NULL,
    thread_id uuid,
    sender_id text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    edited_at timestamp without time zone,
    deleted_at timestamp without time zone
);

CREATE TABLE public.comms_reactions (
    message_id uuid NOT NULL,
    emoji character varying(32) NOT NULL,
    user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.contacts_connections (
    id integer NOT NULL,
    user1 text NOT NULL,
    user2 text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contacts_connections_check CHECK ((user1 <= (user2 COLLATE "C")))
);

CREATE SEQUENCE public.contacts_connections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.contacts_connections_id_seq OWNED BY public.contacts_connections.id;

CREATE TABLE public.document_email (
    document_id text NOT NULL,
    email_attachment_id uuid NOT NULL
);

CREATE TABLE public.document_sub_type (
    document_id text NOT NULL,
    sub_type public.document_sub_type_value NOT NULL
);

CREATE TABLE public.email_attachments (
    id uuid NOT NULL,
    message_id uuid NOT NULL,
    provider_attachment_id text,
    filename character varying(512),
    mime_type character varying(255),
    size_bytes bigint,
    content_id character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    upload_claimed_at timestamp with time zone
);

CREATE TABLE public.email_attachments_drafts (
    id uuid NOT NULL,
    draft_id uuid NOT NULL,
    file_name text NOT NULL,
    content_type text NOT NULL,
    sha text NOT NULL,
    size integer NOT NULL,
    s3_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_attachments_fwd (
    message_id uuid NOT NULL,
    attachment_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_attachments_sfs (
    id uuid NOT NULL,
    attachment_id uuid,
    sfs_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_backfill_jobs (
    id uuid NOT NULL,
    link_id uuid,
    threads_requested_limit integer,
    total_threads integer DEFAULT 0 NOT NULL,
    status public.email_backfill_job_status DEFAULT 'Init'::public.email_backfill_job_status NOT NULL,
    threads_retrieved_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    fusionauth_user_id text NOT NULL
);

CREATE TABLE public.email_contact_search_index (
    link_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    message_id uuid NOT NULL,
    contact_name text,
    contact_email text NOT NULL,
    contact_type text NOT NULL
);

CREATE TABLE public.email_contacts (
    id uuid NOT NULL,
    link_id uuid NOT NULL,
    email_address character varying(320) NOT NULL,
    name character varying(255),
    original_photo_url text,
    sfs_photo_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_filters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    link_id uuid NOT NULL,
    email_address character varying(320),
    email_domain character varying(255),
    is_important boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_filters_address_xor_domain_chk CHECK ((((email_address IS NOT NULL) AND (TRIM(BOTH FROM email_address) <> ''::text)) <> ((email_domain IS NOT NULL) AND (TRIM(BOTH FROM email_domain) <> ''::text)))),
    CONSTRAINT email_filters_email_domain_format_chk CHECK (((email_domain IS NULL) OR ((TRIM(BOTH FROM email_domain) <> ''::text) AND (POSITION(('@'::text) IN (email_domain)) = 0))))
);

CREATE TABLE public.email_gmail_histories (
    link_id uuid NOT NULL,
    history_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_labels (
    id uuid NOT NULL,
    link_id uuid NOT NULL,
    provider_label_id text NOT NULL,
    name character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    message_list_visibility public.email_message_list_visibility_enum DEFAULT 'Show'::public.email_message_list_visibility_enum NOT NULL,
    label_list_visibility public.email_label_list_visibility_enum DEFAULT 'LabelShow'::public.email_label_list_visibility_enum NOT NULL,
    type public.email_label_type_enum DEFAULT 'User'::public.email_label_type_enum NOT NULL
);

CREATE TABLE public.email_links (
    id uuid NOT NULL,
    macro_id text NOT NULL,
    fusionauth_user_id text NOT NULL,
    email_address character varying(320) NOT NULL,
    provider public.email_user_provider_enum NOT NULL,
    is_sync_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_message_labels (
    message_id uuid NOT NULL,
    label_id uuid NOT NULL
);

CREATE TABLE public.email_message_recipients (
    message_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    recipient_type public.email_recipient_type NOT NULL,
    name character varying(255)
)
WITH (autovacuum_vacuum_cost_delay='10', autovacuum_vacuum_cost_limit='200', autovacuum_vacuum_scale_factor='0.02', autovacuum_vacuum_threshold='5000', autovacuum_analyze_scale_factor='0.01', autovacuum_analyze_threshold='5000');

CREATE TABLE public.email_messages (
    id uuid NOT NULL,
    provider_id text,
    thread_id uuid NOT NULL,
    provider_thread_id text,
    link_id uuid NOT NULL,
    provider_history_id text,
    internal_date_ts timestamp with time zone,
    snippet text,
    size_estimate bigint,
    subject text,
    from_contact_id uuid,
    sent_at timestamp with time zone,
    has_attachments boolean DEFAULT false NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    is_starred boolean DEFAULT false NOT NULL,
    is_sent boolean DEFAULT false NOT NULL,
    is_draft boolean DEFAULT false NOT NULL,
    body_text text,
    body_html_sanitized text,
    body_macro text,
    headers_jsonb jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    global_id text,
    replying_to_id uuid,
    from_name character varying(255)
);

CREATE TABLE public.email_scheduled_messages (
    link_id uuid NOT NULL,
    message_id uuid NOT NULL,
    send_time timestamp with time zone NOT NULL,
    sent boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    processing boolean DEFAULT false NOT NULL
);

CREATE TABLE public.email_settings (
    link_id uuid NOT NULL,
    signature_on_replies_forwards boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_sfs_mappings (
    source text NOT NULL,
    destination text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_sync_tokens (
    link_id uuid NOT NULL,
    contacts_sync_token character varying(255),
    other_contacts_sync_token character varying(255)
);

CREATE TABLE public.email_threads (
    id uuid NOT NULL,
    provider_id text,
    link_id uuid NOT NULL,
    inbox_visible boolean DEFAULT false NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    latest_inbound_message_ts timestamp with time zone,
    latest_outbound_message_ts timestamp with time zone,
    latest_non_spam_message_ts timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    project_id text
);

CREATE TABLE public.email_user_history (
    link_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.entity_access (
    id bigint NOT NULL,
    entity_id uuid NOT NULL,
    entity_type text NOT NULL,
    source_id text NOT NULL,
    source_type public.entity_access_source_type NOT NULL,
    access_level public."AccessLevel" NOT NULL,
    granted_from_project_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.entity_access_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.entity_access_id_seq OWNED BY public.entity_access.id;

CREATE TABLE public.entity_properties (
    id uuid NOT NULL,
    entity_id text NOT NULL,
    entity_type public.property_entity_type NOT NULL,
    property_definition_id uuid NOT NULL,
    "values" jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT check_values_structure CHECK ((("values" IS NULL) OR ((("values" ->> 'type'::text) = ANY (ARRAY['Boolean'::text, 'Number'::text, 'String'::text, 'Date'::text])) AND (jsonb_typeof(("values" -> 'value'::text)) <> 'array'::text)) OR ((("values" ->> 'type'::text) = ANY (ARRAY['SelectOption'::text, 'EntityReference'::text, 'Link'::text])) AND (jsonb_typeof(("values" -> 'value'::text)) = 'array'::text))))
);

CREATE TABLE public.excluded_default_view (
    id uuid NOT NULL,
    user_id text NOT NULL,
    default_view_id text NOT NULL
);

CREATE TABLE public.frecency_aggregates (
    id bigint NOT NULL,
    entity_id text NOT NULL,
    entity_type text NOT NULL,
    user_id text NOT NULL,
    event_count integer DEFAULT 0 NOT NULL,
    frecency_score double precision DEFAULT 0.0 NOT NULL,
    first_event timestamp with time zone NOT NULL,
    recent_events jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE SEQUENCE public.frecency_aggregates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.frecency_aggregates_id_seq OWNED BY public.frecency_aggregates.id;

CREATE TABLE public.frecency_events (
    id bigint NOT NULL,
    user_id text NOT NULL,
    entity_type text NOT NULL,
    event_type text NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    connection_id text NOT NULL,
    entity_id text NOT NULL,
    was_processed boolean DEFAULT false NOT NULL
);

CREATE SEQUENCE public.frecency_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.frecency_events_id_seq OWNED BY public.frecency_events.id;

CREATE TABLE public.github_app_installation_team (
    id text NOT NULL,
    team_id uuid NOT NULL,
    installed_by text NOT NULL
);

CREATE TABLE public.github_links (
    id uuid NOT NULL,
    macro_id text NOT NULL,
    fusionauth_user_id uuid NOT NULL,
    github_username character varying(255) NOT NULL,
    github_user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.github_pr_tasks (
    id uuid NOT NULL,
    github_key text NOT NULL,
    task_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.id_mapping (
    source_id text NOT NULL,
    target_id text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.in_progress_email_link (
    id uuid NOT NULL,
    email text NOT NULL,
    macro_user_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.in_progress_user_link (
    id uuid NOT NULL,
    macro_user_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.macro_user (
    id uuid NOT NULL,
    username text NOT NULL,
    email text NOT NULL,
    stripe_customer_id text NOT NULL,
    has_trialed boolean DEFAULT true NOT NULL
);

CREATE TABLE public.macro_user_email_verification (
    macro_user_id uuid NOT NULL,
    email text NOT NULL,
    is_verified boolean DEFAULT false NOT NULL
);

CREATE TABLE public.macro_user_info (
    macro_user_id uuid NOT NULL,
    industry text,
    title text,
    first_name text,
    last_name text,
    profile_picture text,
    profile_picture_hash character varying(40)
);

CREATE TABLE public.memory (
    id uuid NOT NULL,
    user_id text NOT NULL,
    memory text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.notification (
    id uuid NOT NULL,
    notification_event_type character varying(255) NOT NULL,
    event_item_id text NOT NULL,
    event_item_type text NOT NULL,
    service_sender text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    sender_id text,
    apns_collapse_key text
);

CREATE TABLE public.notification_email_sent (
    user_id text NOT NULL,
    sent_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.notification_email_unsubscribe (
    email text NOT NULL
);

CREATE TABLE public.notification_email_unsubscribe_code (
    email text NOT NULL,
    code uuid NOT NULL
);

CREATE TABLE public.notification_message_receipt (
    message_id text NOT NULL,
    user_id text NOT NULL,
    notification_id uuid NOT NULL,
    failed boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    failed_at timestamp without time zone
);

CREATE TABLE public.notification_user_device_registration (
    id uuid NOT NULL,
    user_id text NOT NULL,
    device_token text NOT NULL,
    device_endpoint text NOT NULL,
    device_type public.notification_device_type_option NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_used_at timestamp without time zone
);

CREATE TABLE public.property_definitions (
    id uuid NOT NULL,
    organization_id integer,
    user_id text,
    display_name text NOT NULL,
    data_type public.property_data_type NOT NULL,
    is_multi_select boolean NOT NULL,
    specific_entity_type public.property_entity_type,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    CONSTRAINT owned_by_org_or_user_or_system CHECK (((is_system = true) OR (organization_id IS NOT NULL) OR (user_id IS NOT NULL)))
);

CREATE TABLE public.property_options (
    id uuid NOT NULL,
    property_definition_id uuid NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    number_value double precision,
    string_value text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT check_option_value_set CHECK ((((number_value IS NOT NULL) AND (string_value IS NULL)) OR ((number_value IS NULL) AND (string_value IS NOT NULL))))
);

CREATE TABLE public.referral_tracking (
    id uuid NOT NULL,
    referrer_id uuid NOT NULL,
    referred_id uuid NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT referral_tracking_no_self_referral CHECK ((referrer_id <> referred_id))
);

CREATE TABLE public.saved_view (
    id uuid NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    config jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.team (
    id uuid NOT NULL,
    name text NOT NULL,
    owner_id text NOT NULL,
    subscription_id text,
    seat_count integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.team_invite (
    id uuid NOT NULL,
    email text NOT NULL,
    team_id uuid NOT NULL,
    team_role public.team_role DEFAULT 'member'::public.team_role NOT NULL,
    invited_by text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_sent_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tier public.team_user_tier DEFAULT 'haiku'::public.team_user_tier NOT NULL
);

CREATE TABLE public.team_user (
    user_id text NOT NULL,
    team_id uuid NOT NULL,
    team_role public.team_role NOT NULL,
    tier public.team_user_tier DEFAULT 'haiku'::public.team_user_tier NOT NULL
);

CREATE TABLE public.user_mute_notification (
    user_id text NOT NULL
);

CREATE TABLE public.user_notification (
    user_id text NOT NULL,
    notification_id uuid NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    sent boolean DEFAULT false NOT NULL,
    seen_at timestamp without time zone,
    deleted_at timestamp without time zone,
    done boolean DEFAULT false NOT NULL,
    is_important_v0 boolean DEFAULT false NOT NULL
);

CREATE TABLE public.user_notification_item_unsubscribe (
    user_id text NOT NULL,
    item_id text NOT NULL,
    item_type text NOT NULL
);

CREATE TABLE public.user_notification_type_preference (
    user_id text NOT NULL,
    notification_event_type character varying(255) NOT NULL
);

ALTER TABLE ONLY public."Comment" ALTER COLUMN id SET DEFAULT nextval('public."Comment_id_seq"'::regclass);

ALTER TABLE ONLY public."DocumentBom" ALTER COLUMN id SET DEFAULT nextval('public."DocumentBom_id_seq"'::regclass);

ALTER TABLE ONLY public."DocumentFamily" ALTER COLUMN id SET DEFAULT nextval('public."DocumentFamily_id_seq"'::regclass);

ALTER TABLE ONLY public."DocumentInstance" ALTER COLUMN id SET DEFAULT nextval('public."DocumentInstance_id_seq"'::regclass);

ALTER TABLE ONLY public."DocumentInstanceModificationData" ALTER COLUMN id SET DEFAULT nextval('public."DocumentInstanceModificationData_id_seq"'::regclass);

ALTER TABLE ONLY public."DocumentProcessResult" ALTER COLUMN id SET DEFAULT nextval('public."DocumentProcessResult_id_seq"'::regclass);

ALTER TABLE ONLY public."DocumentText" ALTER COLUMN id SET DEFAULT nextval('public."DocumentText_id_seq"'::regclass);

ALTER TABLE ONLY public."DocumentView" ALTER COLUMN id SET DEFAULT nextval('public."DocumentView_id_seq"'::regclass);

ALTER TABLE ONLY public."EnterpriseEmailContacts" ALTER COLUMN id SET DEFAULT nextval('public."EnterpriseEmailContacts_id_seq"'::regclass);

ALTER TABLE ONLY public."EnterpriseIManageTenants" ALTER COLUMN id SET DEFAULT nextval('public."EnterpriseIManageTenants_id_seq"'::regclass);

ALTER TABLE ONLY public."EnterpriseRules" ALTER COLUMN id SET DEFAULT nextval('public."EnterpriseRules_id_seq"'::regclass);

ALTER TABLE ONLY public."Organization" ALTER COLUMN id SET DEFAULT nextval('public."Organization_id_seq"'::regclass);

ALTER TABLE ONLY public."OrganizationBilling" ALTER COLUMN id SET DEFAULT nextval('public."OrganizationBilling_id_seq"'::regclass);

ALTER TABLE ONLY public."OrganizationDefaultSharePermission" ALTER COLUMN id SET DEFAULT nextval('public."OrganizationDefaultSharePermission_id_seq"'::regclass);

ALTER TABLE ONLY public."OrganizationInvitation" ALTER COLUMN id SET DEFAULT nextval('public."OrganizationInvitation_id_seq"'::regclass);

ALTER TABLE ONLY public."OrganizationItJob" ALTER COLUMN id SET DEFAULT nextval('public."OrganizationItJob_id_seq"'::regclass);

ALTER TABLE ONLY public."OrganizationRetentionPolicy" ALTER COLUMN id SET DEFAULT nextval('public."OrganizationRetentionPolicy_id_seq"'::regclass);

ALTER TABLE ONLY public."PdfHighlightRect" ALTER COLUMN id SET DEFAULT nextval('public."PdfHighlightRect_id_seq"'::regclass);

ALTER TABLE ONLY public."Thread" ALTER COLUMN id SET DEFAULT nextval('public."Thread_id_seq"'::regclass);

ALTER TABLE ONLY public."UploadJob" ALTER COLUMN id SET DEFAULT nextval('public."UploadJob_id_seq"'::regclass);

ALTER TABLE ONLY public.contacts_connections ALTER COLUMN id SET DEFAULT nextval('public.contacts_connections_id_seq'::regclass);

ALTER TABLE ONLY public.entity_access ALTER COLUMN id SET DEFAULT nextval('public.entity_access_id_seq'::regclass);

ALTER TABLE ONLY public.frecency_aggregates ALTER COLUMN id SET DEFAULT nextval('public.frecency_aggregates_id_seq'::regclass);

ALTER TABLE ONLY public.frecency_events ALTER COLUMN id SET DEFAULT nextval('public.frecency_events_id_seq'::regclass);

ALTER TABLE ONLY _sqlx_test.databases
    ADD CONSTRAINT databases_pkey PRIMARY KEY (db_name);

ALTER TABLE ONLY public."Artifact"
    ADD CONSTRAINT "Artifact_pkey" PRIMARY KEY ("messageId", digest);

ALTER TABLE ONLY public."BlockedEmail"
    ADD CONSTRAINT "BlockedEmail_pkey" PRIMARY KEY (email);

ALTER TABLE ONLY public."BomPart"
    ADD CONSTRAINT "BomPart_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."ChannelSharePermission"
    ADD CONSTRAINT "ChannelSharePermission_pkey" PRIMARY KEY (channel_id, share_permission_id);

ALTER TABLE ONLY public."ChatAttachment"
    ADD CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."ChatMessage"
    ADD CONSTRAINT "ChatMessage_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."ChatPermission"
    ADD CONSTRAINT "ChatPermission_pkey" PRIMARY KEY ("chatId");

ALTER TABLE ONLY public."Chat"
    ADD CONSTRAINT "Chat_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."Comment"
    ADD CONSTRAINT "Comment_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."DocumentBom"
    ADD CONSTRAINT "DocumentBom_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."DocumentFamily"
    ADD CONSTRAINT "DocumentFamily_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."DocumentInstanceModificationData"
    ADD CONSTRAINT "DocumentInstanceModificationData_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."DocumentInstance"
    ADD CONSTRAINT "DocumentInstance_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."DocumentPermission"
    ADD CONSTRAINT "DocumentPermission_pkey" PRIMARY KEY ("documentId");

ALTER TABLE ONLY public."DocumentProcessResult"
    ADD CONSTRAINT "DocumentProcessResult_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."DocumentSummary"
    ADD CONSTRAINT "DocumentSummary_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."DocumentTextParts"
    ADD CONSTRAINT "DocumentTextParts_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."DocumentText"
    ADD CONSTRAINT "DocumentText_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."DocumentView"
    ADD CONSTRAINT "DocumentView_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."Document"
    ADD CONSTRAINT "Document_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."EmailInsightsBackfillBatch"
    ADD CONSTRAINT "EmailInsightsBackfillBatch_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."EmailInsightsBackfillJob"
    ADD CONSTRAINT "EmailInsightsBackfillJob_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."EmailThreadPermission"
    ADD CONSTRAINT "EmailThreadPermission_pkey" PRIMARY KEY ("threadId");

ALTER TABLE ONLY public."EnterpriseEmailContacts"
    ADD CONSTRAINT "EnterpriseEmailContacts_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."EnterpriseIManageTenants"
    ADD CONSTRAINT "EnterpriseIManageTenants_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."EnterpriseRules"
    ADD CONSTRAINT "EnterpriseRules_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."ExperimentLog"
    ADD CONSTRAINT "ExperimentLog_pkey" PRIMARY KEY (user_id, experiment_id);

ALTER TABLE ONLY public."Experiment"
    ADD CONSTRAINT "Experiment_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."InsightContext"
    ADD CONSTRAINT "InsightContext_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."InstructionsDocuments"
    ADD CONSTRAINT "InstructionsDocuments_pkey" PRIMARY KEY ("documentId");

ALTER TABLE ONLY public."ItemLastAccessed"
    ADD CONSTRAINT "ItemLastAccessed_pkey" PRIMARY KEY (item_id, item_type);

ALTER TABLE ONLY public."JobToDocumentProcessResult"
    ADD CONSTRAINT "JobToDocumentProcessResult_pkey" PRIMARY KEY ("jobId", "documentProcessResultId");

ALTER TABLE ONLY public."MacroPromptAttachment"
    ADD CONSTRAINT "MacroPromptAttachment_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."MacroPromptPermission"
    ADD CONSTRAINT "MacroPromptPermission_pkey" PRIMARY KEY (macro_prompt_id);

ALTER TABLE ONLY public."MacroPrompt"
    ADD CONSTRAINT "MacroPrompt_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."OrganizationBilling"
    ADD CONSTRAINT "OrganizationBilling_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."OrganizationDefaultSharePermission"
    ADD CONSTRAINT "OrganizationDefaultSharePermission_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."OrganizationEmailMatches"
    ADD CONSTRAINT "OrganizationEmailMatches_pkey" PRIMARY KEY (email);

ALTER TABLE ONLY public."OrganizationInvitation"
    ADD CONSTRAINT "OrganizationInvitation_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."OrganizationItJob"
    ADD CONSTRAINT "OrganizationItJob_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."OrganizationRetentionPolicy"
    ADD CONSTRAINT "OrganizationRetentionPolicy_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."Organization"
    ADD CONSTRAINT "Organization_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."PdfHighlightAnchor"
    ADD CONSTRAINT "PdfHighlightAnchor_pkey" PRIMARY KEY (uuid);

ALTER TABLE ONLY public."PdfHighlightRect"
    ADD CONSTRAINT "PdfHighlightRect_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."PdfPlaceableCommentAnchor"
    ADD CONSTRAINT "PdfPlaceableCommentAnchor_pkey" PRIMARY KEY (uuid);

ALTER TABLE ONLY public."Permission"
    ADD CONSTRAINT "Permission_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."Pin"
    ADD CONSTRAINT "Pin_pkey" PRIMARY KEY ("userId", "pinnedItemId", "pinnedItemType");

ALTER TABLE ONLY public."ProjectPermission"
    ADD CONSTRAINT "ProjectPermission_pkey" PRIMARY KEY ("projectId");

ALTER TABLE ONLY public."Project"
    ADD CONSTRAINT "Project_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."Role"
    ADD CONSTRAINT "Role_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."RolesOnOrganizations"
    ADD CONSTRAINT "RolesOnOrganizations_pkey" PRIMARY KEY ("organizationId", "roleId");

ALTER TABLE ONLY public."RolesOnPermissions"
    ADD CONSTRAINT "RolesOnPermissions_pkey" PRIMARY KEY ("permissionId", "roleId");

ALTER TABLE ONLY public."RolesOnUsers"
    ADD CONSTRAINT "RolesOnUsers_pkey" PRIMARY KEY ("userId", "roleId");

ALTER TABLE ONLY public."SharePermission"
    ADD CONSTRAINT "SharePermission_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."Thread"
    ADD CONSTRAINT "Thread_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."UploadJob"
    ADD CONSTRAINT "UploadJob_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."UserApiKey"
    ADD CONSTRAINT "UserApiKey_pkey" PRIMARY KEY (user_id, key);

ALTER TABLE ONLY public."UserDocumentViewLocation"
    ADD CONSTRAINT "UserDocumentViewLocation_pkey" PRIMARY KEY (user_id, document_id);

ALTER TABLE ONLY public."UserHistory"
    ADD CONSTRAINT "UserHistory_pkey" PRIMARY KEY ("userId", "itemId", "itemType");

ALTER TABLE ONLY public."UserInsightBatch"
    ADD CONSTRAINT "UserInsightBatch_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."UserInsights"
    ADD CONSTRAINT "UserInsights_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."UserItemAccess"
    ADD CONSTRAINT "UserItemAccess_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."WebAnnotations"
    ADD CONSTRAINT "WebAnnotations_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."WebsocketConnectionPermissions"
    ADD CONSTRAINT "WebsocketConnectionPermissions_pkey" PRIMARY KEY ("connectionId");

ALTER TABLE ONLY public._sqlx_migrations
    ADD CONSTRAINT _sqlx_migrations_pkey PRIMARY KEY (version);

ALTER TABLE ONLY public.account_merge_request
    ADD CONSTRAINT account_merge_request_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.active_streams
    ADD CONSTRAINT active_streams_pkey PRIMARY KEY (entity_id, stream_key);

ALTER TABLE ONLY public.call_participants
    ADD CONSTRAINT call_participants_pkey PRIMARY KEY (call_id, user_id);

ALTER TABLE ONLY public.call_record_participants
    ADD CONSTRAINT call_record_participants_pkey PRIMARY KEY (call_record_id, user_id);

ALTER TABLE ONLY public.call_record_transcripts
    ADD CONSTRAINT call_record_transcripts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.call_records
    ADD CONSTRAINT call_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.call_transcripts
    ADD CONSTRAINT call_transcripts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.call_transcripts
    ADD CONSTRAINT call_transcripts_segment_unique UNIQUE (call_id, segment_id);

ALTER TABLE ONLY public.calls
    ADD CONSTRAINT calls_one_per_channel UNIQUE (channel_id);

ALTER TABLE ONLY public.calls
    ADD CONSTRAINT calls_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.channel_notification_email_sent
    ADD CONSTRAINT channel_notification_email_sent_pkey PRIMARY KEY (channel_id, user_id);

ALTER TABLE ONLY public.comms_activity
    ADD CONSTRAINT comms_activity_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.comms_attachments
    ADD CONSTRAINT comms_attachments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.comms_channel_participants
    ADD CONSTRAINT comms_channel_participants_pkey PRIMARY KEY (channel_id, user_id);

ALTER TABLE ONLY public.comms_channels
    ADD CONSTRAINT comms_channels_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.comms_entity_mentions
    ADD CONSTRAINT comms_entity_mentions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.comms_messages
    ADD CONSTRAINT comms_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.comms_reactions
    ADD CONSTRAINT comms_reactions_pkey PRIMARY KEY (message_id, emoji, user_id);

ALTER TABLE ONLY public.comms_activity
    ADD CONSTRAINT comms_unique_user_channel UNIQUE (user_id, channel_id);

ALTER TABLE ONLY public.contacts_connections
    ADD CONSTRAINT contacts_connections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.contacts_connections
    ADD CONSTRAINT contacts_connections_user1_user2_key UNIQUE (user1, user2);

ALTER TABLE ONLY public.document_email
    ADD CONSTRAINT document_email_pkey PRIMARY KEY (document_id, email_attachment_id);

ALTER TABLE ONLY public.document_sub_type
    ADD CONSTRAINT document_sub_type_pkey PRIMARY KEY (document_id);

ALTER TABLE ONLY public.email_contact_search_index
    ADD CONSTRAINT ecsi_unique UNIQUE (message_id, contact_email, contact_type);

ALTER TABLE ONLY public.email_attachments_drafts
    ADD CONSTRAINT email_attachments_drafts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_attachments_drafts
    ADD CONSTRAINT email_attachments_drafts_s3_key_key UNIQUE (s3_key);

ALTER TABLE ONLY public.email_attachments_fwd
    ADD CONSTRAINT email_attachments_fwd_message_id_attachment_id_key UNIQUE (message_id, attachment_id);

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_attachments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_attachments_sfs
    ADD CONSTRAINT email_attachments_sfs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_backfill_jobs
    ADD CONSTRAINT email_backfill_job_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_contacts
    ADD CONSTRAINT email_contacts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_filters
    ADD CONSTRAINT email_filters_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_gmail_histories
    ADD CONSTRAINT email_gmail_histories_pkey PRIMARY KEY (link_id);

ALTER TABLE ONLY public.email_labels
    ADD CONSTRAINT email_labels_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_links
    ADD CONSTRAINT email_links_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_message_labels
    ADD CONSTRAINT email_message_labels_pkey PRIMARY KEY (message_id, label_id);

ALTER TABLE ONLY public.email_message_recipients
    ADD CONSTRAINT email_message_recipients_pkey PRIMARY KEY (message_id, contact_id, recipient_type);

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_scheduled_messages
    ADD CONSTRAINT email_scheduled_messages_pkey PRIMARY KEY (link_id, message_id);

ALTER TABLE ONLY public.email_settings
    ADD CONSTRAINT email_settings_pkey PRIMARY KEY (link_id);

ALTER TABLE ONLY public.email_sfs_mappings
    ADD CONSTRAINT email_sfs_mappings_pkey PRIMARY KEY (source);

ALTER TABLE ONLY public.email_sync_tokens
    ADD CONSTRAINT email_sync_tokens_pkey PRIMARY KEY (link_id);

ALTER TABLE ONLY public.email_threads
    ADD CONSTRAINT email_threads_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_uq_attachments_message_id_provider_attachment_id UNIQUE (message_id, provider_attachment_id);

ALTER TABLE ONLY public.email_labels
    ADD CONSTRAINT email_uq_labels_link_id_provider_label_id UNIQUE (link_id, provider_label_id);

ALTER TABLE ONLY public.email_links
    ADD CONSTRAINT email_uq_links_user_email_provider UNIQUE (fusionauth_user_id, email_address, provider);

ALTER TABLE ONLY public.email_user_history
    ADD CONSTRAINT email_user_history_pkey PRIMARY KEY (link_id, thread_id);

ALTER TABLE ONLY public.entity_access
    ADD CONSTRAINT entity_access_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.entity_properties
    ADD CONSTRAINT entity_properties_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.excluded_default_view
    ADD CONSTRAINT excluded_default_view_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.frecency_aggregates
    ADD CONSTRAINT frecency_aggregates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.frecency_events
    ADD CONSTRAINT frecency_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.github_app_installation_team
    ADD CONSTRAINT github_app_installation_team_pkey PRIMARY KEY (id, team_id);

ALTER TABLE ONLY public.github_links
    ADD CONSTRAINT github_links_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.github_pr_tasks
    ADD CONSTRAINT github_pr_tasks_github_key_task_id_unique UNIQUE (github_key, task_id);

ALTER TABLE ONLY public.github_pr_tasks
    ADD CONSTRAINT github_pr_tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.id_mapping
    ADD CONSTRAINT id_mapping_pkey PRIMARY KEY (source_id);

ALTER TABLE ONLY public.in_progress_email_link
    ADD CONSTRAINT in_progress_email_link_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.in_progress_user_link
    ADD CONSTRAINT in_progress_user_link_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.macro_user_email_verification
    ADD CONSTRAINT macro_user_email_verification_pkey PRIMARY KEY (macro_user_id, email);

ALTER TABLE ONLY public.macro_user_info
    ADD CONSTRAINT macro_user_info_pkey PRIMARY KEY (macro_user_id);

ALTER TABLE ONLY public.macro_user
    ADD CONSTRAINT macro_user_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.memory
    ADD CONSTRAINT memory_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.memory
    ADD CONSTRAINT memory_user_id_unique UNIQUE (user_id);

ALTER TABLE ONLY public.notification_email_sent
    ADD CONSTRAINT notification_email_sent_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.notification_email_unsubscribe_code
    ADD CONSTRAINT notification_email_unsubscribe_code_code_key UNIQUE (code);

ALTER TABLE ONLY public.notification_email_unsubscribe_code
    ADD CONSTRAINT notification_email_unsubscribe_code_pkey PRIMARY KEY (email);

ALTER TABLE ONLY public.notification_email_unsubscribe
    ADD CONSTRAINT notification_email_unsubscribe_pkey PRIMARY KEY (email);

ALTER TABLE ONLY public.notification_message_receipt
    ADD CONSTRAINT notification_message_receipt_pkey PRIMARY KEY (message_id);

ALTER TABLE ONLY public.notification
    ADD CONSTRAINT notification_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.notification_user_device_registration
    ADD CONSTRAINT notification_user_device_registration_device_endpoint_key UNIQUE (device_endpoint);

ALTER TABLE ONLY public.notification_user_device_registration
    ADD CONSTRAINT notification_user_device_registration_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.property_definitions
    ADD CONSTRAINT property_definitions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.property_options
    ADD CONSTRAINT property_options_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.referral_tracking
    ADD CONSTRAINT referral_tracking_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.saved_view
    ADD CONSTRAINT saved_view_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.team_invite
    ADD CONSTRAINT team_invite_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.team
    ADD CONSTRAINT team_owner_id_unique UNIQUE (owner_id);

ALTER TABLE ONLY public.team
    ADD CONSTRAINT team_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.team_user
    ADD CONSTRAINT team_user_pkey PRIMARY KEY (user_id, team_id);

ALTER TABLE ONLY public.team_user
    ADD CONSTRAINT team_user_user_id_unique UNIQUE (user_id);

ALTER TABLE ONLY public.entity_properties
    ADD CONSTRAINT unique_entity_properties_assignment UNIQUE (entity_id, entity_type, property_definition_id);

ALTER TABLE ONLY public.property_definitions
    ADD CONSTRAINT unique_property_definitions_org_display_name UNIQUE (organization_id, display_name);

ALTER TABLE ONLY public.property_definitions
    ADD CONSTRAINT unique_property_definitions_user_display_name UNIQUE (user_id, display_name);

ALTER TABLE ONLY public.property_options
    ADD CONSTRAINT unique_property_options_number_value UNIQUE (property_definition_id, number_value);

ALTER TABLE ONLY public.property_options
    ADD CONSTRAINT unique_property_options_string_value UNIQUE (property_definition_id, string_value);

ALTER TABLE ONLY public.frecency_aggregates
    ADD CONSTRAINT unique_user_entity UNIQUE (user_id, entity_type, entity_id);

ALTER TABLE ONLY public.user_mute_notification
    ADD CONSTRAINT user_mute_notification_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.user_notification_item_unsubscribe
    ADD CONSTRAINT user_notification_item_unsubscribe_pkey PRIMARY KEY (user_id, item_id);

ALTER TABLE ONLY public.user_notification
    ADD CONSTRAINT user_notification_pkey PRIMARY KEY (user_id, notification_id);

ALTER TABLE ONLY public.user_notification_type_preference
    ADD CONSTRAINT user_notification_type_preference_pkey PRIMARY KEY (user_id, notification_event_type);

CREATE INDEX databases_created_at ON _sqlx_test.databases USING btree (created_at);

CREATE INDEX "Artifact_digest_idx" ON public."Artifact" USING btree (digest);

CREATE INDEX "Artifact_documentId_idx" ON public."Artifact" USING btree ("documentId");

CREATE INDEX "Artifact_userId_idx" ON public."Artifact" USING btree ("userId");

CREATE INDEX "BomPart_documentBomId_idx" ON public."BomPart" USING btree ("documentBomId");

CREATE INDEX "BomPart_sha_idx" ON public."BomPart" USING btree (sha);

CREATE INDEX "ChannelSharePermission_channel_id_idx" ON public."ChannelSharePermission" USING btree (channel_id);

CREATE INDEX "ChannelSharePermission_share_permission_id_idx" ON public."ChannelSharePermission" USING btree (share_permission_id);

CREATE INDEX "ChatAttachment_attachmentType_attachmentId_idx" ON public."ChatAttachment" USING btree ("attachmentType", "attachmentId");

CREATE INDEX "ChatAttachment_chatId_idx" ON public."ChatAttachment" USING btree ("chatId");

CREATE INDEX "ChatAttachment_messageId_idx" ON public."ChatAttachment" USING btree ("messageId");

CREATE INDEX "ChatMessage_chatId_idx" ON public."ChatMessage" USING btree ("chatId");

CREATE UNIQUE INDEX "ChatPermission_chatId_key" ON public."ChatPermission" USING btree ("chatId");

CREATE UNIQUE INDEX "ChatPermission_sharePermissionId_key" ON public."ChatPermission" USING btree ("sharePermissionId");

CREATE INDEX "Chat_projectId_idx" ON public."Chat" USING btree ("projectId");

CREATE INDEX "Chat_userId_idx" ON public."Chat" USING btree ("userId");

CREATE INDEX "Comment_owner_idx" ON public."Comment" USING btree (owner);

CREATE INDEX "Comment_threadId_createdAt_idx" ON public."Comment" USING btree ("threadId", "createdAt");

CREATE INDEX "Comment_threadId_idx" ON public."Comment" USING btree ("threadId");

CREATE INDEX "DocumentBom_documentId_idx" ON public."DocumentBom" USING btree ("documentId");

CREATE INDEX "DocumentFamily_rootDocumentId_idx" ON public."DocumentFamily" USING btree ("rootDocumentId");

CREATE INDEX "DocumentInstanceModificationData_documentInstanceId_idx" ON public."DocumentInstanceModificationData" USING btree ("documentInstanceId");

CREATE INDEX "DocumentInstance_documentId_idx" ON public."DocumentInstance" USING btree ("documentId");

CREATE UNIQUE INDEX "DocumentPermission_documentId_key" ON public."DocumentPermission" USING btree ("documentId");

CREATE UNIQUE INDEX "DocumentPermission_sharePermissionId_key" ON public."DocumentPermission" USING btree ("sharePermissionId");

CREATE INDEX "DocumentProcessResult_documentId_idx" ON public."DocumentProcessResult" USING btree ("documentId");

CREATE UNIQUE INDEX "DocumentProcessResult_documentId_jobType_key" ON public."DocumentProcessResult" USING btree ("documentId", "jobType");

CREATE INDEX "DocumentSummary_document_id_idx" ON public."DocumentSummary" USING btree (document_id);

CREATE INDEX "DocumentTextParts_documentId_idx" ON public."DocumentTextParts" USING btree ("documentId");

CREATE INDEX "DocumentText_documentId_idx" ON public."DocumentText" USING btree ("documentId");

CREATE UNIQUE INDEX "DocumentText_documentId_key" ON public."DocumentText" USING btree ("documentId");

CREATE INDEX "DocumentView_document_id_idx" ON public."DocumentView" USING btree (document_id);

CREATE INDEX "DocumentView_user_id_idx" ON public."DocumentView" USING btree (user_id);

CREATE INDEX "Document_branchedFromId_idx" ON public."Document" USING btree ("branchedFromId");

CREATE INDEX "Document_documentFamilyId_idx" ON public."Document" USING btree ("documentFamilyId");

CREATE INDEX "Document_owner_deletedAt_idx" ON public."Document" USING btree (owner, "deletedAt");

CREATE INDEX "Document_owner_fileType_idx" ON public."Document" USING btree (owner, "fileType");

CREATE INDEX "Document_owner_idx" ON public."Document" USING btree (owner);

CREATE INDEX "Document_projectId_idx" ON public."Document" USING btree ("projectId");

CREATE UNIQUE INDEX "EmailThreadPermission_sharePermissionId_key" ON public."EmailThreadPermission" USING btree ("sharePermissionId");

CREATE UNIQUE INDEX "EmailThreadPermission_threadId_key" ON public."EmailThreadPermission" USING btree ("threadId");

CREATE UNIQUE INDEX "EnterpriseRules_organizationId_key" ON public."EnterpriseRules" USING btree ("organizationId");

CREATE INDEX "ExperimentLog_experiment_id_idx" ON public."ExperimentLog" USING btree (experiment_id);

CREATE INDEX "ExperimentLog_user_id_idx" ON public."ExperimentLog" USING btree (user_id);

CREATE UNIQUE INDEX "Experiment_id_key" ON public."Experiment" USING btree (id);

CREATE INDEX "InstructionsDocuments_userId_idx" ON public."InstructionsDocuments" USING btree ("userId");

CREATE UNIQUE INDEX "InstructionsDocuments_userId_key" ON public."InstructionsDocuments" USING btree ("userId");

CREATE INDEX "ItemLastAccessed_item_id_idx" ON public."ItemLastAccessed" USING btree (item_id);

CREATE INDEX "ItemLastAccessed_item_type_idx" ON public."ItemLastAccessed" USING btree (item_type);

CREATE INDEX "JobToDocumentProcessResult_documentProcessResultId_idx" ON public."JobToDocumentProcessResult" USING btree ("documentProcessResultId");

CREATE INDEX "JobToDocumentProcessResult_jobId_idx" ON public."JobToDocumentProcessResult" USING btree ("jobId");

CREATE UNIQUE INDEX "JobToDocumentProcessResult_jobId_key" ON public."JobToDocumentProcessResult" USING btree ("jobId");

CREATE INDEX "MacroPromptAttachment_attachment_type_attachment_id_idx" ON public."MacroPromptAttachment" USING btree (attachment_type, attachment_id);

CREATE INDEX "MacroPromptAttachment_macro_prompt_id_idx" ON public."MacroPromptAttachment" USING btree (macro_prompt_id);

CREATE UNIQUE INDEX "MacroPromptPermission_macro_prompt_id_key" ON public."MacroPromptPermission" USING btree (macro_prompt_id);

CREATE UNIQUE INDEX "MacroPromptPermission_share_permission_id_key" ON public."MacroPromptPermission" USING btree (share_permission_id);

CREATE INDEX "MacroPrompt_user_id_idx" ON public."MacroPrompt" USING btree (user_id);

CREATE UNIQUE INDEX "OrganizationBilling_email_key" ON public."OrganizationBilling" USING btree (email);

CREATE INDEX "OrganizationDefaultSharePermission_organization_id_idx" ON public."OrganizationDefaultSharePermission" USING btree (organization_id);

CREATE UNIQUE INDEX "OrganizationDefaultSharePermission_organization_id_key" ON public."OrganizationDefaultSharePermission" USING btree (organization_id);

CREATE INDEX "OrganizationEmailMatches_organizationId_idx" ON public."OrganizationEmailMatches" USING btree ("organizationId");

CREATE UNIQUE INDEX "OrganizationIT_email_key" ON public."OrganizationIT" USING btree (email);

CREATE INDEX "OrganizationInvitation_email_idx" ON public."OrganizationInvitation" USING btree (email);

CREATE UNIQUE INDEX "OrganizationInvitation_organization_id_email_key" ON public."OrganizationInvitation" USING btree (organization_id, email);

CREATE INDEX "OrganizationInvitation_organization_id_idx" ON public."OrganizationInvitation" USING btree (organization_id);

CREATE UNIQUE INDEX "OrganizationItJob_organizationId_key" ON public."OrganizationItJob" USING btree ("organizationId");

CREATE INDEX "OrganizationRetentionPolicy_organization_id_idx" ON public."OrganizationRetentionPolicy" USING btree (organization_id);

CREATE UNIQUE INDEX "OrganizationRetentionPolicy_organization_id_key" ON public."OrganizationRetentionPolicy" USING btree (organization_id);

CREATE UNIQUE INDEX "Organization_name_key" ON public."Organization" USING btree (name);

CREATE UNIQUE INDEX "Organization_stripeCustomerId_key" ON public."Organization" USING btree ("stripeCustomerId");

CREATE INDEX "PdfHighlightAnchor_documentId_idx" ON public."PdfHighlightAnchor" USING btree ("documentId");

CREATE INDEX "PdfHighlightAnchor_owner_idx" ON public."PdfHighlightAnchor" USING btree (owner);

CREATE INDEX "PdfHighlightAnchor_threadId_idx" ON public."PdfHighlightAnchor" USING btree ("threadId");

CREATE INDEX "PdfHighlightRect_pdfHighlightAnchorId_idx" ON public."PdfHighlightRect" USING btree ("pdfHighlightAnchorId");

CREATE INDEX "PdfPlaceableCommentAnchor_documentId_idx" ON public."PdfPlaceableCommentAnchor" USING btree ("documentId");

CREATE INDEX "PdfPlaceableCommentAnchor_owner_idx" ON public."PdfPlaceableCommentAnchor" USING btree (owner);

CREATE INDEX "PdfPlaceableCommentAnchor_threadId_idx" ON public."PdfPlaceableCommentAnchor" USING btree ("threadId");

CREATE INDEX "Pin_pinnedItemId_idx" ON public."Pin" USING btree ("pinnedItemId");

CREATE INDEX "Pin_userId_idx" ON public."Pin" USING btree ("userId");

CREATE UNIQUE INDEX "ProjectPermission_projectId_key" ON public."ProjectPermission" USING btree ("projectId");

CREATE UNIQUE INDEX "ProjectPermission_sharePermissionId_key" ON public."ProjectPermission" USING btree ("sharePermissionId");

CREATE INDEX "Project_parentId_idx" ON public."Project" USING btree ("parentId");

CREATE INDEX "Project_uploadPending_idx" ON public."Project" USING btree ("uploadPending");

CREATE INDEX "Project_userId_idx" ON public."Project" USING btree ("userId");

CREATE UNIQUE INDEX "ThreadAnchor_anchorId_key" ON public."ThreadAnchor" USING btree ("anchorId");

CREATE UNIQUE INDEX "ThreadAnchor_threadId_key" ON public."ThreadAnchor" USING btree ("threadId");

CREATE INDEX "Thread_documentId_idx" ON public."Thread" USING btree ("documentId");

CREATE INDEX "Thread_owner_idx" ON public."Thread" USING btree (owner);

CREATE INDEX "UploadJob_documentId_idx" ON public."UploadJob" USING btree ("documentId");

CREATE INDEX "UploadJob_jobId_idx" ON public."UploadJob" USING btree ("jobId");

CREATE INDEX "UserApiKey_key_idx" ON public."UserApiKey" USING btree (key);

CREATE UNIQUE INDEX "UserApiKey_key_key" ON public."UserApiKey" USING btree (key);

CREATE INDEX "UserApiKey_user_id_idx" ON public."UserApiKey" USING btree (user_id);

CREATE INDEX "UserDocumentViewLocation_document_id_idx" ON public."UserDocumentViewLocation" USING btree (document_id);

CREATE INDEX "UserDocumentViewLocation_user_id_idx" ON public."UserDocumentViewLocation" USING btree (user_id);

CREATE INDEX "UserHistory_itemId_itemType_idx" ON public."UserHistory" USING btree ("itemId", "itemType");

CREATE INDEX "UserHistory_userId_idx" ON public."UserHistory" USING btree ("userId");

CREATE INDEX "UserHistory_userId_itemType_idx" ON public."UserHistory" USING btree ("userId", "itemType");

CREATE INDEX "UserInsightBatch_expiresAt_idx" ON public."UserInsightBatch" USING btree ("expiresAt");

CREATE INDEX "UserInsightBatch_userId_idx" ON public."UserInsightBatch" USING btree ("userId");

CREATE UNIQUE INDEX "UserInsightBatch_userId_key" ON public."UserInsightBatch" USING btree ("userId");

CREATE INDEX "UserInsights_userId_idx" ON public."UserInsights" USING btree ("userId");

CREATE INDEX "UserItemAccess_granted_from_channel_id_idx" ON public."UserItemAccess" USING btree (granted_from_channel_id);

CREATE INDEX "UserItemAccess_granted_from_team_id_idx" ON public."UserItemAccess" USING btree (granted_from_team_id);

CREATE INDEX "UserItemAccess_item_id_idx" ON public."UserItemAccess" USING btree (item_id);

CREATE INDEX "UserItemAccess_user_id_idx" ON public."UserItemAccess" USING btree (user_id);

CREATE UNIQUE INDEX "UserItemAccess_user_id_item_id_item_type_granted_from_chann_key" ON public."UserItemAccess" USING btree (user_id, item_id, item_type, granted_from_channel_id);

CREATE UNIQUE INDEX "UserItemAccess_user_id_item_id_item_type_granted_from_team_key" ON public."UserItemAccess" USING btree (user_id, item_id, item_type, granted_from_team_id);

CREATE INDEX "User_email_idx" ON public."User" USING btree (email);

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);

CREATE UNIQUE INDEX "User_id_key" ON public."User" USING btree (id);

CREATE INDEX "User_organizationId_idx" ON public."User" USING btree ("organizationId");

CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON public."User" USING btree ("stripeCustomerId");

CREATE INDEX "WebAnnotations_chatId_idx" ON public."WebAnnotations" USING btree ("chatId");

CREATE INDEX "WebAnnotations_messageId_idx" ON public."WebAnnotations" USING btree ("messageId");

CREATE UNIQUE INDEX "WebsocketConnectionPermissions_connectionId_key" ON public."WebsocketConnectionPermissions" USING btree ("connectionId");

CREATE INDEX account_merge_request_code_idx ON public.account_merge_request USING btree (code);

CREATE INDEX account_merge_request_macro_user_id_idx ON public.account_merge_request USING btree (macro_user_id);

CREATE INDEX account_merge_request_to_merge_macro_user_id_idx ON public.account_merge_request USING btree (to_merge_macro_user_id);

CREATE UNIQUE INDEX account_merge_request_to_merge_macro_user_id_key ON public.account_merge_request USING btree (to_merge_macro_user_id);

CREATE UNIQUE INDEX contacts_link_id_email_address_idx ON public.email_contacts USING btree (link_id, email_address);

CREATE UNIQUE INDEX email_filters_link_id_email_address_uq ON public.email_filters USING btree (link_id, lower((email_address)::text)) WHERE (email_address IS NOT NULL);

CREATE UNIQUE INDEX email_filters_link_id_email_domain_uq ON public.email_filters USING btree (link_id, lower((email_domain)::text)) WHERE (email_domain IS NOT NULL);

CREATE UNIQUE INDEX email_links_macro_id_uq ON public.email_links USING btree (macro_id);

CREATE INDEX entity_access_entity_id_entity_type_idx ON public.entity_access USING btree (entity_id, entity_type);

CREATE INDEX entity_access_granted_from_project_id_idx ON public.entity_access USING btree (granted_from_project_id);

CREATE INDEX entity_access_source_id_idx ON public.entity_access USING btree (source_id);

CREATE UNIQUE INDEX entity_access_unique_with_project ON public.entity_access USING btree (entity_id, entity_type, source_id, source_type, granted_from_project_id) WHERE (granted_from_project_id IS NOT NULL);

CREATE UNIQUE INDEX entity_access_unique_without_project ON public.entity_access USING btree (entity_id, entity_type, source_id, source_type) WHERE (granted_from_project_id IS NULL);

CREATE INDEX github_app_installation_team_team_id_idx ON public.github_app_installation_team USING btree (team_id);

CREATE INDEX id_mapping_target_id_idx ON public.id_mapping USING btree (target_id);

CREATE INDEX idx_call_record_transcripts_call_record_id ON public.call_record_transcripts USING btree (call_record_id);

CREATE INDEX idx_call_records_channel_id ON public.call_records USING btree (channel_id);

CREATE INDEX idx_call_records_egress_id ON public.call_records USING btree (egress_id);

CREATE INDEX idx_call_transcripts_call_id ON public.call_transcripts USING btree (call_id);

CREATE INDEX idx_calls_channel_id ON public.calls USING btree (channel_id);

CREATE INDEX idx_calls_room_name ON public.calls USING btree (room_name);

CREATE INDEX idx_channel_notification_email_sent_channel ON public.channel_notification_email_sent USING btree (channel_id);

CREATE INDEX idx_channel_notification_email_sent_user ON public.channel_notification_email_sent USING btree (user_id);

CREATE INDEX idx_chat_name_trgm ON public."Chat" USING gin (name public.gin_trgm_ops);

CREATE INDEX idx_comms_activity_channel_id_user_id ON public.comms_activity USING btree (user_id, channel_id);

CREATE INDEX idx_comms_activity_channel_user ON public.comms_activity USING btree (channel_id, user_id);

CREATE INDEX idx_comms_activity_user_times ON public.comms_activity USING btree (user_id, updated_at, created_at);

CREATE INDEX idx_comms_attachments_channel_created ON public.comms_attachments USING btree (channel_id, created_at);

CREATE INDEX idx_comms_attachments_channel_cursor ON public.comms_attachments USING btree (channel_id, created_at DESC, id DESC);

CREATE INDEX idx_comms_attachments_channel_id ON public.comms_attachments USING btree (channel_id);

CREATE INDEX idx_comms_attachments_entity_created ON public.comms_attachments USING btree (entity_type, entity_id, created_at DESC) INCLUDE (channel_id, message_id);

CREATE INDEX idx_comms_attachments_message_id ON public.comms_attachments USING btree (message_id);

CREATE INDEX idx_comms_channels_org_id ON public.comms_channels USING btree (org_id) WHERE (channel_type = 'organization'::public.comms_channel_type);

CREATE INDEX idx_comms_channels_team_id ON public.comms_channels USING btree (team_id) WHERE (team_id IS NOT NULL);

CREATE INDEX idx_comms_cp_active_by_channel_user ON public.comms_channel_participants USING btree (channel_id, user_id) WHERE (left_at IS NULL);

CREATE INDEX idx_comms_entity_mentions_combination ON public.comms_entity_mentions USING btree (source_entity_type, source_entity_id, entity_type, entity_id);

CREATE INDEX idx_comms_entity_mentions_created_at ON public.comms_entity_mentions USING btree (created_at DESC);

CREATE INDEX idx_comms_entity_mentions_entity_type_id ON public.comms_entity_mentions USING btree (entity_type, entity_id) INCLUDE (source_entity_type, source_entity_id);

CREATE INDEX idx_comms_entity_mentions_source ON public.comms_entity_mentions USING btree (source_entity_type, source_entity_id);

CREATE INDEX idx_comms_entity_mentions_user_id ON public.comms_entity_mentions USING btree (user_id) WHERE (user_id IS NOT NULL);

CREATE INDEX idx_comms_messages_active ON public.comms_messages USING btree (id) WHERE (deleted_at IS NULL);

CREATE INDEX idx_comms_messages_channel_created_at_active ON public.comms_messages USING btree (channel_id, created_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX idx_comms_messages_channel_id ON public.comms_messages USING btree (channel_id);

CREATE INDEX idx_comms_messages_channel_timeline ON public.comms_messages USING btree (channel_id, created_at);

CREATE INDEX idx_comms_messages_channel_toplevel_cursor ON public.comms_messages USING btree (channel_id, created_at DESC, id DESC) WHERE (thread_id IS NULL);

CREATE INDEX idx_comms_messages_created_at_active ON public.comms_messages USING btree (created_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX idx_comms_messages_sender_id ON public.comms_messages USING btree (sender_id);

CREATE INDEX idx_comms_messages_thread_active_created ON public.comms_messages USING btree (thread_id, created_at DESC) WHERE ((thread_id IS NOT NULL) AND (deleted_at IS NULL));

CREATE INDEX idx_comms_messages_thread_id ON public.comms_messages USING btree (thread_id) WHERE (thread_id IS NOT NULL);

CREATE INDEX idx_comms_reactions_message_id ON public.comms_reactions USING btree (message_id);

CREATE INDEX idx_contacts_connections_user1 ON public.contacts_connections USING btree (user1);

CREATE INDEX idx_contacts_connections_user2 ON public.contacts_connections USING btree (user2);

CREATE INDEX idx_document_email_attachment_id ON public.document_email USING btree (email_attachment_id);

CREATE INDEX idx_document_id_covering ON public."Document" USING btree (id) INCLUDE ("updatedAt", "deletedAt");

CREATE INDEX idx_document_name_trgm ON public."Document" USING gin (name public.gin_trgm_ops);

CREATE INDEX idx_ecsi_link_email_trgm ON public.email_contact_search_index USING gin (link_id, contact_email public.gin_trgm_ops);

CREATE INDEX idx_ecsi_link_name_trgm ON public.email_contact_search_index USING gin (link_id, contact_name public.gin_trgm_ops);

CREATE INDEX idx_ecsi_link_thread ON public.email_contact_search_index USING btree (link_id, thread_id);

CREATE INDEX idx_email_attachments_drafts_message_db_id ON public.email_attachments_drafts USING btree (draft_id);

CREATE INDEX idx_email_attachments_fwd_attachment_id ON public.email_attachments_fwd USING btree (attachment_id);

CREATE INDEX idx_email_attachments_message_id ON public.email_attachments USING btree (message_id);

CREATE INDEX idx_email_attachments_sfs_attachment_id ON public.email_attachments_sfs USING btree (attachment_id);

CREATE INDEX idx_email_contacts_email_address_trgm ON public.email_contacts USING gin (email_address public.gin_trgm_ops);

CREATE INDEX idx_email_contacts_link_id_name ON public.email_contacts USING btree (link_id, name) WHERE (name IS NOT NULL);

CREATE INDEX idx_email_contacts_name_trgm ON public.email_contacts USING gin (name public.gin_trgm_ops) WHERE (name IS NOT NULL);

CREATE INDEX idx_email_filters_link_id ON public.email_filters USING btree (link_id);

CREATE INDEX idx_email_labels_link_id ON public.email_labels USING btree (link_id);

CREATE INDEX idx_email_labels_link_id_for_trash_lookup ON public.email_labels USING btree (link_id) WHERE ((name)::text = 'TRASH'::text);

CREATE INDEX idx_email_labels_link_id_name ON public.email_labels USING btree (link_id, name);

CREATE INDEX idx_email_labels_name ON public.email_labels USING btree (name);

CREATE INDEX idx_email_links_active_provider_hash_bucket ON public.email_links USING btree (provider, ((abs(hashtext((id)::text)) % 24))) WHERE (is_sync_active = true);

CREATE INDEX idx_email_links_email_provider ON public.email_links USING btree (lower((email_address)::text), provider);

CREATE INDEX idx_email_links_fusionauth_user_active ON public.email_links USING btree (fusionauth_user_id, is_sync_active) WHERE (is_sync_active = true);

CREATE INDEX idx_email_links_macro_id ON public.email_links USING btree (macro_id);

CREATE INDEX idx_email_links_provider_active ON public.email_links USING btree (provider, is_sync_active) WHERE (is_sync_active = true);

CREATE INDEX idx_email_message_labels_by_label ON public.email_message_labels USING btree (label_id, message_id);

CREATE INDEX idx_email_message_recipients_contact_id ON public.email_message_recipients USING btree (contact_id);

CREATE INDEX idx_email_message_recipients_name_trgm ON public.email_message_recipients USING gin (name public.gin_trgm_ops) WHERE (name IS NOT NULL);

CREATE INDEX idx_email_messages_drafts_view ON public.email_messages USING btree (link_id, thread_id, internal_date_ts DESC) WHERE (is_draft = true);

CREATE INDEX idx_email_messages_from_contact_id ON public.email_messages USING btree (from_contact_id);

CREATE INDEX idx_email_messages_from_name_trgm ON public.email_messages USING gin (from_name public.gin_trgm_ops) WHERE (from_name IS NOT NULL);

CREATE INDEX idx_email_messages_link_id ON public.email_messages USING btree (link_id);

CREATE INDEX idx_email_messages_link_id_global_id ON public.email_messages USING btree (link_id, global_id);

CREATE INDEX idx_email_messages_link_id_replying_to_id ON public.email_messages USING btree (link_id, replying_to_id);

CREATE INDEX idx_email_messages_link_id_sent ON public.email_messages USING btree (link_id) WHERE (is_sent = true);

CREATE INDEX idx_email_messages_link_id_thread_id_date_asc ON public.email_messages USING btree (link_id, thread_id, internal_date_ts);

CREATE INDEX idx_email_messages_link_thread_date ON public.email_messages USING btree (link_id, thread_id, internal_date_ts DESC);

CREATE INDEX idx_email_messages_replying_to_id ON public.email_messages USING btree (replying_to_id) WHERE (replying_to_id IS NOT NULL);

CREATE INDEX idx_email_messages_sent_view ON public.email_messages USING btree (thread_id, internal_date_ts DESC) WHERE (is_sent = true);

CREATE INDEX idx_email_messages_subject_trgm ON public.email_messages USING gin (subject public.gin_trgm_ops);

CREATE INDEX idx_email_messages_thread_date_not_draft ON public.email_messages USING btree (thread_id, internal_date_ts DESC) WHERE (is_draft = false);

CREATE INDEX idx_email_messages_thread_id_internal_date_asc ON public.email_messages USING btree (thread_id, internal_date_ts);

CREATE INDEX idx_email_messages_thread_id_internal_date_ts ON public.email_messages USING btree (thread_id, internal_date_ts DESC);

CREATE INDEX idx_email_scheduled_messages_send_time_sent ON public.email_scheduled_messages USING btree (send_time, sent);

CREATE INDEX idx_email_sfs_mappings_destination ON public.email_sfs_mappings USING btree (destination);

CREATE INDEX idx_email_threads_inbox_view_not_null ON public.email_threads USING btree (link_id, latest_inbound_message_ts DESC) WHERE ((inbox_visible = true) AND (latest_inbound_message_ts IS NOT NULL));

CREATE INDEX idx_email_threads_link_id ON public.email_threads USING btree (link_id);

CREATE INDEX idx_email_threads_non_spam_ts_id ON public.email_threads USING btree (link_id, latest_non_spam_message_ts DESC, id DESC) WHERE (latest_non_spam_message_ts IS NOT NULL);

CREATE INDEX idx_email_threads_project_id ON public.email_threads USING btree (project_id);

CREATE INDEX idx_email_threads_sent_view ON public.email_threads USING btree (link_id, latest_outbound_message_ts DESC) WHERE (latest_outbound_message_ts IS NOT NULL);

CREATE INDEX idx_email_user_history_thread_id ON public.email_user_history USING btree (thread_id);

CREATE INDEX idx_entity_properties_entity_id ON public.entity_properties USING btree (entity_id, entity_type);

CREATE INDEX idx_entity_properties_property_definition_id ON public.entity_properties USING btree (property_definition_id);

CREATE INDEX idx_entity_properties_values_gin ON public.entity_properties USING gin ("values" jsonb_path_ops);

CREATE INDEX idx_frecency_aggregates_entity ON public.frecency_aggregates USING btree (user_id, entity_type, entity_id);

CREATE INDEX idx_frecency_aggregates_user_score ON public.frecency_aggregates USING btree (user_id, frecency_score DESC);

CREATE INDEX idx_frecency_events_unprocessed ON public.frecency_events USING btree (was_processed) WHERE (was_processed = false);

CREATE INDEX idx_frecency_events_user_id ON public.frecency_events USING btree (user_id);

CREATE INDEX idx_github_links_fusionauth_user_id ON public.github_links USING btree (fusionauth_user_id);

CREATE INDEX idx_github_links_github_username ON public.github_links USING btree (github_username);

CREATE INDEX idx_github_links_macro_id ON public.github_links USING btree (macro_id);

CREATE INDEX idx_github_pr_tasks_github_key ON public.github_pr_tasks USING btree (github_key);

CREATE INDEX idx_github_pr_tasks_task_id ON public.github_pr_tasks USING btree (task_id);

CREATE INDEX idx_notification_event ON public.notification USING btree (event_item_id);

CREATE INDEX idx_notification_event_item_type ON public.notification USING btree (event_item_type);

CREATE INDEX idx_notification_event_type_id ON public.notification USING btree (event_item_type, event_item_id);

CREATE INDEX idx_notification_message_receipt_user_notification ON public.notification_message_receipt USING btree (user_id, notification_id);

CREATE INDEX idx_notification_user_device_registration_device_token ON public.notification_user_device_registration USING btree (device_token);

CREATE INDEX idx_notification_user_device_registration_user ON public.notification_user_device_registration USING btree (user_id);

CREATE INDEX idx_project_name_trgm ON public."Project" USING gin (name public.gin_trgm_ops);

CREATE INDEX idx_property_definitions_organization_id ON public.property_definitions USING btree (organization_id) WHERE (organization_id IS NOT NULL);

CREATE INDEX idx_property_definitions_user_id ON public.property_definitions USING btree (user_id) WHERE (user_id IS NOT NULL);

CREATE INDEX idx_property_options_property_definition_id ON public.property_options USING btree (property_definition_id);

CREATE UNIQUE INDEX idx_referral_tracking_referred_id ON public.referral_tracking USING btree (referred_id);

CREATE INDEX idx_referral_tracking_referrer_id ON public.referral_tracking USING btree (referrer_id);

CREATE INDEX idx_user_notif_type_pref_user ON public.user_notification_type_preference USING btree (user_id);

CREATE INDEX idx_user_notification_active_filter ON public.user_notification USING btree (user_id, notification_id, done, seen_at) WHERE (deleted_at IS NULL);

CREATE INDEX idx_user_notification_item_unsubscribe_item_id ON public.user_notification_item_unsubscribe USING btree (item_id);

CREATE INDEX idx_user_notification_item_unsubscribe_user_id ON public.user_notification_item_unsubscribe USING btree (user_id);

CREATE INDEX idx_user_notification_notification ON public.user_notification USING btree (notification_id);

CREATE INDEX idx_user_notification_user ON public.user_notification USING btree (user_id);

CREATE INDEX idx_views_user_id ON public.saved_view USING btree (user_id);

CREATE UNIQUE INDEX in_progress_email_link_email_key ON public.in_progress_email_link USING btree (email);

CREATE INDEX in_progress_user_link_macro_user_id_idx ON public.in_progress_user_link USING btree (macro_user_id);

CREATE UNIQUE INDEX macro_user_email_key ON public.macro_user USING btree (email);

CREATE UNIQUE INDEX macro_user_email_verification_email_key ON public.macro_user_email_verification USING btree (email);

CREATE INDEX macro_user_email_verification_macro_user_id_idx ON public.macro_user_email_verification USING btree (macro_user_id);

CREATE UNIQUE INDEX macro_user_stripe_customer_id_key ON public.macro_user USING btree (stripe_customer_id);

CREATE UNIQUE INDEX macro_user_username_key ON public.macro_user USING btree (username);

CREATE UNIQUE INDEX notification_email_unsubscribe_code_code_idx ON public.notification_email_unsubscribe_code USING btree (code);

CREATE INDEX team_invite_email_idx ON public.team_invite USING btree (email);

CREATE UNIQUE INDEX team_invite_email_team_id_key ON public.team_invite USING btree (email, team_id);

CREATE INDEX team_invite_invited_by_idx ON public.team_invite USING btree (invited_by);

CREATE INDEX team_invite_team_id_idx ON public.team_invite USING btree (team_id);

CREATE INDEX team_owner_id_idx ON public.team USING btree (owner_id);

CREATE INDEX team_user_team_id_idx ON public.team_user USING btree (team_id);

CREATE INDEX team_user_user_id_idx ON public.team_user USING btree (user_id);

CREATE UNIQUE INDEX uq_github_links_github_user_id ON public.github_links USING btree (github_user_id);

CREATE UNIQUE INDEX uq_messages_link_id_provider_id ON public.email_messages USING btree (link_id, provider_id) WHERE (provider_id IS NOT NULL);

CREATE UNIQUE INDEX uq_threads_link_id_provider_id ON public.email_threads USING btree (link_id, provider_id) WHERE (provider_id IS NOT NULL);

CREATE TRIGGER check_orphaned_property_definition BEFORE UPDATE ON public.property_definitions FOR EACH ROW EXECUTE FUNCTION public.delete_orphaned_property_definition();

CREATE TRIGGER prevent_system_property_name_conflict BEFORE INSERT OR UPDATE ON public.property_definitions FOR EACH ROW EXECUTE FUNCTION public.check_property_name_not_system();

CREATE TRIGGER trg_delete_share_permission_call_record BEFORE DELETE ON public.call_records FOR EACH ROW EXECUTE FUNCTION public.delete_share_permission_on_call_record_delete();

CREATE TRIGGER trg_ecsi_contact_name_update AFTER UPDATE OF name ON public.email_contacts FOR EACH ROW WHEN (((old.name)::text IS DISTINCT FROM (new.name)::text)) EXECUTE FUNCTION public.ecsi_update_contact_name();

CREATE TRIGGER trg_ecsi_message_delete AFTER DELETE ON public.email_messages FOR EACH ROW EXECUTE FUNCTION public.ecsi_delete_message();

CREATE TRIGGER trg_ecsi_message_from AFTER INSERT OR UPDATE OF from_contact_id, from_name ON public.email_messages FOR EACH ROW EXECUTE FUNCTION public.ecsi_populate_from();

CREATE TRIGGER trg_ecsi_message_recipient AFTER INSERT ON public.email_message_recipients FOR EACH ROW EXECUTE FUNCTION public.ecsi_populate_recipient();

CREATE TRIGGER trg_ecsi_message_recipient_delete AFTER DELETE ON public.email_message_recipients FOR EACH ROW EXECUTE FUNCTION public.ecsi_delete_recipient();

ALTER TABLE ONLY public."Artifact"
    ADD CONSTRAINT "Artifact_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES public."Document"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public."Artifact"
    ADD CONSTRAINT "Artifact_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES public."ChatMessage"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."Artifact"
    ADD CONSTRAINT "Artifact_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."BomPart"
    ADD CONSTRAINT "BomPart_documentBomId_fkey" FOREIGN KEY ("documentBomId") REFERENCES public."DocumentBom"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."ChannelSharePermission"
    ADD CONSTRAINT "ChannelSharePermission_share_permission_id_fkey" FOREIGN KEY (share_permission_id) REFERENCES public."SharePermission"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."ChatAttachment"
    ADD CONSTRAINT "ChatAttachment_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES public."Chat"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."ChatAttachment"
    ADD CONSTRAINT "ChatAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES public."ChatMessage"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."ChatMessage"
    ADD CONSTRAINT "ChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES public."Chat"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."ChatPermission"
    ADD CONSTRAINT "ChatPermission_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES public."Chat"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."ChatPermission"
    ADD CONSTRAINT "ChatPermission_sharePermissionId_fkey" FOREIGN KEY ("sharePermissionId") REFERENCES public."SharePermission"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."Chat"
    ADD CONSTRAINT "Chat_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public."Chat"
    ADD CONSTRAINT "Chat_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."Comment"
    ADD CONSTRAINT "Comment_owner_fkey" FOREIGN KEY (owner) REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."Comment"
    ADD CONSTRAINT "Comment_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES public."Thread"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."DocumentBom"
    ADD CONSTRAINT "DocumentBom_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES public."Document"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."DocumentInstanceModificationData"
    ADD CONSTRAINT "DocumentInstanceModificationData_documentInstanceId_fkey" FOREIGN KEY ("documentInstanceId") REFERENCES public."DocumentInstance"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."DocumentInstance"
    ADD CONSTRAINT "DocumentInstance_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES public."Document"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."DocumentPermission"
    ADD CONSTRAINT "DocumentPermission_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES public."Document"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."DocumentPermission"
    ADD CONSTRAINT "DocumentPermission_sharePermissionId_fkey" FOREIGN KEY ("sharePermissionId") REFERENCES public."SharePermission"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."DocumentProcessResult"
    ADD CONSTRAINT "DocumentProcessResult_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES public."Document"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."DocumentSummary"
    ADD CONSTRAINT "DocumentSummary_document_id_fkey" FOREIGN KEY (document_id) REFERENCES public."Document"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."DocumentTextParts"
    ADD CONSTRAINT "DocumentTextParts_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES public."Document"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."DocumentText"
    ADD CONSTRAINT "DocumentText_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES public."Document"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."DocumentView"
    ADD CONSTRAINT "DocumentView_document_id_fkey" FOREIGN KEY (document_id) REFERENCES public."Document"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."DocumentView"
    ADD CONSTRAINT "DocumentView_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."Document"
    ADD CONSTRAINT "Document_documentFamilyId_fkey" FOREIGN KEY ("documentFamilyId") REFERENCES public."DocumentFamily"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public."Document"
    ADD CONSTRAINT "Document_owner_fkey" FOREIGN KEY (owner) REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."Document"
    ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public."EmailInsightsBackfillBatch"
    ADD CONSTRAINT "EmailInsightsBackfillBatch_insightsBackfillJobId_fkey" FOREIGN KEY ("insightsBackfillJobId") REFERENCES public."EmailInsightsBackfillJob"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."EmailInsightsBackfillJob"
    ADD CONSTRAINT "EmailInsightsBackfillJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."EmailThreadPermission"
    ADD CONSTRAINT "EmailThreadPermission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public."EmailThreadPermission"
    ADD CONSTRAINT "EmailThreadPermission_sharePermissionId_fkey" FOREIGN KEY ("sharePermissionId") REFERENCES public."SharePermission"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."EnterpriseEmailContacts"
    ADD CONSTRAINT "EnterpriseEmailContacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."EnterpriseIManageTenants"
    ADD CONSTRAINT "EnterpriseIManageTenants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."EnterpriseRules"
    ADD CONSTRAINT "EnterpriseRules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."ExperimentLog"
    ADD CONSTRAINT "ExperimentLog_experiment_id_fkey" FOREIGN KEY (experiment_id) REFERENCES public."Experiment"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."ExperimentLog"
    ADD CONSTRAINT "ExperimentLog_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."InsightContext"
    ADD CONSTRAINT "InsightContext_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."InstructionsDocuments"
    ADD CONSTRAINT "InstructionsDocuments_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES public."Document"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."InstructionsDocuments"
    ADD CONSTRAINT "InstructionsDocuments_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."JobToDocumentProcessResult"
    ADD CONSTRAINT "JobToDocumentProcessResult_documentProcessResultId_fkey" FOREIGN KEY ("documentProcessResultId") REFERENCES public."DocumentProcessResult"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."MacroPromptAttachment"
    ADD CONSTRAINT "MacroPromptAttachment_macro_prompt_id_fkey" FOREIGN KEY (macro_prompt_id) REFERENCES public."MacroPrompt"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."MacroPromptPermission"
    ADD CONSTRAINT "MacroPromptPermission_macro_prompt_id_fkey" FOREIGN KEY (macro_prompt_id) REFERENCES public."MacroPrompt"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."MacroPromptPermission"
    ADD CONSTRAINT "MacroPromptPermission_share_permission_id_fkey" FOREIGN KEY (share_permission_id) REFERENCES public."SharePermission"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."MacroPrompt"
    ADD CONSTRAINT "MacroPrompt_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."OrganizationBilling"
    ADD CONSTRAINT "OrganizationBilling_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."OrganizationDefaultSharePermission"
    ADD CONSTRAINT "OrganizationDefaultSharePermission_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."OrganizationEmailMatches"
    ADD CONSTRAINT "OrganizationEmailMatches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."OrganizationIT"
    ADD CONSTRAINT "OrganizationIT_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."OrganizationInvitation"
    ADD CONSTRAINT "OrganizationInvitation_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."OrganizationItJob"
    ADD CONSTRAINT "OrganizationItJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."OrganizationRetentionPolicy"
    ADD CONSTRAINT "OrganizationRetentionPolicy_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."PdfHighlightAnchor"
    ADD CONSTRAINT "PdfHighlightAnchor_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES public."Document"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."PdfHighlightAnchor"
    ADD CONSTRAINT "PdfHighlightAnchor_owner_fkey" FOREIGN KEY (owner) REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."PdfHighlightAnchor"
    ADD CONSTRAINT "PdfHighlightAnchor_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES public."Thread"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."PdfHighlightRect"
    ADD CONSTRAINT "PdfHighlightRect_pdfHighlightAnchorId_fkey" FOREIGN KEY ("pdfHighlightAnchorId") REFERENCES public."PdfHighlightAnchor"(uuid) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."PdfPlaceableCommentAnchor"
    ADD CONSTRAINT "PdfPlaceableCommentAnchor_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES public."Document"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."PdfPlaceableCommentAnchor"
    ADD CONSTRAINT "PdfPlaceableCommentAnchor_owner_fkey" FOREIGN KEY (owner) REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."PdfPlaceableCommentAnchor"
    ADD CONSTRAINT "PdfPlaceableCommentAnchor_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES public."Thread"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."Pin"
    ADD CONSTRAINT "Pin_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."ProjectPermission"
    ADD CONSTRAINT "ProjectPermission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."ProjectPermission"
    ADD CONSTRAINT "ProjectPermission_sharePermissionId_fkey" FOREIGN KEY ("sharePermissionId") REFERENCES public."SharePermission"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."Project"
    ADD CONSTRAINT "Project_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."Project"
    ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."RolesOnOrganizations"
    ADD CONSTRAINT "RolesOnOrganizations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."RolesOnOrganizations"
    ADD CONSTRAINT "RolesOnOrganizations_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES public."Role"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."RolesOnPermissions"
    ADD CONSTRAINT "RolesOnPermissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES public."Permission"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."RolesOnPermissions"
    ADD CONSTRAINT "RolesOnPermissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES public."Role"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."RolesOnUsers"
    ADD CONSTRAINT "RolesOnUsers_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES public."Role"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."RolesOnUsers"
    ADD CONSTRAINT "RolesOnUsers_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."ThreadAnchor"
    ADD CONSTRAINT "ThreadAnchor_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES public."Thread"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."Thread"
    ADD CONSTRAINT "Thread_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES public."Document"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."Thread"
    ADD CONSTRAINT "Thread_owner_fkey" FOREIGN KEY (owner) REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."UserApiKey"
    ADD CONSTRAINT "UserApiKey_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."UserDocumentViewLocation"
    ADD CONSTRAINT "UserDocumentViewLocation_document_id_fkey" FOREIGN KEY (document_id) REFERENCES public."Document"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."UserDocumentViewLocation"
    ADD CONSTRAINT "UserDocumentViewLocation_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."UserHistory"
    ADD CONSTRAINT "UserHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."UserInsightBatch"
    ADD CONSTRAINT "UserInsightBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."UserInsights"
    ADD CONSTRAINT "UserInsights_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."UserItemAccess"
    ADD CONSTRAINT "UserItemAccess_granted_from_team_id_fkey" FOREIGN KEY (granted_from_team_id) REFERENCES public.team(id) ON DELETE CASCADE;

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_macro_user_id_fkey" FOREIGN KEY (macro_user_id) REFERENCES public.macro_user(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public."WebAnnotations"
    ADD CONSTRAINT "WebAnnotations_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES public."Chat"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public."WebAnnotations"
    ADD CONSTRAINT "WebAnnotations_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES public."ChatMessage"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."WebsocketConnectionPermissions"
    ADD CONSTRAINT "WebsocketConnectionPermissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.account_merge_request
    ADD CONSTRAINT account_merge_request_macro_user_id_fkey FOREIGN KEY (macro_user_id) REFERENCES public.macro_user(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.call_participants
    ADD CONSTRAINT call_participants_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.calls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.call_record_participants
    ADD CONSTRAINT call_record_participants_call_record_id_fkey FOREIGN KEY (call_record_id) REFERENCES public.call_records(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.call_record_transcripts
    ADD CONSTRAINT call_record_transcripts_call_record_id_fkey FOREIGN KEY (call_record_id) REFERENCES public.call_records(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.call_records
    ADD CONSTRAINT call_records_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.comms_channels(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.call_records
    ADD CONSTRAINT call_records_share_permission_id_fkey FOREIGN KEY (share_permission_id) REFERENCES public."SharePermission"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.call_transcripts
    ADD CONSTRAINT call_transcripts_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.calls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.calls
    ADD CONSTRAINT calls_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.comms_channels(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.calls
    ADD CONSTRAINT calls_share_permission_id_fkey FOREIGN KEY (share_permission_id) REFERENCES public."SharePermission"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.comms_attachments
    ADD CONSTRAINT comms_attachments_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.comms_channels(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.comms_attachments
    ADD CONSTRAINT comms_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.comms_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.comms_channel_participants
    ADD CONSTRAINT comms_channel_participants_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.comms_channels(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.comms_channels
    ADD CONSTRAINT comms_channels_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.team(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.comms_messages
    ADD CONSTRAINT comms_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.comms_channels(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.comms_messages
    ADD CONSTRAINT comms_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.comms_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.comms_reactions
    ADD CONSTRAINT comms_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.comms_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.document_email
    ADD CONSTRAINT document_email_document_id_fkey FOREIGN KEY (document_id) REFERENCES public."Document"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.document_email
    ADD CONSTRAINT document_email_email_attachment_id_fkey FOREIGN KEY (email_attachment_id) REFERENCES public.email_attachments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.document_sub_type
    ADD CONSTRAINT document_sub_type_document_id_fkey FOREIGN KEY (document_id) REFERENCES public."Document"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.email_attachments_drafts
    ADD CONSTRAINT email_attachments_drafts_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES public.email_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_attachments_fwd
    ADD CONSTRAINT email_attachments_fwd_attachment_id_fkey FOREIGN KEY (attachment_id) REFERENCES public.email_attachments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_attachments_fwd
    ADD CONSTRAINT email_attachments_fwd_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.email_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.email_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_attachments_sfs
    ADD CONSTRAINT email_attachments_sfs_attachment_id_fkey FOREIGN KEY (attachment_id) REFERENCES public.email_attachments(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.email_backfill_jobs
    ADD CONSTRAINT email_backfill_job_link_id_fkey FOREIGN KEY (link_id) REFERENCES public.email_links(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.email_contacts
    ADD CONSTRAINT email_contacts_link_id_fkey FOREIGN KEY (link_id) REFERENCES public.email_links(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_filters
    ADD CONSTRAINT email_filters_link_id_fkey FOREIGN KEY (link_id) REFERENCES public.email_links(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_sync_tokens
    ADD CONSTRAINT email_fk_sync_tokens_link_id FOREIGN KEY (link_id) REFERENCES public.email_links(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_gmail_histories
    ADD CONSTRAINT email_gmail_histories_link_id_fkey FOREIGN KEY (link_id) REFERENCES public.email_links(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_labels
    ADD CONSTRAINT email_labels_link_id_fkey FOREIGN KEY (link_id) REFERENCES public.email_links(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_message_labels
    ADD CONSTRAINT email_message_labels_label_id_fkey FOREIGN KEY (label_id) REFERENCES public.email_labels(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_message_labels
    ADD CONSTRAINT email_message_labels_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.email_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_message_recipients
    ADD CONSTRAINT email_message_recipients_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.email_contacts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_message_recipients
    ADD CONSTRAINT email_message_recipients_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.email_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_from_contact_id_fkey FOREIGN KEY (from_contact_id) REFERENCES public.email_contacts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_link_id_fkey FOREIGN KEY (link_id) REFERENCES public.email_links(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_replying_to_id_fkey FOREIGN KEY (replying_to_id) REFERENCES public.email_messages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.email_threads(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_scheduled_messages
    ADD CONSTRAINT email_scheduled_messages_link_id_fkey FOREIGN KEY (link_id) REFERENCES public.email_links(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_scheduled_messages
    ADD CONSTRAINT email_scheduled_messages_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.email_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_settings
    ADD CONSTRAINT email_settings_link_id_fkey FOREIGN KEY (link_id) REFERENCES public.email_links(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_threads
    ADD CONSTRAINT email_threads_link_id_fkey FOREIGN KEY (link_id) REFERENCES public.email_links(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_threads
    ADD CONSTRAINT email_threads_project_id_fkey FOREIGN KEY (project_id) REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.email_user_history
    ADD CONSTRAINT email_user_history_link_id_fkey FOREIGN KEY (link_id) REFERENCES public.email_links(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_user_history
    ADD CONSTRAINT email_user_history_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.email_threads(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.entity_access
    ADD CONSTRAINT entity_access_granted_from_project_id_fkey FOREIGN KEY (granted_from_project_id) REFERENCES public."Project"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.entity_properties
    ADD CONSTRAINT entity_properties_property_definition_id_fkey FOREIGN KEY (property_definition_id) REFERENCES public.property_definitions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.excluded_default_view
    ADD CONSTRAINT excluded_default_view_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.notification_message_receipt
    ADD CONSTRAINT fk_user_notification FOREIGN KEY (user_id, notification_id) REFERENCES public.user_notification(user_id, notification_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.github_app_installation_team
    ADD CONSTRAINT github_app_installation_team_installed_by_fkey FOREIGN KEY (installed_by) REFERENCES public."User"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.github_app_installation_team
    ADD CONSTRAINT github_app_installation_team_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.team(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.github_links
    ADD CONSTRAINT github_links_macro_id_fkey FOREIGN KEY (macro_id) REFERENCES public."User"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.in_progress_email_link
    ADD CONSTRAINT in_progress_email_link_macro_user_id_fkey FOREIGN KEY (macro_user_id) REFERENCES public.macro_user(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.in_progress_user_link
    ADD CONSTRAINT in_progress_user_link_macro_user_id_fkey FOREIGN KEY (macro_user_id) REFERENCES public.macro_user(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.macro_user_email_verification
    ADD CONSTRAINT macro_user_email_verification_macro_user_id_fkey FOREIGN KEY (macro_user_id) REFERENCES public.macro_user(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.macro_user_info
    ADD CONSTRAINT macro_user_info_macro_user_id_fkey FOREIGN KEY (macro_user_id) REFERENCES public.macro_user(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.property_definitions
    ADD CONSTRAINT property_definitions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public."Organization"(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.property_definitions
    ADD CONSTRAINT property_definitions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.property_options
    ADD CONSTRAINT property_options_property_definition_id_fkey FOREIGN KEY (property_definition_id) REFERENCES public.property_definitions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.saved_view
    ADD CONSTRAINT saved_view_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.team_invite
    ADD CONSTRAINT team_invite_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.team_invite
    ADD CONSTRAINT team_invite_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.team(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.team
    ADD CONSTRAINT team_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.team_user
    ADD CONSTRAINT team_user_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.team(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.team_user
    ADD CONSTRAINT team_user_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_notification
    ADD CONSTRAINT user_notification_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notification(id) ON DELETE CASCADE;

