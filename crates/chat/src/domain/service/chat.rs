//! Default [`ChatService`] implementation backed by a [`ChatRepo`].

mod purge_owned;
#[cfg(test)]
mod test;

use crate::domain::{
    events::{
        ChatCopiedMetadata, ChatDeletedMetadata, ChatMacroEvent, ChatPermanentlyDeletedMetadata,
        ChatRestoredMetadata, ChatUpdatedMetadata,
    },
    models::{ChatErr, CopyChatArgs, GetChatResponse, PatchChatArgs, PatchChatRepoArgs, Result},
    ports::{ChatRepo, ChatService},
};
use entity_access::domain::models::{
    AccessError, AccessLevel, EditAccessLevel, EntityAccessAuth, EntityAccessReceipt,
    EntityPermission, OwnerAccessLevel, ViewAccessLevel,
};
use entity_access_management::domain::ports::EntityAccessManagementService;
use macro_event_broker::{MacroEventBroker, NoopMacroEventBroker};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_owner::Owner;
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareLevel, TeamSharePolicyError, TeamShareRequest,
    authorize_team_share,
};
use unicode_segmentation::UnicodeSegmentation;

/// Concrete service implementation that delegates to a [`ChatRepo`]
pub struct ChatServiceImpl<R, Eam, B = NoopMacroEventBroker>
where
    B: MacroEventBroker,
{
    repo: R,
    entity_access_management_service: Eam,
    event_broker: B,
}

/// The user id to attribute a chat lifecycle event to, when the caller is an
/// authenticated user.
fn event_actor_user_id(auth: &EntityAccessAuth) -> Option<MacroUserIdStr<'static>> {
    match auth {
        EntityAccessAuth::Authenticated(user_id) => Some(user_id.clone()),
        EntityAccessAuth::Bot(_)
        | EntityAccessAuth::Unauthenticated
        | EntityAccessAuth::Internal => None,
    }
}

impl<R: ChatRepo, Eam: EntityAccessManagementService> ChatServiceImpl<R, Eam> {
    /// Create a new [`ChatServiceImpl`] wrapping the given repo.
    pub fn new(repo: R, entity_access_management_service: Eam) -> Self {
        Self {
            repo,
            entity_access_management_service,
            event_broker: NoopMacroEventBroker,
        }
    }
}

impl<R: ChatRepo, Eam: EntityAccessManagementService, B: MacroEventBroker>
    ChatServiceImpl<R, Eam, B>
{
    /// Replaces the event broker while preserving every other service dependency.
    pub fn with_event_broker<B2: MacroEventBroker>(
        self,
        event_broker: B2,
    ) -> ChatServiceImpl<R, Eam, B2> {
        ChatServiceImpl {
            repo: self.repo,
            entity_access_management_service: self.entity_access_management_service,
            event_broker,
        }
    }

    /// Publish a chat lifecycle event; failures are logged and dropped.
    fn publish_chat_event(&self, event: &ChatMacroEvent) {
        drop(self.event_broker.send_event(event).inspect_err(|error| {
            tracing::error!(error = ?error, "failed to schedule chat event");
        }));
    }

    /// Authorize an explicit team-share change against the persisted owner.
    ///
    /// Returns `Ok(None)` without loading anything when the request omits the
    /// team level, so ordinary renames and moves never take the team-share
    /// guard. Effective Owner access (for example via a project) is not enough:
    /// only the chat's actual owner may share it with their team.
    async fn authorize_chat_team_share(
        &self,
        receipt: &EntityAccessReceipt<OwnerAccessLevel>,
        request: TeamShareRequest,
    ) -> Result<Option<AuthorizedTeamShareCommand>> {
        if request == TeamShareRequest::default() {
            return Ok(None);
        }
        let facts = self
            .repo
            .get_team_share_facts(&receipt.entity().entity_id)
            .await?;
        authorize_team_share(
            receipt.acting_user_id(),
            &facts,
            request,
            TeamShareLevel::Edit,
        )
        .map_err(|error| match error {
            TeamSharePolicyError::MissingActor | TeamSharePolicyError::NotOwner => {
                ChatErr::Access(AccessError::Unauthorized)
            }
            TeamSharePolicyError::InvalidRevision => ChatErr::Conflict(error.to_string()),
            TeamSharePolicyError::MissingTeam
            | TeamSharePolicyError::InvalidLevel
            | TeamSharePolicyError::ContradictoryInputs => ChatErr::BadRequest(error.to_string()),
        })
    }
}

