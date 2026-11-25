use super::*;

// The historical CALL exists only before migration 44259 drops the procedure.
async fn before_call(pool: &PgPool) {
    sqlx::raw_sql(EMPTY_PUBLIC_SCHEMA)
        .execute(pool)
        .await
        .unwrap();
    let migrator = Migrator {
        migrations: Cow::Owned(
            MACRO_DB_MIGRATIONS
                .iter()
                .filter(|migration| migration.version < 20261122044258)
                .cloned()
                .collect(),
        ),
        ..Migrator::DEFAULT
    };
    migrator.run(pool).await.unwrap();
    // Disable the deployed JSON bridge only while loading historical snapshots.
    let mut tx = pool.begin().await.unwrap();
    sqlx::query!("SELECT set_config('macro.task_dependency_backfill', 'on', true)")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    sqlx::raw_sql(
        r#"
        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id)
        SELECT md5('projection-status-'||n)::uuid, md5('projection-task-'||n)::uuid::text,
            'TASK', '00000001-0000-0000-0000-000000000002'
        FROM generate_series(1,1004) n;
        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        SELECT lpad(to_hex(n),32,'0')::uuid, md5('projection-task-'||n)::uuid::text,
            'TASK', '00000001-0000-0000-0000-000000000007',
            jsonb_build_object('type','EntityReference','value',jsonb_build_array(
                jsonb_build_object('entity_type','TASK', 'entity_id',
                    md5('projection-task-'||CASE WHEN n=1002 THEN 1004 ELSE 1003 END)::uuid::text)))
        FROM generate_series(1,1002) n;
        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id)
        SELECT md5('projection-inverse-'||n)::uuid, md5('projection-task-'||n)::uuid::text,
            'TASK', '00000001-0000-0000-0000-000000000017'
        FROM (VALUES (1003),(1004)) hubs(n);
    "#,
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();
    // Count writes to the shared hub, not source-batch commits or edge inserts.
    sqlx::raw_sql(
        r#"
        CREATE TABLE projection_updates (entity_id text NOT NULL);
        CREATE FUNCTION count_projection_updates() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.property_definition_id = '00000001-0000-0000-0000-000000000017'
               AND NEW.values IS DISTINCT FROM OLD.values THEN
                INSERT INTO projection_updates VALUES (NEW.entity_id);
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER count_projection_updates AFTER UPDATE OF values ON entity_properties
            FOR EACH ROW EXECUTE FUNCTION count_projection_updates();
    "#,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn hold_hub(
    pool: &PgPool,
) -> (
    tokio::sync::oneshot::Sender<()>,
    tokio::task::JoinHandle<()>,
) {
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = tokio::sync::oneshot::channel();
    let holder_pool = pool.clone();
    let holder = tokio::spawn(async move {
        let mut tx = holder_pool.begin().await.unwrap();
        sqlx::query!("SELECT id FROM entity_properties WHERE id = md5('projection-inverse-1003')::uuid FOR NO KEY UPDATE")
            .fetch_one(&mut *tx).await.unwrap();
        ready_tx.send(()).unwrap();
        release_rx.await.unwrap();
        tx.rollback().await.unwrap();
    });
    ready_rx.await.unwrap();
    (release_tx, holder)
}

