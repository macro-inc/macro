//! Personal WhatsApp linked devices: composition of the `whatsapp_linked` domain
//! crate with DSS's entity access, notification and document clients, the
//! notification outbox worker, and the `whatsapp_changed` pushes to open pages.
//! The session service runs the WhatsApp sockets; it reaches DSS only through
//! MacroDB rows and `NOTIFY`.

use crate::api::context::{AuthorizationService, EntityAccessService, NotificationIngressType};
use async_trait::async_trait;
use connection_gateway_client::client::ConnectionGatewayClient;
use documents_hex::domain::{
    models::{InitialLinkShare, NewDocument},
    ports::DocumentService as _,
};
use entity_access::domain::ports::EntityAccessService as _;
use macro_user_id::user_id::MacroUserIdStr;
use model::document::FileType;
use model_entity::EntityType;
use model_owner::CreationPrincipal;
use models_permissions::share_permission::LinkShareState;
use notification::domain::{models::SendNotificationRequestBuilder, service::NotificationIngress};
use sqlx::PgPool;
use std::{collections::HashSet, sync::Arc, time::Duration};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tracing::Instrument as _;
use whatsapp_linked::{
    domain::{
        effects::EffectsService,
        media::MediaService,
        models::{Features, LinkedError},
        ports::{
            DocumentImport, DocumentStore, GroupEffect, GroupPublisher, LinkedResult, Origin,
            SendRateLimiter,
        },
        service::LinkedService,
    },
    inbound::router::LinkedRouterState,
    outbound::{
        access::EntityAccessAuthorizer,
        pg::{
            PgLinkedRepository,
            signals::{self, Change, ChangeSignal},
        },
        trace_context,
    },
};

/// Router state mounted at `/meta/linked`.
pub(crate) type State = LinkedRouterState<EntityAccessService, AuthorizationService>;

/// Clients the linked composition needs from DSS.
pub(crate) struct Dependencies {
    pub features: Features,
    pub documents: Arc<crate::api::context::DocumentService>,
    pub s3: aws_sdk_s3::Client,
    pub document_bucket: String,
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
        features,
        documents,
        s3,
        document_bucket,
        pool,
        redis,
        access,
        authorization,
        notifications,
        connection_gateway,
        tracker,
        cancellation,
    } = dependencies;
    let repository = Arc::new(PgLinkedRepository::new(pool.clone()));
    let publisher = Arc::new(DssGroupPublisher {
        pool: pool.clone(),
        access: access.clone(),
        notifications,
    });
    let media = MediaService::new(
        repository.clone(),
        Arc::new(DssDocumentStore {
            pool: pool.clone(),
            documents,
            s3,
            bucket: document_bucket,
        }),
    );
    let service = LinkedService::new(
        features,
        repository.clone(),
        Arc::new(EntityAccessAuthorizer::new(access.clone())),
        Arc::new(SendRequestLimiter(rate_limit::RateLimitServiceImpl {
            repo: rate_limit::RedisRateLimitAdapter { redis },
        })),
    );
    tracker.spawn(push_changes(
        ChangePusher {
            pool: pool.clone(),
            access: access.clone(),
            gateway: connection_gateway,
        },
        cancellation.clone(),
    ));
    tracker.spawn(publish(
        pool,
        EffectsService::new(repository, publisher),
        media,
        cancellation,
    ));
    LinkedRouterState {
        service: Arc::new(service),
        entity_access_service: access,
        authorization_state: authorization,
    }
}

