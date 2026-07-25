//! Unified entity-mutation capability impls for chats.

use std::collections::HashSet;

use entity_access::domain::models::{
    AccessError, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use entity_mutation::{
    DeleteEntityPermanently, DuplicateEntity, EntityMutationErrorCode, MoveEntity, RenameEntity,
    RestoreEntity, TrashEntity, UpdateEntitySharePolicy, capability::MoveEntityRequest,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use models_permissions::share_permission::UpdateSharePermissionRequestV2;

use crate::domain::{
    models::{ChatErr, PatchChatArgs},
    ports::ChatService,
};

use super::chat::ChatServiceImpl;

impl From<ChatErr> for EntityMutationErrorCode {
    fn from(error: ChatErr) -> Self {
        match error {
            error @ ChatErr::NotFound => Self::not_found(rootcause::report!(error)),
            error @ ChatErr::BadRequest(_) => Self::invalid(rootcause::report!(error)),
            ChatErr::Access(error) => access_error(error),
            error @ ChatErr::Unknown(_) => Self::internal(rootcause::report!(error)),
        }
    }
}

/// Map an access-domain error onto the public mutation vocabulary.
fn access_error(error: AccessError) -> EntityMutationErrorCode {
    match error {
        error @ (AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_)) => {
            EntityMutationErrorCode::forbidden(rootcause::report!(error))
        }
        error @ AccessError::NotFound(_) => {
            EntityMutationErrorCode::not_found(rootcause::report!(error))
        }
        error @ AccessError::BadRequest(_) => {
            EntityMutationErrorCode::invalid(rootcause::report!(error))
        }
        error @ (AccessError::DatabaseError(_) | AccessError::Internal) => {
            EntityMutationErrorCode::internal(rootcause::report!(error))
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

/// Resolve the chat's containing project for affected-record reporting.
async fn chat_project_id<S: ChatService>(
    service: &S,
    owner_receipt: &EntityAccessReceipt<OwnerAccessLevel>,
) -> Option<String> {
    let view_receipt = owner_receipt
        .clone()
        .try_into_requirement::<ViewAccessLevel>()
        .ok()?;
    service.get_metadata(view_receipt).await.ok()?.project_id
}

impl<R, ToolSetContext, Eam> RenameEntity for ChatServiceImpl<R, ToolSetContext, Eam>
where
    ToolSetContext: Clone + Send + Sync + 'static,
    Self: ChatService,
{
    type Receipt = OwnerAccessLevel;

    async fn rename_entity(
        &self,
        _entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        display_name: String,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        self.patch(
            receipt,
            PatchChatArgs {
                name: Some(display_name),
                project_id: None,
                share_permission: None,
            },
        )
        .await?;
        Ok(Vec::new())
    }
}

impl<R, ToolSetContext, Eam> MoveEntity for ChatServiceImpl<R, ToolSetContext, Eam>
where
    ToolSetContext: Clone + Send + Sync + 'static,
    Self: ChatService,
{
    type Receipt = OwnerAccessLevel;

    async fn move_entity(
        &self,
        request: MoveEntityRequest<Self::Receipt>,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        let (receipt, project_id) = match request {
            MoveEntityRequest::MoveToRoot { receipt, .. } => (receipt, None),
            MoveEntityRequest::MoveToProject {
                receipt,
                project_id,
                project_receipt: _,
                ..
            } => (receipt, Some(project_id)),
        };
        let old_project_id = chat_project_id(self, &receipt).await;
        self.patch(
            receipt,
            PatchChatArgs {
                name: None,
                // The chat patch API uses an empty id to mean "root".
                project_id: Some(project_id.clone().unwrap_or_default()),
                share_permission: None,
            },
        )
        .await?;
        Ok(project_refs([old_project_id, project_id]))
    }
}

impl<R, ToolSetContext, Eam> UpdateEntitySharePolicy for ChatServiceImpl<R, ToolSetContext, Eam>
where
    ToolSetContext: Clone + Send + Sync + 'static,
    Self: ChatService,
{
    type Receipt = OwnerAccessLevel;

    async fn update_share_policy(
        &self,
        _entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        policy: UpdateSharePermissionRequestV2,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        self.patch(
            receipt,
            PatchChatArgs {
                name: None,
                project_id: None,
                share_permission: Some(policy),
            },
        )
        .await?;
        Ok(Vec::new())
    }
}

impl<R, ToolSetContext, Eam> TrashEntity for ChatServiceImpl<R, ToolSetContext, Eam>
where
    ToolSetContext: Clone + Send + Sync + 'static,
    Self: ChatService,
{
    type Receipt = OwnerAccessLevel;

    async fn trash_entity(
        &self,
        _entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        let project_id = chat_project_id(self, &receipt).await;
        self.delete(receipt).await?;
        Ok(project_refs([project_id]))
    }
}

impl<R, ToolSetContext, Eam> RestoreEntity for ChatServiceImpl<R, ToolSetContext, Eam>
where
    ToolSetContext: Clone + Send + Sync + 'static,
    Self: ChatService,
{
    type Receipt = OwnerAccessLevel;

    async fn restore_entity(
        &self,
        _entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        let project_id = chat_project_id(self, &receipt).await;
        self.revert_delete(receipt).await?;
        Ok(project_refs([project_id]))
    }
}

impl<R, ToolSetContext, Eam> DeleteEntityPermanently for ChatServiceImpl<R, ToolSetContext, Eam>
where
    ToolSetContext: Clone + Send + Sync + 'static,
    Self: ChatService,
{
    type Receipt = OwnerAccessLevel;

    async fn delete_entity_permanently(
        &self,
        _entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        let project_id = chat_project_id(self, &receipt).await;
        self.permanently_delete(receipt).await?;
        Ok(project_refs([project_id]))
    }
}

impl<R, ToolSetContext, Eam> DuplicateEntity for ChatServiceImpl<R, ToolSetContext, Eam>
where
    ToolSetContext: Clone + Send + Sync + 'static,
    Self: ChatService,
{
    type Receipt = ViewAccessLevel;

    async fn duplicate_entity(
        &self,
        _entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        _user_id: MacroUserIdStr<'static>,
        display_name: Option<String>,
    ) -> Result<Entity<'static>, EntityMutationErrorCode> {
        if display_name.is_some() {
            return Err(EntityMutationErrorCode::invalid(rootcause::report!(
                "chat duplication does not yet accept a custom display name".to_string()
            )));
        }
        let id = self.copy_chat(receipt).await?;
        Ok(EntityType::Chat.with_entity_string(id))
    }
}
