use anyhow::Context;
use lambda_runtime::tracing;
use model::document::{
    CONVERTED_DOCUMENT_FILE_NAME, PDF_EXTENSION, build_cloud_storage_bucket_document_key,
    build_docx_to_pdf_converted_document_key,
};

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
#[serde(tag = "type")]
pub enum DocumentKey {
    Versioned {
        user_id: String,
        document_id: String,
        version_id: i64,
    },
    Converted {
        user_id: String,
        document_id: String,
    },
}

impl DocumentKey {
    #[tracing::instrument(err)]
    pub fn from_s3_key(key: &str) -> Result<Self, anyhow::Error> {
        let split: Vec<&str> = key.split('/').collect();
        if split.len() != 3 {
            anyhow::bail!(
                "invalid key format: expected 3 segments, got {}",
                split.len()
            );
        }

        let user_id = urlencoding::decode(split[0]).context("UTF-8")?.into_owned();
        let document_id = split[1].to_string();
        let tail = split[2];

        let converted_pdf_suffix = format!("{CONVERTED_DOCUMENT_FILE_NAME}.{PDF_EXTENSION}");
        if tail == converted_pdf_suffix {
            Ok(Self::Converted {
                user_id,
                document_id,
            })
        } else {
            let version_id: i64 = tail.parse().context(format!(
                "invalid version id: expected integer, got '{tail}'"
            ))?;
            Ok(Self::Versioned {
                user_id,
                document_id,
                version_id,
            })
        }
    }

    pub fn document_id(&self) -> &str {
        match self {
            Self::Versioned { document_id, .. } | Self::Converted { document_id, .. } => {
                document_id
            }
        }
    }

    pub fn to_key(&self) -> String {
        match self {
            Self::Versioned {
                user_id,
                document_id,
                version_id,
            } => build_cloud_storage_bucket_document_key(user_id, document_id, version_id),
            Self::Converted {
                user_id,
                document_id,
            } => build_docx_to_pdf_converted_document_key(user_id, document_id),
        }
    }
}

#[cfg(test)]
mod test;
