use std::borrow::Cow;

use anyhow::Context;
use lambda_runtime::tracing;
use model::document::SaveBomPart;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
pub struct DocumentKeyParts {
    pub user_id: String,
    pub document_id: String,
    pub document_bom_id: i64,
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
        let document_bom_id = split[2].split(".").collect::<Vec<&str>>()[0]
            .parse::<i64>()
            .context("expect a number for verison id")?;
        Ok(Self {
            user_id: user_id.to_string(),
            document_id: split[1].to_string(),
            document_bom_id,
        })
    }

    pub fn to_key(&self) -> String {
        format!(
            "{}/{}/{}.docx",
            self.user_id, self.document_id, self.document_bom_id
        )
    }
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
pub struct DocumentBomPart {
    pub sha: String,
    pub path: String,
    pub content: Vec<u8>,
}

impl From<DocumentBomPart> for SaveBomPart {
    fn from(val: DocumentBomPart) -> Self {
        SaveBomPart {
            sha: val.sha,
            path: val.path,
        }
    }
}

#[derive(sqlx::FromRow, serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BomPart {
    pub sha: String,
    pub path: String,
    pub id: String,
    pub document_bom_id: i64,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocxUploadJobSuccessDataInner {
    pub bom_parts: Vec<BomPart>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocxUploadJobData {
    pub error: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<DocxUploadJobSuccessDataInner>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocxUploadJobResult<'a> {
    pub job_id: Cow<'a, str>,
    pub status: Cow<'a, str>,
    pub job_type: Cow<'a, str>,
    pub data: DocxUploadJobData,
}
