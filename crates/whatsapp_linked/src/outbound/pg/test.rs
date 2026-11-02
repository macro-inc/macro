use super::*;
use crate::domain::{
    events::*, provider::WhatsAppProvider, service::WhatsAppService, session::SessionService,
};
use async_trait::async_trait;
use chrono::{Duration, Utc};
use entity_access::domain::models::{
    AccessLevel, ViewAccessLevel as MessageView, ViewAccessLevel as MessageWrite,
};
use entity_access::domain::models::{
    Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
};
use external_chat::domain::{
    ports::{ChatEffect, ChatPublisher, EffectsRepository, Origin, SendRateLimiter},
    service::ExternalChatService,
    timeline::TimelineRepository,
};
use external_chat::outbound::pg::PgExternalChatRepository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::sync::Arc;

mod changes;
mod concurrency;
mod deletion;
mod media;
mod pairing;
mod rich;
mod timeline;

const GROUP: &str = "120363000000000001@g.us";
/// A test user's id, typed.
fn person(user: &str) -> macro_user_id::user_id::MacroUserIdStr<'static> {
    user.to_owned().try_into().expect("test user ids are valid")
}

const ALICE: &str = "macro|alice@example.com";
const BOB: &str = "macro|bob@example.com";
const CAROL: &str = "macro|carol@example.com";
const ALICE_JID: &str = "15550000001@s.whatsapp.net";
const BOB_JID: &str = "15550000002@s.whatsapp.net";
const CUSTOMER_JID: &str = "15558880001@s.whatsapp.net";

struct Allow;

/// DSS's use cases over one pool: the WhatsApp account and chat list, and
/// external chats with WhatsApp as their provider.
struct Linked {
    whatsapp: WhatsAppService,
    chats: ExternalChatService<WhatsAppProvider>,
    /// The external chat tables.
    store: Arc<PgExternalChatRepository>,
}

fn services(pool: &PgPool) -> (Linked, SessionService, Arc<PgWhatsAppRepository>) {
    let repository = Arc::new(PgWhatsAppRepository::new(pool.clone()));
    let store = Arc::new(PgExternalChatRepository::new(pool.clone()));
    (
        Linked {
            whatsapp: WhatsAppService::new(repository.clone()),
            chats: ExternalChatService::new(
                Arc::new(WhatsAppProvider::new(repository.clone())),
                store.clone(),
                Arc::new(Allow),
            ),
            store,
        },
        SessionService::new(repository.clone()),
        repository,
    )
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

/// A workspace with alice (owner), bob and carol as members.
async fn workspace(pool: &PgPool) -> Uuid {
    for id in [ALICE, BOB, CAROL] {
        user(pool, id).await;
    }
    let team = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Linked', $2)",
        team,
        ALICE
    )
    .execute(pool)
    .await
    .unwrap();
    for (id, role) in [(ALICE, "owner"), (BOB, "member"), (CAROL, "member")] {
        sqlx::query!(
            "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, $3::text::team_role)",
            team,
            id,
            role
        )
        .execute(pool)
        .await
        .unwrap();
    }
    team
}

/// Pair `user` as `jid` through the DSS and session-service paths.
async fn pair(linked: &Linked, session: &SessionService, user: &str, jid: &str) -> SessionScope {
    let pairing = linked
        .whatsapp
        .connect(&person(user), false, SendAuthority::Human)
        .await
        .unwrap();
    let lease = session.begin_lease(pairing.account_id).await.unwrap();
    session
        .update_pairing(
            lease.scope,
            pairing.id,
            PairingUpdate::Success {
                identity_jid: jid.to_owned(),
            },
        )
        .await
        .unwrap();
    lease.scope
}

fn group(members: &[&str]) -> GroupInfo {
    GroupInfo {
        jid: GROUP.into(),
        name: "Customer escalations".into(),
        participants: members
            .iter()
            .map(|jid| Participant {
                identity: Identity {
                    jid: (*jid).to_owned(),
                    alternate_jid: None,
                    display_name: None,
                },
                admin: false,
            })
            .collect(),
        announce: false,
        disappearing_seconds: None,
        community_parent: false,
        community_jid: None,
        community_announcements: false,
        observed_at: Utc::now(),
    }
}

