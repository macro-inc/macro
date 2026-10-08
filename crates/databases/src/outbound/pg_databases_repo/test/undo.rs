//! Undo over Postgres, on the guest list: each person undoes their own
//! change, under the table's lock, leaving everyone else's alone.

mod options;
mod structure;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_databases::views::{
    Conjunction, FilterCondition, FilterGroup, FilterNode, FilterTest, NewView, NumberOperator,
    RequestedLayout, ViewId, ViewQuery,
};
use models_databases::{
    CellValue, CellWrite, ColumnChange, DatabaseOp, OptionRef, RowChange, RowChanges, RowsChange,
    ViewChange,
};
use properties::outbound::properties_pg_repo::PropertiesPgRepo;
use sqlx::PgPool;

use super::apply_ops::service;
use super::journal::{JULIA, WOLF, Wedding, edit_as, insert_guests, person, table_state, wedding};
use crate::domain::journal::{SkippedCell, UndoOutcome, UndoRefusal};
use crate::domain::models::{ChangeId, CommittedChange, RowId, TableVersion};
use crate::domain::ports::{DatabasesRepo, DatabasesService};
use crate::outbound::pg_databases_repo::PgDatabasesRepo;

async fn change_as(pool: &PgPool, wedding: &Wedding, user: &str, ops: Vec<DatabaseOp>) -> ChangeId {
    let applied = service(pool)
        .apply_ops_with_changes(edit_as(user, wedding.database_id), person(user), ops.into())
        .await
        .unwrap();
    applied.changes[0].change
}

async fn undo_as(pool: &PgPool, wedding: &Wedding, user: &str, change: ChangeId) -> UndoOutcome {
    service(pool)
        .undo_change(edit_as(user, wedding.database_id), person(user), change)
        .await
        .unwrap()
}

