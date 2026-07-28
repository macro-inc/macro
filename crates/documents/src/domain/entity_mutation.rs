//! Unified entity-mutation capability impls for documents.
//!
//! Each impl owns the mapping from the unified mutation vocabulary onto the
//! document service's own methods, preconditions, and errors, so the
//! composition layer routes without translating.

use std::collections::HashSet;

use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use entity_mutation::{
    DuplicateEntity, EntityMutationErrorCode, MoveEntity, RenameEntity, TrashEntity,
    UpdateEntitySharePolicy, capability::MoveEntityRequest,
};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::DocumentBasic;
use model_entity::{Entity, EntityType};
use models_permissions::share_permission::UpdateSharePermissionRequestV2;

use connection::domain::ports::ConnectionService;
use entity_access_management::domain::ports::EntityAccessManagementService;
use foreign_entity::domain::ports::ForeignEntityService;
use macro_event_broker::MacroEventBroker;

use super::{
    models::{DocumentError, EditDocumentServiceArgs},
    ports::{DocumentRepo, DocumentService, PresignedUploadUrlPort, TaskPropertiesPort},
    service::DocumentServiceImpl,
};

impl From<DocumentError> for EntityMutationErrorCode {
    fn from(error: DocumentError) -> Self {
        match error {
            error @ (DocumentError::NotFound(_) | DocumentError::Gone) => {
                Self::not_found(rootcause::report!(error))
            }
            error @ DocumentError::Unauthorized => Self::forbidden(rootcause::report!(error)),
            error @ DocumentError::Conflict(_) => Self::conflict(rootcause::report!(error)),
            error @ (DocumentError::BadRequest(_) | DocumentError::NameTooLong { .. }) => {
                Self::invalid(rootcause::report!(error))
            }
            error => Self::internal(rootcause::report!(error)),
        }
    }
}

/// Build affected project entities from optional container ids.
fn project_refs(ids: impl IntoIterator<Item = Option<String>>) -> Vec<Entity<'static>> {
    let mut seen = HashSet::new();
    ids.into_iter()
        .flatten()
        .filter(|id| !id.is_empty() && seen.insert(id.clone()))
        .map(|id| EntityType::Project.with_entity_string(id))
        .collect()
}

/// Fetch a document and reject the mutation if it is trashed.
async fn live_document<S: DocumentService>(
    service: &S,
    entity: &Entity<'static>,
    action: &str,
) -> Result<DocumentBasic, EntityMutationErrorCode> {
    let document = service
        .internal_get_basic_document(&entity.entity_id)
        .await?;
    if document.deleted_at.is_some() {
        return Err(EntityMutationErrorCode::conflict(rootcause::report!(
            format!("cannot {action} a deleted document")
        )));
    }
    Ok(document)
}

impl<
    R: DocumentRepo,
    U: PresignedUploadUrlPort,
    T: TaskPropertiesPort,
    C: ConnectionService,
    Eam: EntityAccessManagementService,
    F: ForeignEntityService,
    B: MacroEventBroker,
> RenameEntity for DocumentServiceImpl<R, U, T, C, Eam, F, B>
where
    Self: DocumentService,
{
    type Receipt = EditAccessLevel;

    async fn rename_entity(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        display_name: String,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        let document = live_document(self, &entity, "rename").await?;
        self.edit_document(
            receipt,
            document,
            EditDocumentServiceArgs {
                document_name: Some(display_name),
                project_id: None,
                share_permission: None,
                file_type: None,
            },
        )
        .await?;
        Ok(Vec::new())
    }
}

impl<
    R: DocumentRepo,
    U: PresignedUploadUrlPort,
    T: TaskPropertiesPort,
    C: ConnectionService,
    Eam: EntityAccessManagementService,
    F: ForeignEntityService,
    B: MacroEventBroker,
> MoveEntity for DocumentServiceImpl<R, U, T, C, Eam, F, B>
where
    Self: DocumentService,
{
    type Receipt = EditAccessLevel;

    async fn move_entity(
        &self,
        request: MoveEntityRequest<Self::Receipt>,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        let (entity, receipt, project_id) = match request {
            MoveEntityRequest::MoveToRoot { entity, receipt } => (entity, receipt, None),
            MoveEntityRequest::MoveToProject {
                entity,
                receipt,
                project_id,
                project_receipt: _,
            } => (entity, receipt, Some(project_id)),
        };
        let document = live_document(self, &entity, "move").await?;
        let old_project_id = document.project_id.clone().map(|id| id.to_string());
        self.edit_document(
            receipt,
            document,
            EditDocumentServiceArgs {
                document_name: None,
                // The document edit API uses an empty id to mean "root".
                project_id: Some(project_id.clone().unwrap_or_default()),
                share_permission: None,
                file_type: None,
            },
        )
        .await?;
        Ok(project_refs([old_project_id, project_id]))
    }
}

impl<
    R: DocumentRepo,
    U: PresignedUploadUrlPort,
    T: TaskPropertiesPort,
    C: ConnectionService,
    Eam: EntityAccessManagementService,
    F: ForeignEntityService,
    B: MacroEventBroker,
> UpdateEntitySharePolicy for DocumentServiceImpl<R, U, T, C, Eam, F, B>
where
    Self: DocumentService,
{
    type Receipt = EditAccessLevel;

    async fn update_share_policy(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        policy: UpdateSharePermissionRequestV2,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        let document = live_document(self, &entity, "update sharing for").await?;
        self.edit_document(
            receipt,
            document,
            EditDocumentServiceArgs {
                document_name: None,
                project_id: None,
                share_permission: Some(policy),
                file_type: None,
            },
        )
        .await?;
        Ok(Vec::new())
    }
}

impl<
    R: DocumentRepo,
    U: PresignedUploadUrlPort,
    T: TaskPropertiesPort,
    C: ConnectionService,
    Eam: EntityAccessManagementService,
    F: ForeignEntityService,
    B: MacroEventBroker,
> TrashEntity for DocumentServiceImpl<R, U, T, C, Eam, F, B>
where
    Self: DocumentService,
{
    type Receipt = OwnerAccessLevel;

    async fn trash_entity(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        let project_id = self
            .internal_get_basic_document(&entity.entity_id)
            .await?
            .project_id;
        let affected_project_id = project_id.clone().map(|id| id.to_string());
        self.delete_document(receipt, project_id).await?;
        Ok(project_refs([affected_project_id]))
    }
}

impl<
    R: DocumentRepo,
    U: PresignedUploadUrlPort,
    T: TaskPropertiesPort,
    C: ConnectionService,
    Eam: EntityAccessManagementService,
    F: ForeignEntityService,
    B: MacroEventBroker,
> DuplicateEntity for DocumentServiceImpl<R, U, T, C, Eam, F, B>
where
    Self: DocumentService,
{
    type Receipt = ViewAccessLevel;

    async fn duplicate_entity(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        user_id: MacroUserIdStr<'static>,
        display_name: Option<String>,
    ) -> Result<Entity<'static>, EntityMutationErrorCode> {
        let document = self.internal_get_basic_document(&entity.entity_id).await?;
        let display_name =
            display_name.unwrap_or_else(|| format!("{} copy", document.document_name));
        let response = self
            .copy_document(receipt, document, user_id, display_name, None, None)
            .await?;
        Ok(
            EntityType::Document
                .with_entity_string(response.document_metadata.metadata.document_id),
        )
    }
}
