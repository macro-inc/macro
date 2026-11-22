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
    sqlx::query_scalar!("SELECT pg_advisory_xact_lock(747847177) IS NULL")
        .fetch_one(&mut *graph)
        .await?;
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
        let legacy = sqlx::query!(
            "UPDATE entity_properties SET values = $1 WHERE entity_id = $2 AND entity_type = 'TASK' AND property_definition_id = $3",
            serde_json::json!({"type":"EntityReference","value":[{"entity_type":"TASK","entity_id":root.to_string()}]}),
            leaves[1000].to_string(),
            leaf_property
        ).execute(&pool).await.unwrap_err();
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
