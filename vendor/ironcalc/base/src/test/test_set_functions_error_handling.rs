#![allow(clippy::unwrap_used)]

use crate::{expressions::token, test::util::new_empty_model, types::Cell};

#[test]
fn test_update_cell_with_text() {
    let mut model = new_empty_model();

    // Below are safe inputs
    model.set_user_input(0, 1, 1, "Hello".to_string()).unwrap();

    // Now testing all the possible error scenarios

    // Case1 : Invalid sheet
    let update_result = model.update_cell_with_text(1, 1, 1, "new value");
    assert_eq!(update_result, Err("Invalid sheet index".to_string()));

    // Case2 : Invalid Row
    let update_result = model.update_cell_with_text(0, 0, 1, "new value");
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));

    // Case3 : Invalid Column
    let update_result = model.update_cell_with_text(0, 1, 1048579, "new value");
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));
}

#[test]
fn test_update_cell_with_number() {
    let mut model = new_empty_model();

    // Below are safe inputs
    model.update_cell_with_number(0, 1, 1, 10.0).unwrap();

    // Now testing all the possible error scenarios

    // Case1 : Invalid sheet
    let update_result = model.update_cell_with_number(1, 1, 1, 20.0);
    assert_eq!(update_result, Err("Invalid sheet index".to_string()));

    // Case2 : Invalid Row
    let update_result = model.update_cell_with_number(0, 0, 1, 20.0);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));

    // Case3 : Invalid Column
    let update_result = model.update_cell_with_number(0, 1, 1048579, 20.0);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));
}

#[test]
fn test_update_cell_with_bool() {
    let mut model = new_empty_model();

    // Below are safe inputs
    model.update_cell_with_bool(0, 1, 1, true).unwrap();

    // Now testing all the possible error scenarios

    // Case1 : Invalid sheet
    let update_result = model.update_cell_with_bool(1, 1, 1, false);
    assert_eq!(update_result, Err("Invalid sheet index".to_string()));

    // Case2 : Invalid Row
    let update_result = model.update_cell_with_bool(0, 0, 1, false);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));

    // Case3 : Invalid Column
    let update_result = model.update_cell_with_bool(0, 1, 1048579, false);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));
}

#[test]
fn test_update_cell_with_formula() {
    let mut model = new_empty_model();

    // Below are safe inputs
    model.update_cell_with_number(0, 1, 1, 10.0).unwrap();
    model
        .update_cell_with_formula(0, 1, 2, "=A1*2".to_string())
        .unwrap();

    model.evaluate();
    // Now testing all the possible error scenarios

    // Case1 : Invalid sheet
    let update_result = model.update_cell_with_formula(1, 1, 2, "=A1*2".to_string());
    assert_eq!(update_result, Err("Invalid sheet index".to_string()));

    // Case2 : Invalid Row
    let update_result = model.update_cell_with_formula(0, 0, 2, "=A1*2".to_string());
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));

    // Case3 : Invalid Column
    let update_result = model.update_cell_with_formula(0, 1, 1048579, "=A1*2".to_string());
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));

    // Case4 : Invalid formula
    let update_result = model.update_cell_with_formula(0, 1, 2, "A1*42".to_string());
    assert_eq!(
        update_result,
        Err("\"A1*42\" is not a valid formula".to_string())
    );
}

#[test]
fn test_set_user_input() {
    let mut model = new_empty_model();

    // Below are safe inputs
    model.update_cell_with_number(0, 1, 1, 10.0).unwrap();
    model.evaluate();
    // Now testing all the possible error scenarios

    // Case1 : Invalid sheet
    let update_result = model.set_user_input(1, 1, 2, "20.0".to_string());
    assert_eq!(update_result, Err("Invalid sheet index".to_string()));

    // Case2 : Invalid Row
    let update_result = model.set_user_input(0, 0, 2, "20.0".to_string());
    assert_eq!(
        update_result,
        Err("Row or column is outside valid range.".to_string())
    );

    // Case3 : Invalid Column
    let update_result = model.set_user_input(0, 1, 1048579, "20.0".to_string());
    assert_eq!(
        update_result,
        Err("Row or column is outside valid range.".to_string())
    );
}

#[test]
fn test_get_style_for_cell() {
    let mut model = new_empty_model();

    // Below are safe inputs
    model.update_cell_with_number(0, 1, 1, 10.0).unwrap();
    model.evaluate();
    // Now testing all the possible error scenarios

    // Case1 : Invalid sheet
    let update_result = model.get_style_for_cell(1, 1, 2);
    assert_eq!(update_result, Err("Invalid sheet index".to_string()));

    // ATTENTION : get_cell_style_index tries to get cell using row and col
    // if we invalid row or column is given, it will return index 0.

    // Case2 : Invalid Row
    let update_result = model.get_style_for_cell(0, 0, 2);
    assert!(update_result.is_ok());

    // Case3 : Invalid Column
    let update_result = model.get_style_for_cell(0, 1, 1048579);
    assert!(update_result.is_ok());
}

#[test]
fn test_get_cell_style_index() {
    let mut model = new_empty_model();

    // Below are safe inputs
    model.update_cell_with_number(0, 1, 1, 10.0).unwrap();
    model.evaluate();
    // Now testing all the possible error scenarios

    // Case1 : Invalid sheet
    let update_result = model.get_cell_style_index(1, 1, 2);
    assert_eq!(update_result, Err("Invalid sheet index".to_string()));

    // ATTENTION : get_cell_style_index tries to get cell using row and col
    // if we invalid row or column is given, it will return index 0.

    // Case2 : Invalid Row
    let update_result = model.get_cell_style_index(0, 0, 2);
    assert_eq!(update_result, Ok(0));

    // Case3 : Invalid Column
    let update_result = model.get_cell_style_index(0, 1, 1048579);
    assert_eq!(update_result, Ok(0));
}

