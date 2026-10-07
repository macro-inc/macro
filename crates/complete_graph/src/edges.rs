use std::{collections::HashMap, future::Future, marker::PhantomData, pin::Pin, sync::Arc};

use agent_session::domain::{
    model::{AgentSessionId, SessionBot, StoredAgentSessionLog},
    ports::{AgentSessionLogRepo, AgentSessionRepo},
};
use async_graphql::{Context, ID, Json, Object, SimpleObject, dataloader::DataLoader};
use bots::domain::{
    models::{BotId, BotProfile},
    ports::BotRepo,
};
use graphql_activity::{
    ActivityEdgeKey, GraphqlActivityEvent, SoupActivityEdgeReader, load_entity_activity,
    parse_activity_edge_limit,
};
use graphql_email::{
    EmailContentKey, GraphqlSoupEmailMessage, SoupEmailEdgeReader,
    email_message_selection_requires_full_payload, load_email_messages,
    load_email_thread_mail_projection, load_email_thread_metadata, load_latest_email_message,
};
use graphql_favorite::{EntityFavoriteEdgeReader, load_entity_favorite};
use graphql_notification::{
    GraphqlNotification, GraphqlNotificationFilter, SoupNotificationEdgeReader,
    load_entity_notifications,
};
use graphql_permission::{
    EntityPermissionEdgeReader, GraphqlEntityPermission, load_entity_permission,
};
use graphql_properties::{EntityPropertyReader, GraphqlProperty, load_entity_properties};
use graphql_soup::SoupEntityEdges;
use predicate_index::{RecordKey, utc_timestamp_micros};
use soup_filter_projection::{
    MailCacheProjectionFacts, SoupCacheProjectionSupplement, encode_cache_projection_supplement,
};
use uuid::Uuid;

/// The types of the edge readers for soup
type EdgeReaders<NR, PR, ER, FR, AR, AcR> = PhantomData<fn() -> (NR, PR, ER, FR, AR, AcR)>;

/// Notification, property, email-content, favorite, permission, and activity
/// fields attached to Soup entities.
///
/// This concrete edge shape lives in the composition crate so `graphql_soup`
/// does not know which cross-domain fields are attached to its objects.
pub struct SoupEdges<NR, PR, ER, FR, AR, AcR> {
    /// Entity whose cross-domain fields are being resolved.
    entity: model_entity::Entity<'static>,
    /// Entity whose access determines the viewer permission for this object.
    permission_entity: model_entity::Entity<'static>,
    /// Associates the edge with its configured reader types.
    _readers: EdgeReaders<NR, PR, ER, FR, AR, AcR>,
}

impl<NR, PR, ER, FR, AR, AcR> Clone for SoupEdges<NR, PR, ER, FR, AR, AcR> {
    fn clone(&self) -> Self {
        Self {
            entity: self.entity.clone(),
            permission_entity: self.permission_entity.clone(),
            _readers: PhantomData,
        }
    }
}

