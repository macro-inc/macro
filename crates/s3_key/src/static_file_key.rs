const STATIC_FILE_PREFIX: &str = "file";

/// Represents an S3 key in the static file storage bucket.
///
/// Original: `file/{file_id}`
/// Variant: `file/{file_id}/{transform_key}`
#[derive(Eq, PartialEq, Debug, Clone)]
pub enum StaticFileKey {
    /// The original uploaded file.
    Original {
        /// The file ID (UUID).
        file_id: String,
    },
    /// A transformed variant of the file (resized, reformatted, etc.).
    Variant {
        /// The file ID (UUID).
        file_id: String,
        /// The opaque transform key (e.g. `format=avif,size=1080`).
        transform_key: String,
    },
}

impl StaticFileKey {
    /// Creates a new original file key from a file ID.
    pub fn new(file_id: impl Into<String>) -> Self {
        Self::Original {
            file_id: file_id.into(),
        }
    }

    /// Returns the file ID.
    pub fn file_id(&self) -> &str {
        match self {
            Self::Original { file_id } | Self::Variant { file_id, .. } => file_id,
        }
    }

    /// Returns the S3 key prefix for all variants of this file.
    /// Format: `file/{file_id}/`
    pub fn variant_prefix(&self) -> String {
        format!("{STATIC_FILE_PREFIX}/{}/", self.file_id())
    }

    /// Parses an S3 key from the static file storage bucket.
    pub fn from_s3_key(key: &str) -> Result<Self, anyhow::Error> {
        let rest = key
            .strip_prefix(&format!("{STATIC_FILE_PREFIX}/"))
            .ok_or_else(|| anyhow::anyhow!("expected key to start with '{STATIC_FILE_PREFIX}/'"))?;

        if rest.is_empty() {
            anyhow::bail!("file_id is empty");
        }

        match rest.split_once('/') {
            None => Ok(Self::Original {
                file_id: rest.to_string(),
            }),
            Some((file_id, transform_key)) => {
                if file_id.is_empty() {
                    anyhow::bail!("file_id is empty");
                }
                if transform_key.is_empty() {
                    anyhow::bail!("transform_key is empty");
                }
                Ok(Self::Variant {
                    file_id: file_id.to_string(),
                    transform_key: transform_key.to_string(),
                })
            }
        }
    }

    /// Reconstructs the S3 key string.
    pub fn to_key(&self) -> String {
        match self {
            Self::Original { file_id } => format!("{STATIC_FILE_PREFIX}/{file_id}"),
            Self::Variant {
                file_id,
                transform_key,
            } => {
                format!("{STATIC_FILE_PREFIX}/{file_id}/{transform_key}")
            }
        }
    }
}

impl std::fmt::Display for StaticFileKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_key())
    }
}

#[cfg(test)]
mod test;
