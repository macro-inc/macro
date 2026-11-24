use super::*;
use models_properties::service::property_value::PropertyValue;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn no_edge_delta_repairs_dirty_primary_and_returns_canonical_value(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let a = Uuid::from_u128(0xabcdef);
    let b = Uuid::from_u128(0xfedcba);
    for id in [a, b] {
        task(&pool, id).await?;
    }
    for key in [
        SystemPropertyKey::DEPENDS_ON_UUID,
        SystemPropertyKey::BLOCKING_UUID,
    ] {
        link(&pool, a, key, vec![], vec![b]).await?;
        // Bypass only the bridge to reproduce dirty historical storage without changing edges.
        let mut tx = pool.begin().await?;
        sqlx::query!("SET LOCAL session_replication_role = replica")
            .execute(&mut *tx)
            .await?;
        sqlx::query!("UPDATE entity_properties SET values = $1 WHERE entity_id = $2 AND property_definition_id = $3",
            serde_json::json!({"type":"EntityReference","value":[
                {"entity_id":b.to_string().to_uppercase(),"entity_type":"TASK"},
                {"entity_id":b.to_string(),"entity_type":"TASK"}
            ]}), a.to_string(), key).execute(&mut *tx).await?;
        tx.commit().await?;
        let TaskDependencyLinkOutcome::Updated(snapshot, effects) =
            link(&pool, a, key, vec![b], vec![b]).await?
        else {
            anyhow::bail!("expected canonical repair");
        };
        assert!(effects.is_empty());
        assert!(
            matches!(snapshot.value, Some(PropertyValue::EntityRef(ref refs))
            if refs.len() == 1 && refs[0].entity_id == b.to_string())
        );
        let stored = sqlx::query_scalar!(
            "SELECT values FROM entity_properties WHERE id = $1",
            snapshot.property.id
        )
        .fetch_one(&pool)
        .await?;
        assert_eq!(
            stored,
            Some(
                serde_json::json!({"type":"EntityReference","value":[{"entity_id":b.to_string(),"entity_type":"TASK"}]})
            )
        );
        link(&pool, a, key, vec![b], vec![]).await?;
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_no_delta_normalizes_and_historical_cycles_allow_unrelated_removal(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let a = Uuid::from_u128(0xabcdef);
    let b = Uuid::from_u128(0xfedcba);
    let c = Uuid::from_u128(0x123abc);
    for id in [a, b, c] {
        task(&pool, id).await?;
    }
    link(
        &pool,
        a,
        SystemPropertyKey::DEPENDS_ON_UUID,
        vec![],
        vec![b, c],
    )
    .await?;
    // Historical direct cycles predate admission checks.
    let mut tx = pool.begin().await?;
    sqlx::query!("SET LOCAL session_replication_role = replica")
        .execute(&mut *tx)
        .await?;
    sqlx::query!(
        "INSERT INTO task_dependency_edges SELECT $1, $2, d.id, i.id
        FROM entity_properties d CROSS JOIN entity_properties i
        WHERE d.entity_id = $3 AND d.property_definition_id = $5
        AND i.entity_id = $4 AND i.property_definition_id = $6",
        b,
        a,
        b.to_string(),
        a.to_string(),
        SystemPropertyKey::DEPENDS_ON_UUID,
        SystemPropertyKey::BLOCKING_UUID
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    for key in [
        SystemPropertyKey::DEPENDS_ON_UUID,
        SystemPropertyKey::BLOCKING_UUID,
    ] {
        let target = if key == SystemPropertyKey::DEPENDS_ON_UUID {
            a
        } else {
            b
        };
        let endpoint = if target == a { b } else { a };
        let dirty = serde_json::json!({"type":"EntityReference","value":[
            {"entity_id":endpoint.to_string().to_uppercase(),"entity_type":"TASK"},
            {"entity_id":endpoint.to_string(),"entity_type":"TASK"}
        ]});
        sqlx::query!("UPDATE entity_properties SET values = $1 WHERE entity_id = $2 AND property_definition_id = $3",
            dirty, target.to_string(), key).execute(&pool).await?;
        let stored = sqlx::query_scalar!("SELECT values FROM entity_properties WHERE entity_id = $1 AND property_definition_id = $2",
            target.to_string(),key).fetch_one(&pool).await?;
        assert_eq!(
            stored,
            Some(
                serde_json::json!({"type":"EntityReference","value":[{"entity_id":endpoint.to_string(),"entity_type":"TASK"}]})
            )
        );
    }
    let mut connection = pool.acquire().await?;
    assert_eq!(
        targets(&mut connection, a, SystemPropertyKey::DEPENDS_ON_UUID).await?,
        vec![b]
    );
    assert_eq!(
        targets(&mut connection, b, SystemPropertyKey::DEPENDS_ON_UUID).await?,
        vec![a]
    );
    Ok(())
}
