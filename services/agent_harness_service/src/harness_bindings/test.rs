use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

async fn insert_harness(pool: &PgPool, harness: HarnessId) {
    sqlx::query!(
        "INSERT INTO harnesses (id, name, owner_user_id, created_by) VALUES ($1, 'test', 'owner@localhost', 'owner@localhost')",
        harness.as_uuid(),
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_replica(pool: &PgPool, replica: ReplicaId, address: &str) {
    sqlx::query!(
        "INSERT INTO harness_replica (id, address) VALUES ($1, $2)",
        replica.as_uuid(),
        address,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_user(pool: &PgPool) {
    let macro_user = macro_uuid::Uuid::new_v4();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, 'stripe_test')",
        macro_user,
        "owner@localhost",
    )
    .execute(pool)
        .await
        .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ('owner@localhost', 'owner@localhost', $1)"#,
        macro_user,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lease_is_exclusive_and_exact_tokens_control_presence(pool: PgPool) {
    let harness = HarnessId::new_from_uuid(macro_uuid::Uuid::new_v4());
    let first = ReplicaId::mint();
    let second = ReplicaId::mint();
    insert_harness(&pool, harness).await;
    insert_replica(&pool, first, "http://first").await;
    insert_replica(&pool, second, "http://second").await;
    let lease = PgRuntimeLease::new(pool.clone());
    let first_token = macro_uuid::Uuid::new_v4();
    let second_token = macro_uuid::Uuid::new_v4();

    assert!(lease.claim(harness, first, first_token).await.unwrap());
    assert!(!lease.claim(harness, second, second_token).await.unwrap());
    assert!(lease.activate(harness, first, first_token).await.unwrap());
    assert!(!lease.activate(harness, first, second_token).await.unwrap());

    lease.release(harness, first, second_token).await.unwrap();
    assert_eq!(
        lease.owner(harness).await.unwrap().unwrap().connection_id,
        first_token
    );
    let presence = sqlx::query!(
        "SELECT last_connected_at IS NOT NULL AS \"connected!\", last_disconnected_at IS NOT NULL AS \"disconnected!\" FROM harnesses WHERE id = $1",
        harness.as_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(presence.connected);
    assert!(!presence.disconnected);

    lease.release(harness, first, first_token).await.unwrap();
    assert!(lease.owner(harness).await.unwrap().is_none());
    let disconnected = sqlx::query_scalar!(
        "SELECT last_disconnected_at IS NOT NULL AS \"disconnected!\" FROM harnesses WHERE id = $1",
        harness.as_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(disconnected);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn expired_pending_and_stale_replica_claims_can_be_taken_over(pool: PgPool) {
    let harness = HarnessId::new_from_uuid(macro_uuid::Uuid::new_v4());
    let first = ReplicaId::mint();
    let second = ReplicaId::mint();
    insert_harness(&pool, harness).await;
    insert_replica(&pool, first, "http://first").await;
    insert_replica(&pool, second, "http://second").await;
    let lease = PgRuntimeLease::new(pool.clone());

    assert!(
        lease
            .claim(harness, first, macro_uuid::Uuid::new_v4())
            .await
            .unwrap()
    );
    sqlx::query!("UPDATE harness_runtime_lease SET pending_until = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    let second_token = macro_uuid::Uuid::new_v4();
    assert!(lease.claim(harness, second, second_token).await.unwrap());
    assert!(lease.activate(harness, second, second_token).await.unwrap());

    sqlx::query!(
        "UPDATE harness_replica SET last_heartbeat_at = now() - interval '31 seconds' WHERE id = $1",
        second.as_uuid(),
    )
        .execute(&pool)
        .await
        .unwrap();
    let first_token = macro_uuid::Uuid::new_v4();
    assert!(lease.claim(harness, first, first_token).await.unwrap());
    let owner = lease.owner(harness).await.unwrap().unwrap();
    assert_eq!(owner.replica, first);
    assert_eq!(owner.connection_id, first_token);
    assert!(owner.pending_until.is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stale_takeover_fences_sessions_and_expiry_updates_presence(pool: PgPool) {
    let harness = HarnessId::new_from_uuid(macro_uuid::Uuid::new_v4());
    let first = ReplicaId::mint();
    let second = ReplicaId::mint();
    let bot = BotId::new_from_uuid(macro_uuid::Uuid::new_v4());
    insert_harness(&pool, harness).await;
    insert_replica(&pool, first, "http://first").await;
    insert_replica(&pool, second, "http://second").await;
    insert_user(&pool).await;
    sqlx::query!(
        "INSERT INTO bots (id, kind, owner_user_id, name, handle) VALUES ($1, 'owned', 'owner@localhost', 'bot', 'bot')",
        bot.as_uuid(),
    )
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query!(
        "INSERT INTO agent_configs (bot_id, instructions, harness, default_model, channel_scope, harness_id) VALUES ($1, '', 'macrod', 'test', 'all', $2)",
        bot.as_uuid(),
        harness.as_uuid(),
    )
        .execute(&pool)
        .await
        .unwrap();
    let session_id = macro_uuid::Uuid::new_v4();
    sqlx::query!(
        "INSERT INTO agent_session (id, owner_id, bot_id, name, model, harness, workspace, status, manager_replica_id) VALUES ($1, 'owner@localhost', $2, 'test', 'test', 'macrod', '/tmp', 'disconnected', $3)",
        session_id,
        bot.as_uuid(),
        first.as_uuid(),
    )
        .execute(&pool)
        .await
        .unwrap();
    let lease = PgRuntimeLease::new(pool.clone());
    let first_token = macro_uuid::Uuid::new_v4();
    assert!(lease.claim(harness, first, first_token).await.unwrap());
    assert!(lease.activate(harness, first, first_token).await.unwrap());
    sqlx::query!(
        "UPDATE harness_replica SET last_heartbeat_at = now() - interval '31 seconds' WHERE id = $1",
        first.as_uuid(),
    )
        .execute(&pool)
        .await
        .unwrap();

    let second_token = macro_uuid::Uuid::new_v4();
    assert!(lease.claim(harness, second, second_token).await.unwrap());
    let manager = sqlx::query_scalar!(
        "SELECT manager_replica_id FROM agent_session WHERE id = $1",
        session_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        manager.is_none(),
        "takeover fences the stale replica's actor"
    );

    assert!(lease.activate(harness, second, second_token).await.unwrap());
    sqlx::query!(
        "UPDATE agent_session SET manager_replica_id = $2 WHERE id = $1",
        session_id,
        second.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE harness_replica SET last_heartbeat_at = now() - interval '31 seconds' WHERE id = $1",
        second.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    let replacement_token = macro_uuid::Uuid::new_v4();
    assert!(
        lease
            .claim(harness, second, replacement_token)
            .await
            .unwrap()
    );
    let manager = sqlx::query_scalar!(
        "SELECT manager_replica_id FROM agent_session WHERE id = $1",
        session_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(manager.is_none(), "same-replica replacement fences actors");
    assert!(
        lease
            .activate(harness, second, replacement_token)
            .await
            .unwrap()
    );
    sqlx::query!(
        "UPDATE agent_session SET manager_replica_id = $2 WHERE id = $1",
        session_id,
        second.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE harness_replica SET last_heartbeat_at = now() - interval '31 seconds' WHERE id = $1",
        second.as_uuid(),
    )
        .execute(&pool)
        .await
        .unwrap();
    lease.expire_stale().await.unwrap();
    assert!(lease.owner(harness).await.unwrap().is_none());
    let manager = sqlx::query_scalar!(
        "SELECT manager_replica_id FROM agent_session WHERE id = $1",
        session_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(manager.is_none(), "expiry fences the disconnected actor");
    let disconnected_after_connected = sqlx::query_scalar!(
        "SELECT last_disconnected_at >= last_connected_at AS \"disconnected_after_connected!\" FROM harnesses WHERE id = $1",
        harness.as_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(disconnected_after_connected);
}
