//! CreateDocument tool for reading document content.

use base64::Engine;
use sha2::Digest;
use sha2::Sha256;
use std::str::FromStr;

use crate::domain::{models::CreateDocumentRepoArgs, ports::DocumentService};
use ai::tool::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use anyhow::Context;
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use model_file_type::FileType;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::DocumentToolContext;

/// The read content response
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDocumentResponse {
    /// The id of the document
    pub document_id: uuid::Uuid,
}

#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(title = "CreateDocument", description = "Create a document")]
pub struct CreateDocument {
    #[schemars(description = "The name of the document without the file extension")]
    pub document_name: String,

    #[schemars(description = "The raw bytes of the local file you created.")]
    pub file_content_bytes: Vec<u8>,

    #[schemars(description = "The extension of the file you are going to create.")]
    pub file_extension: String,
}

#[async_trait]
impl<DSvc, ESvc> AsyncTool<DocumentToolContext<DSvc, ESvc>> for CreateDocument
where
    DSvc: DocumentService,
    ESvc: EntityAccessService,
{
    type Output = CreateDocumentResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DocumentToolContext<DSvc, ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "Create content");

        let parsed_file_type =
            FileType::from_str(&self.file_extension).map_err(|e| ToolCallError {
                description: format!("invalid file extension {}", self.file_extension),
                internal_error: e.into(),
            })?;
        let content_type = parsed_file_type.mime_type();
        let file_type: Option<FileType> = Some(parsed_file_type);

        let user_id: MacroUserIdStr<'static> = (*request_context.user_id).clone();

        let hashes = get_file_shas(&self.file_content_bytes).map_err(|e| ToolCallError {
            description: "could not get file content shas".to_string(),
            internal_error: e,
        })?;
        tracing::trace!("got file shas");

        let document_response = service_context
            .service
            .create_document(
                user_id.clone(),
                CreateDocumentRepoArgs {
                    id: None,
                    sha: hashes.0,
                    document_name: self.document_name.clone(),
                    user_id,
                    file_type,
                    project_id: None,
                    email_attachment_id: None,
                    created_at: None,
                    is_task: false,
                    skip_history: false,
                },
                None, // job_id
            )
            .await
            .map_err(|e| ToolCallError {
                description: "failed to create document".to_string(),
                internal_error: e.into(),
            })?;
        tracing::trace!("created document");

        let document_response = document_response.document_response;
        let document_metadata = document_response.document_metadata;

        let presigned_url = document_response
            .presigned_url
            .context("expected presigned url")
            .map_err(|e| ToolCallError {
                description: "presigned url was not generated".to_string(),
                internal_error: e,
            })?;

        let upload_response = reqwest::Client::new()
            .put(&presigned_url)
            .header("content-type", content_type)
            .header("x-amz-checksum-sha256", &hashes.1)
            .body(self.file_content_bytes.clone())
            .send()
            .await
            .map_err(|e| ToolCallError {
                description: "failed to upload file to presigned url".to_string(),
                internal_error: e.into(),
            })?;

        if !upload_response.status().is_success() {
            let status = upload_response.status();
            let body = upload_response.text().await.unwrap_or_default();
            return Err(ToolCallError {
                description: format!("presigned url upload failed with status {status}"),
                internal_error: anyhow::anyhow!("upload failed: {status} {body}"),
            });
        }

        tracing::info!("uploaded file");

        let document_id = document_metadata
            .document_id
            .parse()
            .context("expected valid uuid")
            .map_err(|e| ToolCallError {
                internal_error: e,
                description: format!(
                    "invalid document id was output {}",
                    document_metadata.document_id
                ),
            })?;

        tracing::info!("got to end");
        Ok(CreateDocumentResponse { document_id })
    }
}

#[tracing::instrument(skip(file_content), err)]
pub fn get_file_shas(file_content: &[u8]) -> anyhow::Result<(String, String)> {
    let mut hasher = Sha256::new();
    hasher.update(file_content);
    let file_hash_result = hasher.finalize();
    let base64_encoded_sha = base64::engine::general_purpose::STANDARD.encode(file_hash_result);

    let hash = format!("{:x}", file_hash_result);

    Ok((hash, base64_encoded_sha))
}
