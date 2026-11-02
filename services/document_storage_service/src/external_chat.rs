//! External chats (WhatsApp is the one provider): composition of the
//! `external_chat` crate, with `whatsapp_linked` as its provider, and DSS's
//! entity access, notification and static file clients; the notification
//! outbox worker, and the `external_chat_changed` pushes to open pages. The
//! session service runs the WhatsApp sockets; it reaches DSS only through
//! MacroDB rows and `NOTIFY`.

use crate::api::context::{AuthorizationService, EntityAccessService, NotificationIngressType};
use async_trait::async_trait;
use connection_gateway_client::client::ConnectionGatewayClient;
use entity_access::domain::ports::EntityAccessService as _;
use external_chat::{
    domain::{
        effects::EffectsService,
        media::MediaService,
        models::ExternalChatError,
        ports::{
            AudienceRepository, ChatEffect, ChatPublisher, ExternalChatResult, FileImport,
            FileStore, Origin, SendRateLimiter,
        },
        service::ExternalChatService,
    },
    inbound::router::ExternalChatRouterState,
    outbound::pg::PgExternalChatRepository,
    signals::{self, Change, ChangeSignal, trace_context},
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use notification::domain::{models::SendNotificationRequestBuilder, service::NotificationIngress};
use sqlx::PgPool;
use static_file_service_client::StaticFileServiceClient;
use std::{collections::HashSet, sync::Arc, time::Duration};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tracing::Instrument as _;
use uuid::Uuid;
use whatsapp_linked::{
    domain::{provider::WhatsAppProvider, service::WhatsAppService},
    inbound::router::WhatsAppRouterState,
    outbound::pg::PgWhatsAppRepository,
};

/// Router states mounted at `/external-chats` and `/whatsapp`.
#[derive(Clone)]
pub(crate) struct State {
    /// Added chats of every provider.
    pub chats: ExternalChatRouterState<WhatsAppProvider, EntityAccessService, AuthorizationService>,
    /// The caller's WhatsApp account, pairing and chat list.
    pub whatsapp: WhatsAppRouterState<AuthorizationService>,
}

/// Clients the linked composition needs from DSS.
pub(crate) struct Dependencies {
    pub static_files: StaticFileServiceClient,
    pub pool: PgPool,
    pub redis: redis::Client,
    pub access: Arc<EntityAccessService>,
    pub authorization: macro_authorization::MacroAuthorizationState<AuthorizationService>,
    pub notifications: Arc<NotificationIngressType>,
    pub connection_gateway: Arc<ConnectionGatewayClient>,
    pub tracker: TaskTracker,
    pub cancellation: CancellationToken,
}

/// Build the router state and start the publication worker.
pub(crate) fn build(dependencies: Dependencies) -> State {
    let Dependencies {
        static_files,
        pool,
        redis,
        access,
        authorization,
        notifications,
        connection_gateway,
        tracker,
        cancellation,
    } = dependencies;
    let whatsapp_repository = Arc::new(PgWhatsAppRepository::new(pool.clone()));
    let repository = Arc::new(PgExternalChatRepository::new(pool.clone()));
    let publisher = Arc::new(DssChatPublisher {
        audience: repository.clone(),
        access: access.clone(),
        notifications,
    });
    let media = MediaService::new(repository.clone(), Arc::new(StaticFiles(static_files)));
    let whatsapp = Arc::new(WhatsAppService::new(whatsapp_repository.clone()));
    let service = ExternalChatService::new(
        Arc::new(WhatsAppProvider::new(whatsapp_repository)),
        repository.clone(),
        Arc::new(SendRequestLimiter(rate_limit::RateLimitServiceImpl {
            repo: rate_limit::RedisRateLimitAdapter { redis },
        })),
    );
    tracker.spawn(push_changes(
        ChangePusher {
            pool: pool.clone(),
            audience: repository.clone(),
            whatsapp: whatsapp.clone(),
            access: access.clone(),
            gateway: connection_gateway,
        },
        cancellation.clone(),
    ));
    tracker.spawn(publish(
        pool,
        EffectsService::new(repository, publisher),
        media,
        whatsapp.clone(),
        cancellation,
    ));
    State {
        chats: ExternalChatRouterState {
            service: Arc::new(service),
            entity_access_service: access,
            authorization_state: authorization.clone(),
        },
        whatsapp: WhatsAppRouterState {
            service: whatsapp,
            authorization_state: authorization,
        },
    }
}

/// Drain group notifications and attachment imports on the session service's `NOTIFY`,
/// and on a sweep that also retries deferred revisions.
async fn publish(
    pool: PgPool,
    effects: EffectsService,
    media: MediaService,
    whatsapp: Arc<WhatsAppService>,
    cancellation: CancellationToken,
) {
    let Some(mut listener) = listen(
        &pool,
        &[signals::CHAT_EFFECTS, signals::MEDIA_READY],
        &cancellation,
    )
    .await
    else {
        return;
    };
    let mut sweep = tokio::time::interval(Duration::from_secs(30));
    sweep.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        // A signal's trace continues into the drain it wakes.
        let traceparent = tokio::select! {
            _ = cancellation.cancelled() => break,
            _ = sweep.tick() => None,
            notification = listener.recv() => match notification {
                Ok(notification) => {
                    signals::Signal::parse(notification.payload()).and_then(|signal| signal.traceparent)
                }
                Err(error) => {
                    tracing::warn!(error = ?error, "WhatsApp notification/import listener reconnecting");
                    None
                }
            }
        };
        let span = tracing::info_span!("external_chat.drain");
        trace_context::adopt(&span, traceparent.as_deref());
        drain(&effects, &media, &whatsapp).instrument(span).await;
    }
}

