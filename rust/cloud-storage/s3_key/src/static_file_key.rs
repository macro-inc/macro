const STATIC_FILE_PREFIX: &str = "file";

/// Represents an S3 key in the static file storage bucket.
/// Format: `file/{file_id}`
#[derive(Eq, PartialEq, Debug, Clone)]
pub struct StaticFileKey {
    /// The file ID (UUID).
    pub file_id: String,
}

impl StaticFileKey {
    /// Creates a new static file key from a file ID.
    pub fn new(file_id: impl Into<String>) -> Self {
        Self {
            file_id: file_id.into(),
        }
    }

    /// Parses an S3 key from the static file storage bucket.
    pub fn from_s3_key(key: &str) -> Result<Self, anyhow::Error> {
        let file_id = key
            .strip_prefix(&format!("{STATIC_FILE_PREFIX}/"))
            .ok_or_else(|| anyhow::anyhow!("expected key to start with '{STATIC_FILE_PREFIX}/'"))?;

        if file_id.is_empty() {
            anyhow::bail!("file_id is empty");
        }

        Ok(Self {
            file_id: file_id.to_string(),
        })
    }

    /// Reconstructs the S3 key string.
    pub fn to_key(&self) -> String {
        format!("{STATIC_FILE_PREFIX}/{}", self.file_id)
    }
}

impl std::fmt::Display for StaticFileKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_key())
    }
}

#[cfg(test)]
mod test;
