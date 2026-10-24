//! Linked WhatsApp accounts end to end: pairing, adoption, inbound messages,
//! sends, failover and drain, against the fake WhatsApp server.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    ViewAccessLevel,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Connection, PgConnection, PgPool};
use uuid::Uuid;
use whatsapp_fake_server::{FakePhone, FakeWhatsApp};
use whatsapp_linked::domain::models::{
    AccountState, AdoptGroup, Binding, Features, ReplyContent, SendAuthority, SendReply,
};
use whatsapp_linked::domain::ports::{Authorizer, LinkedResult};
use whatsapp_linked::domain::service::LinkedService;
use whatsapp_linked::outbound::pg::PgLinkedRepository;
use whatsmeow::types::Jid;

use super::*;

const TIMEOUT: Duration = Duration::from_secs(60);
const ALICE: &str = "macro|alice@example.com";
const BOB: &str = "macro|bob@example.com";

/// Runs one scenario at a time across nextest's test processes. Each one
/// holds a dozen or more connections (replica pools, lock connection,
/// listeners); in parallel with the rest of the workspace they exhaust CI's
/// Postgres (`max_connections` = 100). Advisory locks are per database, so
/// the lock lives in the shared `postgres` database, not the test's own.
async fn take_fleet_slot(pool: &PgPool) -> PgConnection {
    let options = (*pool.connect_options()).clone().database("postgres");
    let mut slot = PgConnection::connect_with(&options)
        .await
        .expect("the fleet lock connection opens");
    sqlx::raw_sql("SELECT pg_advisory_lock(7346525012)")
        .execute(&mut slot)
        .await
        .expect("the fleet lock is taken");
    slot
}

struct Allow;

#[async_trait]
impl Authorizer for Allow {
    async fn require_team_member(&self, _: Uuid, _: &str) -> LinkedResult<()> {
        Ok(())
    }
    async fn require_group_owner(&self, _: Uuid, _: &str) -> LinkedResult<()> {
        Ok(())
    }
}

/// The database, the DSS-side domain service and the fake WhatsApp world:
/// Alice and Bob (Macro users with their own WhatsApp) and a customer who is
/// only on WhatsApp, all in one group.
struct World {
    /// Holds the fleet lock until the scenario ends (see [`take_fleet_slot`]).
    _fleet_slot: PgConnection,
    pool: PgPool,
    linked: LinkedService,
    whatsapp: FakeWhatsApp,
    kms: SharedKms,
    team: Uuid,
    alice: FakePhone,
    bob: FakePhone,
    customer: FakePhone,
    group: Jid,
}

impl World {
    async fn new(pool: PgPool) -> World {
        let fleet_slot = take_fleet_slot(&pool).await;
        watch_tables(&pool).await;
        for id in [ALICE, BOB] {
            user(&pool, id).await;
        }
        let team = Uuid::now_v7();
        sqlx::query!(
            "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Linked', $2)",
            team,
            ALICE
        )
        .execute(&pool)
        .await
        .unwrap();
        for (id, role) in [(ALICE, "owner"), (BOB, "member")] {
            sqlx::query!(
                "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, $3::text::team_role)",
                team,
                id,
                role
            )
            .execute(&pool)
            .await
            .unwrap();
        }
        let linked = LinkedService::new(
            Features {
                pairing: true,
                adoption: true,
                sending: true,
            },
            Arc::new(PgLinkedRepository::new(pool.clone())),
            Arc::new(Allow),
            Arc::new(Allow),
        );
        let whatsapp = FakeWhatsApp::start().await.unwrap();
        let alice = whatsapp.add_user("15550000001", "Alice").await;
        let bob = whatsapp.add_user("15550000002", "Bob").await;
        let customer = whatsapp.add_user("15558880001", "Customer").await;
        let group = whatsapp.create_group("Customer escalations", &[&customer, &alice, &bob]);
        World {
            _fleet_slot: fleet_slot,
            pool,
            linked,
            whatsapp,
            kms: SharedKms::new(),
            team,
            alice,
            bob,
            customer,
            group,
        }
    }

    async fn replica(&self) -> Replica {
        Replica::start(&self.pool.connect_options(), &self.whatsapp, &self.kms).await
    }

