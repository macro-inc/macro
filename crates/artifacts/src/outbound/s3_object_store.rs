//! Artifact objects in the document storage bucket, content-addressed at
//! `artifacts/<document_id>/<sha256>`.

use std::collections::BTreeMap;
use std::time::Duration;

use anyhow::Context;
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::primitives::ByteStream;
use base64::Engine;

use crate::domain::models::{ObjectBody, Sha256};
use crate::domain::ports::{ArtifactObjectStore, PresignedUpload};

/// How long a presigned upload stays valid.
const UPLOAD_URL_LIFETIME: Duration = Duration::from_secs(15 * 60);

fn object_key(document_id: &str, sha256: &Sha256) -> String {
    s3_key::build_artifact_object_key(document_id, sha256.as_str())
}

fn base64_digest(sha256: &Sha256) -> anyhow::Result<String> {
    let bytes = hex::decode(sha256.as_str()).context("sha256 is not hex")?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// [`ArtifactObjectStore`] over S3.
#[derive(Clone)]
pub struct S3ArtifactObjectStore {
    client: aws_sdk_s3::Client,
    bucket: String,
}

impl S3ArtifactObjectStore {
    /// A store in `bucket`.
    pub fn new(client: aws_sdk_s3::Client, bucket: impl Into<String>) -> Self {
        Self {
            client,
            bucket: bucket.into(),
        }
    }
}

impl ArtifactObjectStore for S3ArtifactObjectStore {
    #[tracing::instrument(skip(self, sha256), fields(sha256 = sha256.as_str()), err)]
    async fn size(&self, document_id: &str, sha256: &Sha256) -> anyhow::Result<Option<u64>> {
        let head = self
            .client
            .head_object()
            .bucket(&self.bucket)
            .key(object_key(document_id, sha256))
            .send()
            .await;

        match head {
            Ok(output) => {
                let size = output.content_length().unwrap_or_default();
                Ok(Some(u64::try_from(size)?))
            }
            Err(error) if error.as_service_error().is_some_and(|e| e.is_not_found()) => Ok(None),
            Err(error) => Err(error).context("head artifact object"),
        }
    }

    #[tracing::instrument(skip(self, sha256, bytes), fields(sha256 = sha256.as_str(), bytes = bytes.len()), err)]
    async fn put(
        &self,
        document_id: &str,
        sha256: &Sha256,
        content_type: &str,
        bytes: Vec<u8>,
    ) -> anyhow::Result<()> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(object_key(document_id, sha256))
            .content_type(content_type)
            .checksum_sha256(base64_digest(sha256)?)
            .body(ByteStream::from(bytes))
            .send()
            .await
            .context("put artifact object")?;
        Ok(())
    }

    #[tracing::instrument(skip(self, sha256), fields(sha256 = sha256.as_str()), err)]
    async fn presign_put(
        &self,
        document_id: &str,
        sha256: &Sha256,
        size: u64,
        content_type: &str,
    ) -> anyhow::Result<PresignedUpload> {
        let checksum = base64_digest(sha256)?;
        let presigned = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(object_key(document_id, sha256))
            .content_type(content_type)
            .checksum_sha256(&checksum)
            .presigned(PresigningConfig::expires_in(UPLOAD_URL_LIFETIME)?)
            .await
            .context("presign artifact upload")?;

        let headers = BTreeMap::from([
            ("content-type".to_string(), content_type.to_string()),
            ("x-amz-checksum-sha256".to_string(), checksum),
        ]);
        tracing::debug!(size, "presigned artifact upload");

        Ok(PresignedUpload {
            url: macro_aws_config::transform_aws_url(presigned.uri()),
            headers,
        })
    }

    #[tracing::instrument(skip(self, sha256), fields(sha256 = sha256.as_str()), err)]
    async fn get(&self, document_id: &str, sha256: &Sha256) -> anyhow::Result<Option<ObjectBody>> {
        let object = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(object_key(document_id, sha256))
            .send()
            .await;

        let output = match object {
            Ok(output) => output,
            Err(error) if error.as_service_error().is_some_and(|e| e.is_no_such_key()) => {
                return Ok(None);
            }
            Err(error) => return Err(error).context("get artifact object"),
        };

        let body = futures::stream::unfold(output.body, |mut body| async move {
            body.next()
                .await
                .map(|chunk| (chunk.map_err(std::io::Error::other), body))
        });
        Ok(Some(Box::pin(body)))
    }
}
