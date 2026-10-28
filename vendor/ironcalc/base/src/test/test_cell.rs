#![allow(clippy::unwrap_used)]

use crate::cell::CellValue;
use crate::test::util::new_empty_model;
use crate::types::{ArrayKind, Cell, CellType, FormulaValue};

#[test]
fn test_cell_get_type() {
    let mut model = new_empty_model();
    model._set("A1", "");
    model._set("A2", "42");
    model._set("A3", "12.34");
    model._set("A4", "foobar");
    model._set("A5", "1+2");
    model._set("A6", "TRUE");
    model._set("A7", "#VALUE!");
    model._set("A8", "=Z100"); // an empty cell, considered to be a CellType::Number
    model._set("A9", "=2*3*7");
    model._set("A10", "=\"foo\"");
    model._set("A11", "=1/0");
    model._set("A12", "=1>0");
    model._set("A13", "=42"); // an Cell::EmptyCell, considered to be a CellType::Number
    model._set("A15", "'"); // an empty string
    model.evaluate();

    model._cell_clear_contents(0, 13, 1).unwrap(); // A13
    model._set("A14", "=42"); // a CellFormula

    assert_eq!(model._get_cell("A1").get_type(), CellType::Number);
    assert_eq!(model._get_cell("A2").get_type(), CellType::Number);
    assert_eq!(model._get_cell("A3").get_type(), CellType::Number);
    assert_eq!(model._get_cell("A4").get_type(), CellType::Text);
    assert_eq!(model._get_cell("A5").get_type(), CellType::Text);
    assert_eq!(model._get_cell("A6").get_type(), CellType::LogicalValue);
    assert_eq!(model._get_cell("A7").get_type(), CellType::ErrorValue);
    assert_eq!(model._get_cell("A8").get_type(), CellType::Number);
    assert_eq!(model._get_cell("A9").get_type(), CellType::Number);
    assert_eq!(model._get_cell("A10").get_type(), CellType::Text);
    assert_eq!(model._get_cell("A11").get_type(), CellType::ErrorValue);
    assert_eq!(model._get_cell("A12").get_type(), CellType::LogicalValue);
    assert_eq!(model._get_cell("A13").get_type(), CellType::Number);
    assert_eq!(model._get_cell("A14").get_type(), CellType::Number);
    assert_eq!(model._get_cell("A15").get_type(), CellType::Text);
}

#[test]
fn cell_is_always_dynamic() {
    let mut model = new_empty_model();
    model._set("A1", "42");
    model._set("B1", "=CELL(\"address\", A1)");
    model._set("B2", "=CELL(\"contents\", A2)");
    model.evaluate();

    let b1_cell = model.workbook.worksheets[0].cell(1, 2).unwrap().clone();
    assert!(matches!(
        b1_cell,
        Cell::ArrayFormula { kind: ArrayKind::Dynamic, v: FormulaValue::Text(ref v), .. } if v == "$A$1"
    ));

    let b2_cell = model.workbook.worksheets[0].cell(2, 2).unwrap().clone();
    assert!(matches!(
        b2_cell,
        Cell::ArrayFormula { kind: ArrayKind::Dynamic, v: FormulaValue::Number(v), .. } if v == 0.0
    ));
}
#[test]
fn test_cell_get_text_on_boolean_cell() {
    let mut model = new_empty_model();

    model.set_user_input(0, 1, 1, "TRUE".to_string()).unwrap();
    model.evaluate();

    assert_eq!(model.get_localized_cell_content(0, 1, 1).unwrap(), "TRUE");
}

#[test]
fn test_cell_value_on_empty_shared_string() {
    let mut model = new_empty_model();

    let _update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_cell_with_string(1, 1, 1, 0); // A1

    assert_eq!(model.get_localized_cell_content(0, 1, 1).unwrap(), "");
}

#[test]
fn test_from_f64_for_cell_value() {
    // Arrange
    let float = 42.42;
    // Act
    let result: CellValue = float.into();
    // Assert
    assert_eq!(result, CellValue::Number(42.42));
}

#[test]
fn test_from_string_for_cell_value() {
    // Arrange
    let string = "42".to_string();
    // Act
    let result: CellValue = string.into();
    // Assert
    assert_eq!(result, CellValue::String("42".to_string()));
}

#[test]
fn test_from_str_for_cell_value() {
    // Arrange
    let str = "42";
    // Act
    let result: CellValue = str.into();
    // Assert
    assert_eq!(result, CellValue::String("42".to_string()));
}

#[test]
fn test_from_bool_for_cell_value() {
    // Arrange
    let boot = true;
    // Act
    let result: CellValue = boot.into();
    // Assert
    assert_eq!(result, CellValue::Boolean(true));
}

#[test]
fn test_cell_has_formula() {
    // Arrange
    let cell = Cell::new_formula(1, 1);
    // Act
    let result = cell.has_formula();
    // Assert
    assert!(result);
}
