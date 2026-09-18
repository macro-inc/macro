use super::*;
mod search;
use crate::domain::model::{AgentMcpServer, DEFAULT_AGENT_SESSION_NAME};
use crate::domain::ports::AgentSessionRepo;
use agent_client_protocol::RawJsonRpcMessage;
use agent_runtime_protocol::domain::schema::v0::{AcpMessage, SystemEvent};
use bots::domain::models::{BotOwner, CreateBotRequest};
use bots::domain::ports::BotRepo;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid macro user id")
}

/// The fixed owner every [`new_session`] fixture uses.
const OWNER: &str = "macro|agent-session-owner@example.com";

/// Insert a `"User"` row (and its `macro_user` parent) so the id can satisfy
/// `agent_session.owner_id`'s foreign key.
async fn insert_user(pool: &PgPool, user_id: &str) {
    let email = user_id.strip_prefix("macro|").unwrap_or(user_id);
    // The no-op update makes the existing row's id come back when the user
    // was already seeded by an earlier call.
    let macro_user_id = sqlx::query_scalar!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
        RETURNING id
        "#,
        macro_uuid::generate_uuid_v7(),
        email,
        email,
        format!("stripe_{email}"),
    )
    .fetch_one(pool)
    .await
    .expect("insert macro_user");
    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
        "#,
        user_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await
    .expect("insert User");
}

async fn create_test_bot(pool: &PgPool) -> BotId {
    // Every session fixture is owned by the same user, and
    // `agent_session.owner_id` references `"User"(id)` - so seed the
    // row here, where every session-creating test already passes through.
    insert_user(pool, OWNER).await;
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
                has_agent: None,
            },
        )
        .await
        .expect("create test bot");
    bot.id
}

fn new_session(
    bot_id: BotId,
    thread_id: Option<Uuid>,
    originating_message_id: Option<Uuid>,
) -> CreateAgentSessionParams {
    CreateAgentSessionParams {
        repo_branch: None,
        id: AgentSessionId::new(),
        owner_id: user_id(OWNER),
        bot_id,
        thread_id,
        originating_message_id,
        model: "claude-sonnet-5".to_string(),
        harness: "claude-code".to_string(),
        repo_url: Some("https://github.com/example/example".to_string()),
        workspace: "/workspace".to_string(),
        sandbox_size: SandboxSize::Default,
        instructions: None,
        mcp_servers: AgentMcpServers::OwnerConnections,
        egress_token_hash: None,
    }
}

async fn create_session(
    repo: &PgAgentSessionRepo,
    params: CreateAgentSessionParams,
) -> AgentSession {
    AgentSessionRepo::create(repo, params)
        .await
        .expect("create agent session")
}

/// Drive a session's status the way production does: append a system event to
/// the log and let [`AgentSessionLogRepo::create`] project it onto the session.
async fn append_system_event(
    repo: &PgAgentSessionRepo,
    agent_session_id: AgentSessionId,
    event: SystemEvent,
) {
    let _ = AgentSessionLogRepo::create(
        repo,
        AgentSessionLog {
            agent_session_id,
            user_id: None,
            content: Message::ToServer(ToServerMessage::Event { event }),
        },
    )
    .await
    .expect("append system event log entry");
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
        "INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, sender_id, content) VALUES ($1, 'channel', $2::uuid::text, $3, '')",
        thread_id,
        channel_id,
        owner_id,
    )
    .execute(pool)
    .await
    .expect("create originating thread");
    sqlx::query!(
        "INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, thread_id, sender_id, content) VALUES ($1, 'channel', $2::uuid::text, $3, $4, '')",
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

async fn fetch_session_entity(
    pool: &PgPool,
    id: AgentSessionId,
) -> (String, String, String, Option<DateTime<Utc>>, DateTime<Utc>) {
    let row = sqlx::query!(
        r#"
        SELECT
            entity_type,
            owner_type::text AS "owner_type!",
            owner_id,
            deleted_at,
            updated_at
        FROM entity
        WHERE id = $1
        "#,
        id.as_uuid(),
    )
    .fetch_one(pool)
    .await
    .expect("read the session's entity row");
    (
        row.entity_type,
        row.owner_type,
        row.owner_id,
        row.deleted_at,
        row.updated_at,
    )
}

async fn entity_row_count(pool: &PgPool, id: AgentSessionId) -> i64 {
    sqlx::query_scalar!(
        r#"
        SELECT count(*) AS "count!"
        FROM entity
        WHERE id = $1
        "#,
        id.as_uuid(),
    )
    .fetch_one(pool)
    .await
    .expect("count the session's entity row")
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
    let mut params = new_session(bot_id, None, None);
    params.repo_branch = Some(
        crate::domain::repository_branch::RepositoryBranch::parse("feature/home".into()).unwrap(),
    );
    let id = params.id;

    let created = create_session(&repo, params).await;

    let session = AgentSessionRepo::get(&repo, id)
        .await
        .expect("get agent session");
    assert_eq!(created.id, id);
    assert_eq!(created.created_at, session.created_at);
    assert_eq!(created.modified_at, session.modified_at);
    assert_eq!(session.id, id);
    assert_eq!(
        session.repo_branch.as_ref().map(|branch| branch.as_str()),
        Some("feature/home")
    );
    assert_eq!(session.name, DEFAULT_AGENT_SESSION_NAME);
    assert_eq!(session.bot_id, bot_id);
    assert_eq!(
        session.owner_id.to_string(),
        "macro|agent-session-owner@example.com"
    );
    assert_eq!(session.thread_id, None);
    assert_eq!(session.sandbox_size, SandboxSize::Default);
    assert_eq!(session.instructions, None);
    assert!(matches!(session.status, SessionStatus::NoMessages));
}

/// Instructions survive the round trip, and come back on every read path a
/// runtime uses to find its session - not just the one `create` returned.
///
/// The read paths matter more than the write here: what a session runs under
/// is resolved at attach, and attach reaches the row through `get`, so a
/// column the INSERT stores but a SELECT drops would look correct until the
/// first reconnect.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn instructions_round_trip_on_every_read_path(pool: PgPool) {
    const INSTRUCTIONS: &str = "Answer in one sentence.\nNever open a pull request.";

    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let (_channel_id, thread_id, originating_message_id) =
        insert_originating_thread_fixture(&pool).await;
    let params = CreateAgentSessionParams {
        instructions: Some(INSTRUCTIONS.to_owned()),
        egress_token_hash: Some("token-hash".to_owned()),
        ..new_session(bot_id, Some(thread_id), Some(originating_message_id))
    };
    let id = params.id;

    let created = create_session(&repo, params).await;
    assert_eq!(created.instructions.as_deref(), Some(INSTRUCTIONS));

    let fetched = AgentSessionRepo::get(&repo, id)
        .await
        .expect("get agent session");
    assert_eq!(fetched.instructions.as_deref(), Some(INSTRUCTIONS));

    let by_token = AgentSessionRepo::find_by_egress_token_hash(&repo, "token-hash")
        .await
        .expect("the token lookup should run")
        .expect("the token should resolve to the session");
    assert_eq!(by_token.instructions.as_deref(), Some(INSTRUCTIONS));

    let for_thread = AgentSessionRepo::find_all_for_thread(&repo, thread_id)
        .await
        .expect("the thread lookup should run");
    assert_eq!(
        for_thread
            .iter()
            .map(|session| session.instructions.as_deref())
            .collect::<Vec<_>>(),
        vec![Some(INSTRUCTIONS)]
    );
}

