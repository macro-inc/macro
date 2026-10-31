//! The real connector (encrypted Postgres store, whatsmeow client) paired
//! against the fake WhatsApp server by a fake phone scanning the QR code.

use std::sync::Arc;
use std::time::Duration;

use external_chat::domain::models::{AttachmentRef, MediaKind, MediaShape};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use whatsapp_fake_server::{FakeWhatsApp, test_signal};
use whatsapp_linked::domain::events::{
    ClaimedSend, InboundEvent, InboundKind, MediaImport, OutboundMedia, OutgoingContent,
    SessionScope,
};
use whatsapp_linked::domain::session::SessionService;
use whatsapp_linked::outbound::pg::PgWhatsAppRepository;
use whatsapp_store_pg::kms::FakeWhatsAppKms;

use super::WhatsmeowConnector;
use crate::domain::account::{AccountConfig, AccountSessions};
use crate::domain::ports::{
    AccountControl, AccountExit, AccountRunner, InboundSink, SessionConnector, SessionError,
    SessionEvent, WhatsAppSession,
};

/// Passes every session event on to the runner and copies it to the test.
struct Tee<Connector> {
    inner: Connector,
    copies: mpsc::UnboundedSender<SessionEvent>,
}

impl<Connector: SessionConnector> SessionConnector for Tee<Connector> {
    type Session = Connector::Session;

    async fn open(
        &self,
        scope: SessionScope,
        fresh_device: bool,
        inbound: Arc<dyn InboundSink>,
    ) -> Result<(Self::Session, mpsc::UnboundedReceiver<SessionEvent>), SessionError> {
        let (session, mut events) = self.inner.open(scope, fresh_device, inbound).await?;
        let (sender, receiver) = mpsc::unbounded_channel();
        let copies = self.copies.clone();
        tokio::spawn(async move {
            while let Some(event) = events.recv().await {
                let _ = copies.send(event.clone());
                if sender.send(event).is_err() {
                    return;
                }
            }
        });
        Ok((session, receiver))
    }
}

async fn insert_pairing_account(pool: &PgPool) -> Uuid {
    let user_id = "macro|whatsapp-owner";
    sqlx::query!(
        r#"
        WITH new_macro_user AS (
            INSERT INTO macro_user (id, username, email, stripe_customer_id)
            VALUES (gen_random_uuid(), $2, $2, 'stripe_owner')
            RETURNING id
        )
        INSERT INTO "User" ("id", "email", "macro_user_id")
        SELECT $1, $2, new_macro_user.id FROM new_macro_user
        "#,
        user_id,
        "owner@example.com",
    )
    .execute(pool)
    .await
    .unwrap();
    let account = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO whatsapp_linked_account (id, user_id, state) VALUES ($1, $2, 'pairing')",
        account,
        user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO whatsapp_pairing (id, account_id, user_id, generation, state, expires_at)
        VALUES ($1, $2, $3, 1, 'waiting', now() + interval '5 minutes')"#,
        Uuid::now_v7(),
        account,
        user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    account
}

