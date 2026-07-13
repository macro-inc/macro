const BULK_UPLOAD_STAGING_PREFIX: &str = "extract";

/// Represents an S3 key in the bulk upload staging bucket.
/// Format: `extract/{request_id}`
#[derive(Eq, PartialEq, Debug, Clone)]
pub struct BulkUploadStagingKey {
    /// The bulk upload request ID.
    pub request_id: String,
}

impl BulkUploadStagingKey {
    /// Creates a new bulk upload staging key from a request ID.
    pub fn new(request_id: impl Into<String>) -> Self {
        Self {
            request_id: request_id.into(),
        }
    }

    /// Parses an S3 key from the bulk upload staging bucket.
    pub fn from_s3_key(key: &str) -> Result<Self, anyhow::Error> {
        let request_id = key
            .strip_prefix(&format!("{BULK_UPLOAD_STAGING_PREFIX}/"))
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "expected key to start with '{BULK_UPLOAD_STAGING_PREFIX}/', got '{key}'"
                )
            })?;

        if request_id.is_empty() {
            anyhow::bail!("request_id is empty");
        }

        Ok(Self {
            request_id: request_id.to_string(),
        })
    }

    /// Reconstructs the S3 key string.
    pub fn to_key(&self) -> String {
        format!("{BULK_UPLOAD_STAGING_PREFIX}/{}", self.request_id)
    }
}

impl std::fmt::Display for BulkUploadStagingKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_key())
    }
}

#[cfg(test)]
mod test;
