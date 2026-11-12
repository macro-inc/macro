use std::sync::Arc;
use std::time::Duration;

use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    RequiredPermission, ViewAccessLevel,
};
use external_chat::domain::models::{
    AddChat, ExternalChatKind, ExternalChatProvider, ReplyContent, SendAuthority, SendReply,
};
use external_chat::domain::ports::ExternalChatResult;
use external_chat::domain::ports::{ChatProviders, SendRateLimiter, UnconfiguredProvider};
use external_chat::domain::service::ExternalChatService;
use external_chat::outbound::pg::PgExternalChatRepository;
use kms_envelope::kms::FakeKms;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;
use slack_fake_server::FakeSlack;
use slack_linked::domain::models::{
    LoginStep, SessionSource, SessionSubmission, SessionTokenInput,
};
use slack_linked::domain::provider::SlackProvider;
use slack_linked::domain::service::SlackService;
use slack_linked::outbound::kms::SlackLoginInputSealer;
use slack_linked::outbound::pg::PgSlackRepository;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{Replica, wait_for_rows, watch_tables};

const ALICE: &str = "macro|alice@example.com";
const OWN_TEAM: &str = "T0OWNTEAM1";
const PARTNER_TEAM: &str = "T0PARTNER1";
const ALICE_SLACK: &str = "U0ALICE123";
const PARTNER_SLACK: &str = "U0PARTNER1";
const CHANNEL: &str = "C0SHARED12";
const TOKEN: &str = "xoxc-111-222-333-abcdef";
const COOKIE: &str = "xoxd-alice-cookie";
const WAIT: Duration = Duration::from_secs(20);

struct Allow;

