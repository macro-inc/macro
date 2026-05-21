//! Outbound adapters for channel mutations.

use crate::domain::{
    events::ChannelEvent,
    models::{
        ChannelMetadata, ChannelParticipant, ChannelType, CountedReaction, MutatedAttachment,
        MutatedMessage, SimpleMention, TypingAction,
    },
    ports::{
        ChannelContactsDispatcher, ChannelEventDispatcher, ChannelNotificationDispatcher,
        ChannelRealtimeGateway, ChannelSearchIndexer, ChannelSharePermissionService,
    },
};
use anyhow::Context;
use connection_gateway_client::ConnectionGatewayClient;
use contacts::domain::ports::ContactsIngress;
use entity_access::domain::{models::EntityType, ports::EntityAccessService};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::EntityType as GatewayEntityType;
use model_notifications::{
    ChannelInviteMetadata, ChannelMentionMetadata, ChannelMessageSendMetadata,
    ChannelReplyMetadata, CommonChannelMetadata, DocumentMentionMetadata,
    NotificationDocumentSubType,
};
use models_permissions::share_permission::{
    access_level::AccessLevel,
    channel_share_permission::{UpdateChannelSharePermission, UpdateOperation},
};
use notification_hex::domain::{
    models::SendNotificationRequestBuilder, service::NotificationIngress,
};
use serde::Serialize;
use sqlx::PgPool;
use std::{collections::HashSet, str::FromStr, sync::Arc};
use uuid::Uuid;

/// Connection-gateway realtime adapter.
#[derive(Clone)]
pub struct ConnectionGatewayChannelRealtimeGateway {
    client: Arc<ConnectionGatewayClient>,
}

impl ConnectionGatewayChannelRealtimeGateway {
    /// Create a realtime gateway adapter.
    pub fn new(client: Arc<ConnectionGatewayClient>) -> Self {
        Self { client }
    }
}

impl ChannelRealtimeGateway for ConnectionGatewayChannelRealtimeGateway {
    type Err = anyhow::Error;

    async fn send_update<T: Serialize + Send>(
        &self,
        message_type: &'static str,
        payload: T,
        participants: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), Self::Err> {
        if participants.is_empty() {
            return Ok(());
        }
        self.client
            .batch_send_message(
                message_type.to_string(),
                serde_json::to_value(payload)?,
                participants
                    .iter()
                    .map(|p| GatewayEntityType::User.with_entity_str(p.as_ref()))
                    .collect(),
            )
            .await?;
        Ok(())
    }
}

#[derive(Serialize)]
struct WithNonce<T: Serialize> {
    #[serde(flatten)]
    data: T,
    #[serde(skip_serializing_if = "Option::is_none")]
    nonce: Option<String>,
}

#[derive(Serialize)]
struct AttachmentRealtimeData {
    channel_id: Uuid,
    message_id: Uuid,
    attachments: Vec<MutatedAttachment>,
}

#[derive(Serialize)]
struct ReactionRealtimeData {
    channel_id: Uuid,
    message_id: Uuid,
    reactions: Vec<CountedReaction>,
}

#[derive(Serialize)]
struct TypingRealtimeData {
    channel_id: Uuid,
    user_id: String,
    action: TypingAction,
    thread_id: Option<Uuid>,
}

#[derive(sqlx::FromRow)]
struct SenderIdRow {
    sender_id: MacroUserIdStr<'static>,
}

#[derive(sqlx::FromRow)]
struct CountRow {
    count: i64,
}

#[derive(sqlx::FromRow)]
struct UserIdRow {
    user_id: MacroUserIdStr<'static>,
}

fn participant_ids(participants: &[ChannelParticipant]) -> Vec<MacroUserIdStr<'static>> {
    participants
        .iter()
        .filter_map(|p| MacroUserIdStr::parse_from_str(&p.user_id).ok())
        .map(|id| id.into_owned())
        .collect()
}

/// Contacts ingress adapter.
pub struct ContactsChannelDispatcher<I> {
    ingress: Arc<I>,
}

impl<I> Clone for ContactsChannelDispatcher<I> {
    fn clone(&self) -> Self {
        Self {
            ingress: self.ingress.clone(),
        }
    }
}

impl<I> ContactsChannelDispatcher<I> {
    /// Create a contacts adapter.
    pub fn new(ingress: Arc<I>) -> Self {
        Self { ingress }
    }
}

impl<I> ChannelContactsDispatcher for ContactsChannelDispatcher<I>
where
    I: ContactsIngress,
{
    type Err = anyhow::Error;

    async fn enqueue_contacts(
        &self,
        users: HashSet<MacroUserIdStr<'static>>,
    ) -> Result<(), Self::Err> {
        self.ingress
            .enqueue_contacts(users)
            .await
            .map_err(|e| anyhow::anyhow!("{e:?}"))
    }
}