    /// Pairs `user` through DSS: start a pairing, wait for the replica's QR,
    /// scan it with `phone`, wait for the account to connect. Returns the
    /// linked device.
    async fn pair(&self, user: &str, phone: &FakePhone) -> Jid {
        let pairing = self
            .linked
            .connect(user, false, SendAuthority::Human)
            .await
            .unwrap();
        let qr = wait_for_rows(&self.pool, TIMEOUT, || async {
            self.linked
                .pair_state(user, pairing.id, SendAuthority::Human)
                .await
                .ok()?
                .qr
        })
        .await
        .expect("the replica shows a QR code");
        let device = phone
            .scan_qr(&qr)
            .await
            .expect("the phone approves the QR code");
        let identity = phone.jid().to_string();
        wait_for_rows(&self.pool, TIMEOUT, || async {
            let account = self.linked.account(user).await.ok()??;
            (account.state == AccountState::Connected
                && account.identity_jid.as_deref() == Some(identity.as_str()))
            .then_some(())
        })
        .await
        .expect("the account connects as the phone's number");
        device
    }

    /// Adopts the group for `user` once the replica has listed it.
    async fn adopt(&self, user: &str, users: &[&str]) -> Binding {
        let group = self.group.to_string();
        wait_for_rows(&self.pool, TIMEOUT, || async {
            let groups = self.linked.groups(user).await.ok()?;
            groups.iter().any(|info| info.jid == group).then_some(())
        })
        .await
        .expect("the replica lists the group");
        let binding = self
            .linked
            .adopt(
                user,
                &AdoptGroup {
                    team_id: Some(self.team),
                    group_jid: group,
                    name: Some("Escalations".to_owned()),
                },
                SendAuthority::Human,
            )
            .await
            .unwrap();
        let mut tx = self.pool.begin().await.unwrap();
        for viewer in users {
            entity_access_db_utils::direct_share::set(
                &mut tx,
                &binding.id,
                EntityType::WhatsAppGroup,
                &(*viewer).to_owned().try_into().unwrap(),
                Some(AccessLevel::View),
                false,
            )
            .await
            .unwrap();
        }
        tx.commit().await.unwrap();
        binding
    }

    /// Alice paired and observing the adopted group.
    async fn alice_adopted(&self) -> (Jid, Binding) {
        let device = self.pair(ALICE, &self.alice).await;
        let binding = self.adopt(ALICE, &[]).await;
        (device, binding)
    }

    /// Waits until the WhatsApp message `source_id` is a standalone group message and
    /// returns every stored copy of it (there must be one).
    async fn timeline(&self, binding: &Binding, source_id: &str) -> Vec<String> {
        let copies = wait_for_rows(&self.pool, TIMEOUT, || async {
            let copies = group_messages(&self.pool, binding.id, source_id).await;
            (!copies.is_empty()).then_some(copies)
        })
        .await;
        match copies {
            Some(copies) => copies,
            None => {
                let mut whatsapp = String::new();
                for phone in [&self.alice, &self.bob] {
                    for device in self.whatsapp.linked_devices(phone) {
                        whatsapp.push_str(&format!(
                            "  {device}: online {}, deliveries {}, pending {}\n",
                            self.whatsapp.is_online(&device),
                            self.whatsapp.delivery_count(&device, source_id),
                            self.whatsapp.pending_count(&device),
                        ));
                    }
                }
                panic!(
                    "message {source_id} was not ingested\nfake WhatsApp:\n{whatsapp}{}",
                    self.dump().await
                )
            }
        }
    }

    /// `found`, or a panic that shows the linked-device rows.
    async fn expect<Found>(&self, found: Option<Found>, what: &str) -> Found {
        match found {
            Some(found) => found,
            None => panic!("{what}\n{}", self.dump().await),
        }
    }

    /// The linked-device rows a failed wait should explain itself with.
    async fn dump(&self) -> String {
        let pool = &self.pool;
        let sections = [
            (
                "inbound events (account, state, kind)",
                sqlx::query_scalar!(
                    r#"SELECT account_id::text || ' ' || state || ' ' || coalesce(payload->>'kind', '') AS "row!" FROM whatsapp_inbound_event"#
                )
                .fetch_all(pool)
                .await,
            ),
            (
                "external messages (source, origin, message)",
                sqlx::query_scalar!(
                    r#"SELECT source_id || ' ' || origin || ' ' || coalesce(message_id::text, '-') AS "row!" FROM whatsapp_group_message"#
                )
                .fetch_all(pool)
                .await,
            ),
            (
                "observations (source, account)",
                sqlx::query_scalar!(
                    r#"SELECT source_id || ' ' || account_id::text AS "row!" FROM whatsapp_message_observation"#
                )
                .fetch_all(pool)
                .await,
            ),
            (
                "accounts (id, state, lease epoch)",
                sqlx::query_scalar!(
                    r#"SELECT id::text || ' ' || state || ' ' || lease_epoch AS "row!" FROM whatsapp_linked_account"#
                )
                .fetch_all(pool)
                .await,
            ),
            (
                "sends (state, source)",
                sqlx::query_scalar!(
                    r#"SELECT state || ' ' || coalesce(allocated_source_id, '-') AS "row!" FROM whatsapp_send"#
                )
                .fetch_all(pool)
                .await,
            ),
        ];
        let mut dump = String::new();
        for (title, rows) in sections {
            dump.push_str(&format!("{title}:\n"));
            let rows = rows.unwrap_or_else(|error| vec![format!("query failed: {error}")]);
            for row in rows {
                dump.push_str(&format!("  {row}\n"));
            }
        }
        dump
    }

