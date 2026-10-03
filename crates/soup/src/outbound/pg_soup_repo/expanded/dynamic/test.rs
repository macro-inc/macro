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
        assert!(candidates.contains(&access_semi_join(id, entity_type, SOURCE_IDS_SQL)));
    }
    assert!(!candidates.contains("user_source_ids"));
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
            assert!(rest.contains("AND ep.entity_type = $11"));
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
    let source_ids = user_source_ids(&pool, "macro|user-1@test.com").await?;
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
                    .bind(source_ids.clone())
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

const ORDERED_SORTS: [SimpleSortMethod; 3] = [
    SimpleSortMethod::UpdatedAt,
    SimpleSortMethod::ViewedUpdated,
    SimpleSortMethod::ViewedAt,
];

#[test]
fn ordered_documents_only_for_unfiltered_ordered_sorts() {
    let empty = EntityFilterAst::mock_empty();
    for sort in ORDERED_SORTS {
        let sql = build_query(&empty, false, sort).into_sql();
        let (candidates, _) = sql.split_once("Combined AS").unwrap();
        assert!(candidates.contains("doc_ordered_ok AS MATERIALIZED"));
        assert!(candidates.contains("NOT (SELECT ok FROM doc_ordered_ok)"));
        assert!(
            candidates.find("doc_strategy AS").unwrap() < candidates.find("TopItems AS").unwrap()
        );
    }

    let chat_notifications = EntityFilterAst {
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::NotificationState(
            item_filters::NotificationState::Unseen,
        )))),
        ..EntityFilterAst::mock_empty()
    };
    let sql = build_query(&chat_notifications, false, SimpleSortMethod::UpdatedAt).into_sql();
    assert!(sql.find("NotificationItems AS").unwrap() < sql.find("doc_strategy AS").unwrap());

    let document_filter = EntityFilterAst {
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::ProjectId(Uuid::nil())))),
        ..EntityFilterAst::mock_empty()
    };
    let properties_filter = EntityFilterAst {
        properties_filter: Some(Arc::new(Expr::val(PropertiesLiteral {
            property_definition_id: SystemPropertyKey::STATUS_UUID,
            entity_type: Some(PropertyEntityType::Document),
            value: PropertyMatchValue::SelectOption(Uuid::nil()),
        }))),
        ..EntityFilterAst::mock_empty()
    };
    for (filter, exclude_frecency, sort) in [
        (&empty, false, SimpleSortMethod::CreatedAt),
        (&empty, true, SimpleSortMethod::UpdatedAt),
        (&document_filter, false, SimpleSortMethod::ViewedUpdated),
        (&properties_filter, false, SimpleSortMethod::ViewedAt),
    ] {
        let sql = build_query(filter, exclude_frecency, sort).into_sql();
        assert!(
            !sql.contains("doc_strategy"),
            "{sort} frecency={exclude_frecency}"
        );
        assert_eq!(
            sql,
            build_query_with(filter, exclude_frecency, sort, false).into_sql()
        );
    }
}

const DENSE_USER: &str = "macro|user-1@test.com";
const OLD_GRANTS_USER: &str = "macro|user-2@test.com";
const SPARSE_USER: &str = "macro|user-3@test.com";

fn ordered_documents_seed() -> String {
    format!(
        r#"
INSERT INTO "Document" (id, name, owner, "createdAt", "updatedAt", "deletedAt")
SELECT lpad(to_hex(i), 32, '0')::uuid::text, 'ordered walk', '{DENSE_USER}', '2025-01-01',
    '2025-01-01'::timestamp + ((i * 7919 % 4000) / 2) * interval '1 minute',
    CASE WHEN i % 37 = 0 THEN '2025-06-01'::timestamp END
FROM generate_series(0, 3999) i;

INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT lpad(to_hex(i), 32, '0')::uuid, 'document', '{DENSE_USER}', 'user', 'view'
FROM generate_series(0, 3999) i WHERE i % 10 <> 0;

INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
SELECT lpad(to_hex(i), 32, '0')::uuid, 'document', '{DENSE_USER}', 'user', 'view', 'aaaaaaaa-ffff-ffff-ffff-ffffffffffff'
FROM generate_series(0, 3999) i WHERE i % 10 = 1;

INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "updatedAt")
SELECT '{DENSE_USER}', lpad(to_hex(i), 32, '0')::uuid::text, 'document',
    '2025-01-01'::timestamp + (1000 + ((i / 13) % 50) * 20) * interval '1 minute'
FROM generate_series(0, 3999) i WHERE i % 13 = 0;

INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT lpad(to_hex(i), 32, '0')::uuid, 'document', '{OLD_GRANTS_USER}', 'user', 'view'
FROM generate_series(0, 3999) i WHERE i < 2000 AND i * 7919 % 4000 < 2000;

INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT lpad(to_hex(i), 32, '0')::uuid, 'document', '{SPARSE_USER}', 'user', 'view'
FROM generate_series(0, 3999) i WHERE i % 200 = 1;

ANALYZE;
"#
    )
}

type SoupCursor = Option<(DateTime<Utc>, String)>;

