use std::collections::HashMap;

use database_sql::catalog::{Column, ColumnKind, Table, TableSource};
use models_databases::{ColumnId, DatabaseId, Formula, Operator, TableId};
use models_properties::service::property_value::PropertyValue;
use uuid::Uuid;

use super::Derivation;

const PRICE: Uuid = Uuid::from_u128(1);
const QTY: Uuid = Uuid::from_u128(2);
const DUE: Uuid = Uuid::from_u128(3);
const NAME: Uuid = Uuid::from_u128(4);
const TOTAL: Uuid = Uuid::from_u128(5);
const DOUBLE: Uuid = Uuid::from_u128(6);
const RATIO: Uuid = Uuid::from_u128(7);
const FOLLOW_UP: Uuid = Uuid::from_u128(8);

/// Each column's definition is its placement's id shifted by 100, so a
/// test that mixed the two up would fail.
fn placement(definition: Uuid) -> ColumnId {
    ColumnId::from_uuid(Uuid::from_u128(definition.as_u128() + 100))
}

fn read(definition: Uuid) -> Box<Formula> {
    Box::new(Formula::Column {
        column: placement(definition),
    })
}

/// Price, Qty, Due and Name, and four formulas over them: Total = Price *
/// Qty, Double = Total * 2, Ratio = Price / Qty and Follow-up = Due + Qty.
fn orders(price_kind: ColumnKind) -> Table {
    let column = |id: Uuid, name: &str, kind: ColumnKind, formula: Option<Formula>| Column {
        id,
        placement: placement(id),
        name: name.into(),
        kind,
        formula,
    };
    Table {
        id: TableId::from_uuid(Uuid::from_u128(50)),
        database_id: DatabaseId::from_uuid(Uuid::from_u128(51)),
        database: "Shop".into(),
        name: "Orders".into(),
        source: TableSource::Database,
        columns: vec![
            column(PRICE, "Price", price_kind, None),
            column(QTY, "Qty", ColumnKind::Number, None),
            column(DUE, "Due", ColumnKind::Date, None),
            column(NAME, "Name", ColumnKind::Text, None),
            column(
                TOTAL,
                "Total",
                ColumnKind::Number,
                Some(Formula::Binary {
                    operator: Operator::Multiply,
                    left: read(PRICE),
                    right: read(QTY),
                }),
            ),
            column(
                DOUBLE,
                "Double",
                ColumnKind::Number,
                Some(Formula::Binary {
                    operator: Operator::Multiply,
                    left: read(TOTAL),
                    right: Box::new(Formula::Number { value: 2.0 }),
                }),
            ),
            column(
                RATIO,
                "Ratio",
                ColumnKind::Number,
                Some(Formula::Binary {
                    operator: Operator::Divide,
                    left: read(PRICE),
                    right: read(QTY),
                }),
            ),
            column(
                FOLLOW_UP,
                "Follow-up",
                ColumnKind::Date,
                Some(Formula::Binary {
                    operator: Operator::Add,
                    left: read(DUE),
                    right: read(QTY),
                }),
            ),
        ],
    }
}

fn date(text: &str) -> PropertyValue {
    PropertyValue::Date(text.parse().unwrap())
}

#[test]
fn a_change_reaches_the_formulas_reading_it_directly_or_through_another() {
    let table = orders(ColumnKind::Number);

    let price = Derivation::reading(&table, |column| column.id == PRICE).unwrap();
    assert_eq!(price.table_id(), table.id);
    assert_eq!(price.outputs(), vec![TOTAL, DOUBLE, RATIO]);

    let due = Derivation::reading(&table, |column| column.id == DUE).unwrap();
    assert_eq!(due.outputs(), vec![FOLLOW_UP]);

    let total = Derivation::reading(&table, |column| column.id == TOTAL).unwrap();
    assert_eq!(total.outputs(), vec![TOTAL, DOUBLE]);

    let every = Derivation::reading(&table, |_| true).unwrap();
    assert_eq!(every.outputs(), vec![TOTAL, DOUBLE, RATIO, FOLLOW_UP]);

    assert_eq!(
        Derivation::reading(&table, |column| column.id == NAME),
        None
    );
}

#[test]
fn inputs_are_the_stored_columns_read_through_nested_formulas() {
    let table = orders(ColumnKind::Number);

    let double = Derivation::reading(&table, |column| column.id == DOUBLE).unwrap();
    assert_eq!(double.outputs(), vec![DOUBLE]);
    assert_eq!(double.inputs(), vec![PRICE, QTY]);

    let every = Derivation::reading(&table, |_| true).unwrap();
    assert_eq!(every.inputs(), vec![PRICE, QTY, DUE]);
}

#[test]
fn a_row_with_every_input_computes_numbers_and_dates() {
    let every = Derivation::reading(&orders(ColumnKind::Number), |_| true).unwrap();

    let cells = every.cells(&HashMap::from([
        (PRICE, PropertyValue::Num(10.0)),
        (QTY, PropertyValue::Num(4.0)),
        (DUE, date("2026-10-01T00:00:00Z")),
        (NAME, PropertyValue::Str("Lamp".into())),
    ]));

    assert_eq!(
        cells,
        vec![
            (TOTAL, Some(PropertyValue::Num(40.0))),
            (DOUBLE, Some(PropertyValue::Num(80.0))),
            (RATIO, Some(PropertyValue::Num(2.5))),
            (FOLLOW_UP, Some(date("2026-10-05T00:00:00Z"))),
        ]
    );
}

#[test]
fn an_empty_number_reads_as_zero_until_every_input_is_empty() {
    let every = Derivation::reading(&orders(ColumnKind::Number), |_| true).unwrap();

    assert_eq!(
        every.cells(&HashMap::from([(QTY, PropertyValue::Num(3.0))])),
        vec![
            (TOTAL, Some(PropertyValue::Num(0.0))),
            (DOUBLE, Some(PropertyValue::Num(0.0))),
            (RATIO, Some(PropertyValue::Num(0.0))),
            // Due is empty, and an empty date empties the sum.
            (FOLLOW_UP, None),
        ]
    );
    assert_eq!(
        every.cells(&HashMap::new()),
        vec![
            (TOTAL, None),
            (DOUBLE, None),
            (RATIO, None),
            (FOLLOW_UP, None),
        ]
    );
}

#[test]
fn dividing_by_zero_is_empty() {
    let every = Derivation::reading(&orders(ColumnKind::Number), |_| true).unwrap();

    assert_eq!(
        every.cells(&HashMap::from([(PRICE, PropertyValue::Num(5.0))])),
        vec![
            (TOTAL, Some(PropertyValue::Num(0.0))),
            (DOUBLE, Some(PropertyValue::Num(0.0))),
            (RATIO, None),
            (FOLLOW_UP, None),
        ]
    );
}

#[test]
fn an_input_that_is_no_longer_a_number_empties_what_reads_it() {
    let every = Derivation::reading(&orders(ColumnKind::Text), |_| true).unwrap();

    assert_eq!(
        every.cells(&HashMap::from([
            (PRICE, PropertyValue::Str("10".into())),
            (QTY, PropertyValue::Num(4.0)),
            (DUE, date("2026-10-01T00:00:00Z")),
        ])),
        vec![
            (TOTAL, None),
            (DOUBLE, None),
            (RATIO, None),
            (FOLLOW_UP, Some(date("2026-10-05T00:00:00Z"))),
        ]
    );
}