fn text(event: u128, sender: &str, source: &str, body: &str) -> InboundEvent {
    InboundEvent {
        event_id: Uuid::from_u128(event),
        group_jid: GROUP.into(),
        chat_alternate_jid: None,
        source_at: Utc::now(),
        observed_at: Utc::now(),
        kind: InboundKind::Message(Message {
            source_id: source.into(),
            sender: Identity {
                jid: sender.into(),
                alternate_jid: None,
                display_name: Some("Customer".into()),
            },
            kind: MessageKind::Text,
            text: body.into(),
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

fn receipt<T: entity_access::domain::models::RequiredPermission>(
    user: &str,
    chat_id: Uuid,
) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::try_new(
        EntityAccessAuth::Authenticated(user.to_owned().try_into().unwrap()),
        Entity {
            entity_id: chat_id.to_string(),
            entity_type: EntityType::ExternalChat,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap()
}

/// Alice and Bob paired and both observing Alice's group, shared with Bob,
/// with a customer.
async fn adopted(
    pool: &PgPool,
) -> (
    Linked,
    SessionService,
    Arc<PgWhatsAppRepository>,
    ChatRef,
    SessionScope,
    SessionScope,
) {
    workspace(pool).await;
    let (linked, session, repository) = services(pool);
    let alice = pair(&linked, &session, ALICE, ALICE_JID).await;
    let bob = pair(&linked, &session, BOB, BOB_JID).await;
    let info = group(&[ALICE_JID, BOB_JID, CUSTOMER_JID]);
    session
        .update_groups(alice, std::slice::from_ref(&info), true)
        .await
        .unwrap();
    session
        .update_groups(bob, std::slice::from_ref(&info), true)
        .await
        .unwrap();
    let binding = linked
        .chats
        .add(
            &person(ALICE),
            &AddChat {
                provider: ExternalChatProvider::WhatsApp,
                remote_id: GROUP.into(),
                kind: ExternalChatKind::Group,
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    entity_access_db_utils::direct_share::set(
        &mut tx,
        &binding.id,
        EntityType::ExternalChat,
        &BOB.to_owned().try_into().unwrap(),
        Some(AccessLevel::View),
        false,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    // Bob's next roster read makes his account an observer of the shared group.
    session.update_groups(bob, &[info], true).await.unwrap();
    (linked, session, repository, binding, alice, bob)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn adoption_creates_a_shared_entity_and_leaving_whatsapp_keeps_view_access(pool: PgPool) {
    let (linked, session, _, binding, _, bob) = adopted(&pool).await;
    assert_eq!(binding.user_id, ALICE);
    let mine = &linked.whatsapp.chats(&person(ALICE)).await.unwrap().chats[0];
    assert_eq!(
        (mine.added.clone(), mine.shared.clone()),
        (
            Some(ChatReference {
                id: binding.id,
                name: "Customer escalations".into()
            }),
            None
        )
    );
    let shared = &linked.whatsapp.chats(&person(BOB)).await.unwrap().chats[0];
    assert_eq!(
        (shared.added.clone(), shared.shared.clone()),
        (
            None,
            Some(SharedChatReference {
                id: binding.id,
                name: "Customer escalations".into(),
                owner_id: ALICE.into()
            })
        )
    );
    assert!(
        linked
            .chats
            .detail(&receipt::<MessageView>(BOB, binding.id))
            .await
            .unwrap()
            .chat
            .can_send,
        "a viewer whose own account is in the group can send"
    );
    for (viewer, expected) in [(ALICE, true), (BOB, true), (CAROL, false)] {
        assert_eq!(
            sqlx::query_scalar!(
                r#"SELECT external_chat_can_view($1,$2) AS "visible!""#,
                binding.id,
                viewer
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            expected
        );
    }
    let mut left = text(9, BOB_JID, "unused", "");
    left.kind = InboundKind::Left;
    session.ingest_event(bob, &left).await.unwrap();
    assert_eq!(linked.chats.list(&person(BOB)).await.unwrap().len(), 1);
    assert!(
        !linked
            .chats
            .detail(&receipt::<MessageView>(BOB, binding.id))
            .await
            .unwrap()
            .chat
            .can_send
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn each_person_adds_their_own_group_once(pool: PgPool) {
    let (linked, _, _, binding, _, _) = adopted(&pool).await;
    let request = AddChat {
        provider: ExternalChatProvider::WhatsApp,
        remote_id: GROUP.into(),
        kind: ExternalChatKind::Group,
    };
    let again = linked
        .chats
        .add(&person(ALICE), &request, SendAuthority::Human)
        .await
        .unwrap();
    assert_eq!(again.id, binding.id, "adding twice returns the same group");
    let bobs = linked
        .chats
        .add(&person(BOB), &request, SendAuthority::Human)
        .await
        .unwrap();
    assert_ne!(bobs.id, binding.id);
    assert_eq!(bobs.user_id, BOB);
    let listed = &linked.whatsapp.chats(&person(BOB)).await.unwrap().chats[0];
    assert_eq!(
        (listed.added.as_ref().map(|g| g.id), listed.shared.clone()),
        (Some(bobs.id), None),
        "your own group wins over one shared with you"
    );
    assert!(matches!(
        linked
            .chats
            .add(&person(CAROL), &request, SendAuthority::Human)
            .await
            .unwrap_err()
            .current_context(),
        ExternalChatError::Disconnected
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn observers_converge_on_one_group_message_and_unadopted_groups_are_dropped(pool: PgPool) {
    let (linked, session, _, binding, alice, bob) = adopted(&pool).await;
    assert_eq!(
        session.observed_groups(alice).await.unwrap(),
        vec![GROUP.to_owned()]
    );
    let message = text(1, CUSTOMER_JID, "3EB0AAAA", "Can someone call me?");
    assert_eq!(
        session.ingest_event(alice, &message).await.unwrap(),
        IngestOutcome::Applied
    );
    let mut replay = message.clone();
    replay.event_id = Uuid::from_u128(2);
    assert_eq!(
        session.ingest_event(bob, &replay).await.unwrap(),
        IngestOutcome::Applied
    );
    session.ingest_event(alice, &message).await.unwrap();
    let rows = sqlx::query!(
        "SELECT m.body AS content, p.display_name AS imported_author FROM external_chat_message m JOIN external_chat_person p ON p.id=m.person_id WHERE m.chat_id=$1 AND m.message_id IS NOT NULL",
        binding.id
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].content, "Can someone call me?");
    assert_eq!(rows[0].imported_author.as_deref(), Some("Customer"));
    let observations = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM whatsapp_message_observation WHERE chat_id = $1"#,
        binding.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(observations, 2);
    let effects = linked.store.pending_effects(10).await.unwrap();
    assert_eq!(effects.len(), 1);
    assert!(effects[0].first_publication);
    assert_eq!(effects[0].origin, Origin::Remote);
    linked
        .store
        .published(effects[0].message_id, effects[0].revision)
        .await
        .unwrap();
    assert!(linked.store.pending_effects(10).await.unwrap().is_empty());

    let mut elsewhere = text(3, CUSTOMER_JID, "3EB0BBBB", "private chat");
    elsewhere.group_jid = "120363999999999999@g.us".into();
    assert_eq!(
        session.ingest_event(alice, &elsewhere).await.unwrap(),
        IngestOutcome::NotObserved
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unverified_lid_is_quarantined_instead_of_guessed(pool: PgPool) {
    let (_, session, _, _, alice, _) = adopted(&pool).await;
    let event = text(1, "987654321@lid", "3EB0CCCC", "who am I");
    assert_eq!(
        session.ingest_event(alice, &event).await.unwrap(),
        IngestOutcome::Quarantined
    );
    let state = sqlx::query_scalar!(
        "SELECT state FROM whatsapp_inbound_event WHERE event_id = $1",
        event.event_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(state, "quarantined");
}

/// The person and Macro user each alias of the binding resolves to.
async fn aliases(pool: &PgPool, binding: Uuid) -> Vec<(String, Uuid, Option<String>)> {
    sqlx::query!(
        "SELECT a.jid, a.person_id, p.user_id FROM whatsapp_identity_alias a JOIN external_chat_person p ON p.id = a.person_id WHERE a.chat_id = $1 ORDER BY a.jid",
        binding
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.jid, row.person_id, row.user_id))
    .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_message_from_me_is_the_account_owner_even_when_addressed_by_lid(pool: PgPool) {
    let (_, session, _, binding, alice, _) = adopted(&pool).await;
    let by_phone = text(1, ALICE_JID, "3EB0D001", "from my phone number");
    session.ingest_event(alice, &by_phone).await.unwrap();
    let mut by_lid = text(2, "53949570789492@lid", "3EB0D002", "Hi there");
    let InboundKind::Message(message) = &mut by_lid.kind else {
        unreachable!()
    };
    message.from_me = true;

    assert_eq!(
        session.ingest_event(alice, &by_lid).await.unwrap(),
        IngestOutcome::Applied
    );
    let aliases = aliases(&pool, binding.id).await;
    assert_eq!(
        aliases
            .iter()
            .map(|(jid, _, user)| (jid.as_str(), user.as_deref()))
            .collect::<Vec<_>>(),
        [
            (ALICE_JID, Some(ALICE)),
            ("53949570789492@lid", Some(ALICE))
        ]
    );
    assert_eq!(aliases[0].1, aliases[1].1, "one person for both addresses");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_quarantined_lid_sender_ingests_once_the_roster_pairs_it(pool: PgPool) {
    let (_, session, _, binding, alice, _) = adopted(&pool).await;
    const CUSTOMER_LID: &str = "987654321@lid";
    session
        .ingest_event(alice, &text(1, CUSTOMER_JID, "3EB0E001", "by phone"))
        .await
        .unwrap();
    let by_lid = text(2, CUSTOMER_LID, "3EB0E002", "by lid");
    assert_eq!(
        session.ingest_event(alice, &by_lid).await.unwrap(),
        IngestOutcome::Quarantined
    );

    let mut info = group(&[ALICE_JID, BOB_JID, CUSTOMER_JID]);
    info.participants[2].identity.alternate_jid = Some(CUSTOMER_LID.to_owned());
    session.update_groups(alice, &[info], true).await.unwrap();
    sqlx::query!("UPDATE whatsapp_inbound_event SET retry_at = now()")
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(session.replay_deferred(alice).await.unwrap(), 1);
    let aliases = aliases(&pool, binding.id).await;
    assert_eq!(
        aliases
            .iter()
            .map(|(jid, _, _)| jid.as_str())
            .collect::<Vec<_>>(),
        [CUSTOMER_JID, CUSTOMER_LID]
    );
    assert_eq!(aliases[0].1, aliases[1].1, "one person for both addresses");
    let remaining =
        sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM whatsapp_inbound_event"#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(remaining, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reaction_before_its_message_is_deferred_and_replayed(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    let reaction = InboundEvent {
        kind: InboundKind::Message(Message {
            source_id: "3EB0REACT".into(),
            sender: Identity {
                jid: BOB_JID.into(),
                alternate_jid: None,
                display_name: Some("Bob".into()),
            },
            kind: MessageKind::Reaction,
            text: "👍".into(),
            history: false,
            from_me: false,
            revision: 1,
            target: Some(Target {
                source_id: "3EB0ORIG".into(),
                sender_jid: CUSTOMER_JID.into(),
            }),
            media: vec![],
            mentions: vec![],
            forwarded: false,
            view_once: false,
            rich: None,
        }),
        ..text(1, BOB_JID, "unused", "")
    };
    assert_eq!(
        session.ingest_event(alice, &reaction).await.unwrap(),
        IngestOutcome::Deferred
    );
    session
        .ingest_event(alice, &text(2, CUSTOMER_JID, "3EB0ORIG", "Original"))
        .await
        .unwrap();
    sqlx::query!("UPDATE whatsapp_inbound_event SET retry_at = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(session.replay_deferred(alice).await.unwrap(), 1);
    let message = sqlx::query_scalar!(
        "SELECT id FROM external_chat_message WHERE chat_id = $1 AND message_id IS NOT NULL",
        binding.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let page = linked
        .store
        .messages(&binding, BOB, None, 50)
        .await
        .unwrap();
    assert_eq!(page.messages[0].id, message);
    assert_eq!(page.messages[0].reactions[0].emoji, "👍");
    assert!(page.messages[0].reactions[0].mine);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn edits_apply_in_source_order_and_deletes_are_permanent(pool: PgPool) {
    let (_, session, _, binding, alice, _) = adopted(&pool).await;
    session
        .ingest_event(alice, &text(1, CUSTOMER_JID, "3EB0EDIT", "first"))
        .await
        .unwrap();
    let edit = |event: u128, revision: i64, body: &str| InboundEvent {
        kind: InboundKind::Message(Message {
            source_id: format!("3EB0E{event}"),
            sender: Identity {
                jid: CUSTOMER_JID.into(),
                alternate_jid: None,
                display_name: None,
            },
            kind: MessageKind::Edit,
            text: body.into(),
            history: false,
            from_me: false,
            revision,
            target: Some(Target {
                source_id: "3EB0EDIT".into(),
                sender_jid: CUSTOMER_JID.into(),
            }),
            media: vec![],
            mentions: vec![],
            forwarded: false,
            view_once: false,
            rich: None,
        }),
        ..text(event, CUSTOMER_JID, "unused", "")
    };
    session
        .ingest_event(alice, &edit(2, 20, "second"))
        .await
        .unwrap();
    session
        .ingest_event(alice, &edit(3, 10, "stale"))
        .await
        .unwrap();
    let content = sqlx::query_scalar!(
        "SELECT body AS content FROM external_chat_message WHERE chat_id = $1 AND message_id IS NOT NULL",
        binding.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(content, "second");
    let mut delete = edit(4, 30, "");
    if let InboundKind::Message(message) = &mut delete.kind {
        message.kind = MessageKind::Delete;
    }
    session.ingest_event(alice, &delete).await.unwrap();
    let row = sqlx::query!(
        "SELECT body AS content, deleted_at FROM external_chat_message WHERE chat_id = $1 AND message_id IS NOT NULL",
        binding.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(row.deleted_at.is_some());
    assert_eq!(row.content, "");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_dispatched_send_becomes_unknown_after_takeover_and_settles_from_its_echo(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    let request = SendReply {
        idempotency_key: Uuid::now_v7(),
        message: ReplyContent::Text {
            text: "On it".into(),
            mentions: vec![],
        },
        reply_to: None,
    };
    assert!(matches!(
        linked
            .chats
            .send_reply(
                &receipt::<MessageWrite>(ALICE, binding.id),
                &request,
                SendAuthority::Automation,
            )
            .await
            .err()
            .unwrap()
            .current_context(),
        ExternalChatError::Forbidden
    ));
    let bot_receipt = EntityAccessReceipt::<MessageWrite>::try_new(
        EntityAccessAuth::Bot(entity_access::domain::models::BotReceiptAuth::new(
            "bot|00000000-0000-0000-0000-000000000123"
                .to_owned()
                .try_into()
                .unwrap(),
            entity_access::domain::models::BotReceiptScope::User {
                acting_user: ALICE.to_owned().try_into().unwrap(),
            },
        )),
        Entity {
            entity_id: binding.id.to_string(),
            entity_type: EntityType::ExternalChat,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap();
    assert!(
        matches!(
            linked
                .chats
                .send_reply(&bot_receipt, &request, SendAuthority::UserApiToken)
                .await
                .err()
                .unwrap()
                .current_context(),
            ExternalChatError::Forbidden
        ),
        "a bot acting for Alice still cannot send from her connection"
    );
    let progress = linked
        .chats
        .send_reply(
            &receipt::<MessageWrite>(ALICE, binding.id),
            &request,
            SendAuthority::UserApiToken,
        )
        .await
        .unwrap();
    assert_eq!(progress.state, DeliveryState::Pending);
    let replay = linked
        .chats
        .send_reply(
            &receipt::<MessageWrite>(ALICE, binding.id),
            &request,
            SendAuthority::Human,
        )
        .await
        .unwrap();
    assert_eq!(
        replay.id, progress.id,
        "the idempotency key returns the same intent"
    );
    let claimed = session.claim_sends(alice, 8).await.unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(
        claimed[0].content,
        OutgoingContent::Text {
            text: "On it".into(),
            quote: None,
            mentions: vec![],
        }
    );
    session
        .begin_dispatch(alice, claimed[0].id, "3EB0SENT")
        .await
        .unwrap();

    // The replica dies after submitting. The next one must not resend.
    let takeover = session.begin_lease(alice.account_id).await.unwrap();
    assert_eq!(takeover.sends_marked_unknown, 1);
    assert!(
        session
            .claim_sends(takeover.scope, 8)
            .await
            .unwrap()
            .is_empty()
    );
    let state = linked
        .chats
        .delivery(&receipt::<MessageView>(ALICE, binding.id), &[progress.id])
        .await
        .unwrap();
    assert_eq!(state[0].state, DeliveryState::Unknown);

    // Alice's own echo settles it as a Macro-authored message, once.
    let echo = text(7, ALICE_JID, "3EB0SENT", "On it");
    session.ingest_event(takeover.scope, &echo).await.unwrap();
    session.ingest_event(takeover.scope, &echo).await.unwrap();
    let rows = sqlx::query!(
        "SELECT m.id, p.user_id AS sender_id FROM external_chat_message m JOIN external_chat_person p ON p.id=m.person_id WHERE m.chat_id=$1 AND m.message_id IS NOT NULL",
        binding.id
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, progress.id);
    assert_eq!(rows[0].sender_id.as_deref(), Some(ALICE));
    let state = linked
        .chats
        .delivery(&receipt::<MessageView>(ALICE, binding.id), &[progress.id])
        .await
        .unwrap();
    assert_eq!(state[0].state, DeliveryState::Accepted);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_accepted_send_writes_the_group_message_and_its_echo_converges(pool: PgPool) {
    let (linked, session, _, binding, alice, bob) = adopted(&pool).await;
    session
        .ingest_event(alice, &text(1, CUSTOMER_JID, "3EB0Q", "Question?"))
        .await
        .unwrap();
    let question = sqlx::query_scalar!(
        "SELECT id FROM external_chat_message WHERE chat_id = $1 AND message_id IS NOT NULL",
        binding.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let progress = linked
        .chats
        .send_reply(
            &receipt::<MessageWrite>(BOB, binding.id),
            &SendReply {
                idempotency_key: Uuid::now_v7(),
                message: ReplyContent::Text {
                    text: "Answer".into(),
                    mentions: vec![],
                },
                reply_to: Some(question),
            },
            SendAuthority::UserApiToken,
        )
        .await
        .unwrap();
    assert!(
        session.claim_sends(alice, 8).await.unwrap().is_empty(),
        "Bob's token cannot send from Alice's connection"
    );
    let claimed = session.claim_sends(bob, 8).await.unwrap();
    assert_eq!(
        claimed[0].content,
        OutgoingContent::Text {
            text: "Answer".into(),
            quote: Some(Target {
                source_id: "3EB0Q".into(),
                sender_jid: CUSTOMER_JID.into()
            }),
            mentions: vec![],
        }
    );
    session
        .begin_dispatch(bob, progress.id, "3EB0ANS")
        .await
        .unwrap();
    session
        .record_send_outcome(
            bob,
            progress.id,
            SendOutcome::Accepted {
                server_at: Utc::now(),
            },
        )
        .await
        .unwrap();
    let mut echo = text(8, BOB_JID, "3EB0ANS", "Answer");
    if let InboundKind::Message(message) = &mut echo.kind {
        message.target = Some(Target {
            source_id: "3EB0Q".into(),
            sender_jid: CUSTOMER_JID.into(),
        });
    }
    session.ingest_event(alice, &echo).await.unwrap();
    let rows = sqlx::query!(
        "SELECT m.id, p.user_id AS sender_id, m.body AS content FROM external_chat_message m JOIN external_chat_person p ON p.id=m.person_id WHERE m.chat_id=$1 AND m.message_id IS NOT NULL ORDER BY m.source_at",
        binding.id
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[1].id, progress.id);
    assert_eq!(rows[1].sender_id.as_deref(), Some(BOB));
    assert_eq!(rows[1].content, "Answer");

    // Bob may edit his own recent message but not the customer's.
    let edit_customer = linked
        .chats
        .send_reply(
            &receipt::<MessageWrite>(BOB, binding.id),
            &SendReply {
                idempotency_key: Uuid::now_v7(),
                message: ReplyContent::Mutation {
                    message_id: question,
                    operation: Mutation::Edit,
                    text: Some("rewritten".into()),
                },
                reply_to: None,
            },
            SendAuthority::Human,
        )
        .await
        .unwrap_err();
    assert!(matches!(
        edit_customer.current_context(),
        ExternalChatError::Forbidden
    ));
    linked
        .chats
        .send_reply(
            &receipt::<MessageWrite>(BOB, binding.id),
            &SendReply {
                idempotency_key: Uuid::now_v7(),
                message: ReplyContent::Mutation {
                    message_id: progress.id,
                    operation: Mutation::Edit,
                    text: Some("Better answer".into()),
                },
                reply_to: None,
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn disconnecting_fails_undispatched_sends_and_stops_observation(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    let progress = linked
        .chats
        .send_reply(
            &receipt::<MessageWrite>(ALICE, binding.id),
            &SendReply {
                idempotency_key: Uuid::now_v7(),
                message: ReplyContent::Text {
                    text: "later".into(),
                    mentions: vec![],
                },
                reply_to: None,
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let account = linked
        .whatsapp
        .account(&person(ALICE))
        .await
        .unwrap()
        .unwrap();
    let result = linked
        .whatsapp
        .disconnect(
            &person(ALICE),
            account.authorization_generation,
            SendAuthority::Human,
        )
        .await
        .unwrap();
    assert!(result.remote_unlink_requested);
    assert!(
        !linked
            .whatsapp
            .disconnect(
                &person(ALICE),
                account.authorization_generation,
                SendAuthority::Human
            )
            .await
            .unwrap()
            .remote_unlink_requested,
        "a retried disconnect is a no-op"
    );
    let state = linked
        .chats
        .delivery(&receipt::<MessageView>(ALICE, binding.id), &[progress.id])
        .await
        .unwrap();
    assert_eq!(state[0].state, DeliveryState::Failed);
    assert!(session.observed_groups(alice).await.unwrap().is_empty());
    assert_eq!(
        session
            .ingest_event(alice, &text(1, CUSTOMER_JID, "3EB0LATE", "late"))
            .await
            .unwrap(),
        IngestOutcome::NotObserved
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stored_group_facts_authorize_adoption_and_sending_however_old(pool: PgPool) {
    workspace(&pool).await;
    let (linked, session, _) = services(&pool);
    let alice = pair(&linked, &session, ALICE, ALICE_JID).await;
    let mut info = group(&[ALICE_JID, CUSTOMER_JID]);
    info.name = String::new();
    info.observed_at = Utc::now() - Duration::days(3);
    session
        .update_groups(alice, std::slice::from_ref(&info), true)
        .await
        .unwrap();
    let request = AddChat {
        provider: ExternalChatProvider::WhatsApp,
        remote_id: GROUP.into(),
        kind: ExternalChatKind::Group,
    };
    let binding = linked
        .chats
        .add(&person(ALICE), &request, SendAuthority::Human)
        .await
        .unwrap();
    let detail = linked
        .chats
        .detail(&receipt::<MessageView>(ALICE, binding.id))
        .await
        .unwrap();
    assert!(detail.chat.can_send);
    assert_eq!(
        detail.chat.name, "+15558880001",
        "unnamed groups show members"
    );
    let progress = linked
        .chats
        .send_reply(
            &receipt::<MessageWrite>(ALICE, binding.id),
            &SendReply {
                idempotency_key: Uuid::now_v7(),
                message: ReplyContent::Text {
                    text: "hi".into(),
                    mentions: vec![],
                },
                reply_to: None,
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let claimed = session.claim_sends(alice, 8).await.unwrap();
    assert_eq!(claimed[0].id, progress.id);
    session
        .begin_dispatch(alice, progress.id, "3EB0OLDFACTS")
        .await
        .unwrap();
    let mut community = group(&[ALICE_JID]);
    community.jid = "120363000000000002@g.us".into();
    community.community_parent = true;
    session
        .update_groups(alice, &[info, community], true)
        .await
        .unwrap();
    assert!(matches!(
        linked
            .chats
            .add(
                &person(ALICE),
                &AddChat {
                    provider: ExternalChatProvider::WhatsApp,
                    remote_id: "120363000000000002@g.us".into(),
                    kind: ExternalChatKind::Group
                },
                SendAuthority::Human
            )
            .await
            .unwrap_err()
            .current_context(),
        ExternalChatError::CannotAdd(CannotAdd::Community)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn messages_stamped_around_adoption_follow_the_second_granular_boundary(pool: PgPool) {
    let (_, session, _, binding, alice, _) = adopted(&pool).await;
    let adopted_at = sqlx::query_scalar!(
        "SELECT GREATEST(b.adopted_at, m.consent_at) AS \"at!\" FROM external_chat b JOIN whatsapp_chat_membership m ON m.chat_id = b.id WHERE b.id = $1 AND m.account_id = $2",
        binding.id,
        alice.account_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    // WhatsApp stamps whole seconds, so a message sent in the adoption second
    // carries a time earlier than the microsecond adoption time.
    let whole_second = chrono::DateTime::from_timestamp(adopted_at.timestamp(), 0).unwrap();
    for (event, offset, source, expected) in [
        (1, 0, "3EB0SAME", IngestOutcome::Applied),
        (2, 5, "3EB0EARLY", IngestOutcome::Applied),
        (3, 30, "3EB0BEFORE", IngestOutcome::NotObserved),
    ] {
        let mut message = text(event, CUSTOMER_JID, source, "hi");
        message.source_at = whole_second - Duration::seconds(offset);
        assert_eq!(
            session.ingest_event(alice, &message).await.unwrap(),
            expected,
            "{source}"
        );
    }
}

#[async_trait]
impl SendRateLimiter for Allow {
    async fn check(
        &self,
        _: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> ExternalChatResult<()> {
        Ok(())
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rate_limited_send_never_creates_a_dispatchable_intent(pool: PgPool) {
    struct Denied;

    #[async_trait]
    impl SendRateLimiter for Denied {
        async fn check(
            &self,
            _: &macro_user_id::user_id::MacroUserIdStr<'_>,
        ) -> ExternalChatResult<()> {
            Err(ExternalChatError::RateLimited.into())
        }
    }

    let (linked, session, repository, binding, alice, _) = adopted(&pool).await;
    let chats = ExternalChatService::new(
        Arc::new(WhatsAppProvider::new(repository)),
        linked.store,
        Arc::new(Denied),
    );
    let request = SendReply {
        idempotency_key: Uuid::now_v7(),
        message: ReplyContent::Text {
            text: "Rate limited".into(),
            mentions: vec![],
        },
        reply_to: None,
    };
    let error = chats
        .send_reply(
            &receipt::<MessageWrite>(ALICE, binding.id),
            &request,
            SendAuthority::UserApiToken,
        )
        .await
        .unwrap_err();
    assert_eq!(error.current_context(), &ExternalChatError::RateLimited);
    assert!(session.claim_sends(alice, 8).await.unwrap().is_empty());
}

mod chats;
mod communities;
mod direct;
mod lookups;
