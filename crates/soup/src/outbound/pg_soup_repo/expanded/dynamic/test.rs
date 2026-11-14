use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::sync::Arc;

#[test]
fn nil_project_ids_are_impossible_but_parent_and_negated_filters_are_not() {
    let nil = Expr::val(ProjectLiteral::ProjectIdSelf(Uuid::nil()));
    let real = Expr::val(ProjectLiteral::ProjectIdSelf(Uuid::from_u128(1)));
    assert!(project_filter_is_impossible(Some(&nil)));
    assert!(project_filter_is_impossible(Some(&Expr::and(
        nil.clone(),
        real.clone()
    ))));
    assert!(!project_filter_is_impossible(Some(&Expr::or(
        nil.clone(),
        real.clone()
    ))));
    assert!(!project_filter_is_impossible(Some(&Expr::is_not(nil))));
    assert!(!project_filter_is_impossible(Some(&real)));
    assert!(!project_filter_is_impossible(Some(&Expr::val(
        ProjectLiteral::ProjectId(Uuid::nil())
    ))));
    assert!(!project_filter_is_impossible(None));
}

#[test]
fn grouped_access_shape() {
    let filter = EntityFilterAst::mock_empty();
    let grouping = GroupingConfig {
        field: GroupByField::EntityType,
        group_key: None,
        per_group_limit: None,
    };
    let sort = SimpleSortMethod::ViewedUpdated.into();
    let (builder, _) = build_grouped_query(
        &filter,
        false,
        &grouping,
        sort,
        &mut DocumentIdArrays::starting_at(first_document_id_slot(sort, true)),
    );
    let candidates = builder.sql().split("GroupedItems AS").next().unwrap();
    assert!(!candidates.contains("AccessibleItems"));
    for (id, entity_type) in [("d.id", "document"), ("c.id", "chat"), ("p.id", "project")] {
        assert!(candidates.contains(&bound_access_semi_join(
            id,
            entity_type,
            source_ids_slot(sort, true)
        )));
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
                    bucketing: None,
                },
                group_key,
                per_group_limit: None,
            };
            let (builder, entity_type) = build_grouped_query(
                &filter,
                true,
                &grouping,
                sort.into(),
                &mut DocumentIdArrays::starting_at(first_document_id_slot(sort.into(), true)),
            );
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
            assert!(candidates.contains("fa.id IS NULL AND TRUE"));
            assert!(rest.contains("(sort_ts, id::text) < ($4, $5)"));
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

#[test]
fn flat_timestamp_top_clauses_remain_lightweight() {
    let filter = EntityFilterAst::mock_empty();
    for sort in [
        SimpleSortMethod::CreatedAt,
        SimpleSortMethod::UpdatedAt,
        SimpleSortMethod::ViewedAt,
        SimpleSortMethod::ViewedUpdated,
    ] {
        let mut arrays = DocumentIdArrays::starting_at(first_document_id_slot(sort.into(), false));
        let query = build_query(&filter, false, sort.into(), &mut arrays);
        let top = query.sql().split("Combined AS").next().unwrap();
        assert!(!top.contains("JOIN document_sub_type"));
        assert!(!top.contains("property_entity_type"));
        assert!(!top.contains("as project_id"));
        assert!(!top.contains("FROM calendar_events"));
        assert!(!top.contains("sort_parameters"));
    }
    let property = DynamicSort::Property {
        property_definition_id: SystemPropertyKey::DUE_DATE_UUID,
        direction: SoupSortDirection::Asc,
    };
    let mut arrays = DocumentIdArrays::starting_at(first_document_id_slot(property, false));
    let query = build_query(&filter, false, property, &mut arrays);
    let top = query.sql().split("Combined AS").next().unwrap();
    assert!(top.contains("LEFT JOIN document_sub_type"));
    assert!(top.contains("THEN 'TASK'::property_entity_type"));
    assert!(!top.contains("as project_id"));
    assert!(!query.sql().contains("FROM calendar_events"));
}
#[test]
fn property_queries_hoist_definition_and_option_lookups() {
    let filter = EntityFilterAst::mock_empty();
    let grouping = GroupingConfig {
        field: GroupByField::Property {
            property_definition_id: SystemPropertyKey::STATUS_UUID,
            entity_type: None,
            bucketing: None,
        },
        group_key: None,
        per_group_limit: None,
    };
    for sort in [
        DynamicSort::Timestamp(SimpleSortMethod::UpdatedAt),
        DynamicSort::Property {
            property_definition_id: SystemPropertyKey::DUE_DATE_UUID,
            direction: SoupSortDirection::Asc,
        },
    ] {
        let (query, _) = build_grouped_query(
            &filter,
            false,
            &grouping,
            sort,
            &mut DocumentIdArrays::starting_at(first_document_id_slot(sort, true)),
        );
        let sql = query.sql();
        assert!(!sql.contains("JOIN property_definitions"));
        assert_eq!(sql.matches("JOIN property_options po_group").count(), 1);
        assert!(!sql.contains("SELECT po.display_order"));
        assert!(sql.contains("CASE WHEN po_group.id IS NOT NULL"));
        assert!(sql.contains("po_group.display_order::double precision"));
        assert_eq!(
            sql.contains("TopItems AS MATERIALIZED ("),
            matches!(sort, DynamicSort::Property { .. }),
        );
        if matches!(sort, DynamicSort::Property { .. }) {
            assert!(sql.contains("LEFT JOIN entity_properties ep_sort"));
            assert!(
                sql.contains("SELECT data_type FROM property_definitions WHERE id = $11::uuid")
            );
            assert!(sql.contains("LEFT JOIN LATERAL (SELECT (CASE"));
        }
    }
}

