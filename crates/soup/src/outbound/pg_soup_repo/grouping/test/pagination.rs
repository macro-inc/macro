use super::*;
use crate::domain::models::grouping::ItemGroupingInfo;
use document_sub_type::DocumentSubType;
use item_filters::ast::project::ProjectLiteral;
use models_pagination::{CursorWithValAndFilter, SortOn};
use models_soup::item::SoupItem;
use uuid::Uuid;

pub(super) fn task_filter() -> EntityFilterAst {
    EntityFilterAst {
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::SubType(
            DocumentSubType::Task,
        )))),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::Importance(false)))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::Importance(false)))),
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        ..EntityFilterAst::mock_empty()
    }
}

pub(super) fn continuation(
    item: &ItemGroupingInfo,
    sort: SimpleSortMethod,
) -> Query<Uuid, SimpleSortMethod, EntityFilterAst> {
    Query::Cursor(CursorWithValAndFilter {
        id: item.item.id(),
        limit: 10,
        val: SoupItem::sort_on(sort)(&item.item),
        filter: task_filter(),
    })
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn fanout_caps_counts_and_tied_cursor_pages(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let mut ids = (0..18)
        .map(|_| Uuid::now_v7().to_string())
        .collect::<Vec<_>>();
    ids.sort();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "createdAt", "updatedAt")
        SELECT id, 'pagination task', 'macro|user-1@test.com', '2026-01-01', '2026-01-02'
        FROM unnest($1::text[]) id ON CONFLICT DO NOTHING"#,
        &ids,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "DocumentInstance" (id, "documentId", sha)
        SELECT 100 + ordinality, id, 'test' FROM unnest($1::text[]) WITH ORDINALITY AS ids(id, ordinality)
        ON CONFLICT DO NOTHING"#,
        &ids,
    ).execute(&pool).await?;
    sqlx::query!(
        "INSERT INTO document_sub_type (document_id, sub_type) SELECT id, 'task' FROM unnest($1::text[]) id ON CONFLICT DO NOTHING",
        &ids,
    ).execute(&pool).await?;
    // Test-local denormalized permissions, not production grant orchestration.
    sqlx::query!(
        "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) SELECT id::uuid, 'document', 'macro|user-1@test.com', 'user', 'view' FROM unnest($1::text[]) id ON CONFLICT DO NOTHING",
        &ids,
    ).execute(&pool).await?;
    for (index, id) in ids.iter().enumerate() {
        if index == 17 {
            continue;
        } // Missing property, empty array and scalar all map to unset.
        let values = match index {
            15 => serde_json::json!({"type": "EntityReference", "value": []}),
            16 => serde_json::json!({"type": "String", "value": "scalar"}),
            _ => serde_json::json!({"type": "EntityReference", "value": [
                {"entity_id": "a"}, {"entity_id": "b"}, {"entity_id": "c"}
            ]}),
        };
        sqlx::query!(
            "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES ($1, $2, 'TASK', $3, $4) ON CONFLICT DO NOTHING",
            Uuid::now_v7(), id, system_properties::SystemPropertyKey::ASSIGNEES_UUID, values,
        ).execute(&pool).await?;
    }
    for entity_type in [None, Some("TASK".to_string())] {
        let grouping = GroupingConfig {
            field: GroupByField::Property {
                property_definition_id: system_properties::SystemPropertyKey::ASSIGNEES_UUID,
                entity_type,
            },
            group_key: None,
            per_group_limit: None,
        };
        let fetch = |cursor, grouping| {
            expanded_dynamic_cursor_soup_grouped(
                &pool,
                GroupedDynamicCursorArgs {
                    user_id: MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap(),
                    limit: 2,
                    cursor,
                    exclude_frecency: false,
                    grouping,
                },
            )
        };
        let result = fetch(
            Query::Sort(SimpleSortMethod::UpdatedAt, task_filter()),
            grouping.clone(),
        )
        .await;
        if matches!(
            grouping.field,
            GroupByField::Property {
                entity_type: Some(_),
                ..
            }
        ) {
            // Existing API binds $10 as text, but compares it to a PostgreSQL
            // enum without a cast. Preserve this baseline error in this perf-only change.
            let error = result.unwrap_err();
            assert_eq!(
                error.as_database_error().and_then(|e| e.code()).as_deref(),
                Some("42883")
            );
            continue;
        }
        let initial = result?.collect::<Vec<_>>();
        assert_eq!(initial.len(), 33); // Three full bins plus three unset items, not a global limit of 2.
        for key in ["", "a", "b", "c"] {
            let group = initial.iter().filter(|i| i.key == key).collect::<Vec<_>>();
            let expected = if key.is_empty() {
                &ids[15..]
            } else {
                &ids[..15]
            };
            let expected = expected.iter().rev().cloned().collect::<Vec<_>>();
            assert_eq!(
                group
                    .iter()
                    .map(|i| i.item.id().to_string())
                    .collect::<Vec<_>>(),
                expected[..expected.len().min(10)]
            );
            for (index, item) in group.iter().enumerate() {
                assert_eq!(item.total_group_count, expected.len());
                assert_eq!(item.index_in_group, index + 1);
            }
            let mut seen = group
                .iter()
                .map(|i| i.item.id().to_string())
                .collect::<Vec<_>>();
            let mut cursor = continuation(group.last().unwrap(), SimpleSortMethod::UpdatedAt);
            loop {
                let page = fetch(
                    cursor,
                    GroupingConfig {
                        group_key: Some(key.to_string()),
                        ..grouping.clone()
                    },
                )
                .await?
                .collect::<Vec<_>>();
                if page.is_empty() {
                    break;
                }
                for (index, item) in page.iter().enumerate() {
                    assert_eq!(item.total_group_count, expected.len() - seen.len());
                    assert_eq!(item.index_in_group, index + 1);
                }
                cursor = continuation(page.last().unwrap(), SimpleSortMethod::UpdatedAt);
                seen.extend(page.iter().map(|i| i.item.id().to_string()));
                assert!(seen.len() <= expected.len());
            }
            assert_eq!(seen, expected);
        }
    }
    sqlx::query!(
        "INSERT INTO frecency_aggregates (entity_id, entity_type, user_id, first_event) VALUES ($1, 'document', 'macro|user-1@test.com', now()) ON CONFLICT DO NOTHING",
        &ids[0],
    ).execute(&pool).await?;
    let excluded = expanded_dynamic_cursor_soup_grouped(
        &pool,
        GroupedDynamicCursorArgs {
            user_id: MacroUserIdStr::parse_from_str("macro|user-1@test.com")?,
            limit: 50,
            cursor: Query::Sort(SimpleSortMethod::UpdatedAt, task_filter()),
            exclude_frecency: true,
            grouping: GroupingConfig {
                field: GroupByField::Property {
                    property_definition_id: system_properties::SystemPropertyKey::ASSIGNEES_UUID,
                    entity_type: None,
                },
                group_key: Some("a".to_string()),
                per_group_limit: None,
            },
        },
    )
    .await?
    .collect::<Vec<_>>();
    assert_eq!(
        excluded
            .iter()
            .map(|i| i.item.id().to_string())
            .collect::<Vec<_>>(),
        ids[1..15].iter().rev().cloned().collect::<Vec<_>>()
    );
    for (index, item) in excluded.iter().enumerate() {
        assert_eq!(item.total_group_count, 14);
        assert_eq!(item.index_in_group, index + 1);
    }
    Ok(())
}