/// SQS-backed search index adapter.
#[derive(Clone)]
pub struct SqsChannelSearchIndexer {
    sqs: Arc<sqs_client::SQS>,
}

impl SqsChannelSearchIndexer {
    /// Create a search index adapter.
    pub fn new(sqs: Arc<sqs_client::SQS>) -> Self {
        Self { sqs }
    }
}

impl ChannelSearchIndexer for SqsChannelSearchIndexer {
    async fn index_message(&self, channel_id: Uuid, message_id: Uuid) {
        let sqs = self.sqs.clone();
        tokio::spawn(async move {
            sqs.send_message_to_search_event_queue(
                sqs_client::search::SearchQueueMessage::ChannelMessageUpdate(
                    sqs_client::search::channel::ChannelMessageUpdate {
                        channel_id: channel_id.to_string(),
                        message_id: message_id.to_string(),
                        index_override: None,
                    },
                ),
            )
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "SEARCH_QUEUE unable to enqueue message");
            })
            .ok();
        });
    }

    async fn remove_message(&self, channel_id: Uuid, message_id: Option<Uuid>) {
        let sqs = self.sqs.clone();
        tokio::spawn(async move {
            sqs.send_message_to_search_event_queue(
                sqs_client::search::SearchQueueMessage::RemoveChannelMessage(
                    sqs_client::search::channel::RemoveChannelMessage {
                        channel_id: channel_id.to_string(),
                        message_id: message_id.map(|id| id.to_string()),
                        index_override: None,
                    },
                ),
            )
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "SEARCH_QUEUE unable to enqueue remove message");
            })
            .ok();
        });
    }
}

/// Dispatches durable channel events to side-effect adapters.
#[derive(Clone)]
pub struct ChannelSideEffectsDispatcher<G, N, S, C> {
    realtime: G,
    notifications: N,
    search: S,
    contacts: C,
}

impl<G, N, S, C> ChannelSideEffectsDispatcher<G, N, S, C> {
    /// Create a channel event dispatcher.
    pub fn new(realtime: G, notifications: N, search: S, contacts: C) -> Self {
        Self {
            realtime,
            notifications,
            search,
            contacts,
        }
    }
}

impl<G, N, S, C> ChannelEventDispatcher for ChannelSideEffectsDispatcher<G, N, S, C>
where
    G: ChannelRealtimeGateway + Clone,
    N: ChannelNotificationDispatcher + Clone,
    S: ChannelSearchIndexer + Clone,
    C: ChannelContactsDispatcher + Clone,
{
    fn dispatch(&self, event: ChannelEvent) {
        let realtime = self.realtime.clone();
        let notifications = self.notifications.clone();
        let search = self.search.clone();
        let contacts = self.contacts.clone();
        tokio::spawn(async move {
            dispatch_channel_event(&realtime, &notifications, &search, &contacts, event).await;
        });
    }
}

async fn dispatch_channel_event<G, N, S, C>(
    realtime: &G,
    notifications: &N,
    search: &S,
    contacts: &C,
    event: ChannelEvent,
) where
    G: ChannelRealtimeGateway,
    N: ChannelNotificationDispatcher,
    S: ChannelSearchIndexer,
    C: ChannelContactsDispatcher,
{
    let contact_sync_users = contact_sync_users_for_event(&event);
    if should_dispatch_notification(&event) {
        notifications.dispatch(event.clone());
    }

    match event {
        ChannelEvent::ChannelCreated { .. } => {}
        ChannelEvent::ChannelDeleted { channel_id } => {
            search.remove_message(channel_id, None).await;
        }
        ChannelEvent::MessagePosted {
            channel_id,
            participants,
            message,
            attachments,
            nonce,
            ..
        } => {
            send_realtime(
                realtime,
                "comms_message",
                WithNonce {
                    data: message.clone(),
                    nonce: nonce.clone(),
                },
                participant_ids(&participants),
            )
            .await;

            if !attachments.is_empty() {
                send_realtime(
                    realtime,
                    "comms_attachment",
                    WithNonce {
                        data: AttachmentRealtimeData {
                            channel_id,
                            message_id: message.id,
                            attachments,
                        },
                        nonce: nonce.clone(),
                    },
                    participant_ids(&participants),
                )
                .await;
            }

            search.index_message(channel_id, message.id).await;
        }
        ChannelEvent::AttachmentsChanged {
            channel_id,
            message_id,
            attachments,
            recipients,
            nonce,
        } => {
            send_realtime(
                realtime,
                "comms_attachment",
                WithNonce {
                    data: AttachmentRealtimeData {
                        channel_id,
                        message_id,
                        attachments,
                    },
                    nonce,
                },
                recipients,
            )
            .await;
            search.index_message(channel_id, message_id).await;
        }
        ChannelEvent::MessageChanged {
            channel_id,
            message,
            recipients,
            nonce,
        } => {
            send_realtime(
                realtime,
                "comms_message",
                WithNonce {
                    data: message.clone(),
                    nonce,
                },
                recipients,
            )
            .await;
            search.index_message(channel_id, message.id).await;
        }
        ChannelEvent::MessageDeleted {
            channel_id,
            message,
            recipients,
            nonce,
        } => {
            let message_id = message.id;
            send_realtime(
                realtime,
                "comms_message",
                WithNonce {
                    data: message,
                    nonce,
                },
                recipients,
            )
            .await;
            search.remove_message(channel_id, Some(message_id)).await;
        }
        ChannelEvent::ReactionChanged {
            channel_id,
            message_id,
            reactions,
            recipients,
            nonce,
        } => {
            send_realtime(
                realtime,
                "comms_reaction",
                WithNonce {
                    data: ReactionRealtimeData {
                        channel_id,
                        message_id,
                        reactions,
                    },
                    nonce,
                },
                recipients,
            )
            .await;
        }
        ChannelEvent::TypingChanged {
            channel_id,
            user_id,
            action,
            thread_id,
            recipients,
            nonce,
        } => {
            send_realtime(
                realtime,
                "comms_typing",
                WithNonce {
                    data: TypingRealtimeData {
                        channel_id,
                        user_id,
                        action,
                        thread_id,
                    },
                    nonce,
                },
                recipients,
            )
            .await;
        }
        ChannelEvent::ParticipantsAdded { .. } => {}
        ChannelEvent::ParticipantJoined { .. } => {}
    }

    if let Some(users) = contact_sync_users {
        if let Err(err) = contacts.enqueue_contacts(users).await {
            let err: anyhow::Error = err.into();
            tracing::error!(error=?err, "unable to enqueue channel contact sync");
        }
    }
}