#[sqlx::test(migrations = false)]
async fn shared_hub_projects_once_and_repeated_call_is_idempotent(pool: PgPool) {
    before_call(&pool).await;
    let mut connection = pool.acquire().await.unwrap();
    sqlx::raw_sql("CALL backfill_task_dependency_edges()")
        .execute(&mut *connection)
        .await
        .unwrap();
    let result = sqlx::query!(
        r#"
        SELECT jsonb_array_length(values->'value') AS "count?"
        FROM entity_properties WHERE id = md5('projection-inverse-1003')::uuid
    "#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(result.count, Some(1001));
    assert_eq!(
        sqlx::query_scalar!(
            r#"
        SELECT p.values = jsonb_build_object('type','EntityReference','value',
            jsonb_agg(jsonb_build_object('entity_type','TASK',
                'entity_id',e.dependent_task_id::text) ORDER BY e.dependent_task_id)) AS "matches?"
        FROM entity_properties p JOIN task_dependency_edges e
            ON e.blocker_task_id=md5('projection-task-1003')::uuid
        WHERE p.id=md5('projection-inverse-1003')::uuid GROUP BY p.values
    "#
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(true)
    );
    // This test-only audit table does not exist in the compiler database.
    sqlx::raw_sql(
        r#"DO $$ BEGIN
        IF (SELECT count(*) FROM projection_updates
            WHERE entity_id=md5('projection-task-1003')::uuid::text) <> 1 THEN
            RAISE EXCEPTION 'Shared hub projected more than once';
        END IF;
    END $$"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM task_dependency_edges")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(1002)
    );
    sqlx::raw_sql("CALL backfill_task_dependency_edges()")
        .execute(&mut *connection)
        .await
        .unwrap();
    sqlx::raw_sql(
        r#"DO $$ BEGIN
        IF (SELECT count(*) FROM projection_updates) <> 2 THEN
            RAISE EXCEPTION 'Repeated CALL changed inverse assignments';
        END IF;
    END $$"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM task_dependency_edges")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(1002)
    );
}