/// Drain group notifications and attachment imports on the session service's `NOTIFY`,
/// and on a sweep that also retries deferred revisions.
async fn publish(
    pool: PgPool,
    effects: EffectsService,
    media: MediaService,
    cancellation: CancellationToken,
) {
    let mut listener = match sqlx::postgres::PgListener::connect_with(&pool).await {
        Ok(mut listener) => match listener
            .listen_all([signals::GROUP_EFFECTS, signals::MEDIA_READY])
            .await
        {
            Ok(()) => Some(listener),
            Err(error) => {
                tracing::warn!(error = ?error, "WhatsApp notification/import will only sweep");
                None
            }
        },
        Err(error) => {
            tracing::warn!(error = ?error, "WhatsApp notification/import will only sweep");
            None
        }
    };
    let mut sweep = tokio::time::interval(Duration::from_secs(30));
    sweep.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        // A signal's trace continues into the drain it wakes.
        let traceparent = tokio::select! {
            _ = cancellation.cancelled() => break,
            _ = sweep.tick() => None,
            notification = async {
                match listener.as_mut() {
                    Some(listener) => listener.recv().await,
                    None => std::future::pending().await,
                }
            } => match notification {
                Ok(notification) => {
                    signals::Signal::parse(notification.payload()).and_then(|signal| signal.traceparent)
                }
                Err(error) => {
                    tracing::warn!(error = ?error, "WhatsApp notification/import listener reconnecting");
                    None
                }
            }
        };
        let span = tracing::info_span!("whatsapp.linked.drain");
        trace_context::adopt(&span, traceparent.as_deref());
        drain(&effects, &media).instrument(span).await;
    }
}