#[test]
fn option_sorts_build_one_uncorrelated_option_map() {
    let filter = EntityFilterAst::mock_empty();
    let grouping = GroupingConfig {
        field: GroupByField::EntityType,
        group_key: None,
        per_group_limit: None,
    };
    let sort = DynamicSort::Property {
        property_definition_id: SystemPropertyKey::STATUS_UUID,
        direction: SoupSortDirection::Asc,
    };
    for grouped in [false, true] {
        let mut arrays = DocumentIdArrays::starting_at(first_document_id_slot(sort, grouped));
        let query = if grouped {
            build_grouped_query(&filter, false, &grouping, sort, &mut arrays).0
        } else {
            build_query(&filter, false, sort, &mut arrays)
        };
        let parameter = if grouped { 11 } else { 9 };
        let sql = query.sql();
        assert_eq!(
            sql.matches("jsonb_object_agg(po.id::text, po.display_order)")
                .count(),
            1
        );
        assert!(sql.contains(&format!(
            "FROM property_options po WHERE po.property_definition_id = ${parameter}::uuid"
        )));
        assert!(!sql.contains("po.property_definition_id = ep_sort.property_definition_id"));
    }
}

#[test]
fn task_only_filters_omit_redundant_namespace_joins() {
    let task = Expr::val(DocumentLiteral::SubType(DocumentSubType::Task));
    let id = Expr::val(DocumentLiteral::Id(Uuid::from_u128(1)));
    assert!(!document_filter_is_task_only(None));
    for (filter, expected) in [
        (task.clone(), true),
        (Expr::and(task.clone(), id.clone()), true),
        (Expr::and(id.clone(), task.clone()), true),
        (
            Expr::or(task.clone(), Expr::and(task.clone(), id.clone())),
            true,
        ),
        (Expr::or(task.clone(), id), false),
        (Expr::is_not(task.clone()), false),
        (Expr::is_not(Expr::is_not(task.clone())), false),
        (
            Expr::and(task, Expr::val(DocumentLiteral::Importance(true))),
            true,
        ),
    ] {
        assert_eq!(document_filter_is_task_only(Some(&filter)), expected);
        let needs_task_joins = document_filter_needs_task_property_joins(Some(&filter));
        let filter = EntityFilterAst {
            document_filter: Some(Arc::new(filter)),
            ..EntityFilterAst::mock_empty()
        };
        let sort = DynamicSort::Property {
            property_definition_id: SystemPropertyKey::DUE_DATE_UUID,
            direction: SoupSortDirection::Asc,
        };
        let grouping = GroupingConfig {
            field: GroupByField::Property {
                property_definition_id: SystemPropertyKey::STATUS_UUID,
                entity_type: None,
                bucketing: None,
            },
            group_key: None,
            per_group_limit: None,
        };
        let flat = build_query(
            &filter,
            false,
            sort,
            &mut DocumentIdArrays::starting_at(first_document_id_slot(sort, false)),
        );
        let (grouped, _) = build_grouped_query(
            &filter,
            false,
            &grouping,
            sort,
            &mut DocumentIdArrays::starting_at(first_document_id_slot(sort, true)),
        );
        for query in [&flat, &grouped] {
            let top = query.sql().split(") all_items").next().unwrap();
            assert_eq!(
                top.contains("LEFT JOIN document_sub_type dt"),
                !expected || needs_task_joins
            );
            assert_eq!(
                top.contains("'TASK'::property_entity_type as property_entity_type"),
                expected
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
    let owner = sqlx::query_scalar!(r#"SELECT owner FROM "Document" WHERE id = $1"#, &ids[0])
        .fetch_one(&pool)
        .await?;
    let source_ids = fetch_user_source_ids(&mut *pool.acquire().await?, &owner).await?;
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
                    bucketing: None,
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
            let (builder, entity_type) = build_grouped_query(
                &filter,
                false,
                &grouping,
                sort.into(),
                &mut DocumentIdArrays::starting_at(first_document_id_slot(sort.into(), true)),
            );
            // Dynamic AST/grouping SQL cannot use a compile-time macro.
            // Mirror the production timestamp query's ten fixed parameters and source ids.
            let sql = format!(
                "EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) {}",
                builder.sql()
            );
            for repetition in 1..=3 {
                #[expect(
                    clippy::disallowed_methods,
                    reason = "explains SQL generated from the AST and grouping"
                )]
                let query = sqlx::query_scalar::<_, serde_json::Value>(&sql)
                    .bind("macro|user-1@test.com")
                    .bind(sort.to_string())
                    .bind(50_i64)
                    .bind(timestamp)
                    .bind(cursor_id.clone())
                    .bind(StatusOption::COMPLETED_UUID.to_string())
                    .bind(SystemPropertyKey::STATUS_UUID)
                    .bind(SystemPropertyKey::ASSIGNEES_UUID)
                    .bind(grouping.group_key.clone())
                    .bind(entity_type.clone())
                    .bind(&source_ids);
                let plan = query.persistent(false).fetch_one(&pool).await?;
                println!("EXPLAIN {label} {sort} repetition={repetition}: {plan}");
            }
        }
    }
    Ok(())
}

