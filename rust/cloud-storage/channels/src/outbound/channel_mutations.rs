//! Outbound adapters for channel mutation ports.

use crate::domain::{
    models::{
        ChannelInfo, ChannelMetadata, ChannelParticipant, ChannelType, CountedReaction,
        CreateChannelRequest, MutatedAttachment, MutatedMessage, NewChannelAttachment,
        ParticipantRole, PatchChannelRequest, SimpleMention,
    },
    ports::{
        ChannelContactsDispatcher, ChannelMutationsRepo, ChannelNotificationDispatcher,
        ChannelRealtimeGateway, ChannelSearchIndexer, ChannelSharePermissionService,
    },
};
use anyhow::Context;
use comms::outbound::postgres::channel_name::batch_resolve_channel_names;
use comms_db_client::{
    activity::upsert_activity::upsert_activity,
    attachments::{
        delete_attachments::delete_attachments_by_ids,
        get_attachments::get_attachments_by_message_id,
    },
    channels::{
        create_channel::{CreateChannelOptions, create_channel},
        delete_channel::delete_channel,
        get_channel_info::get_channel_info,
        get_dm::maybe_get_dm,
        get_private::maybe_get_private_channel,
        patch_channel::{PatchChannelOptions, patch_channel},
        updated_at::updated_at,
    },
    entity_mentions::{delete_entity_mentions_by_entity, delete_entity_mentions_by_source},
    messages::{
        add_attachments::add_attachments_to_message,
        create_message::{CreateMessageOptions, create_message},
        create_message_mentions::{CreateMessageMentionOptions, create_message_mentions},
        delete_message::delete_message,
        get_count::get_channel_message_count,
        get_message_owner::get_message_owner,
        patch_message::{patch_message, patch_message_attachments},
    },
    participants::{
        add_participant::{AddParticipantOptions, add_participant},
        get_participants::{get_channel_participants_for_thread_id, get_participants},
        remove_participant::{RemoveParticipantOptions, remove_participant},
    },
    reactions::{
        add_reaction::add_reaction, get_reactions::get_message_reactions, group_reactions,
        remove_reaction::remove_reaction,
    },
};
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
use std::{collections::HashSet, iter::once, str::FromStr, sync::Arc};
use uuid::Uuid;

/// Postgres-backed mutation repository.
#[derive(Clone)]
pub struct PgChannelMutationsRepo {
    pool: PgPool,
}

impl PgChannelMutationsRepo {
    /// Create a Postgres mutation repository.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn to_model_channel_type(channel_type: ChannelType) -> model::comms::ChannelType {
    match channel_type {
        ChannelType::Public => model::comms::ChannelType::Public,
        ChannelType::Organization => model::comms::ChannelType::Organization,
        ChannelType::Private => model::comms::ChannelType::Private,
        ChannelType::DirectMessage => model::comms::ChannelType::DirectMessage,
        ChannelType::Team => model::comms::ChannelType::Team,
    }
}

fn from_model_channel_type(channel_type: model::comms::ChannelType) -> ChannelType {
    match channel_type {
        model::comms::ChannelType::Public => ChannelType::Public,
        model::comms::ChannelType::Organization => ChannelType::Organization,
        model::comms::ChannelType::Private => ChannelType::Private,
        model::comms::ChannelType::DirectMessage => ChannelType::DirectMessage,
        model::comms::ChannelType::Team => ChannelType::Team,
    }
}

fn to_model_participant_role(role: ParticipantRole) -> model::comms::ParticipantRole {
    match role {
        ParticipantRole::Owner => model::comms::ParticipantRole::Owner,
        ParticipantRole::Admin => model::comms::ParticipantRole::Admin,
        ParticipantRole::Member => model::comms::ParticipantRole::Member,
    }
}

fn from_models_participant_role(role: models_comms::channel::ParticipantRole) -> ParticipantRole {
    match role {
        models_comms::channel::ParticipantRole::Owner => ParticipantRole::Owner,
        models_comms::channel::ParticipantRole::Admin => ParticipantRole::Admin,
        models_comms::channel::ParticipantRole::Member => ParticipantRole::Member,
    }
}

fn to_db_mention(mention: SimpleMention) -> comms_db_client::model::SimpleMention {
    comms_db_client::model::SimpleMention {
        entity_type: mention.entity_type,
        entity_id: mention.entity_id,
    }
}

fn to_db_attachment(attachment: NewChannelAttachment) -> comms_db_client::model::NewAttachment {
    comms_db_client::model::NewAttachment {
        entity_type: attachment.entity_type,
        entity_id: attachment.entity_id,
        height: attachment.height,
        width: attachment.width,
    }
}

