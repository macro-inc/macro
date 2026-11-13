use std::sync::Arc;
use std::time::Duration;

use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    RequiredPermission, ViewAccessLevel,
};
use external_chat::domain::models::{
    AddChat, ExternalChatKind, ExternalChatProvider, Mutation, ReplyContent, SendAuthority,
    SendReply,
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
    let stored = sqlx::query_scalar!(
        "SELECT r.emoji FROM external_chat_reaction r JOIN external_chat_message m ON m.id = r.message_id WHERE m.chat_id = $1",
        chat.id
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        stored,
        vec!["\u{1f389}".to_owned()],
        "Slack's :tada: is stored as its emoji"
    );
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

    // The owner reacts from Macro, then takes the reaction back.
    for operation in [Mutation::Reaction, Mutation::RemoveReaction] {
        chats
            .send_reply(
                &receipt::<ViewAccessLevel>(chat.id),
                &SendReply {
                    idempotency_key: Uuid::now_v7(),
                    message: ReplyContent::Mutation {
                        message_id: root_id,
                        operation,
                        text: Some("\u{1f680}".to_owned()),
                    },
                    reply_to: None,
                    thread: None,
                },
                SendAuthority::Human,
            )
            .await
            .unwrap();
        let method = match operation {
            Mutation::RemoveReaction => "reactions.remove",
            _ => "reactions.add",
        };
        assert!(
            slack.wait_for_calls(method, 1, WAIT).await,
            "{method} reaches Slack"
        );
        assert_eq!(
            slack.calls_of(method)[0]
                .fields
                .get("name")
                .map(String::as_str),
            Some("rocket"),
            "Slack gets the name of Macro's emoji"
        );
        if operation == Mutation::Reaction {
            let owner = wait_for_rows(&pool, WAIT, || async {
                sqlx::query_scalar!(
                    "SELECT user_id FROM external_chat_reaction WHERE message_id = $1 AND emoji = $2",
                    root_id,
                    "\u{1f680}"
                )
                .fetch_optional(&pool)
                .await
                .unwrap()
            })
            .await
            .flatten();
            assert_eq!(
                owner.as_deref(),
                Some(ALICE),
                "the reaction is the owner's own"
            );
        }
    }
    let mine = wait_for_rows(&pool, WAIT, || async {
        let pending = sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM slack_send WHERE chat_id = $1 AND state <> 'accepted'"#,
            chat.id
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        (pending == 0).then_some(())
    })
    .await;
    assert!(mine.is_some(), "both reaction sends are accepted");
    let rockets = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM external_chat_reaction WHERE message_id = $1 AND emoji = $2"#,
        root_id,
        "\u{1f680}"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rockets, 0);

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

    // The owner sends a file from Macro: it is uploaded and shared in the
    // channel, and the echo converges on the same message.
    let png = b"\x89PNG\r\n\x1a\nmacro".to_vec();
    let staged = chats
        .upload_attachment(
            &receipt::<ViewAccessLevel>(chat.id),
            "chart.png",
            "image/png",
            &png,
            SendAuthority::Human,
        )
        .await
        .unwrap();
    chats
        .send_reply(
            &receipt::<ViewAccessLevel>(chat.id),
            &SendReply {
                idempotency_key: Uuid::now_v7(),
                message: ReplyContent::Media {
                    upload_id: staged.upload_id,
                    caption: Some("the chart".to_owned()),
                },
                reply_to: None,
                thread: None,
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let file_message = wait_for_rows(&pool, WAIT, || async {
        sqlx::query!(
            r#"SELECT m.origin, m.body, a.state FROM slack_send s
            JOIN external_chat_message m ON m.id = s.message_id
            JOIN external_chat_attachment a ON a.chat_id = m.chat_id AND a.source_id = m.source_id
            WHERE s.chat_id = $1 AND s.payload->'message'->>'type' = 'media' AND s.state = 'accepted'"#,
            chat.id
        )
        .fetch_optional(&pool)
        .await
        .unwrap()
    })
    .await;
    let Some(file_message) = file_message else {
        let sends = sqlx::query!("SELECT state, error_code, payload->'message'->>'type' AS kind FROM slack_send WHERE chat_id = $1", chat.id)
            .fetch_all(&pool)
            .await
            .unwrap();
        let sends: Vec<_> = sends
            .iter()
            .map(|row| (row.state.clone(), row.error_code.clone(), row.kind.clone()))
            .collect();
        panic!("the file send is accepted with its attachment: {sends:?}");
    };
    assert_eq!(file_message.origin, "macro");
    assert_eq!(file_message.body, "the chart");
    assert_eq!(file_message.state, "downloaded");
    assert_eq!(slack.calls_of("files.completeUploadExternal").len(), 1);
    let shared = slack.calls_of("files.share");
    assert_eq!(shared.len(), 1);
    assert_eq!(
        shared[0].fields.get("channel").map(String::as_str),
        Some(CHANNEL)
    );
    let rows_for_file = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM external_chat_message WHERE chat_id = $1 AND body = 'the chart'"#,
        chat.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rows_for_file, 1);

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

    // The owner disconnects without signing out of Slack, then signs in
    // again: the running session closes and the account reconnects.
    let account = service.accounts(&alice).await.unwrap().accounts[0].clone();
    service
        .disconnect(
            &alice,
            account.id,
            account.authorization_generation,
            false,
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let sockets = slack.socket_connections();
    let again = service
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
    wait_for_rows(&pool, WAIT, || async {
        let login = service
            .login(&alice, again.id, SendAuthority::Human)
            .await
            .unwrap();
        matches!(login.step, LoginStep::Done { .. }).then_some(())
    })
    .await
    .expect("signing in again finishes");
    assert!(
        slack.wait_for_socket_connections(sockets + 1, WAIT).await,
        "the account reconnects with the new session"
    );
    wait_for_rows(&pool, WAIT, || async {
        sqlx::query_scalar!("SELECT state FROM slack_account WHERE user_id = $1", ALICE)
            .fetch_one(&pool)
            .await
            .ok()
            .filter(|state| state == "connected")
    })
    .await
    .expect("the account is connected again");
    assert!(slack.calls_of("auth.signout").is_empty());
    // The chat no account observes is offered again; adding it resumes the
    // same chat.
    let offered = wait_for_rows(&pool, WAIT, || async {
        service.conversations(&alice).await.ok().and_then(|list| {
            list.conversations
                .into_iter()
                .find(|c| c.remote_id == CHANNEL && c.can_add)
        })
    })
    .await
    .expect("the channel can be added again");
    assert!(offered.added.is_none());
    // Slack got a message no socket saw; resuming the chat brings it in.
    slack.receive_message_offline(
        CHANNEL,
        json!({"type": "message", "user": PARTNER_SLACK, "user_team": PARTNER_TEAM, "text": "while you were away"}),
    );
    let resumed = chats
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
    assert_eq!(resumed.id, chat.id);
    let listed = service.conversations(&alice).await.unwrap();
    let listed = listed
        .conversations
        .iter()
        .find(|c| c.remote_id == CHANNEL)
        .unwrap();
    assert_eq!(listed.added.as_ref().map(|added| added.id), Some(chat.id));
    wait_for_rows(&pool, WAIT, || async {
        sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM external_chat_message WHERE chat_id = $1 AND body = 'while you were away'"#,
            chat.id
        )
        .fetch_one(&pool)
        .await
        .ok()
        .filter(|count| *count == 1)
    })
    .await
    .expect("the message Slack got meanwhile arrives once");

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

/// Email sign-in through a real replica: the code step, then the workspace
/// list with icons, SSO workspaces and the ones already connected, then
/// signing in to the chosen workspaces (SSO ones are skipped).
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_email_sign_in_lists_workspaces_and_signs_in_to_the_chosen_ones(pool: PgPool) {
    use slack_fake_server::{LoginAccount, LoginMagic, LoginWorkspace};
    use slack_linked::domain::models::{LoginInput, LoginStepName, WorkspaceSignIn};
    watch_tables(&pool).await;
    user(&pool, ALICE).await;
    let alice: macro_user_id::user_id::MacroUserIdStr<'static> =
        ALICE.to_owned().try_into().unwrap();
    let slack = FakeSlack::start().await.unwrap();
    fake_slack(&slack);
    let workspace = |team_id: &str, name: &str, sso_required: bool| LoginWorkspace {
        team_id: team_id.to_owned(),
        name: name.to_owned(),
        domain: name.to_lowercase(),
        token: TOKEN.to_owned(),
        cookie: COOKIE.to_owned(),
        magic: LoginMagic::Code,
        sso_required,
        two_factor_pin: None,
    };
    slack.add_login_account(LoginAccount {
        email: "alice@example.com".to_owned(),
        code: "ABC123".to_owned(),
        captcha: None,
        workspaces: vec![
            workspace(OWN_TEAM, "Own", false),
            workspace("T0SSOTEAM1", "Sso", true),
        ],
    });
    let kms = Arc::new(FakeKms::new("e2e-slack-key"));
    let repository = Arc::new(PgSlackRepository::new(pool.clone()));
    let service = SlackService::new(
        repository,
        Arc::new(SlackLoginInputSealer::new(kms.clone())),
    );
    let _replica = Replica::start(&pool.connect_options(), &slack, kms).await;
    let step_after = |id: Uuid, name: LoginStepName| {
        let service = &service;
        let alice = &alice;
        async move {
            let login = service
                .login(alice, id, SendAuthority::Human)
                .await
                .unwrap();
            (login.step.name() == name).then_some(login.step)
        }
    };

    // A first sign-in (pasted) connects the own workspace.
    let pasted = service
        .submit_session(
            &alice,
            &SessionSubmission {
                source: SessionSource::Desktop,
                cookie: COOKIE.to_owned(),
                cookie_ds: None,
                tokens: vec![SessionTokenInput {
                    token: TOKEN.to_owned(),
                    team_id: None,
                }],
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    wait_for_rows(&pool, WAIT, || step_after(pasted.id, LoginStepName::Done))
        .await
        .expect("the pasted session signs in");

    let login = service
        .start_email_login(&alice, "alice@example.com", SendAuthority::Human)
        .await
        .unwrap();
    wait_for_rows(&pool, WAIT, || {
        step_after(login.id, LoginStepName::EmailCode)
    })
    .await
    .expect("Slack emails a code");
    service
        .submit_login_input(
            &alice,
            login.id,
            LoginStepName::EmailCode,
            LoginInput::Code {
                code: "abc-123".to_owned(),
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let LoginStep::PickWorkspaces { workspaces } = wait_for_rows(&pool, WAIT, || {
        step_after(login.id, LoginStepName::PickWorkspaces)
    })
    .await
    .expect("the workspaces are listed") else {
        unreachable!("waited for the workspace list");
    };
    let listed: Vec<(&str, WorkspaceSignIn, bool, bool)> = workspaces
        .iter()
        .map(|workspace| {
            (
                workspace.team_id.as_str(),
                workspace.sign_in,
                workspace.already_connected,
                workspace.icon_url.is_some(),
            )
        })
        .collect();
    assert_eq!(
        listed,
        vec![
            (OWN_TEAM, WorkspaceSignIn::Ready, true, true),
            ("T0SSOTEAM1", WorkspaceSignIn::Sso, false, true),
        ]
    );

    service
        .submit_login_input(
            &alice,
            login.id,
            LoginStepName::PickWorkspaces,
            LoginInput::Workspaces {
                team_ids: vec![OWN_TEAM.to_owned(), "T0SSOTEAM1".to_owned()],
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let LoginStep::Done { accounts, skipped } =
        wait_for_rows(&pool, WAIT, || step_after(login.id, LoginStepName::Done))
            .await
            .expect("the chosen workspaces sign in")
    else {
        unreachable!("waited for done");
    };
    assert_eq!(accounts.len(), 1);
    assert_eq!(accounts[0].team_id, OWN_TEAM);
    assert_eq!(skipped.len(), 1);
    assert_eq!(skipped[0].team_id, "T0SSOTEAM1");
}