fn should_dispatch_notification(event: &ChannelEvent) -> bool {
    matches!(
        event,
        ChannelEvent::MessagePosted { .. } | ChannelEvent::ParticipantsAdded { .. }
    )
}

fn contact_sync_users_for_event(event: &ChannelEvent) -> Option<HashSet<MacroUserIdStr<'static>>> {
    match event {
        ChannelEvent::ChannelCreated {
            channel_type: ChannelType::Private | ChannelType::DirectMessage,
            participant_user_ids,
            ..
        } => Some(participant_user_ids.iter().cloned().collect()),
        ChannelEvent::ParticipantsAdded {
            channel_type: ChannelType::Private | ChannelType::Team,
            active_participant_user_ids,
            ..
        } => Some(active_participant_user_ids.iter().cloned().collect()),
        ChannelEvent::ParticipantJoined {
            channel_type: ChannelType::Public | ChannelType::Private | ChannelType::Team,
            active_participant_user_ids,
            ..
        } if active_participant_user_ids.len() > 1 => {
            Some(active_participant_user_ids.iter().cloned().collect())
        }
        _ => None,
    }
}

async fn send_realtime<G, T>(
    realtime: &G,
    message_type: &'static str,
    payload: T,
    recipients: Vec<MacroUserIdStr<'static>>,
) where
    G: ChannelRealtimeGateway,
    T: Serialize + Send,
{
    if let Err(err) = realtime
        .send_update(message_type, payload, recipients)
        .await
    {
        let err: anyhow::Error = err.into();
        tracing::error!(error=?err, message_type, "unable to dispatch channel realtime event");
    }
}

/// Entity-access backed share permission updater.
#[derive(Clone)]
pub struct EntityAccessChannelSharePermissions<E> {
    pool: PgPool,
    entity_access_service: Arc<E>,
}

impl<E> EntityAccessChannelSharePermissions<E> {
    /// Create a share permission adapter.
    pub fn new(pool: PgPool, entity_access_service: Arc<E>) -> Self {
        Self {
            pool,
            entity_access_service,
        }
    }
}

impl<E> ChannelSharePermissionService for EntityAccessChannelSharePermissions<E>
where
    E: EntityAccessService,
{
    type Err = anyhow::Error;

    async fn update_channel_share_permissions(
        &self,
        user_id: String,
        channel_id: Uuid,
        items: Vec<(String, String)>,
    ) -> Result<(), Self::Err> {
        for (item_id, item_type) in items {
            update_channel_share_permission(
                &self.pool,
                &*self.entity_access_service,
                &user_id,
                &channel_id.to_string(),
                &item_id,
                &item_type,
            )
            .await?;
        }
        Ok(())
    }
}

