//! Formula columns over Postgres: the writer stores each row's computed
//! value in the formula's definition, so readers see an ordinary number or
//! date column, and keeps it current as inputs and formulas change.

use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnKind, DatabaseOp, Formula, NewColumn, OpResult,
    Operator, RowChange, RowChanges, RowsChange, RowsResult,
};
use models_properties::service::property_value::PropertyValue;

use super::apply_ops::{Guests, cells, edit, guests, service, version, viewer};
use super::journal::{WOLF, edit_as, insert_guests, person, wedding};
use super::*;
use crate::domain::journal::UndoOutcome;
use crate::domain::models::{DatabaseError, OpRefusal};
use crate::domain::ports::{DatabasesRepo, DatabasesService};

/// The guest list with Price and Qty, Total = Price * Qty and Double =
/// Total * 2.
struct Orders {
    guests: Guests,
    price: ColumnId,
    qty: ColumnId,
    total: ColumnId,
    double: ColumnId,
}

fn product(left: ColumnId, right: ColumnId) -> Formula {
    Formula::Binary {
        operator: Operator::Multiply,
        left: Box::new(Formula::Column { column: left }),
        right: Box::new(Formula::Column { column: right }),
    }
}

fn twice(column: ColumnId) -> Formula {
    Formula::Binary {
        operator: Operator::Multiply,
        left: Box::new(Formula::Column { column }),
        right: Box::new(Formula::Number { value: 2.0 }),
    }
}

fn number_column(column: ColumnId, name: &str, guests: &Guests) -> DatabaseOp {
    DatabaseOp::Column {
        table: guests.table_id,
        column,
        change: ColumnChange::Create {
            definition: NewColumn::New {
                name: name.into(),
                kind: ColumnKind::Number,
                options: vec![],
                infer_type: false,
            },
            after: None,
        },
    }
}

fn formula_column(column: ColumnId, name: &str, formula: Formula, guests: &Guests) -> DatabaseOp {
    DatabaseOp::Column {
        table: guests.table_id,
        column,
        change: ColumnChange::Create {
            definition: NewColumn::Derived {
                name: name.into(),
                formula,
            },
            after: None,
        },
    }
}

async fn orders(pool: &PgPool) -> Orders {
    let guests = guests(pool).await;
    let [price, qty, total, double] = [(); 4].map(|_| ColumnId::new());
    apply(
        pool,
        &guests,
        vec![
            number_column(price, "Price", &guests),
            number_column(qty, "Qty", &guests),
            formula_column(total, "Total", product(price, qty), &guests),
            formula_column(double, "Double", twice(total), &guests),
        ],
    )
    .await
    .unwrap();
    Orders {
        guests,
        price,
        qty,
        total,
        double,
    }
}

async fn apply(
    pool: &PgPool,
    guests: &Guests,
    ops: Vec<DatabaseOp>,
) -> Result<Vec<OpResult>, DatabaseError> {
    service(pool)
        .apply_ops(edit(guests.database_id), viewer(), ops.into())
        .await
}

async fn insert(pool: &PgPool, guests: &Guests, rows: Vec<Vec<CellWrite>>) -> Vec<RowId> {
    let results = apply(
        pool,
        guests,
        vec![DatabaseOp::Rows {
            table: guests.table_id,
            change: RowsChange::Insert { rows },
        }],
    )
    .await
    .unwrap();
    let [
        OpResult::Rows {
            change: RowsResult::Inserted { rows },
            ..
        },
    ] = results.as_slice()
    else {
        panic!("expected one insert, got {results:?}");
    };
    rows.clone()
}

fn number(column: ColumnId, value: f64) -> CellWrite {
    CellWrite {
        column,
        value: CellValue::Number(value),
    }
}

