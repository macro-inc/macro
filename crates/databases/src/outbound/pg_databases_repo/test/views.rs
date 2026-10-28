//! Positions and views over Postgres: the byte order positions compare in,
//! and views and card places through the ops.

use models_databases::position::{Position, key_between, keys_between};
use models_databases::views::{
    CardPosition, Lane, LaneKey, NewView, RequestedLayout, ViewId, ViewLayout, ViewQuery,
};
use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnKind, DatabaseOp, NewColumn, NewOption, OpResult,
    OptionId, OptionRef, RowId, RowsChange, RowsResult, ViewChange, ViewResult,
};
use models_properties::service::property_value::PropertyValue;
use properties::outbound::properties_pg_repo::PropertiesPgRepo;

use super::apply_ops::{Guests, cells, edit, guests, service, viewer};
use super::*;
use crate::domain::models::OpBatch;
use crate::domain::ports::{CellStore, ColumnDefinitionStore, DatabasesService};
use crate::outbound::pg_definition_store::PgDefinitionStore;

/// Insert one row per status into the guests table, answering their ids.
async fn insert_statuses(pool: &PgPool, guests: &Guests, statuses: &[&str]) -> Vec<RowId> {
    let results = service(pool)
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Rows {
                table: guests.table_id,
                change: RowsChange::Insert {
                    rows: statuses
                        .iter()
                        .map(|status| {
                            vec![CellWrite {
                                column: guests.status,
                                value: CellValue::Options(vec![OptionRef::Label((*status).into())]),
                            }]
                        })
                        .collect(),
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    let [
        OpResult::Rows {
            change: RowsResult::Inserted { rows: inserted },
            ..
        },
    ] = results.as_slice()
    else {
        panic!("expected one insert, got {results:?}");
    };
    inserted.clone()
}

async fn row_positions(pool: &PgPool, table_id: TableId) -> Vec<(RowId, Position)> {
    PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .row_refs(table_id)
        .await
        .unwrap()
        .into_iter()
        .map(|row| (row.id, row.position))
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn positions_compare_as_bytes_as_the_keys_sort(pool: PgPool) {
    let collations = sqlx::query!(
        r#"SELECT c.relname AS "table!", co.collname AS "collation!"
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_collation co ON co.oid = a.attcollation
           WHERE a.attname = 'position'
             AND c.relname IN ('database_tables', 'database_columns', 'database_rows',
                               'database_views', 'database_view_positions')
           ORDER BY c.relname"#
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        collations
            .iter()
            .map(|row| (row.table.as_str(), row.collation.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("database_columns", "C"),
            ("database_rows", "C"),
            ("database_tables", "C"),
            ("database_view_positions", "C"),
            ("database_views", "C"),
        ]
    );

    let guests = guests(&pool).await;
    let rows = insert_statuses(&pool, &guests, &["Going"; 6]).await;
    let mut keys = keys_between(None, None, 3).unwrap();
    keys.push(key_between(None, Some(&keys[0])).unwrap());
    keys.push(key_between(Some(&keys[1]), Some(&keys[2])).unwrap());
    keys.push(key_between(Some(&"ff80".parse().unwrap()), None).unwrap());
    for (row, key) in rows.iter().zip(&keys) {
        sqlx::query!(
            "UPDATE database_rows SET position = $2 WHERE id = $1",
            row.as_uuid(),
            key.as_str()
        )
        .execute(&pool)
        .await
        .unwrap();
    }

    let stored: Vec<Position> = row_positions(&pool, guests.table_id)
        .await
        .into_iter()
        .map(|(_, position)| position)
        .collect();
    let mut sorted = keys.clone();
    sorted.sort();
    assert_eq!(stored, sorted);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_board_and_its_card_places_round_trip_and_go_with_their_rows(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Column {
                table: guests.table_id,
                column: guests.status,
                change: ColumnChange::AddOptions {
                    options: vec![NewOption {
                        id: OptionId::new(),
                        label: "Maybe".into(),
                    }],
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    let rows = insert_statuses(&pool, &guests, &["Going", "Maybe", "Going"]).await;
    let options = PgDefinitionStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .definitions(&[guests.status_definition])
        .await
        .unwrap()
        .remove(0)
        .property_options;
    let (going, maybe) = (
        OptionId::from_uuid(options[0].id),
        OptionId::from_uuid(options[1].id),
    );
    let results = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::View {
                table: guests.table_id,
                view: ViewId::new(),
                change: ViewChange::Create {
                    view: NewView {
                        name: "Stages".into(),
                        query: ViewQuery::default(),
                        layout: RequestedLayout::Board {
                            group_by: guests.status,
                            title: Some(guests.name),
                            lanes: vec![
                                Lane {
                                    key: LaneKey::Option(maybe),
                                    hidden: false,
                                },
                                Lane {
                                    key: LaneKey::Option(going),
                                    hidden: false,
                                },
                            ],
                            card_fields: vec![guests.name],
                            hide_empty_lanes: false,
                        },
                    },
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    let [
        OpResult::View {
            change: ViewResult::Created { view: board },
            ..
        },
    ] = results.as_slice()
    else {
        panic!("expected a view, got {results:?}");
    };
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    assert_eq!(
        repo.views_for_tables(&[guests.table_id]).await.unwrap(),
        vec![*board.clone()]
    );

    service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::View {
                table: guests.table_id,
                view: board.id,
                change: ViewChange::MoveCard {
                    row: rows[2],
                    lane: LaneKey::Option(maybe),
                    before: Some(rows[1]),
                    after: None,
                },
            }]
            .into(),
        )
        .await
        .unwrap();

    assert_eq!(
        repo.view_positions(board.id).await.unwrap(),
        vec![
            CardPosition {
                row: rows[1],
                lane: LaneKey::Option(maybe),
                position: "7f80".parse::<Position>().unwrap(),
            },
            CardPosition {
                row: rows[2],
                lane: LaneKey::Option(maybe),
                position: "80".parse::<Position>().unwrap(),
            },
        ]
    );
    let stored = cells(&pool).cells(&rows).await.unwrap();
    assert_eq!(
        stored[&rows[2]][&guests.status_definition],
        PropertyValue::SelectOption(vec![maybe.into_uuid()])
    );

    service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Rows {
                table: guests.table_id,
                change: RowsChange::Delete {
                    rows: vec![rows[1]],
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    assert_eq!(
        repo.view_positions(board.id).await.unwrap(),
        vec![CardPosition {
            row: rows[2],
            lane: LaneKey::Option(maybe),
            position: "80".parse::<Position>().unwrap(),
        }]
    );

    service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Column {
                table: guests.table_id,
                column: guests.status,
                change: ColumnChange::DeleteOption { option: maybe },
            }]
            .into(),
        )
        .await
        .unwrap();
    assert_eq!(repo.view_positions(board.id).await.unwrap(), vec![]);
    assert_eq!(
        repo.views_for_tables(&[guests.table_id]).await.unwrap()[0].layout,
        ViewLayout::Board {
            group_by: guests.status,
            title: guests.name,
            lanes: vec![Lane {
                key: LaneKey::Option(going),
                hidden: false,
            }],
            card_fields: vec![guests.name],
            hide_empty_lanes: false,
        }
    );

    service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::View {
                table: guests.table_id,
                view: board.id,
                change: ViewChange::Delete,
            }]
            .into(),
        )
        .await
        .unwrap();
    assert_eq!(
        repo.views_for_tables(&[guests.table_id]).await.unwrap(),
        vec![]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_a_column_rewrites_the_views_that_named_it(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let results = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::View {
                table: guests.table_id,
                view: ViewId::new(),
                change: ViewChange::Create {
                    view: NewView {
                        name: "Stages".into(),
                        query: ViewQuery::default(),
                        layout: RequestedLayout::Board {
                            group_by: guests.status,
                            title: Some(guests.name),
                            lanes: vec![],
                            card_fields: vec![guests.name],
                            hide_empty_lanes: false,
                        },
                    },
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    let [
        OpResult::View {
            change: ViewResult::Created { view: board },
            ..
        },
    ] = results.as_slice()
    else {
        panic!("expected a view, got {results:?}");
    };

    service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            OpBatch {
                ops: vec![DatabaseOp::Column {
                    table: guests.table_id,
                    column: guests.name,
                    change: ColumnChange::Delete,
                }],
                base_versions: HashMap::from([(
                    guests.table_id,
                    version_of(&pool, guests.table_id).await,
                )]),
            },
        )
        .await
        .unwrap();

    let stored = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .views_for_tables(&[guests.table_id])
        .await
        .unwrap();
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].id, board.id);
    // The board was titled by the removed Name; Status is now first.
    assert_eq!(
        stored[0].layout,
        ViewLayout::Board {
            group_by: guests.status,
            title: guests.status,
            lanes: vec![],
            card_fields: vec![],
            hide_empty_lanes: false,
        }
    );
}

async fn version_of(pool: &PgPool, table_id: TableId) -> TableVersion {
    PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .table_versions(&[table_id])
        .await
        .unwrap()[&table_id]
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_board_stored_by_an_earlier_build_reads_with_its_card_places(pool: PgPool) {
    let guests = guests(&pool).await;
    let [going, declined] = insert_statuses(&pool, &guests, &["Going", "Going"]).await[..] else {
        panic!("two guests");
    };
    let going_option = sqlx::query_scalar!(
        "SELECT id FROM property_options WHERE property_definition_id = $1",
        guests.status_definition,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let board = ViewId::new();
    sqlx::query!(
        r#"INSERT INTO database_views (id, database_id, table_id, name, position, query, layout)
           VALUES ($1, $2, $3, 'By status', '80', '{"filter": null, "sort": []}',
                   jsonb_build_object(
                       'kind', 'board',
                       'groupBy', $4::uuid,
                       'lanes', jsonb_build_array(
                           jsonb_build_object('option', $5::uuid, 'hidden', true),
                           jsonb_build_object('option', null)
                       ),
                       'cardFields', jsonb_build_array(),
                       'hideEmptyLanes', false
                   ))"#,
        board.into_uuid(),
        guests.database_id.into_uuid(),
        guests.table_id.into_uuid(),
        guests.status.into_uuid(),
        going_option,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO database_view_positions (view_id, row_id, lane, position)
           VALUES ($1, $2, $3, '80'), ($1, $4, '', '80')"#,
        board.into_uuid(),
        going.into_uuid(),
        going_option.to_string(),
        declined.into_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();

    let detail = service(&pool)
        .get_database(super::journal::view_as(USER, guests.database_id))
        .await
        .unwrap();
    let positions = service(&pool)
        .view_positions(super::journal::view_as(USER, guests.database_id), board)
        .await
        .unwrap();

    let going_lane = LaneKey::Option(OptionId::from_uuid(going_option));
    assert_eq!(
        detail.tables[0]
            .views
            .iter()
            .find(|view| view.id == board)
            .unwrap()
            .layout,
        ViewLayout::Board {
            group_by: guests.status,
            title: guests.name,
            lanes: vec![
                Lane {
                    key: going_lane.clone(),
                    hidden: true,
                },
                Lane {
                    key: LaneKey::None,
                    hidden: false,
                },
            ],
            card_fields: vec![],
            hide_empty_lanes: false,
        }
    );
    // Places read back by stored lane: the empty lane's `''` sorts first.
    assert_eq!(
        positions,
        vec![
            CardPosition {
                row: declined,
                lane: LaneKey::None,
                position: "80".parse().unwrap(),
            },
            CardPosition {
                row: going,
                lane: going_lane,
                position: "80".parse().unwrap(),
            },
        ]
    );
    assert!(
        service(&pool)
            .database_details(viewer())
            .await
            .unwrap()
            .iter()
            .any(|database| database.database.id == guests.database_id)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_card_moved_to_a_persons_lane_is_stored_under_them(pool: PgPool) {
    let guests = guests(&pool).await;
    let [sam] = insert_statuses(&pool, &guests, &["Going"]).await[..] else {
        panic!("one guest");
    };
    let host = ColumnId::new();
    let board = ViewId::new();
    service(&pool)
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![
                DatabaseOp::Column {
                    table: guests.table_id,
                    column: host,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Host".into(),
                            kind: ColumnKind::Entity {
                                target: models_databases::EntityKind::User,
                                multi: false,
                            },
                            options: vec![],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
                DatabaseOp::View {
                    table: guests.table_id,
                    view: board,
                    change: ViewChange::Create {
                        view: NewView {
                            name: "By host".into(),
                            query: ViewQuery::default(),
                            layout: RequestedLayout::Board {
                                group_by: host,
                                title: None,
                                lanes: vec![],
                                card_fields: vec![],
                                hide_empty_lanes: false,
                            },
                        },
                    },
                },
            ]
            .into(),
        )
        .await
        .unwrap();
    service(&pool)
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::View {
                table: guests.table_id,
                view: board,
                change: ViewChange::MoveCard {
                    row: sam,
                    lane: LaneKey::User("macro|sam@macro.com".try_into().unwrap()),
                    before: None,
                    after: None,
                },
            }]
            .into(),
        )
        .await
        .unwrap();

    let stored = sqlx::query_scalar!(
        "SELECT lane FROM database_view_positions WHERE view_id = $1",
        board.into_uuid(),
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let positions = service(&pool)
        .view_positions(super::journal::view_as(USER, guests.database_id), board)
        .await
        .unwrap();

    assert_eq!(stored, vec!["user:macro|sam@macro.com".to_string()]);
    assert_eq!(
        positions,
        vec![CardPosition {
            row: sam,
            lane: LaneKey::User("macro|sam@macro.com".try_into().unwrap()),
            position: "80".parse().unwrap(),
        }]
    );
}
