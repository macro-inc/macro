use std::collections::HashMap;

use chrono::{TimeZone, Utc};
use models_databases::{ColumnId, DatabaseId, Formula, FormulaType, Operator, TableId};
use uuid::Uuid;

use super::*;
use crate::catalog::{Column, ColumnKind, Table, TableSource};
use crate::fold::Cell;

const PRICE: Uuid = Uuid::from_u128(0x1);
const QUANTITY: Uuid = Uuid::from_u128(0x2);
const DUE: Uuid = Uuid::from_u128(0x3);
const STARTED: Uuid = Uuid::from_u128(0x4);
const NAME: Uuid = Uuid::from_u128(0x5);
const TOTAL: Uuid = Uuid::from_u128(0x6);
const WITH_TAX: Uuid = Uuid::from_u128(0x7);

fn placement(definition: Uuid) -> ColumnId {
    ColumnId::from_uuid(Uuid::from_u128(definition.as_u128() + 0x100))
}

fn column(id: Uuid) -> Formula {
    Formula::Column {
        column: placement(id),
    }
}

fn binary(operator: Operator, left: Formula, right: Formula) -> Formula {
    Formula::Binary {
        operator,
        left: Box::new(left),
        right: Box::new(right),
    }
}

/// `orders`: two numbers, two dates, a text column, `Total = Unit price *
/// Quantity` and `With tax = Total * 1.2`.
fn orders() -> Table {
    let stored = |id: Uuid, name: &str, kind: ColumnKind| Column {
        id,
        placement: placement(id),
        name: name.into(),
        kind,
        formula: None,
    };
    Table {
        id: TableId::from_uuid(Uuid::from_u128(0xd0)),
        database_id: DatabaseId::from_uuid(Uuid::from_u128(0xdb)),
        database: "shop".into(),
        name: "orders".into(),
        columns: vec![
            stored(PRICE, "Unit price", ColumnKind::Number),
            stored(QUANTITY, "Quantity", ColumnKind::Number),
            stored(DUE, "Due", ColumnKind::Date),
            stored(STARTED, "Started", ColumnKind::Date),
            stored(NAME, "Name", ColumnKind::Text),
            Column {
                id: TOTAL,
                placement: placement(TOTAL),
                name: "Total".into(),
                kind: ColumnKind::Number,
                formula: Some(binary(Operator::Multiply, column(PRICE), column(QUANTITY))),
            },
            Column {
                id: WITH_TAX,
                placement: placement(WITH_TAX),
                name: "With tax".into(),
                kind: ColumnKind::Number,
                formula: Some(binary(
                    Operator::Multiply,
                    column(TOTAL),
                    Formula::Number { value: 1.2 },
                )),
            },
        ],
        source: TableSource::Database,
    }
}

#[test]
fn parses_precedence_braces_and_case() {
    let parsed = parse(&orders(), "{unit price} * quantity + 2 - -Due / (1 + 1)").unwrap();

    assert_eq!(
        parsed,
        binary(
            Operator::Subtract,
            binary(
                Operator::Add,
                binary(Operator::Multiply, column(PRICE), column(QUANTITY)),
                Formula::Number { value: 2.0 },
            ),
            binary(
                Operator::Divide,
                Formula::Negate {
                    operand: Box::new(column(DUE)),
                },
                binary(
                    Operator::Add,
                    Formula::Number { value: 1.0 },
                    Formula::Number { value: 1.0 },
                ),
            ),
        )
    );
}

#[test]
fn subtraction_is_left_associative() {
    assert_eq!(
        parse(&orders(), "Quantity - 1 - 2").unwrap(),
        binary(
            Operator::Subtract,
            binary(
                Operator::Subtract,
                column(QUANTITY),
                Formula::Number { value: 1.0 },
            ),
            Formula::Number { value: 2.0 },
        )
    );
}

#[test]
fn parse_errors_point_at_the_problem() {
    let error = parse(&orders(), "Quantity * Price").unwrap_err();
    assert_eq!(error.span, 11..16);
    assert_eq!(
        error.message,
        "There's no column called Price. Write a name with spaces in braces, like {Unit price}."
    );

    let error = parse(&orders(), "Quantity *").unwrap_err();
    assert_eq!(error.message, "The formula ends too soon.");

    let error = parse(&orders(), "Quantity 2").unwrap_err();
    assert_eq!(error.span, 9..10);
    assert_eq!(error.message, "Expected an operator (+ - * /), found `2`.");

    let error = parse(&orders(), "(Quantity + 1").unwrap_err();
    assert_eq!(error.message, "A `(` needs a closing `)`.");

    let error = parse(&orders(), "{Unit price * 2").unwrap_err();
    assert_eq!(error.message, "A `{` needs a closing `}`.");

    let error = parse(&orders(), "Quantity % 2").unwrap_err();
    assert_eq!(error.span, 9..10);
    assert_eq!(error.message, "`%` can't be used in a formula.");

    let error = parse(&orders(), "Quantity * * 2").unwrap_err();
    assert_eq!(error.span, 11..12);
    assert_eq!(error.message, "Expected a column, a number or `(` here.");

    let error = parse(&orders(), "  ").unwrap_err();
    assert_eq!(error.message, "Write a formula, like `Price * Quantity`.");
}