#[test]
fn initiatives_are_opt_in_and_share_the_existing_sql_pagination() {
    let mut filter = EntityFilterAst::default();
    assert!(
        !build_query(
            &filter,
            false,
            SimpleSortMethod::UpdatedAt.into(),
            &mut DocumentIdArrays::starting_at(9),
        )
        .sql()
        .contains("FROM initiative")
    );
    filter.initiative_filter = Some(Arc::new(Expr::is_not(Expr::val(
        InitiativeLiteral::Include,
    ))));
    assert!(
        !build_query(
            &filter,
            false,
            SimpleSortMethod::UpdatedAt.into(),
            &mut DocumentIdArrays::starting_at(9),
        )
        .sql()
        .contains("FROM initiative")
    );
    filter.initiative_filter = Some(Arc::new(Expr::val(InitiativeLiteral::Include)));
    let query = build_query(
        &filter,
        false,
        SimpleSortMethod::UpdatedAt.into(),
        &mut DocumentIdArrays::starting_at(9),
    );
    let (candidates, details) = query.sql().split_once("Combined AS").unwrap();
    assert!(candidates.contains("FROM initiative i"));
    assert!(candidates.contains("LIMIT $3"));
    assert!(candidates.contains("i.id = ANY(ARRAY("));
    assert!(candidates.contains("ea.entity_type = 'initiative'"));
    assert!(candidates.contains("sp.\"linkShare\" = 'TEAM'"));
    assert!(details.contains(
        "INNER JOIN initiative i ON i.id = (CASE WHEN t.item_type = 'initiative' THEN t.id END)::uuid"
    ));

    // A listing that names its initiatives checks each one instead.
    filter.initiative_filter = Some(Arc::new(Expr::and(
        Expr::or(
            Expr::val(InitiativeLiteral::Id(Uuid::from_u128(1))),
            Expr::val(InitiativeLiteral::Id(Uuid::from_u128(2))),
        ),
        Expr::val(InitiativeLiteral::NameContains("plan".into())),
    )));
    let named = build_query(
        &filter,
        false,
        SimpleSortMethod::UpdatedAt.into(),
        &mut DocumentIdArrays::starting_at(9),
    );
    assert!(!named.sql().contains("i.id = ANY(ARRAY("));
    assert!(named.sql().contains("WHERE ea.entity_id = i.id"));
    // Unless one branch can admit initiatives it does not name.
    filter.initiative_filter = Some(Arc::new(Expr::or(
        Expr::val(InitiativeLiteral::Id(Uuid::from_u128(1))),
        Expr::val(InitiativeLiteral::NameContains("plan".into())),
    )));
    let open = build_query(
        &filter,
        false,
        SimpleSortMethod::UpdatedAt.into(),
        &mut DocumentIdArrays::starting_at(9),
    );
    assert!(open.sql().contains("i.id = ANY(ARRAY("));
}

