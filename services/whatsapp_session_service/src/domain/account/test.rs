//! The account runner over the real linked-devices repository, with an
//! in-memory WhatsApp session the test drives.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use whatsapp_linked::domain::events::{
    ClaimedSend, InboundEvent, InboundKind, MediaImport, Message, MessageAnchor, MessageKind,
    OutboundMedia, SessionScope,
};
use whatsapp_linked::domain::models::{GroupInfo, Identity, Participant};
use whatsapp_linked::domain::session::SessionService;
use whatsapp_linked::outbound::pg::PgLinkedRepository;

use super::{AccountConfig, AccountSessions};
use crate::domain::inbound::InboundGate;
use crate::domain::ports::{
    AccountControl, AccountExit, AccountRunner, AccountSignal, DownloadFailure, InboundSink,
    SendFailure, SessionConnector, SessionError, SessionEvent, UploadedMedia, WhatsAppSession,
};

const IDENTITY: &str = "15550001111@s.whatsapp.net";
const GROUP: &str = "120363000000000001@g.us";

/// Calls the runner made, in order.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Call {
    /// Lease epoch and whether the device starts fresh.
    Open(i64, bool),
    StartPairing,
    Connect,
    JoinedGroups,
    Logout,
    Disconnect,
    PasskeyResponse(serde_json::Value),
    ConfirmPasskey,
    Group(String),
    /// Chat, message id before which, count.
    RequestHistory(String, String, u32),
    /// Chat, message id.
    RequestMessage(String, String),
}

#[derive(Clone)]
struct FakeWhatsApp {
    calls: mpsc::UnboundedSender<Call>,
    events: Arc<Mutex<Option<mpsc::UnboundedSender<SessionEvent>>>>,
    inbound: Arc<Mutex<Option<Arc<dyn InboundSink>>>>,
    identity: Arc<Mutex<Option<String>>>,
    /// What reading one group returns.
    group: Arc<Mutex<Option<GroupInfo>>>,
}

struct FakeSession {
    whatsapp: FakeWhatsApp,
}

impl SessionConnector for FakeWhatsApp {
    type Session = FakeSession;

    async fn open(
        &self,
        scope: SessionScope,
        fresh_device: bool,
        inbound: Arc<dyn InboundSink>,
    ) -> Result<(FakeSession, mpsc::UnboundedReceiver<SessionEvent>), SessionError> {
        let (sender, receiver) = mpsc::unbounded_channel();
        *self.events.lock().unwrap() = Some(sender);
        *self.inbound.lock().unwrap() = Some(inbound);
        self.calls
            .send(Call::Open(scope.lease_epoch, fresh_device))
            .unwrap();
        Ok((
            FakeSession {
                whatsapp: self.clone(),
            },
            receiver,
        ))
    }
}

impl WhatsAppSession for FakeSession {
    async fn identity_jid(&self) -> Option<String> {
        self.whatsapp.identity.lock().unwrap().clone()
    }

    async fn start_pairing(&self) -> Result<(), SessionError> {
        self.whatsapp.calls.send(Call::StartPairing).unwrap();
        Ok(())
    }

    async fn send_passkey_response(&self, response: serde_json::Value) -> Result<(), SessionError> {
        self.whatsapp
            .calls
            .send(Call::PasskeyResponse(response))
            .unwrap();
        Ok(())
    }

    async fn confirm_passkey(&self) -> Result<(), SessionError> {
        self.whatsapp.calls.send(Call::ConfirmPasskey).unwrap();
        Ok(())
    }

    async fn upload_media(&self, _media: &OutboundMedia) -> Result<UploadedMedia, SendFailure> {
        Err(SendFailure::Rejected("not_in_this_test"))
    }

    async fn download_media(&self, _import: &MediaImport) -> Result<Vec<u8>, DownloadFailure> {
        Err(DownloadFailure::Retryable)
    }

    async fn connect(&self) -> Result<(), SessionError> {
        self.whatsapp.calls.send(Call::Connect).unwrap();
        Ok(())
    }

