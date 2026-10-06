//! Immutable file bodies in the existing session changes bucket.

use agent_session::domain::model::AgentSessionId;
use async_trait::async_trait;
use aws_sdk_s3::{Client, primitives::ByteStream};

use crate::domain::{
    model::{Result, ReviewError, ReviewFile},
    ports::ReviewBodies,
};

/// Source-body storage. The key includes the authorized session scope.
pub struct S3ReviewBodies {
    client: Client,
    bucket: String,
}

impl S3ReviewBodies {
    /// Reuse the existing session changes bucket and client.
    pub fn new(client: Client, bucket: String) -> Self {
        Self { client, bucket }
    }
    fn key(session: AgentSessionId, content: &str) -> Result<String> {
        if content.len() != 64 || !content.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(ReviewError::NotFound);
        }
        Ok(format!("reviews/{session}/{content}.json"))
    }
}

#[async_trait]
impl ReviewBodies for S3ReviewBodies {
    async fn delete_session(&self, session: AgentSessionId) -> Result<()> {
        let prefix = format!("reviews/{session}/");
        loop {
            let page = self
                .client
                .list_objects_v2()
                .bucket(&self.bucket)
                .prefix(&prefix)
                .max_keys(1000)
                .send()
                .await
                .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
            let keys: Vec<_> = page
                .contents()
                .iter()
                .filter_map(|o| o.key())
                .map(|key| {
                    aws_sdk_s3::types::ObjectIdentifier::builder()
                        .key(key)
                        .build()
                })
                .collect::<std::result::Result<_, _>>()
                .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
            if keys.is_empty() {
                return Ok(());
            }
            let delete = aws_sdk_s3::types::Delete::builder()
                .set_objects(Some(keys))
                .build()
                .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
            let result = self
                .client
                .delete_objects()
                .bucket(&self.bucket)
                .delete(delete)
                .send()
                .await
                .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
            if !result.errors().is_empty() {
                return Err(ReviewError::Unavailable(
                    "Review source cleanup will retry".into(),
                ));
            }
        }
    }

    async fn put(&self, session: AgentSessionId, content: &str, file: &ReviewFile) -> Result<()> {
        let key = Self::key(session, content)?;
        let bytes = serde_json::to_vec(file)
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type("application/json")
            .body(ByteStream::from(bytes))
            .send()
            .await
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        Ok(())
    }
    async fn get(&self, session: AgentSessionId, content: &str) -> Result<ReviewFile> {
        let response = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(Self::key(session, content)?)
            .send()
            .await
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        let bytes = response
            .body
            .collect()
            .await
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?
            .into_bytes();
        serde_json::from_slice(&bytes)
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))
    }
}