#[test]
fn test_worksheet_update_cell() {
    let mut model = new_empty_model();

    // Now testing all the possible error scenarios

    // Case1 : Invalid Row
    let update_result =
        model
            .workbook
            .worksheet_mut(0)
            .unwrap()
            .update_cell(0, 1, Cell::new_number(10.0, 1));
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));

    // Case2 : Invalid Column
    let update_result =
        model
            .workbook
            .worksheet_mut(0)
            .unwrap()
            .update_cell(1, 1048579, Cell::new_number(10.0, 1));
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));
}

#[test]
fn test_worksheet_set_cell_style() {
    let mut model = new_empty_model();

    // Now testing all the possible error scenarios

    // Case1 : Invalid Row
    let update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_cell_style(0, 1, 1);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));

    // Case2 : Invalid Column
    let update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_cell_style(1, 1048579, 1);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));
}

#[test]
fn test_worksheet_set_cell_with_formula() {
    let mut model = new_empty_model();

    // Now testing all the possible error scenarios

    // Case1 : Invalid Row
    let update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_cell_with_formula(0, 1, 1, 1);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));

    // Case2 : Invalid Column
    let update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_cell_with_formula(1, 1048579, 1, 1);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));
}

#[test]
fn test_worksheet_set_cell_with_number() {
    let mut model = new_empty_model();

    // Now testing all the possible error scenarios

    // Case1 : Invalid Row
    let update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_cell_with_number(0, 1, 1.0, 1);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));

    // Case2 : Invalid Column
    let update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_cell_with_number(1, 1048579, 1.0, 1);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));
}

#[test]
fn test_worksheet_set_cell_with_string() {
    let mut model = new_empty_model();

    // Now testing all the possible error scenarios

    // Case1 : Invalid Row
    let update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_cell_with_string(0, 1, 1, 1);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));

    // Case2 : Invalid Column
    let update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_cell_with_string(1, 1048579, 1, 1);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));
}

#[test]
fn test_worksheet_set_cell_with_boolean() {
    let mut model = new_empty_model();

    // Now testing all the possible error scenarios

    // Case1 : Invalid Row
    let update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_cell_with_boolean(0, 1, true, 1);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));

    // Case2 : Invalid Column
    let update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_cell_with_boolean(1, 1048579, true, 1);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));
}

#[test]
fn test_worksheet_set_cell_with_error() {
    let mut model = new_empty_model();

    // Now testing all the possible error scenarios

    // Case1: Invalid Row
    let update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_cell_with_error(0, 1, token::Error::ERROR, 1);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));

    // Case2 : Invalid Column
    let update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_cell_with_error(1, 1048579, token::Error::ERROR, 1);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));
}

#[test]
fn test_worksheet_cell_clear_contents() {
    let mut model = new_empty_model();

    model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .update_cell(1, 1, Cell::new_number(10.0, 1))
        .unwrap();
    // Now testing all the possible error scenarios

    // Case1 : Invalid Row
    let update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .cell_clear_contents(0, 1);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));

    // Case2 : Invalid Column
    let update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .cell_clear_contents(1, 1048579);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));

    // Case3 : Valid case
    let update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .cell_clear_contents(1, 1);
    assert_eq!(update_result, Ok(()))
}

#[test]
fn test_worksheet_cell_clear_contents_with_style() {
    let mut model = new_empty_model();

    model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .update_cell(1, 1, Cell::new_number(10.0, 1))
        .unwrap();
    // Now testing all the possible error scenarios

    // Case1 : Invalid Row
    let update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .cell_clear_contents_with_style(0, 1, 1);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));

    // Case2 : Invalid Column
    let update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .cell_clear_contents_with_style(1, 1048579, 1);
    assert_eq!(update_result, Err("Incorrect row or column".to_string()));

    // Case3 : Valid case
    let update_result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .cell_clear_contents_with_style(1, 1, 1);
    assert_eq!(update_result, Ok(()))
}

#[test]
fn workbook_styles_get_style_error_handling() {
    let model = new_empty_model();

    // case 1 : Invalid index
    assert_eq!(
        model.workbook.styles.get_style(15),
        Err("Invalid index provided".to_string())
    );
}

#[test]
fn workbook_styles_get_style_without_quote_prefix_error_handling() {
    let mut model = new_empty_model();

    // case 1 : Invalid index
    assert_eq!(
        model.workbook.styles.get_style_without_quote_prefix(15),
        Err("Invalid index provided".to_string())
    );
}

#[test]
fn workbook_styles_get_style_with_format_error_handling() {
    let mut model = new_empty_model();

    // case 1 : Invalid index
    assert_eq!(
        model
            .workbook
            .styles
            .get_style_with_format(15, "dummy_num_format"),
        Err("Invalid index provided".to_string())
    );
}

#[test]
fn workbook_styles_get_style_with_quote_prefix_handling() {
    let mut model = new_empty_model();

    // case 1 : Invalid index
    assert_eq!(
        model.workbook.styles.get_style_with_quote_prefix(15),
        Err("Invalid index provided".to_string())
    );
}