/// Import ready attachments, expire unsent uploads and publish notifications.
async fn drain(effects: &EffectsService, media: &MediaService) {
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
    if let Err(error) = media.expire_uploads().await {
        tracing::warn!(
            code = error.current_context().code(),
            "Expiring WhatsApp uploads will retry"
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
const CHANGED_MESSAGE: &str = "whatsapp_changed";

/// Turns `whatsapp_changed` signals into bare gateway pushes: `{scope: "groups"}`
/// to an account's owner, `{scope: "group", group_id}` to everyone who can
/// view a group. No data travels; the page re-fetches.
struct ChangePusher {
    pool: PgPool,
    access: Arc<EntityAccessService>,
    gateway: Arc<ConnectionGatewayClient>,
}

impl ChangePusher {
    /// Users who see this change.
    async fn recipients(&self, change: Change) -> LinkedResult<Vec<String>> {
        match change {
            Change::Groups { account_id } => Ok(sqlx::query_scalar!(
                "SELECT user_id FROM whatsapp_linked_account WHERE id = $1",
                account_id
            )
            .fetch_optional(&self.pool)
            .await
            .map_err(unavailable)?
            .into_iter()
            .collect()),
            Change::Group { group_id } => {
                let mut viewers: Vec<String> = self
                    .access
                    .get_users_by_entity(&group_id.to_string(), EntityType::WhatsAppGroup)
                    .await
                    .map_err(unavailable)?
                    .into_iter()
                    .map(|user| user.to_string())
                    .collect();
                // Link viewers become known once they read the group.
                viewers.extend(
                    sqlx::query_scalar!(
                        "SELECT user_id FROM whatsapp_group_read_state WHERE group_id = $1 AND whatsapp_group_can_view(group_id, user_id)",
                        group_id
                    )
                    .fetch_all(&self.pool)
                    .await
                    .map_err(unavailable)?,
                );
                viewers.sort();
                viewers.dedup();
                Ok(viewers)
            }
        }
    }

    #[tracing::instrument(
        name = "whatsapp.changed.push",
        skip_all,
        err,
        fields(scope, group_id, account_id, recipients)
    )]
    async fn push(&self, change: Change) -> LinkedResult<()> {
        let span = tracing::Span::current();
        let message = match change {
            Change::Groups { account_id } => {
                span.record("scope", "groups");
                span.record("account_id", tracing::field::display(account_id));
                serde_json::json!({ "scope": "groups" })
            }
            Change::Group { group_id } => {
                span.record("scope", "group");
                span.record("group_id", tracing::field::display(group_id));
                serde_json::json!({ "scope": "group", "group_id": group_id })
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

/// Push every `whatsapp_changed` signal, coalescing a burst into one push per
/// change. A push that fails is dropped: pages also re-fetch on open.
async fn push_changes(pusher: ChangePusher, cancellation: CancellationToken) {
    let mut listener = loop {
        let listening = async {
            let mut listener = sqlx::postgres::PgListener::connect_with(&pusher.pool).await?;
            listener.listen(signals::CHANGED).await?;
            Ok::<_, sqlx::Error>(listener)
        };
        match listening.await {
            Ok(listener) => break listener,
            Err(error) => {
                tracing::warn!(error = ?error, "WhatsApp change pushes will retry listening");
                tokio::select! {
                    _ = cancellation.cancelled() => return,
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {}
                }
            }
        }
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
            let span = tracing::info_span!("whatsapp.changed.receive");
            trace_context::adopt(&span, signal.traceparent.as_deref());
            let _ = pusher.push(signal.change).instrument(span).await;
        }
    }
}

fn unavailable(error: impl std::fmt::Display) -> rootcause::Report<LinkedError> {
    rootcause::report!("{error}").context(LinkedError::Unavailable)
}

/// Generic notifications for shared WhatsApp group messages. Revisions,
/// reactions, history and replays never create a second notification.
struct DssGroupPublisher {
    pool: PgPool,
    access: Arc<EntityAccessService>,
    notifications: Arc<NotificationIngressType>,
}
#[async_trait]
impl GroupPublisher for DssGroupPublisher {
    #[tracing::instrument(name="whatsapp.groups.notify",skip_all,err,fields(group_id=%effect.group_id,message_id=%effect.message_id))]
    async fn publish(&self, effect: &GroupEffect) -> LinkedResult<()> {
        if !effect.first_publication || effect.origin == Origin::History {
            return Ok(());
        }
        let group=sqlx::query!("SELECT g.name,m.deleted_at,m.content_revision FROM whatsapp_group g JOIN whatsapp_group_message m ON m.binding_id=g.id WHERE g.id=$1 AND m.id=$2",effect.group_id,effect.message_id)
            .fetch_optional(&self.pool).await.map_err(unavailable)?;
        let Some(group) = group else { return Ok(()) };
        if group.deleted_at.is_some() || group.content_revision > 0 {
            return Ok(());
        }
        let mut viewers = self
            .access
            .get_users_by_entity(&effect.group_id.to_string(), EntityType::WhatsAppGroup)
            .await
            .map_err(unavailable)?;
        // Link viewers become known when they read the group. Recheck their
        // current permission so a revoked link never keeps notifying them.
        let link_viewers = sqlx::query_scalar!(
            "SELECT user_id FROM whatsapp_group_read_state WHERE group_id=$1 AND whatsapp_group_can_view(group_id,user_id)",
            effect.group_id
        )
        .fetch_all(&self.pool)
        .await
        .map_err(unavailable)?;
        for viewer in link_viewers {
            viewers.push(MacroUserIdStr::try_from(viewer).map_err(unavailable)?);
        }
        let recipient_ids = viewers
            .into_iter()
            .filter(|u| effect.associated_user.as_deref() != Some(u.as_ref()))
            .map(|u| MacroUserIdStr::try_from(u.to_string()).map_err(unavailable))
            .collect::<LinkedResult<HashSet<_>>>()?;
        if recipient_ids.is_empty() {
            return Ok(());
        }
        let request = SendNotificationRequestBuilder {
            notification_entity: EntityType::WhatsAppGroup
                .with_entity_string(effect.group_id.to_string()),
            secondary_notification_entity: None,
            notification: model_notifications::WhatsappGroupMessageMetadata {
                group_name: group.name,
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

/// Creates private documents for imported and sent attachments, owned by the
/// group owner or uploader; document access inherits the group's current grants.
struct DssDocumentStore {
    pool: PgPool,
    documents: Arc<crate::api::context::DocumentService>,
    s3: aws_sdk_s3::Client,
    bucket: String,
}

#[async_trait]
impl DocumentStore for DssDocumentStore {
    #[tracing::instrument(
        name = "whatsapp.linked.store_document",
        skip_all,
        err,
        fields(document_id = %import.document_id, group_id = %import.group_id, size = import.bytes.len())
    )]
    async fn store(&self, import: &DocumentImport) -> LinkedResult<()> {
        let id = import.document_id.to_string();
        let owner = MacroUserIdStr::try_from(import.owner.clone()).map_err(unavailable)?;
        let file_type = FileType::all()
            .iter()
            .copied()
            .find(|kind| kind.mime_type() == import.mime)
            .ok_or_else(|| unavailable(format!("unsupported attachment type {}", import.mime)))?;
        let exists = match macro_db_client::document::get_basic_document(&self.pool, &id).await {
            Ok(_) => true,
            Err(sqlx::Error::RowNotFound) => false,
            Err(error) => return Err(unavailable(error)),
        };
        if !exists {
            let name = std::path::Path::new(&import.filename)
                .file_stem()
                .and_then(|stem| stem.to_str())
                .filter(|stem| !stem.trim().is_empty())
                .unwrap_or("Attachment")
                .to_owned();
            self.documents
                .create_document(
                    &CreationPrincipal::BotForUser {
                        bot: bot_id::MACRO_SYSTEM_BOT_ID,
                        user: owner.clone(),
                    },
                    NewDocument {
                        id: Some(import.document_id),
                        sha: hex::encode(import.sha256),
                        document_name: name,
                        file_type: Some(file_type),
                        project_id: None,
                        team_id: None,
                        share_with_team: false,
                        created_at: None,
                        sub_type: None,
                        skip_history: true,
                        initial_link_share: InitialLinkShare::Exact(LinkShareState::Off),
                    },
                    None,
                )
                .await
                .map_err(unavailable)?;
        }
        let document = macro_db_client::document::get_basic_document(&self.pool, &id)
            .await
            .map_err(unavailable)?;
        let (version, uploaded) =
            macro_db_client::document::get_latest_document_version_id(&self.pool, &id)
                .await
                .map_err(unavailable)?;
        // Ready bytes are never rewritten; an interrupted upload is retried.
        if !uploaded {
            use base64::Engine as _;
            self.s3
                .put_object()
                .bucket(&self.bucket)
                .key(s3_key::build_cloud_storage_bucket_document_key(
                    &document.owner,
                    &id,
                    version,
                ))
                .content_type(file_type.mime_type())
                .checksum_sha256(base64::engine::general_purpose::STANDARD.encode(import.sha256))
                .body(aws_sdk_s3::primitives::ByteStream::from(
                    import.bytes.clone(),
                ))
                .send()
                .await
                .map_err(unavailable)?;
        }
        Ok(())
    }
}

/// Redis-backed request counter shared by every DSS replica. A failed send
/// request still consumes its slot; this limits requests rather than deliveries.
struct SendRequestLimiter<R>(R);

#[async_trait]
impl<R: rate_limit::RateLimitService> SendRateLimiter for SendRequestLimiter<R> {
    #[tracing::instrument(name = "whatsapp.linked.send_rate_limit", skip_all, err)]
    async fn check(&self, user: &str) -> LinkedResult<()> {
        let key = rate_limit::RateLimitKey::builder(&"whatsapp-linked-send")
            .append(&user)
            .finish();
        let result = self
            .0
            .check_rate_limit(
                key,
                rate_limit::RateLimitConfig::new(1, Duration::from_secs(1)),
            )
            .await
            .map_err(|error| error.context(LinkedError::Unavailable))?;
        result
            .map(|_| ())
            .map_err(|_| LinkedError::RateLimited.into())
    }
}

#[cfg(test)]
mod test;
