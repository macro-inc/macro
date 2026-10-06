#![allow(clippy::unwrap_used)]
use crate::test::util::new_empty_model;

#[test]
fn test_is_empty_cell_non_existing_sheet() {
    let model = new_empty_model();
    assert_eq!(
        model.is_empty_cell(13, 1, 1),
        Err("Invalid sheet index".to_string())
    );
}

#[test]
fn test_is_empty_cell() {
    let mut model = new_empty_model();
    assert!(model.is_empty_cell(0, 3, 1).unwrap());
    model
        .set_user_input(0, 3, 1, "Hello World".to_string())
        .unwrap();
    assert!(!model.is_empty_cell(0, 3, 1).unwrap());
    model._cell_clear_contents(0, 3, 1).unwrap();
    assert!(model.is_empty_cell(0, 3, 1).unwrap());
}

#[test]
fn test_is_empty_cell_unset_cell() {
    let model = new_empty_model();
    assert_eq!(model.is_empty_cell(0, 1, 1), Ok(true));
}

#[test]
fn test_is_empty_cell_with_value() {
    let mut model = new_empty_model();
    model._set("A1", "hello");
    assert_eq!(model.is_empty_cell(0, 1, 1), Ok(false));
}

#[test]
fn test_is_empty_cell_empty_string_is_empty() {
    let mut model = new_empty_model();
    model._set("A1", "");
    assert_eq!(model.is_empty_cell(0, 1, 1), Ok(true));
}

#[test]
fn test_is_empty_cell_formula_that_evaluates_to_empty_string() {
    let mut model = new_empty_model();
    model._set("A1", "=A2");
    assert_eq!(model.is_empty_cell(0, 1, 1), Ok(false));
}

#[test]
fn test_is_empty_cell_formula_that_evaluates_to_zero() {
    let mut model = new_empty_model();
    model._set("A1", "=2*A2");
    assert_eq!(model.is_empty_cell(0, 1, 1), Ok(false));
}
