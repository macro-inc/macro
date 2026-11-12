use super::*;
use crate::domain::{
    ports::{LoginRepository, LoginStart, SessionRepository},
    provider::SlackProvider,
    service::SlackService,
    session::SessionService,
};
use crate::outbound::kms::{SecretPurpose, SlackLoginInputSealer, open, seal};
use external_chat::domain::ports::ChatProvider;
use kms_envelope::kms::FakeKms;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::sync::Arc;

const ALICE: &str = "macro|alice@example.com";
const OWN_TEAM: &str = "T0OWNTEAM1";
const PARTNER_TEAM: &str = "T0PARTNER1";
const CHANNEL: &str = "C0SHARED12";
const ALICE_SLACK: &str = "U0ALICE123";
const PARTNER_SLACK: &str = "U0PARTNER1";

fn person(user: &str) -> macro_user_id::user_id::MacroUserIdStr<'static> {
    user.to_owned().try_into().expect("test user ids are valid")
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

/// A pasted session signs in, the replica reads the catalogue, the owner
/// adds a Slack Connect channel, and a partner's message, a thread reply, an
/// edit, a reaction and the owner's read in Slack land in the chat.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_pasted_session_adds_a_slack_connect_channel_and_ingests_its_traffic(pool: PgPool) {
    user(&pool, ALICE).await;
    let alice = person(ALICE);
    let repository = Arc::new(PgSlackRepository::new(pool.clone()));
    let kms = FakeKms::new("slack-key");
    let service = SlackService::new(
        repository.clone(),
        Arc::new(SlackLoginInputSealer::new(FakeKms::new("slack-key"))),
    );
    let provider = SlackProvider::new(repository.clone());
    let session = SessionService::new(repository.clone());

    // DSS records the pasted session sealed; the replica claims it.
    let attempt = Uuid::now_v7();
    let pasted = seal(
        &kms,
        SecretPurpose::SlackLoginInput,
        ALICE,
        attempt,
        br#"{"cookie":"d"}"#,
    )
    .await
    .unwrap();
    let login = repository
        .begin_login(
            &alice,
            LoginStart::Session {
                attempt,
                source: SessionSource::Manual,
                sealed: crate::domain::ports::SealedBlob {
                    ciphertext: pasted.ciphertext,
                    data_key: pasted.data_key,
                    kms_key_id: pasted.kms_key_id,
                    encryption_version: pasted.encryption_version,
                },
            },
        )
        .await
        .unwrap();
    assert_eq!(login.step, LoginStep::Working);
    let work = session.claim_login(attempt).await.unwrap().unwrap();
    assert_eq!(
        *open(
            &kms,
            SecretPurpose::SlackLoginInput,
            ALICE,
            attempt,
            work.sealed_input.as_ref().unwrap()
        )
        .await
        .unwrap(),
        br#"{"cookie":"d"}"#
    );
    assert!(session.claim_login(attempt).await.unwrap().is_none());

    let account_id = session.account_id_for(ALICE, OWN_TEAM).await.unwrap();
    let credentials = seal(
        &kms,
        SecretPurpose::SlackSession,
        ALICE,
        account_id,
        b"{\"token\":\"xoxc-1\"}",
    )
    .await
    .unwrap();
    session
        .advance_login(
            attempt,
            &LoginAdvance::Done {
                workspaces: vec![SignedInWorkspace {
                    account_id,
                    team_id: OWN_TEAM.to_owned(),
                    enterprise_id: None,
                    team_name: "Own".to_owned(),
                    team_domain: "own".to_owned(),
                    team_icon_url: None,
                    slack_user_id: ALICE_SLACK.to_owned(),
                    credentials: credentials.clone(),
                }],
                skipped: vec![],
            },
        )
        .await
        .unwrap();
    let done = service
        .login(&alice, attempt, SendAuthority::Human)
        .await
        .unwrap();
    let LoginStep::Done { accounts, skipped } = done.step else {
        panic!("signed in: {:?}", done.step);
    };
    assert_eq!(accounts.len(), 1);
    assert_eq!(accounts[0].id, account_id);
    assert_eq!(accounts[0].state, AccountState::Connecting);
    assert!(skipped.is_empty());

    // The replica takes the account, boots it and reads the catalogue.
    let lease = session.begin_lease(account_id).await.unwrap();
    assert_eq!(lease.credentials, Some(credentials));
    let scope = lease.scope;
    session
        .connected(
            scope,
            &BootFacts {
                slack_user_id: ALICE_SLACK.to_owned(),
                display_name: Some("Alice".to_owned()),
                team_name: "Own".to_owned(),
                team_domain: "own".to_owned(),
                team_icon_url: None,
                enterprise_id: None,
            },
        )
        .await
        .unwrap();
    session
        .replace_catalogue(
            scope,
            &Catalogue {
                conversations: vec![CatalogueConversation {
                    conversation_id: CHANNEL.to_owned(),
                    kind: ExternalChatKind::Group,
                    name: "launch".to_owned(),
                    topic: Some("Launch plans".to_owned()),
                    is_private: false,
                    is_archived: false,
                    is_member: true,
                    frozen_reason: None,
                    connected_team_ids: vec![PARTNER_TEAM.to_owned()],
                    direct_user_id: None,
                    last_activity_at: None,
                    unread_count: 2,
                    last_read_ts: None,
                }],
                teams: vec![Team {
                    team_id: PARTNER_TEAM.to_owned(),
                    name: "Partner Inc".to_owned(),
                    domain: Some("partner".to_owned()),
                    icon_url: None,
                }],
                users: vec![UserFacts {
                    slack_user_id: PARTNER_SLACK.to_owned(),
                    team_id: Some(PARTNER_TEAM.to_owned()),
                    display_name: Some("Ben".to_owned()),
                    real_name: Some("Ben Partner".to_owned()),
                    avatar_url: None,
                    is_bot: false,
                    deleted: false,
                }],
            },
        )
        .await
        .unwrap();

    let catalogue = service.conversations(&alice).await.unwrap();
    assert_eq!(catalogue.conversations.len(), 1);
    let listed = &catalogue.conversations[0];
    assert_eq!(listed.name, "#launch");
    assert_eq!(listed.connected_teams[0].name, "Partner Inc");
    assert_eq!(listed.accounts, vec![account_id]);
    assert!(listed.can_add);

    // The owner adds it; history import starts at once.
    let chat = provider
        .adopt(
            &alice,
            &AddChat {
                provider: ExternalChatProvider::Slack,
                remote_id: CHANNEL.to_owned(),
                kind: ExternalChatKind::Group,
            },
        )
        .await
        .unwrap();
    assert_eq!(session.history_work(scope).await.unwrap().len(), 1);
    assert_eq!(
        provider
            .sending_facts(
                &provider.account(&alice).await.unwrap().unwrap(),
                &[chat.clone()]
            )
            .await
            .unwrap()[0]
            .can_post,
        true
    );

    let partner = Sender::User {
        slack_user_id: PARTNER_SLACK.to_owned(),
        team_id: Some(PARTNER_TEAM.to_owned()),
        display_name: Some("Ben".to_owned()),
    };
    let message = |ts: &str, body: &str, thread_ts: Option<&str>| InboundMessage {
        ts: ts.to_owned(),
        sent_at: crate::domain::session::ts_time(ts),
        sender: partner.clone(),
        body: body.to_owned(),
        mentions: vec![],
        thread_ts: thread_ts.map(str::to_owned),
        broadcast: false,
        system: false,
        files: vec![],
        edited_ts: None,
        client_msg_id: None,
    };
    for change in [
        InboundChange::Message {
            conversation_id: CHANNEL.to_owned(),
            message: message("1700000000.000100", "hello from Partner", None),
            origin: IngestOrigin::Live,
        },
        InboundChange::Message {
            conversation_id: CHANNEL.to_owned(),
            message: message("1700000100.000200", "a reply", Some("1700000000.000100")),
            origin: IngestOrigin::Live,
        },
        InboundChange::Edited {
            conversation_id: CHANNEL.to_owned(),
            message: InboundMessage {
                edited_ts: Some("1700000200.000000".to_owned()),
                ..message("1700000000.000100", "hello from Partner Inc", None)
            },
        },
        InboundChange::Reaction {
            conversation_id: CHANNEL.to_owned(),
            ts: "1700000000.000100".to_owned(),
            slack_user_id: ALICE_SLACK.to_owned(),
            name: "tada".to_owned(),
            added: true,
            event_ts: "1700000300.000000".to_owned(),
        },
        InboundChange::Marked {
            conversation_id: CHANNEL.to_owned(),
            thread_ts: None,
            ts: "1700000000.000100".to_owned(),
        },
        // Not added: never stored.
        InboundChange::Message {
            conversation_id: "C0OTHER123".to_owned(),
            message: message("1700000400.000000", "elsewhere", None),
            origin: IngestOrigin::Live,
        },
    ] {
        session.enqueue_inbound(scope, &change).await.unwrap();
    }
    assert_eq!(session.ingest_queued(scope).await.unwrap(), 5);

    let rows = sqlx::query!(
        r#"SELECT m.source_id, m.body, m.origin, m.content_revision > 0 AS "edited!",
            r.source_id AS "thread_root?", p.display_name
        FROM external_chat_message m
        JOIN external_chat_person p ON p.id = m.person_id
        LEFT JOIN external_chat_message r ON r.id = m.thread_root
        WHERE m.chat_id = $1 ORDER BY m.source_at"#,
        chat.id
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].source_id, "1700000000.000100");
    assert_eq!(rows[0].body, "hello from Partner Inc");
    assert!(rows[0].edited);
    assert_eq!(rows[0].origin, "remote");
    assert_eq!(rows[0].display_name.as_deref(), Some("Ben"));
    assert_eq!(rows[1].thread_root.as_deref(), Some("1700000000.000100"));
    let reaction = sqlx::query_scalar!(
        "SELECT emoji FROM external_chat_reaction r JOIN external_chat_message m ON m.id = r.message_id WHERE m.chat_id = $1",
        chat.id
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(reaction, vec!["tada".to_owned()]);
    let read = sqlx::query_scalar!(
        "SELECT m.source_id FROM external_chat_read_state s JOIN external_chat_message m ON m.id = s.message_id WHERE s.chat_id = $1 AND s.user_id = $2",
        chat.id,
        ALICE
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(read, "1700000000.000100");
    assert!(
        sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM slack_inbound"#)
            .fetch_one(&pool)
            .await
            .unwrap()
            == 0
    );

    // Slack ends the session: logged out, credentials wiped, chat kept.
    session
        .session_ended(scope, EndedReason::Revoked)
        .await
        .unwrap();
    let account = &service.accounts(&alice).await.unwrap().accounts[0];
    assert_eq!(account.state, AccountState::LoggedOut);
    assert_eq!(account.ended_reason, Some(EndedReason::Revoked));
    assert_eq!(account.authorization_generation, 2);
    assert!(
        repository
            .begin_lease(account_id)
            .await
            .unwrap()
            .credentials
            .is_none()
    );
}