async fn update_channel_share_permission(
    db: &PgPool,
    entity_access_service: &impl EntityAccessService,
    user_id: &str,
    channel_id: &str,
    item_id: &str,
    item_type: &str,
) -> anyhow::Result<()> {
    let entity_id = macro_uuid::string_to_uuid(item_id)?;

    if model::item::ShareableItemType::from_str(item_type).is_err() {
        return Ok(());
    }

    let mut transaction = db.begin().await?;

    if item_type == "thread" {
        macro_middleware::cloud_storage::thread::ensure_thread_exists::insert_thread_share_permissions(
            db, item_id,
        )
        .await
        .context("failed to insert thread share permissions")?;
    }

    let entity_type = match item_type {
        "document" => EntityType::Document,
        "chat" => EntityType::Chat,
        "project" => EntityType::Project,
        "thread" => EntityType::EmailThread,
        "call" => EntityType::Call,
        _ => anyhow::bail!("unsupported item type: {}", item_type),
    };

    let user_id = MacroUserIdStr::parse_from_str(user_id).context("invalid user id")?;
    let user_access_level = entity_access_service
        .get_access_level(Some(&user_id), item_id, entity_type)
        .await
        .context("failed to get user access level")?;

    if user_access_level.is_none() {
        tracing::info!("user does not have access to the item, not modifying share permissions");
        return Ok(());
    }

    let channel_share_permission_access_level = AccessLevel::View;
    let share_permission_id =
        macro_db_client::share_permission::get::get_share_permission_id(db, item_id, item_type)
            .await
            .context("failed to get share permission id")?;

    if let Err(e) = macro_db_client::share_permission::channel_permission::create::insert_channel_share_permission(
        &mut *transaction,
        &share_permission_id,
        channel_id,
        &channel_share_permission_access_level,
    )
    .await
    {
        if e.to_string() == "channel permission already exists" {
            return Ok(());
        }
        return Err(e).context("failed to insert channel share permission");
    }

    entity_access_db_utils::update_entity_access_channel_share_permissions(
        &mut transaction,
        &entity_id,
        entity_type,
        &[UpdateChannelSharePermission {
            channel_id: channel_id.to_string(),
            operation: UpdateOperation::Add,
            access_level: Some(channel_share_permission_access_level),
        }],
    )
    .await?;

    transaction.commit().await?;
    Ok(())
}

/// Notification ingress adapter for channel mutations.
#[derive(Clone)]
pub struct NotificationChannelDispatcher<I> {
    pool: PgPool,
    ingress: Arc<I>,
}

impl<I> NotificationChannelDispatcher<I> {
    /// Create a notification adapter.
    pub fn new(pool: PgPool, ingress: Arc<I>) -> Self {
        Self { pool, ingress }
    }
}

fn to_notification_channel_type(channel_type: ChannelType) -> model_notifications::ChannelType {
    match channel_type {
        ChannelType::Public => model_notifications::ChannelType::Public,
        ChannelType::Organization => model_notifications::ChannelType::Organization,
        ChannelType::Private => model_notifications::ChannelType::Private,
        ChannelType::DirectMessage => model_notifications::ChannelType::DirectMessage,
        ChannelType::Team => model_notifications::ChannelType::Team,
    }
}

fn to_common_metadata(metadata: ChannelMetadata) -> CommonChannelMetadata {
    CommonChannelMetadata {
        channel_type: to_notification_channel_type(metadata.channel_type),
        channel_name: metadata.channel_name,
    }
}

fn recipients_excluding<'a>(
    recipients: impl IntoIterator<Item = &'a str>,
    exclude: impl IntoIterator<Item = &'a str>,
) -> impl Iterator<Item = MacroUserIdStr<'static>> {
    let exclude_set: HashSet<&str> = exclude.into_iter().collect();
    recipients
        .into_iter()
        .filter(move |id| !exclude_set.contains(id))
        .filter_map(|id| MacroUserIdStr::parse_from_str(id).ok())
        .map(|u| u.into_owned())
}

async fn get_sender_profile_picture_url(
    db: &PgPool,
    sender_id: &MacroUserIdStr<'_>,
) -> Option<String> {
    macro_db_client::user::update_profile_picture::get_profile_pictures(
        db,
        &vec![sender_id.as_ref().to_string()],
    )
    .await
    .ok()
    .and_then(|pics| pics.pictures.into_iter().next().map(|p| p.url))
}

async fn get_message_owner(pool: &PgPool, message_id: Uuid) -> anyhow::Result<String> {
    let row = sqlx::query_as::<_, SenderIdRow>(
        r#"
        SELECT sender_id
        FROM comms_messages
        WHERE id = $1
        ORDER BY created_at ASC
        "#,
    )
    .bind(message_id)
    .fetch_one(pool)
    .await
    .context("unable to get message owner")?;
    Ok(row.sender_id.to_string())
}

async fn get_channel_message_count(pool: &PgPool, channel_id: Uuid) -> anyhow::Result<i64> {
    let row = sqlx::query_as::<_, CountRow>(
        r#"
        SELECT COUNT(id) AS count
        FROM comms_messages
        WHERE channel_id = $1
        "#,
    )
    .bind(channel_id)
    .fetch_one(pool)
    .await?;
    Ok(row.count)
}

