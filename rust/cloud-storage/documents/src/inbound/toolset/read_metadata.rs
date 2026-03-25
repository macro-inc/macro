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
pub struct ReadMetadataResponse {
    /// The metadata of the document
    pub document_metadata: DocumentMetadata,
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

        Ok(ReadMetadataResponse {
            document_metadata: result.document_metadata,
            user_access_level: result.user_access_level,
        })
    }
}
