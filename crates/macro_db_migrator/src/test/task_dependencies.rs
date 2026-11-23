use super::*;

#[sqlx::test(migrations = false)]
async fn dependency_backfill_commits_multiple_batches_and_keeps_legacy_writers_consistent(
    pool: PgPool,
) {
    sqlx::raw_sql(EMPTY_PUBLIC_SCHEMA)
        .execute(&pool)
        .await
        .unwrap();
    let before = Migrator {
        migrations: Cow::Owned(
            MACRO_DB_MIGRATIONS
                .iter()
                .filter(|migration| migration.version < 20261122044210)
                .cloned()
                .collect(),
        ),
        ..Migrator::DEFAULT
    };
    before.run(&pool).await.unwrap();
    sqlx::raw_sql(r#"
        INSERT INTO entity_properties (id,entity_id,entity_type,property_definition_id,values)
        SELECT md5('status-'||n)::uuid,md5('task-'||n)::uuid::text,'TASK',
            '00000001-0000-0000-0000-000000000002',NULL
        FROM generate_series(1,7003) n;
        INSERT INTO entity_properties (id,entity_id,entity_type,property_definition_id,values)
        SELECT md5('depends-'||n)::uuid,md5('task-'||n)::uuid::text,'TASK',
            '00000001-0000-0000-0000-000000000007',
            jsonb_build_object('type','EntityReference','value',jsonb_build_array(jsonb_build_object(
                'entity_id',md5('task-'||(n+1))::uuid::text,'entity_type','TASK')))
        FROM generate_series(1,1001) n;
        -- Missing Status still means an unfinished task, not a missing endpoint.
        DELETE FROM entity_properties WHERE id=md5('status-3')::uuid;
        -- A dense historical source exceeds the ordinary 5,000-reference batch.
        INSERT INTO entity_properties (id,entity_id,entity_type,property_definition_id,values)
        SELECT md5('depends-dense')::uuid,md5('task-1002')::uuid::text,'TASK',
            '00000001-0000-0000-0000-000000000007',
            jsonb_build_object('type','EntityReference','value',jsonb_agg(
                jsonb_build_object('entity_id',md5('task-'||n)::uuid::text,'entity_type','TASK')))
        FROM generate_series(2000,7000) n;
    "#).execute(&pool).await.unwrap();
    MACRO_DB_MIGRATIONS.run(&pool).await.unwrap();
    let count = sqlx::query_scalar!("SELECT count(*) FROM task_dependency_edges")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, Some(6002));
    let dense = sqlx::query_scalar!("SELECT count(*) FROM task_dependency_edges WHERE dependent_task_id = md5('task-1002')::uuid").fetch_one(&pool).await.unwrap();
    assert_eq!(dense, Some(5001));
    MACRO_DB_MIGRATIONS.run(&pool).await.unwrap();

    // This is the deployed, single-property writer, without new repository code.
    sqlx::raw_sql(r#"
        UPDATE entity_properties SET values=jsonb_build_object('type','EntityReference','value',
            jsonb_build_array(jsonb_build_object('entity_id',md5('task-3')::uuid::text,'entity_type','TASK')))
        WHERE id=md5('depends-1')::uuid;
    "#).execute(&pool).await.unwrap();
    let stale = sqlx::query_scalar!("SELECT count(*) FROM task_dependency_edges WHERE dependent_task_id = md5('task-1')::uuid AND blocker_task_id = md5('task-2')::uuid").fetch_one(&pool).await.unwrap();
    assert_eq!(stale, Some(0));
    let inverse_count = sqlx::query_scalar!("SELECT jsonb_array_length(values->'value') FROM entity_properties WHERE entity_id=md5('task-3')::uuid::text AND property_definition_id='00000001-0000-0000-0000-000000000015'").fetch_one(&pool).await.unwrap();
    assert_eq!(inverse_count, Some(2));

    sqlx::raw_sql("UPDATE entity_properties SET values=NULL WHERE entity_id=md5('task-3')::uuid::text AND property_definition_id='00000001-0000-0000-0000-000000000015'").execute(&pool).await.unwrap();
    let remaining = sqlx::query_scalar!("SELECT count(*) FROM task_dependency_edges WHERE dependent_task_id = ANY(ARRAY[md5('task-1')::uuid,md5('task-2')::uuid])").fetch_one(&pool).await.unwrap();
    assert_eq!(remaining, Some(0));
}

#[sqlx::test(migrations = false)]
async fn backfill_retries_later_batch_contention_on_the_same_connection(pool: PgPool) {
    sqlx::raw_sql(EMPTY_PUBLIC_SCHEMA)
        .execute(&pool)
        .await
        .unwrap();
    let before_call = Migrator {
        migrations: Cow::Owned(
            MACRO_DB_MIGRATIONS
                .iter()
                .filter(|migration| migration.version < 20261122044258)
                .cloned()
                .collect(),
        ),
        ..Migrator::DEFAULT
    };
    before_call.run(&pool).await.unwrap();
    sqlx::query!(
        "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id)
        SELECT lpad(to_hex(n), 32, '0')::uuid, md5('source-' || n)::uuid::text,
            'TASK', '00000001-0000-0000-0000-000000000007'
        FROM generate_series(1, 501) n",
    )
    .execute(&pool)
    .await
    .unwrap();
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    let holder_barrier = barrier.clone();
    let holder_pool = pool.clone();
    let holder = tokio::spawn(async move {
        let mut tx = holder_pool.begin().await.unwrap();
        sqlx::query!(
            "SELECT id FROM entity_properties
            WHERE id = '00000000-0000-0000-0000-0000000001f5' FOR UPDATE",
        )
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        holder_barrier.wait().await;
        holder_barrier.wait().await;
        tx.rollback().await.unwrap();
    });
    barrier.wait().await;
    let mut migration = pool.acquire().await.unwrap();
    // The compiler database has the final schema, which drops this temporary
    // procedure. Execute its historical-schema CALL at runtime instead.
    let error = sqlx::raw_sql("CALL backfill_task_dependency_edges()")
        .execute(&mut *migration)
        .await
        .unwrap_err();
    assert_eq!(
        error.as_database_error().unwrap().code().as_deref(),
        Some("40001")
    );
    barrier.wait().await;
    holder.await.unwrap();
    // The first 500 assignments committed before contention on source 501.
    // Reuse the same session, including its committed temporary tables.
    sqlx::raw_sql("CALL backfill_task_dependency_edges()")
        .execute(&mut *migration)
        .await
        .unwrap();
}
