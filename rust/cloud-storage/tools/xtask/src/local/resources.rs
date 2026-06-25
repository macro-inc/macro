//! The single catalog of local AWS resources (SQS queues, S3 buckets, DynamoDB
//! tables).
//!
//! Two places need these names: [`localstack`](super::localstack) *creates* the
//! resources, and [`local_env`](super::local_env) emits the env vars services
//! use to *find* them. Before this catalog the lists lived in both files and
//! could silently drift — a queue created but not exported (or vice-versa) is a
//! service that can't reach a queue that exists. Here they share one list, so
//! adding a resource in one place is impossible: creation and env both follow
//! from a single entry.
//!
//! Rule of thumb: a name is a `const` only when something *outside* the catalog
//! iteration also references it (the upload-finalizer wiring, the seed env);
//! everything else is an inline literal in its entry.

/// LocalStack's fixed account id, used in queue URLs and ARNs.
const ACCOUNT_ID: &str = "000000000000";

/// The doc-storage bucket — referenced by the upload-finalizer wiring and the
/// seed env, so it is named rather than inlined.
pub const DOC_STORAGE_BUCKET: &str = "doc-storage";

/// The queue doc-storage ObjectCreated events publish to — referenced by the
/// upload-finalizer wiring, so it is named.
pub const UPLOAD_FINALIZER_QUEUE: &str = "document-upload-finalizer-queue";

// DynamoDB table names: referenced both by their bespoke create-table schema in
// `localstack` and by the env binding below, so they are named.
/// The bulk-upload requests table.
pub const BULK_UPLOAD_TABLE: &str = "bulk-upload";
/// The connection-gateway (websocket) table.
pub const CONNECTION_GATEWAY_TABLE: &str = "connection-gateway-table";
/// The static-file metadata table.
pub const STATIC_FILE_TABLE: &str = "static-file-metadata";

/// The full LocalStack URL for `queue` (docker-network host — services run in
/// containers and reach LocalStack by its compose alias).
pub fn queue_url(queue: &str) -> String {
    format!("http://localstack:4566/{ACCOUNT_ID}/{queue}")
}

/// The ARN for `queue`.
pub fn queue_arn(queue: &str) -> String {
    format!("arn:aws:sqs:us-east-1:{ACCOUNT_ID}:{queue}")
}

/// How an env var refers to a queue: the bare name, or the full LocalStack URL.
#[derive(Clone, Copy)]
pub enum QueueForm {
    /// The env value is the bare queue name.
    Name,
    /// The env value is the full LocalStack queue URL.
    Url,
}

impl QueueForm {
    /// Resolve the env value for `queue` in this form.
    pub fn value(self, queue: &str) -> String {
        match self {
            QueueForm::Name => queue.to_string(),
            QueueForm::Url => queue_url(queue),
        }
    }
}

/// An SQS queue: the name created in LocalStack plus the env vars that point at
/// it. A queue may be referenced by several keys in different forms (e.g. the
/// backfill queue is exported both as a bare name and as a URL).
pub struct Queue {
    /// The queue name created in LocalStack.
    pub name: &'static str,
    /// `(env key, value form)` pairs the env builder emits for this queue.
    pub bindings: &'static [(&'static str, QueueForm)],
}

/// An S3 bucket: the name created in LocalStack and the env var pointing at it.
pub struct Bucket {
    /// The bucket name created in LocalStack.
    pub name: &'static str,
    /// The env var services read to find this bucket.
    pub env_key: &'static str,
}

/// A DynamoDB table: the name and its env var. The table *schema* lives with the
/// provisioner (it is bespoke per table); only the name is shared here.
pub struct Table {
    /// The table name created in LocalStack.
    pub name: &'static str,
    /// The env var services read to find this table.
    pub env_key: &'static str,
}

use QueueForm::{Name, Url};