/// Listen on `channels`, retrying every 5 seconds until it works or the
/// service stops (`None`). A dropped connection later is re-established by
/// `PgListener::recv` itself.
async fn listen(
    pool: &PgPool,
    channels: &[&str],
    cancellation: &CancellationToken,
) -> Option<sqlx::postgres::PgListener> {
    loop {
        let listening = async {
            let mut listener = sqlx::postgres::PgListener::connect_with(pool).await?;
            listener.listen_all(channels.iter().copied()).await?;
            Ok::<_, sqlx::Error>(listener)
        };
        match listening.await {
            Ok(listener) => return Some(listener),
            Err(error) => {
                tracing::warn!(error = %error, channels = ?channels, "WhatsApp listener will retry");
                tokio::select! {
                    _ = cancellation.cancelled() => return None,
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {}
                }
            }
        }
    }
}

/// Import ready attachments, delete released files, expire unsent uploads,
/// old receipts and pairings, and publish notifications.
async fn drain(effects: &EffectsService, media: &MediaService, whatsapp: &WhatsAppService) {
    loop {
        match media.import_pending().await {
            Ok(0) => break,
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(
                    code = error.current_context().code(),
                    "WhatsApp attachment import will retry"
                );
                break;
            }
        }
    }
    loop {
        match media.delete_released().await {
            Ok(0) => break,
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(
                    code = error.current_context().code(),
                    "Deleting WhatsApp attachment files will retry"
                );
                break;
            }
        }
    }
    if let Err(error) = media.expire_uploads().await {
        tracing::warn!(
            code = error.current_context().code(),
            "Expiring unsent uploads will retry"
        );
    }
    if let Err(error) = whatsapp.expire_retained().await {
        tracing::warn!(
            code = error.current_context().code(),
            "Expiring WhatsApp receipts and pairings will retry"
        );
    }
    loop {
        match effects.publish_pending().await {
            Ok(0) => break,
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(
                    code = error.current_context().code(),
                    "WhatsApp notification/import will retry"
                );
                break;
            }
        }
    }
}

/// Gateway message type of the bare change pushes; pages re-fetch on receipt.
const CHANGED_MESSAGE: &str = "external_chat_changed";

/// Turns `external_chat_changed` signals into bare gateway pushes: `{scope: "chats"}`
/// to an account's owner, `{scope: "chat", chatId}` to everyone who can
/// view a chat. No data travels; the page re-fetches.
struct ChangePusher {
    pool: PgPool,
    audience: Arc<PgExternalChatRepository>,
    whatsapp: Arc<WhatsAppService>,
    access: Arc<EntityAccessService>,
    gateway: Arc<ConnectionGatewayClient>,
}

