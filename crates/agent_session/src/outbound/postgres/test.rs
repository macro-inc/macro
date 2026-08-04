use super::*;
use agent_client_protocol::RawJsonRpcMessage;
use agent_runtime_protocol::domain::schema::v0::AcpMessage;
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

fn new_session(bot_id: BotId, thread_id: Uuid) -> AgentSession {
    let now = Utc::now();
    AgentSession {
        id: AgentSessionId::new(),
        created_from_thread_id: None,
        thread_id,
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
    AgentSessionRepo::create(repo, session)
        .await
        .expect("create agent session");
    id
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
    let thread_id = macro_uuid::generate_uuid_v7();

    let id = create_session(&repo, new_session(bot_id, thread_id)).await;

    let session = repo.get(id).await.expect("get agent session");
    assert_eq!(session.id, id);
    assert_eq!(session.bot_id, bot_id);
    assert_eq!(session.thread_id, thread_id);
    assert!(matches!(session.status, SessionStatus::NoMessages));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_persists_event_status(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let thread_id = macro_uuid::generate_uuid_v7();
    let id = create_session(&repo, new_session(bot_id, thread_id)).await;

    let mut session = repo.get(id).await.expect("get agent session");
    session.status = SessionStatus::Event(SystemEvent::AcpReady);
    session.acp_session_id = Some("acp-session-1".to_string());
    repo.update(session).await.expect("update agent session");

    let updated = repo.get(id).await.expect("get updated agent session");
    assert_eq!(updated.acp_session_id.as_deref(), Some("acp-session-1"));
    assert!(matches!(
        updated.status,
        SessionStatus::Event(SystemEvent::AcpReady)
    ));
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
    let thread_id = macro_uuid::generate_uuid_v7();
    let id = create_session(&repo, new_session(bot_id, thread_id)).await;

    repo.delete(id).await.expect("delete agent session");

    assert!(repo.get(id).await.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn log_create_and_list_by_session_orders_chronologically(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let thread_id = macro_uuid::generate_uuid_v7();
    let session_id = create_session(&repo, new_session(bot_id, thread_id)).await;

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
async fn find_all_for_thread_distinguishes_both_thread_columns(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_a = create_test_bot(&pool).await;
    let bot_b = create_test_bot(&pool).await;
    let thread = macro_uuid::generate_uuid_v7();

    // bot_a's session lives in `thread` (its dedicated thread).
    let session_a = create_session(&repo, new_session(bot_a, thread)).await;

    // bot_b's session was created *from* `thread` but lives elsewhere.
    let mut from_thread = new_session(bot_b, macro_uuid::generate_uuid_v7());
    from_thread.created_from_thread_id = Some(thread);
    let session_b = create_session(&repo, from_thread).await;

    // Unrelated session in some other thread never appears.
    create_session(&repo, new_session(bot_a, macro_uuid::generate_uuid_v7())).await;

    let mut found = repo
        .find_all_for_thread(thread)
        .await
        .expect("find sessions for thread");
    found.sort_by_key(|(bot, _)| *bot != bot_a);

    assert_eq!(found.len(), 2);
    let (found_bot_a, in_thread) = &found[0];
    assert_eq!(*found_bot_a, bot_a);
    let ThreadSession::InSessionThread(session) = in_thread else {
        panic!("expected the dedicated-thread session, got {in_thread:?}");
    };
    assert_eq!(session.id, session_a);

    let (found_bot_b, from_this_thread) = &found[1];
    assert_eq!(*found_bot_b, bot_b);
    let ThreadSession::CreatedFromThisThread(session) = from_this_thread else {
        panic!("expected the created-from session, got {from_this_thread:?}");
    };
    assert_eq!(session.id, session_b);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn find_all_for_thread_returns_nothing_for_unknown_thread(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    create_session(&repo, new_session(bot, macro_uuid::generate_uuid_v7())).await;

    let found = repo
        .find_all_for_thread(macro_uuid::generate_uuid_v7())
        .await
        .expect("find sessions for unknown thread");
    assert!(found.is_empty());
}
