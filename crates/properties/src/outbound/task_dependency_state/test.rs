use super::*;
use crate::outbound::task_dependency_queries;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use system_properties::{StatusOption, SystemPropertyKey};

async fn seed(pool: &PgPool) -> anyhow::Result<(Uuid, Uuid, Uuid)> {
    let team = Uuid::now_v7();
    let user = Uuid::now_v7();
    sqlx::query!("INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 'owner@example.com', 'owner@example.com', 'cus_placeholder')", user).execute(pool).await?;
    sqlx::query!("INSERT INTO \"User\" (id, email, macro_user_id) VALUES ('macro|owner@example.com', 'owner@example.com', $1)", user).execute(pool).await?;
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Test team', 'macro|owner@example.com')",
        team
    )
    .execute(pool)
    .await?;
    let a = Uuid::now_v7();
    let b = Uuid::now_v7();
    for task in [a, b] {
        sqlx::query!("INSERT INTO \"Document\" (id, name, owner) VALUES ($1, 'Test task', 'macro|owner@example.com')", task.to_string()).execute(pool).await?;
        sqlx::query!("INSERT INTO entity (id, entity_type, owner_type, owner_id) VALUES ($1, 'document', 'team', $2)", task, team.to_string()).execute(pool).await?;
        for definition in [
            SystemPropertyKey::DEPENDS_ON_UUID,
            SystemPropertyKey::BLOCKING_UUID,
            SystemPropertyKey::STATUS_UUID,
        ] {
            sqlx::query!("INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id) VALUES ($1, $2, 'TASK', $3)", Uuid::now_v7(), task.to_string(), definition).execute(pool).await?;
        }
    }
    task_dependency_queries::link(pool, a, SystemPropertyKey::DEPENDS_ON_UUID, vec![], vec![b])
        .await?;
    Ok((team, a, b))
}

