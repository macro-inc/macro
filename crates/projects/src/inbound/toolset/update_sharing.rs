//! UpdateSharing tool for changing link, team, and channel sharing on
//! documents, AI chats, and projects.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use entity_mutation::{MoveEntity, UpdateEntitySharePolicy};
use model_entity::{Entity, EntityType};
use models_permissions::share_permission::{
    LinkShare, UpdateSharePermissionRequestV2,
    access_level::AccessLevel,
    channel_share_permission::{UpdateChannelSharePermission, UpdateOperation},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::entity_receipts::{mutation_failed, user_receipt};
use super::{ChatCapabilities, DocumentCapabilities, ProjectCapabilities, ProjectToolContext};

/// The kind of item whose sharing changes.
#[derive(Debug, Deserialize, Serialize, JsonSchema, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SharingEntityType {
    /// A document (includes tasks).
    Document,
    /// An AI chat conversation.
    Chat,
    /// A project (folder).
    Project,
}

impl SharingEntityType {
    fn entity_type(self) -> EntityType {
        match self {
            Self::Document => EntityType::Document,
            Self::Chat => EntityType::Chat,
            Self::Project => EntityType::Project,
        }
    }
}

/// A share can be disabled or grant a non-owner permission.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ShareAccess {
    /// Disable this share.
    Off,
    /// View only.
    View,
    /// View and comment.
    Comment,
    /// Edit.
    Edit,
}

impl ShareAccess {
    fn level(self) -> Option<AccessLevel> {
        match self {
            Self::Off => None,
            Self::View => Some(AccessLevel::View),
            Self::Comment => Some(AccessLevel::Comment),
            Self::Edit => Some(AccessLevel::Edit),
        }
    }
}

/// Who an item's share link admits.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ShareLinkScope {
    /// Disable link sharing.
    Off,
    /// Anyone with the link.
    Public,
    /// Members of the owner's team with the link.
    Team,
}

/// One channel's grant to set or remove.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SharingChannel {
    /// Channel id to share with or revoke.
    #[schemars(description = "Channel id to share with or revoke.")]
    pub channel_id: Uuid,
    /// Desired grant; off removes only this channel's grant.
    #[schemars(description = "Desired grant; off removes only this channel's grant.")]
    pub access: ShareAccess,
}

const SHARE_FORBIDDEN: &str = "changing sharing requires edit access to a document and owning an AI chat or project; only the owner can change team access";

/// Apply a share-policy update through the domain capability, as the user.
async fn share_with<S, ESvc>(
    service: &S,
    entity_access_service: &ESvc,
    request_context: &RequestContext,
    entity: Entity<'static>,
    policy: UpdateSharePermissionRequestV2,
) -> ToolResult<()>
where
    S: UpdateEntitySharePolicy,
    ESvc: EntityAccessService,
{
    let receipt =
        user_receipt::<S::Receipt, _>(entity_access_service, request_context, &entity).await?;
    service
        .update_share_policy(entity, receipt, policy)
        .await
        .map_err(mutation_failed("share", SHARE_FORBIDDEN))?;
    Ok(())
}

/// The update sharing response.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSharingResponse {
    /// The kind of item whose sharing changed.
    pub entity_type: SharingEntityType,
    /// The item's id.
    pub entity_id: Uuid,
    /// A human-readable summary of the change.
    pub message: String,
}

