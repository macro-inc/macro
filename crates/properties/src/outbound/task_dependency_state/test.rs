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
    assert!(sqlx::query!("UPDATE entity_properties SET values = $1 WHERE entity_id = ANY($2) AND property_definition_id = $3", value, &[a.to_string()], SystemPropertyKey::STATUS_UUID).execute(&pool).await.is_err());
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
