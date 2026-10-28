//! Derived columns: a formula instead of cells, checked against the table
//! as the ops before it leave it, and undone like any schema change.

use models_databases::{Formula, Operator};

use super::*;
use crate::domain::journal::UndoOutcome;
use crate::domain::models::ColumnConfig;

fn plus_ones_times(seeded: &Seeded, factor: f64) -> Formula {
    Formula::Binary {
        operator: Operator::Multiply,
        left: Box::new(Formula::Column {
            column: seeded.plus_ones_column.id,
        }),
        right: Box::new(Formula::Number { value: factor }),
    }
}

async fn apply(seeded: &Seeded, ops: Vec<DatabaseOp>) -> Result<Vec<OpResult>, DatabaseError> {
    seeded
        .service
        .apply_ops(edit(seeded.database_id), viewer(OWNER), ops.into())
        .await
}

fn refusal(result: Result<Vec<OpResult>, DatabaseError>) -> String {
    match result {
        Err(DatabaseError::InvalidOp(refusal)) => refusal.reason,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[tokio::test]
async fn a_derived_column_is_created_with_a_number_definition_and_its_formula() {
    let seeded = seeded().await;
    let seats = ColumnId::new();

    let results = apply(
        &seeded,
        vec![DatabaseOp::Column {
            table: seeded.table_id,
            column: seats,
            change: ColumnChange::Create {
                definition: NewColumn::Derived {
                    name: "Seats".into(),
                    formula: plus_ones_times(&seeded, 2.0),
                },
                after: None,
            },
        }],
    )
    .await
    .unwrap();

    assert!(matches!(
        results.as_slice(),
        [OpResult::Column {
            change: ColumnResult::Created,
            ..
        }]
    ));
    let world = seeded.world.lock().unwrap();
    let column = world
        .columns
        .iter()
        .find(|column| column.id == seats)
        .unwrap();
    assert_eq!(
        column.config,
        Some(ColumnConfig::Derived {
            formula: plus_ones_times(&seeded, 2.0),
        })
    );
    let definition = &world.definitions[&column.property_definition_id].definition;
    assert_eq!(definition.data_type, DataType::Number);
    assert_eq!(definition.display_name, "Seats");
}

#[tokio::test]
async fn formulas_that_do_not_fit_are_refused() {
    let seeded = seeded().await;
    let create = |formula: Formula| {
        vec![DatabaseOp::Column {
            table: seeded.table_id,
            column: ColumnId::new(),
            change: ColumnChange::Create {
                definition: NewColumn::Derived {
                    name: "Bad".into(),
                    formula,
                },
                after: None,
            },
        }]
    };

    let text = refusal(
        apply(
            &seeded,
            create(Formula::Binary {
                operator: Operator::Add,
                left: Box::new(Formula::Column {
                    column: seeded.name_column.id,
                }),
                right: Box::new(Formula::Number { value: 1.0 }),
            }),
        )
        .await,
    );
    assert_eq!(
        text,
        "Name is a text column; formulas use number and date columns."
    );

    let missing = refusal(
        apply(
            &seeded,
            create(Formula::Column {
                column: ColumnId::new(),
            }),
        )
        .await,
    );
    assert_eq!(
        missing,
        "The formula names a column this table no longer has."
    );
}

#[tokio::test]
async fn a_derived_column_takes_no_writes_and_keeps_its_inputs() {
    let seeded = seeded().await;
    let seats = ColumnId::new();
    apply(
        &seeded,
        vec![DatabaseOp::Column {
            table: seeded.table_id,
            column: seats,
            change: ColumnChange::Create {
                definition: NewColumn::Derived {
                    name: "Seats".into(),
                    formula: plus_ones_times(&seeded, 2.0),
                },
                after: None,
            },
        }],
    )
    .await
    .unwrap();

    let written = refusal(
        apply(
            &seeded,
            vec![DatabaseOp::Rows {
                table: seeded.table_id,
                change: RowsChange::Update {
                    changes: RowChanges::Uniform {
                        rows: vec![seeded.row_id],
                        cells: vec![CellWrite {
                            column: seats,
                            value: CellValue::Number(4.0),
                        }],
                    },
                },
            }],
        )
        .await,
    );
    assert_eq!(
        written,
        "\"Seats\" is computed by its formula; write the columns it uses instead"
    );

    let retyped = refusal(
        apply(
            &seeded,
            vec![DatabaseOp::Column {
                table: seeded.table_id,
                column: seats,
                change: ColumnChange::ChangeType {
                    to: ColumnKind::Text,
                },
            }],
        )
        .await,
    );
    assert_eq!(
        retyped,
        "a derived column's type follows its formula; change the formula instead"
    );

    let input_deleted = refusal(
        apply(
            &seeded,
            vec![DatabaseOp::Column {
                table: seeded.table_id,
                column: seeded.plus_ones_column.id,
                change: ColumnChange::Delete,
            }],
        )
        .await,
    );
    assert_eq!(
        input_deleted,
        "Seats's formula uses Plus ones; change that formula first"
    );
}

#[tokio::test]
async fn setting_a_formula_keeps_the_definition_and_undo_puts_the_old_one_back() {
    let seeded = seeded().await;
    let seats = ColumnId::new();
    apply(
        &seeded,
        vec![DatabaseOp::Column {
            table: seeded.table_id,
            column: seats,
            change: ColumnChange::Create {
                definition: NewColumn::Derived {
                    name: "Seats".into(),
                    formula: plus_ones_times(&seeded, 2.0),
                },
                after: None,
            },
        }],
    )
    .await
    .unwrap();
    let definition = seeded
        .world
        .lock()
        .unwrap()
        .columns
        .iter()
        .find(|column| column.id == seats)
        .unwrap()
        .property_definition_id;

    let applied = seeded
        .service
        .apply_ops_with_changes(
            edit(seeded.database_id),
            viewer(OWNER),
            vec![DatabaseOp::Column {
                table: seeded.table_id,
                column: seats,
                change: ColumnChange::SetFormula {
                    formula: plus_ones_times(&seeded, 3.0),
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    assert!(matches!(
        applied.results.as_slice(),
        [OpResult::Column {
            change: ColumnResult::FormulaSet,
            ..
        }]
    ));
    {
        let world = seeded.world.lock().unwrap();
        let column = world
            .columns
            .iter()
            .find(|column| column.id == seats)
            .unwrap();
        assert_eq!(column.property_definition_id, definition);
        assert_eq!(column.formula(), Some(&plus_ones_times(&seeded, 3.0)));
    }

    let outcome = seeded
        .service
        .undo_change(
            edit(seeded.database_id),
            viewer(OWNER),
            applied.changes[0].change,
        )
        .await
        .unwrap();

    assert!(
        matches!(outcome, UndoOutcome::Reverted { .. }),
        "{outcome:?}"
    );
    let world = seeded.world.lock().unwrap();
    let column = world
        .columns
        .iter()
        .find(|column| column.id == seats)
        .unwrap();
    assert_eq!(column.formula(), Some(&plus_ones_times(&seeded, 2.0)));
}

#[tokio::test]
async fn a_formula_cannot_read_its_own_column() {
    let seeded = seeded().await;
    let seats = ColumnId::new();
    apply(
        &seeded,
        vec![DatabaseOp::Column {
            table: seeded.table_id,
            column: seats,
            change: ColumnChange::Create {
                definition: NewColumn::Derived {
                    name: "Seats".into(),
                    formula: plus_ones_times(&seeded, 2.0),
                },
                after: None,
            },
        }],
    )
    .await
    .unwrap();

    let cycle = refusal(
        apply(
            &seeded,
            vec![DatabaseOp::Column {
                table: seeded.table_id,
                column: seats,
                change: ColumnChange::SetFormula {
                    formula: Formula::Binary {
                        operator: Operator::Add,
                        left: Box::new(Formula::Column { column: seats }),
                        right: Box::new(Formula::Number { value: 1.0 }),
                    },
                },
            }],
        )
        .await,
    );
    assert_eq!(
        cycle,
        "Seats can't be used here: its value depends on this column."
    );
}