fn from_db_message(message: comms_db_client::model::Message) -> MutatedMessage {
    MutatedMessage {
        id: message.id,
        channel_id: message.channel_id,
        thread_id: message.thread_id,
        sender_id: message.sender_id,
        content: message.content,
        created_at: message.created_at,
        updated_at: message.updated_at,
        edited_at: message.edited_at,
        deleted_at: message.deleted_at,
    }
}

fn from_db_attachment(attachment: comms_db_client::model::Attachment) -> MutatedAttachment {
    MutatedAttachment {
        id: attachment.id,
        channel_id: attachment.channel_id,
        message_id: attachment.message_id,
        entity_type: attachment.entity_type,
        entity_id: attachment.entity_id,
        width: attachment.width,
        height: attachment.height,
        created_at: attachment.created_at,
    }
}

fn from_db_counted_reaction(reaction: comms_db_client::model::CountedReaction) -> CountedReaction {
    CountedReaction {
        emoji: reaction.emoji,
        users: reaction.users,
    }
}

fn from_db_participant(
    participant: models_comms::channel::ChannelParticipant,
) -> ChannelParticipant {
    ChannelParticipant {
        channel_id: participant.channel_id.0,
        user_id: participant.user_id.as_ref().to_string(),
        role: from_models_participant_role(participant.role),
        joined_at: participant.joined_at,
        left_at: participant.left_at,
    }
}

impl ChannelMutationsRepo for PgChannelMutationsRepo {
    type Err = anyhow::Error;

    async fn get_channel_info(&self, channel_id: Uuid) -> Result<ChannelInfo, Self::Err> {
        let info = get_channel_info(&self.pool, &channel_id).await?;
        Ok(ChannelInfo {
            id: channel_id,
            name: info.name,
            channel_type: from_model_channel_type(info.channel_type),
            org_id: info.org_id,
            team_id: None,
        })
    }

    async fn get_channel_metadata(
        &self,
        channel_id: Uuid,
        viewer_user_id: MacroUserIdStr<'static>,
    ) -> Result<ChannelMetadata, Self::Err> {
        let info = self.get_channel_info(channel_id).await?;
        let channel_name = batch_resolve_channel_names(&self.pool, &[channel_id], viewer_user_id)
            .await?
            .remove(&channel_id)
            .unwrap_or_else(|| info.name.clone().unwrap_or_default());
        Ok(ChannelMetadata {
            channel_type: info.channel_type,
            channel_name,
        })
    }

    async fn user_has_team(&self, user_id: String, team_id: Uuid) -> Result<bool, Self::Err> {
        let teams = macro_db_client::team::get::get_user_teams(&self.pool, &user_id).await?;
        Ok(teams.into_iter().any(|team| team.id == team_id))
    }

    async fn create_channel(
        &self,
        owner_id: String,
        org_id: Option<i64>,
        req: CreateChannelRequest,
    ) -> Result<Uuid, Self::Err> {
        create_channel(
            &self.pool,
            CreateChannelOptions {
                name: req.name,
                owner_id,
                org_id,
                channel_type: to_model_channel_type(req.channel_type),
                participants: req.participants,
                team_id: req.team_id,
            },
        )
        .await
    }

    async fn maybe_get_dm(
        &self,
        user_id: String,
        recipient_id: String,
    ) -> Result<Option<Uuid>, Self::Err> {
        maybe_get_dm(&self.pool, &user_id, &recipient_id).await
    }

    async fn maybe_get_private_channel(
        &self,
        participants: Vec<String>,
    ) -> Result<Option<Uuid>, Self::Err> {
        maybe_get_private_channel(&self.pool, &participants).await
    }

    async fn patch_channel(
        &self,
        channel_id: Uuid,
        user_id: String,
        req: PatchChannelRequest,
    ) -> Result<(), Self::Err> {
        patch_channel(
            &self.pool,
            &channel_id,
            &user_id,
            PatchChannelOptions {
                channel_name: req.channel_name,
            },
        )
        .await
    }

    async fn delete_channel(&self, channel_id: Uuid, user_id: String) -> Result<(), Self::Err> {
        delete_channel(&self.pool, channel_id, &user_id).await
    }

    async fn add_participant(
        &self,
        channel_id: Uuid,
        user_id: String,
        role: ParticipantRole,
    ) -> Result<(), Self::Err> {
        add_participant(
            &self.pool,
            AddParticipantOptions {
                channel_id: &channel_id,
                user_id: &user_id,
                participant_role: Some(to_model_participant_role(role)),
            },
        )
        .await
    }

