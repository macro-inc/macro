use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use system_properties::SystemPropertyKey;

fn assignment() -> PropertyValue {
    PropertyValue::EntityRef(vec![EntityReference::new(
        bot_id::CODEX_BOT_ID.into_storage_id().as_ref(),
        EntityType::User,
    )])
}

async fn wait_for_blocked_writer(pool: &Pool<Postgres>, blocker: i32) -> anyhow::Result<()> {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let waiting = sqlx::query_scalar!(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))) AS \"exists!\"",
                blocker,
            )
            .fetch_one(pool)
            .await?;
            if waiting {
                return Ok::<_, sqlx::Error>(());
            }
            tokio::task::yield_now().await;
        }
    })
    .await??;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_identical_assignments_report_only_one_new_assignment(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    for preattached in [false, true] {
        let task_id = Uuid::now_v7().to_string();
        if preattached {
            upsert_entity_property(
                &pool,
                &task_id,
                EntityType::Task,
                SystemPropertyKey::ASSIGNEES_UUID,
                None,
            )
            .await?;
        }

        let mut tx = pool.begin().await?;
        let blocker = sqlx::query_scalar!("SELECT pg_backend_pid() AS \"pid!\"")
            .fetch_one(&mut *tx)
            .await?;
        let first = upsert_entity_property_in_transaction(
            &mut tx,
            &task_id,
            EntityType::Task,
            SystemPropertyKey::ASSIGNEES_UUID,
            Some(assignment()),
        )
        .await?;

        let writer_pool = pool.clone();
        let writer = tokio::spawn(async move {
            upsert_entity_property(
                &writer_pool,
                &task_id,
                EntityType::Task,
                SystemPropertyKey::ASSIGNEES_UUID,
                Some(assignment()),
            )
            .await
        });
        // The second request must already be waiting before the first commits:
        // a pre-lock statement snapshot would still see the old empty value.
        wait_for_blocked_writer(&pool, blocker).await?;
        tx.commit().await?;
        let second = writer.await??;

        assert_eq!(first.previous_value, None, "preattached: {preattached}");
        assert_eq!(second.previous_value, Some(assignment()));
        assert_eq!(first.property.id, second.property.id);
        assert_eq!(first.value, second.value);
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn assignment_snapshot_waits_for_writers_using_only_row_locks(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let task_id = Uuid::now_v7().to_string();
    upsert_entity_property(
        &pool,
        &task_id,
        EntityType::Task,
        SystemPropertyKey::ASSIGNEES_UUID,
        Some(assignment()),
    )
    .await?;

    let mut tx = pool.begin().await?;
    let blocker = sqlx::query_scalar!("SELECT pg_backend_pid() AS \"pid!\"")
        .fetch_one(&mut *tx)
        .await?;
    // Deletion takes only PostgreSQL's row lock, and releases the assignment.
    // The waiting assignment must observe that removal after it commits.
    sqlx::query!(
        "DELETE FROM entity_properties WHERE entity_id = $1 AND entity_type = $2",
        task_id,
        EntityType::Task as EntityType,
    )
    .execute(&mut *tx)
    .await?;

    let writer_pool = pool.clone();
    let writer = tokio::spawn(async move {
        upsert_entity_property(
            &writer_pool,
            &task_id,
            EntityType::Task,
            SystemPropertyKey::ASSIGNEES_UUID,
            Some(assignment()),
        )
        .await
    });
    wait_for_blocked_writer(&pool, blocker).await?;
    tx.commit().await?;
    let reassigned = writer.await??;

    assert_eq!(reassigned.previous_value, None);
    assert_eq!(reassigned.value, Some(assignment()));
    Ok(())
}
