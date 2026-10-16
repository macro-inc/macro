//! Share one item with the current members of a channel.

use super::{ChannelToolContext, channel_mutation_error};
use crate::domain::{
    models::{ReferenceShareOutcome, ReferencedShareItem, ReferencedShareItemType},
    ports::ChannelService,
};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Entity types a channel grant can cover.
///
/// Values are the stored entity types. `calendar` is accepted for a calendar
/// chip, whose stored type is `calendar_event`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChannelShareEntityType {
    /// A calendar event. A calendar chip's `documentId` is this id.
    #[serde(alias = "calendar")]
    CalendarEvent,
    /// A document.
    Document,
    /// An AI chat.
    Chat,
    /// A project.
    Project,
    /// A database.
    Database,
    /// A form.
    Form,
    /// A call.
    Call,
    /// An email thread.
    #[serde(rename = "thread", alias = "email", alias = "email_thread")]
    EmailThread,
    /// An agent session.
    AgentSession,
}

impl ChannelShareEntityType {
    fn to_domain(self) -> ReferencedShareItemType {
        match self {
            Self::CalendarEvent => ReferencedShareItemType::CalendarEvent,
            Self::Document => ReferencedShareItemType::Document,
            Self::Chat => ReferencedShareItemType::Chat,
            Self::Project => ReferencedShareItemType::Project,
            Self::Database => ReferencedShareItemType::Database,
            Self::Form => ReferencedShareItemType::Form,
            Self::Call => ReferencedShareItemType::Call,
            Self::EmailThread => ReferencedShareItemType::EmailThread,
            Self::AgentSession => ReferencedShareItemType::AgentSession,
        }
    }

    fn not_permitted(self) -> &'static str {
        match self {
            Self::CalendarEvent => {
                "you can only share a calendar event you hold on your own calendar, and private or confidential events are not shared"
            }
            Self::AgentSession => "you can only share an agent session you own",
            _ => "you need access to this item before it can be shared with the channel",
        }
    }
}

/// Grant the current members of a channel access to one item.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ShareWithChannel",
    description = "Share an item with the current members of a channel by writing a channel entity-access grant. Call it only after the user agrees to share that item, or when they already asked you to share it. entityType is the stored type: calendar_event for a calendar chip, document, chat, project, database, form, call, thread, or agent_session. entityId is that item's id. A calendar event can be shared only by someone who holds it on their own calendar, and private or confidential events are refused. Sharing again is safe when a grant already exists."
)]
pub struct ShareWithChannel {
    /// Channel whose current members should receive the grant.
    #[schemars(description = "Channel id whose current members should be able to view the item.")]
    pub channel_id: Uuid,
    /// Id of the item to share.
    #[schemars(
        description = "Id of the item to share. For a calendar chip this is the event id in documentId."
    )]
    pub entity_id: String,
    /// Stored entity type of the item.
    #[schemars(
        description = "Stored entity type: calendar_event, document, chat, project, database, form, call, thread, or agent_session."
    )]
    pub entity_type: ChannelShareEntityType,
}

/// Confirmation that the channel grant is in place.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShareWithChannelResponse {
    /// Channel that received the grant.
    pub channel_id: Uuid,
    /// Shared entity id.
    pub entity_id: String,
    /// Stored entity type that was shared.
    pub entity_type: ChannelShareEntityType,
    /// Human-readable result.
    pub summary: String,
}

impl ToolAnnotated for ShareWithChannel {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::additive("Share with channel").with_idempotent();
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<ChannelToolContext<Svc, AccessSvc>> for ShareWithChannel
where
    Svc: ChannelService,
    AccessSvc: EntityAccessService,
{
    type Output = ShareWithChannelResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ChannelToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let entity_id = self.entity_id.trim();
        if Uuid::parse_str(entity_id).is_err() {
            return Err(ToolCallError {
                description: "entityId must be the item's uuid".to_string(),
                internal_error: anyhow::anyhow!("invalid share entity id"),
            });
        }
        service_context
            .require_channel_member(&request_context, self.channel_id)
            .await?;

        let item = ReferencedShareItem::new(entity_id, self.entity_type.to_domain());
        let results = service_context
            .service
            .share_referenced_items_with_channel(
                request_context.user_id.clone(),
                self.channel_id,
                vec![item],
            )
            .await
            .map_err(|error| channel_mutation_error("share with the channel", error))?;
        let shared = results
            .iter()
            .any(|result| result.outcome == ReferenceShareOutcome::Shared);
        if !shared {
            return Err(ToolCallError {
                description: self.entity_type.not_permitted().to_string(),
                internal_error: anyhow::anyhow!("reference share was not permitted"),
            });
        }

        Ok(ShareWithChannelResponse {
            channel_id: self.channel_id,
            entity_id: entity_id.to_string(),
            entity_type: self.entity_type,
            summary: "Shared with the current members of the channel.".to_string(),
        })
    }
}
