use super::*;
use crate::domain::error::PropertiesErr;
use crate::domain::model::EntityPropertyOptionUpdate;
use crate::domain::ports::PropertiesRepo;
use crate::outbound::properties_pg_repo::PropertiesPgRepo;
use models_properties::EntityType;
use models_properties::service::property_value::PropertyValue;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn retained_completion_updates_and_upserts_skip_admission(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, a, b) = seed(&pool).await?;
    set_status(&pool, b, StatusOption::Completed).await?;
    set_status(&pool, a, StatusOption::Completed).await?;
    set_status(&pool, b, StatusOption::InProgress).await?;
    sqlx::query!(
        "UPDATE team SET prevent_completing_blocked_tasks = TRUE WHERE id = $1",
        team
    )
    .execute(&pool)
    .await?;

    // A changed JSON envelope still retains Completed rather than entering it.
    sqlx::query!(
        "UPDATE entity_properties SET values = $1 WHERE entity_id = $2 AND property_definition_id = $3",
        serde_json::json!({"type": "SelectOption", "value": [StatusOption::Completed.uuid()], "legacy": true}),
        a.to_string(),
        SystemPropertyKey::STATUS_UUID,
    )
    .execute(&pool)
    .await?;
    let repo = PropertiesPgRepo::new(pool.clone());
    repo.upsert_entity_property(
        &a.to_string(),
        EntityType::Task,
        SystemPropertyKey::STATUS_UUID,
        Some(PropertyValue::SelectOption(vec![
            StatusOption::Completed.uuid(),
        ])),
    )
    .await?;
    repo.add_entity_property_option(
        &a.to_string(),
        EntityType::Task,
        SystemPropertyKey::STATUS_UUID,
        StatusOption::Completed.uuid(),
    )
    .await?;
    repo.bulk_update_entity_property_options(
        &a.to_string(),
        EntityType::Task,
        &[EntityPropertyOptionUpdate {
            property_definition_id: SystemPropertyKey::STATUS_UUID,
            add_option_ids: vec![StatusOption::Completed.uuid()],
            remove_option_ids: vec![],
        }],
    )
    .await?;
    assert_eq!(
        PgTaskDependencyStateRepository::new(pool)
            .load(&[a])
            .await?[0]
            .open_blocker_ids,
        vec![b]
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn every_option_writer_preserves_typed_completion_rejection(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, a, _) = seed(&pool).await?;
    set_status(&pool, a, StatusOption::InProgress).await?;
    sqlx::query!(
        "UPDATE team SET prevent_completing_blocked_tasks = TRUE WHERE id = $1",
        team
    )
    .execute(&pool)
    .await?;
    let repo = PropertiesPgRepo::new(pool.clone());
    let error = repo
        .upsert_entity_property(
            &a.to_string(),
            EntityType::Task,
            SystemPropertyKey::STATUS_UUID,
            Some(PropertyValue::SelectOption(vec![
                StatusOption::Completed.uuid(),
            ])),
        )
        .await
        .unwrap_err();
    assert!(matches!(
        PropertiesErr::from(error),
        PropertiesErr::TaskCompletionBlocked
    ));
    let error = repo
        .add_entity_property_option(
            &a.to_string(),
            EntityType::Task,
            SystemPropertyKey::STATUS_UUID,
            StatusOption::Completed.uuid(),
        )
        .await
        .unwrap_err();
    assert!(matches!(
        PropertiesErr::from(error),
        PropertiesErr::TaskCompletionBlocked
    ));
    let error = repo
        .bulk_update_entity_property_options(
            &a.to_string(),
            EntityType::Task,
            &[EntityPropertyOptionUpdate {
                property_definition_id: SystemPropertyKey::STATUS_UUID,
                add_option_ids: vec![StatusOption::Completed.uuid()],
                remove_option_ids: vec![StatusOption::InProgress.uuid()],
            }],
        )
        .await
        .unwrap_err();
    assert!(matches!(
        PropertiesErr::from(error),
        PropertiesErr::TaskCompletionBlocked
    ));
    let persisted = sqlx::query_scalar!(
        "SELECT values FROM entity_properties WHERE entity_id = $1 AND property_definition_id = $2",
        a.to_string(),
        SystemPropertyKey::STATUS_UUID,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        persisted,
        Some(
            serde_json::json!({"type": "SelectOption", "value": [StatusOption::InProgress.uuid()]})
        )
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn insertion_and_conflict_noops_distinguish_real_completion(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, a, _) = seed(&pool).await?;
    sqlx::query!(
        "UPDATE team SET prevent_completing_blocked_tasks = TRUE WHERE id = $1",
        team
    )
    .execute(&pool)
    .await?;
    let completed =
        serde_json::json!({"type": "SelectOption", "value": [StatusOption::Completed.uuid()]});
    // A conflict that does not change Status is not a completion transition.
    sqlx::query!(
        "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
         VALUES ($1, $2, 'TASK', $3, $4)
         ON CONFLICT (entity_id, entity_type, property_definition_id) DO NOTHING",
        Uuid::now_v7(),
        a.to_string(),
        SystemPropertyKey::STATUS_UUID,
        completed,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "DELETE FROM entity_properties WHERE entity_id = $1 AND property_definition_id = $2",
        a.to_string(),
        SystemPropertyKey::STATUS_UUID,
    )
    .execute(&pool)
    .await?;
    let error =
        sqlx::query!(
        "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
         VALUES ($1, $2, 'TASK', $3, $4)",
        Uuid::now_v7(), a.to_string(), SystemPropertyKey::STATUS_UUID, completed,
    )
        .execute(&pool)
        .await
        .unwrap_err();
    assert_eq!(
        error.as_database_error().unwrap().constraint(),
        Some("task_completion_blocked")
    );
    Ok(())
}
