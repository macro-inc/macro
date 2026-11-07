//! Patch blobs in S3.
//!
//! One object per capture under `agent-sessions/{session}/changes/`; the
//! key is minted by the domain ([`PatchBlobKey`]), this adapter only moves
//! bytes. Patches are UTF-8 text and rarely more than a few megabytes, so
//! they are read whole - there is no streaming here to get right.

use aws_sdk_s3::primitives::ByteStream;

use crate::domain::ports::{ChangesetBlobStore, PatchBlobKey};

/// S3-backed [`ChangesetBlobStore`].
#[derive(Clone)]
pub struct S3ChangesetBlobStore {
    client: aws_sdk_s3::Client,
    bucket: String,
}

impl S3ChangesetBlobStore {
    /// Store patches in `bucket` through `client`.
    #[must_use]
    pub fn new(client: aws_sdk_s3::Client, bucket: String) -> Self {
        Self { client, bucket }
    }
}

impl ChangesetBlobStore for S3ChangesetBlobStore {
    #[tracing::instrument(skip(self, patch), err, fields(key = %key, bytes = patch.len()))]
    async fn put_patch(&self, key: &PatchBlobKey, patch: &str) -> Result<(), rootcause::Report> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key.as_str())
            .content_type("text/x-diff; charset=utf-8")
            .body(ByteStream::from(patch.as_bytes().to_vec()))
            .send()
            .await
            .map_err(|error| rootcause::report!("put patch {key}: {error:?}"))?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err, fields(key = %key))]
    async fn get_patch(&self, key: &PatchBlobKey) -> Result<Option<String>, rootcause::Report> {
        let response = match self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key.as_str())
            .send()
            .await
        {
            Ok(response) => response,
            Err(error)
                if error
                    .as_service_error()
                    .is_some_and(|service_error| service_error.is_no_such_key()) =>
            {
                return Ok(None);
            }
            Err(error) => return Err(rootcause::report!("get patch {key}: {error:?}")),
        };
        let bytes = response
            .body
            .collect()
            .await
            .map_err(|error| rootcause::report!("read patch {key}: {error:?}"))?
            .into_bytes();
        String::from_utf8(bytes.to_vec())
            .map(Some)
            .map_err(|error| rootcause::report!("patch {key} is not UTF-8: {error}"))
    }

    #[tracing::instrument(skip(self), err, fields(key = %key))]
    async fn delete_patch(&self, key: &PatchBlobKey) -> Result<(), rootcause::Report> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(key.as_str())
            .send()
            .await
            .map_err(|error| rootcause::report!("delete patch {key}: {error:?}"))?;
        Ok(())
    }
}
