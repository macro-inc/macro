use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

async fn task(pool: &Pool<Postgres>, task_id: Uuid) -> anyhow::Result<()> {
    let entity_id = task_id.to_string();
    for property_definition_id in [
        SystemPropertyKey::DEPENDS_ON_UUID,
        SystemPropertyKey::BLOCKING_UUID,
    ] {
        sqlx::query!(
            "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id)
             VALUES ($1, $2, 'TASK', $3)",
            Uuid::now_v7(),
            entity_id,
            property_definition_id
        )
        .execute(pool)
        .await?;
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn both_directions_replace_and_clear_atomically(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let a = Uuid::now_v7();
    let b = Uuid::now_v7();
    let c = Uuid::now_v7();
    for id in [a, b, c] {
        task(&pool, id).await?;
    }

    assert!(matches!(
        link(
            &pool,
            a,
            SystemPropertyKey::DEPENDS_ON_UUID,
            vec![],
            vec![b]
        )
        .await?,
        TaskDependencyLinkOutcome::Updated(_, _)
    ));
    let mut connection = pool.acquire().await?;
    assert_eq!(
        targets(&mut connection, b, SystemPropertyKey::BLOCKING_UUID).await?,
        vec![a]
    );
    let TaskDependencyLinkOutcome::Updated(_, reciprocal) =
        link(&pool, b, SystemPropertyKey::BLOCKING_UUID, vec![a], vec![c]).await?
    else {
        anyhow::bail!("expected reciprocal mutation receipts");
    };
    assert_eq!(reciprocal.len(), 2);
    let removed = reciprocal
        .iter()
        .find(|effect| effect.property.entity_id == a.to_string())
        .unwrap();
    assert!(removed.value.is_none());
    assert!(matches!(
        removed.previous_value,
        Some(models_properties::service::property_value::PropertyValue::EntityRef(_))
    ));
    let added = reciprocal
        .iter()
        .find(|effect| effect.property.entity_id == c.to_string())
        .unwrap();
    assert!(
        matches!(&added.value, Some(models_properties::service::property_value::PropertyValue::EntityRef(refs)) if refs.len() == 1 && refs[0].entity_id == b.to_string())
    );
    assert!(
        targets(&mut connection, a, SystemPropertyKey::DEPENDS_ON_UUID)
            .await?
            .is_empty()
    );
    assert_eq!(
        targets(&mut connection, c, SystemPropertyKey::DEPENDS_ON_UUID).await?,
        vec![b]
    );

    let blocking = sqlx::query_scalar!(
        "SELECT values FROM entity_properties WHERE entity_id = $1 AND entity_type = 'TASK'
         AND property_definition_id = $2",
        b.to_string(),
        SystemPropertyKey::BLOCKING_UUID
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        blocking,
        Some(serde_json::json!({"type": "EntityReference", "value": [
            {"entity_id": c.to_string(), "entity_type": "TASK"}
        ]}))
    );

    link(&pool, b, SystemPropertyKey::BLOCKING_UUID, vec![c], vec![]).await?;
    let depends = sqlx::query_scalar!(
        "SELECT values FROM entity_properties WHERE entity_id = $1 AND entity_type = 'TASK'
         AND property_definition_id = $2",
        c.to_string(),
        SystemPropertyKey::DEPENDS_ON_UUID
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(depends, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cycles_and_stale_snapshots_leave_edges_intact(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let a = Uuid::now_v7();
    let b = Uuid::now_v7();
    let c = Uuid::now_v7();
    for id in [a, b, c] {
        task(&pool, id).await?;
    }
    link(
        &pool,
        a,
        SystemPropertyKey::DEPENDS_ON_UUID,
        vec![],
        vec![b],
    )
    .await?;
    assert!(matches!(
        link(
            &pool,
            b,
            SystemPropertyKey::DEPENDS_ON_UUID,
            vec![],
            vec![a]
        )
        .await?,
        TaskDependencyLinkOutcome::Cycle
    ));
    assert!(matches!(
        link(
            &pool,
            a,
            SystemPropertyKey::DEPENDS_ON_UUID,
            vec![b],
            vec![a]
        )
        .await?,
        TaskDependencyLinkOutcome::Cycle
    ));
    link(
        &pool,
        b,
        SystemPropertyKey::DEPENDS_ON_UUID,
        vec![],
        vec![c],
    )
    .await?;
    assert!(matches!(
        link(
            &pool,
            c,
            SystemPropertyKey::DEPENDS_ON_UUID,
            vec![],
            vec![a]
        )
        .await?,
        TaskDependencyLinkOutcome::Updated(_, _)
    ));
    assert!(matches!(
        link(&pool, a, SystemPropertyKey::DEPENDS_ON_UUID, vec![], vec![]).await?,
        TaskDependencyLinkOutcome::Stale
    ));
    let mut connection = pool.acquire().await?;
    assert_eq!(
        targets(&mut connection, a, SystemPropertyKey::DEPENDS_ON_UUID).await?,
        vec![b]
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_task_properties_removes_both_directions(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let a = Uuid::now_v7();
    let b = Uuid::now_v7();
    task(&pool, a).await?;
    task(&pool, b).await?;
    link(
        &pool,
        a,
        SystemPropertyKey::DEPENDS_ON_UUID,
        vec![],
        vec![b],
    )
    .await?;

    let receipts = super::super::entity_property_queries::delete_entity_properties(
        &pool,
        &models_properties::EntityReference::new(b.to_string(), EntityType::Document),
    )
    .await?;
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].property.entity_id, a.to_string());
    assert_eq!(
        receipts[0].property.property_definition_id,
        SystemPropertyKey::DEPENDS_ON_UUID
    );
    assert!(receipts[0].value.is_none());
    assert!(matches!(&receipts[0].previous_value,
        Some(models_properties::service::property_value::PropertyValue::EntityRef(refs))
            if refs.len() == 1 && refs[0].entity_id == b.to_string()));
    // The receipt represents committed storage, and a redelivery has no edge events.
    assert!(
        super::super::entity_property_queries::delete_entity_properties(
            &pool,
            &models_properties::EntityReference::new(b.to_string(), EntityType::Document),
        )
        .await?
        .is_empty()
    );
    let mut connection = pool.acquire().await?;
    assert!(
        targets(&mut connection, a, SystemPropertyKey::DEPENDS_ON_UUID)
            .await?
            .is_empty()
    );
    let depends = sqlx::query_scalar!(
        "SELECT values FROM entity_properties WHERE entity_id = $1 AND entity_type = 'TASK'
         AND property_definition_id = $2",
        a.to_string(),
        SystemPropertyKey::DEPENDS_ON_UUID
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(depends, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_property_writer_fails_fast_behind_graph_writer(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let id = Uuid::now_v7();
    task(&pool, id).await?;
    let mut graph = pool.begin().await?;
    lock_endpoints(&mut graph, &[id]).await?;
    let mut legacy = pool.begin().await?;
    sqlx::query!("SET LOCAL lock_timeout = '100ms'")
        .execute(&mut *legacy)
        .await?;
    let error = sqlx::query!(r#"UPDATE entity_properties SET values = '{"type":"EntityReference","value":[]}'::jsonb WHERE entity_id = $1 AND entity_type = 'TASK' AND property_definition_id = $2"#, id.to_string(), SystemPropertyKey::DEPENDS_ON_UUID).execute(&mut *legacy).await.unwrap_err();
    assert_eq!(
        error
            .as_database_error()
            .and_then(|error| error.code())
            .as_deref(),
        Some("40001")
    );
    legacy.rollback().await?;
    graph.rollback().await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn inverse_capacity_is_atomic_and_oversized_snapshots_can_clear(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    for forward in [true, false] {
        let root = Uuid::now_v7();
        task(&pool, root).await?;
        let leaves = (0..1002).map(|_| Uuid::now_v7()).collect::<Vec<_>>();
        let leaf_names = leaves.iter().map(ToString::to_string).collect::<Vec<_>>();
        let depends_ids = leaves.iter().map(|_| Uuid::now_v7()).collect::<Vec<_>>();
        let blocking_ids = leaves.iter().map(|_| Uuid::now_v7()).collect::<Vec<_>>();
        sqlx::query!(
            "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id)
             SELECT id, name, 'TASK'::property_entity_type, $4::uuid FROM unnest($1::uuid[], $3::text[]) x(id, name)
             UNION ALL
             SELECT id, name, 'TASK'::property_entity_type, $5::uuid FROM unnest($2::uuid[], $3::text[]) x(id, name)",
            &depends_ids,
            &blocking_ids,
            &leaf_names,
            SystemPropertyKey::DEPENDS_ON_UUID,
            SystemPropertyKey::BLOCKING_UUID
        )
        .execute(&pool)
        .await?;
        let root_property = if forward {
            SystemPropertyKey::BLOCKING_UUID
        } else {
            SystemPropertyKey::DEPENDS_ON_UUID
        };
        let leaf_property = if forward {
            SystemPropertyKey::DEPENDS_ON_UUID
        } else {
            SystemPropertyKey::BLOCKING_UUID
        };
        let root_assignment = sqlx::query_scalar!(
            "SELECT id FROM entity_properties WHERE entity_id = $1 AND entity_type = 'TASK' AND property_definition_id = $2",
            root.to_string(), root_property
        ).fetch_one(&pool).await?;
        let seed = &leaves[..1000];
        sqlx::query!(
            "INSERT INTO task_dependency_edges (dependent_task_id, blocker_task_id, dependent_property_id, blocking_property_id)
             SELECT CASE WHEN $1 THEN leaf ELSE $2 END, CASE WHEN $1 THEN $2 ELSE leaf END,
                    CASE WHEN $1 THEN assignment ELSE $3 END, CASE WHEN $1 THEN $3 ELSE assignment END
             FROM unnest($4::uuid[], $5::uuid[]) x(leaf, assignment)",
            forward, root, root_assignment, seed,
            if forward { &depends_ids[..1000] } else { &blocking_ids[..1000] }
        ).execute(&pool).await?;
        assert!(
            link(&pool, leaves[1000], leaf_property, vec![], vec![root])
                .await
                .is_err()
        );
        // The failed request rolls back asynchronously. Serialize before checking
        // capacity so the fail-fast contention error is not the tested outcome.
        let mut legacy_tx = pool.begin().await?;
        lock_endpoints(&mut legacy_tx, &[root, leaves[1000]]).await?;
        let legacy = sqlx::query!(
            "UPDATE entity_properties SET values = $1 WHERE entity_id = $2 AND entity_type = 'TASK' AND property_definition_id = $3",
            serde_json::json!({"type":"EntityReference","value":[{"entity_type":"TASK","entity_id":root.to_string()}]}),
            leaves[1000].to_string(),
            leaf_property
        ).execute(&mut *legacy_tx).await.unwrap_err();
        legacy_tx.rollback().await?;
        assert_eq!(
            legacy.as_database_error().unwrap().code().as_deref(),
            Some("22023")
        );
        let mut connection = pool.acquire().await?;
        assert!(
            targets(&mut connection, leaves[1000], leaf_property)
                .await?
                .is_empty()
        );
        assert_eq!(
            targets(&mut connection, root, root_property).await?.len(),
            1000
        );

        // Simulate a pre-existing oversized snapshot without weakening bounded application writes.
        sqlx::query!(
            "INSERT INTO task_dependency_edges (dependent_task_id, blocker_task_id, dependent_property_id, blocking_property_id)
             VALUES ($1, $2, $3, $4)",
            if forward { leaves[1000] } else { root },
            if forward { root } else { leaves[1000] },
            if forward { depends_ids[1000] } else { root_assignment },
            if forward { root_assignment } else { blocking_ids[1000] }
        ).execute(&pool).await?;
        let expected = leaves[..1001].to_vec();
        assert!(
            link(
                &pool,
                root,
                root_property,
                expected.clone(),
                expected.clone()
            )
            .await
            .is_err()
        );
        assert!(matches!(
            link(&pool, root, root_property, expected, vec![]).await?,
            TaskDependencyLinkOutcome::Updated(_, _)
        ));
        assert!(
            targets(&mut connection, root, root_property)
                .await?
                .is_empty()
        );
        assert!(matches!(
            link(&pool, leaves[1001], leaf_property, vec![], vec![root]).await?,
            TaskDependencyLinkOutcome::Updated(_, _)
        ));
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cleanup_receipts_keep_remaining_edges_in_both_directions(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let deleted = Uuid::now_v7();
    let dependent = Uuid::now_v7();
    let blocker = Uuid::now_v7();
    let remaining = Uuid::now_v7();
    for id in [deleted, dependent, blocker, remaining] {
        task(&pool, id).await?;
    }
    link(
        &pool,
        dependent,
        SystemPropertyKey::DEPENDS_ON_UUID,
        vec![],
        vec![deleted, remaining],
    )
    .await?;
    link(
        &pool,
        deleted,
        SystemPropertyKey::DEPENDS_ON_UUID,
        vec![],
        vec![blocker],
    )
    .await?;
    let receipts = super::super::entity_property_queries::delete_entity_properties(
        &pool,
        &models_properties::EntityReference::new(deleted.to_string(), EntityType::Task),
    )
    .await?;
    assert_eq!(receipts.len(), 2);
    let depends = receipts
        .iter()
        .find(|receipt| receipt.property.entity_id == dependent.to_string())
        .unwrap();
    assert!(
        matches!(&depends.value, Some(models_properties::service::property_value::PropertyValue::EntityRef(refs))
        if refs.len() == 1 && refs[0].entity_id == remaining.to_string())
    );
    assert!(
        matches!(&depends.previous_value, Some(models_properties::service::property_value::PropertyValue::EntityRef(refs)) if refs.len() == 2)
    );
    let blocking = receipts
        .iter()
        .find(|receipt| receipt.property.entity_id == blocker.to_string())
        .unwrap();
    assert_eq!(
        blocking.property.property_definition_id,
        SystemPropertyKey::BLOCKING_UUID
    );
    assert!(blocking.value.is_none());
    assert!(
        matches!(&blocking.previous_value, Some(models_properties::service::property_value::PropertyValue::EntityRef(refs))
        if refs.len() == 1 && refs[0].entity_id == deleted.to_string())
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unrelated_writes_and_non_document_cleanup_do_not_wait(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let a = Uuid::now_v7();
    let b = Uuid::now_v7();
    let c = Uuid::now_v7();
    let d = Uuid::now_v7();
    for id in [a, b, c, d] {
        task(&pool, id).await?;
    }
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    let writer_pool = pool.clone();
    let writer_barrier = barrier.clone();
    let holder = tokio::spawn(async move {
        let mut tx = writer_pool.begin().await?;
        lock_endpoints(&mut tx, &[a, b]).await?;
        writer_barrier.wait().await;
        writer_barrier.wait().await;
        tx.rollback().await?;
        anyhow::Ok(())
    });
    barrier.wait().await;
    // The holder cannot release until both unrelated operations finish.
    let outcome = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        link(
            &pool,
            c,
            SystemPropertyKey::DEPENDS_ON_UUID,
            vec![],
            vec![d],
        ),
    )
    .await??;
    assert!(matches!(outcome, TaskDependencyLinkOutcome::Updated(_, _)));
    tokio::time::timeout(
        std::time::Duration::from_secs(3),
        super::super::entity_property_queries::delete_entity_properties(
            &pool,
            &models_properties::EntityReference::new(a.to_string(), EntityType::Chat),
        ),
    )
    .await??;
    barrier.wait().await;
    holder.await??;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_reciprocal_links_admit_only_one_direction(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let a = Uuid::now_v7();
    let b = Uuid::now_v7();
    task(&pool, a).await?;
    task(&pool, b).await?;
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    let other_barrier = barrier.clone();
    let other_pool = pool.clone();
    let other = tokio::spawn(async move {
        other_barrier.wait().await;
        link(
            &other_pool,
            b,
            SystemPropertyKey::DEPENDS_ON_UUID,
            vec![],
            vec![a],
        )
        .await
    });
    barrier.wait().await;
    let first = link(
        &pool,
        a,
        SystemPropertyKey::DEPENDS_ON_UUID,
        vec![],
        vec![b],
    )
    .await?;
    let second = other.await??;
    assert!(matches!(
        (first, second),
        (
            TaskDependencyLinkOutcome::Updated(_, _),
            TaskDependencyLinkOutcome::Cycle
        ) | (
            TaskDependencyLinkOutcome::Cycle,
            TaskDependencyLinkOutcome::Updated(_, _)
        )
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_replacements_recheck_the_authorized_snapshot(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let a = Uuid::now_v7();
    let b = Uuid::now_v7();
    let c = Uuid::now_v7();
    for id in [a, b, c] {
        task(&pool, id).await?;
    }
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    let other_barrier = barrier.clone();
    let other_pool = pool.clone();
    let other = tokio::spawn(async move {
        other_barrier.wait().await;
        link(
            &other_pool,
            a,
            SystemPropertyKey::DEPENDS_ON_UUID,
            vec![],
            vec![c],
        )
        .await
    });
    barrier.wait().await;
    let first = link(
        &pool,
        a,
        SystemPropertyKey::DEPENDS_ON_UUID,
        vec![],
        vec![b],
    )
    .await?;
    let second = other.await??;
    assert!(matches!(
        (first, second),
        (
            TaskDependencyLinkOutcome::Updated(_, _),
            TaskDependencyLinkOutcome::Stale
        ) | (
            TaskDependencyLinkOutcome::Stale,
            TaskDependencyLinkOutcome::Updated(_, _)
        )
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cleanup_racing_first_link_leaves_no_edges_or_assignments(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    for entity_type in [EntityType::Task, EntityType::Document] {
        let a = Uuid::now_v7();
        let b = Uuid::now_v7();
        task(&pool, a).await?;
        task(&pool, b).await?;
        let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));
        let other_barrier = barrier.clone();
        let other_pool = pool.clone();
        let other = tokio::spawn(async move {
            other_barrier.wait().await;
            link(
                &other_pool,
                b,
                SystemPropertyKey::DEPENDS_ON_UUID,
                vec![],
                vec![a],
            )
            .await
        });
        barrier.wait().await;
        let cleanup = super::super::entity_property_queries::delete_entity_properties(
            &pool,
            &models_properties::EntityReference::new(a.to_string(), entity_type),
        )
        .await;
        let outcome = other.await??;
        match cleanup {
            Ok(_) => {}
            Err(error) => {
                assert!(matches!(
                    error.downcast_ref::<crate::domain::error::PropertiesErr>(),
                    Some(crate::domain::error::PropertiesErr::DependencyContended)
                ));
                super::super::entity_property_queries::delete_entity_properties(
                    &pool,
                    &models_properties::EntityReference::new(a.to_string(), entity_type),
                )
                .await?;
            }
        }
        assert!(matches!(
            outcome,
            TaskDependencyLinkOutcome::Updated(_, _) | TaskDependencyLinkOutcome::MissingTask
        ));
        let mut connection = pool.acquire().await?;
        assert!(neighbors(&mut connection, a).await?.is_empty());
        let assignments = sqlx::query_scalar!(
            "SELECT count(*) FROM entity_properties WHERE entity_id = $1 AND entity_type = 'TASK'",
            a.to_string(),
        )
        .fetch_one(&pool)
        .await?;
        assert_eq!(assignments, Some(0));
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_repository_contention_is_typed(pool: Pool<Postgres>) -> anyhow::Result<()> {
    use crate::domain::error::PropertiesErr;
    use crate::domain::ports::PropertiesRepo;
    let id = Uuid::now_v7();
    task(&pool, id).await?;
    let mut graph = pool.begin().await?;
    lock_endpoints(&mut graph, &[id]).await?;
    let repo = super::super::properties_pg_repo::PropertiesPgRepo::new(pool.clone());
    let error = repo
        .upsert_entity_property(
            &id.to_string(),
            EntityType::Task,
            SystemPropertyKey::DEPENDS_ON_UUID,
            Some(models_properties::service::property_value::PropertyValue::EntityRef(vec![])),
        )
        .await
        .unwrap_err();
    assert!(matches!(
        PropertiesErr::from(error),
        PropertiesErr::DependencyContended
    ));
    graph.rollback().await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cleanup_validates_discovery_and_locks_zero_edge_root(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let a = Uuid::now_v7();
    let b = Uuid::now_v7();
    task(&pool, a).await?;
    task(&pool, b).await?;
    let mut cleanup = pool.begin().await?;
    let discovered = neighbors(&mut cleanup, a).await?;
    assert!(discovered.is_empty());
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    let writer_barrier = barrier.clone();
    let writer_pool = pool.clone();
    let writer = tokio::spawn(async move {
        writer_barrier.wait().await;
        link(
            &writer_pool,
            b,
            SystemPropertyKey::DEPENDS_ON_UUID,
            vec![],
            vec![a],
        )
        .await?;
        writer_barrier.wait().await;
        anyhow::Ok(())
    });
    barrier.wait().await;
    barrier.wait().await;
    let error = lock_cleanup_endpoints(&mut cleanup, a, &discovered)
        .await
        .unwrap_err();
    assert!(matches!(
        error.downcast_ref::<crate::domain::error::PropertiesErr>(),
        Some(crate::domain::error::PropertiesErr::DependencyContended)
    ));
    cleanup.rollback().await?;
    writer.await??;
    link(
        &pool,
        b,
        SystemPropertyKey::DEPENDS_ON_UUID,
        vec![a],
        vec![],
    )
    .await?;
    let mut cleanup = pool.begin().await?;
    lock_cleanup_endpoints(&mut cleanup, a, &[]).await?;
    // A zero-edge cleanup still fences a legacy assignment's first relationship.
    let error = sqlx::query!("UPDATE entity_properties SET values = $1
        WHERE entity_id = $2 AND property_definition_id = $3 AND entity_type = 'TASK'",
        serde_json::json!({"type":"EntityReference","value":[{"entity_id":b.to_string(),"entity_type":"TASK"}]}),
        a.to_string(), SystemPropertyKey::DEPENDS_ON_UUID)
        .execute(&pool).await.unwrap_err();
    assert_eq!(
        error.as_database_error().unwrap().code().as_deref(),
        Some("40001")
    );
    cleanup.rollback().await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn transition_table_writer_tries_both_endpoints(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let a = Uuid::now_v7();
    let b = Uuid::now_v7();
    task(&pool, a).await?;
    task(&pool, b).await?;
    let mut graph = pool.begin().await?;
    lock_endpoints(&mut graph, &[b]).await?;
    let error = sqlx::query!(
        "INSERT INTO task_dependency_edges
        SELECT $1, $2, dependent.id, blocker.id
        FROM entity_properties dependent, entity_properties blocker
        WHERE dependent.entity_id = $1::uuid::text AND dependent.entity_type = 'TASK'
          AND dependent.property_definition_id = $3
          AND blocker.entity_id = $2::uuid::text AND blocker.entity_type = 'TASK'
          AND blocker.property_definition_id = $4",
        a,
        b,
        SystemPropertyKey::DEPENDS_ON_UUID,
        SystemPropertyKey::BLOCKING_UUID,
    )
    .execute(&pool)
    .await
    .unwrap_err();
    assert_eq!(
        error.as_database_error().unwrap().code().as_deref(),
        Some("40001")
    );
    graph.rollback().await?;
    Ok(())
}
