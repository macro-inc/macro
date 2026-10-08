use database_sql::catalog::{Catalog, Column, ColumnKind, Table as QueryTable, TableSource};
use models_databases::views::{
    Conjunction, FilterCondition, FilterGroup, FilterNode, FilterTest, NumberOperator,
    SortDirection, SortKey, ViewQuery,
};
use models_properties::service::property_value::PropertyValue;

use super::*;
use crate::domain::view_rows::{ViewRowsError, ViewRowsRepository};
use crate::outbound::pg_view_rows::PgViewRows;

async fn page_fixture(pool: &PgPool) -> (QueryTable, Vec<RowId>) {
    let (repo, table, definition) = fixture(pool).await;
    let rows = repo.insert_rows(table.id, USER, 6).await.unwrap().unwrap();
    // Creation order is deliberately unrelated to the requested number order.
    for (row, value) in
        rows.iter()
            .zip([Some(40.0), Some(10.0), None, Some(20.0), Some(10.0), None])
    {
        if let Some(value) = value {
            sqlx::query!(
                "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES ($1, $2, 'DATABASE_ROW', $3, $4)",
                macro_uuid::generate_uuid_v7(), row.id.to_string(), definition,
                serde_json::to_value(PropertyValue::Num(value)).unwrap(),
            ).execute(pool).await.unwrap();
        }
    }
    (
        QueryTable {
            id: table.id,
            database_id: table.database_id,
            database: "Summer Offsite".into(),
            name: "Guests".into(),
            source: TableSource::Database,
            columns: vec![Column {
                id: definition,
                placement: ColumnId::from_uuid(definition),
                name: "Amount".into(),
                kind: ColumnKind::Number,
                formula: None,
            }],
        },
        rows.into_iter().map(|row| row.id).collect(),
    )
}

