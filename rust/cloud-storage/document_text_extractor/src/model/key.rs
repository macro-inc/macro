use anyhow::Context;
use lambda_runtime::tracing;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
pub struct DocumentKeyParts {
    pub user_id: String,
    pub document_id: String,
    pub document_version_id: String,
}

impl DocumentKeyParts {
    #[tracing::instrument]
    pub fn from_s3_key(key: &str) -> Result<Self, anyhow::Error> {
        // user_id/document_id/document_bom_id.docx
        let split = key.split("/").collect::<Vec<&str>>();
        if split.len() != 3 {
            return Err(anyhow::anyhow!("invalid key format"));
        }

        let encoded_user_id = split[0].to_string();
        let user_id = urlencoding::decode(&encoded_user_id).context("UTF-8")?;
        let document_bom_id = split[2].split(".").collect::<Vec<&str>>()[0];

        Ok(Self {
            user_id: user_id.to_string(),
            document_id: split[1].to_string(),
            document_version_id: document_bom_id.to_string(),
        })
    }

    pub fn to_key(&self) -> String {
        format!(
            "{}/{}/{}.pdf",
            self.user_id, self.document_id, self.document_version_id
        )
    }
}