    async fn send(&self, user: &str, binding: &Binding, text: &str) -> Uuid {
        self.linked
            .send_reply(
                &receipt::<ViewAccessLevel>(user, binding.id),
                &SendReply {
                    idempotency_key: Uuid::now_v7(),
                    message: ReplyContent::Text {
                        text: text.to_owned(),
                    },
                    reply_to: None,
                },
                SendAuthority::Human,
            )
            .await
            .unwrap()
            .id
    }

    async fn send_state(&self, send: Uuid) -> (String, Option<String>) {
        let row = sqlx::query!(
            "SELECT state, allocated_source_id FROM whatsapp_send WHERE id = $1",
            send
        )
        .fetch_one(&self.pool)
        .await
        .unwrap();
        (row.state, row.allocated_source_id)
    }

    /// Waits until the send's state is one of `states`.
    async fn wait_send(&self, send: Uuid, states: &[&str]) -> (String, Option<String>) {
        let state = wait_for_rows(&self.pool, TIMEOUT, || async {
            let state = self.send_state(send).await;
            states.contains(&state.0.as_str()).then_some(state)
        })
        .await;
        self.expect(state, &format!("the send reaches one of {states:?}"))
            .await
    }
}

async fn user(pool: &PgPool, id: &str) {
    let email = id.trim_start_matches("macro|");
    let macro_user = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $2)",
        macro_user,
        id,
        email
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        id,
        email,
        macro_user
    )
    .execute(pool)
    .await
    .unwrap();
}

