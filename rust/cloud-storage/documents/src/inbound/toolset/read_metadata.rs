//! ReadMetadata tool for reading document metadata.

use crate::domain::ports::DocumentService;
use ai::tool::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::{
    models::{AccessLevel, EntityType},
    ports::EntityAccessService,
};
use model::document::DocumentMetadata;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::DocumentToolContext;

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadDocumentMetadata {
    /// The document metadata
    #[serde(flatten)]
    document: DocumentMetadata,
    /// If the document is a "task" the branch name of the document will be provided.
    #[serde(skip_serializing_if = "Option::is_none")]
    branch_name: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadMetadataResponse {
    /// The metadata of the document
    pub document_metadata: ReadDocumentMetadata,
    /// The users level of access to the document
    pub user_access_level: AccessLevel,
}

#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(title = "ReadMetadata", description = "Retrieve a documents metadata")]
pub struct ReadMetadata {
    #[schemars(description = "The id of the document you want to retrieve metadata for.")]
    pub document_id: Uuid,
}

#[async_trait]
impl<DSvc, ESvc> AsyncTool<DocumentToolContext<DSvc, ESvc>> for ReadMetadata
where
    DSvc: DocumentService,
    ESvc: EntityAccessService,
{
    type Output = ReadMetadataResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DocumentToolContext<DSvc, ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "Read metadata");

        // Get EntityAccessReceipt
        let entity_access_receipt = service_context
            .entity_access_service
            .generate_entity_access_receipt(
                &request_context.user_id,
                None,
                &self.document_id.to_string(),
                EntityType::Document,
            )
            .await
            .map_err(|e| ToolCallError {
                description: "unable to get the entity access receipt".to_string(),
                internal_error: e.into(),
            })?;

        let result = service_context
            .service
            .get_document(entity_access_receipt)
            .await
            .map_err(|e| ToolCallError {
                description: "unable to get the document metadata".to_string(),
                internal_error: e.into(),
            })?;

        let branch_name = if let Some(sub_type) = result.document_metadata.sub_type {
            match sub_type {
                document_sub_type::DocumentSubType::Task => Some(construct_branch_name(
                    &result.document_metadata.document_id,
                    &result.document_metadata.document_name,
                )),
            }
        } else {
            None
        };

        let document_metadata = ReadDocumentMetadata {
            document: result.document_metadata,
            branch_name,
        };

        Ok(ReadMetadataResponse {
            document_metadata,
            user_access_level: result.user_access_level,
        })
    }
}

/// Constructs the branch name of a task from document id + document name
fn construct_branch_name(document_id: &str, document_name: &str) -> String {
    // SAFETY: this is fine as we know the id is a uuid
    let document_id = macro_uuid::string_to_uuid(document_id).unwrap();

    let short_uuid_converter = macro_uuid::ShortUuidConverter::default();
    let short_uuid = short_uuid_converter.from_uuid(&document_id);

    let slugified_name = document_name.replace(" ", "-").to_lowercase();

    format!("macro-{short_uuid}-{slugified_name}")
}