/// Every local SQS queue and the env var(s) that reference it.
pub const QUEUES: &[Queue] = &[
    Queue {
        name: "notification-queue",
        bindings: &[("NOTIFICATION_QUEUE", Url)],
    },
    Queue {
        name: "notification-ingress-queue",
        bindings: &[("NOTIFICATION_INGRESS_QUEUE", Url)],
    },
    Queue {
        name: "push-delivery-queue",
        bindings: &[("PUSH_NOTIFICATION_EVENT_HANDLER_QUEUE", Name)],
    },
    Queue {
        name: "email-service-backfill-queue",
        bindings: &[("BACKFILL_QUEUE", Name), ("EMAIL_BACKFILL_QUEUE", Url)],
    },
    Queue {
        name: "delete-chat-handler-queue",
        bindings: &[("CHAT_DELETE_QUEUE", Name)],
    },
    Queue {
        name: "contacts-queue",
        bindings: &[("CONTACTS_QUEUE", Name)],
    },
    Queue {
        name: "convert-service-queue",
        bindings: &[("CONVERT_QUEUE", Name)],
    },
    Queue {
        name: "delete-document-handler-queue",
        bindings: &[("DOCUMENT_DELETE_QUEUE", Name)],
    },
    Queue {
        name: UPLOAD_FINALIZER_QUEUE,
        bindings: &[("DOCUMENT_UPLOAD_FINALIZER_QUEUE_URL", Url)],
    },
    Queue {
        name: "document-text-extractor-lambda-queue",
        bindings: &[("DOCUMENT_TEXT_EXTRACTOR_QUEUE", Name)],
    },
    Queue {
        name: "email-service-scheduled-queue",
        bindings: &[("EMAIL_SCHEDULED_QUEUE", Name)],
    },
    Queue {
        name: "email-service-gmail-inbox-sync-queue",
        bindings: &[("GMAIL_INBOX_SYNC_QUEUE", Name)],
    },
    Queue {
        name: "email-service-gmail-inbox-retry-queue",
        bindings: &[("GMAIL_INBOX_SYNC_RETRY_QUEUE", Name)],
    },
    Queue {
        name: "email-service-gmail-ops-queue",
        bindings: &[("GMAIL_OPS_QUEUE", Name)],
    },
    Queue {
        name: "email-service-gmail-ops-retry-queue",
        bindings: &[("GMAIL_OPS_RETRY_QUEUE", Name)],
    },
    Queue {
        name: "email-service-refresh-queue",
        bindings: &[("LINK_MANAGER_QUEUE", Name)],
    },
    Queue {
        name: "search-event-queue",
        bindings: &[("SEARCH_EVENT_QUEUE", Name)],
    },
    Queue {
        name: "ai-projection-queue",
        bindings: &[("AI_PROJECTION_QUEUE", Url)],
    },
    Queue {
        name: "email-sfs-delete-queue",
        bindings: &[("SFS_DELETE_QUEUE", Name)],
    },
    Queue {
        name: "email-service-sfs-mapper-queue",
        bindings: &[("SFS_UPLOADER_QUEUE", Name)],
    },
    Queue {
        name: "static-file-s3-event-notification-queue",
        bindings: &[("STATIC_FILE_SERVICE_S3_EVENT_QUEUE_URL", Url)],
    },
];

/// Every local S3 bucket and the env var that references it.
pub const BUCKETS: &[Bucket] = &[
    Bucket {
        name: "macro-email-attachments",
        env_key: "ATTACHMENT_BUCKET",
    },
    Bucket {
        name: DOC_STORAGE_BUCKET,
        env_key: "DOCUMENT_STORAGE_BUCKET",
    },
    Bucket {
        name: "docx-upload",
        env_key: "DOCX_DOCUMENT_UPLOAD_BUCKET",
    },
    Bucket {
        name: "static-file-storage",
        env_key: "STATIC_STORAGE_BUCKET",
    },
    Bucket {
        name: "bulk-upload-staging",
        env_key: "UPLOAD_STAGING_BUCKET",
    },
    Bucket {
        name: "macro-call-recording-local",
        env_key: "CALL_RECORDING_BUCKET_NAME",
    },
];

/// Every local DynamoDB table and the env var that references it.
pub const TABLES: &[Table] = &[
    Table {
        name: BULK_UPLOAD_TABLE,
        env_key: "BULK_UPLOAD_REQUESTS_TABLE",
    },
    Table {
        name: CONNECTION_GATEWAY_TABLE,
        env_key: "CONNECTION_GATEWAY_TABLE",
    },
    Table {
        name: STATIC_FILE_TABLE,
        env_key: "STATIC_FILE_SERVICE_DYNAMODB_TABLE_NAME",
    },
];

#[cfg(test)]
mod test;
