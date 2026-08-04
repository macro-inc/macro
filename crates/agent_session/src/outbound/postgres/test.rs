use super::*;
use agent_client_protocol::RawJsonRpcMessage;
use agent_runtime_protocol::domain::schema::v0::{AcpMessage, SystemEvent};
use bots::domain::models::{BotOwner, CreateBotRequest};
use bots::domain::ports::BotRepo;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid macro user id")
}

async fn create_test_bot(pool: &PgPool) -> BotId {
    let owner = user_id("macro|agent-session-test-bot-owner@example.com");
    let bot = PgBotsRepo::new(pool.clone())
        .create_owned_bot(
            BotOwner::User {
                user_id: owner.to_string(),
            },
            owner,
            CreateBotRequest {
                team_id: None,
                name: "Test Agent".to_string(),
                handle: format!("test-agent-{}", macro_uuid::generate_uuid_v7()),
                description: None,
                avatar_url: None,
            },
        )
        .await
        .expect("create test bot");
    bot.id
}

fn new_session(bot_id: BotId, thread_id: Option<Uuid>) -> AgentSession {
    let now = Utc::now();
    AgentSession {
        id: AgentSessionId::new(),
        channel_id: macro_uuid::generate_uuid_v7(),
        thread_id,
        originating_message_id: None,
        bot_id,
        model: "claude-sonnet-5".to_string(),
        harness: "claude-code".to_string(),
        repo_url: "https://github.com/example/example".to_string(),
        acp_session_id: None,
        status: SessionStatus::NoMessages,
        created_at: now,
        modified_at: now,
    }
}

/// Create `session`, returning the caller-minted id for convenience.
async fn create_session(repo: &PgAgentSessionRepo, session: AgentSession) -> AgentSessionId {
    let id = session.id;
    AgentSessionRepo::create(
        repo,
        user_id("macro|agent-session-channel-owner@example.com"),
        session,
    )
    .await
    .expect("create agent session");
    id
}

async fn insert_originating_thread_fixture(pool: &PgPool) -> (Uuid, Uuid, Uuid) {
    let channel_id = macro_uuid::generate_uuid_v7();
    let thread_id = macro_uuid::generate_uuid_v7();
    let originating_message_id = macro_uuid::generate_uuid_v7();
    let owner_id = "macro|agent-session-thread-owner@example.com";
    sqlx::query!(
        "INSERT INTO comms_channels (id, channel_type, owner_id) VALUES ($1, 'private', $2)",
        channel_id,
        owner_id,
    )
    .execute(pool)
    .await
    .expect("create originating channel");
    sqlx::query!(
        "INSERT INTO comms_messages (id, channel_id, sender_id, content) VALUES ($1, $2, $3, '')",
        thread_id,
        channel_id,
        owner_id,
    )
    .execute(pool)
    .await
    .expect("create originating thread");
    sqlx::query!(
        "INSERT INTO comms_messages (id, channel_id, thread_id, sender_id, content) VALUES ($1, $2, $3, $4, '')",
        originating_message_id,
        channel_id,
        thread_id,
        owner_id,
    )
    .execute(pool)
    .await
    .expect("create originating message");
    (channel_id, thread_id, originating_message_id)
}