/// Rows a plan read from `table` (returned or filtered out) across all loops
/// of every node that scans it.
fn rows_read(node: &serde_json::Value, table: &str) -> f64 {
    let own = if node["Relation Name"] == table {
        let returned = node["Actual Rows"].as_f64().unwrap_or(0.0);
        let filtered = node["Rows Removed by Filter"].as_f64().unwrap_or(0.0);
        (returned + filtered) * node["Actual Loops"].as_f64().unwrap_or(0.0)
    } else {
        0.0
    };
    let children = node["Plans"]
        .as_array()
        .map(|plans| plans.iter().map(|plan| rows_read(plan, table)).sum())
        .unwrap_or(0.0);
    own + children
}

/// Adds `count` initiatives owned by other people, each with its owner's
/// grant: most of production's table belongs to someone else.
async fn seed_background_initiatives(pool: &PgPool, count: i32) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id)
        SELECT ('a2000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'background-' || n,
            'background-' || n || '@paths.test', 'background-stripe-' || n
        FROM generate_series(1, $1::int) n"#,
        count
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id)
        SELECT 'macro|background-' || n || '@paths.test', 'background-' || n || '@paths.test',
            ('a2000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
        FROM generate_series(1, $1::int) n"#,
        count
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "SharePermission" (id) SELECT 'background-share-' || n FROM generate_series(1, $1::int) n"#,
        count
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO initiative (id, name, owner_user_id, share_permission_id)
        SELECT ('a8000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'Background ' || n,
            'macro|background-' || n || '@paths.test', 'background-share-' || n
        FROM generate_series(1, $1::int) n"#,
        count
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT id, 'initiative', owner_user_id, 'user', 'owner'
        FROM initiative WHERE name LIKE 'Background %'"#
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// A listing of initiatives only, with the other kinds ruled out as the
/// Projects list rules them out.
fn initiative_listing(initiatives: Expr<InitiativeLiteral>) -> EntityFilterAst {
    EntityFilterAst {
        initiative_filter: Some(Arc::new(initiatives)),
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::Id(Uuid::nil())))),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::Importance(false)))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::Importance(false)))),
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        ..EntityFilterAst::mock_empty()
    }
}

/// `EXPLAIN ANALYZE` of the first page of `filter` for `viewer`, run and bound
/// as `expanded_dynamic_cursor_soup` runs it.
async fn explain_first_page(
    pool: &PgPool,
    viewer: &str,
    filter: &EntityFilterAst,
) -> anyhow::Result<serde_json::Value> {
    let sort = DynamicSort::from(SimpleSortMethod::UpdatedAt);
    let mut transaction = begin_dynamic_query(pool).await?;
    let source_ids = fetch_user_source_ids(&mut transaction, viewer).await?;
    let mut document_ids = DocumentIdArrays::starting_at(first_document_id_slot(sort, false));
    let builder = build_query(filter, false, sort, &mut document_ids);
    let sql = format!("EXPLAIN (ANALYZE, FORMAT JSON) {}", builder.sql());

    #[expect(
        clippy::disallowed_methods,
        reason = "explains SQL generated from the AST"
    )]
    let mut query = sqlx::query_scalar::<_, serde_json::Value>(&sql)
        .bind(viewer)
        .bind(sort.timestamp_method().to_string())
        .bind(50_i64)
        .bind(None::<DateTime<Utc>>)
        .bind(None::<String>)
        .bind(StatusOption::COMPLETED_UUID.to_string())
        .bind(SystemPropertyKey::STATUS_UUID)
        .bind(SystemPropertyKey::ASSIGNEES_UUID)
        .bind(&source_ids);
    for ids in document_ids.into_binds() {
        query = query.bind(ids);
    }
    Ok(query.persistent(false).fetch_one(&mut *transaction).await?)
}