    async fn remove_participant(&self, channel_id: Uuid, user_id: String) -> Result<(), Self::Err> {
        remove_participant(
            &self.pool,
            RemoveParticipantOptions {
                channel_id: &channel_id,
                user_id: &user_id,
            },
        )
        .await
    }

    async fn create_message(
        &self,
        channel_id: Uuid,
        sender_id: String,
        content: String,
        thread_id: Option<Uuid>,
    ) -> Result<MutatedMessage, Self::Err> {
        create_message(
            &self.pool,
            CreateMessageOptions {
                channel_id,
                sender_id,
                content,
                thread_id,
            },
        )
        .await
        .map(from_db_message)
    }

    async fn touch_channel_updated_at(&self, channel_id: Uuid) -> Result<(), Self::Err> {
        updated_at(&self.pool, &channel_id).await.map(|_| ())
    }

    async fn create_message_mentions(
        &self,
        message_id: Uuid,
        mentions: Vec<SimpleMention>,
    ) -> Result<(), Self::Err> {
        let mentions = mentions.into_iter().map(to_db_mention).collect();
        create_message_mentions(
            &self.pool,
            CreateMessageMentionOptions {
                message_id,
                mentions,
            },
        )
        .await
        .map(|_| ())
    }

    async fn sync_message_mentions(
        &self,
        message_id: Uuid,
        mentions: Vec<SimpleMention>,
    ) -> Result<(), Self::Err> {
        let mut tx = self.pool.begin().await?;
        delete_entity_mentions_by_source(&mut *tx, vec![message_id.to_string()]).await?;
        create_message_mentions(
            &mut *tx,
            CreateMessageMentionOptions {
                message_id,
                mentions: mentions.into_iter().map(to_db_mention).collect(),
            },
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    async fn add_attachments(
        &self,
        message_id: Uuid,
        channel_id: Uuid,
        attachments: Vec<NewChannelAttachment>,
    ) -> Result<Vec<MutatedAttachment>, Self::Err> {
        add_attachments_to_message(
            &self.pool,
            &message_id,
            &channel_id,
            attachments.into_iter().map(to_db_attachment).collect(),
        )
        .await
        .map(|a| a.into_iter().map(from_db_attachment).collect())
    }

    async fn get_message_attachments(
        &self,
        message_id: Uuid,
    ) -> Result<Vec<MutatedAttachment>, Self::Err> {
        get_attachments_by_message_id(&self.pool, message_id)
            .await
            .map(|a| a.into_iter().map(from_db_attachment).collect())
    }

    async fn delete_attachments(&self, attachment_ids: Vec<Uuid>) -> Result<(), Self::Err> {
        delete_attachments_by_ids(&self.pool, attachment_ids)
            .await
            .map(|_| ())
    }

    async fn delete_entity_mentions_for_entities(
        &self,
        entity_ids: Vec<String>,
        source_entity_id: String,
    ) -> Result<(), Self::Err> {
        delete_entity_mentions_by_entity(&self.pool, entity_ids, source_entity_id)
            .await
            .map(|_| ())
    }

    async fn patch_message_attachments(
        &self,
        message_id: Uuid,
        attachments: Vec<MutatedAttachment>,
    ) -> Result<MutatedMessage, Self::Err> {
        let attachments = attachments
            .into_iter()
            .map(|a| comms_db_client::model::Attachment {
                id: a.id,
                channel_id: a.channel_id,
                message_id: a.message_id,
                entity_type: a.entity_type,
                entity_id: a.entity_id,
                width: a.width,
                height: a.height,
                created_at: a.created_at,
            })
            .collect();
        patch_message_attachments(&self.pool, message_id, attachments)
            .await
            .map(from_db_message)
    }

    async fn patch_message(
        &self,
        message_id: Uuid,
        content: String,
    ) -> Result<MutatedMessage, Self::Err> {
        patch_message(&self.pool, message_id, &content)
            .await
            .map(from_db_message)
    }

    async fn delete_message(&self, message_id: Uuid) -> Result<MutatedMessage, Self::Err> {
        delete_message(&self.pool, message_id)
            .await
            .map(from_db_message)
    }

    async fn get_message_owner(&self, message_id: Uuid) -> Result<String, Self::Err> {
        get_message_owner(&self.pool, &message_id).await
    }

    async fn get_participants(
        &self,
        channel_id: Uuid,
    ) -> Result<Vec<ChannelParticipant>, Self::Err> {
        get_participants(&self.pool, &channel_id)
            .await
            .map(|p| p.into_iter().map(from_db_participant).collect())
            .map_err(Into::into)
    }

    async fn get_thread_participants(
        &self,
        thread_id: Uuid,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Self::Err> {
        get_channel_participants_for_thread_id(&self.pool, &thread_id).await
    }

    async fn upsert_activity(&self, user_id: String, channel_id: Uuid) -> Result<(), Self::Err> {
        upsert_activity(
            &self.pool,
            &user_id,
            &channel_id,
            &comms_db_client::model::ActivityType::Interact,
        )
        .await?;
        Ok(())
    }

    async fn add_reaction(
        &self,
        message_id: Uuid,
        emoji: String,
        user_id: String,
    ) -> Result<(), Self::Err> {
        add_reaction(&self.pool, message_id, emoji, user_id).await
    }

    async fn remove_reaction(
        &self,
        message_id: Uuid,
        emoji: String,
        user_id: String,
    ) -> Result<(), Self::Err> {
        remove_reaction(&self.pool, message_id, emoji, user_id).await
    }

    async fn get_message_reactions(
        &self,
        message_id: Uuid,
    ) -> Result<Vec<CountedReaction>, Self::Err> {
        get_message_reactions(&self.pool, message_id)
            .await
            .map(group_reactions)
            .map(|r| r.into_iter().map(from_db_counted_reaction).collect())
    }
}

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

/// Contacts ingress adapter.
#[derive(Clone)]
pub struct ContactsChannelDispatcher<I> {
    ingress: Arc<I>,
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

async fn send_invite_notifications(
    ingress: &impl NotificationIngress,
    channel_id: &Uuid,
    invited_by_user_id: &MacroUserIdStr<'static>,
    recipient_user_ids: Vec<MacroUserIdStr<'static>>,
    existing_user_ids: HashSet<String>,
    sender_profile_picture_url: Option<String>,
    common: CommonChannelMetadata,
) -> anyhow::Result<()> {
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

impl<I> ChannelNotificationDispatcher for NotificationChannelDispatcher<I>
where
    I: NotificationIngress,
{
    type Err = anyhow::Error;

    async fn dispatch_message_notifications(
        &self,
        channel_id: Uuid,
        metadata: ChannelMetadata,
        participants: Vec<ChannelParticipant>,
        message: MutatedMessage,
        mentions: Vec<SimpleMention>,
        has_attachments: bool,
    ) -> Result<(), Self::Err> {
        let common = to_common_metadata(metadata);
        let channel_message_count = get_channel_message_count(&self.pool, &channel_id).await?;
        let existing_user_ids: HashSet<String> =
            if channel_message_count <= 1 && message.thread_id.is_none() {
                let participant_ids: Vec<_> = participants
                    .iter()
                    .filter_map(|p| MacroUserIdStr::parse_from_str(&p.user_id).ok())
                    .map(|id| id.0)
                    .collect();
                macro_db_client::user::get_all::get_existing_users(&self.pool, &participant_ids)
                    .await?
                    .into_iter()
                    .collect()
            } else {
                HashSet::new()
            };

        let (user_mentions, document_mention_ids) =
            mentions
                .into_iter()
                .fold((Vec::new(), Vec::new()), |(mut users, mut docs), m| {
                    match m.entity_type.as_str() {
                        "user" => users.push(m.entity_id),
                        "document" => docs.push(m.entity_id),
                        _ => {}
                    }
                    (users, docs)
                });

        let document_mentions =
            macro_db_client::notification::get_basic_cloud_storage_documents_metadata(
                &self.pool,
                &document_mention_ids,
            )
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "unable to get documents metadata");
            })
            .unwrap_or_default();

        let (thread_participants, thread_parent_sender_id): (
            Vec<MacroUserIdStr<'static>>,
            Option<MacroUserIdStr<'static>>,
        ) = if let Some(thread_id) = message.thread_id {
            let participants = get_channel_participants_for_thread_id(&self.pool, &thread_id)
                .await
                .unwrap_or_default();
            let sender_id = match get_message_owner(&self.pool, &thread_id).await {
                Ok(id) => MacroUserIdStr::parse_from_str(&id)
                    .ok()
                    .map(|id| id.into_owned()),
                Err(_) => None,
            };
            (participants, sender_id)
        } else {
            (vec![], None)
        };

        let sender_profile_picture_url =
            get_sender_profile_picture_url(&self.pool, &message.sender_id).await;
        let entity =
            || model_entity::EntityType::Channel.with_entity_string(channel_id.to_string());
        let sender = || Some(message.sender_id.clone());

        if !user_mentions.is_empty() {
            self.ingress
                .send_notification(
                    SendNotificationRequestBuilder {
                        notification_entity: entity(),
                        notification: ChannelMentionMetadata {
                            message_content: message.content.clone(),
                            message_id: message.id.to_string(),
                            has_attachments,
                            thread_id: message.thread_id.map(|t| t.to_string()),
                            common: common.clone(),
                            sender_profile_picture_url: sender_profile_picture_url.clone(),
                        },
                        sender_id: sender(),
                        recipient_ids: recipients_excluding(
                            user_mentions.iter().map(|m| m.as_str()),
                            once(message.sender_id.as_ref()),
                        )
                        .collect(),
                    }
                    .into_request()
                    .with_apns()
                    .with_conn_gateway(),
                )
                .await
                .map_err(|e| anyhow::anyhow!("{e:?}"))?;
        }

        if !document_mentions.is_empty() {
            let doc_recipients: HashSet<_> = recipients_excluding(
                participants.iter().map(|p| p.user_id.as_str()),
                once(message.sender_id.as_ref()),
            )
            .collect();

            for mention in document_mentions {
                self.ingress
                    .send_notification(
                        SendNotificationRequestBuilder {
                            notification_entity: entity(),
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
                                    thread_id: message.thread_id.map(|t| t.to_string()),
                                    common: common.clone(),
                                    sender_profile_picture_url: sender_profile_picture_url.clone(),
                                },
                            },
                            sender_id: sender(),
                            recipient_ids: doc_recipients.clone(),
                        }
                        .into_request()
                        .with_apns()
                        .with_conn_gateway(),
                    )
                    .await
                    .map_err(|e| anyhow::anyhow!("{e:?}"))?;
            }
        }

        let sender_and_mentions = once(message.sender_id.as_ref())
            .chain(user_mentions.iter().map(String::as_str))
            .collect::<Vec<&str>>();
        let recipients_without_sender_and_mentions: HashSet<_> = recipients_excluding(
            participants.iter().map(|p| p.user_id.as_str()),
            sender_and_mentions.clone(),
        )
        .collect();

        match (channel_message_count, message.thread_id) {
            (_, Some(thread_id)) => {
                if !thread_participants.is_empty() {
                    self.ingress
                        .send_notification(
                            SendNotificationRequestBuilder {
                                notification_entity: entity(),
                                notification: ChannelReplyMetadata {
                                    thread_id: thread_id.to_string(),
                                    message_id: message.id.to_string(),
                                    user_id: message.sender_id.clone(),
                                    message_content: message.content.clone(),
                                    has_attachments,
                                    thread_parent_sender_id,
                                    common,
                                    sender_profile_picture_url,
                                },
                                sender_id: sender(),
                                recipient_ids: recipients_excluding(
                                    thread_participants.iter().map(|p| p.as_ref()),
                                    sender_and_mentions,
                                )
                                .collect(),
                            }
                            .into_request()
                            .with_apns()
                            .with_conn_gateway(),
                        )
                        .await
                        .map_err(|e| anyhow::anyhow!("{e:?}"))?;
                } else {
                    tracing::warn!("thread participants is empty, but message has thread id");
                }
            }
            (..=1, None) => {
                send_invite_notifications(
                    &*self.ingress,
                    &channel_id,
                    &message.sender_id,
                    recipients_without_sender_and_mentions.into_iter().collect(),
                    existing_user_ids,
                    sender_profile_picture_url,
                    common,
                )
                .await?;
            }
            (_, None) => {
                self.ingress
                    .send_notification(
                        SendNotificationRequestBuilder {
                            notification_entity: entity(),
                            notification: ChannelMessageSendMetadata {
                                message_id: message.id.to_string(),
                                sender: message.sender_id.clone(),
                                message_content: message.content.clone(),
                                has_attachments,
                                common,
                                sender_profile_picture_url,
                            },
                            sender_id: sender(),
                            recipient_ids: recipients_without_sender_and_mentions,
                        }
                        .into_request()
                        .with_apns()
                        .with_conn_gateway(),
                    )
                    .await
                    .map_err(|e| anyhow::anyhow!("{e:?}"))?;
            }
        }
        Ok(())
    }

    async fn dispatch_invite_notifications(
        &self,
        channel_id: Uuid,
        invited_by_user_id: MacroUserIdStr<'static>,
        recipient_user_ids: Vec<MacroUserIdStr<'static>>,
        metadata: ChannelMetadata,
    ) -> Result<(), Self::Err> {
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
            &channel_id,
            &invited_by_user_id,
            recipient_user_ids,
            existing_user_ids,
            sender_profile_picture_url,
            common,
        )
        .await
    }
}
