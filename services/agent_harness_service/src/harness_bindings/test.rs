use super::*;
use harnesses::domain::ports::HarnessRepo as _;
use harnesses::outbound::pg_harness_repo::PgHarnessRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;

const OWNER: &str = "macro|bindings@example.com";

async fn insert_harness(pool: &PgPool) -> HarnessId {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, kind, name, owner_user_id, created_by)
        VALUES ($1, 'macrod', 'Laptop', $2, $2)
        "#,
        id,
        OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
    HarnessId::new_from_uuid(id)
}

async fn insert_bot(pool: &PgPool, harness: HarnessId) -> Uuid {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO bots (id, kind, name, handle, owner_user_id)
        VALUES ($1, 'owned', 'Native agent', $2, $3)
        "#,
        id,
        format!("native-{id}"),
        OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO agent_configs
            (bot_id, instructions, harness, default_model, channel_scope, is_coding, harness_id)
        VALUES ($1, '', 'macrod', 'default', 'all', true, $2)
        "#,
        id,
        harness.as_uuid(),
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn insert_session(pool: &PgPool, bot: Uuid, acp_session_id: &str) -> AgentSessionId {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO agent_session
            (id, owner_id, bot_id, model, harness, workspace, for_warming, acp_session_id)
        VALUES ($1, $2, $3, 'default', 'macrod', '/srv/agent', false, $4)
        "#,
        id,
        OWNER,
        bot,
        acp_session_id,
    )
    .execute(pool)
    .await
    .unwrap();
    AgentSessionId::new_from_uuid(id)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn live_sessions_resolve_only_on_the_harness_their_bot_is_bound_to(pool: PgPool) {
    let laptop = insert_harness(&pool).await;
    let other = insert_harness(&pool).await;
    let laptop_bot = insert_bot(&pool, laptop).await;
    let other_bot = insert_bot(&pool, other).await;
    let mine = insert_session(&pool, laptop_bot, "acp-mine").await;
    insert_session(&pool, other_bot, "acp-theirs").await;
    insert_session(&pool, laptop_bot, "acp-not-reported").await;

    let found = PgHarnessBindings::new(pool.clone())
        .sessions_on_harness(
            laptop,
            &[
                SessionId::new("acp-mine"),
                SessionId::new("acp-theirs"),
                SessionId::new("acp-unknown"),
            ],
        )
        .await
        .unwrap();

    assert_eq!(
        found,
        ListedSessions {
            live: vec![mine],
            dormant: 0,
        }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_deleted_harness_reattaches_nothing(pool: PgPool) {
    let laptop = insert_harness(&pool).await;
    let bot = insert_bot(&pool, laptop).await;
    insert_session(&pool, bot, "acp-mine").await;
    sqlx::query!(
        "UPDATE harnesses SET deleted_at = now() WHERE id = $1",
        laptop.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();

    let found = PgHarnessBindings::new(pool.clone())
        .sessions_on_harness(laptop, &[SessionId::new("acp-mine")])
        .await
        .unwrap();

    assert_eq!(found, ListedSessions::default());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_archived_session_is_not_reattached(pool: PgPool) {
    let laptop = insert_harness(&pool).await;
    let bot = insert_bot(&pool, laptop).await;
    let archived = insert_session(&pool, bot, "acp-archived").await;
    let live = insert_session(&pool, bot, "acp-live").await;
    sqlx::query!(
        "UPDATE agent_session SET archived_by = 'user', archived_at = now() WHERE id = $1",
        archived.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();

    let found = PgHarnessBindings::new(pool.clone())
        .sessions_on_harness(
            laptop,
            &[SessionId::new("acp-archived"), SessionId::new("acp-live")],
        )
        .await
        .unwrap();

    assert_eq!(
        found,
        ListedSessions {
            live: vec![live],
            dormant: 0,
        }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_session_untouched_for_a_week_with_nothing_waiting_is_dormant(pool: PgPool) {
    let laptop = insert_harness(&pool).await;
    let bot = insert_bot(&pool, laptop).await;
    let dormant = insert_session(&pool, bot, "acp-dormant").await;
    let fresh = insert_session(&pool, bot, "acp-fresh").await;
    let recent_log = insert_session(&pool, bot, "acp-recent-log").await;
    let starting = insert_session(&pool, bot, "acp-starting").await;
    let running = insert_session(&pool, bot, "acp-running").await;
    let blocked = insert_session(&pool, bot, "acp-blocked").await;
    let stopping = insert_session(&pool, bot, "acp-stopping").await;
    let interrupted = insert_session(&pool, bot, "acp-interrupted").await;
    let queued = insert_session(&pool, bot, "acp-queued").await;
    let approval = insert_session(&pool, bot, "acp-approval").await;
    let notified = insert_session(&pool, bot, "acp-notified").await;
    let answering = insert_session(&pool, bot, "acp-answering").await;
    let old = [
        dormant,
        recent_log,
        starting,
        running,
        blocked,
        stopping,
        interrupted,
        queued,
        approval,
        notified,
        answering,
    ];
    for session in old {
        sqlx::query!(
            "UPDATE agent_session SET modified_at = now() - interval '8 days', turn_state = 'idle' WHERE id = $1",
            session.as_uuid()
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query!(
        r#"
        INSERT INTO agent_session_log (id, agent_session_id, direction, content, created_at)
        VALUES ($1, $2, 'to_server', '{}', now() - interval '9 days'),
               ($3, $2, 'to_server', '{}', now() - interval '1 day'),
               ($4, $5, 'to_server', '{}', now() - interval '9 days')
        "#,
        macro_uuid::generate_uuid_v7(),
        recent_log.as_uuid(),
        macro_uuid::generate_uuid_v7(),
        macro_uuid::generate_uuid_v7(),
        dormant.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    for (session, state) in [
        (starting, "starting"),
        (running, "running"),
        (blocked, "blocked"),
        (stopping, "stopping"),
    ] {
        sqlx::query!(
            "UPDATE agent_session SET turn_state = $2 WHERE id = $1",
            session.as_uuid(),
            state
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query!(
        "UPDATE agent_session SET turn_state = 'disconnected', turn_interrupted = true WHERE id = $1",
        interrupted.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO agent_session_queue (agent_session_id, entries) VALUES ($1, '[{"id": "queued"}]')"#,
        queued.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO agent_session_tool_approval
            (id, agent_session_id, turn_action_id, request_id, owner_id, server_slug,
             server_name, tool_name, arguments)
        VALUES ($1, $2, $3, '1', $4, 'macro', 'Macro', 'ReadDocument', '{}')
        "#,
        macro_uuid::generate_uuid_v7(),
        approval.as_uuid(),
        macro_uuid::generate_uuid_v7(),
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO agent_session_notification
            (id, session_id, kind, subject_id, payload, dedupe_key, wake)
        VALUES ($1, $2, 'test', 'subject', '{}', 'dedupe', true)
        "#,
        macro_uuid::generate_uuid_v7(),
        notified.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    let channel = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_channels (id, channel_type, owner_id) VALUES ($1, 'direct_message', $2)",
        channel,
        OWNER
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO agent_conversation_sessions (session_id, channel_id, bot_id) VALUES ($1, $2, $3)",
        answering.as_uuid(),
        channel,
        bot
    )
    .execute(&pool)
    .await
    .unwrap();

    let mut found = PgHarnessBindings::new(pool.clone())
        .sessions_on_harness(
            laptop,
            &[
                SessionId::new("acp-dormant"),
                SessionId::new("acp-fresh"),
                SessionId::new("acp-recent-log"),
                SessionId::new("acp-starting"),
                SessionId::new("acp-running"),
                SessionId::new("acp-blocked"),
                SessionId::new("acp-stopping"),
                SessionId::new("acp-interrupted"),
                SessionId::new("acp-queued"),
                SessionId::new("acp-approval"),
                SessionId::new("acp-notified"),
                SessionId::new("acp-answering"),
            ],
        )
        .await
        .unwrap();
    found.live.sort_by_key(|session| session.as_uuid());

    let mut live = vec![
        fresh,
        recent_log,
        starting,
        running,
        blocked,
        stopping,
        interrupted,
        queued,
        approval,
        notified,
        answering,
    ];
    live.sort_by_key(|session| session.as_uuid());
    assert_eq!(found, ListedSessions { live, dormant: 1 });
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_resident_runs_on_its_owners_access_and_a_coding_agent_on_the_prompters(pool: PgPool) {
    let laptop = insert_harness(&pool).await;
    let coding = BotId::new_from_uuid(insert_bot(&pool, laptop).await);
    let resident = BotId::new_from_uuid(insert_bot(&pool, laptop).await);
    sqlx::query!(
        "UPDATE agent_configs SET is_coding = false WHERE bot_id = $1",
        resident.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    let stranger = MacroUserIdStr::try_from("macro|stranger@example.com".to_owned()).unwrap();
    let bindings = PgHarnessBindings::new(pool.clone());

    let facts = bindings
        .access_facts(resident, Some(&stranger))
        .await
        .unwrap()
        .unwrap();
    assert!(facts.resident);
    assert_eq!(facts.actor_may_use, Some(false));
    assert!(
        facts.may_run(),
        "anyone who can reach a resident can talk to it"
    );

    let facts = bindings
        .access_facts(coding, Some(&stranger))
        .await
        .unwrap()
        .unwrap();
    assert!(!facts.resident);
    assert!(
        !facts.may_run(),
        "a coding agent runs its prompter's instructions"
    );

    let facts = bindings.access_facts(coding, None).await.unwrap().unwrap();
    assert_eq!(facts.actor_may_use, None);
    assert!(facts.may_run(), "its owner's own agent runs unprompted");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reader_cannot_prompt_a_coding_agent(pool: PgPool) {
    let laptop = insert_harness(&pool).await;
    let coding = BotId::new_from_uuid(insert_bot(&pool, laptop).await);
    let reader = MacroUserIdStr::try_from("macro|reader@example.com".to_owned()).unwrap();
    let team_id = macro_uuid::generate_uuid_v7();
    for (id, email) in [
        (OWNER, "bindings@example.com"),
        (reader.as_ref(), "reader@example.com"),
    ] {
        let macro_user = macro_uuid::generate_uuid_v7();
        sqlx::query!(
            "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
            macro_user,
            email,
            format!("stripe_{macro_user}"),
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!(
            r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
            id,
            email,
            macro_user,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Team', $2)",
        team_id,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();
    for id in [OWNER, reader.as_ref()] {
        sqlx::query!(
            "INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member'::team_role)",
            id,
            team_id,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'harness', $2, 'user', 'view')
        "#,
        laptop.as_uuid(),
        reader.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();

    let facts = PgHarnessBindings::new(pool)
        .access_facts(coding, Some(&reader))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(facts.actor_may_use, Some(false));
    assert!(!facts.may_run());
}

fn presence_on_a_replica(pool: &PgPool) -> Arc<PgHarnessPresence> {
    Arc::new(PgHarnessPresence::new(pool.clone(), ReplicaId::mint()))
}

async fn reads_connected(pool: &PgPool, harness: HarnessId) -> bool {
    PgHarnessRepo::new(pool.clone())
        .get_harness(harness)
        .await
        .unwrap()
        .unwrap()
        .connected
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stale_close_on_another_replica_leaves_a_redialed_harness_connected(pool: PgPool) {
    let harness = insert_harness(&pool).await;
    let replica_a = presence_on_a_replica(&pool);
    let replica_b = presence_on_a_replica(&pool);
    let old_socket = RuntimeConnectionId::generate();
    let new_socket = RuntimeConnectionId::generate();

    Arc::clone(&replica_a).connected(harness, old_socket).await;
    // The old socket goes silent. The daemon redials, reaching the other replica
    // before the first one notices.
    Arc::clone(&replica_b).connected(harness, new_socket).await;
    assert!(reads_connected(&pool, harness).await);

    replica_a.disconnected(harness, old_socket).await;

    assert!(reads_connected(&pool, harness).await);

    // The stamp stays put too, for readers that still go by the timestamps.
    let stamped = sqlx::query_scalar!(
        r#"SELECT last_disconnected_at FROM harnesses WHERE id = $1"#,
        harness.as_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stamped, None);

    replica_b.disconnected(harness, new_socket).await;

    assert!(!reads_connected(&pool, harness).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_replica_crash_ends_its_connections_when_their_lease_lapses(pool: PgPool) {
    let harness = insert_harness(&pool).await;
    let crashed = presence_on_a_replica(&pool);
    let connection = RuntimeConnectionId::generate();
    crashed.connected(harness, connection).await;
    assert!(reads_connected(&pool, harness).await);

    // A crash writes no disconnect; all that happens is renewals stop.
    sqlx::query!(
        r#"UPDATE harness_runtime_connection SET lease_expires_at = now() - interval '1 second'"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(!reads_connected(&pool, harness).await);

    // The daemon's next dial brings it back and clears the dead row.
    let successor = presence_on_a_replica(&pool);
    successor
        .connected(harness, RuntimeConnectionId::generate())
        .await;
    assert!(reads_connected(&pool, harness).await);
    let rows = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM harness_runtime_connection WHERE harness_id = $1"#,
        harness.as_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rows, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn renewal_extends_a_lease_and_restores_a_missing_row(pool: PgPool) {
    let harness = insert_harness(&pool).await;
    let replica = presence_on_a_replica(&pool);
    let connection = RuntimeConnectionId::generate();
    Arc::clone(&replica).connected(harness, connection).await;

    sqlx::query!(
        r#"UPDATE harness_runtime_connection SET lease_expires_at = now() - interval '1 second'"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    Arc::clone(&replica)
        .renew(vec![(harness, connection)])
        .await;
    assert!(reads_connected(&pool, harness).await);

    sqlx::query!(r#"DELETE FROM harness_runtime_connection"#)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query!(r#"UPDATE harnesses SET last_disconnected_at = now() + interval '1 hour'"#)
        .execute(&pool)
        .await
        .unwrap();
    assert!(!reads_connected(&pool, harness).await);

    replica.renew(vec![(harness, connection)]).await;

    assert!(reads_connected(&pool, harness).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn simultaneous_final_closes_leave_a_harness_offline(pool: PgPool) {
    // Racing writes interleave differently each time, so give them many chances.
    for _ in 0..25 {
        let harness = insert_harness(&pool).await;
        let replica_a = presence_on_a_replica(&pool);
        let replica_b = presence_on_a_replica(&pool);
        let first = RuntimeConnectionId::generate();
        let second = RuntimeConnectionId::generate();
        Arc::clone(&replica_a).connected(harness, first).await;
        Arc::clone(&replica_b).connected(harness, second).await;

        tokio::join!(
            replica_a.disconnected(harness, first),
            replica_b.disconnected(harness, second),
        );

        assert!(!reads_connected(&pool, harness).await);
    }
}