impl ChangePusher {
    /// Users who see this change.
    async fn recipients(&self, change: Change) -> ExternalChatResult<Vec<String>> {
        match change {
            Change::Chats { account_id } => Ok(self
                .whatsapp
                .account_owner(account_id)
                .await?
                .into_iter()
                .collect()),
            Change::Chat { chat_id } => {
                let mut viewers: Vec<String> = self
                    .access
                    .get_users_by_entity(&chat_id.to_string(), EntityType::ExternalChat)
                    .await
                    .map_err(unavailable)?
                    .into_iter()
                    .map(|user| user.to_string())
                    .collect();
                // Link viewers become known once they read the group.
                viewers.extend(self.audience.link_viewers(chat_id).await?);
                viewers.sort();
                viewers.dedup();
                Ok(viewers)
            }
        }
    }

    #[tracing::instrument(
        name = "external_chat.changed.push",
        skip_all,
        err,
        fields(scope, chat_id, account_id, recipients)
    )]
    async fn push(&self, change: Change) -> ExternalChatResult<()> {
        let span = tracing::Span::current();
        let message = match change {
            Change::Chats { account_id } => {
                span.record("scope", "chats");
                span.record("account_id", tracing::field::display(account_id));
                serde_json::json!({ "scope": "chats" })
            }
            Change::Chat { chat_id } => {
                span.record("scope", "chat");
                span.record("chat_id", tracing::field::display(chat_id));
                serde_json::json!({ "scope": "chat", "chatId": chat_id })
            }
        };
        let recipients = self.recipients(change).await?;
        span.record("recipients", recipients.len());
        if recipients.is_empty() {
            return Ok(());
        }
        self.gateway
            .batch_send_message(
                CHANGED_MESSAGE.to_owned(),
                message,
                recipients
                    .iter()
                    .map(|user| EntityType::User.with_entity_str(user))
                    .collect(),
            )
            .await
            .map_err(|error| unavailable(format!("{error:#}")))?;
        Ok(())
    }
}

/// Push every `external_chat_changed` signal, coalescing a burst into one push per
/// change. A push that fails is dropped: pages also re-fetch on open.
async fn push_changes(pusher: ChangePusher, cancellation: CancellationToken) {
    let Some(mut listener) = listen(&pusher.pool, &[signals::CHANGED], &cancellation).await else {
        return;
    };
    loop {
        let first = tokio::select! {
            _ = cancellation.cancelled() => return,
            received = listener.recv() => received,
        };
        let mut batch = match first {
            Ok(notification) => vec![notification],
            Err(error) => {
                tracing::warn!(error = ?error, "WhatsApp change listener reconnecting");
                continue;
            }
        };
        while let Some(notification) = listener.next_buffered() {
            batch.push(notification);
        }
        let mut seen = HashSet::new();
        for notification in batch {
            let Some(signal) = ChangeSignal::parse(notification.payload()) else {
                tracing::warn!("Ignoring a malformed WhatsApp change signal");
                continue;
            };
            if !seen.insert(signal.change) {
                continue;
            }
            let span = tracing::info_span!("external_chat.changed.receive");
            trace_context::adopt(&span, signal.traceparent.as_deref());
            let _ = pusher.push(signal.change).instrument(span).await;
        }
    }
}

fn unavailable(error: impl std::fmt::Display) -> rootcause::Report<ExternalChatError> {
    rootcause::report!("{error}").context(ExternalChatError::Unavailable)
}