fn receipt<Permission: entity_access::domain::models::RequiredPermission>(
    user: &str,
    channel: Uuid,
) -> EntityAccessReceipt<Permission> {
    EntityAccessReceipt::try_new(
        EntityAccessAuth::Authenticated(user.to_owned().try_into().unwrap()),
        Entity {
            entity_id: channel.to_string(),
            entity_type: EntityType::WhatsAppGroup,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap()
}

/// The content of every standalone message for one WhatsApp message.
async fn group_messages(pool: &PgPool, binding: Uuid, source_id: &str) -> Vec<String> {
    sqlx::query_scalar!(
        "SELECT body FROM whatsapp_group_message WHERE binding_id=$1 AND source_id=$2 AND message_id IS NOT NULL",
        binding,
        source_id
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn observations(pool: &PgPool, binding: Uuid, source_id: &str) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM whatsapp_message_observation WHERE binding_id = $1 AND source_id = $2"#,
        binding,
        source_id
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pair_adopt_receive_once_and_send_from_your_own_number(pool: PgPool) {
    let world = World::new(pool).await;
    let replica = world.replica().await;
    world.pair(ALICE, &world.alice).await;
    world.pair(BOB, &world.bob).await;
    let binding = world.adopt(ALICE, &[BOB]).await;
    let joined = world.adopt(BOB, &[]).await;
    assert_eq!(joined.id, binding.id, "both accounts observe one binding");

    // Two linked accounts see the customer's message; it lands once.
    let source = world
        .customer
        .send_text(&world.group, "my order is late")
        .await
        .unwrap();
    let copies = world.timeline(&binding, &source).await;
    assert_eq!(copies.len(), 1);
    assert!(copies[0].contains("my order is late"), "{copies:?}");
    let observed = wait_for_rows(&world.pool, TIMEOUT, || async {
        (observations(&world.pool, binding.id, &source).await == 2).then_some(())
    })
    .await;
    world
        .expect(observed, "both accounts observe the message")
        .await;
    assert_eq!(
        group_messages(&world.pool, binding.id, &source).await.len(),
        1
    );

    // Alice replies from Macro; the customer gets it from Alice's number.
    let send = world.send(ALICE, &binding, "sorry, on it").await;
    let received = world
        .customer
        .wait_for_message(TIMEOUT, |message| message.text() == Some("sorry, on it"))
        .await
        .expect("the customer's phone receives the reply");
    assert_eq!(received.sender_phone, world.alice.jid());
    assert_eq!(received.chat, world.group);
    let (_, source_id) = world
        .wait_send(send, &["accepted", "sent", "delivered", "read"])
        .await;
    assert_eq!(source_id.as_deref(), Some(received.id.as_str()));

    // A shared second sender uses their own connection and phone number.
    let second_send = world.send(BOB, &binding, "Bob here too").await;
    let second_reply = world
        .customer
        .wait_for_message(TIMEOUT, |message| message.text() == Some("Bob here too"))
        .await
        .expect("the shared viewer sends from their own WhatsApp");
    assert_eq!(second_reply.sender_phone, world.bob.jid());
    world
        .wait_send(second_send, &["accepted", "sent", "delivered", "read"])
        .await;

    replica.drain(TIMEOUT).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_killed_replica_is_taken_over_without_losing_or_duplicating(pool: PgPool) {
    let world = World::new(pool).await;
    let first = world.replica().await;
    let (device, binding) = world.alice_adopted().await;
    let second = world.replica().await;

    let before = world
        .customer
        .send_text(&world.group, "before")
        .await
        .unwrap();
    assert_eq!(world.timeline(&binding, &before).await.len(), 1);

    first.kill();
    assert!(world.whatsapp.wait_until_offline(&device, TIMEOUT).await);
    let during = world
        .customer
        .send_text(&world.group, "during")
        .await
        .unwrap();
    let after_takeover = world.whatsapp.wait_until_online(&device, TIMEOUT).await;
    assert!(after_takeover, "the second replica takes the account over");
    let after = world
        .customer
        .send_text(&world.group, "after")
        .await
        .unwrap();

    for (source, text) in [(&before, "before"), (&during, "during"), (&after, "after")] {
        let copies = world.timeline(&binding, source).await;
        assert_eq!(copies.len(), 1, "{text} lands exactly once");
        assert!(copies[0].contains(text));
    }
    let send = world.send(ALICE, &binding, "still here").await;
    world
        .wait_send(send, &["accepted", "sent", "delivered", "read"])
        .await;
    world
        .customer
        .wait_for_message(TIMEOUT, |message| message.text() == Some("still here"))
        .await
        .expect("sends work after the takeover");

    second.drain(TIMEOUT).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_drained_replica_hands_over_without_loss(pool: PgPool) {
    let world = World::new(pool).await;
    let first = world.replica().await;
    let (device, binding) = world.alice_adopted().await;
    let second = world.replica().await;

    let before = world
        .customer
        .send_text(&world.group, "before drain")
        .await
        .unwrap();
    assert_eq!(world.timeline(&binding, &before).await.len(), 1);
    let send = world.send(ALICE, &binding, "sent while draining").await;

    first
        .drain(TIMEOUT)
        .await
        .expect("the replica drains cleanly");
    let during = world
        .customer
        .send_text(&world.group, "during handover")
        .await
        .unwrap();
    assert!(world.whatsapp.wait_until_online(&device, TIMEOUT).await);

    assert_eq!(world.timeline(&binding, &during).await.len(), 1);
    assert_eq!(
        group_messages(&world.pool, binding.id, &before).await.len(),
        1
    );
    let (_, source_id) = world
        .wait_send(send, &["accepted", "sent", "delivered", "read"])
        .await;
    let source_id = source_id.expect("a dispatched send has a source id");
    assert_eq!(world.whatsapp.submission_count(&device, &source_id), 1);

    second.drain(TIMEOUT).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_send_cut_off_after_submission_is_unknown_and_never_resent(pool: PgPool) {
    let world = World::new(pool).await;
    let first = world.replica().await;
    let (device, binding) = world.alice_adopted().await;

    // WhatsApp gets the message, but the replica dies before the ack.
    world.whatsapp.withhold_acks(&device, true);
    let submitted_before = world.whatsapp.submissions(&device).len();
    let send = world.send(ALICE, &binding, "did this go out?").await;
    assert!(
        world
            .whatsapp
            .wait_for_submissions(&device, submitted_before + 1, TIMEOUT)
            .await
    );
    first.kill();
    world.whatsapp.withhold_acks(&device, false);

    let second = world.replica().await;
    let (state, source_id) = world.wait_send(send, &["unknown"]).await;
    assert_eq!(state, "unknown");
    let source_id = source_id.expect("the dispatch fence recorded the source id");

    // A later send goes out through the new replica; the unknown one doesn't.
    let later = world.send(ALICE, &binding, "a later message").await;
    world
        .wait_send(later, &["accepted", "sent", "delivered", "read"])
        .await;
    assert_eq!(world.whatsapp.submission_count(&device, &source_id), 1);
    assert_eq!(world.send_state(send).await.0, "unknown");
    let copies = world
        .customer
        .received()
        .into_iter()
        .filter(|message| message.text() == Some("did this go out?"))
        .count();
    assert_eq!(copies, 1, "the customer got the cut-off message once");

    second.drain(TIMEOUT).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_send_without_an_ack_times_out_as_unknown(pool: PgPool) {
    let world = World::new(pool).await;
    let replica = world.replica().await;
    let (device, binding) = world.alice_adopted().await;

    world.whatsapp.withhold_acks(&device, true);
    let send = world.send(ALICE, &binding, "no ack for this").await;
    let (_, source_id) = world.wait_send(send, &["unknown"]).await;
    let source_id = source_id.expect("the dispatch fence recorded the source id");
    world.whatsapp.withhold_acks(&device, false);

    let later = world.send(ALICE, &binding, "acked").await;
    world
        .wait_send(later, &["accepted", "sent", "delivered", "read"])
        .await;
    assert_eq!(world.whatsapp.submission_count(&device, &source_id), 1);

    replica.drain(TIMEOUT).await.unwrap();
}

#[tokio::test]
async fn a_phone_group_message_maps_to_one_inbound_text() {
    use whatsapp_linked::domain::events::{InboundKind, MessageKind};
    use whatsapp_session_service::outbound::whatsapp::events::{Mapped, map_event};

    let whatsapp = FakeWhatsApp::start().await.unwrap();
    let alice = whatsapp.add_user("15550000001", "Alice").await;
    let bob = whatsapp.add_user("15550000002", "Bob").await;
    let store = Arc::new(whatsmeow::store::MemoryStore::default());
    let device = store.new_device(&whatsmeow_signal::LibsignalCurveSignatures::new());
    let client = whatsmeow::Client::new(
        device,
        whatsapp_fake_server::test_signal(),
        whatsmeow::ClientConfig {
            dialer: whatsapp.dialer(),
            synchronous_ack: true,
            ..Default::default()
        },
    );
    let mut events = client.subscribe();
    let mut qr = client
        .get_qr_channel(tokio_util::sync::CancellationToken::new())
        .await
        .unwrap();
    client.connect().await.unwrap();
    let Some(whatsmeow::QrChannelItem::Code { code, .. }) = qr.recv().await else {
        panic!("expected a QR code");
    };
    let linked = alice.scan_qr(&code).await.unwrap();
    assert!(whatsapp.wait_until_keys_uploaded(&linked, TIMEOUT).await);
    let group = whatsapp.create_group("Escalations", &[&bob, &alice]);
    let id = bob.send_text(&group, "hello").await.unwrap();

    // A phone's first group message is two events with one ID: the sender
    // key alone, then the text. Only the text is group content.
    let mut mapped = Vec::new();
    while mapped.len() < 2 {
        let event = tokio::time::timeout(TIMEOUT, events.recv())
            .await
            .expect("the client emits the message events")
            .expect("the event channel is open");
        if let whatsmeow::Event::Message(message) = &event {
            assert_eq!(message.info.id, id);
            mapped.push(map_event(
                Uuid::now_v7(),
                &event,
                chrono::Utc::now(),
                &|_| None,
            ));
        }
    }
    assert!(mapped[0].is_none(), "the key-only part is not content");
    let Some(Mapped::Inbound(event)) = &mapped[1] else {
        panic!("the text maps to an inbound event");
    };
    assert_eq!(event.group_jid, group.to_string());
    let InboundKind::Message(message) = &event.kind else {
        panic!("a message event");
    };
    assert_eq!(message.kind, MessageKind::Text);
    assert_eq!(message.text, "hello");
    assert_eq!(message.source_id, id);
    assert_eq!(message.sender.jid, bob.lid().to_string());
    assert_eq!(message.sender.alternate_jid, Some(bob.jid().to_string()));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_phone_image_is_downloaded_for_import(pool: PgPool) {
    let world = World::new(pool).await;
    let replica = world.replica().await;
    let (_, binding) = world.alice_adopted().await;

    let photo = b"jpeg bytes from the customer's camera".repeat(40);
    let source = world
        .customer
        .send_image(&world.group, &photo, "the damaged box")
        .await
        .unwrap();
    let copies = world.timeline(&binding, &source).await;
    assert_eq!(copies.len(), 1);
    assert!(copies[0].contains("the damaged box"), "{copies:?}");
    let downloaded = wait_for_rows(&world.pool, TIMEOUT, || async {
        sqlx::query_scalar!(
            "SELECT b.bytes FROM whatsapp_group_attachment a
             JOIN whatsapp_media_blob b ON b.document_id = a.document_id
             WHERE a.binding_id = $1 AND a.source_id = $2 AND a.state = 'downloaded'",
            binding.id,
            &source
        )
        .fetch_optional(&world.pool)
        .await
        .ok()
        .flatten()
    })
    .await;
    let downloaded = world
        .expect(downloaded, "the replica downloads the image for import")
        .await;
    assert_eq!(downloaded, photo);

    replica.drain(TIMEOUT).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_macro_attachment_reaches_the_group_intact(pool: PgPool) {
    let world = World::new(pool).await;
    let replica = world.replica().await;
    let (_, binding) = world.alice_adopted().await;

    let photo = b"a photo attached in Macro".repeat(40);
    let uploaded = world
        .linked
        .upload_attachment(
            &receipt::<ViewAccessLevel>(ALICE, binding.id),
            "label.jpg",
            "image/jpeg",
            &photo,
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let send = world
        .linked
        .send_reply(
            &receipt::<ViewAccessLevel>(ALICE, binding.id),
            &SendReply {
                idempotency_key: Uuid::now_v7(),
                message: ReplyContent::Media {
                    upload_id: uploaded.upload_id,
                    caption: Some("return label".to_owned()),
                },
                reply_to: None,
            },
            SendAuthority::Human,
        )
        .await
        .unwrap()
        .id;
    let (_, source_id) = world
        .wait_send(send, &["accepted", "sent", "delivered", "read"])
        .await;
    let source_id = source_id.expect("a dispatched send has a source id");
    let received = world
        .customer
        .wait_for_message(TIMEOUT, |message| message.id == source_id)
        .await
        .expect("the customer's phone receives the image");
    let image = received
        .message
        .image_message
        .as_deref()
        .expect("an image message");
    assert_eq!(image.caption.as_deref(), Some("return label"));
    assert_eq!(
        world.customer.download_image(&received).await.unwrap(),
        photo
    );

    replica.drain(TIMEOUT).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_message_queued_before_a_crash_is_ingested_once(pool: PgPool) {
    let world = World::new(pool).await;
    let first = world.replica().await;
    let (device, binding) = world.alice_adopted().await;

    // Hold ingestion back so the replica can only queue the event, then
    // crash it in that window.
    let mut blocker = world.pool.begin().await.unwrap();
    sqlx::raw_sql("LOCK TABLE whatsapp_group_message IN SHARE ROW EXCLUSIVE MODE")
        .execute(&mut *blocker)
        .await
        .unwrap();
    let source = world
        .customer
        .send_text(&world.group, "queued, then crashed")
        .await
        .unwrap();
    let pattern = format!("%{source}%");
    let queued = wait_for_rows(&world.pool, TIMEOUT, || async {
        let count = sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM whatsapp_inbound_event WHERE payload::text LIKE $1"#,
            &pattern
        )
        .fetch_one(&world.pool)
        .await
        .ok()?;
        (count > 0).then_some(())
    })
    .await;
    world
        .expect(queued, "the replica queues the event before acking it")
        .await;
    assert!(
        world.whatsapp.wait_until_acked(&device, TIMEOUT).await,
        "the node is acked once queued"
    );
    first.kill();
    blocker.rollback().await.unwrap();

    let second = world.replica().await;
    let copies = world.timeline(&binding, &source).await;
    assert_eq!(copies.len(), 1);
    assert!(copies[0].contains("queued, then crashed"));
    assert_eq!(world.whatsapp.delivery_count(&device, &source), 1);

    second.drain(TIMEOUT).await.unwrap();
}

#[async_trait]
impl whatsapp_linked::domain::ports::SendRateLimiter for Allow {
    async fn check(&self, _: &str) -> LinkedResult<()> {
        Ok(())
    }
}
