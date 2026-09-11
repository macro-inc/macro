use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::sync::Arc;

#[test]
fn grouped_access_shape() {
    let filter = EntityFilterAst::mock_empty();
    let grouping = GroupingConfig {
        field: GroupByField::EntityType,
        group_key: None,
        per_group_limit: None,
    };
    let (builder, _) =
        build_grouped_query(&filter, false, &grouping, SimpleSortMethod::ViewedUpdated);
    let candidates = builder.sql().split("GroupedItems AS").next().unwrap();
    assert!(!candidates.contains("AccessibleItems"));
    for (id, entity_type) in [("d.id", "document"), ("c.id", "chat"), ("p.id", "project")] {
        assert!(candidates.contains(&access_semi_join(id, entity_type)));
    }
    assert!(candidates.contains("cp.left_at IS NULL"));
    assert!(candidates.contains("event.owner_id = $1"));
    assert!(candidates.contains("link.link_id = event.source_link_id"));
    assert!(candidates.contains("link.primary_macro_id = $1"));
    assert!(candidates.contains("THEN 'TASK'::property_entity_type"));
}

#[test]
fn grouped_candidate_sort_shape() {
    for sort in [
        SimpleSortMethod::CreatedAt,
        SimpleSortMethod::UpdatedAt,
        SimpleSortMethod::ViewedAt,
        SimpleSortMethod::ViewedUpdated,
    ] {
        for group_key in [None, Some("document".to_string())] {
            let filter = EntityFilterAst::mock_empty();
            let grouping = GroupingConfig {
                field: GroupByField::Property {
                    property_definition_id: SystemPropertyKey::ASSIGNEES_UUID,
                    entity_type: Some("TASK".to_string()),
                },
                group_key,
                per_group_limit: None,
            };
            let (builder, entity_type) = build_grouped_query(&filter, true, &grouping, sort);
            let sql = builder.sql();
            let (candidates, rest) = sql.split_once("GroupedItems AS").unwrap();
            assert_eq!(entity_type.as_deref(), Some("TASK"));
            assert!(!candidates.contains("CASE $2"));
            assert!(!candidates.contains("ORDER BY all_items.sort_ts"));
            assert_eq!(
                candidates.matches("LEFT JOIN \"UserHistory\"").count(),
                if top_needs_user_history(sort) { 3 } else { 0 }
            );
            for alias in ["d", "c", "p"] {
                assert!(candidates.contains(&format!(
                    "{}::timestamptz as sort_ts",
                    top_sort_expr(alias, sort)
                )));
            }
            assert!(candidates.contains("LEFT JOIN document_sub_type dt"));
            assert!(candidates.contains("fa.id IS NULL AND ("));
            assert!(candidates.contains("(all_items.sort_ts, all_items.id::text) < ($4, $5)"));
            assert_eq!(rest.matches("LEFT JOIN \"UserHistory\"").count(), 3);
            assert!(rest.contains("COUNT(*) OVER (PARTITION BY"));
            assert!(rest.contains("ORDER BY t.sort_ts DESC, t.id DESC"));
            assert!(rest.contains("AND ep.entity_type = $10"));
            assert!(rest.contains("\"group_key\", \"sort_ts\" DESC, \"id\" DESC"));
            assert_eq!(sql.ends_with("LIMIT $3"), grouping.group_key.is_some());
            assert_eq!(
                rest.contains("row_in_group <= 10"),
                grouping.group_key.is_none()
            );
        }
    }
}

