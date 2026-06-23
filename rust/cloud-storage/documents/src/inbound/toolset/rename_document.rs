//! RenameDocument tool for renaming documents.

use crate::domain::{
    models::{DocumentError, EditDocumentServiceArgs},
    ports::{DocumentService, create::DocumentCreationService},
};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::{models::EntityType, ports::EntityAccessService};
use models_permissions::share_permission::access_level::EditAccessLevel;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::DocumentToolContext;

fn rename_document_args(document_name: String) -> EditDocumentServiceArgs {
    EditDocumentServiceArgs {
        document_name: Some(document_name),
        project_id: None,
        share_permission: None,
        file_type: None,
    }
}

fn deleted_document_error() -> ToolCallError {
    let description = "cannot modify deleted document".to_string();

    ToolCallError {
        description: description.clone(),
        internal_error: DocumentError::BadRequest(description).into(),
    }
}

/// The rename document response.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RenameDocumentResponse {
    /// Whether the rename succeeded.
    pub success: bool,
    /// The id of the renamed document.
    pub document_id: Uuid,
    /// A human-readable result message.
    pub message: String,
}

#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "RenameDocument",
    description = "Rename a document. Requires edit access to the document."
)]
pub struct RenameDocument {
    #[schemars(description = "The id of the document you want to rename.")]
    pub document_id: Uuid,

    #[schemars(description = "The new name for the document without the file extension.")]
    pub document_name: String,
}

#[async_trait]
impl<DSvc, ESvc> AsyncTool<DocumentToolContext<DSvc, ESvc>> for RenameDocument
where
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
{
    type Output = RenameDocumentResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, document_id=?self.document_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DocumentToolContext<DSvc, ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "Rename document");

        let document_id = self.document_id.to_string();

        let entity_access_receipt = service_context
            .entity_access_service
            .generate_entity_access_receipt::<EditAccessLevel>(
                &request_context.user_id,
                None,
                &document_id,
                EntityType::Document,
            )
            .await
            .map_err(|e| ToolCallError {
                description: "unable to get the entity access receipt".to_string(),
                internal_error: e.into(),
            })?;

        // SAFETY: This is allowed because the user has edit access from the receipt above.
        let document_context = service_context
            .service
            .internal_get_basic_document(&document_id)
            .await
            .map_err(|e| ToolCallError {
                description: "unable to get the document context".to_string(),
                internal_error: e.into(),
            })?;

        if document_context.deleted_at.is_some() {
            return Err(deleted_document_error());
        }

        service_context
            .service
            .edit_document(
                entity_access_receipt,
                document_context,
                rename_document_args(self.document_name.clone()),
            )
            .await
            .map_err(|e| ToolCallError {
                description: "unable to rename document".to_string(),
                internal_error: e.into(),
            })?;

        Ok(RenameDocumentResponse {
            success: true,
            document_id: self.document_id,
            message: "Document renamed successfully".to_string(),
        })
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_rename_document_args_sets_only_document_name() {
        let args = rename_document_args("Renamed document".to_string());

        assert_eq!(args.document_name.as_deref(), Some("Renamed document"));
        assert!(args.project_id.is_none());
        assert!(args.share_permission.is_none());
        assert!(args.file_type.is_none());
    }
}
