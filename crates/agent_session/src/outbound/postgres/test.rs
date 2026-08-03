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

fn new_session(bot_id: BotId, thread_id: Uuid) -> AgentSession<UninitializedSession> {
    let now = Utc::now();
    AgentSession {
        id: UninitializedSession,
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

    let id = AgentSessionRepo::create(&repo, new_session(bot_id, thread_id))
        .await
        .expect("create agent session");

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
    let id = AgentSessionRepo::create(&repo, new_session(bot_id, thread_id))
        .await
        .expect("create agent session");

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
    let missing = AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7());

    assert!(repo.get(missing).await.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_removes_session(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let thread_id = macro_uuid::generate_uuid_v7();
    let id = AgentSessionRepo::create(&repo, new_session(bot_id, thread_id))
        .await
        .expect("create agent session");

    repo.delete(id).await.expect("delete agent session");

    assert!(repo.get(id).await.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn log_create_and_list_by_session_orders_chronologically(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let thread_id = macro_uuid::generate_uuid_v7();
    let session_id = AgentSessionRepo::create(&repo, new_session(bot_id, thread_id))
        .await
        .expect("create agent session");

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