async fn next_matching(
    copies: &mut mpsc::UnboundedReceiver<SessionEvent>,
    wanted: impl Fn(&SessionEvent) -> bool,
) -> SessionEvent {
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let event = copies.recv().await.expect("the session is running");
            if wanted(&event) {
                return event;
            }
        }
    })
    .await
    .expect("the fake server answers within the timeout")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_phone_scanning_the_qr_links_the_account_through_the_encrypted_store(pool: PgPool) {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let whatsapp = FakeWhatsApp::start().await.unwrap();
    let phone = whatsapp.add_user("15550001111", "Ada").await;
    let account = insert_pairing_account(&pool).await;
    let (copies, mut copied) = mpsc::unbounded_channel();
    let runner = Arc::new(AccountSessions::new(
        SessionService::new(Arc::new(PgWhatsAppRepository::new(pool.clone()))),
        Tee {
            inner: WhatsmeowConnector::new(
                pool.clone(),
                FakeWhatsAppKms::new("arn:aws:kms:us-east-1:123456789012:key/test"),
                test_signal(),
                whatsapp.dialer(),
                Some(whatsapp.media_base_url()),
                Duration::from_secs(10),
            ),
            copies,
        },
        AccountConfig {
            send_timeout: Duration::from_secs(10),
            send_batch: 16,
            tick_every: Duration::from_secs(600),
            groups_refresh_interval: crate::domain::account::GROUPS_REFRESH_INTERVAL,
            backfill_timeout: crate::domain::account::BACKFILL_TIMEOUT,
        },
    ));
    let (_signals, signal_receiver) = mpsc::channel(8);
    let release = CancellationToken::new();
    let control = AccountControl {
        signals: signal_receiver,
        cause: tracing::Span::none(),
        release: release.clone(),
        stop: CancellationToken::new(),
    };
    let running = tokio::spawn({
        let runner = Arc::clone(&runner);
        async move { runner.run(account, control).await }
    });

    let SessionEvent::Qr(code) =
        next_matching(&mut copied, |event| matches!(event, SessionEvent::Qr(_))).await
    else {
        unreachable!();
    };
    phone.scan_qr(&code).await.unwrap();
    let SessionEvent::PairSuccess { identity_jid } = next_matching(&mut copied, |event| {
        matches!(event, SessionEvent::PairSuccess { .. })
    })
    .await
    else {
        unreachable!();
    };
    assert_eq!(identity_jid, "15550001111@s.whatsapp.net");
    next_matching(&mut copied, |event| {
        matches!(event, SessionEvent::Connected)
    })
    .await;

    release.cancel();
    assert_eq!(running.await.unwrap(), AccountExit::Released);
    let linked = sqlx::query!(
        "SELECT state, identity_jid FROM whatsapp_linked_account WHERE id = $1",
        account
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(linked.state, "connected");
    assert_eq!(
        linked.identity_jid.as_deref(),
        Some("15550001111@s.whatsapp.net")
    );
    let stored_device = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM whatsapp_store_value WHERE account_id = $1"#,
        account
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        stored_device > 0,
        "the paired device's keys are in Postgres"
    );

    // Pairing again after WhatsApp logged the device out starts from a fresh
    // device: a stored identity would make the QR channel refuse to start.
    sqlx::query!(
        "UPDATE whatsapp_linked_account SET state = 'logged_out' WHERE id = $1",
        account
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO whatsapp_pairing (id, account_id, user_id, generation, state, expires_at)
        VALUES ($1, $2, 'macro|whatsapp-owner', 1, 'waiting', now() + interval '5 minutes')"#,
        Uuid::now_v7(),
        account,
    )
    .execute(&pool)
    .await
    .unwrap();
    let (_signals, signal_receiver) = mpsc::channel(8);
    let release = CancellationToken::new();
    let control = AccountControl {
        signals: signal_receiver,
        cause: tracing::Span::none(),
        release: release.clone(),
        stop: CancellationToken::new(),
    };
    let running = tokio::spawn({
        let runner = Arc::clone(&runner);
        async move { runner.run(account, control).await }
    });
    next_matching(&mut copied, |event| matches!(event, SessionEvent::Qr(_))).await;
    release.cancel();
    assert_eq!(running.await.unwrap(), AccountExit::Released);
}

/// Keeps every group event the client hands over, and acknowledges it.
struct RecordingSink(mpsc::UnboundedSender<InboundEvent>);