    async fn new_message_id(&self) -> String {
        "3EB0FAKE".to_owned()
    }

    async fn send(
        &self,
        _send: &ClaimedSend,
        _message_id: &str,
        _media: Option<&UploadedMedia>,
    ) -> Result<DateTime<Utc>, SendFailure> {
        Err(SendFailure::Unknown)
    }

    async fn request_history(
        &self,
        chat_jid: &str,
        before: &MessageAnchor,
        count: u32,
    ) -> Result<(), SessionError> {
        self.whatsapp
            .calls
            .send(Call::RequestHistory(
                chat_jid.to_owned(),
                before.id.clone(),
                count,
            ))
            .unwrap();
        Ok(())
    }

    async fn request_message(
        &self,
        chat_jid: &str,
        message: &MessageAnchor,
    ) -> Result<(), SessionError> {
        self.whatsapp
            .calls
            .send(Call::RequestMessage(
                chat_jid.to_owned(),
                message.id.clone(),
            ))
            .unwrap();
        Ok(())
    }

    async fn joined_groups(&self) -> Result<Vec<GroupInfo>, SessionError> {
        self.whatsapp.calls.send(Call::JoinedGroups).unwrap();
        Ok(vec![GroupInfo {
            jid: GROUP.to_owned(),
            name: "Launch".to_owned(),
            participants: vec![Participant {
                identity: Identity {
                    jid: IDENTITY.to_owned(),
                    alternate_jid: None,
                    display_name: None,
                },
                admin: true,
            }],
            announce: false,
            disappearing_seconds: None,
            community_parent: false,
            community_jid: None,
            community_announcements: false,
            observed_at: Utc::now(),
            group: None,
            shared: None,
        }])
    }

    async fn group(&self, group_jid: &str) -> Result<Option<GroupInfo>, SessionError> {
        self.whatsapp
            .calls
            .send(Call::Group(group_jid.to_owned()))
            .unwrap();
        Ok(self.whatsapp.group.lock().unwrap().clone())
    }

    async fn logout(&self) {
        self.whatsapp.calls.send(Call::Logout).unwrap();
    }

    async fn disconnect(&self) {
        self.whatsapp.calls.send(Call::Disconnect).unwrap();
    }
}

/// A user with an account in `pairing` and a live pairing transaction.
async fn insert_pairing_account(pool: &PgPool) -> (Uuid, Uuid) {
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
    let pairing = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO whatsapp_pairing (id, account_id, user_id, generation, state, expires_at)
        VALUES ($1, $2, $3, 1, 'waiting', now() + interval '5 minutes')"#,
        pairing,
        account,
        user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    (account, pairing)
}

fn runner(
    pool: &PgPool,
) -> (
    Arc<AccountSessions<FakeWhatsApp>>,
    FakeWhatsApp,
    mpsc::UnboundedReceiver<Call>,
) {
    runner_with(Duration::from_secs(600), Duration::from_secs(3600), pool)
}

fn runner_ticking(
    tick_every: Duration,
    pool: &PgPool,
) -> (
    Arc<AccountSessions<FakeWhatsApp>>,
    FakeWhatsApp,
    mpsc::UnboundedReceiver<Call>,
) {
    runner_with(tick_every, Duration::from_secs(3600), pool)
}

fn runner_with(
    tick_every: Duration,
    groups_refresh_interval: Duration,
    pool: &PgPool,
) -> (
    Arc<AccountSessions<FakeWhatsApp>>,
    FakeWhatsApp,
    mpsc::UnboundedReceiver<Call>,
) {
    let (calls, call_receiver) = mpsc::unbounded_channel();
    let whatsapp = FakeWhatsApp {
        calls,
        events: Arc::default(),
        inbound: Arc::default(),
        identity: Arc::default(),
        group: Arc::default(),
    };
    let runner = Arc::new(AccountSessions::new(
        SessionService::new(Arc::new(PgLinkedRepository::new(pool.clone()))),
        whatsapp.clone(),
        AccountConfig {
            send_timeout: Duration::from_secs(5),
            send_batch: 16,
            tick_every,
            groups_refresh_interval,
            backfill_timeout: Duration::from_secs(60),
            backfill_retry: Duration::from_secs(300),
        },
    ));
    (runner, whatsapp, call_receiver)
}