/// UpdateSharing tool input.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "UpdateSharing",
    description = "Change who can access a document (including a task), an AI chat, or a project (folder), as the Share menu in the app does: link sharing, team access, and per-channel access. Each omitted field stays unchanged; off disables that share. Requires edit access to a document, or owning an AI chat or project; only the owner can change team access. Use ShareWithChannel to post an item into a channel, and UpdateInitiativeSharing for Tasks projects (initiatives)."
)]
pub struct UpdateSharing {
    /// The kind of item whose sharing changes.
    #[schemars(description = "The kind of item whose sharing changes.")]
    pub entity_type: SharingEntityType,
    /// The item's id.
    #[schemars(description = "The id of the item whose sharing changes.")]
    pub entity_id: Uuid,
    /// Who the share link admits.
    #[schemars(
        description = "Who the item's share link admits: public (anyone with the link), team (the owner's team members with the link), or off to disable link sharing."
    )]
    #[serde(default)]
    pub link_scope: Option<ShareLinkScope>,
    /// Permission granted by an enabled link.
    #[schemars(
        description = "Permission granted by an enabled share link. Off resets it to the default level."
    )]
    #[serde(default)]
    pub link_access: Option<ShareAccess>,
    /// Explicit owner-team grant.
    #[schemars(description = "Access for everyone on the owner's team; off removes it.")]
    #[serde(default)]
    pub team_access: Option<ShareAccess>,
    /// Channel grants to set or remove.
    #[schemars(
        description = "Individual channel grants to set or remove; other channel grants stay unchanged."
    )]
    #[serde(default)]
    pub channels: Option<Vec<SharingChannel>>,
}

impl UpdateSharing {
    pub(super) fn policy(&self) -> UpdateSharePermissionRequestV2 {
        UpdateSharePermissionRequestV2 {
            link_share: self.link_scope.map(|scope| match scope {
                ShareLinkScope::Off => None,
                ShareLinkScope::Public => Some(LinkShare::Public),
                ShareLinkScope::Team => Some(LinkShare::Team),
            }),
            link_share_access_level: self.link_access.map(ShareAccess::level),
            team_share_access_level: self.team_access.map(ShareAccess::level),
            channel_share_permissions: self.channels.as_ref().map(|channels| {
                channels
                    .iter()
                    .map(|channel| UpdateChannelSharePermission {
                        operation: if channel.access == ShareAccess::Off {
                            UpdateOperation::Remove
                        } else {
                            UpdateOperation::Replace
                        },
                        channel_id: channel.channel_id.to_string(),
                        access_level: channel.access.level(),
                    })
                    .collect()
            }),
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.link_scope.is_none()
            && self.link_access.is_none()
            && self.team_access.is_none()
            && self.channels.as_ref().is_none_or(Vec::is_empty)
    }
}

impl ToolAnnotated for UpdateSharing {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Change sharing").with_idempotent();
}

#[async_trait]
impl<PSvc, ESvc, DSvc, CSvc, EmSvc> AsyncTool<ProjectToolContext<PSvc, ESvc, DSvc, CSvc, EmSvc>>
    for UpdateSharing
where
    PSvc: ProjectCapabilities,
    ESvc: EntityAccessService,
    DSvc: DocumentCapabilities,
    CSvc: ChatCapabilities,
    EmSvc: MoveEntity + Send + Sync + 'static,
{
    type Output = UpdateSharingResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, entity_type=?self.entity_type, entity_id=?self.entity_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ProjectToolContext<PSvc, ESvc, DSvc, CSvc, EmSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        if self.is_empty() {
            return Err(ToolCallError {
                description:
                    "nothing to change: set at least one of linkScope, linkAccess, teamAccess, or channels"
                        .to_string(),
                internal_error: anyhow::anyhow!("empty sharing update"),
            });
        }
        let entity = self
            .entity_type
            .entity_type()
            .with_entity_string(self.entity_id.to_string());
        let policy = self.policy();
        let access = &*service_context.entity_access_service;
        match self.entity_type {
            SharingEntityType::Document => {
                share_with(
                    &*service_context.document_move_service,
                    access,
                    &request_context,
                    entity,
                    policy,
                )
                .await?
            }
            SharingEntityType::Chat => {
                share_with(
                    &*service_context.chat_move_service,
                    access,
                    &request_context,
                    entity,
                    policy,
                )
                .await?
            }
            SharingEntityType::Project => {
                share_with(
                    &*service_context.service,
                    access,
                    &request_context,
                    entity,
                    policy,
                )
                .await?
            }
        }

        Ok(UpdateSharingResponse {
            entity_type: self.entity_type,
            entity_id: self.entity_id,
            message: format!("Updated sharing on the {}.", self.entity_type.entity_type()),
        })
    }
}