impl<NR, PR, ER, FR, AR, AcR> SoupEntityEdges for SoupEdges<NR, PR, ER, FR, AR, AcR>
where
    NR: SoupNotificationEdgeReader,
    PR: EntityPropertyReader,
    ER: SoupEmailEdgeReader,
    FR: EntityFavoriteEdgeReader,
    AR: EntityPermissionEdgeReader,
    AcR: SoupActivityEdgeReader,
{
    type Property = GraphqlProperty;
    type Notification = GraphqlNotification;
    type NotificationFilter = GraphqlNotificationFilter;
    type ActivityEvent = GraphqlActivityEvent;
    type EmailThreadEdges = SoupEmailThreadEdges<ER>;
    type AgentSessionEdges = SoupAgentSessionEdges;
    type InitiativeEdges = SoupInitiativeEdges;

    fn from_entity(entity: model_entity::Entity<'static>) -> Self {
        Self {
            permission_entity: entity.clone(),
            entity,
            _readers: PhantomData,
        }
    }

    fn from_channel_message(message_id: Uuid, channel_id: Uuid) -> Self {
        Self {
            entity: model_entity::EntityType::ChannelMessage
                .with_entity_string(message_id.to_string()),
            permission_entity: model_entity::EntityType::Channel
                .with_entity_string(channel_id.to_string()),
            _readers: PhantomData,
        }
    }

    fn email_thread_edges(thread_id: Uuid) -> Self::EmailThreadEdges {
        SoupEmailThreadEdges {
            thread_id,
            _reader: PhantomData,
        }
    }

    async fn resolve_email_cache_projection(
        &self,
        ctx: &Context<'_>,
        thread_id: Uuid,
    ) -> async_graphql::Result<Option<String>> {
        let projection = load_email_thread_mail_projection::<ER>(ctx, thread_id).await?;
        let facts = &projection.cache_facts;
        let record_key = RecordKey::new(format!("GraphqlSoupEmailThread:{thread_id}"))?;
        let supplement = SoupCacheProjectionSupplement::mail(
            record_key,
            MailCacheProjectionFacts::new(
                facts.latest_non_spam_message_ts.map(utc_timestamp_micros),
                facts.latest_outbound_message_ts.map(utc_timestamp_micros),
                facts.has_calendar_attachment,
                facts.has_thread_share,
            ),
        );
        Ok(Some(encode_cache_projection_supplement(&supplement)?))
    }

    fn initiative_edges(initiative_id: Uuid) -> Self::InitiativeEdges {
        SoupInitiativeEdges { initiative_id }
    }

    fn agent_session_edges(session_id: Uuid, bot_id: Uuid) -> Self::AgentSessionEdges {
        SoupAgentSessionEdges {
            session_id: AgentSessionId::new_from_uuid(session_id),
            bot_id: BotId::new_from_uuid(bot_id),
        }
    }

    async fn resolve_properties(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<Self::Property>> {
        load_entity_properties::<PR>(ctx, self.entity.clone()).await
    }

    async fn resolve_notifications(
        &self,
        ctx: &Context<'_>,
        filter: Option<GraphqlNotificationFilter>,
        limit: Option<i32>,
    ) -> async_graphql::Result<Vec<Self::Notification>> {
        load_entity_notifications::<NR>(ctx, self.entity.clone(), filter, limit).await
    }

    async fn resolve_is_favorited(&self, ctx: &Context<'_>) -> async_graphql::Result<bool> {
        load_entity_favorite::<FR>(ctx, self.entity.clone()).await
    }

    async fn resolve_viewer_permission(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<GraphqlEntityPermission>> {
        load_entity_permission::<AR>(ctx, self.permission_entity.clone()).await
    }

    async fn resolve_activity(
        &self,
        ctx: &Context<'_>,
        limit: Option<i32>,
    ) -> async_graphql::Result<Vec<GraphqlActivityEvent>> {
        let limit = parse_activity_edge_limit(limit)?;
        load_entity_activity::<AcR>(
            ctx,
            ActivityEdgeKey {
                entity: self.entity.clone(),
                limit,
            },
        )
        .await
    }
}

/// Bot fields presented through an agent-session edge.
#[derive(Clone, SimpleObject)]
pub struct GraphqlSessionBot {
    /// Stable global bot identity.
    id: ID,
    /// Bot display name.
    name: String,
    /// Optional bot avatar URL.
    avatar_url: Option<String>,
}

impl From<BotProfile> for GraphqlSessionBot {
    fn from(profile: BotProfile) -> Self {
        Self {
            id: ID(profile.id.to_string()),
            name: profile.name,
            avatar_url: profile.avatar_url,
        }
    }
}

/// Owned future returned by the erased bot-profile batch reader.
type BotProfileBatchFuture = Pin<
    Box<
        dyn Future<Output = Result<HashMap<BotId, BotProfile>, Arc<anyhow::Error>>>
            + Send
            + 'static,
    >,
>;

/// Type-erased batch reader kept in the concrete GraphQL DataLoader.
type BotProfileBatchReader = dyn Fn(Vec<BotId>) -> BotProfileBatchFuture + Send + Sync + 'static;

/// DataLoader implementation for bot profiles referenced by agent sessions.
pub struct AgentSessionBotLoader {
    /// Erased bots-domain repository call.
    load_batch: Arc<BotProfileBatchReader>,
}

impl async_graphql::dataloader::Loader<BotId> for AgentSessionBotLoader {
    type Value = BotProfile;
    type Error = Arc<anyhow::Error>;

    async fn load(&self, keys: &[BotId]) -> Result<HashMap<BotId, Self::Value>, Self::Error> {
        (self.load_batch)(keys.to_vec()).await
    }
}

/// Concrete request-scoped DataLoader for agent-session bot edges.
pub type AgentSessionBotDataLoader = DataLoader<AgentSessionBotLoader>;

/// Build a request-scoped DataLoader backed by the bots domain repository.
pub fn agent_session_bot_loader<R>(repo: R) -> AgentSessionBotDataLoader
where
    R: BotRepo + Clone,
{
    let load_batch = move |bot_ids: Vec<BotId>| {
        let repo = repo.clone();
        Box::pin(async move {
            repo.get_bot_profiles(&bot_ids)
                .await
                .map_err(|error| Arc::new(error.into()))
        }) as BotProfileBatchFuture
    };
    DataLoader::new(
        AgentSessionBotLoader {
            load_batch: Arc::new(load_batch),
        },
        tokio::spawn,
    )
}

/// Agent-session-specific fields composed from the bots and agent-session domains.
#[derive(Clone)]
pub struct SoupAgentSessionEdges {
    /// The session itself, for its log.
    session_id: AgentSessionId,
    /// Bot referenced by the session.
    bot_id: BotId,
}

/// Bot and log fields attached only to a Soup agent session.
#[Object]
impl SoupAgentSessionEdges {
    /// The bot running this session, when its profile still exists.
    async fn bot(&self, ctx: &Context<'_>) -> async_graphql::Result<Option<GraphqlSessionBot>> {
        let loader = ctx.data::<AgentSessionBotDataLoader>()?;
        let profile = loader
            .load_one(self.bot_id)
            .await
            .map_err(|error| async_graphql::Error::new(error.to_string()))?;
        Ok(profile.map(Into::into))
    }

    /// The session's raw protocol log: what the client folds into messages.
    /// Served whole, in log order, the same rows the harness's REST log
    /// endpoint serves.
    async fn log(&self, ctx: &Context<'_>) -> async_graphql::Result<GraphqlAgentSessionLog> {
        let loader = ctx.data::<AgentSessionLogDataLoader>()?;
        loader
            .load_one(self.session_id)
            .await
            .map_err(|error| async_graphql::Error::new(error.to_string()))?
            .ok_or_else(|| async_graphql::Error::new("agent session log is unavailable"))
    }
}

/// One session's raw protocol log and the agent whose messages it derives.
#[derive(Clone, SimpleObject)]
pub struct GraphqlAgentSessionLog {
    /// The bot the session runs as: the sender of every agent message.
    bot: GraphqlAgentSessionLogBot,
    /// Effective history in ascending `(createdAt, id)` order. The first row
    /// is the inclusive history boundary; a reader reconciles overlap by id.
    entries: Vec<GraphqlAgentSessionLogEntry>,
}

/// The bot as the log's reader needs it, handle included.
#[derive(Clone, SimpleObject)]
pub struct GraphqlAgentSessionLogBot {
    /// The bot's id. A message it sent has `"bot|{id}"` as its sender.
    id: ID,
    /// Display name.
    name: String,
    /// Stable `@` handle, without a leading `@`.
    handle: String,
    /// Avatar, when it has one.
    avatar_url: Option<String>,
}

impl From<SessionBot> for GraphqlAgentSessionLogBot {
    fn from(bot: SessionBot) -> Self {
        Self {
            id: ID(bot.id.to_string()),
            name: bot.name,
            handle: bot.handle,
            avatar_url: bot.avatar_url,
        }
    }
}

/// One logged frame, in the shape the fold reads: the transport row's
/// identity and time beside the frame's own `direction` and `content`.
#[derive(Clone, SimpleObject)]
pub struct GraphqlAgentSessionLogEntry {
    /// Durable transport row identity; with `createdAt`, its order cursor.
    id: ID,
    /// When the log recorded the frame.
    created_at: String,
    /// The user whose action produced the frame, absent when no user did.
    user_id: Option<String>,
    /// Which way the frame travelled: `to_server` or `to_runtime`.
    direction: String,
    /// The protocol envelope, verbatim.
    content: Json<serde_json::Value>,
}

impl TryFrom<StoredAgentSessionLog> for GraphqlAgentSessionLogEntry {
    type Error = anyhow::Error;

    fn try_from(stored: StoredAgentSessionLog) -> Result<Self, Self::Error> {
        // Serialized by the fold's own log type so the wire shape cannot
        // drift from what the fold reads back; split into the two fields
        // the schema names.
        let serde_json::Value::Object(mut frame) = serde_json::to_value(&stored.entry.content)?
        else {
            anyhow::bail!("a logged frame did not serialize to an object");
        };
        let direction = match frame.remove("direction") {
            Some(serde_json::Value::String(direction)) => direction,
            _ => anyhow::bail!("a logged frame has no direction"),
        };
        let content = frame
            .remove("content")
            .ok_or_else(|| anyhow::anyhow!("a logged frame has no content"))?;
        Ok(Self {
            id: ID(stored.id.to_string()),
            created_at: stored
                .created_at
                .to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true),
            user_id: stored.entry.user_id.map(|user| user.to_string()),
            direction,
            content: Json(content),
        })
    }
}

/// Owned future returned by the erased session-log batch reader.
type AgentSessionLogBatchFuture = Pin<
    Box<
        dyn Future<
                Output = Result<
                    HashMap<AgentSessionId, GraphqlAgentSessionLog>,
                    Arc<anyhow::Error>,
                >,
            > + Send
            + 'static,
    >,
>;

/// Type-erased batch reader kept in the concrete GraphQL DataLoader.
type AgentSessionLogBatchReader =
    dyn Fn(Vec<AgentSessionId>) -> AgentSessionLogBatchFuture + Send + Sync + 'static;

/// DataLoader implementation for agent-session logs.
pub struct AgentSessionLogLoader {
    /// Erased agent-session repository call.
    load_batch: Arc<AgentSessionLogBatchReader>,
}

impl async_graphql::dataloader::Loader<AgentSessionId> for AgentSessionLogLoader {
    type Value = GraphqlAgentSessionLog;
    type Error = Arc<anyhow::Error>;

    async fn load(
        &self,
        keys: &[AgentSessionId],
    ) -> Result<HashMap<AgentSessionId, Self::Value>, Self::Error> {
        (self.load_batch)(keys.to_vec()).await
    }
}

/// Concrete request-scoped DataLoader for agent-session logs.
pub type AgentSessionLogDataLoader = DataLoader<AgentSessionLogLoader>;

/// Build a request-scoped DataLoader over the agent-session repository. One
/// request rarely asks for more than one log, so the batch is a loop; the
/// loader is for request-scoped memoization, not for batching.
pub fn agent_session_log_loader<R>(repo: R) -> AgentSessionLogDataLoader
where
    R: AgentSessionRepo + AgentSessionLogRepo + Clone,
{
    let load_batch = move |session_ids: Vec<AgentSessionId>| {
        let repo = repo.clone();
        Box::pin(async move {
            let mut logs = HashMap::with_capacity(session_ids.len());
            for session_id in session_ids {
                let session = AgentSessionRepo::get(&repo, session_id)
                    .await
                    .map_err(|error| Arc::new(anyhow::Error::new(error)))?;
                let bot = repo
                    .session_bot(session.bot_id)
                    .await
                    .map_err(|error| Arc::new(anyhow::Error::new(error)))?;
                let entries = AgentSessionLogRepo::list_by_session(&repo, session_id)
                    .await
                    .map_err(|error| Arc::new(anyhow::Error::new(error)))?
                    .into_iter()
                    .map(GraphqlAgentSessionLogEntry::try_from)
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(Arc::new)?;
                logs.insert(
                    session_id,
                    GraphqlAgentSessionLog {
                        bot: bot.into(),
                        entries,
                    },
                );
            }
            Ok(logs)
        }) as AgentSessionLogBatchFuture
    };
    DataLoader::new(
        AgentSessionLogLoader {
            load_batch: Arc::new(load_batch),
        },
        tokio::spawn,
    )
}

/// Cross-domain fields attached to a property-bearing Soup entity.
#[Object(name = "SoupEdges")]
impl<NR, PR, ER, FR, AR, AcR> SoupEdges<NR, PR, ER, FR, AR, AcR>
where
    NR: SoupNotificationEdgeReader,
    PR: EntityPropertyReader,
    ER: SoupEmailEdgeReader,
    FR: EntityFavoriteEdgeReader,
    AR: EntityPermissionEdgeReader,
    AcR: SoupActivityEdgeReader,
{
    /// Properties assigned to this entity that the authenticated user may view.
    async fn properties(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<GraphqlProperty>> {
        self.resolve_properties(ctx).await
    }

    /// Notifications associated with this entity for the authenticated user.
    async fn notifications(
        &self,
        ctx: &Context<'_>,
        filter: Option<GraphqlNotificationFilter>,
        limit: Option<i32>,
    ) -> async_graphql::Result<Vec<GraphqlNotification>> {
        self.resolve_notifications(ctx, filter, limit).await
    }

    /// Whether the authenticated viewer has favorited this entity.
    async fn is_favorited(&self, ctx: &Context<'_>) -> async_graphql::Result<bool> {
        self.resolve_is_favorited(ctx).await
    }

    /// The authenticated viewer's effective permission for this entity.
    async fn viewer_permission(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<GraphqlEntityPermission>> {
        self.resolve_viewer_permission(ctx).await
    }

    /// The newest activity on this entity, newest first. Loaded lazily and
    /// batched across entities; an activity outage degrades to an empty
    /// timeline. Deeper history belongs to the viewer's activity feed.
    async fn activity(
        &self,
        ctx: &Context<'_>,
        limit: Option<i32>,
    ) -> async_graphql::Result<Vec<GraphqlActivityEvent>> {
        self.resolve_activity(ctx, limit).await
    }
}

/// default limit of messages if none is provided
/// REST-compatible default number of email messages returned per page.
const DEFAULT_EMAIL_MESSAGE_LIMIT: i32 = 5;
/// max possible limit of messages
/// Maximum number of email messages one field may request.
const MAX_EMAIL_MESSAGE_LIMIT: i32 = 100;

/// parses the incoming optional limits into the actual range
/// Validate email-message pagination and apply REST-compatible defaults.
fn parse_email_message_pagination(
    offset: Option<i32>,
    limit: Option<i32>,
) -> async_graphql::Result<(u32, u32)> {
    let offset = u32::try_from(offset.unwrap_or(0))
        .map_err(|_| async_graphql::Error::new("offset must be non-negative"))?;
    let limit =
        graphql_common::parse_limit(limit, DEFAULT_EMAIL_MESSAGE_LIMIT, MAX_EMAIL_MESSAGE_LIMIT)?;
    Ok((offset, limit))
}

/// Email-content fields attached only to Soup email-thread entities.
pub struct SoupEmailThreadEdges<ER> {
    /// The uuid of the email thread
    thread_id: Uuid,
    /// marker for the reader type
    _reader: PhantomData<fn() -> ER>,
}

impl<ER> Clone for SoupEmailThreadEdges<ER> {
    fn clone(&self) -> Self {
        Self {
            thread_id: self.thread_id,
            _reader: PhantomData,
        }
    }
}

/// Email-content fields attached to a Soup email thread.
#[Object]
impl<ER> SoupEmailThreadEdges<ER>
where
    ER: SoupEmailEdgeReader,
{
    /// The canonical identifier of the email link that owns this thread.
    async fn link_id(&self, ctx: &Context<'_>) -> async_graphql::Result<ID> {
        let metadata = load_email_thread_metadata::<ER>(ctx, self.thread_id).await?;
        Ok(ID(metadata.link_id.to_string()))
    }

    /// Timestamp of the latest inbound message, in RFC 3339 format.
    async fn latest_inbound_message_ts(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<String>> {
        let metadata = load_email_thread_metadata::<ER>(ctx, self.thread_id).await?;
        Ok(metadata
            .latest_inbound_message_ts
            .map(|timestamp| timestamp.to_rfc3339()))
    }

    /// Most recent explicit return from an email reminder.
    async fn reminder_returned_at(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<String>> {
        let metadata = load_email_thread_metadata::<ER>(ctx, self.thread_id).await?;
        Ok(metadata
            .reminder_returned_at
            .map(|timestamp| timestamp.to_rfc3339()))
    }

    /// Complete body-free metadata for local draft edits and discards.
    async fn mail_draft_state(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<graphql_email::GraphqlMailDraftState>> {
        Ok(load_email_thread_mail_projection::<ER>(ctx, self.thread_id)
            .await?
            .draft_state
            .clone()
            .map(Into::into))
    }

    /// Latest eligible message for ALL, INBOX, Calendar and Shared, without bodies.
    async fn mail_all_preview(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<graphql_email::GraphqlMailPreviewMessage>> {
        Ok(load_email_thread_mail_projection::<ER>(ctx, self.thread_id)
            .await?
            .previews
            .all
            .clone()
            .map(Into::into))
    }

    /// Latest eligible draft, even when a newer non-draft exists in the thread.
    async fn mail_draft_preview(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<graphql_email::GraphqlMailPreviewMessage>> {
        Ok(load_email_thread_mail_projection::<ER>(ctx, self.thread_id)
            .await?
            .previews
            .draft
            .clone()
            .map(Into::into))
    }

    /// Latest eligible sent message, without bodies.
    async fn mail_sent_preview(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<graphql_email::GraphqlMailPreviewMessage>> {
        Ok(load_email_thread_mail_projection::<ER>(ctx, self.thread_id)
            .await?
            .previews
            .sent
            .clone()
            .map(Into::into))
    }

    /// A page of messages in this thread, newest first.
    async fn messages(
        &self,
        ctx: &Context<'_>,
        offset: Option<i32>,
        limit: Option<i32>,
    ) -> async_graphql::Result<Vec<GraphqlSoupEmailMessage>> {
        let (offset, limit) = parse_email_message_pagination(offset, limit)?;
        let key = if email_message_selection_requires_full_payload(ctx) {
            EmailContentKey::page_full(self.thread_id, offset, limit)
        } else {
            EmailContentKey::page(self.thread_id, offset, limit)
        };
        load_email_messages::<ER>(ctx, key).await
    }

    /// The newest non-draft content message in this thread.
    async fn latest_content_message(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<GraphqlSoupEmailMessage>> {
        load_latest_email_message::<ER>(ctx, self.thread_id).await
    }
}

/// Initiative detail fields composed onto the canonical Soup entity.
#[derive(Clone)]
pub struct SoupInitiativeEdges {
    /// Initiative whose domain-authorized details are requested.
    initiative_id: Uuid,
}

#[Object]
impl SoupInitiativeEdges {
    /// Collaborators, independent of assignees.
    async fn member_ids(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<String>> {
        let detail = graphql_initiative::load_initiative_detail(ctx, self.initiative_id).await?;
        Ok(detail.member_ids.iter().map(ToString::to_string).collect())
    }

    /// Associated task identifiers visible to this viewer.
    async fn task_ids(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<ID>> {
        let detail = graphql_initiative::load_initiative_detail(ctx, self.initiative_id).await?;
        Ok(detail.task_ids.iter().cloned().map(ID).collect())
    }

    /// Current sharing state.
    async fn share_permission(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<graphql_initiative::GraphqlInitiativeSharePermission> {
        let detail = graphql_initiative::load_initiative_detail(ctx, self.initiative_id).await?;
        Ok(detail.share_permission.clone().into())
    }

    /// Number of associated tasks this viewer can see.
    async fn task_count(&self, ctx: &Context<'_>) -> async_graphql::Result<u32> {
        Ok(
            graphql_initiative::load_initiative_summary(ctx, self.initiative_id)
                .await?
                .task_count,
        )
    }

    /// Number of completed associated tasks this viewer can see.
    async fn completed_task_count(&self, ctx: &Context<'_>) -> async_graphql::Result<u32> {
        Ok(
            graphql_initiative::load_initiative_summary(ctx, self.initiative_id)
                .await?
                .completed_task_count,
        )
    }
}

#[cfg(test)]
mod test;
