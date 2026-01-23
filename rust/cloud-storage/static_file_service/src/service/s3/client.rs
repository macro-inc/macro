use anyhow::{Context, Result};
use aws_sdk_s3::{self, presigning::PresigningConfig};
use std::time::Duration;

#[derive(Debug)]
pub struct S3Client {
    inner: aws_sdk_s3::Client,
    storage_bucket: String,
}

impl S3Client {
    pub fn new(inner: aws_sdk_s3::Client, storage_bucket: String) -> Self {
        S3Client {
            inner,
            storage_bucket,
        }
    }

    #[tracing::instrument(skip(self))]
    pub async fn put_presigned_url(&self, key: String, content_type: String) -> Result<String> {
        let duration = Duration::from_secs(2 * 60);
        let presigned_url = self
            .inner
            .put_object()
            .key(key)
            .content_type(content_type)
            .bucket(self.storage_bucket.clone())
            .presigned(PresigningConfig::expires_in(duration)?)
            .await
            .context("failed to create presigned url")?;

        Ok(presigned_url.uri().to_string())
    }

    #[tracing::instrument(skip(self))]
    pub async fn hard_delete_object(&self, key: String) -> Result<()> {
        self.inner
            .delete_object()
            .key(key)
            .bucket(self.storage_bucket.clone())
            .send()
            .await
            .context("failed to delete object")?;
        Ok(())
    }

    #[tracing::instrument(skip(self))]
    pub async fn get_presigned_url(&self, key: String) -> Result<String> {
        let presigned_url = self
            .inner
            .get_object()
            .bucket(self.storage_bucket.clone())
            .key(key)
            .presigned(
                aws_sdk_s3::presigning::PresigningConfig::expires_in(
                    std::time::Duration::from_secs(3600), // 1 hour
                )
                .context("failed to create presigning config")?,
            )
            .await
            .context("failed to create presigned URL")?;

        Ok(presigned_url.uri().to_string())
    }

    #[tracing::instrument(skip(self), fields(count = keys.len()))]
    pub async fn bulk_hard_delete_objects(&self, keys: Vec<String>) -> Vec<Result<()>> {
        if keys.is_empty() {
            return Vec::new();
        }

        // S3 delete_objects has a limit of 1000 keys per request
        let chunk_size = 1000;
        let mut all_results = Vec::with_capacity(keys.len());

        for chunk in keys.chunks(chunk_size) {
            let mut object_identifiers = Vec::new();
            for key in chunk {
                object_identifiers.push(
                    aws_sdk_s3::types::ObjectIdentifier::builder()
                        .key(key.clone())
                        .build()
                        .expect("failed to build ObjectIdentifier"),
                );
            }

            let delete_request = aws_sdk_s3::types::Delete::builder()
                .set_objects(Some(object_identifiers))
                .build()
                .context("failed to build Delete request");

            match delete_request {
                Ok(delete_req) => {
                    match self
                        .inner
                        .delete_objects()
                        .bucket(self.storage_bucket.clone())
                        .delete(delete_req)
                        .send()
                        .await
                    {
                        Ok(output) => {
                            // Build a map of error keys to their error messages
                            let errors = output.errors();
                            let error_map: std::collections::HashMap<&str, String> = errors
                                .iter()
                                .filter_map(|e| {
                                    e.key().map(|key| {
                                        let msg =
                                            e.message().unwrap_or("unknown error").to_string();
                                        (key, msg)
                                    })
                                })
                                .collect();

                            // Log errors
                            for error in errors {
                                if let Some(key) = error.key() {
                                    tracing::warn!(
                                        key = key,
                                        error = ?error,
                                        "failed to delete object from S3"
                                    );
                                }
                            }

                            // Add results in the same order as the input keys
                            for key in chunk {
                                if let Some(error_msg) = error_map.get(key.as_str()) {
                                    all_results.push(Err(anyhow::anyhow!(
                                        "failed to delete {}: {}",
                                        key,
                                        error_msg
                                    )));
                                } else {
                                    all_results.push(Ok(()));
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!(error = ?e, "failed to delete batch of objects from S3");
                            // Add error for each key in this chunk
                            for _ in chunk {
                                all_results
                                    .push(Err(anyhow::anyhow!("batch delete failed: {}", e)));
                            }
                        }
                    }
                }
                Err(e) => {
                    let err_msg = e.to_string();
                    tracing::error!(error = ?e, "failed to build delete request");
                    for _ in chunk {
                        all_results.push(Err(anyhow::anyhow!(
                            "failed to build delete request: {}",
                            err_msg
                        )));
                    }
                }
            }
        }

        all_results
    }
}
