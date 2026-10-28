#![allow(clippy::unwrap_used)]

use crate::{
    expressions::types::{Area, CellReferenceIndex},
    test::util::new_empty_model,
};

#[test]
fn extend_to_basic() {
    let mut model = new_empty_model();
    model._set("A1", "=B1*SUM(F5:H10)");

    model.evaluate();

    // A1
    let (sheet, row, column) = (0, 1, 1);

    // extend from A1 to A5
    let (target_row, target_column) = (5, 1);
    let result = model
        .extend_to(sheet, row, column, target_row, target_column)
        .unwrap();
    assert_eq!(&result, "=B5*SUM(F9:H14)");

    // extend from A1 to E1
    let (target_row, target_column) = (1, 5);
    let result = model
        .extend_to(sheet, row, column, target_row, target_column)
        .unwrap();
    assert_eq!(&result, "=F1*SUM(J5:L10)");
}

#[test]
fn extend_to_no_formula() {
    let mut model = new_empty_model();
    model._set("A1", "Hey Jude!");

    model.evaluate();

    // A1
    let (sheet, row, column) = (0, 1, 1);

    // extend from A1 to A5
    let (target_row, target_column) = (5, 1);
    let result = model
        .extend_to(sheet, row, column, target_row, target_column)
        .unwrap();
    assert_eq!(&result, "Hey Jude!");

    // extend from A1 to E1
    let (target_row, target_column) = (1, 5);
    let result = model
        .extend_to(sheet, row, column, target_row, target_column)
        .unwrap();
    assert_eq!(&result, "Hey Jude!");
}

#[test]
fn extend_copied_value_basic() {
    let mut model = new_empty_model();
    let source = CellReferenceIndex {
        sheet: 0,
        row: 1,
        column: 1,
    };
    let target = CellReferenceIndex {
        sheet: 0,
        row: 30,
        column: 1,
    };
    let result = model
        .extend_copied_value("=B1*D4", &source, &target)
        .unwrap();
    assert_eq!(&result, "=B30*D33");

    let result = model
        .extend_copied_value("don't make it sad", &source, &target)
        .unwrap();
    assert_eq!(&result, "don't make it sad");
}

#[test]
fn move_cell_value_to_area_basic() {
    let mut model = new_empty_model();
    let source = CellReferenceIndex {
        sheet: 0,
        row: 3,
        column: 1,
    };
    let target = CellReferenceIndex {
        sheet: 0,
        row: 50,
        column: 1,
    };
    let area = Area {
        sheet: 0,
        row: 1,
        column: 1,
        width: 5,
        height: 4,
    };
    let result = model
        .move_cell_value_to_area("=B1", &source, &target, &area)
        .unwrap();
    assert_eq!(&result, "=B48");
}

#[test]
fn extend_to_sign_prefixed_formulas() {
    let mut model = new_empty_model();
    let source = CellReferenceIndex {
        sheet: 0,
        row: 1,
        column: 1,
    };
    let target = CellReferenceIndex {
        sheet: 0,
        row: 30,
        column: 1,
    };
    let result = model
        .extend_copied_value("-B1*D4", &source, &target)
        .unwrap();
    assert_eq!(&result, "=-B30*D33");
}
