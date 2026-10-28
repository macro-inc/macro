#![allow(clippy::unwrap_used)]
use crate::test::util::new_empty_model;

#[test]
fn test_cell_clear_contents_non_existing_sheet() {
    let mut model = new_empty_model();
    assert_eq!(
        model._cell_clear_contents(13, 1, 1),
        Err("Invalid sheet index".to_string())
    );
}

#[test]
fn test_cell_clear_contents_unset_cell() {
    let mut model = new_empty_model();
    model._cell_clear_contents(0, 1, 1).unwrap();
    assert_eq!(model.is_empty_cell(0, 1, 1), Ok(true));
    model.evaluate();
    assert_eq!(model._get_text_at(0, 1, 1), "");
}

#[test]
fn test_cell_clear_contents_with_value() {
    let mut model = new_empty_model();
    model._set("A1", "hello");
    model.evaluate();

    assert_eq!(model._get_text_at(0, 1, 1), "hello");
    assert_eq!(model.is_empty_cell(0, 1, 1), Ok(false));

    model._cell_clear_contents(0, 1, 1).unwrap();
    model.evaluate();

    assert_eq!(model._get_text_at(0, 1, 1), "");
    assert_eq!(model.is_empty_cell(0, 1, 1), Ok(true));
}

#[test]
fn test_cell_clear_contents_referenced_elsewhere() {
    let mut model = new_empty_model();
    model._set("A1", "35");
    model._set("A2", "=2*A1");
    model.evaluate();

    assert_eq!(model._get_text_at(0, 1, 1), "35");
    assert_eq!(model._get_text_at(0, 2, 1), "70");
    assert_eq!(model.is_empty_cell(0, 1, 1), Ok(false));
    assert_eq!(model.is_empty_cell(0, 2, 1), Ok(false));

    model._cell_clear_contents(0, 1, 1).unwrap();
    model.evaluate();

    assert_eq!(model._get_text_at(0, 1, 1), "");
    assert_eq!(model._get_text_at(0, 2, 1), "0");
    assert_eq!(model.is_empty_cell(0, 1, 1), Ok(true));
    assert_eq!(model.is_empty_cell(0, 2, 1), Ok(false));
}
