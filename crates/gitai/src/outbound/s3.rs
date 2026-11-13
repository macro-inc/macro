use crate::domain::ports::ObjectStore;

/// The two buckets. Events (`raw/`, `notes/`, `commits/`, `usage/`, `cas/`)
/// are kept; sessions (`sessions/`, `session-index/`) expire after 180 days.
pub struct S3Storage {
    #[expect(dead_code, reason = "used by the ingest writes")]
    client: aws_sdk_s3::Client,
    #[expect(dead_code, reason = "used by the ingest writes")]
    events_bucket: String,
    #[expect(dead_code, reason = "used by the transcript writes and reads")]
    sessions_bucket: String,
}

impl S3Storage {
    /// Storage on `events_bucket` and `sessions_bucket`. Build `client` with
    /// `macro_aws_config::s3_client`, which uses path-style addressing
    /// against LocalStack.
    pub fn new(client: aws_sdk_s3::Client, events_bucket: String, sessions_bucket: String) -> Self {
        Self {
            client,
            events_bucket,
            sessions_bucket,
        }
    }
}

impl ObjectStore for S3Storage {}