async fn get_channel_participants_for_thread_id(
    pool: &PgPool,
    thread_id: Uuid,
) -> anyhow::Result<Vec<MacroUserIdStr<'static>>> {
    let rows = sqlx::query_as::<_, UserIdRow>(
        r#"
        SELECT DISTINCT id AS user_id FROM (
            SELECT m.sender_id AS id
            FROM comms_channel_participants cp
            JOIN comms_channels c ON c.id = cp.channel_id
            JOIN comms_messages m ON m.channel_id = c.id
            WHERE (m.id = $1 OR m.thread_id = $1) AND cp.left_at IS NULL
            UNION
            SELECT em.entity_id AS id
            FROM comms_entity_mentions em
            JOIN comms_messages m ON m.id::text = em.source_entity_id
            JOIN comms_channel_participants cp
              ON cp.channel_id = m.channel_id AND cp.user_id = em.entity_id
            WHERE (m.id = $1 OR m.thread_id = $1)
              AND em.source_entity_type = 'message'
              AND em.entity_type = 'user'
              AND cp.left_at IS NULL
        ) AS combined
        "#,
    )
    .bind(thread_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|row| row.user_id).collect())
}

struct PostedMessageNotificationContext {
    common: CommonChannelMetadata,
    sender_profile_picture_url: Option<String>,
    user_mentions: Vec<String>,
    document_mentions: Vec<macro_db_client::notification::BasicCloudStorageItemMetadata>,
    thread_participants: Vec<MacroUserIdStr<'static>>,
    thread_parent_sender_id: Option<MacroUserIdStr<'static>>,
    excluded_user_ids: Vec<String>,
    recipients_without_sender_and_mentions: HashSet<MacroUserIdStr<'static>>,
    existing_user_ids: HashSet<String>,
    is_first_top_level_message: bool,
}

struct InviteNotifications {
    channel_id: Uuid,
    invited_by_user_id: MacroUserIdStr<'static>,
    recipient_user_ids: Vec<MacroUserIdStr<'static>>,
    existing_user_ids: HashSet<String>,
    sender_profile_picture_url: Option<String>,
    message_content: Option<String>,
    common: CommonChannelMetadata,
}

async fn send_invite_notifications(
    ingress: &impl NotificationIngress,
    request: InviteNotifications,
) -> anyhow::Result<()> {
    let InviteNotifications {
        channel_id,
        invited_by_user_id,
        recipient_user_ids,
        existing_user_ids,
        sender_profile_picture_url,
        message_content,
        common,
    } = request;
    let (existing_users, not_existing_users): (HashSet<_>, HashSet<_>) = recipient_user_ids
        .into_iter()
        .partition(|id| existing_user_ids.contains(id.as_ref()));

    let _ = tokio::try_join!(
        ingress.send_notification(
            SendNotificationRequestBuilder {
                notification_entity: model_entity::EntityType::Channel
                    .with_entity_string(channel_id.to_string()),
                notification: ChannelInviteMetadata {
                    invited_by: invited_by_user_id.clone(),
                    channel_name: common.channel_name.clone(),
                    sender_profile_picture_url: sender_profile_picture_url.clone(),
                    message_content: message_content.clone(),
                },
                sender_id: Some(invited_by_user_id.copied().into_owned()),
                recipient_ids: existing_users,
            }
            .into_request()
            .with_apns()
            .with_conn_gateway(),
        ),
        ingress.send_notification(
            SendNotificationRequestBuilder {
                notification_entity: model_entity::EntityType::Channel
                    .with_entity_string(channel_id.to_string()),
                notification: ChannelInviteMetadata {
                    invited_by: invited_by_user_id.clone(),
                    channel_name: common.channel_name.clone(),
                    sender_profile_picture_url,
                    message_content,
                },
                sender_id: Some(invited_by_user_id.copied().into_owned()),
                recipient_ids: not_existing_users,
            }
            .into_request()
            .with_email(),
        )
    )
    .map_err(|e| anyhow::anyhow!("{e:?}"))?;

    Ok(())
}

