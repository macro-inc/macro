use aws_sdk_s3::error::SdkError;
use aws_sdk_s3::primitives::ByteStream;
use tracing::field::Empty;

use crate::domain::ports::{Bucket, ObjectStore};

/// The two buckets. Events (`raw/`, `notes/`, `commits/`, `usage/`) are
/// kept; sessions (`sessions/`, `session-index/`) expire after 180 days.
pub struct S3Storage {
    client: aws_sdk_s3::Client,
    events_bucket: String,
    sessions_bucket: String,
}

/// An S3 call failed.
#[derive(Debug, thiserror::Error)]
pub enum S3StorageError {
    /// `PutObject` failed.
    #[error("S3 put failed: {0}")]
    Put(#[source] Box<SdkError<aws_sdk_s3::operation::put_object::PutObjectError>>),
    /// `GetObject` failed.
    #[error("S3 get failed: {0}")]
    Get(#[source] Box<SdkError<aws_sdk_s3::operation::get_object::GetObjectError>>),
    /// Reading the object body failed.
    #[error("S3 body read failed: {0}")]
    Body(#[source] aws_sdk_s3::primitives::ByteStreamError),
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

    fn bucket(&self, bucket: Bucket) -> &str {
        match bucket {
            Bucket::Events => &self.events_bucket,
            Bucket::Sessions => &self.sessions_bucket,
        }
    }
}

impl ObjectStore for S3Storage {
    type Err = S3StorageError;

    #[tracing::instrument(
        name = "gitai.s3.put",
        skip(self, body),
        fields(bytes = body.len(), s3.bucket = Empty),
        err
    )]
    async fn put(
        &self,
        bucket: Bucket,
        key: &str,
        body: Vec<u8>,
        content_type: &'static str,
    ) -> Result<(), Self::Err> {
        let bucket = self.bucket(bucket);
        tracing::Span::current().record("s3.bucket", bucket);
        self.client
            .put_object()
            .bucket(bucket)
            .key(key)
            .content_type(content_type)
            .body(ByteStream::from(body))
            .send()
            .await
            .map_err(|error| S3StorageError::Put(Box::new(error)))?;
        Ok(())
    }

    #[tracing::instrument(name = "gitai.s3.get", skip(self), fields(found = Empty), err)]
    async fn get(&self, bucket: Bucket, key: &str) -> Result<Option<Vec<u8>>, Self::Err> {
        let result = self
            .client
            .get_object()
            .bucket(self.bucket(bucket))
            .key(key)
            .send()
            .await;
        let output = match result {
            Ok(output) => output,
            Err(error) if error.as_service_error().is_some_and(|e| e.is_no_such_key()) => {
                tracing::Span::current().record("found", false);
                return Ok(None);
            }
            Err(error) => return Err(S3StorageError::Get(Box::new(error))),
        };
        let bytes = output.body.collect().await.map_err(S3StorageError::Body)?;
        tracing::Span::current().record("found", true);
        Ok(Some(bytes.into_bytes().to_vec()))
    }
}