/// What a column's definition stores on each row, in the order given.
async fn stored(
    pool: &PgPool,
    table: TableId,
    column: ColumnId,
    rows: &[RowId],
) -> Vec<Option<f64>> {
    let definition = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .columns_for_tables(&[table])
        .await
        .unwrap()
        .into_iter()
        .find(|placement| placement.id == column)
        .expect("the column should be stored")
        .property_definition_id;
    let values = cells(pool).column_cells(rows, definition).await.unwrap();
    rows.iter()
        .map(|row| match values.get(row) {
            Some(PropertyValue::Num(value)) => Some(*value),
            None => None,
            Some(other) => panic!("expected a number, got {other:?}"),
        })
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn inserted_rows_store_their_formula_cells(pool: PgPool) {
    let orders = orders(&pool).await;

    let rows = insert(
        &pool,
        &orders.guests,
        vec![
            vec![number(orders.price, 10.0), number(orders.qty, 3.0)],
            vec![number(orders.price, 5.0)],
            vec![CellWrite {
                column: orders.guests.name,
                value: CellValue::Text("Nothing priced".into()),
            }],
        ],
    )
    .await;

    let table = orders.guests.table_id;
    assert_eq!(
        stored(&pool, table, orders.total, &rows).await,
        vec![Some(30.0), Some(0.0), None]
    );
    assert_eq!(
        stored(&pool, table, orders.double, &rows).await,
        vec![Some(60.0), Some(0.0), None]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn updating_an_input_updates_the_formula_cells_reading_it(pool: PgPool) {
    let orders = orders(&pool).await;
    let rows = insert(
        &pool,
        &orders.guests,
        vec![
            vec![number(orders.price, 10.0), number(orders.qty, 3.0)],
            vec![number(orders.price, 5.0)],
        ],
    )
    .await;
    let before = version(&pool, orders.guests.table_id).await;

    apply(
        &pool,
        &orders.guests,
        vec![DatabaseOp::Rows {
            table: orders.guests.table_id,
            change: RowsChange::Update {
                changes: RowChanges::PerRow {
                    rows: vec![
                        RowChange {
                            row: rows[0],
                            cells: vec![CellWrite {
                                column: orders.price,
                                value: CellValue::Clear,
                            }],
                        },
                        RowChange {
                            row: rows[1],
                            cells: vec![number(orders.qty, 4.0)],
                        },
                    ],
                },
            },
        }],
    )
    .await
    .unwrap();

    let table = orders.guests.table_id;
    // Row 0 keeps Qty 3, and an empty Price reads as 0.
    assert_eq!(
        stored(&pool, table, orders.total, &rows).await,
        vec![Some(0.0), Some(20.0)]
    );
    assert_eq!(
        stored(&pool, table, orders.double, &rows).await,
        vec![Some(0.0), Some(40.0)]
    );
    assert_eq!(
        version(&pool, table).await,
        crate::domain::models::TableVersion(before.0 + 1)
    );

    apply(
        &pool,
        &orders.guests,
        vec![DatabaseOp::Rows {
            table,
            change: RowsChange::Update {
                changes: RowChanges::Uniform {
                    rows: vec![rows[0]],
                    cells: vec![CellWrite {
                        column: orders.qty,
                        value: CellValue::Clear,
                    }],
                },
            },
        }],
    )
    .await
    .unwrap();
    // Every input of row 0 is empty now, so its formulas are too.
    assert_eq!(
        stored(&pool, table, orders.total, &rows).await,
        vec![None, Some(20.0)]
    );
    assert_eq!(
        stored(&pool, table, orders.double, &rows).await,
        vec![None, Some(40.0)]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_formula_column_added_to_a_table_with_rows_computes_every_row(pool: PgPool) {
    let orders = orders(&pool).await;
    let rows = insert(
        &pool,
        &orders.guests,
        vec![
            vec![number(orders.price, 10.0), number(orders.qty, 3.0)],
            vec![number(orders.price, 5.0)],
            vec![],
        ],
    )
    .await;
    let quadruple = ColumnId::new();

    apply(
        &pool,
        &orders.guests,
        vec![formula_column(
            quadruple,
            "Quadruple",
            twice(orders.double),
            &orders.guests,
        )],
    )
    .await
    .unwrap();

    assert_eq!(
        stored(&pool, orders.guests.table_id, quadruple, &rows).await,
        vec![Some(120.0), Some(0.0), None]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn changing_a_formula_recomputes_it_and_the_formulas_reading_it(pool: PgPool) {
    let orders = orders(&pool).await;
    let rows = insert(
        &pool,
        &orders.guests,
        vec![
            vec![number(orders.price, 10.0), number(orders.qty, 3.0)],
            vec![number(orders.price, 5.0)],
        ],
    )
    .await;

    apply(
        &pool,
        &orders.guests,
        vec![DatabaseOp::Column {
            table: orders.guests.table_id,
            column: orders.total,
            change: ColumnChange::SetFormula {
                formula: Formula::Binary {
                    operator: Operator::Add,
                    left: Box::new(Formula::Column {
                        column: orders.price,
                    }),
                    right: Box::new(Formula::Column { column: orders.qty }),
                },
            },
        }],
    )
    .await
    .unwrap();

    let table = orders.guests.table_id;
    assert_eq!(
        stored(&pool, table, orders.total, &rows).await,
        vec![Some(13.0), Some(5.0)]
    );
    assert_eq!(
        stored(&pool, table, orders.double, &rows).await,
        vec![Some(26.0), Some(10.0)]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_input_retyped_away_from_numbers_empties_the_formulas_reading_it(pool: PgPool) {
    let orders = orders(&pool).await;
    let rows = insert(
        &pool,
        &orders.guests,
        vec![vec![number(orders.price, 10.0), number(orders.qty, 3.0)]],
    )
    .await;
    let table = orders.guests.table_id;
    assert_eq!(
        stored(&pool, table, orders.total, &rows).await,
        vec![Some(30.0)]
    );

    // An input cannot be deleted while a formula reads it.
    let deleted = apply(
        &pool,
        &orders.guests,
        vec![DatabaseOp::Column {
            table: orders.guests.table_id,
            column: orders.qty,
            change: ColumnChange::Delete,
        }],
    )
    .await;
    assert!(
        matches!(
            &deleted,
            Err(DatabaseError::InvalidOp(OpRefusal { reason, .. }))
                if reason == "Total's formula uses Qty; change that formula first"
        ),
        "{deleted:?}"
    );

    apply(
        &pool,
        &orders.guests,
        vec![DatabaseOp::Column {
            table: orders.guests.table_id,
            column: orders.qty,
            change: ColumnChange::ChangeType {
                to: ColumnKind::Text,
            },
        }],
    )
    .await
    .unwrap();

    assert_eq!(stored(&pool, table, orders.total, &rows).await, vec![None]);
    assert_eq!(stored(&pool, table, orders.double, &rows).await, vec![None]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn formula_cells_are_not_writable(pool: PgPool) {
    let orders = orders(&pool).await;
    let rows = insert(
        &pool,
        &orders.guests,
        vec![vec![number(orders.price, 10.0), number(orders.qty, 3.0)]],
    )
    .await;

    let written = apply(
        &pool,
        &orders.guests,
        vec![DatabaseOp::Rows {
            table: orders.guests.table_id,
            change: RowsChange::Update {
                changes: RowChanges::Uniform {
                    rows: rows.clone(),
                    cells: vec![number(orders.total, 99.0)],
                },
            },
        }],
    )
    .await;

    assert!(
        matches!(
            &written,
            Err(DatabaseError::InvalidOp(OpRefusal { reason, .. }))
                if reason == "\"Total\" is computed by its formula; write the columns it uses instead"
        ),
        "{written:?}"
    );
    assert_eq!(
        stored(&pool, orders.guests.table_id, orders.total, &rows).await,
        vec![Some(30.0)]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn undoing_an_input_edit_or_a_removal_derives_the_formula_again(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (maria, omar) = insert_guests(&pool, &wedding).await;
    let seats = ColumnId::new();
    let service = service(&pool);
    let change = |ops: Vec<DatabaseOp>| {
        let service = &service;
        let wedding = &wedding;
        async move {
            service
                .apply_ops_with_changes(
                    edit_as(WOLF, wedding.database_id),
                    person(WOLF),
                    ops.into(),
                )
                .await
                .unwrap()
                .changes[0]
                .change
        }
    };
    change(vec![DatabaseOp::Column {
        table: wedding.table_id,
        column: seats,
        change: ColumnChange::Create {
            definition: NewColumn::Derived {
                name: "Seats".into(),
                formula: Formula::Binary {
                    operator: Operator::Add,
                    left: Box::new(Formula::Column {
                        column: wedding.plus_ones,
                    }),
                    right: Box::new(Formula::Number { value: 1.0 }),
                },
            },
            after: None,
        },
    }])
    .await;
    let rows = [maria, omar];
    // Omar has no plus-ones, his only input, so his seats are empty.
    assert_eq!(
        stored(&pool, wedding.table_id, seats, &rows).await,
        vec![Some(2.0), None]
    );

    let edited = change(vec![DatabaseOp::Rows {
        table: wedding.table_id,
        change: RowsChange::Update {
            changes: RowChanges::Uniform {
                rows: vec![maria],
                cells: vec![number(wedding.plus_ones, 3.0)],
            },
        },
    }])
    .await;
    assert_eq!(
        stored(&pool, wedding.table_id, seats, &rows).await,
        vec![Some(4.0), None]
    );
    let undone = service
        .undo_change(edit_as(WOLF, wedding.database_id), person(WOLF), edited)
        .await
        .unwrap();
    assert!(matches!(undone, UndoOutcome::Reverted { .. }), "{undone:?}");
    assert_eq!(
        stored(&pool, wedding.table_id, seats, &rows).await,
        vec![Some(2.0), None]
    );

    let column_removed = change(vec![DatabaseOp::Column {
        table: wedding.table_id,
        column: seats,
        change: ColumnChange::Delete,
    }])
    .await;
    let undone = service
        .undo_change(
            edit_as(WOLF, wedding.database_id),
            person(WOLF),
            column_removed,
        )
        .await
        .unwrap();
    assert!(matches!(undone, UndoOutcome::Reverted { .. }), "{undone:?}");
    assert_eq!(
        stored(&pool, wedding.table_id, seats, &rows).await,
        vec![Some(2.0), None]
    );

    let removed = change(vec![DatabaseOp::Rows {
        table: wedding.table_id,
        change: RowsChange::Delete { rows: vec![maria] },
    }])
    .await;
    let undone = service
        .undo_change(edit_as(WOLF, wedding.database_id), person(WOLF), removed)
        .await
        .unwrap();
    assert!(matches!(undone, UndoOutcome::Reverted { .. }), "{undone:?}");
    assert_eq!(
        stored(&pool, wedding.table_id, seats, &rows).await,
        vec![Some(2.0), None]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_batch_of_only_derivations_backfills_every_row_and_bumps_the_table(pool: PgPool) {
    use database_sql::catalog::{Column as QueryColumn, ColumnKind as QueryKind, TableSource};

    use crate::domain::derivation::Derivation;
    let orders = orders(&pool).await;
    let rows = insert(
        &pool,
        &orders.guests,
        vec![
            vec![number(orders.price, 10.0), number(orders.qty, 3.0)],
            vec![number(orders.price, 5.0)],
        ],
    )
    .await;
    let table = orders.guests.table_id;
    let definitions = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .columns_for_tables(&[table])
        .await
        .unwrap();
    let definition = |column: ColumnId| {
        definitions
            .iter()
            .find(|placement| placement.id == column)
            .unwrap()
            .property_definition_id
    };
    // Cells stored before formulas were materialized: inputs only.
    sqlx::query!(
        "DELETE FROM entity_properties WHERE property_definition_id = ANY($1)",
        &[definition(orders.total), definition(orders.double)],
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        stored(&pool, table, orders.total, &rows).await,
        vec![None, None]
    );
    let column = |placement: ColumnId, name: &str, formula: Option<Formula>| QueryColumn {
        id: definition(placement),
        placement,
        name: name.into(),
        kind: QueryKind::Number,
        formula,
    };
    let query_table = database_sql::catalog::Table {
        id: table,
        database_id: orders.guests.database_id,
        database: "Offsite".into(),
        name: "Table 1".into(),
        source: TableSource::Database,
        columns: vec![
            column(orders.price, "Price", None),
            column(orders.qty, "Qty", None),
            column(
                orders.total,
                "Total",
                Some(product(orders.price, orders.qty)),
            ),
            column(orders.double, "Double", Some(twice(orders.total))),
        ],
    };
    let before = version(&pool, table).await;

    let outcome = cells(&pool)
        .apply_writes(&Writes {
            database_id: orders.guests.database_id,
            created_by: viewer().user_id,
            writes: vec![],
            related_rows: vec![],
            expected_versions: vec![],
            journal: crate::domain::journal::JournalPlan::default(),
            derivations: Derivation::reading(&query_table, |_| true)
                .into_iter()
                .collect(),
        })
        .await
        .unwrap();

    assert!(
        matches!(outcome, WritesOutcome::Applied { .. }),
        "{outcome:?}"
    );
    assert_eq!(
        stored(&pool, table, orders.total, &rows).await,
        vec![Some(30.0), Some(0.0)]
    );
    assert_eq!(
        stored(&pool, table, orders.double, &rows).await,
        vec![Some(60.0), Some(0.0)]
    );
    assert_eq!(
        version(&pool, table).await,
        crate::domain::models::TableVersion(before.0 + 1)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_backfill_stores_missing_formula_cells_and_a_second_run_changes_nothing(pool: PgPool) {
    use crate::backfill::{TableBackfill, backfill_table, tables_with_formulas};
    let orders = orders(&pool).await;
    let rows = insert(
        &pool,
        &orders.guests,
        vec![
            vec![number(orders.price, 10.0), number(orders.qty, 3.0)],
            vec![number(orders.price, 5.0)],
            vec![],
        ],
    )
    .await;
    let table = orders.guests.table_id;
    let columns = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .columns_for_tables(&[table])
        .await
        .unwrap();
    let definition = |column: ColumnId| {
        columns
            .iter()
            .find(|placement| placement.id == column)
            .unwrap()
            .property_definition_id
    };
    // Cells stored before formulas were materialized: inputs only.
    sqlx::query!(
        "DELETE FROM entity_properties WHERE property_definition_id = ANY($1)",
        &[definition(orders.total), definition(orders.double)],
    )
    .execute(&pool)
    .await
    .unwrap();
    // A second database, whose table holds no formula, is not listed.
    service(&pool)
        .create_database(crate::domain::models::CreateDatabase {
            name: "Plain".into(),
            owner_id: viewer().user_id,
            acting_bot: None,
        })
        .await
        .unwrap();

    assert_eq!(
        tables_with_formulas(&pool).await.unwrap(),
        vec![(orders.guests.database_id, table)]
    );

    let before = version(&pool, table).await;
    assert_eq!(
        backfill_table(&pool, orders.guests.database_id, table)
            .await
            .unwrap(),
        TableBackfill {
            rows: 3,
            changed: true
        }
    );
    assert_eq!(
        stored(&pool, table, orders.total, &rows).await,
        vec![Some(30.0), Some(0.0), None]
    );
    assert_eq!(
        stored(&pool, table, orders.double, &rows).await,
        vec![Some(60.0), Some(0.0), None]
    );
    let backfilled = version(&pool, table).await;
    assert_eq!(
        backfilled,
        crate::domain::models::TableVersion(before.0 + 1)
    );

    assert_eq!(
        backfill_table(&pool, orders.guests.database_id, table)
            .await
            .unwrap(),
        TableBackfill {
            rows: 3,
            changed: false
        }
    );
    assert_eq!(version(&pool, table).await, backfilled);
    assert_eq!(
        stored(&pool, table, orders.total, &rows).await,
        vec![Some(30.0), Some(0.0), None]
    );
}