async fn set_status(pool: &PgPool, task: Uuid, status: StatusOption) -> Result<(), sqlx::Error> {
    let value = serde_json::json!({"type":"SelectOption", "value":[status.uuid()]});
    sqlx::query!("UPDATE entity_properties SET values = $1 WHERE entity_id = $2 AND entity_type = 'TASK' AND property_definition_id = $3", value, task.to_string(), SystemPropertyKey::STATUS_UUID).execute(pool).await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn batched_state_tracks_completion_reopening_and_deleted_blockers(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (_, a, b) = seed(&pool).await?;
    let repository = PgTaskDependencyStateRepository::new(pool.clone());
    let states = repository.load(&[a, b]).await?;
    assert_eq!(
        states
            .iter()
            .find(|state| state.task_id == a)
            .unwrap()
            .open_blocker_ids,
        vec![b]
    );
    assert_eq!(
        states
            .iter()
            .find(|state| state.task_id == b)
            .unwrap()
            .dependent_ids,
        vec![a]
    );
    set_status(&pool, b, StatusOption::Completed).await?;
    assert!(repository.load(&[a]).await?[0].open_blocker_ids.is_empty());
    set_status(&pool, b, StatusOption::InProgress).await?;
    assert_eq!(repository.load(&[a]).await?[0].open_blocker_ids, vec![b]);
    sqlx::query!(
        "UPDATE \"Document\" SET \"deletedAt\" = NOW() WHERE id = $1",
        b.to_string()
    )
    .execute(&pool)
    .await?;
    assert!(repository.load(&[a]).await?[0].open_blocker_ids.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn storage_guard_covers_direct_and_bulk_status_writes_and_defaults_off(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, a, b) = seed(&pool).await?;
    set_status(&pool, a, StatusOption::Completed).await?;
    set_status(&pool, a, StatusOption::InProgress).await?;
    sqlx::query!(
        "UPDATE team SET prevent_completing_blocked_tasks = TRUE WHERE id = $1",
        team
    )
    .execute(&pool)
    .await?;
    let error = set_status(&pool, a, StatusOption::Completed)
        .await
        .unwrap_err();
    assert_eq!(
        error.as_database_error().unwrap().constraint(),
        Some("task_completion_blocked")
    );
    let value =
        serde_json::json!({"type":"SelectOption", "value":[StatusOption::Completed.uuid()]});
    let error = sqlx::query!("UPDATE entity_properties SET values = $1 WHERE entity_id = ANY($2) AND property_definition_id = $3", value, &[a.to_string()], SystemPropertyKey::STATUS_UUID)
        .execute(&pool).await.unwrap_err();
    assert_eq!(
        error.as_database_error().unwrap().constraint(),
        Some("task_completion_blocked")
    );
    let repository = PgTaskDependencyStateRepository::new(pool.clone());
    assert_eq!(repository.load(&[a]).await?[0].open_blocker_ids, vec![b]);
    set_status(&pool, b, StatusOption::Completed).await?;
    set_status(&pool, a, StatusOption::Completed).await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn completion_admission_tries_only_its_task_endpoint(pool: PgPool) -> anyhow::Result<()> {
    let (team, a, b) = seed(&pool).await?;
    sqlx::query!(
        "UPDATE team SET prevent_completing_blocked_tasks = TRUE WHERE id = $1",
        team
    )
    .execute(&pool)
    .await?;
    let mut graph = pool.begin().await?;
    task_dependency_queries::lock_endpoints(&mut graph, &[a]).await?;
    // B has no blockers and shares no completion endpoint with A.
    set_status(&pool, b, StatusOption::Completed).await?;
    let error = set_status(&pool, a, StatusOption::Completed)
        .await
        .unwrap_err();
    assert_eq!(
        error.as_database_error().unwrap().code().as_deref(),
        Some("40001")
    );
    graph.rollback().await?;
    set_status(&pool, a, StatusOption::Completed).await?;
    Ok(())
}

mod completion;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn updated_roots_require_explicit_task_subtype_but_deletions_keep_adjacency(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (_, a, b) = seed(&pool).await?;
    let repository = PgTaskDependencyStateRepository::new(pool.clone());
    // Missing subtype must not count as a task, even with historical edges.
    assert!(repository.neighbors(&[a, b], true).await?.is_empty());
    sqlx::query!("INSERT INTO document_sub_type (document_id, sub_type) VALUES ($1, 'task'), ($2, 'snippet')", a.to_string(), b.to_string()).execute(&pool).await?;
    assert_eq!(repository.neighbors(&[a, b], true).await?, vec![b]);
    assert!(repository.neighbors(&[b], true).await?.is_empty());
    sqlx::query!(
        "DELETE FROM document_sub_type WHERE document_id = $1",
        a.to_string()
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "UPDATE \"Document\" SET \"deletedAt\" = NOW() WHERE id = $1",
        a.to_string()
    )
    .execute(&pool)
    .await?;
    // Lifecycle and property fanout does not depend on subtype or live roots.
    assert_eq!(repository.neighbors(&[a], false).await?, vec![b]);
    assert_eq!(repository.neighbors(&[b], false).await?, vec![a]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn neighbor_pool_preserves_options_and_enforces_server_deadline(
    pool: PgPool,
) -> anyhow::Result<()> {
    let options = (*pool.connect_options())
        .clone()
        .application_name("b11-neighbor-timeout")
        .options([("statement_timeout", "1s"), ("search_path", "public")]);
    let source = PgPoolOptions::new().connect_lazy_with(options);
    let repository = PgTaskDependencyStateRepository::new(source.clone());
    assert_eq!(repository.neighbor_pool.size(), 0);
    assert_eq!(repository.neighbor_pool.options().get_max_connections(), 2);
    assert_eq!(repository.neighbor_pool.options().get_min_connections(), 0);
    let settings = sqlx::query!("SELECT current_setting('statement_timeout') AS \"timeout!\", current_setting('application_name') AS \"application!\", current_setting('search_path') AS \"search_path!\"")
        .fetch_one(&repository.neighbor_pool).await?;
    assert_eq!(settings.timeout, "10s");
    assert_eq!(settings.application, "b11-neighbor-timeout");
    assert_eq!(settings.search_path, "public");
    let mut lock = pool.begin().await?;
    sqlx::query!("LOCK TABLE task_dependency_edges IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *lock)
        .await?;
    let start = std::time::Instant::now();
    let error = repository
        .neighbors(&[Uuid::now_v7()], false)
        .await
        .unwrap_err();
    assert_eq!(
        error
            .downcast_ref::<sqlx::Error>()
            .unwrap()
            .as_database_error()
            .unwrap()
            .code()
            .as_deref(),
        Some("57014")
    );
    eprintln!(
        "neighbor server timeout: SQLSTATE 57014 after {:?}; startup statement_timeout=10s",
        start.elapsed()
    );
    assert!(start.elapsed() >= std::time::Duration::from_secs(9));
    lock.rollback().await?;
    assert!(
        repository
            .neighbors(&[Uuid::now_v7()], false)
            .await?
            .is_empty()
    );
    repository.neighbor_pool.close().await;
    source.close().await;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn neighbors_do_not_truncate_historical_adjacency(pool: PgPool) -> anyhow::Result<()> {
    let root = Uuid::now_v7();
    let endpoints = (0..5001).map(|_| Uuid::now_v7()).collect::<Vec<_>>();
    let mut fixture = pool.begin().await?;
    // Reproduce pre-cap historical data without invoking current admission triggers.
    sqlx::query!("SET LOCAL session_replication_role = replica")
        .execute(&mut *fixture)
        .await?;
    sqlx::query!("INSERT INTO task_dependency_edges (dependent_task_id, blocker_task_id, dependent_property_id, blocking_property_id) SELECT $1, id, $3, $4 FROM unnest($2::uuid[]) endpoint(id)", root, &endpoints, Uuid::now_v7(), Uuid::now_v7()).execute(&mut *fixture).await?;
    fixture.commit().await?;
    let repository = PgTaskDependencyStateRepository::new(pool);
    let mut actual = repository.neighbors(&[root], false).await?;
    actual.sort();
    let mut expected = endpoints;
    expected.sort();
    assert_eq!(actual, expected);
    Ok(())
}