async fn soup_page(
    pool: &PgPool,
    mut builder: QueryBuilder<'_, Postgres>,
    user: &str,
    sort: SimpleSortMethod,
    limit: i64,
    cursor: &SoupCursor,
) -> anyhow::Result<Vec<(String, String, DateTime<Utc>)>> {
    let (cursor_ts, cursor_id) = cursor.clone().unzip();
    let source_ids = user_source_ids(pool, user).await?;
    let rows = builder
        .build()
        .bind(user)
        .bind(sort.to_string())
        .bind(limit)
        .bind(cursor_ts)
        .bind(cursor_id)
        .bind(StatusOption::COMPLETED_UUID.to_string())
        .bind(SystemPropertyKey::STATUS_UUID)
        .bind(SystemPropertyKey::ASSIGNEES_UUID)
        .bind(source_ids)
        .persistent(false)
        .fetch_all(pool)
        .await?;
    rows.iter()
        .map(|row| {
            Ok((
                row.try_get("item_type")?,
                row.try_get("id")?,
                row.try_get("sort_ts")?,
            ))
        })
        .collect()
}

async fn doc_ordered_ok(
    pool: &PgPool,
    user: &str,
    sort: SimpleSortMethod,
    limit: i64,
    cursor: &SoupCursor,
) -> anyhow::Result<bool> {
    let strategy = ordered_document_strategy(&EntityFilterAst::mock_empty(), false, sort).unwrap();
    let mut builder = QueryBuilder::<Postgres>::new(format!(
        "{PREFIX}{} SELECT ok FROM doc_ordered_ok",
        strategy.ctes.trim_end().trim_end_matches(',')
    ));
    let (cursor_ts, cursor_id) = cursor.clone().unzip();
    let source_ids = user_source_ids(pool, user).await?;
    let row = builder
        .build()
        .bind(user)
        .bind(sort.to_string())
        .bind(limit)
        .bind(cursor_ts)
        .bind(cursor_id)
        .bind(StatusOption::COMPLETED_UUID.to_string())
        .bind(SystemPropertyKey::STATUS_UUID)
        .bind(SystemPropertyKey::ASSIGNEES_UUID)
        .bind(source_ids)
        .persistent(false)
        .fetch_one(pool)
        .await?;
    Ok(row.try_get("ok")?)
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn ordered_documents_paginate_like_probe_all(pool: PgPool) -> anyhow::Result<()> {
    sqlx::raw_sql(&ordered_documents_seed())
        .execute(&pool)
        .await?;
    let filter = EntityFilterAst::mock_empty();
    for (user, first_page_ordered, any_page_fallback) in [
        (DENSE_USER, true, false),
        (OLD_GRANTS_USER, false, true),
        (SPARSE_USER, false, true),
    ] {
        for sort in ORDERED_SORTS {
            for (limit, pages) in [(7_i64, 6), (50, 8)] {
                let mut cursor: SoupCursor = None;
                let mut ordered_by_page = Vec::new();
                for _ in 0..pages {
                    let ordered = soup_page(
                        &pool,
                        build_query(&filter, false, sort),
                        user,
                        sort,
                        limit,
                        &cursor,
                    )
                    .await?;
                    let probe_all = soup_page(
                        &pool,
                        build_query_with(&filter, false, sort, false),
                        user,
                        sort,
                        limit,
                        &cursor,
                    )
                    .await?;
                    assert_eq!(
                        ordered, probe_all,
                        "{user} {sort} limit={limit} cursor={cursor:?}"
                    );
                    ordered_by_page.push(doc_ordered_ok(&pool, user, sort, limit, &cursor).await?);
                    let Some((_, id, sort_ts)) = ordered.last() else {
                        break;
                    };
                    cursor = Some((*sort_ts, id.clone()));
                }
                let context = format!("{user} {sort} limit={limit} pages={ordered_by_page:?}");
                assert_eq!(ordered_by_page[0], first_page_ordered, "{context}");
                assert_eq!(
                    ordered_by_page.contains(&false),
                    any_page_fallback,
                    "{context}"
                );
            }
        }
    }
    Ok(())
}

#[test]
fn initiatives_are_opt_in_and_share_the_existing_sql_pagination() {
    let mut filter = EntityFilterAst::default();
    assert!(
        !build_query(&filter, false, SimpleSortMethod::UpdatedAt)
            .sql()
            .contains("FROM initiative")
    );
    filter.initiative_filter = Some(Arc::new(Expr::is_not(Expr::val(
        InitiativeLiteral::Include,
    ))));
    assert!(
        !build_query(&filter, false, SimpleSortMethod::UpdatedAt)
            .sql()
            .contains("FROM initiative")
    );
    filter.initiative_filter = Some(Arc::new(Expr::val(InitiativeLiteral::Include)));
    let query = build_query(&filter, false, SimpleSortMethod::UpdatedAt);
    let (candidates, details) = query.sql().split_once("Combined AS").unwrap();
    assert!(candidates.contains("FROM initiative i"));
    assert!(candidates.contains("LIMIT $3"));
    assert!(candidates.contains("ea.entity_type = 'initiative'"));
    assert!(candidates.contains("sp.\"linkShare\" = 'TEAM'"));
    assert!(details.contains("INNER JOIN initiative i ON i.id::text = t.id"));
}

#[test]
fn initiative_name_literals_are_escaped_and_not_like_patterns() {
    let expr = Expr::val(InitiativeLiteral::NameContains("O'Reilly_%".into()));
    let sql = build_initiative_filter(Some(&expr));
    assert!(sql.contains("'O''Reilly_%'"));
    assert!(sql.contains("strpos("));
}
