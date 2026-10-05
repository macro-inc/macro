//! Structural undo preserves net changes and later collaborators' work.

use super::*;
use models_databases::{ColumnId, ColumnKind, NewColumn, NewOption, OptionId, TableChange};
use uuid::Uuid;

async fn board(pool: &PgPool, wedding: &Wedding) -> ViewId {
    let view = ViewId::from_uuid(Uuid::now_v7());
    change_as(
        pool,
        wedding,
        WOLF,
        vec![DatabaseOp::View {
            table: wedding.table_id,
            view,
            change: ViewChange::Create {
                view: NewView {
                    name: "Board".into(),
                    query: ViewQuery::default(),
                    layout: RequestedLayout::Board {
                        group_by: wedding.rsvp,
                        title: Some(wedding.name),
                        lanes: vec![],
                        card_fields: vec![],
                        hide_empty_lanes: false,
                    },
                },
            },
        }],
    )
    .await;
    view
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn repeated_column_renames_including_a_final_noop_undo_the_net_change(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let change = change_as(
        &pool,
        &wedding,
        WOLF,
        ["First", "Second", "Second"]
            .into_iter()
            .map(|name| DatabaseOp::Column {
                table: wedding.table_id,
                column: wedding.name,
                change: ColumnChange::Rename {
                    name: name.into(),
                    previous_name: None,
                },
            })
            .collect(),
    )
    .await;
    assert!(matches!(
        undo_as(&pool, &wedding, WOLF, change).await,
        UndoOutcome::Reverted { .. }
    ));
    change_as(
        &pool,
        &wedding,
        WOLF,
        vec![DatabaseOp::Column {
            table: wedding.table_id,
            column: wedding.name,
            change: ColumnChange::Rename {
                name: "Verified".into(),
                previous_name: Some("Name".into()),
            },
        }],
    )
    .await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn repeated_reorders_undo_the_final_order(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let before = table_state(&pool, wedding.table_id).await;
    let change = change_as(
        &pool,
        &wedding,
        WOLF,
        vec![
            DatabaseOp::Table {
                table: wedding.table_id,
                change: TableChange::ReorderColumns {
                    order: vec![wedding.rsvp, wedding.name, wedding.plus_ones],
                },
            },
            DatabaseOp::Table {
                table: wedding.table_id,
                change: TableChange::ReorderColumns {
                    order: vec![wedding.plus_ones, wedding.rsvp, wedding.name],
                },
            },
        ],
    )
    .await;
    assert!(matches!(
        undo_as(&pool, &wedding, WOLF, change).await,
        UndoOutcome::Reverted { .. }
    ));
    assert_eq!(table_state(&pool, wedding.table_id).await, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn undoing_column_creation_preserves_a_collaborators_rename(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let column = ColumnId::from_uuid(Uuid::now_v7());
    let change = change_as(
        &pool,
        &wedding,
        WOLF,
        vec![DatabaseOp::Column {
            table: wedding.table_id,
            column,
            change: ColumnChange::Create {
                definition: NewColumn::New {
                    name: "Extra".into(),
                    kind: ColumnKind::Text,
                    options: vec![],
                    infer_type: false,
                },
                after: None,
            },
        }],
    )
    .await;
    change_as(
        &pool,
        &wedding,
        JULIA,
        vec![DatabaseOp::Column {
            table: wedding.table_id,
            column,
            change: ColumnChange::Rename {
                name: "Important".into(),
                previous_name: None,
            },
        }],
    )
    .await;
    let before = table_state(&pool, wedding.table_id).await;
    assert!(matches!(
        undo_as(&pool, &wedding, WOLF, change).await,
        UndoOutcome::Refused {
            reason: UndoRefusal::ChangedSince,
            ..
        }
    ));
    assert_eq!(table_state(&pool, wedding.table_id).await, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_two_selected_options_restores_them_before_the_cell(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (row, _) = insert_guests(&pool, &wedding).await;
    let column = ColumnId::from_uuid(Uuid::now_v7());
    let a = OptionId::from_uuid(Uuid::now_v7());
    let b = OptionId::from_uuid(Uuid::now_v7());
    change_as(
        &pool,
        &wedding,
        WOLF,
        vec![DatabaseOp::Column {
            table: wedding.table_id,
            column,
            change: ColumnChange::Create {
                definition: NewColumn::New {
                    name: "Tags".into(),
                    kind: ColumnKind::Select { multi: true },
                    options: vec![
                        NewOption {
                            id: a,
                            label: "A".into(),
                        },
                        NewOption {
                            id: b,
                            label: "B".into(),
                        },
                    ],
                    infer_type: false,
                },
                after: None,
            },
        }],
    )
    .await;
    change_as(
        &pool,
        &wedding,
        WOLF,
        set_cells(
            &wedding,
            row,
            vec![CellWrite {
                column,
                value: CellValue::Options(vec![OptionRef::Id(a), OptionRef::Id(b)]),
            }],
        ),
    )
    .await;
    let before = table_state(&pool, wedding.table_id).await;
    // First verify the surviving selection is a correct after-image.
    let one = change_as(
        &pool,
        &wedding,
        WOLF,
        vec![DatabaseOp::Column {
            table: wedding.table_id,
            column,
            change: ColumnChange::DeleteOption { option: a },
        }],
    )
    .await;
    assert!(matches!(
        undo_as(&pool, &wedding, WOLF, one).await,
        UndoOutcome::Reverted { .. }
    ));
    assert_eq!(table_state(&pool, wedding.table_id).await, before);
    let both = change_as(
        &pool,
        &wedding,
        WOLF,
        [a, b]
            .into_iter()
            .map(|option| DatabaseOp::Column {
                table: wedding.table_id,
                column,
                change: ColumnChange::DeleteOption { option },
            })
            .collect(),
    )
    .await;
    assert!(matches!(
        undo_as(&pool, &wedding, WOLF, both).await,
        UndoOutcome::Reverted { .. }
    ));
    assert_eq!(table_state(&pool, wedding.table_id).await, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_deleted_relation_keeps_its_target_when_restored(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let column = ColumnId::from_uuid(Uuid::now_v7());
    change_as(
        &pool,
        &wedding,
        WOLF,
        vec![DatabaseOp::Column {
            table: wedding.table_id,
            column,
            change: ColumnChange::Create {
                definition: NewColumn::New {
                    name: "Related guests".into(),
                    kind: ColumnKind::Relation {
                        database: wedding.database_id,
                        table: wedding.table_id,
                    },
                    options: vec![],
                    infer_type: false,
                },
                after: None,
            },
        }],
    )
    .await;
    let repository = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let before = repository
        .columns_for_tables(&[wedding.table_id])
        .await
        .unwrap()
        .into_iter()
        .find(|held| held.id == column)
        .unwrap();
    let change = change_as(
        &pool,
        &wedding,
        WOLF,
        vec![DatabaseOp::Column {
            table: wedding.table_id,
            column,
            change: ColumnChange::Delete,
        }],
    )
    .await;
    assert!(matches!(
        undo_as(&pool, &wedding, WOLF, change).await,
        UndoOutcome::Reverted { .. }
    ));
    let after = repository
        .columns_for_tables(&[wedding.table_id])
        .await
        .unwrap()
        .into_iter()
        .find(|held| held.id == column)
        .unwrap();
    assert_eq!(after.config, before.config);
    assert_eq!(after.infer_type, before.infer_type);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_later_relation_protects_an_inserted_row_from_undo(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (source, _) = insert_guests(&pool, &wedding).await;
    let column = ColumnId::from_uuid(Uuid::now_v7());
    change_as(
        &pool,
        &wedding,
        WOLF,
        vec![DatabaseOp::Column {
            table: wedding.table_id,
            column,
            change: ColumnChange::Create {
                definition: NewColumn::New {
                    name: "Relation".into(),
                    kind: ColumnKind::Relation {
                        database: wedding.database_id,
                        table: wedding.table_id,
                    },
                    options: vec![],
                    infer_type: false,
                },
                after: None,
            },
        }],
    )
    .await;
    let repository = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let before = repository.row_refs(wedding.table_id).await.unwrap();
    let insertion = change_as(
        &pool,
        &wedding,
        WOLF,
        vec![DatabaseOp::Rows {
            table: wedding.table_id,
            change: RowsChange::Insert {
                rows: vec![vec![CellWrite {
                    column: wedding.name,
                    value: CellValue::Text("New guest".into()),
                }]],
            },
        }],
    )
    .await;
    let target = repository
        .row_refs(wedding.table_id)
        .await
        .unwrap()
        .into_iter()
        .find(|row| !before.iter().any(|old| old.id == row.id))
        .unwrap()
        .id;
    change_as(
        &pool,
        &wedding,
        JULIA,
        set_cells(
            &wedding,
            source,
            vec![CellWrite {
                column,
                value: CellValue::Rows(vec![target]),
            }],
        ),
    )
    .await;
    assert_eq!(
        undo_as(&pool, &wedding, WOLF, insertion).await,
        UndoOutcome::Refused {
            reason: UndoRefusal::RowInUse,
            by: None
        }
    );
    assert!(
        repository
            .row_refs(wedding.table_id)
            .await
            .unwrap()
            .iter()
            .any(|row| row.id == target)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_filter_only_dependency_protects_a_new_option(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let option = OptionId::from_uuid(Uuid::now_v7());
    let addition = change_as(
        &pool,
        &wedding,
        WOLF,
        vec![DatabaseOp::Column {
            table: wedding.table_id,
            column: wedding.rsvp,
            change: ColumnChange::AddOptions {
                options: vec![NewOption {
                    id: option,
                    label: "Later".into(),
                }],
            },
        }],
    )
    .await;
    change_as(
        &pool,
        &wedding,
        JULIA,
        vec![DatabaseOp::View {
            table: wedding.table_id,
            view: ViewId::from_uuid(Uuid::now_v7()),
            change: ViewChange::Create {
                view: NewView {
                    name: "Later guests".into(),
                    layout: RequestedLayout::Table { columns: vec![] },
                    query: ViewQuery {
                        filter: Some(FilterGroup {
                            conjunction: Conjunction::And,
                            conditions: vec![FilterNode::Condition(FilterCondition {
                                column: wedding.rsvp,
                                test: FilterTest::Options {
                                    operator: models_databases::views::SetOperator::IsAnyOf,
                                    options: vec![option],
                                },
                            })],
                        }),
                        sort: vec![],
                    },
                },
            },
        }],
    )
    .await;
    assert_eq!(
        undo_as(&pool, &wedding, WOLF, addition).await,
        UndoOutcome::Refused {
            reason: UndoRefusal::OptionInUse,
            by: None
        }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn move_then_delete_restores_the_row_before_moving_it_back(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (row, _) = insert_guests(&pool, &wedding).await;
    let view = board(&pool, &wedding).await;
    let before = table_state(&pool, wedding.table_id).await;
    let change = change_as(
        &pool,
        &wedding,
        WOLF,
        vec![
            DatabaseOp::View {
                table: wedding.table_id,
                view,
                change: ViewChange::MoveCard {
                    row,
                    lane: models_databases::views::LaneKey::Option(wedding.no),
                    before: None,
                    after: None,
                },
            },
            DatabaseOp::Rows {
                table: wedding.table_id,
                change: RowsChange::Delete { rows: vec![row] },
            },
        ],
    )
    .await;
    assert!(matches!(
        undo_as(&pool, &wedding, WOLF, change).await,
        UndoOutcome::Reverted { .. }
    ));
    assert_eq!(table_state(&pool, wedding.table_id).await, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_positioned_card_does_not_claim_to_restore_its_position(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (row, _) = insert_guests(&pool, &wedding).await;
    let view = board(&pool, &wedding).await;
    change_as(
        &pool,
        &wedding,
        WOLF,
        vec![DatabaseOp::View {
            table: wedding.table_id,
            view,
            change: ViewChange::MoveCard {
                row,
                lane: models_databases::views::LaneKey::Option(wedding.no),
                before: None,
                after: None,
            },
        }],
    )
    .await;
    let deletion = change_as(
        &pool,
        &wedding,
        WOLF,
        vec![DatabaseOp::Rows {
            table: wedding.table_id,
            change: RowsChange::Delete { rows: vec![row] },
        }],
    )
    .await;
    assert_eq!(
        undo_as(&pool, &wedding, WOLF, deletion).await,
        UndoOutcome::Refused {
            reason: UndoRefusal::NotUndoable,
            by: None
        }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_lane_with_card_positions_does_not_claim_complete_restoration(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (row, _) = insert_guests(&pool, &wedding).await;
    let view = board(&pool, &wedding).await;
    change_as(
        &pool,
        &wedding,
        WOLF,
        vec![DatabaseOp::View {
            table: wedding.table_id,
            view,
            change: ViewChange::MoveCard {
                row,
                lane: models_databases::views::LaneKey::Option(wedding.no),
                before: None,
                after: None,
            },
        }],
    )
    .await;
    let deletion = change_as(
        &pool,
        &wedding,
        WOLF,
        vec![DatabaseOp::Column {
            table: wedding.table_id,
            column: wedding.rsvp,
            change: ColumnChange::DeleteOption { option: wedding.no },
        }],
    )
    .await;
    assert_eq!(
        undo_as(&pool, &wedding, WOLF, deletion).await,
        UndoOutcome::Refused {
            reason: UndoRefusal::NotUndoable,
            by: None
        }
    );
}