#[sqlx::test(migrations = false)]
async fn projection_contention_retries_same_session_after_legacy_writes(pool: PgPool) {
    before_call(&pool).await;
    let (release, holder) = hold_hub(&pool).await;
    let mut migration = pool.acquire().await.unwrap();
    let error = sqlx::raw_sql("CALL backfill_task_dependency_edges()")
        .execute(&mut *migration)
        .await
        .unwrap_err();
    assert_eq!(
        error.as_database_error().unwrap().code().as_deref(),
        Some("40001")
    );
    // Every source batch committed, but no projection of the contended hub did.
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM task_dependency_edges")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(1002)
    );
    assert_eq!(sqlx::query_scalar!("SELECT values IS NULL FROM entity_properties WHERE id=md5('projection-inverse-1003')::uuid")
        .fetch_one(&pool).await.unwrap(), Some(true));
    release.send(()).unwrap();
    holder.await.unwrap();
    // These writes occur after discovery and before its delayed projection.
    sqlx::raw_sql(
        r#"
        UPDATE entity_properties SET values=jsonb_build_object('type','EntityReference','value',
            jsonb_build_array(jsonb_build_object('entity_type','TASK',
            'entity_id',upper(md5('projection-task-1004')::uuid::text)),
            jsonb_build_object('entity_type','TASK',
            'entity_id',md5('projection-task-1004')::uuid::text)))
        WHERE id='00000000-0000-0000-0000-000000000001';
        DELETE FROM entity_properties WHERE id='00000000-0000-0000-0000-000000000002';
        UPDATE entity_properties SET values=NULL
        WHERE id='00000000-0000-0000-0000-000000000003';
        UPDATE entity_properties SET values=NULL
        WHERE id='00000000-0000-0000-0000-000000000003';
        -- This edge already exists: empty transition tables still canonicalize its source.
        UPDATE entity_properties SET values=jsonb_build_object('type','EntityReference','value',
            jsonb_build_array(jsonb_build_object('entity_type','TASK',
                'entity_id',upper(md5('projection-task-1004')::uuid::text)),
                jsonb_build_object('entity_type','TASK',
                'entity_id',md5('projection-task-1004')::uuid::text)))
        WHERE id='00000000-0000-0000-0000-0000000003ea';
    "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql("CALL backfill_task_dependency_edges()")
        .execute(&mut *migration)
        .await
        .unwrap();
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM task_dependency_edges WHERE blocker_task_id=md5('projection-task-1003')::uuid")
        .fetch_one(&pool).await.unwrap(), Some(998));
    assert_eq!(sqlx::query_scalar!("SELECT jsonb_array_length(values->'value') FROM entity_properties WHERE id=md5('projection-inverse-1003')::uuid")
        .fetch_one(&pool).await.unwrap(), Some(998));
    assert_eq!(sqlx::query_scalar!("SELECT jsonb_array_length(values->'value') FROM entity_properties WHERE id=md5('projection-inverse-1004')::uuid")
        .fetch_one(&pool).await.unwrap(), Some(2));
    assert_eq!(
        sqlx::query_scalar!(
            r#"
        SELECT values = jsonb_build_object('type','EntityReference','value',
            jsonb_build_array(jsonb_build_object('entity_type','TASK',
                'entity_id',md5('projection-task-1004')::uuid::text))) AS "matches?"
        FROM entity_properties WHERE id='00000000-0000-0000-0000-000000000001'
    "#
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(true)
    );
    assert_eq!(
        sqlx::query_scalar!(
            r#"
        SELECT values = jsonb_build_object('type','EntityReference','value',
            jsonb_build_array(jsonb_build_object('entity_type','TASK',
                'entity_id',md5('projection-task-1004')::uuid::text))) AS "matches?"
        FROM entity_properties WHERE id='00000000-0000-0000-0000-0000000003ea'
    "#
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(true)
    );
}

#[sqlx::test(migrations = false)]
async fn new_session_retry_preserves_deleted_roots_and_zero_edge_null(pool: PgPool) {
    before_call(&pool).await;
    let (release, holder) = hold_hub(&pool).await;
    let mut migration = pool.acquire().await.unwrap();
    let error = sqlx::raw_sql("CALL backfill_task_dependency_edges()")
        .execute(&mut *migration)
        .await
        .unwrap_err();
    assert_eq!(
        error.as_database_error().unwrap().code().as_deref(),
        Some("40001")
    );
    release.send(()).unwrap();
    holder.await.unwrap();
    migration.close().await.unwrap();
    // Remove one root and the last edge of the other hub before reconstruction.
    sqlx::raw_sql(
        r#"
        DELETE FROM entity_properties WHERE id=md5('projection-inverse-1003')::uuid;
        DELETE FROM entity_properties WHERE id=md5('projection-status-1003')::uuid;
        DELETE FROM entity_properties WHERE id='00000000-0000-0000-0000-0000000003ea';
    "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut fresh = pool.acquire().await.unwrap();
    sqlx::raw_sql("CALL backfill_task_dependency_edges()")
        .execute(&mut *fresh)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM entity_properties WHERE id=md5('projection-inverse-1003')::uuid"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM task_dependency_edges")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
    assert_eq!(sqlx::query_scalar!("SELECT values IS NULL FROM entity_properties WHERE id=md5('projection-inverse-1004')::uuid")
        .fetch_one(&pool).await.unwrap(), Some(true));
}

#[sqlx::test(migrations = false)]
async fn stale_null_blocking_clear_reconciles_edges_before_projection(pool: PgPool) {
    before_call(&pool).await;
    let (release, holder) = hold_hub(&pool).await;
    let mut migration = pool.acquire().await.unwrap();
    let error = sqlx::raw_sql("CALL backfill_task_dependency_edges()")
        .execute(&mut *migration)
        .await
        .unwrap_err();
    assert_eq!(
        error.as_database_error().unwrap().code().as_deref(),
        Some("40001")
    );
    release.send(()).unwrap();
    holder.await.unwrap();

    // Source batches committed edges while this inverse still has NULL JSON.
    assert_eq!(sqlx::query_scalar!("SELECT values IS NULL FROM entity_properties WHERE id = md5('projection-inverse-1003')::uuid")
        .fetch_one(&pool).await.unwrap(), Some(true));
    sqlx::query!(
        "UPDATE entity_properties SET values = NULL WHERE id = md5('projection-inverse-1003')::uuid"
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM task_dependency_edges")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(1)
    );
    assert_eq!(sqlx::query_scalar!("SELECT values IS NULL FROM entity_properties WHERE id = '00000000-0000-0000-0000-000000000001'")
        .fetch_one(&pool).await.unwrap(), Some(true));

    sqlx::raw_sql("CALL backfill_task_dependency_edges()")
        .execute(&mut *migration)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM task_dependency_edges")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(1)
    );
    assert_eq!(sqlx::query_scalar!("SELECT values IS NULL FROM entity_properties WHERE id = md5('projection-inverse-1003')::uuid")
        .fetch_one(&pool).await.unwrap(), Some(true));
    assert_eq!(sqlx::query_scalar!("SELECT jsonb_array_length(values->'value') FROM entity_properties WHERE id = md5('projection-inverse-1004')::uuid")
        .fetch_one(&pool).await.unwrap(), Some(1));
}