#[sqlx::test(
    fixtures("../../initiative/test/access_paths.sql"),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn initiative_listing_reads_the_callers_initiatives_not_the_table(
    pool: PgPool,
) -> anyhow::Result<()> {
    seed_background_initiatives(&pool, 20_000).await?;
    sqlx::query!("ANALYZE").execute(&pool).await?;

    let plan = explain_first_page(
        &pool,
        "macro|viewer@paths.test",
        &initiative_listing(Expr::val(InitiativeLiteral::Include)),
    )
    .await?;

    // The viewer can list 8 initiatives and their team owns 17; the table holds 20,018.
    let read = rows_read(&plan[0]["Plan"], "initiative");
    println!("initiative rows read by the first page: {read}");
    assert!(
        read < 100.0,
        "the listing read {read} initiative rows; it should start from the viewer's access: {plan}"
    );
    Ok(())
}

#[sqlx::test(
    fixtures("../../initiative/test/access_paths.sql"),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn initiatives_named_by_id_check_access_per_row(pool: PgPool) -> anyhow::Result<()> {
    // The viewer can also list 5,000 initiatives other people shared with them.
    seed_background_initiatives(&pool, 5_000).await?;
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT id, 'initiative', 'macro|viewer@paths.test', 'user', 'view'
        FROM initiative WHERE name LIKE 'Background %'"#
    )
    .execute(&pool)
    .await?;
    sqlx::query!("ANALYZE").execute(&pool).await?;

    // GraphQL hydrates entities through this query, naming each initiative by
    // id, and every other request names the nil id to rule initiatives out.
    let named = [
        (
            "one initiative",
            Expr::val(InitiativeLiteral::Id(Uuid::from_u128(
                0xa7000000000000000000000000000001,
            ))),
        ),
        (
            "two initiatives",
            Expr::or(
                Expr::val(InitiativeLiteral::Id(Uuid::from_u128(
                    0xa7000000000000000000000000000002,
                ))),
                Expr::val(InitiativeLiteral::Id(Uuid::from_u128(
                    0xa7000000000000000000000000000009,
                ))),
            ),
        ),
        (
            "no initiative",
            Expr::val(InitiativeLiteral::Id(Uuid::nil())),
        ),
    ];
    for (label, initiatives) in named {
        let plan = explain_first_page(
            &pool,
            "macro|viewer@paths.test",
            &initiative_listing(initiatives),
        )
        .await?;
        let read = rows_read(&plan[0]["Plan"], "entity_access");
        println!("entity_access rows read for {label}: {read}");
        assert!(
            read < 100.0,
            "naming {label} read {read} grants; ids named up front should be checked one by one: {plan}"
        );
    }
    Ok(())
}

#[test]
fn initiative_name_literals_are_escaped_and_not_like_patterns() {
    let expr = Expr::val(InitiativeLiteral::NameContains("O'Reilly_%".into()));
    let sql = build_initiative_filter(Some(&expr));
    assert!(sql.contains("'O''Reilly_%'"));
    assert!(sql.contains("strpos("));
}

mod name_sort;
mod property_sort;

#[test]
fn notification_conjunction_folds_to_the_side_that_implies_the_other() {
    use item_filters::NotificationState::{Done, Seen, Unseen};
    let state = |state| Expr::val(DocumentLiteral::NotificationState(state));
    let inbox = || Expr::or(state(Unseen), state(Seen));
    let strip = |expr: &Expr<DocumentLiteral>| {
        strip_notification_conjunction(expr, |literal| match literal {
            DocumentLiteral::NotificationState(state) => Some(NotificationPredicate::state(*state)),
            _ => None,
        })
    };

    // The unread feed: `(unseen OR seen) AND unseen` needs only the unseen witness.
    let (predicate, rest) = strip(&Expr::and(inbox(), state(Unseen))).unwrap();
    assert_eq!(predicate, NotificationPredicate::state(Unseen));
    assert!(rest.is_none());

    let (predicate, rest) = strip(&Expr::and(
        Expr::and(state(Unseen), Expr::val(DocumentLiteral::Importance(true))),
        inbox(),
    ))
    .unwrap();
    assert_eq!(predicate, NotificationPredicate::state(Unseen));
    assert!(matches!(
        rest,
        Some(Expr::Literal(DocumentLiteral::Importance(true)))
    ));

    // Neither side implies the other: different rows may witness each.
    assert!(strip(&Expr::and(state(Unseen), state(Seen))).is_none());
    assert!(strip(&Expr::and(inbox(), state(Done))).is_none());
}