struct Started {
    signals: mpsc::Sender<AccountSignal>,
    release: CancellationToken,
    running: tokio::task::JoinHandle<AccountExit>,
}

fn start(runner: &Arc<AccountSessions<FakeWhatsApp>>, account: Uuid) -> Started {
    let (signals, signal_receiver) = mpsc::channel(8);
    let release = CancellationToken::new();
    let control = AccountControl {
        signals: signal_receiver,
        release: release.clone(),
        stop: CancellationToken::new(),
    };
    let runner = Arc::clone(runner);
    let running = tokio::spawn(async move { runner.run(account, control).await });
    Started {
        signals,
        release,
        running,
    }
}

fn event_sender(whatsapp: &FakeWhatsApp) -> mpsc::UnboundedSender<SessionEvent> {
    whatsapp.events.lock().unwrap().clone().unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pairing_records_the_qr_and_identity_then_refreshes_groups(pool: PgPool) {
    let (account, pairing) = insert_pairing_account(&pool).await;
    let (runner, whatsapp, mut calls) = runner(&pool);
    let started = start(&runner, account);
    assert_eq!(calls.recv().await, Some(Call::Open(1, true)));
    assert_eq!(calls.recv().await, Some(Call::StartPairing));
    assert_eq!(calls.recv().await, Some(Call::Connect));

    let events = event_sender(&whatsapp);
    events.send(SessionEvent::Qr("qr-1".to_owned())).unwrap();
    events
        .send(SessionEvent::PairSuccess {
            identity_jid: IDENTITY.to_owned(),
        })
        .unwrap();
    *whatsapp.identity.lock().unwrap() = Some(IDENTITY.to_owned());
    events.send(SessionEvent::Connected).unwrap();
    assert_eq!(calls.recv().await, Some(Call::JoinedGroups));
    started.release.cancel();
    assert_eq!(started.running.await.unwrap(), AccountExit::Released);
    assert_eq!(calls.recv().await, Some(Call::Disconnect));

    let paired = sqlx::query!(
        "SELECT state, consumed_at IS NOT NULL AS \"consumed!\", qr_code FROM whatsapp_pairing WHERE id = $1",
        pairing
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(paired.state, "success");
    assert!(paired.consumed);
    assert_eq!(paired.qr_code, None, "codes are cleared once pairing ends");
    let linked = sqlx::query!(
        "SELECT state, identity_jid, lease_epoch FROM whatsapp_linked_account WHERE id = $1",
        account
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(linked.state, "connected");
    assert_eq!(linked.identity_jid.as_deref(), Some(IDENTITY));
    assert_eq!(linked.lease_epoch, 1);
    let roster = sqlx::query_scalar!(
        "SELECT group_jid FROM whatsapp_group_roster WHERE account_id = $1",
        account
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(roster, vec![GROUP.to_owned()]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_replica_whose_epoch_was_taken_over_cannot_write_and_stops(pool: PgPool) {
    let (account, pairing) = insert_pairing_account(&pool).await;
    let (runner, whatsapp, mut calls) = runner(&pool);
    let started = start(&runner, account);
    assert_eq!(calls.recv().await, Some(Call::Open(1, true)));
    assert_eq!(calls.recv().await, Some(Call::StartPairing));
    assert_eq!(calls.recv().await, Some(Call::Connect));

    let takeover = SessionService::new(Arc::new(PgLinkedRepository::new(pool.clone())))
        .begin_lease(account)
        .await
        .unwrap();
    assert_eq!(takeover.scope.lease_epoch, 2);
    event_sender(&whatsapp)
        .send(SessionEvent::Qr("stale-qr".to_owned()))
        .unwrap();

    assert_eq!(started.running.await.unwrap(), AccountExit::Fenced);
    assert_eq!(calls.recv().await, Some(Call::Disconnect));
    let qr_code = sqlx::query_scalar!(
        "SELECT qr_code FROM whatsapp_pairing WHERE id = $1",
        pairing
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(qr_code, None, "the fenced replica's write never landed");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_owner_who_disconnects_gets_the_device_unlinked(pool: PgPool) {
    let (account, _pairing) = insert_pairing_account(&pool).await;
    sqlx::query!(
        "UPDATE whatsapp_linked_account SET state = 'connected', identity_jid = $2 WHERE id = $1",
        account,
        IDENTITY,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE whatsapp_pairing SET state = 'success', consumed_at = now() WHERE account_id = $1",
        account
    )
    .execute(&pool)
    .await
    .unwrap();
    let (runner, whatsapp, mut calls) = runner(&pool);
    *whatsapp.identity.lock().unwrap() = Some(IDENTITY.to_owned());
    let started = start(&runner, account);
    assert_eq!(
        calls.recv().await,
        Some(Call::Open(1, false)),
        "a connected account keeps its device"
    );
    assert_eq!(calls.recv().await, Some(Call::Connect));

    sqlx::query!(
        "UPDATE whatsapp_linked_account SET state = 'disconnected' WHERE id = $1",
        account
    )
    .execute(&pool)
    .await
    .unwrap();
    started.signals.send(AccountSignal::Changed).await.unwrap();

    assert_eq!(calls.recv().await, Some(Call::Logout));
    assert_eq!(started.running.await.unwrap(), AccountExit::Idle);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn passkey_pairing_shows_the_challenge_forwards_the_assertion_once_and_confirms(
    pool: PgPool,
) {
    let (account, pairing) = insert_pairing_account(&pool).await;
    let (runner, whatsapp, mut calls) = runner(&pool);
    let started = start(&runner, account);
    assert_eq!(calls.recv().await, Some(Call::Open(1, true)));
    assert_eq!(calls.recv().await, Some(Call::StartPairing));
    assert_eq!(calls.recv().await, Some(Call::Connect));

    let challenge = serde_json::json!({ "challenge": "c2lnbg", "rpId": "whatsapp.com" });
    event_sender(&whatsapp)
        .send(SessionEvent::PasskeyRequested {
            challenge: challenge.clone(),
        })
        .unwrap();
    // The owner answers through DSS, which stores the assertion and signals.
    let assertion = serde_json::json!({ "id": "credential", "type": "public-key" });
    // Events are handled in order: once Connected was handled, so was the request.
    event_sender(&whatsapp)
        .send(SessionEvent::Connected)
        .unwrap();
    assert_eq!(calls.recv().await, Some(Call::JoinedGroups));
    let shown = sqlx::query!(
        "SELECT state, passkey_challenge FROM whatsapp_pairing WHERE id = $1",
        pairing
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(shown.state, "passkey");
    assert_eq!(shown.passkey_challenge, Some(challenge));
    sqlx::query!(
        "UPDATE whatsapp_pairing SET passkey_response = $2 WHERE id = $1",
        pairing,
        assertion
    )
    .execute(&pool)
    .await
    .unwrap();
    started
        .signals
        .send(AccountSignal::Pairing(pairing))
        .await
        .unwrap();
    assert_eq!(calls.recv().await, Some(Call::PasskeyResponse(assertion)));

    event_sender(&whatsapp)
        .send(SessionEvent::PasskeyConfirmation {
            code: "ABCD-EFGH".to_owned(),
        })
        .unwrap();
    assert_eq!(calls.recv().await, Some(Call::ConfirmPasskey));
    started.release.cancel();
    assert_eq!(started.running.await.unwrap(), AccountExit::Released);
    let confirmed = sqlx::query!(
        "SELECT pair_code, passkey_response FROM whatsapp_pairing WHERE id = $1",
        pairing
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(confirmed.pair_code.as_deref(), Some("ABCD-EFGH"));
    assert_eq!(
        confirmed.passkey_response, None,
        "the assertion is forwarded once"
    );
}

fn group_text(event: u128) -> InboundEvent {
    InboundEvent {
        event_id: Uuid::from_u128(event),
        group_jid: GROUP.to_owned(),
        chat_alternate_jid: None,
        source_at: Utc::now(),
        observed_at: Utc::now(),
        kind: InboundKind::Message(Message {
            source_id: format!("3EB0{event}"),
            sender: Identity {
                jid: "15552223333@s.whatsapp.net".to_owned(),
                alternate_jid: None,
                display_name: None,
            },
            kind: MessageKind::Text,
            text: "hello".to_owned(),
            history: false,
            from_me: false,
            revision: 0,
            target: None,
            media: vec![],
            mentions: vec![],
            forwarded: false,
            view_once: false,
            rich: None,
        }),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_gate_acks_unadopted_traffic_unstored_and_refuses_once_fenced(pool: PgPool) {
    let (account, _pairing) = insert_pairing_account(&pool).await;
    let sessions = SessionService::new(Arc::new(PgLinkedRepository::new(pool.clone())));
    let stale = sessions.begin_lease(account).await.unwrap().scope;
    let current = sessions.begin_lease(account).await.unwrap().scope;

    let gate = InboundGate::new(sessions.clone(), current);
    assert!(
        gate.accept(&group_text(1)).await,
        "an unadopted group is acknowledged and dropped"
    );
    let stored = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM whatsapp_inbound_event WHERE account_id = $1"#,
        account
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored, 0);

    let fenced = InboundGate::new(sessions, stale);
    assert!(
        !fenced.accept(&group_text(2)).await,
        "a fenced replica leaves the node unacknowledged"
    );
    assert!(fenced.fenced.is_cancelled(), "and stops the account");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_passkey_answer_is_forwarded_on_the_tick_without_a_signal(pool: PgPool) {
    let (account, pairing) = insert_pairing_account(&pool).await;
    let (runner, whatsapp, mut calls) = runner_ticking(Duration::from_millis(50), &pool);
    let started = start(&runner, account);
    assert_eq!(calls.recv().await, Some(Call::Open(1, true)));
    assert_eq!(calls.recv().await, Some(Call::StartPairing));
    assert_eq!(calls.recv().await, Some(Call::Connect));
    event_sender(&whatsapp)
        .send(SessionEvent::PasskeyRequested {
            challenge: serde_json::json!({ "rpId": "whatsapp.com" }),
        })
        .unwrap();
    event_sender(&whatsapp)
        .send(SessionEvent::Connected)
        .unwrap();
    assert_eq!(calls.recv().await, Some(Call::JoinedGroups));

    // DSS stored the assertion but its NOTIFY never reached this replica.
    let assertion = serde_json::json!({ "id": "credential", "type": "public-key" });
    sqlx::query!(
        "UPDATE whatsapp_pairing SET passkey_response = $2 WHERE id = $1",
        pairing,
        assertion
    )
    .execute(&pool)
    .await
    .unwrap();

    let forwarded = loop {
        match calls.recv().await {
            Some(Call::JoinedGroups) => continue,
            other => break other,
        }
    };
    assert_eq!(forwarded, Some(Call::PasskeyResponse(assertion)));
    started.release.cancel();
    assert_eq!(started.running.await.unwrap(), AccountExit::Released);
}

/// A connected account whose runner has connected and read its groups once.
async fn connected(
    pool: &PgPool,
    groups_refresh_interval: Duration,
) -> (Uuid, FakeWhatsApp, mpsc::UnboundedReceiver<Call>, Started) {
    let (account, _pairing) = insert_pairing_account(pool).await;
    sqlx::query!(
        "UPDATE whatsapp_linked_account SET state = 'connected', identity_jid = $2 WHERE id = $1",
        account,
        IDENTITY,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE whatsapp_pairing SET state = 'success', consumed_at = now() WHERE account_id = $1",
        account
    )
    .execute(pool)
    .await
    .unwrap();
    let (runner, whatsapp, mut calls) =
        runner_with(Duration::from_secs(600), groups_refresh_interval, pool);
    *whatsapp.identity.lock().unwrap() = Some(IDENTITY.to_owned());
    let started = start(&runner, account);
    assert_eq!(calls.recv().await, Some(Call::Open(1, false)));
    assert_eq!(calls.recv().await, Some(Call::Connect));
    event_sender(&whatsapp)
        .send(SessionEvent::Connected)
        .unwrap();
    assert_eq!(calls.recv().await, Some(Call::JoinedGroups));
    (account, whatsapp, calls, started)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn requested_group_refreshes_are_rate_limited_per_account(pool: PgPool) {
    let (_, _, mut calls, started) = connected(&pool, Duration::from_secs(3600)).await;
    // Opening the page right after connecting does not read the groups again;
    // a resync (missed notifications) always does. Signals run in order.
    started.signals.send(AccountSignal::Groups).await.unwrap();
    started.signals.send(AccountSignal::Resync).await.unwrap();
    assert_eq!(calls.recv().await, Some(Call::JoinedGroups));
    started.release.cancel();
    assert_eq!(started.running.await.unwrap(), AccountExit::Released);
    assert_eq!(
        calls.recv().await,
        Some(Call::Disconnect),
        "exactly one read for the two signals"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn requested_group_refreshes_run_once_the_interval_passed(pool: PgPool) {
    let (_, _, mut calls, started) = connected(&pool, Duration::ZERO).await;
    started.signals.send(AccountSignal::Groups).await.unwrap();
    assert_eq!(calls.recv().await, Some(Call::JoinedGroups));
    started.release.cancel();
    assert_eq!(started.running.await.unwrap(), AccountExit::Released);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn live_group_events_update_the_one_group(pool: PgPool) {
    const OTHER: &str = "120363000000000002@g.us";
    let mut listener = sqlx::postgres::PgListener::connect_with(&pool)
        .await
        .unwrap();
    listener
        .listen(whatsapp_linked::outbound::pg::signals::CHANGED)
        .await
        .unwrap();
    let (account, whatsapp, mut calls, started) = connected(&pool, Duration::from_secs(3600)).await;
    // The connect refresh stored the first list.
    listener.recv().await.unwrap();
    let joined = GroupInfo {
        jid: OTHER.to_owned(),
        name: "Joined".to_owned(),
        participants: vec![Participant {
            identity: Identity {
                jid: IDENTITY.to_owned(),
                alternate_jid: None,
                display_name: None,
            },
            admin: false,
        }],
        announce: false,
        disappearing_seconds: None,
        community_parent: false,
        community_jid: None,
        community_announcements: false,
        observed_at: Utc::now(),
        group: None,
        shared: None,
    };
    event_sender(&whatsapp)
        .send(SessionEvent::GroupChanged {
            group_jid: OTHER.to_owned(),
            info: Some(Box::new(joined)),
        })
        .unwrap();
    listener.recv().await.unwrap();
    let roster = |pool: PgPool| async move {
        sqlx::query_scalar!(
            "SELECT group_jid FROM whatsapp_group_roster WHERE account_id = $1 ORDER BY group_jid",
            account
        )
        .fetch_all(&pool)
        .await
        .unwrap()
    };
    assert_eq!(
        roster(pool.clone()).await,
        vec![GROUP.to_owned(), OTHER.to_owned()]
    );

    // A change notice without metadata is read; a refused read means the
    // account left.
    *whatsapp.group.lock().unwrap() = None;
    event_sender(&whatsapp)
        .send(SessionEvent::GroupChanged {
            group_jid: OTHER.to_owned(),
            info: None,
        })
        .unwrap();
    assert_eq!(calls.recv().await, Some(Call::Group(OTHER.to_owned())));
    listener.recv().await.unwrap();
    assert_eq!(roster(pool.clone()).await, vec![GROUP.to_owned()]);
    started.release.cancel();
    assert_eq!(started.running.await.unwrap(), AccountExit::Released);
}