impl<R: ChatRepo, Eam: EntityAccessManagementService, B: MacroEventBroker> ChatService
    for ChatServiceImpl<R, Eam, B>
{
    #[tracing::instrument(err, skip(self))]
    async fn get_chat(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<GetChatResponse> {
        let chat_id = &entity_access_receipt.entity().entity_id;

        // Anonymous public-link viewers hold an Unauthenticated receipt: there
        // is no user to look up an access level for, so report the level the
        // receipt was granted with (the chat's public access level).
        if let EntityAccessAuth::Authenticated(user_id) = entity_access_receipt.auth() {
            let (chat, access_level) = tokio::join!(
                self.repo.get_chat(chat_id),
                self.repo.get_access_level(user_id.to_owned(), chat_id),
            );

            return Ok(GetChatResponse {
                chat: chat?,
                user_access_level: access_level?,
            });
        }

        let chat = self.repo.get_chat(chat_id).await?;
        let user_access_level = match entity_access_receipt.entity_permission() {
            EntityPermission::AccessLevel { access_level } => *access_level,
            _ => AccessLevel::View,
        };

        Ok(GetChatResponse {
            chat,
            user_access_level,
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_metadata(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<model::chat::Chat> {
        self.repo
            .get_metadata(&entity_access_receipt.entity().entity_id)
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn copy_chat(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String> {
        let user_id = entity_access_receipt.get_authenticated_user()?;
        let chat_id = &entity_access_receipt.entity().entity_id;

        let chat = self.repo.get_metadata(chat_id).await?;
        let name = format!("{} Copy", chat.name);

        // The copier becomes the owner, so their team default decides the
        // copy's initial share permission.
        let owner = Owner::User(user_id.to_owned());
        let team_default = self.repo.get_team_default_link_share(&owner).await?;
        let share_permission = SharePermissionV2::new_chat_share_permission(team_default);

        let new_chat_id = self
            .repo
            .copy_chat(
                owner,
                chat_id,
                CopyChatArgs {
                    name: name.clone(),
                    project_id: None,
                },
                share_permission,
            )
            .await?;

        self.publish_chat_event(&ChatMacroEvent::copied(ChatCopiedMetadata {
            chat_id: new_chat_id.clone(),
            source_chat_id: chat_id.clone(),
            owner: user_id.clone(),
            name,
        }));

        Ok(new_chat_id)
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<()> {
        let chat_id = &entity_access_receipt.entity().entity_id;
        let project_id = self
            .repo
            .get_metadata(chat_id)
            .await
            .ok()
            .and_then(|c| c.project_id);
        self.repo.delete(chat_id).await?;

        if let Some(project_id) = &project_id
            && !project_id.is_empty()
            && let (Ok(chat_uuid), Ok(project_uuid)) = (
                uuid::Uuid::parse_str(chat_id),
                uuid::Uuid::parse_str(project_id),
            )
        {
            let _ = self
                .entity_access_management_service
                .remove_entity_from_project(&chat_uuid, EntityType::Chat, &project_uuid)
                .await
                .inspect_err(|e| tracing::error!(error=?e, project_id=?project_id, "unable to remove entity from project"));
            let _ = self.repo.update_project_modified(project_id).await.inspect_err(
                |e| tracing::error!(error=?e, project_id=?project_id, "unable to update project modified date"),
            );
        }

        self.publish_chat_event(&ChatMacroEvent::deleted(ChatDeletedMetadata {
            chat_id: chat_id.clone(),
            actor_user_id: event_actor_user_id(entity_access_receipt.auth()),
            project_id,
        }));

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn permanently_delete(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<()> {
        let chat_id = &entity_access_receipt.entity().entity_id;
        let project_id = self
            .repo
            .get_metadata(chat_id)
            .await
            .ok()
            .and_then(|c| c.project_id);
        self.repo.permanently_delete(chat_id).await?;

        if let Some(project_id) = &project_id
            && !project_id.is_empty()
            && let (Ok(chat_uuid), Ok(project_uuid)) = (
                uuid::Uuid::parse_str(chat_id),
                uuid::Uuid::parse_str(project_id),
            )
        {
            let _ = self
                .entity_access_management_service
                .remove_entity_from_project(&chat_uuid, EntityType::Chat, &project_uuid)
                .await
                .inspect_err(|e| tracing::error!(error=?e, project_id=?project_id, "unable to remove entity from project"));
            let _ = self.repo.update_project_modified(project_id).await.inspect_err(
                |e| tracing::error!(error=?e, project_id=?project_id, "unable to update project modified date"),
            );
        }

        self.publish_chat_event(&ChatMacroEvent::permanently_deleted(
            ChatPermanentlyDeletedMetadata {
                chat_id: chat_id.clone(),
                actor_user_id: event_actor_user_id(entity_access_receipt.auth()),
                project_id,
            },
        ));

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn patch(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        args: PatchChatArgs,
    ) -> Result<()> {
        if let Some(name) = args.name.as_ref()
            && name.graphemes(true).count() > 100
        {
            return Err(ChatErr::BadRequest("name too long".to_string()));
        }
        let user_id = entity_access_receipt.get_authenticated_user()?;
        let chat_id = &entity_access_receipt.entity().entity_id;

        // Team sharing is authorized against the persisted owner before any
        // write; a rejected request returns here and publishes nothing.
        let team_share = self
            .authorize_chat_team_share(
                &entity_access_receipt,
                TeamShareRequest {
                    access_level: args
                        .share_permission
                        .as_ref()
                        .and_then(|p| p.team_share_access_level),
                    legacy_enabled: None,
                },
            )
            .await?;

        let old_project_id = self
            .repo
            .get_metadata(chat_id)
            .await
            .ok()
            .and_then(|c| c.project_id);
        let new_project_id = args.project_id.clone();
        let project_changing =
            new_project_id.is_some() && new_project_id.as_deref() != old_project_id.as_deref();
        let name = args.name.clone();
        let share_permission_updated = args.share_permission.is_some();

        self.repo
            .patch(
                user_id.to_owned(),
                chat_id,
                PatchChatRepoArgs {
                    name: args.name,
                    project_id: args.project_id,
                    share_permission: args.share_permission,
                    team_share,
                },
            )
            .await?;

        // Remove from old project (only if the project is actually changing)
        if project_changing
            && let Some(old_project_id) = &old_project_id
            && !old_project_id.is_empty()
            && let (Ok(chat_uuid), Ok(old_uuid)) = (
                uuid::Uuid::parse_str(chat_id),
                uuid::Uuid::parse_str(old_project_id),
            )
        {
            let _ = self
                .entity_access_management_service
                .remove_entity_from_project(&chat_uuid, EntityType::Chat, &old_uuid)
                .await
                .inspect_err(|e| tracing::error!(error=?e, project_id=?old_project_id, "unable to remove entity from project"));
            let _ = self.repo.update_project_modified(old_project_id).await.inspect_err(
                |e| tracing::error!(error=?e, project_id=?old_project_id, "unable to update project modified date"),
            );
        }

        // Add to new project's entity access + bump modified timestamp
        if let Some(new_project_id) = &new_project_id
            && !new_project_id.is_empty()
            && let (Ok(chat_uuid), Ok(new_uuid)) = (
                uuid::Uuid::parse_str(chat_id),
                uuid::Uuid::parse_str(new_project_id),
            )
        {
            let _ = self
                .entity_access_management_service
                .add_entity_to_project(&chat_uuid, EntityType::Chat, &new_uuid)
                .await
                .inspect_err(|e| tracing::error!(error=?e, project_id=?new_project_id, "unable to add entity to project"));
            let _ = self.repo.update_project_modified(new_project_id).await.inspect_err(
                |e| tracing::error!(error=?e, project_id=?new_project_id, "unable to update project modified date"),
            );
        }

        self.publish_chat_event(&ChatMacroEvent::updated(ChatUpdatedMetadata {
            chat_id: chat_id.clone(),
            actor_user_id: user_id.clone(),
            name,
            previous_project_id: old_project_id,
            project_id: new_project_id,
            share_permission_updated,
        }));

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn revert_delete(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<()> {
        let chat_id = &entity_access_receipt.entity().entity_id;
        let chat = self.repo.get_metadata(chat_id).await?;
        self.repo
            .revert_delete(chat_id, chat.project_id.as_deref())
            .await?;

        self.publish_chat_event(&ChatMacroEvent::restored(ChatRestoredMetadata {
            chat_id: chat_id.clone(),
            actor_user_id: event_actor_user_id(entity_access_receipt.auth()),
            project_id: chat.project_id,
        }));

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_permissions(
        &self,
        entity_access_receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<SharePermissionV2> {
        let chat_id = &entity_access_receipt.entity().entity_id;
        self.repo.get_permissions(chat_id).await
    }
}
