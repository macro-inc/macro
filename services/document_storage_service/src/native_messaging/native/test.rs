use super::*;
mod http;
mod identity;
mod reconciliation;
mod revisions;
use entity_access::{
    domain::{models::MemberParticipantRole, service::EntityAccessServiceImpl},
    outbound::PgAccessRepository,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use meta_messaging::domain::models::ProviderId;

struct TextOnlyFiles;
struct NoEffects;
#[async_trait]
impl NativeMessageEffects for NoEffects {
    async fn publish(
        &self,
        _: &meta_messaging::outbound::repository::native::NativeEffect,
        _: &MessageEvent,
        _: &channels::domain::models::ChannelInfo,
        _: &HashSet<String>,
    ) -> PortResult<()> {
        Ok(())
    }
}
#[async_trait]
impl super::super::files::MessageFiles for TextOnlyFiles {
    async fn upload(&self, _: &str, _: Uuid, _: MediaBytes) -> PortResult<UploadedAttachment> {
        panic!("text workflow must not stage files")
    }
    async fn receive(
        &self,
        _: &Connection,
        _: &IncomingMessage,
        _: Vec<Option<MediaBytes>>,
    ) -> PortResult<()> {
        panic!("text workflow must not request file storage")
    }
    async fn read(&self, _: &str, _: Uuid, _: Uuid) -> PortResult<MediaBytes> {
        panic!("text workflow must not read files")
    }
    async fn prepare(&self, _: &str, _: Uuid, _: Uuid, _: MediaBytes) -> PortResult<OutboundMedia> {
        panic!("text workflow must not prepare files")
    }
    async fn attach_sent(&self, work: &SendWork, _: &Connection, _: &ProviderId) -> PortResult<()> {
        assert!(matches!(work.request.message, ReplyContent::Text { .. }));
        Ok(())
    }
}

async fn user(pool: &PgPool, name: &str, team: Option<Uuid>) -> String {
    let email = format!("{name}@native-messaging.test");
    let id = format!("macro|{email}");
    let uid = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id,username,email,stripe_customer_id) VALUES ($1,$2,$2,$3)",
        uid,
        email,
        format!("fixture_{uid}")
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id,email,macro_user_id) VALUES ($1,$2,$3)"#,
        id,
        email,
        uid
    )
    .execute(pool)
    .await
    .unwrap();
    if let Some(team) = team {
        sqlx::query!(
            "INSERT INTO team_user (team_id,user_id,team_role) VALUES ($1,$2,'member')",
            team,
            id
        )
        .execute(pool)
        .await
        .unwrap();
    }
    id
}
async fn setup(pool: &PgPool, provider: Provider) -> (NativeChannels, Connection, String) {
    let owner = user(pool, "owner", None).await;
    let team = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id,name,owner_id) VALUES ($1,'Messaging team',$2)",
        team,
        owner
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (team_id,user_id,team_role) VALUES ($1,$2,'owner')",
        team,
        owner
    )
    .execute(pool)
    .await
    .unwrap();
    let uninvited = user(pool, "uninvited", Some(team)).await;
    let native = fixture_native(pool).await;
    let c = Connection {
        id: Uuid::now_v7(),
        team_id: team,
        user_id: owner,
        provider,
        account_id: "business-account".to_owned().try_into().unwrap(),
        business_account_id: None,
        display_name: "Business account".into(),
        status: ConnectionStatus::Connected,
        connected_at: Some(Utc::now() - chrono::Duration::minutes(1)),
        credential_expires_at: None,
        human_agent_approved: false,
        whatsapp_mode: None,
        registration_status: None,
        registration_attempted_at: None,
        developer_account: true,

        health_error: None,
    };
    let repo = PgMessagingRepository::new(pool.clone());
    repo.connect(&c, b"test-only-ciphertext", None)
        .await
        .unwrap();
    repo.health(
        &repo.connection(c.id).await.unwrap().unwrap(),
        ConnectionStatus::Connected,
        None,
    )
    .await
    .unwrap();
    let c = repo.connection(c.id).await.unwrap().unwrap();
    // The database runs in a VM and can be slightly ahead of the host clock.
    // Live fixtures must really occur after connection, not accidentally model history.
    if let Ok(delay) = (c.connected_at.unwrap() - Utc::now()).to_std() {
        assert!(
            delay < std::time::Duration::from_secs(5),
            "test database clock is out of sync"
        );
        tokio::time::sleep(delay).await;
    }
    (native, c, uninvited)
}
fn incoming(c: &Connection, id: &str) -> IncomingMessage {
    IncomingMessage {
        group_id: None,
        provider: c.provider,
        account_id: c.account_id.clone(),
        customer_id: "customer-scoped-id".to_owned().try_into().unwrap(),
        customer_phone: None,
        message_id: id.to_owned().try_into().unwrap(),
        author_handle: None,
        author_name: Some("Customer without email".into()),
        content: "Hello from the original app".into(),
        timestamp: Utc::now().trunc_subsecs(6),
        direction: Direction::Inbound,
        provenance: Provenance::Customer,
        message_type: "text".into(),
        reply_to: None,
        media: vec![],
    }
}
async fn workflow(pool: PgPool, provider: Provider) {
    let (native, c, uninvited) = setup(&pool, provider).await;
    let message = incoming(&c, "provider-message-1");
    let (first, duplicate) = tokio::join!(
        native.ingest(&c, &message, vec![]),
        native.ingest(&c, &message, vec![])
    );
    first.unwrap();
    duplicate.unwrap();
    let row=sqlx::query!("SELECT channel_id FROM meta_messaging_conversation WHERE connection_id=$1 AND customer_id=$2",c.id,message.customer_id.as_str()).fetch_one(&pool).await.unwrap();
    let channel = row.channel_id;
    let repo = PgMessagingRepository::new(pool.clone());
    let mapped=sqlx::query!("SELECT message_id FROM meta_messaging_message WHERE connection_id=$1 AND provider_message_id=$2",c.id,message.message_id.as_str()).fetch_all(&pool).await.unwrap();
    assert_eq!(mapped.len(), 1);
    let stored = PgMessageRepository::new(pool.clone())
        .get(&MessageParent::Channel(channel), mapped[0].message_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        stored.imported_author.unwrap().name,
        "Customer without email"
    );
    assert!(stored.sender_id.is_external());
    assert_eq!(stored.content, "Hello from the original app");
    native
        .require_send(c.team_id, channel, &c.user_id)
        .await
        .unwrap();
    assert!(
        native
            .require_send(c.team_id, channel, &uninvited)
            .await
            .is_err()
    );
    let excluded = MacroUserIdStr::try_from(uninvited).unwrap();
    assert!(
        native
            .access
            .generate_entity_access_receipt::<MemberParticipantRole>(
                &excluded.0,
                None,
                &channel.to_string(),
                EntityType::Channel
            )
            .await
            .is_err()
    );
    let conversation = repo.conversation(channel).await.unwrap().unwrap();
    assert_eq!(
        conversation.last_customer_message_at,
        Some(message.timestamp)
    );
    let request = SendReply {
        idempotency_key: Uuid::now_v7(),
        message: ReplyContent::Text {
            text: "A human-approved reply".into(),
        },
        reply_to: None,
        human_support: false,
    };
    repo.enqueue_send(c.id, channel, &c.user_id, &request, &[7; 32])
        .await
        .unwrap();
    let work = repo.claim_send().await.unwrap().unwrap();
    let provider_id: ProviderId = "provider-reply-1".to_owned().try_into().unwrap();
    repo.settle_send(
        &work.lease,
        DeliveryState::Accepted,
        Some(&provider_id),
        None,
        None,
    )
    .await
    .unwrap();
    // Provider read notification precedes local message recovery after restart.
    repo.record_status(c.id, &provider_id, DeliveryState::Read, None)
        .await
        .unwrap();
    let pending = repo.accepted_sends().await.unwrap();
    assert_eq!(pending.len(), 1);
    let scope = (&c).into();
    let (a, b) = tokio::join!(
        native.sent(&pending[0].0, &conversation, &scope, &provider_id),
        native.sent(&pending[0].0, &conversation, &scope, &provider_id)
    );
    a.unwrap();
    b.unwrap();
    assert!(repo.accepted_sends().await.unwrap().is_empty());
    assert!(repo.claim_send().await.unwrap().is_none());
    // Finished recovery leaves the per-second scan; pending media keeps it there.
    let retired = || async {
        sqlx::query_scalar!(
            r#"SELECT native_retry_at = 'infinity' AS "retired!" FROM meta_messaging_send WHERE id = $1"#,
            work.lease.id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    };
    assert!(retired().await);
    sqlx::query!(
        "UPDATE meta_messaging_message SET media_state = 'pending' WHERE connection_id = $1 AND provider_message_id = $2",
        c.id,
        provider_id.as_str()
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE meta_messaging_send SET native_retry_at = now() WHERE id = $1",
        work.lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(repo.accepted_sends().await.unwrap().len(), 1);
    assert!(!retired().await);
    sqlx::query!(
        "UPDATE meta_messaging_message SET media_state = 'stored' WHERE connection_id = $1 AND provider_message_id = $2",
        c.id,
        provider_id.as_str()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(repo.accepted_sends().await.unwrap().is_empty());
    assert!(retired().await);
    assert_eq!(
        repo.conversation(channel)
            .await
            .unwrap()
            .unwrap()
            .customer_display_name
            .as_deref(),
        Some("Customer without email")
    );
    let progress = repo.sends(channel).await.unwrap();
    assert_eq!(progress.len(), 1);
    assert_eq!(progress[0].state, DeliveryState::Read);
    let reply = PgMessageRepository::new(pool.clone())
        .get(
            &MessageParent::Channel(channel),
            progress[0].message_id.unwrap(),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(reply.content, "A human-approved reply");
    assert_eq!(
        reply.created_at, work.created_at,
        "recovery preserves the original send time"
    );
    // The visible-message lookup must retain history beyond the recent feed.
    for _ in 0..101 {
        let mut newer = request.clone();
        newer.idempotency_key = Uuid::now_v7();
        repo.enqueue_send(c.id, channel, &c.user_id, &newer, &[8; 32])
            .await
            .unwrap();
    }
    assert!(
        repo.sends(channel)
            .await
            .unwrap()
            .iter()
            .all(|send| send.id != progress[0].id)
    );
    let history = repo.sends_for_messages(channel, &[reply.id]).await.unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].state, DeliveryState::Read);
    assert!(
        repo.sends_for_messages(Uuid::now_v7(), &[reply.id])
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        repo.sends_for_messages(channel, &[stored.id])
            .await
            .unwrap()
            .is_empty()
    );
    // A phone-app/API echo shares the provider ID and must not create a third message.
    let mut echo = incoming(&c, "provider-reply-1");
    echo.direction = Direction::Outbound;
    echo.provenance = Provenance::PhoneEcho;
    native.ingest(&c, &echo, vec![]).await.unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM meta_messaging_message WHERE connection_id=$1",
            c.id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(2)
    );
    assert_eq!(
        repo.conversation(channel)
            .await
            .unwrap()
            .unwrap()
            .last_customer_message_at,
        Some(message.timestamp)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn whatsapp_text_native_channel_permissions_and_accepted_reply_recovery(pool: PgPool) {
    workflow(pool, Provider::Whatsapp).await;
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn instagram_text_native_channel_permissions_and_accepted_reply_recovery(pool: PgPool) {
    workflow(pool, Provider::Instagram).await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn native_effects_keep_history_quiet_when_live_delivery_overlaps(pool: PgPool) {
    let (native, c, _) = setup(&pool, Provider::Instagram).await;
    let mut message = incoming(&c, "history-and-live-overlap");
    message.provenance = Provenance::OnboardingHistory;
    message.timestamp -= chrono::Duration::days(2);
    native.ingest(&c, &message, vec![]).await.unwrap();
    let repo = PgMessagingRepository::new(pool.clone());
    let initial = repo.pending_native_effects().await.unwrap();
    assert_eq!(initial.len(), 1);
    assert_eq!(initial[0].provenance, Provenance::OnboardingHistory);
    assert_eq!(initial[0].direction, Direction::Inbound);

    message.provenance = Provenance::Customer;
    native.ingest(&c, &message, vec![]).await.unwrap();
    assert_eq!(repo.pending_native_effects().await.unwrap(), initial);
    repo.native_effects_complete(initial[0].message_id, initial[0].revision)
        .await
        .unwrap();
    native.ingest(&c, &message, vec![]).await.unwrap();
    assert!(repo.pending_native_effects().await.unwrap().is_empty());
}

struct FailEffects {
    blocked: HashSet<Uuid>,
    fail: std::sync::atomic::AtomicBool,
    published: std::sync::Mutex<Vec<Uuid>>,
}

#[async_trait]
impl NativeMessageEffects for FailEffects {
    async fn publish(
        &self,
        effect: &meta_messaging::outbound::repository::native::NativeEffect,
        _: &MessageEvent,
        _: &channels::domain::models::ChannelInfo,
        _: &HashSet<String>,
    ) -> PortResult<()> {
        if self.blocked.contains(&effect.message_id)
            && self.fail.load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err(MessagingError::Unavailable.into());
        }
        self.published.lock().unwrap().push(effect.message_id);
        Ok(())
    }
}

async fn effect_transports(native: &mut NativeChannels) -> tokio::task::JoinHandle<()> {
    use axum::{
        Json, Router,
        routing::{get, post},
    };
    // Exercise the real gateway/search adapters against local protocol fixtures.
    // No provider account, queue, or live customer is involved.
    let router = Router::new()
        .route(
            "/track/{kind}/{id}",
            get(|| async { Json(serde_json::json!([])) }),
        )
        .route(
            "/message/batch_send",
            post(|| async { Json(serde_json::json!({"receipts": []})) }),
        )
        .fallback(|| async { Json(serde_json::json!({"MessageId": "fixture-search-message"})) });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    native.realtime = ConnectionGatewayMessages(Arc::new(
        connection_gateway_client::client::ConnectionGatewayClient::new(
            "test-only".into(),
            origin.clone(),
        ),
    ));
    native.search = sqs_client::SQS::new(aws_sdk_sqs::Client::new(
        &macro_aws_config::local_aws_config(&origin).await,
    ))
    .search_event_queue(&format!("{origin}/fixture-search"));

    server
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_native_effect_does_not_block_another_customer_and_retries(pool: PgPool) {
    let (mut native, c, _) = setup(&pool, Provider::Whatsapp).await;
    native
        .ingest(&c, &incoming(&c, "first-customer"), vec![])
        .await
        .unwrap();
    let mut second = incoming(&c, "second-customer");
    second.customer_id = "another-customer".to_owned().try_into().unwrap();
    native.ingest(&c, &second, vec![]).await.unwrap();
    let repo = PgMessagingRepository::new(pool.clone());
    let initial = repo.pending_native_effects().await.unwrap();
    assert_eq!(initial.len(), 2);
    assert_ne!(initial[0].channel_id, initial[1].channel_id);
    let effects = Arc::new(FailEffects {
        blocked: HashSet::from([initial[0].message_id]),
        fail: std::sync::atomic::AtomicBool::new(true),
        published: std::sync::Mutex::new(vec![]),
    });
    native.effects = effects.clone();
    let server = effect_transports(&mut native).await;

    assert!(native.reconcile_effects().await.is_err());
    assert_eq!(
        *effects.published.lock().unwrap(),
        vec![initial[1].message_id]
    );
    assert!(repo.pending_native_effects().await.unwrap().is_empty());
    sqlx::query!(
        "UPDATE meta_messaging_message SET native_retry_at=now() WHERE message_id=$1",
        initial[0].message_id
    )
    .execute(&pool)
    .await
    .unwrap();
    let remaining = repo.pending_native_effects().await.unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].message_id, initial[0].message_id);
    effects
        .fail
        .store(false, std::sync::atomic::Ordering::SeqCst);
    native.reconcile_effects().await.unwrap();
    assert!(repo.pending_native_effects().await.unwrap().is_empty());
    assert_eq!(
        *effects.published.lock().unwrap(),
        vec![initial[1].message_id, initial[0].message_id]
    );
    server.abort();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn quotes_media_leases_and_dirty_revisions_are_account_scoped(pool: PgPool) {
    let (native, c, _) = setup(&pool, Provider::Whatsapp).await;
    let source = incoming(&c, "media-source");
    native.ingest(&c, &source, vec![]).await.unwrap();
    let repo = PgMessagingRepository::new(pool.clone());
    let (channel, message) = repo
        .message_target(c.id, source.message_id.as_str())
        .await
        .unwrap();
    let conversation = repo.conversation(channel).await.unwrap().unwrap();
    assert!(
        repo.has_message(&conversation, &source.message_id)
            .await
            .unwrap()
    );
    let mut other = conversation.clone();
    other.customer_id = "different-customer".to_owned().try_into().unwrap();
    assert!(!repo.has_message(&other, &source.message_id).await.unwrap());
    other = conversation.clone();
    other.connection_id = Uuid::now_v7();
    assert!(!repo.has_message(&other, &source.message_id).await.unwrap());
    let sha = "ab".repeat(32);
    let first = repo
        .reserve_attachment(c.id, source.message_id.as_str(), 0, &sha)
        .await
        .unwrap();
    assert!(
        repo.reserve_attachment(c.id, source.message_id.as_str(), 0, &sha)
            .await
            .is_err()
    );
    sqlx::query!("UPDATE meta_messaging_attachment SET lease_until=now()-interval '1 second' WHERE document_id=$1",first.document_id).execute(&pool).await.unwrap();
    let retry = repo
        .reserve_attachment(c.id, source.message_id.as_str(), 0, &sha)
        .await
        .unwrap();
    assert_eq!(retry.document_id, first.document_id);
    let mut tx = pool.begin().await.unwrap();
    assert!(
        PgMessagingRepository::finish_attachment_in(
            &mut tx,
            c.id,
            source.message_id.as_str(),
            &first
        )
        .await
        .is_err()
    );
    tx.rollback().await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    PgMessagingRepository::finish_attachment_in(&mut tx, c.id, source.message_id.as_str(), &retry)
        .await
        .unwrap();
    PgMessagingRepository::media_state_in(&mut tx, c.id, source.message_id.as_str(), true)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let stored = repo
        .reserve_attachment(c.id, source.message_id.as_str(), 0, &sha)
        .await
        .unwrap();
    assert!(stored.lease.is_none());
    assert_eq!(stored.document_id, first.document_id);
    assert!(
        repo.reserve_attachment(c.id, source.message_id.as_str(), 0, &"cd".repeat(32))
            .await
            .is_err()
    );
    assert!(repo.native_effects_complete(message, 1).await.is_err());
    let effects = repo.pending_native_effects().await.unwrap();
    assert_eq!(effects.len(), 1);
    assert_eq!(effects[0].channel_id, channel);
    assert_eq!(effects[0].message_id, message);
    assert_eq!(effects[0].revision, 2);
    // Media can complete before the first event. Its revision must still be
    // published as a new message, otherwise open clients discard it as an edit.
    assert!(effects[0].first_publication);
    assert_eq!(effects[0].provenance, Provenance::Customer);
    assert_eq!(effects[0].direction, Direction::Inbound);
    repo.native_effects_complete(message, 2).await.unwrap();
    assert!(repo.pending_native_effects().await.unwrap().is_empty());
    let mut tx = pool.begin().await.unwrap();
    PgMessagingRepository::media_state_in(&mut tx, c.id, source.message_id.as_str(), false)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert!(
        repo.pending_native_effects().await.unwrap().is_empty(),
        "a failed duplicate cannot dirty already stored media"
    );
}

async fn fixture_native(pool: &PgPool) -> NativeChannels {
    let access = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        pool.clone(),
    )));
    NativeChannels::new(
        pool.clone(),
        access,
        ConnectionGatewayMessages(Arc::new(
            connection_gateway_client::client::ConnectionGatewayClient::new(
                "test-only".into(),
                "http://127.0.0.1:1".into(),
            ),
        )),
        sqs_client::SQS::new(aws_sdk_sqs::Client::new(
            &macro_aws_config::local_aws_config("http://127.0.0.1:1").await,
        )),
        Arc::new(TextOnlyFiles),
        Arc::new(NoEffects),
        Arc::new(channels::domain::service::NoopChannelEventDispatcher),
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn native_attachment_references_deduplicate_and_reject_wrong_source(pool: PgPool) {
    let (native, c, _) = setup(&pool, Provider::Whatsapp).await;
    let source = incoming(&c, "attachment-reference");
    native.ingest(&c, &source, vec![]).await.unwrap();
    let repo = PgMessagingRepository::new(pool.clone());
    let (channel, message) = repo
        .message_target(c.id, source.message_id.as_str())
        .await
        .unwrap();
    let document = Uuid::now_v7();
    let mut tx = pool.begin().await.unwrap();
    assert!(
        PgMessageRepository::attach_external_file_in(
            &mut tx,
            channel,
            message,
            Uuid::now_v7(),
            source.message_id.as_str(),
            document
        )
        .await
        .is_err()
    );
    for _ in 0..2 {
        PgMessageRepository::attach_external_file_in(
            &mut tx,
            channel,
            message,
            c.id,
            source.message_id.as_str(),
            document,
        )
        .await
        .unwrap();
    }
    tx.commit().await.unwrap();
    let message = PgMessageRepository::new(pool)
        .get(&MessageParent::Channel(channel), message)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(message.attachments.len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn captionless_media_shows_progress_or_failure_until_the_file_is_stored(pool: PgPool) {
    let (native, c, _) = setup(&pool, Provider::Whatsapp).await;
    let mut message = incoming(&c, "captionless-image");
    message.content.clear();
    message.media.push(IncomingMedia {
        kind: MediaKind::Image,
        id: Some("image-id".to_owned().try_into().unwrap()),
        url: None,
        mime_type: None,
        filename: None,
        sha256: None,
    });
    native.ingest(&c, &message, vec![]).await.unwrap();
    let (channel, id) = PgMessagingRepository::new(pool.clone())
        .message_target(c.id, message.message_id.as_str())
        .await
        .unwrap();
    let messages = PgMessageRepository::new(pool.clone());
    let stored = messages
        .get(&MessageParent::Channel(channel), id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.content, "Loading attachment…");
    native.media_unavailable(&c, &message).await.unwrap();
    let stored = messages
        .get(&MessageParent::Channel(channel), id)
        .await
        .unwrap()
        .unwrap();
    assert!(stored.content.contains("Attachment unavailable"));
    assert!(!stored.content.contains("Loading attachment"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn captionless_accepted_reply_can_materialize_before_file_recovery(pool: PgPool) {
    let (native, c, _) = setup(&pool, Provider::Whatsapp).await;
    let mut source = incoming(&c, "captionless-accepted");
    source.content.clear();
    source.media.clear();
    source.message_type = "macro_media_reply".into();
    source.provenance = Provenance::MacroReply;
    source.direction = Direction::Outbound;
    native.persist(&c, &source, None, None).await.unwrap();
    let repo = PgMessagingRepository::new(pool.clone());
    let (channel, id) = repo
        .message_target(c.id, source.message_id.as_str())
        .await
        .unwrap();
    let messages = PgMessageRepository::new(pool.clone());
    assert_eq!(
        messages
            .get(&MessageParent::Channel(channel), id)
            .await
            .unwrap()
            .unwrap()
            .content,
        "Loading attachment…"
    );
    // The file/card commit can replace the transient text with an empty caption.
    let mut tx = pool.begin().await.unwrap();
    PgMessageRepository::attach_external_file_in(
        &mut tx,
        channel,
        id,
        c.id,
        source.message_id.as_str(),
        Uuid::now_v7(),
    )
    .await
    .unwrap();
    PgMessageRepository::external_media_notice_in(
        &mut tx,
        channel,
        id,
        c.id,
        source.message_id.as_str(),
        "",
    )
    .await
    .unwrap();
    PgMessagingRepository::media_state_in(&mut tx, c.id, source.message_id.as_str(), true)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    // Replaying native persistence after a crash must not restore the transient label.
    native.persist(&c, &source, None, None).await.unwrap();
    let stored = messages
        .get(&MessageParent::Channel(channel), id)
        .await
        .unwrap()
        .unwrap();
    assert!(stored.content.is_empty());
    assert_eq!(stored.attachments.len(), 1);
    assert!(repo.media_stored(c.id, &source.message_id).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn native_effect_backoff_yields_past_a_full_failed_page_and_fences_revisions(pool: PgPool) {
    let (mut native, c, _) = setup(&pool, Provider::Whatsapp).await;
    for index in 0..101 {
        native
            .ingest(&c, &incoming(&c, &format!("effect-{index}")), vec![])
            .await
            .unwrap();
    }
    let repo = PgMessagingRepository::new(pool.clone());
    let first = repo.pending_native_effects().await.unwrap();
    assert_eq!(first.len(), 100);
    let effects = Arc::new(FailEffects {
        blocked: first.iter().map(|effect| effect.message_id).collect(),
        fail: std::sync::atomic::AtomicBool::new(true),
        published: std::sync::Mutex::new(vec![]),
    });
    native.effects = effects.clone();
    let server = effect_transports(&mut native).await;
    assert!(native.reconcile_effects().await.is_err());
    let restarted = PgMessagingRepository::new(pool.clone());
    let next = restarted.pending_native_effects().await.unwrap();
    assert_eq!(next.len(), 1);
    assert!(!effects.blocked.contains(&next[0].message_id));
    native.reconcile_effects().await.unwrap();
    assert_eq!(*effects.published.lock().unwrap(), vec![next[0].message_id]);
    assert!(restarted.pending_native_effects().await.unwrap().is_empty());
    // A fresh media revision clears the delay; a late failure of its old revision cannot defer it.
    let mut tx = pool.begin().await.unwrap();
    PgMessagingRepository::media_state_in(&mut tx, c.id, "effect-0", true)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let current = restarted.pending_native_effects().await.unwrap();
    assert_eq!(current.len(), 1);
    assert_eq!(current[0].revision, 2);
    restarted
        .defer_native_effect(current[0].message_id, 1)
        .await
        .unwrap();
    assert_eq!(restarted.pending_native_effects().await.unwrap(), current);
    effects
        .fail
        .store(false, std::sync::atomic::Ordering::SeqCst);
    native.reconcile_effects().await.unwrap();
    sqlx::query!(
        "UPDATE meta_messaging_message SET native_retry_at=now() WHERE connection_id=$1",
        c.id
    )
    .execute(&pool)
    .await
    .unwrap();
    native.reconcile_effects().await.unwrap();
    assert!(restarted.pending_native_effects().await.unwrap().is_empty());
    assert_eq!(effects.published.lock().unwrap().len(), 101);
    server.abort();
}