impl<I> NotificationChannelDispatcher<I>
where
    I: NotificationIngress + 'static,
{
    async fn dispatch_event(&self, event: ChannelEvent) -> anyhow::Result<()> {
        match event {
            ChannelEvent::MessagePosted {
                channel_id,
                metadata,
                participants,
                message,
                mentions,
                has_attachments,
                ..
            } => {
                self.dispatch_message_posted(
                    channel_id,
                    metadata,
                    participants,
                    message,
                    mentions,
                    has_attachments,
                )
                .await
            }
            ChannelEvent::ParticipantsAdded {
                channel_id,
                invited_by_user_id,
                recipient_user_ids,
                metadata,
                message_content,
                ..
            } => {
                self.dispatch_participants_added(
                    channel_id,
                    invited_by_user_id,
                    recipient_user_ids,
                    metadata,
                    message_content,
                )
                .await
            }
            _ => Ok(()),
        }
    }

    async fn dispatch_message_posted(
        &self,
        channel_id: Uuid,
        metadata: ChannelMetadata,
        participants: Vec<ChannelParticipant>,
        message: MutatedMessage,
        mentions: Vec<SimpleMention>,
        has_attachments: bool,
    ) -> anyhow::Result<()> {
        let context = self
            .build_posted_message_context(channel_id, metadata, &participants, &message, mentions)
            .await?;

        self.send_user_mention_notifications(channel_id, &message, has_attachments, &context)
            .await?;
        self.send_document_mention_notifications(
            channel_id,
            &participants,
            &message,
            has_attachments,
            &context,
        )
        .await?;

        if let Some(thread_id) = message.thread_id {
            self.send_reply_notification(
                thread_id,
                channel_id,
                &message,
                has_attachments,
                &context,
            )
            .await?;
        } else if context.is_first_top_level_message {
            self.send_first_message_invites(channel_id, &message, context)
                .await?;
        } else {
            self.send_channel_message_notification(channel_id, &message, has_attachments, &context)
                .await?;
        }

        Ok(())
    }

    async fn build_posted_message_context(
        &self,
        channel_id: Uuid,
        metadata: ChannelMetadata,
        participants: &[ChannelParticipant],
        message: &MutatedMessage,
        mentions: Vec<SimpleMention>,
    ) -> anyhow::Result<PostedMessageNotificationContext> {
        let common = to_common_metadata(metadata);
        let is_first_top_level_message = get_channel_message_count(&self.pool, channel_id).await?
            <= 1
            && message.thread_id.is_none();
        let existing_user_ids = if is_first_top_level_message {
            let participant_ids: Vec<_> = participants
                .iter()
                .filter_map(|participant| MacroUserIdStr::parse_from_str(&participant.user_id).ok())
                .map(|id| id.0)
                .collect();
            macro_db_client::user::get_all::get_existing_users(&self.pool, &participant_ids)
                .await?
                .into_iter()
                .collect()
        } else {
            HashSet::new()
        };

        let (user_mentions, document_mention_ids) = mentions.into_iter().fold(
            (Vec::new(), Vec::new()),
            |(mut users, mut docs), mention| {
                match mention.entity_type.as_str() {
                    "user" => users.push(mention.entity_id),
                    "document" => docs.push(mention.entity_id),
                    _ => {}
                }
                (users, docs)
            },
        );
        let document_mentions = self.load_document_mentions(&document_mention_ids).await;
        let (thread_participants, thread_parent_sender_id) = self
            .load_thread_notification_context(message.thread_id)
            .await;
        let sender_profile_picture_url =
            get_sender_profile_picture_url(&self.pool, &message.sender_id).await;

        let excluded_user_ids = std::iter::once(message.sender_id.as_ref().to_string())
            .chain(user_mentions.iter().cloned())
            .collect::<Vec<_>>();
        let recipients_without_sender_and_mentions = recipients_excluding(
            participants
                .iter()
                .map(|participant| participant.user_id.as_str()),
            excluded_user_ids.iter().map(String::as_str),
        )
        .collect();

        Ok(PostedMessageNotificationContext {
            common,
            sender_profile_picture_url,
            user_mentions,
            document_mentions,
            thread_participants,
            thread_parent_sender_id,
            excluded_user_ids,
            recipients_without_sender_and_mentions,
            existing_user_ids,
            is_first_top_level_message,
        })
    }

    async fn load_document_mentions(
        &self,
        document_mention_ids: &[String],
    ) -> Vec<macro_db_client::notification::BasicCloudStorageItemMetadata> {
        macro_db_client::notification::get_basic_cloud_storage_documents_metadata(
            &self.pool,
            document_mention_ids,
        )
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "unable to get documents metadata");
        })
        .unwrap_or_default()
    }

    async fn load_thread_notification_context(
        &self,
        thread_id: Option<Uuid>,
    ) -> (
        Vec<MacroUserIdStr<'static>>,
        Option<MacroUserIdStr<'static>>,
    ) {
        if let Some(thread_id) = thread_id {
            let participants = get_channel_participants_for_thread_id(&self.pool, thread_id)
                .await
                .unwrap_or_default();
            let sender_id = match get_message_owner(&self.pool, thread_id).await {
                Ok(id) => MacroUserIdStr::parse_from_str(&id)
                    .ok()
                    .map(|id| id.into_owned()),
                Err(_) => None,
            };
            (participants, sender_id)
        } else {
            (vec![], None)
        }
    }

    async fn send_user_mention_notifications(
        &self,
        channel_id: Uuid,
        message: &MutatedMessage,
        has_attachments: bool,
        context: &PostedMessageNotificationContext,
    ) -> anyhow::Result<()> {
        if context.user_mentions.is_empty() {
            return Ok(());
        }

        self.ingress
            .send_notification(
                SendNotificationRequestBuilder {
                    notification_entity: model_entity::EntityType::Channel
                        .with_entity_string(channel_id.to_string()),
                    notification: ChannelMentionMetadata {
                        message_content: message.content.clone(),
                        message_id: message.id.to_string(),
                        has_attachments,
                        thread_id: message.thread_id.map(|thread_id| thread_id.to_string()),
                        common: context.common.clone(),
                        sender_profile_picture_url: context.sender_profile_picture_url.clone(),
                    },
                    sender_id: Some(message.sender_id.clone()),
                    recipient_ids: recipients_excluding(
                        context.user_mentions.iter().map(String::as_str),
                        std::iter::once(message.sender_id.as_ref()),
                    )
                    .collect(),
                }
                .into_request()
                .with_apns()
                .with_conn_gateway(),
            )
            .await
            .map_err(|e| anyhow::anyhow!("{e:?}"))?;

        Ok(())
    }

    async fn send_document_mention_notifications(
        &self,
        channel_id: Uuid,
        participants: &[ChannelParticipant],
        message: &MutatedMessage,
        has_attachments: bool,
        context: &PostedMessageNotificationContext,
    ) -> anyhow::Result<()> {
        if context.document_mentions.is_empty() {
            return Ok(());
        }

        let recipients: HashSet<_> = recipients_excluding(
            participants
                .iter()
                .map(|participant| participant.user_id.as_str()),
            std::iter::once(message.sender_id.as_ref()),
        )
        .collect();

        for mention in &context.document_mentions {
            self.ingress
                .send_notification(
                    SendNotificationRequestBuilder {
                        notification_entity: model_entity::EntityType::Channel
                            .with_entity_string(channel_id.to_string()),
                        notification: DocumentMentionMetadata {
                            document_name: mention.item_name.clone(),
                            owner: mention.item_owner.clone(),
                            file_type: mention.file_type.clone(),
                            sub_type: match mention.sub_type.as_deref() {
                                Some("task") => Some(NotificationDocumentSubType::Task),
                                _ => None,
                            },
                            channel: ChannelMentionMetadata {
                                message_content: message.content.clone(),
                                message_id: message.id.to_string(),
                                has_attachments,
                                thread_id: message.thread_id.map(|thread_id| thread_id.to_string()),
                                common: context.common.clone(),
                                sender_profile_picture_url: context
                                    .sender_profile_picture_url
                                    .clone(),
                            },
                        },
                        sender_id: Some(message.sender_id.clone()),
                        recipient_ids: recipients.clone(),
                    }
                    .into_request()
                    .with_apns()
                    .with_conn_gateway(),
                )
                .await
                .map_err(|e| anyhow::anyhow!("{e:?}"))?;
        }

        Ok(())
    }

    async fn send_reply_notification(
        &self,
        thread_id: Uuid,
        channel_id: Uuid,
        message: &MutatedMessage,
        has_attachments: bool,
        context: &PostedMessageNotificationContext,
    ) -> anyhow::Result<()> {
        if context.thread_participants.is_empty() {
            tracing::warn!(thread_id = %thread_id, "thread participants is empty, but message has thread id");
            return Ok(());
        }

        self.ingress
            .send_notification(
                SendNotificationRequestBuilder {
                    notification_entity: model_entity::EntityType::Channel
                        .with_entity_string(channel_id.to_string()),
                    notification: ChannelReplyMetadata {
                        thread_id: thread_id.to_string(),
                        message_id: message.id.to_string(),
                        user_id: message.sender_id.clone(),
                        message_content: message.content.clone(),
                        has_attachments,
                        thread_parent_sender_id: context.thread_parent_sender_id.clone(),
                        common: context.common.clone(),
                        sender_profile_picture_url: context.sender_profile_picture_url.clone(),
                    },
                    sender_id: Some(message.sender_id.clone()),
                    recipient_ids: recipients_excluding(
                        context
                            .thread_participants
                            .iter()
                            .map(|participant| participant.as_ref()),
                        context.excluded_user_ids.iter().map(String::as_str),
                    )
                    .collect(),
                }
                .into_request()
                .with_apns()
                .with_conn_gateway(),
            )
            .await
            .map_err(|e| anyhow::anyhow!("{e:?}"))?;

        Ok(())
    }

    async fn send_first_message_invites(
        &self,
        channel_id: Uuid,
        message: &MutatedMessage,
        context: PostedMessageNotificationContext,
    ) -> anyhow::Result<()> {
        send_invite_notifications(
            &*self.ingress,
            InviteNotifications {
                channel_id,
                invited_by_user_id: message.sender_id.clone(),
                recipient_user_ids: context
                    .recipients_without_sender_and_mentions
                    .into_iter()
                    .collect(),
                existing_user_ids: context.existing_user_ids,
                sender_profile_picture_url: context.sender_profile_picture_url,
                message_content: Some(message.content.clone()),
                common: context.common,
            },
        )
        .await
    }

    async fn send_channel_message_notification(
        &self,
        channel_id: Uuid,
        message: &MutatedMessage,
        has_attachments: bool,
        context: &PostedMessageNotificationContext,
    ) -> anyhow::Result<()> {
        self.ingress
            .send_notification(
                SendNotificationRequestBuilder {
                    notification_entity: model_entity::EntityType::Channel
                        .with_entity_string(channel_id.to_string()),
                    notification: ChannelMessageSendMetadata {
                        message_id: message.id.to_string(),
                        sender: message.sender_id.clone(),
                        message_content: message.content.clone(),
                        has_attachments,
                        common: context.common.clone(),
                        sender_profile_picture_url: context.sender_profile_picture_url.clone(),
                    },
                    sender_id: Some(message.sender_id.clone()),
                    recipient_ids: context.recipients_without_sender_and_mentions.clone(),
                }
                .into_request()
                .with_apns()
                .with_conn_gateway(),
            )
            .await
            .map_err(|e| anyhow::anyhow!("{e:?}"))?;

        Ok(())
    }

    async fn dispatch_participants_added(
        &self,
        channel_id: Uuid,
        invited_by_user_id: MacroUserIdStr<'static>,
        recipient_user_ids: Vec<MacroUserIdStr<'static>>,
        metadata: ChannelMetadata,
        message_content: Option<String>,
    ) -> anyhow::Result<()> {
        let common = to_common_metadata(metadata);
        let sender_profile_picture_url =
            get_sender_profile_picture_url(&self.pool, &invited_by_user_id).await;
        let parsed_ids: Vec<_> = recipient_user_ids.iter().map(|u| u.0.clone()).collect();
        let existing_user_ids: HashSet<String> =
            macro_db_client::user::get_all::get_existing_users(&self.pool, &parsed_ids)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "unable to get existing users for invite");
                })
                .unwrap_or_default()
                .into_iter()
                .collect();

        send_invite_notifications(
            &*self.ingress,
            InviteNotifications {
                channel_id,
                invited_by_user_id,
                recipient_user_ids,
                existing_user_ids,
                sender_profile_picture_url,
                message_content,
                common,
            },
        )
        .await
    }
}

