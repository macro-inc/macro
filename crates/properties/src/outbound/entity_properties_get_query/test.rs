use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const PROJECT_PROPERTY: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_000000000014);

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn document_index_read_preserves_both_assignment_namespaces(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let document_id = "01980000-0000-7000-8000-00000000d001";
    for (entity_type, value) in [
        (EntityType::Document, "document project"),
        (EntityType::Task, "task project"),
        (EntityType::CalendarEvent, "event project"),
    ] {
        sqlx::query!(
            r#"
            INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
            VALUES (gen_random_uuid(), $1, $2, $3, jsonb_build_object('type', 'String', 'value', $4::text))
            "#,
            document_id,
            entity_type as EntityType,
            PROJECT_PROPERTY,
            value,
        )
        .execute(&pool)
        .await?;
    }

    for entity_type in [EntityType::Document, EntityType::Task] {
        let rows = get_entity_properties_for_index(&pool, document_id, entity_type).await?;
        assert_eq!(rows.len(), 2);
        assert!(
            rows.iter()
                .any(|p| p.definition_id == PROJECT_PROPERTY.to_string()
                    && p.entity_type.as_deref() == Some("DOCUMENT")
                    && p.values == ["document project"])
        );
        assert!(
            rows.iter()
                .any(|p| p.definition_id == PROJECT_PROPERTY.to_string()
                    && p.entity_type.as_deref() == Some("TASK")
                    && p.values == ["task project"])
        );

        let batch = get_entity_properties_for_index_batch(
            &pool,
            &[document_id.to_string(), "missing".to_string()],
            entity_type,
        )
        .await?;
        let batch_rows = &batch[document_id];
        assert_eq!(batch_rows.len(), 2);
        assert!(
            batch_rows
                .iter()
                .any(|p| p.entity_type.as_deref() == Some("DOCUMENT")
                    && p.values == ["document project"])
        );
        assert!(
            batch_rows
                .iter()
                .any(|p| p.entity_type.as_deref() == Some("TASK") && p.values == ["task project"])
        );
        assert!(!batch.contains_key("missing"));
    }

    let other =
        get_entity_properties_for_index(&pool, document_id, EntityType::CalendarEvent).await?;
    assert_eq!(other.len(), 1);
    assert_eq!(other[0].entity_type, None);
    assert_eq!(other[0].values, ["event project"]);
    Ok(())
}