/// Bounded, synthetic diagnostic. SQLx creates an isolated database; never point
/// the test harness at a hosted database. No planner settings or timing assertions.
#[sqlx::test(
    fixtures(
        path = "../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
#[ignore = "local EXPLAIN diagnostic; run explicitly with --ignored --nocapture"]
async fn grouped_query_explain_local(pool: PgPool) -> anyhow::Result<()> {
    let ids = (0..12_000)
        .map(|_| Uuid::now_v7().to_string())
        .collect::<Vec<_>>();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "createdAt", "updatedAt")
        SELECT id, 'explain task', 'macro|user-1@test.com', '2026-01-01', '2026-01-02'
        FROM unnest($1::text[]) id ON CONFLICT DO NOTHING"#,
        &ids,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO document_sub_type (document_id, sub_type) SELECT id, 'task' FROM unnest($1::text[]) id ON CONFLICT DO NOTHING",
        &ids[..120],
    ).execute(&pool).await?;
    sqlx::query!(
        "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) SELECT id::uuid, 'document', 'macro|user-1@test.com', 'user', 'view' FROM unnest($1::text[]) id ON CONFLICT DO NOTHING",
        &ids,
    ).execute(&pool).await?;
    // Also exercise duplicate direct + inherited grants over the larger corpus.
    sqlx::query!(
        "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id) SELECT id::uuid, 'document', 'macro|user-1@test.com', 'user', 'view', 'aaaaaaaa-ffff-ffff-ffff-ffffffffffff' FROM unnest($1::text[]) id ON CONFLICT DO NOTHING",
        &ids,
    ).execute(&pool).await?;
    sqlx::query!("ANALYZE").execute(&pool).await?;
    let version = sqlx::query_scalar!("SELECT version()")
        .fetch_one(&pool)
        .await?;
    println!(
        "database={version:?}; synthetic_documents=12000; tasks=120; grants=24000; repetitions=3"
    );
    let tasks = EntityFilterAst {
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::SubType(
            DocumentSubType::Task,
        )))),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::Importance(false)))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::Importance(false)))),
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        ..EntityFilterAst::mock_empty()
    };
    for sort in [SimpleSortMethod::UpdatedAt, SimpleSortMethod::ViewedUpdated] {
        for (label, filter, field, group_key) in [
            (
                "selective_tasks",
                tasks.clone(),
                GroupByField::EntityType,
                None,
            ),
            (
                "broad_mixed",
                EntityFilterAst::mock_empty(),
                GroupByField::EntityType,
                None,
            ),
            (
                "property_initial",
                tasks.clone(),
                GroupByField::Property {
                    property_definition_id: SystemPropertyKey::ASSIGNEES_UUID,
                    entity_type: None,
                },
                None,
            ),
            (
                "continuation",
                tasks.clone(),
                GroupByField::EntityType,
                Some("document".to_string()),
            ),
        ] {
            let grouping = GroupingConfig {
                field,
                group_key,
                per_group_limit: None,
            };
            let timestamp = grouping
                .group_key
                .as_ref()
                .map(|_| "2026-01-02T00:00:00Z".parse::<DateTime<Utc>>().unwrap());
            let cursor_id = grouping.group_key.as_ref().map(|_| ids[60].clone());
            let (builder, entity_type) = build_grouped_query(&filter, false, &grouping, sort);
            // Dynamic AST/grouping SQL cannot use a compile-time macro. Mirror
            // production's positional binds, including unused reserved slots.
            let sql = format!(
                "EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) {}",
                builder.sql()
            );
            for repetition in 1..=3 {
                let mut query = sqlx::query_scalar::<_, serde_json::Value>(&sql)
                    .bind("macro|user-1@test.com")
                    .bind(sort.to_string())
                    .bind(50_i64)
                    .bind(timestamp)
                    .bind(cursor_id.clone())
                    .bind(StatusOption::COMPLETED_UUID.to_string())
                    .bind(SystemPropertyKey::STATUS_UUID)
                    .bind(SystemPropertyKey::ASSIGNEES_UUID)
                    .bind(grouping.group_key.clone());
                if let Some(ref entity_type) = entity_type {
                    query = query.bind(entity_type);
                }
                let plan = query.persistent(false).fetch_one(&pool).await?;
                println!("EXPLAIN {label} {sort} repetition={repetition}: {plan}");
            }
        }
    }
    Ok(())
}