fn acp_notification() -> AcpMessage {
    AcpMessage(
        RawJsonRpcMessage::notification("test/notify".to_string(), serde_json::json!({}))
            .expect("valid notification"),
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_and_get_round_trips(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let session = new_session(bot_id, None);
    let channel_id = session.channel_id;

    let id = create_session(&repo, session).await;

    let session = repo.get(id).await.expect("get agent session");
    assert_eq!(session.id, id);
    assert_eq!(session.bot_id, bot_id);
    assert_eq!(session.channel_id, channel_id);
    assert_eq!(session.thread_id, None);
    assert!(matches!(session.status, SessionStatus::NoMessages));

    let channel = sqlx::query!(
        "SELECT kind, owner_id FROM comms_channels WHERE id = $1",
        channel_id,
    )
    .fetch_one(&pool)
    .await
    .expect("get agent channel");
    assert_eq!(channel.kind, "agent");
    assert_eq!(
        channel.owner_id,
        "macro|agent-session-channel-owner@example.com"
    );
    let owner = sqlx::query!(
        r#"
        SELECT user_id, role::text AS "role!", left_at
        FROM comms_channel_participants
        WHERE channel_id = $1
        "#,
        channel_id,
    )
    .fetch_one(&pool)
    .await
    .expect("get agent channel owner participant");
    assert_eq!(
        owner.user_id,
        "macro|agent-session-channel-owner@example.com"
    );
    assert_eq!(owner.role, "owner");
    assert_eq!(owner.left_at, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_persists_event_status(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let id = create_session(&repo, new_session(bot_id, None)).await;

    let mut session = repo.get(id).await.expect("get agent session");
    session.status = SessionStatus::Event(SystemEvent::AcpReady);
    session.acp_session_id = Some("acp-session-1".to_string());
    repo.update(session).await.expect("update agent session");

    let mut updated = repo.get(id).await.expect("get updated agent session");
    assert_eq!(updated.acp_session_id.as_deref(), Some("acp-session-1"));
    assert!(matches!(
        updated.status,
        SessionStatus::Event(SystemEvent::AcpReady)
    ));

    updated.status = SessionStatus::Disconnected;
    repo.update(updated)
        .await
        .expect("disconnect agent session");
    let disconnected = repo.get(id).await.expect("get disconnected session");
    assert!(matches!(disconnected.status, SessionStatus::Disconnected));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_missing_session_errors(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool);
    let missing = AgentSessionId::new();

    assert!(repo.get(missing).await.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_removes_session(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let session = new_session(bot_id, None);
    let channel_id = session.channel_id;
    let id = create_session(&repo, session).await;

    repo.delete(id).await.expect("delete agent session");

    assert!(repo.get(id).await.is_err());
    let channel_exists = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM comms_channels WHERE id = $1) AS \"exists!\"",
        channel_id,
    )
    .fetch_one(&pool)
    .await
    .expect("check deleted agent channel");
    assert!(!channel_exists);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn log_create_and_list_by_session_orders_chronologically(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let session_id = create_session(&repo, new_session(bot_id, None)).await;

    let user = user_id("macro|agent-session-log-test@example.com");

    AgentSessionLogRepo::create(
        &repo,
        AgentSessionLog {
            agent_session_id: session_id,
            user_id: Some(user.clone()),
            content: Message::ToServer(ToServerMessage::Event {
                event: SystemEvent::AcpReady,
            }),
        },
    )
    .await
    .expect("create first log entry");

    AgentSessionLogRepo::create(
        &repo,
        AgentSessionLog {
            agent_session_id: session_id,
            user_id: None,
            content: Message::ToRuntime(ToRuntimeMessage::Acp(acp_notification())),
        },
    )
    .await
    .expect("create second log entry");

    let logs = repo
        .list_by_session(session_id)
        .await
        .expect("list agent session log entries");

    assert_eq!(logs.len(), 2);
    assert_eq!(logs[0].agent_session_id, session_id);
    assert_eq!(logs[0].user_id, Some(user));
    assert!(matches!(
        logs[0].content,
        Message::ToServer(ToServerMessage::Event {
            event: SystemEvent::AcpReady
        })
    ));
    assert_eq!(logs[1].user_id, None);
    assert!(matches!(
        logs[1].content,
        Message::ToRuntime(ToRuntimeMessage::Acp(_))
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn find_for_channel_distinguishes_dedicated_channel_and_originating_thread(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_a = create_test_bot(&pool).await;
    let bot_b = create_test_bot(&pool).await;
    let (originating_channel, thread, originating_message) =
        insert_originating_thread_fixture(&pool).await;

    let dedicated = new_session(bot_a, None);
    let dedicated_channel = dedicated.channel_id;
    let session_a = create_session(&repo, dedicated).await;

    let mut originating = new_session(bot_b, Some(thread));
    originating.originating_message_id = Some(originating_message);
    let session_b = create_session(&repo, originating).await;

    create_session(&repo, new_session(bot_a, None)).await;

    let found_dedicated = repo
        .find_for_channel(dedicated_channel, None, None)
        .await
        .expect("find session by dedicated channel");
    let ChannelSession::InSessionChannel(session) = found_dedicated else {
        panic!("expected the dedicated-channel session, got {found_dedicated:?}");
    };
    assert_eq!(session.id, session_a);

    let found_originating = repo
        .find_for_channel(originating_channel, Some(thread), Some(bot_b))
        .await
        .expect("find bot B's session by originating thread");
    let ChannelSession::CreatedFromThread(session) = found_originating else {
        panic!("expected the originating-thread session, got {found_originating:?}");
    };
    assert_eq!(session.id, session_b);
    assert_eq!(session.originating_message_id, Some(originating_message));

    let found_with_unrelated_channel = repo
        .find_for_channel(macro_uuid::generate_uuid_v7(), Some(thread), Some(bot_b))
        .await
        .expect("find originating session without channel validation");
    assert!(matches!(
        found_with_unrelated_channel,
        ChannelSession::CreatedFromThread(_)
    ));

    let wrong_bot = repo
        .find_for_channel(originating_channel, Some(thread), Some(bot_a))
        .await
        .expect("look up the wrong bot");
    assert!(matches!(wrong_bot, ChannelSession::None));

    let dedicated_wins = repo
        .find_for_channel(dedicated_channel, Some(thread), Some(bot_b))
        .await
        .expect("look up a dedicated channel with unrelated context");
    assert!(matches!(
        dedicated_wins,
        ChannelSession::InSessionChannel(_)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn find_for_channel_requires_thread_and_bot_for_originating_match(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    let (channel, thread, _) = insert_originating_thread_fixture(&pool).await;
    create_session(&repo, new_session(bot, Some(thread))).await;

    let without_bot = repo
        .find_for_channel(channel, Some(thread), None)
        .await
        .expect("look up without a bot");
    assert!(matches!(without_bot, ChannelSession::None));

    let without_thread = repo
        .find_for_channel(channel, None, Some(bot))
        .await
        .expect("look up without a thread");
    assert!(matches!(without_thread, ChannelSession::None));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_rolls_back_channel_when_session_insert_fails(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    let session = new_session(bot, Some(macro_uuid::generate_uuid_v7()));
    let channel_id = session.channel_id;

    let result = AgentSessionRepo::create(
        &repo,
        user_id("macro|agent-session-channel-owner@example.com"),
        session,
    )
    .await;
    assert!(result.is_err());

    let channel_exists = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM comms_channels WHERE id = $1) AS \"exists!\"",
        channel_id,
    )
    .fetch_one(&pool)
    .await
    .expect("check rolled-back channel");
    assert!(!channel_exists);
}