/// Generic notifications for shared external chat messages. Revisions,
/// reactions, history and replays never create a second notification.
struct DssChatPublisher {
    audience: Arc<PgExternalChatRepository>,
    access: Arc<EntityAccessService>,
    notifications: Arc<NotificationIngressType>,
}
#[async_trait]
impl ChatPublisher for DssChatPublisher {
    #[tracing::instrument(
        name = "external_chat.notify",
        skip_all,
        err,
        fields(chat_id = %effect.chat_id, message_id = %effect.message_id)
    )]
    async fn publish(&self, effect: &ChatEffect) -> ExternalChatResult<()> {
        if !effect.first_publication || effect.origin == Origin::History {
            return Ok(());
        }
        let Some(notice) = self
            .audience
            .message_notice(effect.chat_id, effect.message_id)
            .await?
        else {
            return Ok(());
        };
        if notice.superseded {
            return Ok(());
        }
        let mut viewers = self
            .access
            .get_users_by_entity(&effect.chat_id.to_string(), EntityType::ExternalChat)
            .await
            .map_err(unavailable)?;
        // Link viewers become known when they read the group. Recheck their
        // current permission so a revoked link never keeps notifying them.
        for viewer in self.audience.link_viewers(effect.chat_id).await? {
            viewers.push(MacroUserIdStr::try_from(viewer).map_err(unavailable)?);
        }
        let recipient_ids = viewers
            .into_iter()
            .filter(|u| effect.associated_user.as_deref() != Some(u.as_ref()))
            .map(|u| MacroUserIdStr::try_from(u.to_string()).map_err(unavailable))
            .collect::<ExternalChatResult<HashSet<_>>>()?;
        if recipient_ids.is_empty() {
            return Ok(());
        }
        let request = SendNotificationRequestBuilder {
            notification_entity: EntityType::ExternalChat
                .with_entity_string(effect.chat_id.to_string()),
            secondary_notification_entity: None,
            notification: model_notifications::ExternalChatMessageMetadata {
                provider: notice.provider,
                chat_name: notice.chat_name,
                message_id: effect.message_id,
            },
            sender_id: None,
            recipient_ids,
        }
        .into_request_with_id(effect.message_id)
        .with_apns()
        .with_conn_gateway();
        self.notifications
            .send_notification(request)
            .await
            .map_err(unavailable)?;
        Ok(())
    }
}

/// Stores imported and sent attachments as static files, like channel media,
/// owned by the uploader or the chat's owner.
struct StaticFiles(StaticFileServiceClient);

#[async_trait]
impl FileStore for StaticFiles {
    #[tracing::instrument(
        name = "external_chat.store_file",
        skip_all,
        err,
        fields(blob_id = %import.blob_id, chat_id = %import.chat_id, size = bytes.len(), file_id)
    )]
    async fn store(&self, import: &FileImport, bytes: Vec<u8>) -> ExternalChatResult<Uuid> {
        let stored = self
            .0
            .put_named_bytes_for_user(&import.owner, &import.filename, bytes.into(), &import.mime)
            .await
            .map_err(|error| unavailable(format!("{error:#}")))?;
        tracing::Span::current().record("file_id", &stored.id);
        Uuid::parse_str(&stored.id).map_err(unavailable)
    }

    #[tracing::instrument(name = "external_chat.delete_file", skip(self), err)]
    async fn delete(&self, file_id: Uuid) -> ExternalChatResult<()> {
        match self.0.delete_file(&file_id.to_string()).await {
            Ok(_) => Ok(()),
            Err(error)
                if error
                    .downcast_ref::<reqwest::Error>()
                    .and_then(reqwest::Error::status)
                    == Some(reqwest::StatusCode::NOT_FOUND) =>
            {
                Ok(())
            }
            Err(error) => Err(unavailable(format!("{error:#}"))),
        }
    }
}

/// Redis-backed request counter shared by every DSS replica. A failed send
/// request still consumes its slot; this limits requests rather than deliveries.
struct SendRequestLimiter<R>(R);

#[async_trait]
impl<R: rate_limit::RateLimitService> SendRateLimiter for SendRequestLimiter<R> {
    #[tracing::instrument(name = "external_chat.send_rate_limit", skip_all, err)]
    async fn check(&self, user: &MacroUserIdStr<'_>) -> ExternalChatResult<()> {
        let key = rate_limit::RateLimitKey::builder(&"whatsapp-linked-send")
            .append(&user.as_ref())
            .finish();
        let result = self
            .0
            .check_rate_limit(
                key,
                rate_limit::RateLimitConfig::new(1, Duration::from_secs(1)),
            )
            .await
            .map_err(|error| error.context(ExternalChatError::Unavailable))?;
        result
            .map(|_| ())
            .map_err(|_| ExternalChatError::RateLimited.into())
    }
}

#[cfg(test)]
mod test;