fn set_cells(wedding: &Wedding, row: RowId, cells: Vec<CellWrite>) -> Vec<DatabaseOp> {
    vec![DatabaseOp::Rows {
        table: wedding.table_id,
        change: RowsChange::Update {
            changes: RowChanges::PerRow {
                rows: vec![RowChange { row, cells }],
            },
        },
    }]
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn wolf_undoes_his_edit_and_julias_later_plus_ones_stays(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (maria, _) = insert_guests(&pool, &wedding).await;
    let wolfs = change_as(
        &pool,
        &wedding,
        WOLF,
        set_cells(
            &wedding,
            maria,
            vec![
                CellWrite {
                    column: wedding.name,
                    value: CellValue::Text("Maria José".into()),
                },
                CellWrite {
                    column: wedding.plus_ones,
                    value: CellValue::Number(2.0),
                },
            ],
        ),
    )
    .await;
    change_as(
        &pool,
        &wedding,
        JULIA,
        set_cells(
            &wedding,
            maria,
            vec![CellWrite {
                column: wedding.plus_ones,
                value: CellValue::Number(5.0),
            }],
        ),
    )
    .await;

    let outcome = undo_as(&pool, &wedding, WOLF, wolfs).await;

    assert_eq!(
        outcome,
        UndoOutcome::Partial {
            skipped: vec![SkippedCell {
                row: maria,
                column: wedding.plus_ones,
                by: Some(JULIA.into()),
            }],
            changes: vec![CommittedChange {
                table: wedding.table_id,
                version: TableVersion(5),
                change: ChangeId(5),
            }],
        }
    );
    let state = table_state(&pool, wedding.table_id).await;
    let maria_cells = &state.rows[0].2;
    let definitions = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .columns_for_tables(&[wedding.table_id])
        .await
        .unwrap();
    let definition = |column| {
        definitions
            .iter()
            .find(|placement| placement.id == column)
            .unwrap()
            .property_definition_id
    };
    assert_eq!(
        maria_cells[&definition(wedding.name)],
        serde_json::json!({"type": "String", "value": "Maria"})
    );
    assert_eq!(
        maria_cells[&definition(wedding.plus_ones)],
        serde_json::json!({"type": "Number", "value": 5.0})
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn undoing_an_insert_julia_since_edited_is_refused_and_writes_nothing(pool: PgPool) {
    let wedding = wedding(&pool).await;
    insert_guests(&pool, &wedding).await;
    let (maria, _) = {
        let state = table_state(&pool, wedding.table_id).await;
        (state.rows[0].0, state.rows[1].0)
    };
    change_as(
        &pool,
        &wedding,
        JULIA,
        set_cells(
            &wedding,
            maria,
            vec![CellWrite {
                column: wedding.rsvp,
                value: CellValue::Options(vec![OptionRef::Id(wedding.maybe)]),
            }],
        ),
    )
    .await;
    let before = table_state(&pool, wedding.table_id).await;

    let outcome = undo_as(&pool, &wedding, WOLF, ChangeId(2)).await;

    assert_eq!(
        outcome,
        UndoOutcome::Refused {
            reason: UndoRefusal::RowEditedSince,
            by: Some(JULIA.into()),
        }
    );
    assert_eq!(table_state(&pool, wedding.table_id).await, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn undoing_a_row_delete_brings_omar_back_exactly_after_julia_edits_maria(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (maria, omar) = insert_guests(&pool, &wedding).await;
    let before = table_state(&pool, wedding.table_id).await;
    let delete = change_as(
        &pool,
        &wedding,
        WOLF,
        vec![DatabaseOp::Rows {
            table: wedding.table_id,
            change: RowsChange::Delete { rows: vec![omar] },
        }],
    )
    .await;
    change_as(
        &pool,
        &wedding,
        JULIA,
        set_cells(
            &wedding,
            maria,
            vec![CellWrite {
                column: wedding.name,
                value: CellValue::Text("Mariá".into()),
            }],
        ),
    )
    .await;

    let outcome = undo_as(&pool, &wedding, WOLF, delete).await;

    assert!(
        matches!(outcome, UndoOutcome::Reverted { .. }),
        "{outcome:?}"
    );
    let after = table_state(&pool, wedding.table_id).await;
    assert_eq!(after.rows[1], before.rows[1]);
    assert_eq!(after.rows[1].0, omar);
    assert_ne!(after.rows[0], before.rows[0]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn undoing_a_column_delete_restores_the_column_its_cells_and_the_view_filter(pool: PgPool) {
    let wedding = wedding(&pool).await;
    insert_guests(&pool, &wedding).await;
    let crowd = ViewId::new();
    let query = ViewQuery {
        filter: Some(FilterGroup {
            conjunction: Conjunction::And,
            conditions: vec![FilterNode::Condition(FilterCondition {
                column: wedding.plus_ones,
                test: FilterTest::Number {
                    operator: NumberOperator::GreaterThan,
                    value: 0.0,
                },
            })],
        }),
        sort: Vec::new(),
    };
    change_as(
        &pool,
        &wedding,
        WOLF,
        vec![DatabaseOp::View {
            table: wedding.table_id,
            view: crowd,
            change: ViewChange::Create {
                view: NewView {
                    name: "Bringing someone".into(),
                    query: query.clone(),
                    layout: RequestedLayout::Table {
                        columns: Vec::new(),
                    },
                },
            },
        }],
    )
    .await;
    let before = table_state(&pool, wedding.table_id).await;
    let delete = change_as(
        &pool,
        &wedding,
        WOLF,
        vec![DatabaseOp::Column {
            table: wedding.table_id,
            column: wedding.plus_ones,
            change: ColumnChange::Delete,
        }],
    )
    .await;

    let outcome = undo_as(&pool, &wedding, WOLF, delete).await;

    assert!(
        matches!(outcome, UndoOutcome::Reverted { .. }),
        "{outcome:?}"
    );
    assert_eq!(table_state(&pool, wedding.table_id).await, before);
    let views = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .views_for_tables(&[wedding.table_id])
        .await
        .unwrap();
    assert_eq!(
        views.iter().find(|view| view.id == crowd).unwrap().query,
        query
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn undo_then_redo_round_trips(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (maria, _) = insert_guests(&pool, &wedding).await;
    let before = table_state(&pool, wedding.table_id).await;
    let edit = change_as(
        &pool,
        &wedding,
        WOLF,
        set_cells(
            &wedding,
            maria,
            vec![CellWrite {
                column: wedding.rsvp,
                value: CellValue::Options(vec![OptionRef::Id(wedding.no)]),
            }],
        ),
    )
    .await;
    let edited = table_state(&pool, wedding.table_id).await;

    let undone = undo_as(&pool, &wedding, WOLF, edit).await;
    let after_undo = table_state(&pool, wedding.table_id).await;
    let UndoOutcome::Reverted { changes } = undone else {
        panic!("the undo reverts: {undone:?}");
    };
    let redone = undo_as(&pool, &wedding, WOLF, changes[0].change).await;
    let after_redo = table_state(&pool, wedding.table_id).await;

    assert_eq!(after_undo, before);
    assert!(matches!(redone, UndoOutcome::Reverted { .. }), "{redone:?}");
    assert_eq!(after_redo, edited);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn wolf_cannot_undo_julias_change(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (maria, _) = insert_guests(&pool, &wedding).await;
    let julias = change_as(
        &pool,
        &wedding,
        JULIA,
        set_cells(
            &wedding,
            maria,
            vec![CellWrite {
                column: wedding.rsvp,
                value: CellValue::Options(vec![OptionRef::Id(wedding.maybe)]),
            }],
        ),
    )
    .await;
    let before = table_state(&pool, wedding.table_id).await;

    let outcome = undo_as(&pool, &wedding, WOLF, julias).await;

    assert_eq!(
        outcome,
        UndoOutcome::Refused {
            reason: UndoRefusal::NotYours,
            by: Some(JULIA.into()),
        }
    );
    assert_eq!(table_state(&pool, wedding.table_id).await, before);
}
