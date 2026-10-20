//! Composition of messaging state with the owning channel/message domains.
//! External content is never passed through ordinary human send commands.

use async_trait::async_trait;
use channel_sender::ChannelSender;
use channels::{
    domain::{
        historical::{HistoricalChannel, HistoricalChannelKind},
        ports::ChannelRepo,
    },
    outbound::pg_channels_repo::{PgChannelsRepo, historical::advance_historical_activity},
};
use chrono::{SubsecRound, Utc};
use entity_access::domain::{
    models::{AdminTeamRole, EntityType, MemberTeamRole},
    ports::EntityAccessService as _,
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::{
    domain::{
        delivery::{MessageAudienceAccess, MessageRealtime},
        historical::{HistoricalBatch, HistoricalMessage},
        models::{MessageParent, PatchMessageNotificationPolicy, PostMessageNotificationPolicy},
        ports::{MessageChange, MessageEvent, MessageRepository},
        service::MessageWrite,
    },
    outbound::{
        connection_gateway::ConnectionGatewayMessages,
        entity_access_audience::EntityAccessMessageAudience,
        pg_message_repo::{ExternalMessageRevision, ExternalReplyAttribution, PgMessageRepository},
    },
};
use meta_messaging::{
    domain::{connection::*, events::*, models::*, ports::*},
    outbound::repository::PgMessagingRepository,
};
use sqlx::PgPool;
use std::{collections::HashSet, sync::Arc};
use uuid::Uuid;

use super::effects::NativeMessageEffects;
use crate::api::context::EntityAccessService;
mod groups;
pub(crate) mod linked;
#[cfg(test)]
mod test;

/// Native adapters instantiated only by DSS's composition root.
pub(crate) struct NativeChannels {
    linked: Option<linked::LinkedComposition>,
    pool: PgPool,
    access: Arc<EntityAccessService>,
    realtime: ConnectionGatewayMessages,
    search: sqs_client::SQS,
    files: Arc<dyn super::files::MessageFiles>,
    effects: Arc<dyn NativeMessageEffects>,
    channel_events: Arc<dyn channels::domain::ports::ChannelEventDispatcher>,
}
impl NativeChannels {
    pub(crate) fn new(
        pool: PgPool,
        access: Arc<EntityAccessService>,
        realtime: ConnectionGatewayMessages,
        search: sqs_client::SQS,
        files: Arc<dyn super::files::MessageFiles>,
        effects: Arc<dyn NativeMessageEffects>,
        channel_events: Arc<dyn channels::domain::ports::ChannelEventDispatcher>,
    ) -> Self {
        Self {
            linked: None,
            pool,
            access,
            realtime,
            search,
            files,
            effects,
            channel_events,
        }
    }

    async fn persist(
        &self,
        c: &Connection,
        m: &IncomingMessage,
        sender: Option<ChannelSender<'static>>,
        send: Option<Uuid>,
    ) -> PortResult<()> {
        let mut tx = self.pool.begin().await.map_err(error)?;
        let normalized = if let Some(send) = send {
            PgMessagingRepository::accepted_message_in(&mut tx, c, m, send).await?
        } else {
            PgMessagingRepository::resolve_message_in(&mut tx, c, m).await?
        };
        let m = &normalized;
        let reservation = PgMessagingRepository::reserve_message_in(&mut tx, c, m, send).await?;
        if reservation.create_channel {
            let owner = MacroUserIdStr::try_from(c.user_id.clone())
                .map_err(|_| MessagingError::Forbidden)?;
            let customer = m.author_name.as_deref().unwrap_or(m.customer_id.as_str());
            let name = customer.chars().take(100).collect::<String>();
            PgChannelsRepo::ensure_reserved_channel_in(
                &mut tx,
                &HistoricalChannel {
                    id: reservation.channel_id,
                    name,
                    kind: HistoricalChannelKind::Private,
                    owner,
                    participants: HashSet::new(),
                    created_at: if m.provenance == Provenance::OnboardingHistory {
                        m.timestamp
                    } else {
                        Utc::now()
                    },
                },
                m.provenance != Provenance::OnboardingHistory,
            )
            .await
            .map_err(error)?;
            let binding = match c.provider {
                Provider::Whatsapp => channels::domain::models::MessagingBinding::WhatsappDirect,
                Provider::Instagram => channels::domain::models::MessagingBinding::InstagramDirect,
            };
            PgChannelsRepo::bind_messaging_in(&mut tx, reservation.channel_id, binding)
                .await
                .map_err(error)?;
        }
        if reservation.create_message {
            let author = sender.clone().unwrap_or_else(|| {
                ChannelSender::new_external(if m.direction == Direction::Outbound {
                    c.id
                } else {
                    reservation.sender_id
                })
                .expect("non-nil database identity")
            });
            let label = if m.direction == Direction::Outbound {
                c.display_name.clone()
            } else {
                m.author_name
                    .clone()
                    .unwrap_or_else(|| m.customer_id.as_str().to_owned())
            };
            // A refresh during download must not show an empty message. File
            // completion replaces this transient notice with the actual caption.
            let content = if m.content.trim().is_empty()
                && (!m.media.is_empty() || m.message_type == "macro_media_reply")
            {
                "Loading attachment…".to_owned()
            } else {
                render_message_content(m)
            };
            PgMessageRepository::insert_historical_in(&mut tx,&HistoricalBatch{channel_id:reservation.channel_id,messages:vec![HistoricalMessage{
                id:reservation.message_id,thread_id:None,sender:author,imported_author:Some(label),content,created_at:m.timestamp.trunc_subsecs(6),updated_at:m.timestamp.trunc_subsecs(6),edited_at:None,
                import_metadata:serde_json::json!({"source":c.provider,"connection_id":c.id,"provider_message_id":m.message_id,"provenance":m.provenance,"direction":m.direction}),import_order:0,reactions:vec![],mentions:vec![],
            }]}).await.map_err(error)?;
            advance_historical_activity(&mut tx, reservation.channel_id, m.timestamp)
                .await
                .map_err(error)?;
        }
        if !reservation.create_message
            && let (Some(_), Some(sender)) = (send, sender.as_ref())
        {
            PgMessageRepository::attribute_accepted_reply_in(
                &mut tx,
                ExternalReplyAttribution {
                    channel: reservation.channel_id,
                    message: reservation.message_id,
                    connection: c.id,
                    provider_message: m.message_id.as_str(),
                    sender,
                    content: &render_message_content(m),
                },
            )
            .await
            .map_err(error)?;
        }
        PgMessagingRepository::finish_message_in(&mut tx, c, m, &reservation, send).await?;
        if m.group_id.is_none() {
            apply_revision(&mut tx, c.id, &m.customer_id, &m.message_id, m.direction).await?;
        }
        tx.commit().await.map_err(error)?;
        Ok(())
    }
}

pub(super) fn error(e: impl std::fmt::Display) -> rootcause::Report<MessagingError> {
    rootcause::report!("native messaging persistence failed: {e}")
        .context(MessagingError::Unavailable)
}

pub(super) fn access_error(
    error: entity_access::domain::models::AccessError,
) -> rootcause::Report<MessagingError> {
    use entity_access::domain::models::AccessError;
    match error {
        AccessError::Unauthorized
        | AccessError::UnauthorizedWithMessage(_)
        | AccessError::NotFound(_)
        | AccessError::BadRequest(_) => MessagingError::Forbidden.into(),
        AccessError::Unavailable(_) | AccessError::Internal(_) => {
            MessagingError::Unavailable.into()
        }
    }
}

// Provider messages are plain text, not Macro markdown commands or Magic Chips.
pub(super) fn plain_markdown(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if matches!(
            c,
            '\\' | '`' | '*' | '_' | '[' | ']' | '<' | '>' | '#' | '!'
        ) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

// Native read-only messages do not auto-link plain URLs. Use the existing link
// node only for validated public content URLs; all other provider text is inert.
pub(super) fn render_message_content(message: &IncomingMessage) -> String {
    use meta_messaging::domain::content::ContentLine;
    meta_messaging::domain::meta_content::normalize(message)
        .lines
        .into_iter()
        .map(|line| match line {
            ContentLine::Text(text) => plain_markdown(text),
            ContentLine::Link(url) => {
                let url = url.as_str();
                let link = serde_json::json!({"url":url,"text":url,"title":""});
                format!("<m-link>{link}</m-link>")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[async_trait]
impl NativeMessaging for NativeChannels {
    async fn revise(&self, c: &Connection, revision: &IncomingRevision) -> PortResult<()> {
        let mut tx = self.pool.begin().await.map_err(error)?;
        let mut revision = revision.clone();
        revision.customer_id = PgMessagingRepository::resolve_identifier_in(
            &mut tx,
            c,
            &revision.customer_id,
            Some(&revision.message_id),
        )
        .await?;
        PgMessagingRepository::record_revision_in(&mut tx, c, &revision).await?;
        apply_revision(
            &mut tx,
            c.id,
            &revision.customer_id,
            &revision.message_id,
            revision.direction,
        )
        .await?;
        tx.commit().await.map_err(error)
    }
    async fn require_admin(&self, team: Uuid, user: &str) -> PortResult<()> {
        let user = MacroUserIdStr::try_from(user).map_err(|_| MessagingError::Forbidden)?;
        self.access
            .generate_entity_access_receipt::<AdminTeamRole>(
                &user.0,
                None,
                &team.to_string(),
                EntityType::Team,
            )
            .await
            .map_err(access_error)?;
        Ok(())
    }
    async fn require_member(&self, team: Uuid, user: &str) -> PortResult<()> {
        let user = MacroUserIdStr::try_from(user).map_err(|_| MessagingError::Forbidden)?;
        self.access
            .generate_entity_access_receipt::<MemberTeamRole>(
                &user.0,
                None,
                &team.to_string(),
                EntityType::Team,
            )
            .await
            .map_err(access_error)?;
        Ok(())
    }
    async fn ingest(
        &self,
        c: &Connection,
        m: &IncomingMessage,
        media: Vec<Option<MediaBytes>>,
    ) -> PortResult<()> {
        self.persist(c, m, None, None).await?;
        if !media.is_empty() {
            self.files.receive(c, m, media).await?;
        }
        Ok(())
    }
    async fn media_unavailable(&self, c: &Connection, m: &IncomingMessage) -> PortResult<()> {
        let repo = PgMessagingRepository::new(self.pool.clone());
        let (channel, message) = repo.message_target(c.id, m.message_id.as_str()).await?;
        let notice = if m.media.len() > 1 {
            "Some attachments are unavailable."
        } else {
            "Attachment unavailable."
        };
        let body = format!("{}\n\n> {notice}", render_message_content(m));
        let mut tx = self.pool.begin().await.map_err(error)?;
        if !PgMessagingRepository::received_media_open_in(&mut tx, c.id, m.message_id.as_str())
            .await?
        {
            return Ok(());
        }
        PgMessageRepository::external_media_notice_in(
            &mut tx,
            channel,
            message,
            c.id,
            m.message_id.as_str(),
            &body,
        )
        .await
        .map_err(error)?;
        PgMessagingRepository::media_state_in(&mut tx, c.id, m.message_id.as_str(), false).await?;
        tx.commit().await.map_err(error)
    }
}

async fn apply_revision(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    connection: Uuid,
    customer: &ProviderId,
    message: &ProviderId,
    direction: Direction,
) -> PortResult<()> {
    if let Some(revision) =
        PgMessagingRepository::revision_in(tx, connection, customer, message, direction).await?
    {
        let content = revision.content.as_deref().map(plain_markdown);
        if PgMessageRepository::revise_external_in(
            tx,
            ExternalMessageRevision {
                channel: revision.channel_id,
                message: revision.message_id,
                connection,
                provider_message: message.as_str(),
                content: content.as_deref(),
                number: revision.edit_number,
                edited_at: revision.edited_at,
                deleted_at: revision.deleted_at,
            },
        )
        .await
        .map_err(error)?
        {
            PgMessagingRepository::revision_applied_in(
                tx,
                revision.message_id,
                revision.deleted_at.is_some(),
            )
            .await?;
        }
    }
    Ok(())
}

impl NativeChannels {
    async fn reconcile_effect(
        &self,
        repo: &PgMessagingRepository,
        effect: meta_messaging::outbound::repository::native::NativeEffect,
    ) -> PortResult<()> {
        let messages = PgMessageRepository::new(self.pool.clone());
        let channels = PgChannelsRepo::new(self.pool.clone());
        let audience = EntityAccessMessageAudience((*self.access).clone());
        let (channel, id, revision) = (effect.channel_id, effect.message_id, effect.revision);
        let parent = MessageParent::Channel(channel);
        let Some(message) = messages.get(&parent, id).await.map_err(error)? else {
            repo.native_effects_complete(id, revision).await?;
            return Ok(());
        };
        let mut candidates = self.realtime.subscribers(&parent).await.map_err(error)?;
        candidates.extend(
            channels
                .get_participants(channel)
                .await
                .map_err(error)?
                .into_iter()
                .map(|p| p.user_id.to_string()),
        );
        let viewers = audience.viewers(&parent, candidates).await.map_err(error)?;
        let actor = message.sender_id.as_ref().to_owned();
        let change = if effect.first_publication {
            MessageChange::Posted {
                notification_policy: PostMessageNotificationPolicy::Silent,
                message,
                mentions: vec![],
            }
        } else {
            MessageChange::Edited {
                notification_policy: PatchMessageNotificationPolicy::default(),
                message,
                mentions: vec![],
                previous_attachments: vec![],
            }
        };
        let event = MessageEvent {
            parent,
            actor,
            nonce: None,
            change,
        };
        // Soup's native lists consume their own user-scoped patch stream;
        // message_update only refreshes an already-open message timeline.
        let info = channels.get_channel_info(channel).await.map_err(error)?;
        self.effects
            .publish(&effect, &event, &info, &viewers)
            .await?;
        self.realtime.send(&event, viewers).await.map_err(error)?;
        self.search
            .send_message_to_search_event_queue(
                sqs_client::search::SearchQueueMessage::ChannelMessageUpdate(
                    sqs_client::search::channel::ChannelMessageUpdate {
                        channel_id: channel.to_string(),
                        message_id: id.to_string(),
                        index_override: None,
                    },
                ),
            )
            .await
            .map_err(error)?;
        if info.messaging_binding == channels::domain::models::MessagingBinding::WhatsappLinkedGroup
        {
            self.linked()?.repository.published(id, revision).await?;
        } else {
            repo.native_effects_complete(id, revision).await?;
        }
        Ok(())
    }
}

#[async_trait]
impl NativeConversation for NativeChannels {
    async fn upload_attachment(
        &self,
        user: &str,
        channel: Uuid,
        file: MediaBytes,
    ) -> PortResult<UploadedAttachment> {
        self.files.upload(user, channel, file).await
    }
    async fn require_send(&self, team: Uuid, channel: Uuid, user: &str) -> PortResult<()> {
        let user = MacroUserIdStr::try_from(user).map_err(|_| MessagingError::Forbidden)?;
        self.access
            .generate_entity_access_receipt::<MemberTeamRole>(
                &user.0,
                None,
                &team.to_string(),
                EntityType::Team,
            )
            .await
            .map_err(access_error)?;
        self.access
            .generate_entity_access_receipt::<MessageWrite>(
                &user.0,
                None,
                &channel.to_string(),
                EntityType::Channel,
            )
            .await
            .map_err(access_error)?;
        Ok(())
    }
    async fn require_media_access(&self, user: &str, document: Uuid) -> PortResult<()> {
        let user = MacroUserIdStr::try_from(user).map_err(|_| MessagingError::Forbidden)?;
        self.access
            .generate_entity_access_receipt::<entity_access::domain::models::ViewAccessLevel>(
                &user.0,
                None,
                &document.to_string(),
                EntityType::Document,
            )
            .await
            .map_err(access_error)?;
        Ok(())
    }
    async fn read_media(
        &self,
        user: &str,
        channel: Uuid,
        document: Uuid,
    ) -> PortResult<MediaBytes> {
        self.files.read(user, channel, document).await
    }
    async fn prepare_media(
        &self,
        user: &str,
        channel: Uuid,
        document: Uuid,
        file: MediaBytes,
    ) -> PortResult<OutboundMedia> {
        self.files.prepare(user, channel, document, file).await
    }
    async fn sent(
        &self,
        work: &SendWork,
        conversation: &Conversation,
        scope: &meta_messaging::domain::replies::AccountScope,
        id: &ProviderId,
    ) -> PortResult<()> {
        if scope.personal.is_some() {
            return self.sent_linked(work, conversation, scope, id).await;
        }
        let connection = PgMessagingRepository::new(self.pool.clone())
            .connection(scope.id)
            .await?
            .filter(|connection| connection.team_id == scope.team_id)
            .ok_or(MessagingError::NotFound)?;
        let c = &connection;
        let content = work
            .rendered_text
            .clone()
            .unwrap_or_else(|| match &work.request.message {
                ReplyContent::Mutation { .. } => String::new(),
                ReplyContent::Text { text } => text.clone(),
                ReplyContent::Template { parameters, .. } => {
                    format!("[WhatsApp template]\n{}", parameters.join("\n"))
                }
                ReplyContent::Media { caption, .. } => caption.clone().unwrap_or_default(),
            });
        let sender = ChannelSender::new_from_user(
            MacroUserIdStr::try_from(work.user_id.clone())
                .map_err(|_| MessagingError::Forbidden)?,
        );
        let m = IncomingMessage {
            group_id: None,
            provider: c.provider,
            account_id: c.account_id.clone(),
            customer_id: conversation.customer_id.clone(),
            customer_phone: None,
            message_id: id.clone(),
            author_handle: None,
            author_name: Some(c.display_name.clone()),
            content,
            timestamp: work.created_at,
            direction: Direction::Outbound,
            provenance: Provenance::MacroReply,
            message_type: if matches!(work.request.message, ReplyContent::Media { .. }) {
                "macro_media_reply"
            } else {
                "macro_reply"
            }
            .into(),
            reply_to: work.request.reply_to.clone(),
            media: vec![],
        };
        self.persist(c, &m, Some(sender), Some(work.lease.id))
            .await?;
        self.files.attach_sent(work, c, id).await
    }
    async fn reconcile_effects(&self) -> PortResult<usize> {
        let repo = PgMessagingRepository::new(self.pool.clone());
        let mut first_error = None;
        let mut effects = repo.pending_native_effects().await?;
        if let Some(linked) = &self.linked {
            effects.extend(linked.repository.effects().await?);
        }
        let count = effects.len();
        for effect in effects {
            let (message, revision) = (effect.message_id, effect.revision);
            if let Err(error) = self.reconcile_effect(&repo, effect).await {
                // A failed publication stays pending, but cannot hold up the
                // other customer conversations in this batch.
                first_error.get_or_insert(error);
                if let Err(error) = repo.defer_native_effect(message, revision).await {
                    first_error.get_or_insert(error);
                }
            }
        }
        first_error.map_or(Ok(count), Err)
    }
}