#[async_trait::async_trait]
impl SendRateLimiter for Allow {
    async fn check(
        &self,
        _user: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> ExternalChatResult<()> {
        Ok(())
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

fn receipt<Permission: RequiredPermission>(chat: Uuid) -> EntityAccessReceipt<Permission> {
    EntityAccessReceipt::try_new(
        EntityAccessAuth::Authenticated(ALICE.to_owned().try_into().unwrap()),
        Entity {
            entity_id: chat.to_string(),
            entity_type: EntityType::ExternalChat,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    )
    .unwrap()
}

fn fake_slack(slack: &FakeSlack) {
    slack.add_team(json!({"id": OWN_TEAM, "name": "Own", "domain": "own"}));
    slack.add_team(json!({"id": PARTNER_TEAM, "name": "Partner Inc", "domain": "partner"}));
    slack.add_user(json!({
        "id": ALICE_SLACK, "team_id": OWN_TEAM, "name": "alice", "real_name": "Alice",
        "profile": {"display_name": "alice", "real_name": "Alice"}, "updated": 1_700_000_000,
    }));
    slack.add_user(json!({
        "id": PARTNER_SLACK, "team_id": PARTNER_TEAM, "name": "ben", "is_stranger": true,
        "profile": {"display_name": "Ben", "real_name": "Ben Partner", "team": PARTNER_TEAM},
        "updated": 1_700_000_000,
    }));
    slack.add_session(ALICE_SLACK, TOKEN, COOKIE);
    slack.add_conversation(
        json!({
            "id": CHANNEL, "name": "launch", "is_channel": true, "is_member": true,
            "is_ext_shared": true, "is_shared": true,
            "context_team_id": OWN_TEAM, "conversation_host_id": OWN_TEAM,
            "connected_team_ids": [PARTNER_TEAM], "shared_team_ids": [OWN_TEAM, PARTNER_TEAM],
            "topic": {"value": "Launch plans", "creator": "", "last_set": 0},
        }),
        &[ALICE_SLACK, PARTNER_SLACK],
    );
}

/// The whole flow through DSS's use cases and a real replica: a pasted
/// session signs in, the owner adds the Slack Connect channel, a partner's
/// message, thread reply, edit, reaction and delete arrive, the owner sends
/// and reads in both directions, and Slack revoking the session logs the
/// account out.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_slack_connect_channel_syncs_both_ways_until_slack_ends_the_session(pool: PgPool) {
    watch_tables(&pool).await;
    user(&pool, ALICE).await;
    let alice: macro_user_id::user_id::MacroUserIdStr<'static> =
        ALICE.to_owned().try_into().unwrap();
    let slack = FakeSlack::start().await.unwrap();
    fake_slack(&slack);
    let kms = Arc::new(FakeKms::new("e2e-slack-key"));
    let repository = Arc::new(PgSlackRepository::new(pool.clone()));
    let service = SlackService::new(
        repository.clone(),
        Arc::new(SlackLoginInputSealer::new(kms.clone())),
    );
    let chats = ExternalChatService::new(
        ChatProviders {
            whatsapp: Arc::new(UnconfiguredProvider),
            slack: Arc::new(SlackProvider::new(repository)),
        },
        Arc::new(PgExternalChatRepository::new(pool.clone())),
        Arc::new(Allow),
    );
    let _replica = Replica::start(&pool.connect_options(), &slack, kms).await;

    // Sign in with a pasted session; the replica checks it with Slack.
    let login = service
        .submit_session(
            &alice,
            &SessionSubmission {
                source: SessionSource::Manual,
                cookie: COOKIE.to_owned(),
                cookie_ds: None,
                tokens: vec![SessionTokenInput {
                    token: TOKEN.to_owned(),
                    team_id: Some(OWN_TEAM.to_owned()),
                }],
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let done = wait_for_rows(&pool, WAIT, || async {
        let login = service
            .login(&alice, login.id, SendAuthority::Human)
            .await
            .unwrap();
        matches!(login.step, LoginStep::Done { .. }).then_some(login)
    })
    .await
    .expect("the sign-in finishes");
    let LoginStep::Done { accounts, .. } = done.step else {
        unreachable!("waited for done");
    };
    assert_eq!(accounts[0].team_id, OWN_TEAM);

    // The replica boots the account and reads the Slack Connect catalogue.
    let conversation = wait_for_rows(&pool, WAIT, || async {
        service.conversations(&alice).await.ok().and_then(|list| {
            list.conversations
                .into_iter()
                .find(|c| c.remote_id == CHANNEL)
        })
    })
    .await
    .expect("the shared channel is listed");
    assert_eq!(conversation.name, "#launch");
    assert_eq!(conversation.connected_teams[0].name, "Partner Inc");
    assert!(conversation.can_add);

    let chat = chats
        .add(
            &alice,
            &AddChat {
                provider: ExternalChatProvider::Slack,
                remote_id: CHANNEL.to_owned(),
                kind: ExternalChatKind::Group,
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    wait_for_rows(&pool, WAIT, || async {
        sqlx::query_scalar!(
            "SELECT backfill_state FROM external_chat WHERE id = $1",
            chat.id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .filter(|state| state == "done")
    })
    .await
    .expect("the (empty) history import finishes");

    // A partner's message, a thread reply, an edit and a reaction arrive live.
    let root_ts = slack.receive_message(
        CHANNEL,
        json!({"type": "message", "user": PARTNER_SLACK, "user_team": PARTNER_TEAM, "text": "hello from Partner"}),
    );
    let reply_ts = slack.receive_message(
        CHANNEL,
        json!({"type": "message", "user": PARTNER_SLACK, "text": "a reply", "thread_ts": root_ts}),
    );
    slack.push_event(
        ALICE_SLACK,
        json!({
            "type": "message", "subtype": "message_changed", "channel": CHANNEL, "ts": "1700000500.000000",
            "message": {"type": "message", "user": PARTNER_SLACK, "text": "hello from Partner Inc",
                "ts": root_ts, "edited": {"user": PARTNER_SLACK, "ts": "1700000500.000000"}},
        }),
    );
    slack.push_event(
        ALICE_SLACK,
        json!({"type": "reaction_added", "user": PARTNER_SLACK, "reaction": "tada",
            "item": {"type": "message", "channel": CHANNEL, "ts": root_ts}, "event_ts": "1700000600.000000"}),
    );
    let (body, thread_root) = wait_for_rows(&pool, WAIT, || async {
        let rows = sqlx::query!(
            r#"SELECT m.source_id, m.body, r.source_id AS "root?" FROM external_chat_message m
            LEFT JOIN external_chat_message r ON r.id = m.thread_root
            WHERE m.chat_id = $1 ORDER BY m.source_at"#,
            chat.id
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let reactions = sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM external_chat_reaction r JOIN external_chat_message m ON m.id = r.message_id WHERE m.chat_id = $1"#,
            chat.id
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        (rows.len() == 2 && rows[0].body == "hello from Partner Inc" && reactions == 1)
            .then(|| (rows[0].body.clone(), rows[1].root.clone()))
    })
    .await
    .expect("the message, its edit, the thread reply and the reaction arrive");
    assert_eq!(body, "hello from Partner Inc");
    assert_eq!(thread_root.as_deref(), Some(root_ts.as_str()));
    assert_ne!(reply_ts, root_ts);

    // The owner replies in the thread from Macro.
    let root_id = sqlx::query_scalar!(
        "SELECT id FROM external_chat_message WHERE chat_id = $1 AND source_id = $2",
        chat.id,
        root_ts
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    chats
        .send_reply(
            &receipt::<ViewAccessLevel>(chat.id),
            &SendReply {
                idempotency_key: Uuid::now_v7(),
                message: ReplyContent::Text {
                    text: "hi from Macro".to_owned(),
                    mentions: vec![],
                },
                reply_to: None,
                thread: Some(root_id),
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    wait_for_rows(&pool, WAIT, || async {
        sqlx::query_scalar!("SELECT state FROM slack_send WHERE chat_id = $1", chat.id)
            .fetch_one(&pool)
            .await
            .ok()
            .filter(|state| state == "accepted")
    })
    .await
    .expect("the send is accepted");
    let posted = slack.calls_of("chat.postMessage");
    assert_eq!(posted.len(), 1);
    assert_eq!(
        posted[0].fields.get("text").map(String::as_str),
        Some("hi from Macro")
    );
    assert_eq!(posted[0].fields.get("thread_ts"), Some(&root_ts));

    // Reading in Macro marks Slack read; reading in Slack moves Macro's mark.
    chats
        .mark_read(&receipt::<ViewAccessLevel>(chat.id), root_id)
        .await
        .unwrap();
    assert!(slack.wait_for_calls("conversations.mark", 1, WAIT).await);
    slack.push_event(
        ALICE_SLACK,
        json!({"type": "channel_marked", "channel": CHANNEL, "ts": reply_ts}),
    );

    // A partner shares a file: the replica downloads it for import.
    let file = slack.add_file(
        json!({"id": "F0PLAN0001", "name": "plan.png", "mimetype": "image/png", "size": 8, "user": PARTNER_SLACK}),
        b"\x89PNG\r\n\x1a\n".to_vec(),
    );
    let file_ts = slack.receive_message(
        CHANNEL,
        json!({"type": "message", "subtype": "file_share", "user": PARTNER_SLACK, "text": "", "files": [file]}),
    );
    let blob = wait_for_rows(&pool, WAIT, || async {
        sqlx::query!(
            r#"SELECT a.state, b.bytes AS "bytes?" FROM external_chat_attachment a
            LEFT JOIN external_chat_media_blob b ON b.id = a.blob_id
            WHERE a.chat_id = $1 AND a.source_id = $2"#,
            chat.id,
            file_ts
        )
        .fetch_optional(&pool)
        .await
        .unwrap()
        .filter(|row| row.state == "downloaded")
    })
    .await
    .expect("the file is downloaded");
    assert_eq!(blob.bytes.as_deref(), Some(b"\x89PNG\r\n\x1a\n".as_slice()));

    // A partner deletes their message: it becomes a tombstone.
    slack.push_event(
        ALICE_SLACK,
        json!({"type": "message", "subtype": "message_deleted", "channel": CHANNEL,
            "ts": "1700000700.000000", "deleted_ts": root_ts}),
    );
    wait_for_rows(&pool, WAIT, || async {
        sqlx::query_scalar!(
            "SELECT deleted_at IS NOT NULL AS \"deleted!\" FROM external_chat_message WHERE id = $1",
            root_id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .then_some(())
    })
    .await
    .expect("the delete arrives");

    // Slack revokes the session: logged out, credentials wiped, chat kept.
    slack.end_session(TOKEN, "token_revoked");
    let state = wait_for_rows(&pool, WAIT, || async {
        sqlx::query!(
            "SELECT state, ended_reason, credentials IS NULL AS \"wiped!\" FROM slack_account WHERE user_id = $1",
            ALICE
        )
        .fetch_one(&pool)
        .await
        .ok()
        .filter(|row| row.state == "logged_out")
    })
    .await
    .expect("the account is logged out");
    assert_eq!(state.ended_reason.as_deref(), Some("revoked"));
    assert!(state.wiped);
    assert_eq!(service.ended_accounts(10).await.unwrap().len(), 1);
}