impl<I> ChannelNotificationDispatcher for NotificationChannelDispatcher<I>
where
    I: NotificationIngress + 'static,
{
    fn dispatch(&self, event: ChannelEvent) {
        let this = Self {
            pool: self.pool.clone(),
            ingress: self.ingress.clone(),
        };
        tokio::spawn(async move {
            if let Err(err) = this.dispatch_event(event).await {
                tracing::error!(error=?err, "unable to dispatch channel notification event");
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(email: &str) -> MacroUserIdStr<'static> {
        MacroUserIdStr::try_from_email(email).unwrap()
    }

    fn users(emails: &[&str]) -> Vec<MacroUserIdStr<'static>> {
        emails.iter().map(|email| user(email)).collect()
    }

    #[test]
    fn contact_sync_is_derived_from_private_channel_created() {
        let event = ChannelEvent::ChannelCreated {
            channel_id: Uuid::nil(),
            channel_type: ChannelType::Private,
            participant_user_ids: users(&["alice@example.com", "bob@example.com"]),
        };

        let contact_users = contact_sync_users_for_event(&event).unwrap();

        assert_eq!(contact_users.len(), 2);
        assert!(contact_users.contains(&user("alice@example.com")));
        assert!(contact_users.contains(&user("bob@example.com")));
    }

    #[test]
    fn contact_sync_ignores_public_channel_created() {
        let event = ChannelEvent::ChannelCreated {
            channel_id: Uuid::nil(),
            channel_type: ChannelType::Public,
            participant_user_ids: users(&["alice@example.com", "bob@example.com"]),
        };

        assert!(contact_sync_users_for_event(&event).is_none());
    }

    #[test]
    fn contact_sync_is_derived_from_team_participants_added() {
        let event = ChannelEvent::ParticipantsAdded {
            channel_id: Uuid::nil(),
            channel_type: ChannelType::Team,
            active_participant_user_ids: users(&["alice@example.com", "bob@example.com"]),
            invited_by_user_id: user("alice@example.com"),
            recipient_user_ids: users(&["bob@example.com"]),
            metadata: ChannelMetadata {
                channel_type: ChannelType::Team,
                channel_name: "team".to_string(),
            },
            message_content: None,
        };

        assert_eq!(contact_sync_users_for_event(&event).unwrap().len(), 2);
    }

    #[test]
    fn contact_sync_ignores_single_user_join() {
        let event = ChannelEvent::ParticipantJoined {
            channel_id: Uuid::nil(),
            channel_type: ChannelType::Public,
            user_id: user("alice@example.com"),
            active_participant_user_ids: users(&["alice@example.com"]),
        };

        assert!(contact_sync_users_for_event(&event).is_none());
    }
}