#[test]
fn renders_with_current_names_and_minimal_parentheses() {
    let table = orders();
    for text in [
        "{Unit price} * Quantity + 2",
        "{Unit price} * (Quantity + 2)",
        "Quantity - (1 - 2)",
        "Quantity - 1 - 2",
        "-Quantity * 1.5",
        "-(Quantity + 1)",
        "Due + 7",
    ] {
        assert_eq!(render(&table, &parse(&table, text).unwrap()), text);
    }

    let mut renamed = orders();
    renamed.columns[1].name = "Qty".into();
    assert_eq!(
        render(&renamed, &parse(&table, "Quantity * 2").unwrap()),
        "Qty * 2"
    );
}

#[test]
fn checks_types() {
    let table = orders();
    let check_text = |text: &str| check(&table, None, &parse(&table, text).unwrap());

    assert_eq!(
        check_text("{Unit price} * Quantity"),
        Ok(FormulaType::Number)
    );
    assert_eq!(check_text("Due + 7"), Ok(FormulaType::Date));
    assert_eq!(check_text("7 + Due"), Ok(FormulaType::Date));
    assert_eq!(check_text("Due - 1.5"), Ok(FormulaType::Date));
    assert_eq!(check_text("Due - Started"), Ok(FormulaType::Number));
    assert_eq!(check_text("{With tax} / 2"), Ok(FormulaType::Number));
    assert_eq!(
        check_text("Due + Started"),
        Err("A date can't be added to a date.".into())
    );
    assert_eq!(
        check_text("Due * 2"),
        Err("A date can't be multiplied by a number.".into())
    );
    assert_eq!(
        check_text("1 - Due"),
        Err("A date can't be subtracted from a number.".into())
    );
    assert_eq!(
        check_text("2 / Due"),
        Err("A number can't be divided by a date.".into())
    );
    assert_eq!(check_text("-Due"), Err("A date can't be negated.".into()));
    assert_eq!(
        check_text("Name + 1"),
        Err("Name is a text column; formulas use number and date columns.".into())
    );
}

#[test]
fn refuses_cycles_through_derived_columns() {
    let table = orders();
    let reads_with_tax = parse(&table, "{With tax} + 1").unwrap();

    assert_eq!(
        check(&table, Some(placement(TOTAL)), &reads_with_tax),
        Err("With tax can't be used here: its value depends on this column.".into())
    );
    assert_eq!(
        check(&table, Some(placement(TOTAL)), &column(TOTAL)),
        Err("Total can't be used here: its value depends on this column.".into())
    );
    assert_eq!(
        check(&table, Some(placement(QUANTITY)), &reads_with_tax),
        Err("With tax can't be used here: its value depends on this column.".into())
    );
    assert_eq!(
        check(&table, Some(placement(STARTED)), &reads_with_tax),
        Ok(FormulaType::Number)
    );
}

#[test]
fn evaluates_numbers_dates_and_empties() {
    let table = orders();
    let due = Utc.with_ymd_and_hms(2026, 10, 1, 9, 0, 0).unwrap();
    let started = Utc.with_ymd_and_hms(2026, 9, 21, 9, 0, 0).unwrap();
    let cells = HashMap::from([
        (PRICE, Cell::Number(2.5)),
        (QUANTITY, Cell::Number(4.0)),
        (DUE, Cell::Date(due)),
        (STARTED, Cell::Date(started)),
    ]);
    let value = |text: &str, cells: &HashMap<Uuid, Cell>| {
        evaluate(&table, &parse(&table, text).unwrap(), cells, |id| id)
    };

    assert_eq!(
        value("{Unit price} * Quantity", &cells),
        Some(Cell::Number(10.0))
    );
    assert_eq!(value("{With tax}", &cells), Some(Cell::Number(12.0)));
    assert_eq!(
        value("Due + 7", &cells),
        Some(Cell::Date(
            Utc.with_ymd_and_hms(2026, 10, 8, 9, 0, 0).unwrap()
        ))
    );
    assert_eq!(
        value("Due - 0.5", &cells),
        Some(Cell::Date(
            Utc.with_ymd_and_hms(2026, 9, 30, 21, 0, 0).unwrap()
        ))
    );
    assert_eq!(value("Due - Started", &cells), Some(Cell::Number(10.0)));
    assert_eq!(value("Quantity / 0", &cells), None);

    // An empty number reads as 0 while another input has a value...
    let only_price = HashMap::from([(PRICE, Cell::Number(2.5))]);
    assert_eq!(
        value("{Unit price} + Quantity", &only_price),
        Some(Cell::Number(2.5))
    );
    // ...but with every input empty, so is the result.
    assert_eq!(value("{Unit price} + Quantity", &HashMap::new()), None);
    assert_eq!(value("{With tax}", &HashMap::new()), None);
    // An empty date has no stand-in.
    assert_eq!(value("Due - Started", &only_price), None);
    assert_eq!(value("Due + Quantity", &only_price), None);
}

#[test]
fn evaluates_under_relation_keys() {
    let table = orders();
    let key = |id: Uuid| Uuid::new_v5(&id, &[1]);
    let cells = HashMap::from([
        (key(PRICE), Cell::Number(3.0)),
        (key(QUANTITY), Cell::Number(2.0)),
    ]);

    assert_eq!(
        evaluate(&table, &column(TOTAL), &cells, key),
        Some(Cell::Number(6.0))
    );
}
