//! Pull request patches in S3, one object per base and head under `pull-requests/`. Keys are
//! minted by the domain; this adapter only moves bytes. Patches are UTF-8 text of at most a few
//! megabytes, so they are read whole.

use aws_sdk_s3::primitives::ByteStream;

use crate::domain::ports::GithubPullRequestPatchStore;

/// S3-backed [`GithubPullRequestPatchStore`].
#[derive(Clone)]
pub struct S3GithubPullRequestPatchStore {
    client: aws_sdk_s3::Client,
    bucket: String,
}

impl S3GithubPullRequestPatchStore {
    /// Store patches in `bucket` through `client`.
    #[must_use]
    pub fn new(client: aws_sdk_s3::Client, bucket: String) -> Self {
        Self { client, bucket }
    }
}

impl GithubPullRequestPatchStore for S3GithubPullRequestPatchStore {
    type Err = anyhow::Error;

    #[tracing::instrument(skip(self, patch), err, fields(bytes = patch.len()))]
    async fn put_patch(&self, key: &str, patch: &str) -> Result<(), Self::Err> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type("text/x-diff; charset=utf-8")
            .body(ByteStream::from(patch.as_bytes().to_vec()))
            .send()
            .await
            .map_err(|error| anyhow::anyhow!("put patch {key}: {error:?}"))?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_patch(&self, key: &str) -> Result<Option<String>, Self::Err> {
        let response = match self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
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
            Err(error) => return Err(anyhow::anyhow!("get patch {key}: {error:?}")),
        };
        let bytes = response
            .body
            .collect()
            .await
            .map_err(|error| anyhow::anyhow!("read patch {key}: {error:?}"))?
            .into_bytes();
        String::from_utf8(bytes.to_vec())
            .map(Some)
            .map_err(|error| anyhow::anyhow!("patch {key} is not UTF-8: {error}"))
    }
}
