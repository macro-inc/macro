use super::*;
use crate::domain::models::{
    DynamicSort, SoupProjectionHydration, SoupSortDirection, grouping::ItemGroupingInfo,
};
use chrono::{DateTime, Utc};
use item_filters::ast::{
    calendar_event::CalendarEventLiteral, chat::ChatLiteral, document::DocumentLiteral,
    project::ProjectLiteral,
};
use models_grouping::{PropertyBucketing, PropertyDateRange, PropertyDateRanges};
use models_pagination::{
    CursorVal, CursorWithValAndFilter, Identify, Query, SimpleSortMethod, SortOn,
};
use serde_json::{Value, json};

const A: Uuid = uuid::uuid!("11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const B: Uuid = uuid::uuid!("11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
const C: Uuid = uuid::uuid!("11111111-cccc-cccc-cccc-cccccccccccc");
const D: Uuid = uuid::uuid!("11111111-dddd-dddd-dddd-dddddddddddd");
const UNSET: Uuid = uuid::uuid!("11111111-0000-0000-0000-000000000000");

fn documents() -> EntityFilterAst {
    EntityFilterAst {
        document_filter: [A, B, C, D, UNSET]
            .into_iter()
            .map(|id| Expr::val(DocumentLiteral::Id(id)))
            .reduce(Expr::or)
            .map(Arc::new),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::Importance(false)))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::Importance(false)))),
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        ..EntityFilterAst::mock_empty()
    }
}

async fn seed_property(
    pool: &PgPool,
    data_type: &str,
    first: Value,
    second: Value,
) -> anyhow::Result<Uuid> {
    let property_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO property_definitions (id, user_id, display_name, data_type, is_multi_select)
           SELECT $1, owner, $2, $3::text::property_data_type, false FROM "Document" WHERE id = $4"#,
        property_id,
        format!("Sort {property_id}"),
        data_type,
        A.to_string(),
    )
    .execute(pool)
    .await?;
    for (id, value) in [
        (A, Some(first)),
        (B, Some(second)),
        // A valid-looking payload under the wrong tag never supplies a sort key.
        (C, Some(json!({"type": "String", "value": "999"}))),
        (D, None),
    ] {
        sqlx::query!(
            "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES ($1, $2, 'DOCUMENT', $3, $4)",
            Uuid::now_v7(),
            id.to_string(),
            property_id,
            value,
        )
        .execute(pool)
        .await?;
    }
    Ok(property_id)
}

fn sort(property_definition_id: Uuid, direction: SoupSortDirection) -> DynamicSort {
    DynamicSort::Property {
        property_definition_id,
        direction,
    }
}

fn continuation(
    id: Uuid,
    key: Option<f64>,
    timestamp: DateTime<Utc>,
    sort: DynamicSort,
) -> Query<Uuid, DynamicSort, EntityFilterAst> {
    Query::Cursor(CursorWithValAndFilter {
        id,
        limit: 2,
        val: CursorVal {
            sort_type: sort,
            last_val: sort.position(key, timestamp),
        },
        filter: documents(),
    })
}

async fn flat(
    pool: &PgPool,
    cursor: Query<Uuid, DynamicSort, EntityFilterAst>,
    limit: u16,
) -> anyhow::Result<Vec<SoupProjectionHydration>> {
    let user_id = sqlx::query_scalar!(
        r#"SELECT owner FROM "Document" WHERE id = $1"#,
        A.to_string()
    )
    .fetch_one(pool)
    .await?;
    Ok(expanded_dynamic_cursor_soup_with_projection(
        pool,
        ExpandedDynamicCursorArgs {
            user_id: MacroUserIdStr::parse_from_str(&user_id)?,
            limit,
            cursor,
            exclude_frecency: false,
        },
    )
    .await?)
}

