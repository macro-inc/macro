use anyhow::Context;
use lambda_runtime::tracing;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
pub struct DocumentKeyParts {
    pub user_id: String,
    pub document_id: String,
    pub document_version_id: String,
    pub has_extension: bool,
}

impl DocumentKeyParts {
    #[tracing::instrument]
    pub fn from_s3_key(key: &str) -> Result<Self, anyhow::Error> {
        // Supports both legacy keys (user_id/document_id/version.ext)
        // and extensionless keys (user_id/document_id/version)
        let split = key.split("/").collect::<Vec<&str>>();
        if split.len() != 3 {
            anyhow::bail!("invalid key format");
        }

        let encoded_user_id = split[0].to_string();
        let user_id = urlencoding::decode(&encoded_user_id).context("UTF-8")?;

        let file_parts: Vec<&str> = split[2].split(".").collect();
        let (document_version_id, has_extension) = if file_parts.len() == 2 {
            (file_parts[0].to_string(), true)
        } else {
            (split[2].to_string(), false)
        };

        Ok(Self {
            user_id: user_id.to_string(),
            document_id: split[1].to_string(),
            document_version_id,
            has_extension,
        })
    }

    pub fn to_key(&self) -> String {
        if self.has_extension {
            format!(
                "{}/{}/{}.pdf",
                self.user_id, self.document_id, self.document_version_id
            )
        } else {
            format!(
                "{}/{}/{}",
                self.user_id, self.document_id, self.document_version_id
            )
        }
    }
}
