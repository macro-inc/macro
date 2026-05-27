//! ReadMetadata tool for reading document metadata.

use crate::domain::ports::{DocumentService, create::DocumentCreationService};
use crate::domain::response::DocumentMetadataWithContent;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::{
    models::{AccessLevel, EntityType},
    ports::EntityAccessService,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::DocumentToolContext;

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadDocumentMetadata {
    /// The document metadata
    #[serde(flatten)]
    document: DocumentMetadataWithContent,
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
    DSvc: DocumentService + DocumentCreationService,
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
            .get_document(entity_access_receipt.clone())
            .await
            .map_err(|e| ToolCallError {
                description: "unable to get the document metadata".to_string(),
                internal_error: e.into(),
            })?;

        let branch_name = if let Some(sub_type) = result.document_metadata.metadata.sub_type {
            match sub_type {
                document_sub_type::DocumentSubType::Task => {
                    let task_branch_name = service_context
                        .service
                        .get_task_branch_name(
                            entity_access_receipt,
                            result.document_metadata.metadata.document_name.clone(),
                        )
                        .await
                        .map_err(|e| ToolCallError {
                            description: "unable to get the branch name".to_string(),
                            internal_error: e.into(),
                        })?;

                    Some(task_branch_name.branch_name)
                }
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