async fn pages(pool: &PgPool, table: &QueryTable, view: &ViewQuery) -> Vec<RowId> {
    let version = sqlx::query_scalar!(
        "SELECT version FROM database_tables WHERE id = $1",
        table.id.into_uuid()
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let query = database_sql::compile_table_query(
        table.id,
        view,
        &Catalog {
            tables: vec![table.clone()],
        },
    )
    .unwrap();
    let reader = PgViewRows::new(pool.clone());
    let mut all = Vec::new();
    loop {
        let page = reader
            .page(table, &query, TableVersion(version), all.last().copied(), 2)
            .await
            .unwrap();
        if page.is_empty() {
            break;
        }
        all.extend(page);
        assert!(all.len() <= 6, "a cursor must advance");
    }
    all
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn filters_and_sorting_precede_every_page_with_stable_ties_and_nulls_last(pool: PgPool) {
    let (table, rows) = page_fixture(&pool).await;
    assert_eq!(pages(&pool, &table, &ViewQuery::default()).await, rows);
    let mut view = ViewQuery {
        filter: None,
        sort: vec![SortKey {
            column: table.columns[0].placement,
            direction: SortDirection::Ascending,
        }],
    };
    assert_eq!(
        pages(&pool, &table, &view).await,
        vec![rows[1], rows[4], rows[3], rows[0], rows[2], rows[5]]
    );
    view.sort[0].direction = SortDirection::Descending;
    assert_eq!(
        pages(&pool, &table, &view).await,
        vec![rows[0], rows[3], rows[1], rows[4], rows[2], rows[5]]
    );
    view.filter = Some(FilterGroup {
        conjunction: Conjunction::And,
        conditions: vec![FilterNode::Condition(FilterCondition {
            column: table.columns[0].placement,
            test: FilterTest::Number {
                operator: NumberOperator::LessThanOrEqual,
                value: 20.0,
            },
        })],
    });
    assert_eq!(
        pages(&pool, &table, &view).await,
        vec![rows[3], rows[1], rows[4]]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn changed_versions_cannot_continue_an_old_page(pool: PgPool) {
    let (table, _) = page_fixture(&pool).await;
    let query = database_sql::compile_table_query(
        table.id,
        &ViewQuery::default(),
        &Catalog {
            tables: vec![table.clone()],
        },
    )
    .unwrap();
    assert!(matches!(
        PgViewRows::new(pool)
            .page(&table, &query, TableVersion(-1), None, 2)
            .await,
        Err(ViewRowsError::Stale)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn formula_filters_and_sorts_cannot_read_missing_stored_cells(pool: PgPool) {
    let (mut table, _) = page_fixture(&pool).await;
    table.columns[0].formula = Some(models_databases::Formula::Number { value: 42.0 });
    for view in [
        ascending(&table),
        filtered(
            &table,
            FilterTest::Number {
                operator: NumberOperator::Is,
                value: 42.0,
            },
        ),
    ] {
        let query = database_sql::compile_table_query(
            table.id,
            &view,
            &Catalog {
                tables: vec![table.clone()],
            },
        )
        .unwrap();
        assert!(matches!(
            PgViewRows::new(pool.clone())
                .page(&table, &query, TableVersion(0), None, 2)
                .await,
            Err(ViewRowsError::InvalidQuery)
        ));
    }
}

async fn values(
    pool: &PgPool,
    table: &QueryTable,
    rows: &[RowId],
    values: Vec<Option<PropertyValue>>,
) {
    for (row, value) in rows.iter().zip(values) {
        sqlx::query!(
            "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES ($1, $2, 'DATABASE_ROW', $3, $4) ON CONFLICT (entity_id, entity_type, property_definition_id) DO UPDATE SET values = EXCLUDED.values",
            macro_uuid::generate_uuid_v7(), row.to_string(), table.columns[0].id,
            value.map(|value| serde_json::to_value(value).unwrap()),
        ).execute(pool).await.unwrap();
    }
}

fn filtered(table: &QueryTable, test: FilterTest) -> ViewQuery {
    ViewQuery {
        filter: Some(FilterGroup {
            conjunction: Conjunction::And,
            conditions: vec![FilterNode::Condition(FilterCondition {
                column: table.columns[0].placement,
                test,
            })],
        }),
        sort: vec![],
    }
}

fn ascending(table: &QueryTable) -> ViewQuery {
    ViewQuery {
        filter: None,
        sort: vec![SortKey {
            column: table.columns[0].placement,
            direction: SortDirection::Ascending,
        }],
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn text_filters_escape_wildcards_and_text_sorts_ignore_case(pool: PgPool) {
    use models_databases::views::{PresenceOperator, TextOperator};
    let (mut table, rows) = page_fixture(&pool).await;
    table.columns[0].kind = ColumnKind::Text;
    values(
        &pool,
        &table,
        &rows,
        [
            Some("beta"),
            Some("ALPHA"),
            None,
            Some("alpha"),
            Some("a_%\\z"),
            Some(""),
        ]
        .map(|value| value.map(|value| PropertyValue::Str(value.into())))
        .into(),
    )
    .await;
    assert_eq!(
        pages(&pool, &table, &ascending(&table)).await,
        vec![rows[5], rows[4], rows[1], rows[3], rows[0], rows[2]]
    );
    assert_eq!(
        pages(
            &pool,
            &table,
            &filtered(
                &table,
                FilterTest::Text {
                    operator: TextOperator::Contains,
                    value: "_%\\".into()
                }
            )
        )
        .await,
        vec![rows[4]]
    );
    assert_eq!(
        pages(
            &pool,
            &table,
            &filtered(
                &table,
                FilterTest::Text {
                    operator: TextOperator::Contains,
                    value: "AlPhA".into()
                }
            )
        )
        .await,
        vec![rows[1], rows[3]]
    );
    assert_eq!(
        pages(
            &pool,
            &table,
            &filtered(
                &table,
                FilterTest::Text {
                    operator: TextOperator::Is,
                    value: "alpha".into()
                }
            )
        )
        .await,
        vec![rows[3]]
    );
    assert_eq!(
        pages(
            &pool,
            &table,
            &filtered(
                &table,
                FilterTest::Text {
                    operator: TextOperator::IsNot,
                    value: "alpha".into()
                }
            )
        )
        .await,
        vec![rows[0], rows[1], rows[2], rows[4], rows[5]]
    );
    assert_eq!(
        pages(
            &pool,
            &table,
            &filtered(
                &table,
                FilterTest::Presence {
                    operator: PresenceOperator::IsEmpty
                }
            )
        )
        .await,
        vec![rows[2]]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn checkbox_dates_and_links_keep_the_existing_cell_semantics(pool: PgPool) {
    use models_databases::views::{DateOperator, PresenceOperator, TextOperator};
    let (mut table, rows) = page_fixture(&pool).await;
    table.columns[0].kind = ColumnKind::Boolean;
    values(
        &pool,
        &table,
        &rows,
        [Some(true), Some(false), None, Some(true), Some(false), None]
            .map(|value| value.map(PropertyValue::Bool))
            .into(),
    )
    .await;
    assert_eq!(
        pages(
            &pool,
            &table,
            &filtered(&table, FilterTest::Checkbox { checked: false })
        )
        .await,
        vec![rows[1], rows[2], rows[4], rows[5]]
    );
    assert_eq!(
        pages(&pool, &table, &ascending(&table)).await,
        vec![rows[1], rows[4], rows[0], rows[3], rows[2], rows[5]]
    );
    table.columns[0].kind = ColumnKind::Date;
    values(
        &pool,
        &table,
        &rows,
        [
            Some("2026-01-02T00:00:00Z"),
            Some("2026-01-01T00:00:00+01:00"),
            None,
            Some("2026-01-01T00:00:00Z"),
            Some("2026-01-02T00:00:00Z"),
            None,
        ]
        .map(|value| value.map(|value| PropertyValue::Date(value.parse().unwrap())))
        .into(),
    )
    .await;
    assert_eq!(
        pages(&pool, &table, &ascending(&table)).await,
        vec![rows[1], rows[3], rows[0], rows[4], rows[2], rows[5]]
    );
    assert_eq!(
        pages(
            &pool,
            &table,
            &filtered(
                &table,
                FilterTest::Date {
                    operator: DateOperator::OnOrBefore,
                    value: "2026-01-01T00:00:00Z".parse().unwrap()
                }
            )
        )
        .await,
        vec![rows[1], rows[3]]
    );
    table.columns[0].kind = ColumnKind::Link;
    values(
        &pool,
        &table,
        &rows,
        vec![
            Some(PropertyValue::Link(vec![
                "https://a.test".into(),
                "https://b.test".into(),
            ])),
            Some(PropertyValue::Link(vec![])),
            None,
            None,
            None,
            None,
        ],
    )
    .await;
    assert_eq!(
        pages(
            &pool,
            &table,
            &filtered(
                &table,
                FilterTest::Text {
                    operator: TextOperator::Is,
                    value: "https://a.test https://b.test".into()
                }
            )
        )
        .await,
        vec![rows[0]]
    );
    assert_eq!(
        pages(
            &pool,
            &table,
            &filtered(
                &table,
                FilterTest::Presence {
                    operator: PresenceOperator::IsEmpty
                }
            )
        )
        .await,
        vec![rows[2], rows[3], rows[4], rows[5]]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn select_and_entity_pages_preserve_option_rank_membership_and_empty_sets(pool: PgPool) {
    use database_sql::catalog::{EntityKind, SelectOption};
    use models_databases::{OptionId, views::SetOperator};
    use models_properties::shared::{EntityReference, EntityType};
    let (mut table, rows) = page_fixture(&pool).await;
    let first = OptionId::from_uuid(Uuid::from_u128(201));
    let second = OptionId::from_uuid(Uuid::from_u128(202));
    let options = vec![
        SelectOption {
            id: second,
            label: "Second".into(),
        },
        SelectOption {
            id: first,
            label: "First".into(),
        },
    ];
    table.columns[0].kind = ColumnKind::Select {
        multi: false,
        options: options.clone(),
    };
    values(
        &pool,
        &table,
        &rows,
        vec![
            Some(vec![first]),
            Some(vec![second]),
            None,
            Some(vec![first]),
            Some(vec![]),
            Some(vec![second]),
        ]
        .into_iter()
        .map(|value| {
            value.map(|ids| {
                PropertyValue::SelectOption(ids.into_iter().map(OptionId::into_uuid).collect())
            })
        })
        .collect(),
    )
    .await;
    assert_eq!(
        pages(&pool, &table, &ascending(&table)).await,
        vec![rows[1], rows[5], rows[0], rows[3], rows[2], rows[4]]
    );
    assert_eq!(
        pages(
            &pool,
            &table,
            &filtered(
                &table,
                FilterTest::Options {
                    operator: SetOperator::IsAnyOf,
                    options: vec![first, second],
                }
            )
        )
        .await,
        vec![rows[0], rows[1], rows[3], rows[5]]
    );
    assert_eq!(
        pages(
            &pool,
            &table,
            &filtered(
                &table,
                FilterTest::Options {
                    operator: SetOperator::IsNoneOf,
                    options: vec![second]
                }
            )
        )
        .await,
        vec![rows[0], rows[2], rows[3], rows[4]]
    );
    table.columns[0].kind = ColumnKind::Select {
        multi: true,
        options,
    };
    values(
        &pool,
        &table,
        &rows,
        vec![
            Some(vec![first, second]),
            Some(vec![second]),
            None,
            Some(vec![first]),
            Some(vec![]),
            Some(vec![second, first]),
        ]
        .into_iter()
        .map(|value| {
            value.map(|ids| {
                PropertyValue::SelectOption(ids.into_iter().map(OptionId::into_uuid).collect())
            })
        })
        .collect(),
    )
    .await;
    assert_eq!(
        pages(&pool, &table, &ascending(&table)).await,
        vec![rows[1], rows[5], rows[3], rows[0], rows[2], rows[4]]
    );
    assert_eq!(
        pages(
            &pool,
            &table,
            &filtered(
                &table,
                FilterTest::Options {
                    operator: SetOperator::HasAny,
                    options: vec![first],
                }
            )
        )
        .await,
        vec![rows[0], rows[3], rows[5]]
    );
    assert_eq!(
        pages(
            &pool,
            &table,
            &filtered(
                &table,
                FilterTest::Options {
                    operator: SetOperator::HasAll,
                    options: vec![first, second]
                }
            )
        )
        .await,
        vec![rows[0], rows[5]]
    );
    assert_eq!(
        pages(
            &pool,
            &table,
            &filtered(
                &table,
                FilterTest::Options {
                    operator: SetOperator::HasNone,
                    options: vec![first]
                }
            )
        )
        .await,
        vec![rows[1], rows[2], rows[4]]
    );
    table.columns[0].kind = ColumnKind::Entity {
        multi: true,
        target: EntityKind::User,
    };
    values(
        &pool,
        &table,
        &rows,
        vec![
            Some(vec!["Z"]),
            Some(vec!["a"]),
            None,
            Some(vec!["b", "a"]),
            Some(vec![]),
            Some(vec!["a", "b"]),
        ]
        .into_iter()
        .map(|value| {
            value.map(|ids| {
                PropertyValue::EntityRef(
                    ids.into_iter()
                        .map(|id| EntityReference {
                            entity_id: id.into(),
                            entity_type: EntityType::User,
                            specific_message_id: None,
                        })
                        .collect(),
                )
            })
        })
        .collect(),
    )
    .await;
    assert_eq!(
        pages(&pool, &table, &ascending(&table)).await,
        vec![rows[0], rows[1], rows[5], rows[3], rows[2], rows[4]]
    );
    assert_eq!(
        pages(
            &pool,
            &table,
            &filtered(
                &table,
                FilterTest::Entities {
                    operator: SetOperator::HasAny,
                    entities: vec!["a".into()],
                }
            )
        )
        .await,
        vec![rows[1], rows[3], rows[5]]
    );
    assert_eq!(
        pages(
            &pool,
            &table,
            &filtered(
                &table,
                FilterTest::Entities {
                    operator: SetOperator::HasNone,
                    entities: vec!["a".into()]
                }
            )
        )
        .await,
        vec![rows[0], rows[2], rows[4]]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unicode_case_mapping_matches_the_view_engine(pool: PgPool) {
    use models_databases::views::TextOperator;
    let (mut table, rows) = page_fixture(&pool).await;
    table.columns[0].kind = ColumnKind::Text;
    values(
        &pool,
        &table,
        &rows,
        [
            Some("ΟΣ"),
            Some("οσ"),
            Some("İ"),
            Some("i"),
            None,
            Some("É"),
        ]
        .map(|value| value.map(|value| PropertyValue::Str(value.into())))
        .into(),
    )
    .await;
    assert_eq!(
        pages(&pool, &table, &ascending(&table)).await,
        vec![rows[3], rows[2], rows[5], rows[0], rows[1], rows[4]]
    );
    assert_eq!(
        pages(
            &pool,
            &table,
            &filtered(
                &table,
                FilterTest::Text {
                    operator: TextOperator::Contains,
                    value: "ΟΣ".into()
                }
            )
        )
        .await,
        vec![rows[0]]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn date_comparisons_preserve_sub_microsecond_precision(pool: PgPool) {
    use models_databases::views::DateOperator;
    let (mut table, rows) = page_fixture(&pool).await;
    table.columns[0].kind = ColumnKind::Date;
    values(
        &pool,
        &table,
        &rows,
        [
            Some("2026-01-01T00:00:00.000000002Z"),
            Some("2026-01-01T00:00:00.000000001Z"),
            None,
            Some("2026-01-01T00:00:00Z"),
            Some("2026-01-01T00:00:00.999999999Z"),
            None,
        ]
        .map(|value| value.map(|value| PropertyValue::Date(value.parse().unwrap())))
        .into(),
    )
    .await;
    assert_eq!(
        pages(&pool, &table, &ascending(&table)).await,
        vec![rows[3], rows[1], rows[0], rows[4], rows[2], rows[5]]
    );
    assert_eq!(
        pages(
            &pool,
            &table,
            &filtered(
                &table,
                FilterTest::Date {
                    operator: DateOperator::OnOrBefore,
                    value: "2026-01-01T00:00:00.000000001Z".parse().unwrap()
                }
            )
        )
        .await,
        vec![rows[1], rows[3]]
    );
}