#[async_trait::async_trait]
impl InboundSink for RecordingSink {
    async fn accept(&self, event: &InboundEvent) -> bool {
        let _ = self.0.send(event.clone());
        true
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn attachments_travel_both_ways_with_a_sealed_locator(pool: PgPool) {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let whatsapp = FakeWhatsApp::start().await.unwrap();
    let owner = whatsapp.add_user("15550001111", "Ada").await;
    let peer = whatsapp.add_user("15550002222", "Bob").await;
    let account = insert_pairing_account(&pool).await;
    let scope = SessionService::new(Arc::new(PgWhatsAppRepository::new(pool.clone())))
        .begin_lease(account)
        .await
        .unwrap()
        .scope;
    let connector = WhatsmeowConnector::new(
        pool.clone(),
        FakeWhatsAppKms::new("arn:aws:kms:us-east-1:123456789012:key/test"),
        test_signal(),
        whatsapp.dialer(),
        Some(whatsapp.media_base_url()),
        Duration::from_secs(10),
    );
    let (inbound, mut received) = mpsc::unbounded_channel();
    let (session, mut events) = connector
        .open(scope, false, Arc::new(RecordingSink(inbound)))
        .await
        .unwrap();
    session.start_pairing().await.unwrap();
    session.connect().await.unwrap();
    let SessionEvent::Qr(code) =
        next_matching(&mut events, |event| matches!(event, SessionEvent::Qr(_))).await
    else {
        unreachable!();
    };
    owner.scan_qr(&code).await.unwrap();
    next_matching(&mut events, |event| {
        matches!(event, SessionEvent::Connected)
    })
    .await;
    let group = whatsapp.create_group("Photos", &[&owner, &peer]);

    let photo = b"an encrypted photo from the group".repeat(40);
    let incoming = peer.send_image(&group, &photo, "look").await.unwrap();
    let event = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let event = received.recv().await.unwrap();
            if let InboundKind::Message(message) = &event.kind
                && message.source_id == incoming
            {
                return message.clone();
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(event.text, "look");
    let media = event.media.first().expect("the image is an attachment");
    assert_eq!(media.mime, "image/jpeg");
    assert!(
        !media
            .locator
            .windows(b"direct".len())
            .any(|window| window == b"direct"),
        "the locator is sealed, not readable JSON"
    );
    let import = MediaImport {
        attachment: AttachmentRef {
            chat_id: Uuid::now_v7(),
            person_id: Uuid::now_v7(),
            source_id: incoming.clone(),
            ordinal: 0,
        },
        mime: media.mime.clone(),
        filename: media.filename.clone(),
        size: media.size,
        sha256: media.sha256,
        locator: media.locator.clone(),
    };
    assert_eq!(session.download_media(&import).await.unwrap(), photo);

    let reply = b"a photo sent from Macro".repeat(30);
    let uploaded = session
        .upload_media(&OutboundMedia {
            kind: MediaKind::Image,
            mime: "image/jpeg".to_owned(),
            filename: "reply.jpg".to_owned(),
            bytes: reply.clone(),
            sha256: Sha256::digest(&reply).into(),
        })
        .await
        .unwrap();
    let send = ClaimedSend {
        id: Uuid::now_v7(),
        group_jid: group.to_string(),
        chat_sequence: 1,
        content: OutgoingContent::Media {
            kind: MediaKind::Image,
            mime: "image/jpeg".to_owned(),
            filename: "reply.jpg".to_owned(),
            caption: Some("from macro".to_owned()),
            quote: None,
            shape: MediaShape {
                width: Some(800),
                height: Some(600),
                duration_seconds: None,
            },
        },
        disappearing_seconds: Some(86_400),
        traceparent: None,
    };
    let message_id = session.new_message_id().await;
    session
        .send(&send, &message_id, Some(&uploaded))
        .await
        .unwrap();
    let delivered = peer
        .wait_for_message(Duration::from_secs(20), |message| message.id == message_id)
        .await
        .expect("the peer's phone receives the image");
    assert_eq!(peer.download_image(&delivered).await.unwrap(), reply);
    let image = delivered
        .message
        .image_message
        .as_deref()
        .expect("an image message");
    assert_eq!(
        (image.width, image.height),
        (Some(800), Some(600)),
        "the phone can reserve the space"
    );
    assert_eq!(
        image
            .context_info
            .as_ref()
            .and_then(|context| context.expiration),
        Some(86_400),
        "the image disappears like the group's own messages"
    );
    session.disconnect().await;
}

#[test]
fn group_metadata_keeps_the_timer_and_tells_a_community_from_its_groups() {
    use whatsmeow::types::{
        GroupEphemeral, GroupInfo as ExternalChat, GroupIsDefaultSub, GroupLinkedParent, GroupName,
        GroupParent,
    };
    let community: whatsmeow::types::Jid = "120363000000000010@g.us".parse().unwrap();
    let group = |jid: &str| ExternalChat {
        jid: jid.parse().unwrap(),
        name: GroupName {
            name: "Neighbours".to_owned(),
            ..GroupName::default()
        },
        ..ExternalChat::default()
    };
    let observed_at = chrono::Utc::now();

    let parent = super::group_info(
        ExternalChat {
            parent: GroupParent {
                is_parent: true,
                ..GroupParent::default()
            },
            ..group("120363000000000010@g.us")
        },
        observed_at,
    );
    assert!(parent.community_parent);
    assert_eq!(parent.community_jid, None);

    let announcements = super::group_info(
        ExternalChat {
            linked_parent: GroupLinkedParent {
                linked_parent_jid: community.clone(),
            },
            is_default_sub: GroupIsDefaultSub {
                is_default_sub_group: true,
            },
            ..group("120363000000000011@g.us")
        },
        observed_at,
    );
    assert!(!announcements.community_parent);
    assert_eq!(
        announcements.community_jid.as_deref(),
        Some("120363000000000010@g.us")
    );
    assert!(announcements.community_announcements);

    let vanishing = super::group_info(
        ExternalChat {
            ephemeral: GroupEphemeral {
                is_ephemeral: true,
                disappearing_timer: 604_800,
            },
            linked_parent: GroupLinkedParent {
                linked_parent_jid: community,
            },
            ..group("120363000000000012@g.us")
        },
        observed_at,
    );
    assert_eq!(vanishing.disappearing_seconds, Some(604_800));
    assert!(!vanishing.community_announcements);
    assert_eq!(
        super::group_info(group("120363000000000013@g.us"), observed_at).disappearing_seconds,
        None
    );
    // A group that had disappearing messages and turned them off: WhatsApp
    // still lists `<ephemeral expiration="0"/>`.
    let turned_off = super::group_info(
        ExternalChat {
            ephemeral: GroupEphemeral {
                is_ephemeral: true,
                disappearing_timer: 0,
            },
            ..group("120363000000000014@g.us")
        },
        observed_at,
    );
    assert_eq!(turned_off.disappearing_seconds, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_fresh_device_replaces_one_whose_data_key_kms_lost(pool: PgPool) {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let whatsapp = FakeWhatsApp::start().await.unwrap();
    let account = insert_pairing_account(&pool).await;
    let scope = SessionService::new(Arc::new(PgWhatsAppRepository::new(pool.clone())))
        .begin_lease(account)
        .await
        .unwrap()
        .scope;
    let connector = |kms| {
        WhatsmeowConnector::new(
            pool.clone(),
            kms,
            test_signal(),
            whatsapp.dialer(),
            Some(whatsapp.media_base_url()),
            Duration::from_secs(10),
        )
    };
    let (sink, _received) = mpsc::unbounded_channel();
    let sink: Arc<dyn InboundSink> = Arc::new(RecordingSink(sink));
    let (session, _events) = connector(FakeWhatsAppKms::new("arn:aws:kms:test:key/lost"))
        .open(scope, false, Arc::clone(&sink))
        .await
        .unwrap();
    session.disconnect().await;

    // KMS lost the key that wrapped the device's data key.
    let replaced = connector(FakeWhatsAppKms::new("arn:aws:kms:test:key/lost"));
    let error = replaced
        .open(scope, false, Arc::clone(&sink))
        .await
        .err()
        .unwrap();
    assert!(matches!(error, SessionError::DeviceUnreadable), "{error:?}");
    let (session, _events) = replaced
        .open(scope, true, Arc::clone(&sink))
        .await
        .expect("a fresh device does not need the lost key");
    assert_eq!(session.identity_jid().await, None);
    session.disconnect().await;
}

/// IQ errors keep the whole response node, whose attributes carry JIDs; the
/// session error's message (what `%error` logs) must not repeat them.
#[test]
fn session_errors_never_show_the_jids_of_an_iq_response() {
    use whatsmeow::binary::{AttributeValue, Node, NodeContent};
    use whatsmeow::errors::{ClientError, IqError};

    let phone = "15551234567";
    let jid: whatsmeow::types::Jid = format!("{phone}@s.whatsapp.net").parse().unwrap();
    let response = Node {
        tag: "iq".to_owned(),
        attrs: [
            ("from".to_owned(), AttributeValue::from(&jid)),
            ("participant".to_owned(), AttributeValue::from(&jid)),
        ]
        .into(),
        content: Some(NodeContent::Nodes(vec![Node {
            tag: "item".to_owned(),
            attrs: [("jid".to_owned(), AttributeValue::from(&jid))].into(),
            content: None,
        }])),
    };
    let error = super::internal(ClientError::from(IqError {
        raw_node: Some(response.clone()),
        ..IqError::default()
    }));
    let unknown = super::internal(ClientError::from(IqError {
        error_node: Some(response),
        ..IqError::default()
    }));

    for message in [error.to_string(), unknown.to_string()] {
        assert!(
            message.starts_with("WhatsApp session failed: "),
            "{message}"
        );
        assert!(!message.contains(phone), "{message}");
    }
}

#[test]
fn a_recipient_not_on_whatsapp_or_a_rate_limited_lookup_is_rejected_not_unknown() {
    use whatsmeow::errors::{ClientError, IqError};

    assert_eq!(
        super::rejected(&ClientError::RecipientNotOnWhatsApp),
        Some("recipient_not_on_provider")
    );
    let rate_limited = ClientError::from(IqError::from_status(IqError::RATE_OVER_LIMIT))
        .wrap("failed to send usync query")
        .wrap("failed to get user info to fill LID cache");
    assert_eq!(super::rejected(&rate_limited), Some("rate_limited"));
    assert_eq!(
        super::rejected(&ClientError::Other("anything else".to_owned())),
        None
    );
}