async fn grouped(
    pool: &PgPool,
    cursor: Query<Uuid, DynamicSort, EntityFilterAst>,
    field: GroupByField,
    group_key: Option<&str>,
    limit: u16,
) -> anyhow::Result<Vec<ItemGroupingInfo>> {
    let user_id = sqlx::query_scalar!(
        r#"SELECT owner FROM "Document" WHERE id = $1"#,
        A.to_string()
    )
    .fetch_one(pool)
    .await?;
    Ok(expanded_dynamic_cursor_soup_grouped(
        pool,
        GroupedDynamicCursorArgs {
            user_id: MacroUserIdStr::parse_from_str(&user_id)?,
            limit,
            cursor,
            exclude_frecency: false,
            grouping: GroupingConfig {
                field,
                group_key: group_key.map(str::to_owned),
                per_group_limit: None,
            },
        },
    )
    .await?
    .collect())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn property_sort_flat_and_grouped_pages_preserve_keys_and_missing_values(
    pool: PgPool,
) -> anyhow::Result<()> {
    for data_type in [
        "DATE",
        "NUMBER",
        "BOOLEAN",
        "SELECT_STRING",
        "SELECT_NUMBER",
        "TAG",
    ] {
        let (first, second) = match data_type {
            "DATE" => (
                json!({"type":"Date","value":"2025-01-01T00:00:00Z"}),
                json!({"type":"Date","value":"2025-02-01T00:00:00Z"}),
            ),
            "NUMBER" => (
                json!({"type":"Number","value":10}),
                json!({"type":"Number","value":20}),
            ),
            "BOOLEAN" => (
                json!({"type":"Boolean","value":false}),
                json!({"type":"Boolean","value":true}),
            ),
            _ => {
                let early = Uuid::now_v7();
                let middle = Uuid::now_v7();
                let late = Uuid::now_v7();
                let deleted = Uuid::now_v7();
                // Keep options tied to the definition inserted below.
                let property_id = Uuid::now_v7();
                sqlx::query!(
                    r#"INSERT INTO property_definitions (id, user_id, display_name, data_type, is_multi_select)
                       SELECT $1, owner, $2, $3::text::property_data_type, true FROM "Document" WHERE id = $4"#,
                    property_id, format!("Sort {property_id}"), data_type, A.to_string(),
                ).execute(&pool).await?;
                for (id, order) in [(early, 1), (middle, 2), (late, 3), (deleted, 0)] {
                    if data_type == "SELECT_NUMBER" {
                        sqlx::query!(
                            "INSERT INTO property_options (id, property_definition_id, display_order, number_value) VALUES ($1, $2, $3, $4)",
                            id, property_id, order, f64::from(order),
                        ).execute(&pool).await?;
                    } else {
                        sqlx::query!(
                            "INSERT INTO property_options (id, property_definition_id, display_order, string_value) VALUES ($1, $2, $3, $4)",
                            id, property_id, order, id.to_string(),
                        ).execute(&pool).await?;
                    }
                }
                for (id, value) in [
                    (
                        A,
                        Some(json!({"type":"SelectOption","value":[late, middle]})),
                    ),
                    (B, Some(json!({"type":"SelectOption","value":[early]}))),
                    (C, Some(json!({"type":"String","value":"999"}))),
                    (D, None),
                ] {
                    sqlx::query!(
                        "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES ($1, $2, 'DOCUMENT', $3, $4)",
                        Uuid::now_v7(), id.to_string(), property_id, value,
                    ).execute(&pool).await?;
                }
                for direction in [SoupSortDirection::Asc, SoupSortDirection::Desc] {
                    check_pages(&pool, data_type, property_id, direction, 2.0, 1.0).await?;
                }
                let option_groups = grouped(
                    &pool,
                    Query::Sort(sort(property_id, SoupSortDirection::Asc), documents()),
                    GroupByField::Property {
                        property_definition_id: property_id,
                        entity_type: None,
                        bucketing: None,
                    },
                    None,
                    10,
                )
                .await?;
                assert_eq!(
                    option_groups
                        .iter()
                        .map(|item| (item.key.as_str(), item.item.id()))
                        .collect::<Vec<_>>(),
                    [
                        (early.to_string(), B),
                        (middle.to_string(), A),
                        (late.to_string(), A),
                        (String::new(), UNSET),
                        (String::new(), D),
                        (String::new(), C)
                    ]
                    .iter()
                    .map(|(key, id)| (key.as_str(), *id))
                    .collect::<Vec<_>>()
                );
                sqlx::query!("DELETE FROM property_options WHERE id = $1", deleted)
                    .execute(&pool)
                    .await?;
                // Deleted and malformed IDs do not lower A's key or give C a key.
                for (id, value) in [
                    (
                        A,
                        json!({"type":"SelectOption","value":[late, deleted, "not-a-uuid", middle]}),
                    ),
                    (
                        C,
                        json!({"type":"SelectOption","value":[deleted, "not-a-uuid", Uuid::now_v7()]}),
                    ),
                ] {
                    sqlx::query!(
                        "UPDATE entity_properties SET values = $1 WHERE entity_id = $2 AND property_definition_id = $3",
                        value, id.to_string(), property_id,
                    ).execute(&pool).await?;
                }
                for direction in [SoupSortDirection::Asc, SoupSortDirection::Desc] {
                    check_pages(&pool, data_type, property_id, direction, 2.0, 1.0).await?;
                }
                continue;
            }
        };
        let property_id = seed_property(&pool, data_type, first, second).await?;
        let (a, b) = match data_type {
            "DATE" => (1735689600.0 * 1_000_000.0, 1738368000.0 * 1_000_000.0),
            "NUMBER" => (10.0, 20.0),
            "BOOLEAN" => (0.0, 1.0),
            _ => unreachable!(),
        };
        for direction in [SoupSortDirection::Asc, SoupSortDirection::Desc] {
            check_pages(&pool, data_type, property_id, direction, a, b).await?;
        }
    }
    Ok(())
}

async fn check_pages(
    pool: &PgPool,
    label: &str,
    property_id: Uuid,
    direction: SoupSortDirection,
    a: f64,
    b: f64,
) -> anyhow::Result<()> {
    let order = if (a < b) == (direction == SoupSortDirection::Asc) {
        [A, B, UNSET, D, C]
    } else {
        [B, A, UNSET, D, C]
    };
    let selected_sort = sort(property_id, direction);
    let mut cursor = Query::Sort(selected_sort, documents());
    let mut seen = Vec::new();
    for _ in 0..4 {
        let page = flat(pool, cursor, 2).await?;
        if page.is_empty() {
            break;
        }
        for item in &page {
            let id = item.item.id();
            let key = match id {
                A => Some(a),
                B => Some(b),
                _ => None,
            };
            assert_eq!(item.sort_key, key, "{label} {direction:?} {id}");
            seen.push(id);
        }
        let last = page.last().unwrap();
        cursor = continuation(
            last.item.id(),
            last.sort_key,
            SoupItem::sort_on(SimpleSortMethod::UpdatedAt)(&last.item).last_val,
            selected_sort,
        );
    }
    assert_eq!(seen, order, "flat {label} {direction:?}");

    let initial = grouped(
        pool,
        Query::Sort(selected_sort, documents()),
        GroupByField::EntityType,
        None,
        2,
    )
    .await?;
    assert_eq!(
        initial
            .iter()
            .map(|item| item.item.id())
            .collect::<Vec<_>>(),
        order,
        "grouped {label} {direction:?}"
    );
    assert!(
        initial
            .iter()
            .all(|item| item.key == "document" && item.total_group_count == 5)
    );
    for (index, item) in initial.iter().enumerate() {
        assert_eq!(item.index_in_group, index + 1);
    }
    let mut cursor = Query::Sort(selected_sort, documents());
    let mut seen = Vec::new();
    for _ in 0..4 {
        let page = grouped(pool, cursor, GroupByField::EntityType, Some("document"), 2).await?;
        if page.is_empty() {
            break;
        }
        for item in &page {
            assert_eq!(item.total_group_count, 5);
            assert_eq!(item.index_in_group, seen.len() + 1);
            seen.push(item.item.id());
        }
        let last = page.last().unwrap();
        cursor = continuation(
            last.item.id(),
            last.sort_key,
            SoupItem::sort_on(SimpleSortMethod::UpdatedAt)(&last.item).last_val,
            selected_sort,
        );
    }
    assert_eq!(seen, order, "grouped continuation {label} {direction:?}");
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn property_date_ranges_keep_full_totals_and_missing_bucket(
    pool: PgPool,
) -> anyhow::Result<()> {
    let property_id = seed_property(
        &pool,
        "DATE",
        json!({"type":"Date","value":"2025-01-01T00:00:00Z"}),
        json!({"type":"Date","value":"2025-02-01T00:00:00Z"}),
    )
    .await?;
    let boundary = "2025-02-01T00:00:00Z".parse::<DateTime<Utc>>()?;
    let field = GroupByField::Property {
        property_definition_id: property_id,
        entity_type: Some("DOCUMENT".into()),
        bucketing: Some(PropertyBucketing::DateRanges(PropertyDateRanges {
            ranges: vec![
                PropertyDateRange {
                    key: "before".into(),
                    start: None,
                    end: Some(boundary),
                },
                PropertyDateRange {
                    key: "after".into(),
                    start: Some(boundary),
                    end: None,
                },
            ],
            missing_value_bucket_key: "missing".into(),
        })),
    };
    let selected_sort = sort(property_id, SoupSortDirection::Asc);
    let initial = grouped(
        &pool,
        Query::Sort(selected_sort, documents()),
        field.clone(),
        None,
        1,
    )
    .await?;
    assert_eq!(
        initial
            .iter()
            .map(|item| (
                item.key.as_str(),
                item.item.id(),
                item.total_group_count,
                item.index_in_group
            ))
            .collect::<Vec<_>>(),
        [
            ("missing", UNSET, 3, 1),
            ("missing", D, 3, 2),
            ("missing", C, 3, 3),
            ("before", A, 1, 1),
            ("after", B, 1, 1)
        ]
    );
    let first = grouped(
        &pool,
        Query::Sort(selected_sort, documents()),
        field.clone(),
        Some("missing"),
        1,
    )
    .await?;
    assert_eq!(
        (
            first[0].item.id(),
            first[0].total_group_count,
            first[0].index_in_group
        ),
        (UNSET, 3, 1)
    );
    let second = grouped(
        &pool,
        continuation(
            first[0].item.id(),
            first[0].sort_key,
            SoupItem::sort_on(SimpleSortMethod::UpdatedAt)(&first[0].item).last_val,
            selected_sort,
        ),
        field,
        Some("missing"),
        1,
    )
    .await?;
    assert_eq!(
        (
            second[0].item.id(),
            second[0].total_group_count,
            second[0].index_in_group
        ),
        (D, 3, 2)
    );
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn grouped_property_pages_cross_missing_values_in_both_directions(
    pool: PgPool,
) -> anyhow::Result<()> {
    let property_id = seed_property(
        &pool,
        "NUMBER",
        json!({"type": "Number", "value": 10}),
        json!({"type": "Number", "value": 20}),
    )
    .await?;
    for (direction, expected) in [
        (SoupSortDirection::Asc, [A, B, UNSET, D, C]),
        (SoupSortDirection::Desc, [B, A, UNSET, D, C]),
    ] {
        let selected_sort = sort(property_id, direction);
        let mut cursor = Query::Sort(selected_sort, documents());
        for (index, id) in expected.into_iter().enumerate() {
            let page =
                grouped(&pool, cursor, GroupByField::EntityType, Some("document"), 1).await?;
            assert_eq!(page.len(), 1);
            assert_eq!(page[0].item.id(), id);
            assert_eq!(page[0].index_in_group, index + 1);
            assert_eq!(page[0].total_group_count, 5);
            cursor = continuation(
                id,
                page[0].sort_key,
                SoupItem::sort_on(SimpleSortMethod::UpdatedAt)(&page[0].item).last_val,
                selected_sort,
            );
        }
        assert!(
            grouped(&pool, cursor, GroupByField::EntityType, Some("document"), 1)
                .await?
                .is_empty()
        );
    }
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn deleted_options_use_the_empty_group_and_live_options_follow_display_order(
    pool: PgPool,
) -> anyhow::Result<()> {
    let property_id = Uuid::now_v7();
    let first = Uuid::now_v7();
    let second = Uuid::now_v7();
    let deleted = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO property_definitions (id, user_id, display_name, data_type, is_multi_select)
           SELECT $1, owner, $2, 'SELECT_STRING', false FROM "Document" WHERE id = $3"#,
        property_id,
        format!("Sort {property_id}"),
        A.to_string(),
    )
    .execute(&pool)
    .await?;
    for (id, order) in [(first, 20), (second, 10), (deleted, 0)] {
        sqlx::query!(
            "INSERT INTO property_options (id, property_definition_id, display_order, string_value) VALUES ($1, $2, $3, $4)",
            id, property_id, order, id.to_string(),
        )
        .execute(&pool)
        .await?;
    }
    for (id, option) in [(A, first), (B, second), (C, deleted)] {
        sqlx::query!(
            "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES ($1, $2, 'DOCUMENT', $3, $4)",
            Uuid::now_v7(), id.to_string(), property_id,
            json!({"type": "SelectOption", "value": [option]}),
        )
        .execute(&pool)
        .await?;
    }
    sqlx::query!("DELETE FROM property_options WHERE id = $1", deleted)
        .execute(&pool)
        .await?;

    let items = grouped(
        &pool,
        Query::Sort(sort(property_id, SoupSortDirection::Asc), documents()),
        GroupByField::Property {
            property_definition_id: property_id,
            entity_type: None,
            bucketing: None,
        },
        None,
        10,
    )
    .await?;
    assert_eq!(
        items
            .iter()
            .map(|item| (item.key.clone(), item.item.id(), item.display_order))
            .collect::<Vec<_>>(),
        vec![
            (second.to_string(), B, Some(10)),
            (first.to_string(), A, Some(20)),
            (String::new(), UNSET, None),
            (String::new(), D, None),
            (String::new(), C, None),
        ]
    );
    assert!(items[2..].iter().all(|item| item.total_group_count == 3));
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn mixed_task_and_document_filters_use_canonical_property_assignments(
    pool: PgPool,
) -> anyhow::Result<()> {
    let early = Uuid::now_v7();
    let middle = Uuid::now_v7();
    let late = Uuid::now_v7();
    let property_id = seed_property(
        &pool,
        "SELECT_STRING",
        json!({"type": "SelectOption", "value": [middle]}),
        json!({"type": "SelectOption", "value": [late]}),
    )
    .await?;
    for (id, order) in [(early, 1), (middle, 2), (late, 3)] {
        sqlx::query!(
            "INSERT INTO property_options (id, property_definition_id, display_order, string_value) VALUES ($1, $2, $3, $4)",
            id, property_id, order, id.to_string(),
        )
        .execute(&pool)
        .await?;
    }
    for id in [A, C] {
        sqlx::query!(
            "INSERT INTO document_sub_type (document_id, sub_type) VALUES ($1, 'task')",
            id.to_string(),
        )
        .execute(&pool)
        .await?;
    }
    sqlx::query!(
        "UPDATE entity_properties SET entity_type = 'TASK' WHERE entity_id = $1 AND property_definition_id = $2",
        A.to_string(), property_id,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "UPDATE entity_properties SET values = $1 WHERE entity_id = $2 AND property_definition_id = $3",
        json!({"type": "SelectOption", "value": [early]}), C.to_string(), property_id,
    )
    .execute(&pool)
    .await?;
    for (id, entity_type) in [(A, "DOCUMENT"), (B, "TASK")] {
        sqlx::query!(
            "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES ($1, $2, $3::text::property_entity_type, $4, $5)",
            Uuid::now_v7(), id.to_string(), entity_type, property_id,
            json!({"type": "SelectOption", "value": [early]}),
        )
        .execute(&pool)
        .await?;
    }
    let mut filter = documents();
    filter.document_filter = Some(Arc::new(Expr::or(
        Expr::and(
            Expr::val(DocumentLiteral::SubType(
                document_sub_type::DocumentSubType::Task,
            )),
            Expr::or(
                Expr::val(DocumentLiteral::Id(A)),
                Expr::val(DocumentLiteral::Id(C)),
            ),
        ),
        Expr::val(DocumentLiteral::Id(B)),
    )));

    for (direction, expected) in [
        (
            SoupSortDirection::Asc,
            [(A, Some(2.0)), (B, Some(3.0)), (C, None)],
        ),
        (
            SoupSortDirection::Desc,
            [(B, Some(3.0)), (A, Some(2.0)), (C, None)],
        ),
    ] {
        let items = flat(
            &pool,
            Query::Sort(sort(property_id, direction), filter.clone()),
            10,
        )
        .await?;
        assert_eq!(
            items
                .iter()
                .map(|item| (item.item.id(), item.sort_key))
                .collect::<Vec<_>>(),
            expected,
        );
    }
    let mut task_filter = filter.clone();
    task_filter.document_filter = Some(Arc::new(Expr::and(
        Expr::val(DocumentLiteral::SubType(
            document_sub_type::DocumentSubType::Task,
        )),
        Expr::or(
            Expr::val(DocumentLiteral::Id(A)),
            Expr::val(DocumentLiteral::Id(C)),
        ),
    )));
    let task_items = flat(
        &pool,
        Query::Sort(
            sort(property_id, SoupSortDirection::Asc),
            task_filter.clone(),
        ),
        10,
    )
    .await?;
    assert_eq!(
        task_items
            .iter()
            .map(|item| (item.item.id(), item.sort_key))
            .collect::<Vec<_>>(),
        [(A, Some(2.0)), (C, None)],
    );
    let task_groups = grouped(
        &pool,
        Query::Sort(sort(property_id, SoupSortDirection::Asc), task_filter),
        GroupByField::Property {
            property_definition_id: property_id,
            entity_type: None,
            bucketing: None,
        },
        None,
        10,
    )
    .await?;
    assert_eq!(
        task_groups
            .iter()
            .map(|item| (item.key.clone(), item.item.id()))
            .collect::<Vec<_>>(),
        [(middle.to_string(), A), (String::new(), C)],
    );
    for (entity_type, expected) in [
        (
            None,
            vec![
                (middle.to_string(), A),
                (late.to_string(), B),
                (String::new(), C),
            ],
        ),
        (
            Some("TASK"),
            vec![(middle.to_string(), A), (String::new(), C)],
        ),
        (Some("DOCUMENT"), vec![(late.to_string(), B)]),
    ] {
        let items = grouped(
            &pool,
            Query::Sort(sort(property_id, SoupSortDirection::Asc), filter.clone()),
            GroupByField::Property {
                property_definition_id: property_id,
                entity_type: entity_type.map(str::to_owned),
                bucketing: None,
            },
            None,
            10,
        )
        .await?;
        assert_eq!(
            items
                .iter()
                .map(|item| (item.key.clone(), item.item.id()))
                .collect::<Vec<_>>(),
            expected,
            "entity_type={entity_type:?}",
        );
    }
    Ok(())
}
