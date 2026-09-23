//! UploadFile accepts inline bytes without access to the caller's filesystem.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use base64::{Engine, engine::general_purpose::STANDARD};
use entity_access::domain::{
    models::{BotAccessScope, EditAccessLevel, EntityType},
    ports::EntityAccessService,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::DocumentToolContext;
use crate::domain::{
    create::upload::{MAX_INLINE_UPLOAD_BYTES, NewFileUpload},
    models::DocumentError,
    ports::{DocumentService, create::DocumentCreationService, editing::EditingWorkerService},
};

#[cfg(test)]
mod test;

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "UploadFile",
    description = "Upload an existing file to Macro from base64-encoded bytes, up to 25 MiB decoded. Use for PDFs, images, Office files, and other files; use CreateDocument for generated text or native Macro spreadsheets. Encode actual file bytes programmatically; never invent or transcribe binary content. Returns a document ID after the bytes are uploaded; preview and indexing may finish asynchronously. Does not read local paths or fetch URLs."
)]
pub struct UploadFile {
    #[schemars(
        description = "Filename including its extension, for example report.pdf. Do not include a directory path."
    )]
    pub file_name: String,
    #[schemars(
        description = "Standard padded base64 of the exact file bytes (maximum 25 MiB decoded). No data URL prefix or whitespace. Prefer constructing this argument programmatically from the file."
    )]
    pub content_base64: String,
    #[serde(default)]
    #[schemars(
        description = "Optional destination project (folder) ID. Requires edit access. Omit to upload to the user's top-level files."
    )]
    pub project_id: Option<uuid::Uuid>,
}

/// Metadata for an uploaded file. Does not echo the file contents.
#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UploadFileResponse {
    /// ID of the new Macro document.
    pub document_id: String,
    /// Uploaded filename, including its extension.
    pub file_name: String,
    /// Number of uploaded bytes.
    pub size_bytes: usize,
}

impl ToolAnnotated for UploadFile {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Upload file");
}

fn upload_error(error: DocumentError) -> ToolCallError {
    let description = match &error {
        DocumentError::BadRequest(message) => message.clone(),
        DocumentError::NameTooLong { max } => {
            format!("filename is too long (maximum {max} characters)")
        }
        DocumentError::Unauthorized => {
            "you need edit access to the destination project".to_string()
        }
        _ => "failed to upload the file to Macro".to_string(),
    };
    ToolCallError {
        description,
        internal_error: error.into(),
    }
}

fn decode_content(content: &str) -> ToolResult<Vec<u8>> {
    // Reject oversized encoded input before allocating its decoded buffer.
    const MAX_ENCODED_BYTES: usize = MAX_INLINE_UPLOAD_BYTES.div_ceil(3) * 4;
    if content.len() > MAX_ENCODED_BYTES {
        return Err(upload_error(DocumentError::BadRequest(
            "file exceeds the 25 MiB inline upload limit".to_string(),
        )));
    }
    STANDARD.decode(content).map_err(|error| ToolCallError {
        description:
            "contentBase64 must be valid padded base64 without a data URL prefix or whitespace"
                .to_string(),
        internal_error: error.into(),
    })
}

#[async_trait]
impl<DSvc, ESvc, EDSvc> AsyncTool<DocumentToolContext<DSvc, ESvc, EDSvc>> for UploadFile
where
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
{
    type Output = UploadFileResponse;

    async fn call(
        &self,
        service_context: ServiceContext<DocumentToolContext<DSvc, ESvc, EDSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let bytes = decode_content(&self.content_base64)?;
        let size_bytes = bytes.len();
        let project = match self.project_id {
            Some(project_id) => Some(
                service_context
                    .entity_access_service
                    .generate_bot_entity_access_receipt::<EditAccessLevel>(
                        service_context.actor,
                        BotAccessScope::user(request_context.user_id.clone()),
                        &project_id.to_string(),
                        EntityType::Project,
                    )
                    .await
                    .map_err(|error| ToolCallError {
                        description:
                            "you need edit access to the destination project, or it does not exist"
                                .to_string(),
                        internal_error: error.into(),
                    })?,
            ),
            None => None,
        };
        let created = service_context
            .creator
            .upload_file(
                request_context.user_id.clone(),
                NewFileUpload {
                    file_name: self.file_name.clone(),
                    bytes,
                    project,
                    attribution: service_context.attribution(request_context.user_id),
                },
            )
            .await
            .map_err(upload_error)?;

        Ok(UploadFileResponse {
            document_id: created.document_id().to_string(),
            file_name: self.file_name.clone(),
            size_bytes,
        })
    }
}