/// The MCP selection is a snapshot like `instructions`: whatever was chosen at
/// creation comes back identically on every read path, servers and names
/// included, and the default is the owner's connections.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mcp_server_selection_round_trips_on_every_read_path(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let (_channel_id, thread_id, originating_message_id) =
        insert_originating_thread_fixture(&pool).await;
    let selection = AgentMcpServers::Selected {
        servers: vec![
            AgentMcpServer {
                app_slug: "linear".to_owned(),
                server_name: "Linear".to_owned(),
            },
            AgentMcpServer {
                app_slug: "notion".to_owned(),
                server_name: "Notion".to_owned(),
            },
        ],
    };
    let params = CreateAgentSessionParams {
        mcp_servers: selection.clone(),
        egress_token_hash: Some("mcp-token-hash".to_owned()),
        ..new_session(bot_id, Some(thread_id), Some(originating_message_id))
    };
    let id = params.id;

    let created = create_session(&repo, params).await;
    assert_eq!(created.mcp_servers, selection);
    let fetched = AgentSessionRepo::get(&repo, id)
        .await
        .expect("get agent session");
    assert_eq!(fetched.mcp_servers, selection);
    let by_token = AgentSessionRepo::find_by_egress_token_hash(&repo, "mcp-token-hash")
        .await
        .expect("the token lookup should run")
        .expect("the token should resolve to the session");
    assert_eq!(by_token.mcp_servers, selection);

    let default = create_session(&repo, new_session(bot_id, None, None)).await;
    assert_eq!(default.mcp_servers, AgentMcpServers::OwnerConnections);
    let fetched = AgentSessionRepo::get(&repo, default.id)
        .await
        .expect("get agent session");
    assert_eq!(fetched.mcp_servers, AgentMcpServers::OwnerConnections);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_acp_session_id_updates_only_the_resume_identity(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let id = create_session(&repo, new_session(bot_id, None, None))
        .await
        .id;
    append_system_event(&repo, id, SystemEvent::AcpReady).await;

    repo.set_acp_session_id(id, SessionId::from("acp-session-1"))
        .await
        .expect("persist ACP session id");

    let updated = AgentSessionRepo::get(&repo, id)
        .await
        .expect("get updated agent session");
    assert_eq!(
        updated.acp_session_id,
        Some(SessionId::from("acp-session-1"))
    );
    assert!(matches!(
        updated.status,
        SessionStatus::Event(SystemEvent::AcpReady)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_model_updates_only_the_model(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let id = create_session(&repo, new_session(bot_id, None, None))
        .await
        .id;

    repo.set_model(id, "opus").await.expect("persist model");
    let after_change = AgentSessionRepo::get(&repo, id).await.expect("get session");
    assert_eq!(after_change.model, "opus");
    let (_, _, _, _, entity_updated_at) = fetch_session_entity(&pool, id).await;
    assert_eq!(entity_updated_at, after_change.modified_at);

    let modified_at = after_change.modified_at;
    repo.set_model(id, "opus").await.expect("restate model");
    assert_eq!(
        AgentSessionRepo::get(&repo, id)
            .await
            .expect("get session")
            .modified_at,
        modified_at
    );
    let (_, _, _, _, restated_entity_updated_at) = fetch_session_entity(&pool, id).await;
    assert_eq!(restated_entity_updated_at, entity_updated_at);

    sqlx::query!(
        r#"
        DELETE FROM entity WHERE id = $1
        "#,
        id.as_uuid(),
    )
    .execute(&pool)
    .await
    .expect("drop the registry row");
    repo.set_model(id, "haiku")
        .await
        .expect("set model without a registry row");
    assert_eq!(
        AgentSessionRepo::get(&repo, id)
            .await
            .expect("get session")
            .model,
        "haiku"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_repo_url_replaces_and_clears_the_repository(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let id = create_session(&repo, new_session(bot_id, None, None))
        .await
        .id;

    repo.set_repo_url(id, Some("https://github.com/macro-inc/macro".to_owned()))
        .await
        .expect("persist repository");
    assert_eq!(
        AgentSessionRepo::get(&repo, id)
            .await
            .expect("get session")
            .repo_url
            .as_deref(),
        Some("https://github.com/macro-inc/macro")
    );

    // Clearing is a real answer, not a no-op: a session that chose no
    // repository must not keep the one it was stamped with at open.
    repo.set_repo_url(id, None).await.expect("clear repository");
    assert_eq!(
        AgentSessionRepo::get(&repo, id)
            .await
            .expect("get session")
            .repo_url,
        None
    );

    // Idempotent: restating the same absence changes nothing.
    let modified_at = AgentSessionRepo::get(&repo, id)
        .await
        .expect("get session")
        .modified_at;
    repo.set_repo_url(id, None)
        .await
        .expect("restate repository");
    assert_eq!(
        AgentSessionRepo::get(&repo, id)
            .await
            .expect("get session")
            .modified_at,
        modified_at
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_name_updates_only_the_name(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let id = create_session(&repo, new_session(bot_id, None, None))
        .await
        .id;

    repo.set_name(id, "Fix Flaky Tests")
        .await
        .expect("persist name");
    let after_change = AgentSessionRepo::get(&repo, id).await.expect("get session");
    assert_eq!(after_change.name, "Fix Flaky Tests");
    let (_, _, _, _, entity_updated_at) = fetch_session_entity(&pool, id).await;
    assert_eq!(entity_updated_at, after_change.modified_at);

    let modified_at = after_change.modified_at;
    repo.set_name(id, "Fix Flaky Tests")
        .await
        .expect("restate name");
    assert_eq!(
        AgentSessionRepo::get(&repo, id)
            .await
            .expect("get session")
            .modified_at,
        modified_at
    );
    let (_, _, _, _, restated_entity_updated_at) = fetch_session_entity(&pool, id).await;
    assert_eq!(restated_entity_updated_at, entity_updated_at);

    sqlx::query!(
        r#"
        DELETE FROM entity WHERE id = $1
        "#,
        id.as_uuid(),
    )
    .execute(&pool)
    .await
    .expect("drop the registry row");
    repo.set_name(id, "Renamed Without Registry")
        .await
        .expect("rename without a registry row");
    assert_eq!(
        AgentSessionRepo::get(&repo, id)
            .await
            .expect("get session")
            .name,
        "Renamed Without Registry"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_name_errors_for_missing_session(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool);

    assert!(
        repo.set_name(AgentSessionId::new(), "Missing Session")
            .await
            .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn generated_name_only_replaces_the_default(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let id = create_session(&repo, new_session(bot_id, None, None))
        .await
        .id;

    assert!(
        repo.set_name_if_default(id, "Generated Name")
            .await
            .expect("set generated name")
    );
    let after_generated = AgentSessionRepo::get(&repo, id).await.expect("get session");
    assert_eq!(after_generated.name, "Generated Name");
    let (_, _, _, _, entity_updated_at) = fetch_session_entity(&pool, id).await;
    assert_eq!(entity_updated_at, after_generated.modified_at);

    repo.set_name(id, "Manual Name")
        .await
        .expect("set manual name");
    let after_manual = AgentSessionRepo::get(&repo, id).await.expect("get session");
    let (_, _, _, _, after_manual_entity_updated_at) = fetch_session_entity(&pool, id).await;
    assert!(
        !repo
            .set_name_if_default(id, "Late Generated Name")
            .await
            .expect("skip generated name")
    );
    let skipped = AgentSessionRepo::get(&repo, id).await.expect("get session");
    assert_eq!(skipped.name, "Manual Name");
    assert_eq!(skipped.modified_at, after_manual.modified_at);
    let (_, _, _, _, skipped_entity_updated_at) = fetch_session_entity(&pool, id).await;
    assert_eq!(skipped_entity_updated_at, after_manual_entity_updated_at);

    let unregistered = create_session(&repo, new_session(bot_id, None, None)).await;
    sqlx::query!(
        r#"
        DELETE FROM entity WHERE id = $1
        "#,
        unregistered.id.as_uuid(),
    )
    .execute(&pool)
    .await
    .expect("drop the registry row");
    assert!(
        repo.set_name_if_default(unregistered.id, "Generated Without Registry")
            .await
            .expect("generate a name without a registry row")
    );
    assert_eq!(
        AgentSessionRepo::get(&repo, unregistered.id)
            .await
            .expect("get session")
            .name,
        "Generated Without Registry"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sandbox_size_round_trips_and_user_default_falls_back(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let owner = user_id(OWNER);
    let id = create_session(&repo, new_session(bot_id, None, None))
        .await
        .id;

    assert_eq!(
        repo.user_sandbox_size(&owner)
            .await
            .expect("missing default"),
        SandboxSize::Default
    );

    repo.set_sandbox_size(id, SandboxSize::Large)
        .await
        .expect("persist session size");
    assert_eq!(
        AgentSessionRepo::get(&repo, id)
            .await
            .expect("get session")
            .sandbox_size,
        SandboxSize::Large
    );

    repo.set_user_sandbox_size(&owner, SandboxSize::Small)
        .await
        .expect("persist user default");
    assert_eq!(
        repo.user_sandbox_size(&owner).await.expect("user default"),
        SandboxSize::Small
    );

    repo.set_user_sandbox_size(&owner, SandboxSize::Large)
        .await
        .expect("upsert user default");
    assert_eq!(
        repo.user_sandbox_size(&owner)
            .await
            .expect("upserted default"),
        SandboxSize::Large
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_missing_session_errors(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool);
    let missing = AgentSessionId::new();

    assert!(AgentSessionRepo::get(&repo, missing).await.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_removes_session(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;
    let id = session.id;

    AgentSessionRepo::delete(&repo, id)
        .await
        .expect("delete agent session");

    assert!(AgentSessionRepo::get(&repo, id).await.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn log_create_and_list_by_session_orders_chronologically(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let session_id = create_session(&repo, new_session(bot_id, None, None))
        .await
        .id;

    let user = user_id("macro|agent-session-log-test@example.com");

    let _ = AgentSessionLogRepo::create(
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

    let session = AgentSessionRepo::get(&repo, session_id)
        .await
        .expect("get session after system event");
    assert!(matches!(
        session.status,
        SessionStatus::Event(SystemEvent::AcpReady)
    ));

    let _ = AgentSessionLogRepo::create(
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
    assert_eq!(logs[0].entry.agent_session_id, session_id);
    assert_eq!(logs[0].entry.user_id, Some(user));
    assert!(matches!(
        logs[0].entry.content,
        Message::ToServer(ToServerMessage::Event {
            event: SystemEvent::AcpReady
        })
    ));
    assert_eq!(logs[1].entry.user_id, None);
    assert!(matches!(
        logs[1].entry.content,
        Message::ToRuntime(ToRuntimeMessage::Acp(_))
    ));
    // The stored order is `created_at ASC`, and the timestamp is on the wire
    // now, so it has to actually come back in that order.
    assert!(logs[0].created_at <= logs[1].created_at);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn find_for_thread_matches_the_originating_thread_and_bot(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_a = create_test_bot(&pool).await;
    let bot_b = create_test_bot(&pool).await;
    let (originating_channel, thread, originating_message) =
        insert_originating_thread_fixture(&pool).await;

    let session = create_session(
        &repo,
        new_session(bot_b, Some(thread), Some(originating_message)),
    )
    .await;
    // The create response must already resolve the thread's channel: linked
    // -thread navigation renders from this row without a second lookup.
    assert_eq!(
        session.thread_parent,
        Some(messages::domain::models::MessageParent::Channel(
            originating_channel
        ))
    );
    // A session from some other context must not shadow the lookup.
    create_session(&repo, new_session(bot_a, None, None)).await;

    let found = repo
        .find_for_thread(Some(thread), Some(bot_b))
        .await
        .expect("find bot B's session by originating thread");
    let ThreadSession::CreatedFromThread(matched) = found else {
        panic!("expected the originating-thread session, got {found:?}");
    };
    assert_eq!(matched.id, session.id);
    assert_eq!(matched.originating_message_id, Some(originating_message));
    assert_eq!(
        matched.thread_parent,
        Some(messages::domain::models::MessageParent::Channel(
            originating_channel
        ))
    );

    let wrong_bot = repo
        .find_for_thread(Some(thread), Some(bot_a))
        .await
        .expect("look up the wrong bot");
    assert!(matches!(wrong_bot, ThreadSession::None));

    let wrong_thread = repo
        .find_for_thread(Some(macro_uuid::generate_uuid_v7()), Some(bot_b))
        .await
        .expect("look up an unrelated thread");
    assert!(matches!(wrong_thread, ThreadSession::None));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn find_all_for_thread_returns_every_session_on_the_thread(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_a = create_test_bot(&pool).await;
    let bot_b = create_test_bot(&pool).await;
    let (_channel, thread, originating_message) = insert_originating_thread_fixture(&pool).await;
    let older = create_session(
        &repo,
        new_session(bot_a, Some(thread), Some(originating_message)),
    )
    .await;
    let newer = create_session(
        &repo,
        new_session(bot_b, Some(thread), Some(originating_message)),
    )
    .await;
    create_session(&repo, new_session(bot_a, None, None)).await;
    ExternalSessionRepo::upsert(&repo, newer.id, cursor_external("bc-thread"))
        .await
        .expect("attach an external identity");

    let found = repo
        .find_all_for_thread(thread)
        .await
        .expect("list sessions on the thread");
    assert_eq!(found.len(), 2);
    assert!(found.iter().any(|session| session.id == newer.id));
    assert!(found.iter().any(|session| session.id == older.id));
    assert!(
        found
            .windows(2)
            .all(|pair| pair[0].created_at >= pair[1].created_at)
    );
    let with_external = found
        .iter()
        .find(|session| session.id == newer.id)
        .expect("the newer session is on the thread");
    assert_eq!(with_external.external, Some(cursor_external("bc-thread")));
    assert!(
        found
            .iter()
            .find(|session| session.id == older.id)
            .expect("the older session is on the thread")
            .external
            .is_none()
    );

    let empty = repo
        .find_all_for_thread(macro_uuid::generate_uuid_v7())
        .await
        .expect("list an unrelated thread");
    assert!(empty.is_empty());
}

/// The recent list is the owner's own, newest first, and stops at `limit` -
/// a prompt summarizing what someone has been working on must not be handed
/// somebody else's work, nor an unbounded history.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recent_for_owner_returns_the_owners_newest_sessions(pool: PgPool) {
    const OTHER_OWNER: &str = "macro|agent-session-other-owner@example.com";

    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    insert_user(&pool, OTHER_OWNER).await;

    let oldest = create_session(&repo, new_session(bot_id, None, None)).await;
    let middle = create_session(&repo, new_session(bot_id, None, None)).await;
    let newest = create_session(&repo, new_session(bot_id, None, None)).await;
    let someone_else = create_session(
        &repo,
        CreateAgentSessionParams {
            owner_id: user_id(OTHER_OWNER),
            ..new_session(bot_id, None, None)
        },
    )
    .await;

    let recent = AgentSessionRepo::recent_for_owner(
        &repo,
        &user_id(OWNER),
        NonZeroUsize::new(2).expect("2 is not zero"),
    )
    .await
    .expect("list the owner's recent sessions");

    assert_eq!(
        recent.iter().map(|session| session.id).collect::<Vec<_>>(),
        vec![newest.id, middle.id]
    );
    assert!(recent.iter().all(|session| session.id != oldest.id));
    assert!(recent.iter().all(|session| session.id != someone_else.id));
    assert_eq!(recent[0].name, DEFAULT_AGENT_SESSION_NAME);
    assert_eq!(recent[0].harness, newest.harness);
    assert_eq!(recent[0].repo_url, newest.repo_url);
    assert_eq!(recent[0].created_at, newest.created_at);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn find_for_thread_requires_thread_and_bot_for_originating_match(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    let (_channel, thread, originating_message) = insert_originating_thread_fixture(&pool).await;
    create_session(
        &repo,
        new_session(bot, Some(thread), Some(originating_message)),
    )
    .await;

    let without_bot = repo
        .find_for_thread(Some(thread), None)
        .await
        .expect("look up without a bot");
    assert!(matches!(without_bot, ThreadSession::None));

    let without_thread = repo
        .find_for_thread(None, Some(bot))
        .await
        .expect("look up without a thread");
    assert!(matches!(without_thread, ThreadSession::None));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn thread_and_bot_belong_to_only_one_session(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    let (_, thread, originating_message) = insert_originating_thread_fixture(&pool).await;
    create_session(
        &repo,
        new_session(bot, Some(thread), Some(originating_message)),
    )
    .await;
    let duplicate = AgentSessionRepo::create(
        &repo,
        new_session(bot, Some(thread), Some(originating_message)),
    )
    .await;

    assert!(duplicate.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sessions_audience_is_its_owner(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;

    let audience = repo
        .viewers(session.id)
        .await
        .expect("read the session audience")
        .into_iter()
        .map(|user| user.to_string())
        .collect::<Vec<_>>();

    assert_eq!(
        audience,
        vec!["macro|agent-session-owner@example.com".to_string()],
        "frames stream to the session owner"
    );
}

/// A session nobody can watch resolves to nobody, rather than failing - the
/// publisher's own early return is what turns that into no gateway call.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unknown_session_has_no_audience(pool: PgPool) {
    let audience = PgAgentSessionRepo::new(pool)
        .viewers(AgentSessionId::new())
        .await
        .expect("read the session audience");

    assert!(audience.is_empty());
}

/// The grants a session is born with: the owner owns it, and the channel
/// the bot was mentioned in can steer it. Both are written in the same
/// transaction as the session, so a session can never exist unreachable.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_grants_the_owner_and_the_originating_channel(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let (origin_channel_id, thread_id, originating_message_id) =
        insert_originating_thread_fixture(&pool).await;

    let params = new_session(bot_id, Some(thread_id), Some(originating_message_id));
    let id = params.id;
    create_session(&repo, params).await;

    let mut grants = sqlx::query!(
        r#"
        SELECT source_id, source_type::text AS "source_type!", access_level::text AS "access_level!"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'agent_session'
        ORDER BY source_id
        "#,
        id.as_uuid(),
    )
    .fetch_all(&pool)
    .await
    .expect("read the session's grants")
    .into_iter()
    .map(|row| (row.source_id, row.source_type, row.access_level))
    .collect::<Vec<_>>();
    grants.sort();

    let mut expected = vec![
        (OWNER.to_string(), "user".to_string(), "owner".to_string()),
        (
            origin_channel_id.to_string(),
            "channel".to_string(),
            "edit".to_string(),
        ),
    ];
    expected.sort();

    assert_eq!(grants, expected);

    let (entity_type, owner_type, owner_id, deleted_at, _) = fetch_session_entity(&pool, id).await;
    assert_eq!(entity_type, "agent_session");
    assert_eq!(owner_type, "user");
    assert_eq!(owner_id, OWNER);
    assert_eq!(deleted_at, None);
}

/// A session created without a mention has no channel to inherit an audience
/// from, so it is the owner's alone.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_without_a_mention_grants_only_the_owner(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;

    let params = new_session(bot_id, None, None);
    let id = params.id;
    create_session(&repo, params).await;

    let grants = sqlx::query!(
        r#"
        SELECT source_id, access_level::text AS "access_level!"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'agent_session'
        "#,
        id.as_uuid(),
    )
    .fetch_all(&pool)
    .await
    .expect("read the session's grants");

    assert_eq!(grants.len(), 1);
    assert_eq!(grants[0].source_id, OWNER);
    assert_eq!(grants[0].access_level, "owner");
}

/// Creating a session records it in the owner's history under the
/// `agent_session` item type, the same row `POST /history/agent_session/{id}`
/// touches later, so Soup's `viewed_at` is set from the moment it exists.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_records_the_session_in_the_owners_history(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;

    let params = new_session(bot_id, None, None);
    let id = params.id;
    create_session(&repo, params).await;

    let history = sqlx::query!(
        r#"
        SELECT "userId" AS user_id, "itemType" AS item_type
        FROM "UserHistory"
        WHERE "itemId" = $1
        "#,
        id.as_uuid().to_string(),
    )
    .fetch_all(&pool)
    .await
    .expect("read the session's history rows");

    assert_eq!(history.len(), 1);
    assert_eq!(history[0].user_id, OWNER);
    assert_eq!(history[0].item_type, "agent_session");
}

/// A preview reports every existing id with whether the viewer holds a grant:
/// the owner through their own row, a channel member through the channel's,
/// a stranger through none, and an unknown id not at all. Duplicates in the
/// request are the caller's problem (the service collapses them); the repo
/// answers what it is asked.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn preview_answers_per_id_by_the_viewers_grants(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let (channel_id, thread_id, originating_message_id) =
        insert_originating_thread_fixture(&pool).await;

    let from_channel = create_session(
        &repo,
        new_session(bot_id, Some(thread_id), Some(originating_message_id)),
    )
    .await;
    let private = create_session(&repo, new_session(bot_id, None, None)).await;
    append_system_event(&repo, private.id, SystemEvent::AcpReady).await;
    let missing = AgentSessionId::new();

    let member = "macro|agent-session-channel-member@example.com";
    let stranger = "macro|agent-session-stranger@example.com";
    sqlx::query!(
        "INSERT INTO comms_channel_participants (channel_id, user_id, role) VALUES ($1, $2, 'member')",
        channel_id,
        member,
    )
    .execute(&pool)
    .await
    .expect("add channel member");

    let ids = [from_channel.id, private.id, missing];

    let mut owner_view = repo
        .preview(&user_id(OWNER), &ids)
        .await
        .expect("owner preview");
    owner_view.sort_by_key(|candidate| candidate.data.id.as_uuid());
    let mut expected = vec![
        SessionPreviewCandidate {
            data: AgentSessionPreviewData {
                id: from_channel.id,
                bot: None,
                name: DEFAULT_AGENT_SESSION_NAME.to_string(),
                owner_id: user_id(OWNER),
                bot_id,
                status: SessionStatus::NoMessages,
                created_at: from_channel.created_at,
                modified_at: from_channel.modified_at,
            },
            has_grant: true,
            thread_parent: Some(MessageParent::Channel(channel_id)),
        },
        SessionPreviewCandidate {
            data: AgentSessionPreviewData {
                id: private.id,
                bot: None,
                name: DEFAULT_AGENT_SESSION_NAME.to_string(),
                owner_id: user_id(OWNER),
                bot_id,
                status: SessionStatus::Event(SystemEvent::AcpReady),
                created_at: private.created_at,
                // Bumped by the status event, so read back rather than assumed.
                modified_at: AgentSessionRepo::get(&repo, private.id)
                    .await
                    .expect("reload")
                    .modified_at,
            },
            has_grant: true,
            thread_parent: None,
        },
    ];
    expected.sort_by_key(|candidate| candidate.data.id.as_uuid());
    assert_eq!(owner_view, expected);

    let grant = |view: &[SessionPreviewCandidate], id: AgentSessionId| {
        view.iter()
            .find(|candidate| candidate.data.id == id)
            .map(|candidate| candidate.has_grant)
    };
    let member_view = repo
        .preview(&user_id(member), &ids)
        .await
        .expect("member preview");
    assert_eq!(member_view.len(), 2, "the missing id is absent");
    assert_eq!(grant(&member_view, from_channel.id), Some(true));
    assert_eq!(grant(&member_view, private.id), Some(false));

    let stranger_view = repo
        .preview(&user_id(stranger), &ids)
        .await
        .expect("stranger preview");
    assert_eq!(grant(&stranger_view, from_channel.id), Some(false));
    assert_eq!(grant(&stranger_view, private.id), Some(false));

    // A member who has left the channel loses the channel's grant with it.
    sqlx::query!(
        "UPDATE comms_channel_participants SET left_at = NOW() WHERE channel_id = $1 AND user_id = $2",
        channel_id,
        member,
    )
    .execute(&pool)
    .await
    .expect("member leaves channel");
    let left_view = repo
        .preview(&user_id(member), &[from_channel.id])
        .await
        .expect("former member preview");
    assert_eq!(grant(&left_view, from_channel.id), Some(false));
}

/// `entity_access.entity_id` carries no foreign key, so deleting a session
/// has to take its grants with it or they accumulate forever.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_removes_the_session_grants(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let (_, thread_id, originating_message_id) = insert_originating_thread_fixture(&pool).await;

    let params = new_session(bot_id, Some(thread_id), Some(originating_message_id));
    let id = params.id;
    create_session(&repo, params).await;

    AgentSessionRepo::delete(&repo, id)
        .await
        .expect("delete agent session");

    let remaining = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) AS "count!"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'agent_session'
        "#,
        id.as_uuid(),
    )
    .fetch_one(&pool)
    .await
    .expect("count the session's grants");

    assert_eq!(remaining, 0);

    let remaining_history = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) AS "count!"
        FROM "UserHistory"
        WHERE "itemId" = $1 AND "itemType" = 'agent_session'
        "#,
        id.as_uuid().to_string(),
    )
    .fetch_one(&pool)
    .await
    .expect("count the session's history rows");

    assert_eq!(remaining_history, 0);

    assert_eq!(entity_row_count(&pool, id).await, 0);

    let unregistered = create_session(&repo, new_session(bot_id, None, None)).await;
    sqlx::query!(
        r#"
        DELETE FROM entity WHERE id = $1
        "#,
        unregistered.id.as_uuid(),
    )
    .execute(&pool)
    .await
    .expect("drop the registry row");
    AgentSessionRepo::delete(&repo, unregistered.id)
        .await
        .expect("delete a session without a registry row");
    assert_eq!(entity_row_count(&pool, unregistered.id).await, 0);
}

fn cursor_external(agent: &str) -> ExternalSession {
    ExternalSession {
        provider: "cursor".to_string(),
        external_id: agent.to_string(),
        external_name: Some("Add README".to_string()),
        external_url: Some(format!("https://cursor.com/agents/{agent}")),
        last_run_id: None,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn external_session_round_trips_and_upsert_replaces(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    insert_user(&pool, OWNER).await;
    let bot_id = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;

    assert_eq!(
        ExternalSessionRepo::get(&repo, session.id)
            .await
            .expect("get"),
        None
    );

    ExternalSessionRepo::upsert(&repo, session.id, cursor_external("bc-1"))
        .await
        .expect("first upsert");
    // Re-learning the identity must replace, not fail: the manager writes on
    // every agent creation and a retried turn writes the same row again.
    let renamed = ExternalSession {
        external_name: Some("Add README and tests".to_string()),
        ..cursor_external("bc-1")
    };
    ExternalSessionRepo::upsert(&repo, session.id, renamed.clone())
        .await
        .expect("second upsert");
    assert_eq!(
        ExternalSessionRepo::get(&repo, session.id)
            .await
            .expect("get"),
        Some(renamed.clone())
    );
    // The identity rides along on the session read itself, which is what the
    // HTTP response is built from.
    assert_eq!(
        AgentSessionRepo::get(&repo, session.id)
            .await
            .expect("get session")
            .external,
        Some(renamed)
    );

    ExternalSessionRepo::delete(&repo, session.id)
        .await
        .expect("delete");
    assert_eq!(
        ExternalSessionRepo::get(&repo, session.id)
            .await
            .expect("get"),
        None
    );
    // Deleting a session that has no external row is already the asked-for
    // state.
    ExternalSessionRepo::delete(&repo, session.id)
        .await
        .expect("idempotent delete");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn two_sessions_cannot_claim_the_same_external_agent(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    insert_user(&pool, OWNER).await;
    let bot_id = create_test_bot(&pool).await;
    let (_channel, thread, message) = insert_originating_thread_fixture(&pool).await;
    let first = create_session(&repo, new_session(bot_id, None, None)).await;
    let second = create_session(&repo, new_session(bot_id, Some(thread), Some(message))).await;

    ExternalSessionRepo::upsert(&repo, first.id, cursor_external("bc-1"))
        .await
        .expect("first claim");
    let conflict = ExternalSessionRepo::upsert(&repo, second.id, cursor_external("bc-1")).await;
    assert!(conflict.is_err(), "second claim of bc-1 must be refused");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_session_cascades_its_external_row(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    insert_user(&pool, OWNER).await;
    let bot_id = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;
    ExternalSessionRepo::upsert(&repo, session.id, cursor_external("bc-1"))
        .await
        .expect("upsert");

    AgentSessionRepo::delete(&repo, session.id)
        .await
        .expect("delete session");
    assert_eq!(
        ExternalSessionRepo::get(&repo, session.id)
            .await
            .expect("get"),
        None
    );
}

/// Backdate a replica's heartbeat far past `REPLICA_STALE_AFTER`, so its
/// claims read as up for grabs.
async fn let_heartbeat_go_stale(pool: &PgPool, replica: ReplicaId) {
    sqlx::query!(
        r#"UPDATE harness_replica SET last_heartbeat_at = now() - interval '10 minutes' WHERE id = $1"#,
        replica.as_uuid(),
    )
    .execute(pool)
    .await
    .expect("backdate replica heartbeat");
}

fn claimed(outcome: ClaimOutcome) -> SessionClaim {
    match outcome {
        ClaimOutcome::Claimed(claim) => claim,
        ClaimOutcome::ManagedElsewhere(holder) => {
            panic!("expected to claim, but {holder} manages the session")
        }
    }
}

fn fenced_log(id: AgentSessionId) -> AgentSessionLog {
    AgentSessionLog {
        agent_session_id: id,
        user_id: None,
        content: Message::ToRuntime(ToRuntimeMessage::Acp(acp_notification())),
    }
}

fn cursor_checkpoint_log(id: AgentSessionId, run: &str) -> AgentSessionLog {
    AgentSessionLog {
        agent_session_id: id,
        user_id: None,
        content: Message::ToServer(ToServerMessage::Acp(AcpMessage(
            RawJsonRpcMessage::notification(
                "session/update".to_owned(),
                serde_json::json!({
                    "sessionId": "cursor-acp-1",
                    "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "content": {"type": "text", "text": ""}
                    },
                    "_meta": {"macroCursorRunCheckpoint": run}
                }),
            )
            .expect("valid checkpoint notification"),
        ))),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn claiming_is_reentrant_and_every_claim_bumps_the_fence(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;
    let replica = ReplicaId::mint();

    let first = claimed(repo.claim(session.id, replica).await.expect("first claim"));
    let second = claimed(repo.claim(session.id, replica).await.expect("second claim"));

    assert_eq!(first.fence, ManagerFence(1));
    assert_eq!(second.fence, ManagerFence(2));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_live_holder_blocks_a_second_replica(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;
    let holder = ReplicaId::mint();
    let contender = ReplicaId::mint();

    claimed(repo.claim(session.id, holder).await.expect("claim"));
    match repo.claim(session.id, contender).await.expect("contend") {
        ClaimOutcome::ManagedElsewhere(seen) => assert_eq!(seen, holder),
        ClaimOutcome::Claimed(_) => panic!("a live holder's claim was stolen"),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stale_holder_is_superseded(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;
    let crashed = ReplicaId::mint();
    let successor = ReplicaId::mint();

    claimed(repo.claim(session.id, crashed).await.expect("claim"));
    let_heartbeat_go_stale(&pool, crashed).await;

    let takeover = claimed(repo.claim(session.id, successor).await.expect("takeover"));
    assert_eq!(takeover.fence, ManagerFence(2));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn release_frees_the_lease_but_never_a_successors(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;
    let crashed = ReplicaId::mint();
    let successor = ReplicaId::mint();
    let third = ReplicaId::mint();

    let superseded = claimed(repo.claim(session.id, crashed).await.expect("claim"));
    let_heartbeat_go_stale(&pool, crashed).await;
    let current = claimed(repo.claim(session.id, successor).await.expect("takeover"));

    // The superseded holder's release is a no-op: the successor still holds.
    repo.release(&superseded).await.expect("stale release");
    match repo.claim(session.id, third).await.expect("contend") {
        ClaimOutcome::ManagedElsewhere(seen) => assert_eq!(seen, successor),
        ClaimOutcome::Claimed(_) => panic!("a stale release freed the successor's lease"),
    }

    // The current holder's release frees it for anyone.
    repo.release(&current).await.expect("current release");
    claimed(repo.claim(session.id, third).await.expect("reclaim"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_fenced_append_rejects_a_superseded_writer(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;
    let zombie = ReplicaId::mint();
    let successor = ReplicaId::mint();

    let old_claim = claimed(repo.claim(session.id, zombie).await.expect("claim"));
    repo.create_fenced(fenced_log(session.id), &old_claim)
        .await
        .expect("the live holder's fenced append lands");

    let_heartbeat_go_stale(&pool, zombie).await;
    let new_claim = claimed(repo.claim(session.id, successor).await.expect("takeover"));

    // The zombie wakes and writes under its superseded fence: rejected by the
    // same statement that would have written, no matter how it got confused.
    match repo.create_fenced(fenced_log(session.id), &old_claim).await {
        Err(AgentSessionError::FencedOut(id)) => assert_eq!(id, session.id),
        other => panic!("a superseded fence wrote anyway: {other:?}"),
    }

    repo.create_fenced(fenced_log(session.id), &new_claim)
        .await
        .expect("the successor's fenced append lands");

    let log = AgentSessionLogRepo::list_by_session(&repo, session.id)
        .await
        .expect("list log");
    assert_eq!(
        log.len(),
        2,
        "exactly the two live-holder appends are in the log"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cursor_checkpoint_advances_atomically_under_the_session_fence(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;
    ExternalSessionRepo::upsert(&repo, session.id, cursor_external("bc-1"))
        .await
        .expect("external row");
    let zombie = ReplicaId::mint();
    let successor = ReplicaId::mint();
    let old_claim = claimed(repo.claim(session.id, zombie).await.expect("claim"));

    repo.create_fenced(cursor_checkpoint_log(session.id, "run-1"), &old_claim)
        .await
        .expect("live checkpoint");
    assert_eq!(
        ExternalSessionRepo::get(&repo, session.id)
            .await
            .expect("get")
            .and_then(|external| external.last_run_id),
        Some("run-1".to_owned())
    );

    let_heartbeat_go_stale(&pool, zombie).await;
    let new_claim = claimed(repo.claim(session.id, successor).await.expect("takeover"));
    assert!(matches!(
        repo.create_fenced(cursor_checkpoint_log(session.id, "run-stale"), &old_claim)
            .await,
        Err(AgentSessionError::FencedOut(_))
    ));
    repo.create_fenced(cursor_checkpoint_log(session.id, "run-2"), &new_claim)
        .await
        .expect("successor checkpoint");
    assert_eq!(
        ExternalSessionRepo::get(&repo, session.id)
            .await
            .expect("get")
            .and_then(|external| external.last_run_id),
        Some("run-2".to_owned())
    );
}

/// Exercise the generic boundary contract without asking persistence to inspect ACP JSON.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn history_boundary_selects_initialization_and_keeps_raw_audit(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    let claim = claimed(repo.claim(session.id, ReplicaId::mint()).await.unwrap());
    repo.create_fenced(fenced_log(session.id), &claim)
        .await
        .unwrap();
    assert_eq!(
        AgentSessionLogRepo::list_by_session(&repo, session.id)
            .await
            .unwrap()
            .len(),
        1
    );
    for expected_raw in [4_i64, 7] {
        let init = repo
            .create_fenced(fenced_log(session.id), &claim)
            .await
            .unwrap();
        repo.create_fenced(fenced_log(session.id), &claim)
            .await
            .unwrap();
        let response = repo
            .create_fenced_with_boundary(
                fenced_log(session.id),
                &claim,
                Some(crate::domain::model::HistoryBoundary {
                    initialization_log_id: init.id,
                }),
            )
            .await
            .unwrap();
        let history = AgentSessionLogRepo::list_by_session(&repo, session.id)
            .await
            .unwrap();
        assert_eq!(history.len(), 3);
        assert_eq!(history[0].id, init.id);
        assert_eq!(history[2].id, response.id);
        let raw = sqlx::query_scalar!(
            "SELECT count(*) FROM agent_session_log WHERE agent_session_id = $1",
            session.id.as_uuid()
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(raw, Some(expected_raw));
    }
    // An ordinary append (including resume/error/disconnect) never changes the boundary.
    repo.create_fenced(fenced_log(session.id), &claim)
        .await
        .unwrap();
    assert_eq!(
        AgentSessionLogRepo::list_by_session(&repo, session.id)
            .await
            .unwrap()
            .len(),
        4
    );
    AgentSessionRepo::delete(&repo, session.id).await.unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM agent_session_log WHERE agent_session_id = $1",
            session.id.as_uuid()
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn history_boundary_rejects_foreign_rows_and_stale_claims_atomically(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    let other = create_session(&repo, new_session(bot, None, None)).await;
    let replica = ReplicaId::mint();
    let claim = claimed(repo.claim(session.id, replica).await.unwrap());
    let foreign = AgentSessionLogRepo::create(&repo, fenced_log(other.id))
        .await
        .unwrap();
    let boundary = crate::domain::model::HistoryBoundary {
        initialization_log_id: foreign.id,
    };
    assert!(
        repo.create_fenced_with_boundary(fenced_log(session.id), &claim, Some(boundary))
            .await
            .is_err()
    );
    assert!(
        AgentSessionLogRepo::list_by_session(&repo, session.id)
            .await
            .unwrap()
            .is_empty()
    );
    let init = repo
        .create_fenced(fenced_log(session.id), &claim)
        .await
        .unwrap();
    let current = claimed(repo.claim(session.id, replica).await.unwrap());
    let boundary = crate::domain::model::HistoryBoundary {
        initialization_log_id: init.id,
    };
    assert!(matches!(
        repo.create_fenced_with_boundary(fenced_log(session.id), &claim, Some(boundary))
            .await,
        Err(AgentSessionError::FencedOut(_))
    ));
    assert!(
        repo.create_fenced_with_boundary(fenced_log(other.id), &current, Some(boundary))
            .await
            .is_err()
    );
    assert_eq!(
        AgentSessionLogRepo::list_by_session(&repo, session.id)
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT history_start_log_id FROM agent_session WHERE id = $1",
            session.id.as_uuid()
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        None
    );
    // The FK also rejects a direct cross-session update.
    assert!(
        sqlx::query!(
            "UPDATE agent_session SET history_start_log_id = $2 WHERE id = $1",
            session.id.as_uuid(),
            foreign.id
        )
        .execute(&pool)
        .await
        .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn history_boundary_update_failure_rolls_back_response(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    let claim = claimed(repo.claim(session.id, ReplicaId::mint()).await.unwrap());
    let init = repo
        .create_fenced(fenced_log(session.id), &claim)
        .await
        .unwrap();
    sqlx::raw_sql("CREATE FUNCTION reject_history_boundary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected boundary failure'; END $$; CREATE TRIGGER reject_history_boundary BEFORE UPDATE OF history_start_log_id ON agent_session FOR EACH ROW EXECUTE FUNCTION reject_history_boundary();").execute(&pool).await.unwrap();
    assert!(
        repo.create_fenced_with_boundary(
            fenced_log(session.id),
            &claim,
            Some(crate::domain::model::HistoryBoundary {
                initialization_log_id: init.id
            })
        )
        .await
        .is_err()
    );
    assert_eq!(
        AgentSessionLogRepo::list_by_session(&repo, session.id)
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT history_start_log_id FROM agent_session WHERE id = $1",
            session.id.as_uuid()
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        None
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn history_boundary_insert_failure_keeps_previous_selection(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    let claim = claimed(repo.claim(session.id, ReplicaId::mint()).await.unwrap());
    let init = repo
        .create_fenced(fenced_log(session.id), &claim)
        .await
        .unwrap();
    let boundary = crate::domain::model::HistoryBoundary {
        initialization_log_id: init.id,
    };
    repo.create_fenced_with_boundary(fenced_log(session.id), &claim, Some(boundary))
        .await
        .unwrap();
    let next = repo
        .create_fenced(fenced_log(session.id), &claim)
        .await
        .unwrap();
    sqlx::raw_sql("CREATE FUNCTION reject_history_append() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected append failure'; END $$; CREATE TRIGGER reject_history_append BEFORE INSERT ON agent_session_log FOR EACH ROW EXECUTE FUNCTION reject_history_append();").execute(&pool).await.unwrap();
    assert!(
        repo.create_fenced_with_boundary(
            fenced_log(session.id),
            &claim,
            Some(crate::domain::model::HistoryBoundary {
                initialization_log_id: next.id
            })
        )
        .await
        .is_err()
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT history_start_log_id FROM agent_session WHERE id = $1",
            session.id.as_uuid()
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(init.id)
    );
    assert_eq!(
        AgentSessionLogRepo::list_by_session(&repo, session.id)
            .await
            .unwrap()
            .len(),
        3
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn history_boundary_readers_see_response_and_selection_together(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    let claim = claimed(repo.claim(session.id, ReplicaId::mint()).await.unwrap());
    repo.create_fenced(fenced_log(session.id), &claim)
        .await
        .unwrap();
    let init = repo
        .create_fenced(fenced_log(session.id), &claim)
        .await
        .unwrap();
    // Pause the update after the response INSERT, while its transaction is uncommitted.
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query!("SELECT 1 AS ignored FROM pg_advisory_xact_lock(1987213841)")
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    sqlx::raw_sql("CREATE FUNCTION pause_history_boundary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(1987213841); RETURN NEW; END $$; CREATE TRIGGER pause_history_boundary BEFORE UPDATE OF history_start_log_id ON agent_session FOR EACH ROW EXECUTE FUNCTION pause_history_boundary();").execute(&pool).await.unwrap();
    let writer = repo.clone();
    let task = tokio::spawn(async move {
        writer
            .create_fenced_with_boundary(
                fenced_log(session.id),
                &claim,
                Some(crate::domain::model::HistoryBoundary {
                    initialization_log_id: init.id,
                }),
            )
            .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let blocked = sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 1987213841 AND NOT granted)").fetch_one(&pool).await.unwrap();
            if blocked == Some(true) { break; }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }).await.expect("writer reached boundary update");
    let before = AgentSessionLogRepo::list_by_session(&repo, session.id)
        .await
        .unwrap();
    assert_eq!(before.len(), 2);
    assert_eq!(before[1].id, init.id);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT history_start_log_id FROM agent_session WHERE id = $1",
            session.id.as_uuid()
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        None
    );
    blocker.commit().await.unwrap();
    let response = task.await.unwrap().unwrap();
    let after = AgentSessionLogRepo::list_by_session(&repo, session.id)
        .await
        .unwrap();
    assert_eq!(after.len(), 2);
    assert_eq!(after[0].id, init.id);
    assert_eq!(after[1].id, response.id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn history_boundary_range_uses_order_index_and_uuid_tie_break(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    // Equal timestamps force ordering and selection to use the UUID tie-break.
    sqlx::query!(
        "INSERT INTO agent_session_log (id, agent_session_id, direction, content, created_at) SELECT lpad(to_hex(n), 32, '0')::uuid, $1, 'to_server', $2, '2026-01-01'::timestamptz FROM generate_series(1, 10000) n",
        session.id.as_uuid(),
        serde_json::to_value(ToServerMessage::Event { event: SystemEvent::AcpReady }).unwrap(),
    ).execute(&pool).await.unwrap();
    let boundary = Uuid::from_u128(9900);
    sqlx::query!(
        "UPDATE agent_session SET history_start_log_id = $2 WHERE id = $1",
        session.id.as_uuid(),
        boundary
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql("ANALYZE agent_session_log; ANALYZE agent_session;")
        .execute(&pool)
        .await
        .unwrap();
    let history = AgentSessionLogRepo::list_by_session(&repo, session.id)
        .await
        .unwrap();
    assert_eq!(history.len(), 101);
    assert_eq!(history[0].id, boundary);
    assert_eq!(history[100].id, Uuid::from_u128(10000));
    // GET and realtime must carry the same authoritative row cursor, including
    // the UUID tie-break when all timestamps are equal.
    for stored in &history {
        let dto = crate::inbound::axum_router::AgentSessionLogEntryDto::from(stored.clone());
        let event = crate::outbound::connection_gateway_realtime::AgentSessionLogEvent::new(
            crate::domain::model::LogAppended {
                agent_session_id: session.id,
                entry: stored.clone(),
            },
        );
        let dto = serde_json::to_value(dto).unwrap();
        let event = serde_json::to_value(event).unwrap();
        assert_eq!(dto["id"], stored.id.to_string());
        assert_eq!(dto["id"], event["id"]);
        assert_eq!(dto["createdAt"], event["createdAt"]);
    }

    // Explain the production query itself so this check cannot drift from the reader.
    let source = include_str!("../postgres.rs");
    let query_start = source
        .find("            SELECT\n                log.id,")
        .unwrap();
    let query = source[query_start..].split("\"#,").next().unwrap();
    let explain = format!("EXPLAIN (ANALYZE, FORMAT TEXT) {query}");
    #[expect(
        clippy::disallowed_methods,
        reason = "EXPLAIN is built from the production query source to verify its actual plan"
    )]
    let plan: Vec<(String,)> = sqlx::query_as(&explain)
        .bind(session.id.as_uuid())
        .fetch_all(&pool)
        .await
        .unwrap();
    let plan = plan
        .into_iter()
        .map(|(line,)| line)
        .collect::<Vec<_>>()
        .join("\n");
    println!("{plan}");
    assert!(plan.contains("agent_session_log_session_order"), "{plan}");
    assert!(
        plan.contains("Index Cond:") && plan.contains("ROW(created_at, id) >= ROW("),
        "{plan}"
    );
    // NULL boundaries use the same indexed range, from the beginning.
    sqlx::query!(
        "UPDATE agent_session SET history_start_log_id = NULL WHERE id = $1",
        session.id.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        AgentSessionLogRepo::list_by_session(&repo, session.id)
            .await
            .unwrap()
            .len(),
        10000
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn participants_are_the_distinct_users_the_log_attributes(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot_id = create_test_bot(&pool).await;
    let session_id = create_session(&repo, new_session(bot_id, None, None))
        .await
        .id;
    let alice = user_id("macro|alice@example.com");
    let bob = user_id("macro|bob@example.com");

    // Two prompts from alice, one from bob, and a frame from nobody.
    for user in [
        Some(alice.clone()),
        Some(bob.clone()),
        Some(alice.clone()),
        None,
    ] {
        let _ = AgentSessionLogRepo::create(
            &repo,
            AgentSessionLog {
                agent_session_id: session_id,
                user_id: user,
                content: Message::ToRuntime(ToRuntimeMessage::Acp(acp_notification())),
            },
        )
        .await
        .expect("create log entry");
    }

    let mut participants = repo
        .participants(session_id)
        .await
        .expect("list participants");
    participants.sort_by(|a, b| a.to_string().cmp(&b.to_string()));

    assert_eq!(participants, vec![alice, bob]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pull_request_is_atomic_and_survives_history_selection(pool: PgPool) {
    use crate::domain::pull_request::SessionPullRequestRepo;
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    let url = "https://github.com/org/repo/pull/123";
    let (first, second) = tokio::join!(
        repo.record_pull_request(session.id, &session.owner_id, url, None),
        repo.record_pull_request(session.id, &session.owner_id, url, None),
    );
    assert_eq!(
        usize::from(first.unwrap()) + usize::from(second.unwrap()),
        1
    );
    let replica = ReplicaId::mint();
    let ClaimOutcome::Claimed(claim) = repo.claim(session.id, replica).await.unwrap() else {
        panic!("claim");
    };
    let initialization = repo
        .create_fenced(fenced_log(session.id), &claim)
        .await
        .unwrap();
    repo.create_fenced_with_boundary(
        fenced_log(session.id),
        &claim,
        Some(crate::domain::model::HistoryBoundary {
            initialization_log_id: initialization.id,
        }),
    )
    .await
    .unwrap();
    let log = AgentSessionLogRepo::list_by_session(&repo, session.id)
        .await
        .unwrap();
    assert_eq!(log[0].id, initialization.id);
    assert_eq!(
        log.len(),
        2,
        "registering a PR does not add protocol frames"
    );
    assert_eq!(
        AgentSessionRepo::get(&repo, session.id)
            .await
            .unwrap()
            .pull_request_url
            .as_deref(),
        Some(url)
    );
    assert!(
        !repo
            .record_pull_request(session.id, &session.owner_id, url, None)
            .await
            .unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rotating_a_session_credential_revokes_the_previous_one(pool: PgPool) {
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    repo.set_egress_token_hash(session.id, "first-token-hash")
        .await
        .unwrap();
    assert_eq!(
        repo.find_by_egress_token_hash("first-token-hash")
            .await
            .unwrap()
            .unwrap()
            .id,
        session.id
    );
    repo.set_egress_token_hash(session.id, "second-token-hash")
        .await
        .unwrap();
    assert!(
        repo.find_by_egress_token_hash("first-token-hash")
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        repo.find_by_egress_token_hash("second-token-hash")
            .await
            .unwrap()
            .unwrap()
            .id,
        session.id
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pull_request_waiting_on_takeover_cannot_overwrite_successor(pool: PgPool) {
    use crate::domain::pull_request::SessionPullRequestRepo;
    let repo = PgAgentSessionRepo::new(pool.clone());
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    let ClaimOutcome::Claimed(old) = repo.claim(session.id, ReplicaId::mint()).await.unwrap()
    else {
        panic!("claim")
    };
    let original_url = "https://github.com/org/repo/pull/1";
    assert!(
        repo.record_pull_request(session.id, &session.owner_id, original_url, Some(old))
            .await
            .unwrap()
    );
    assert!(
        !repo
            .record_pull_request(session.id, &session.owner_id, original_url, Some(old))
            .await
            .unwrap()
    );
    // A takeover holds the same row lock as PR publication until commit.
    let mut takeover = pool.begin().await.unwrap();
    sqlx::query!("UPDATE agent_session SET manager_fence = manager_fence + 1, pull_request_url = $2 WHERE id = $1", session.id.as_uuid(), "https://github.com/org/repo/pull/2")
        .execute(&mut *takeover).await.unwrap();
    let stale_repo = repo.clone();
    let owner = session.owner_id.clone();
    let mut stale = tokio::spawn(async move {
        stale_repo
            .record_pull_request(
                session.id,
                &owner,
                "https://github.com/org/repo/pull/1",
                Some(old),
            )
            .await
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), &mut stale)
            .await
            .is_err(),
        "publication must wait for the locked ownership row"
    );
    takeover.commit().await.unwrap();
    assert!(
        matches!(stale.await.unwrap(), Err(AgentSessionError::FencedOut(id)) if id == session.id)
    );
    assert_eq!(
        AgentSessionRepo::get(&repo, session.id)
            .await
            .unwrap()
            .pull_request_url
            .as_deref(),
        Some("https://github.com/org/repo/pull/2")
    );
    assert!(matches!(
        repo.record_pull_request(
            session.id,
            &session.owner_id,
            "https://github.com/org/repo/pull/2",
            Some(old)
        )
        .await,
        Err(AgentSessionError::FencedOut(_))
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_document_session_preserves_its_origin_and_inherits_live_document_access(pool: PgPool) {
    use entity_access::domain::ports::EntityAccessService as _;
    use messages::domain::{
        models::PostMessage,
        ports::{CreateMessage, MessageRepository},
    };
    let bot = create_test_bot(&pool).await;
    let document = macro_uuid::generate_uuid_v7();
    let document_id = document.to_string();
    sqlx::query!(r#"INSERT INTO "Document" (id, name, owner, "fileType") VALUES ($1, 'Agent document', $2, 'md')"#, document_id, OWNER)
        .execute(&pool).await.unwrap();
    let messages = messages::outbound::pg_message_repo::PgMessageRepository::new(pool.clone());
    let parent = MessageParent::parse("document", &document_id).unwrap();
    let root = messages
        .create(CreateMessage {
            parent: parent.clone(),
            actor: OWNER.to_owned().try_into().unwrap(),
            triggered_by: None,
            input: PostMessage {
                attribution: Default::default(),
                notification_policy: Default::default(),
                content: "@agent investigate".into(),
                thread_id: None,
                anchor: None,
                mentions: vec![],
                attachments: vec![],
                nonce: None,
            },
        })
        .await
        .unwrap();
    let repo = PgAgentSessionRepo::new(pool.clone());
    let session = create_session(&repo, new_session(bot, Some(root.id), Some(root.id))).await;
    assert_eq!(session.thread_parent, Some(parent.clone()));
    assert_eq!(
        AgentSessionRepo::get(&repo, session.id)
            .await
            .unwrap()
            .thread_parent,
        Some(parent.clone())
    );
    assert_eq!(
        repo.find_all_for_thread(root.id).await.unwrap()[0].thread_parent,
        Some(parent.clone())
    );

    let collaborator = "macro|doc-agent-collaborator@example.com";
    insert_user(&pool, collaborator).await;
    let mut transaction = pool.begin().await.unwrap();
    insert_entity_access_row(
        &mut transaction,
        &document,
        EntityType::Document,
        collaborator,
        EntityAccessSourceType::User,
        AccessLevel::Comment,
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();
    let access = entity_access::domain::service::EntityAccessServiceImpl::new(
        entity_access::outbound::PgAccessRepository::new(pool.clone()),
    );
    use crate::domain::audience::{AuthorizedSessionAudience, SessionAudience};
    let audience = AuthorizedSessionAudience::new(
        repo.clone(),
        access.clone(),
        DocumentSubscriptions {
            document: document_id.clone(),
            candidates: [
                collaborator.to_string(),
                "macro|uninvited@example.com".to_string(),
            ]
            .into_iter()
            .collect(),
        },
    );
    let viewers = audience.viewers(session.id).await.unwrap();
    assert!(viewers.contains(&user_id(OWNER)));
    assert!(viewers.contains(&user_id(collaborator)));
    assert_eq!(viewers.len(), 2);
    // Bind owned values across the async lookup.
    let collaborator_id = user_id(collaborator);
    let session_id = session.id.to_string();
    assert_eq!(
        access
            .get_access_level(
                Some(&collaborator_id),
                &session_id,
                EntityType::AgentSession
            )
            .await
            .unwrap(),
        Some(AccessLevel::Edit)
    );
    sqlx::query!(
        "DELETE FROM entity_access WHERE entity_id = $1 AND source_id = $2",
        document,
        collaborator
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        access
            .get_access_level(
                Some(&collaborator_id),
                &session_id,
                EntityType::AgentSession
            )
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        audience.viewers(session.id).await.unwrap(),
        vec![user_id(OWNER)]
    );

    // A preview never sees the inherited grant as a row: the candidate names
    // the document so the service can ask, and the view adapter answers with
    // the document's current permission.
    use crate::domain::audience::EntityAccessSessionView;
    use crate::domain::ports::SessionViewAccess as _;
    let view = EntityAccessSessionView::new(access.clone());
    let candidates = repo.preview(&collaborator_id, &[session.id]).await.unwrap();
    assert_eq!(candidates.len(), 1);
    assert!(!candidates[0].has_grant);
    assert_eq!(candidates[0].thread_parent, Some(parent.clone()));
    assert!(!view.can_view(&collaborator_id, session.id).await.unwrap());
    let mut transaction = pool.begin().await.unwrap();
    insert_entity_access_row(
        &mut transaction,
        &document,
        EntityType::Document,
        collaborator,
        EntityAccessSourceType::User,
        AccessLevel::View,
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();
    assert!(view.can_view(&collaborator_id, session.id).await.unwrap());
    assert!(
        !repo.preview(&collaborator_id, &[session.id]).await.unwrap()[0].has_grant,
        "inherited access is resolved at check time, never materialized"
    );
    assert!(
        !view
            .can_view(&user_id("macro|nobody@example.com"), session.id)
            .await
            .unwrap()
    );
}

struct DocumentSubscriptions {
    document: String,
    candidates: std::collections::HashSet<String>,
}
impl crate::domain::audience::SessionSubscriptions for DocumentSubscriptions {
    async fn candidates(
        &self,
        _: AgentSessionId,
        parent: Option<&MessageParent>,
    ) -> Result<std::collections::HashSet<String>, rootcause::Report> {
        assert_eq!(
            parent,
            Some(&MessageParent::parse("document", &self.document).unwrap())
        );
        Ok(self.candidates.clone())
    }
}
