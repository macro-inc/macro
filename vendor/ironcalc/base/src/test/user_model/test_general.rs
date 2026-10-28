#![allow(clippy::unwrap_used)]

use crate::constants::{LAST_COLUMN, LAST_ROW};
use crate::test::user_model::util::new_empty_user_model;
use crate::test::util::new_empty_model;
use crate::types::CellType;
use crate::UserModel;

#[test]
fn set_user_input_errors() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // Wrong sheet
    assert!(model.set_user_input(1, 1, 1, "1").is_err());
    // Wrong row
    assert!(model.set_user_input(0, 0, 1, "1").is_err());
    // Wrong column
    assert!(model.set_user_input(0, 1, 0, "1").is_err());
    // row too large
    assert!(model.set_user_input(0, LAST_ROW, 1, "1").is_ok());
    assert!(model.set_user_input(0, LAST_ROW + 1, 1, "1").is_err());
    // column too large
    assert!(model.set_user_input(0, 1, LAST_COLUMN, "1").is_ok());
    assert!(model.set_user_input(0, 1, LAST_COLUMN + 1, "1").is_err());
}

#[test]
fn user_model_debug_message() {
    let model = new_empty_user_model();
    let s = &format!("{model:?}");
    assert_eq!(s, "UserModel");
}

#[test]
fn cell_type() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "1").unwrap();
    model.set_user_input(0, 1, 2, "Wish you were here").unwrap();
    model.set_user_input(0, 1, 3, "true").unwrap();
    model.set_user_input(0, 1, 4, "=1/0").unwrap();

    assert_eq!(model.get_cell_type(0, 1, 1).unwrap(), CellType::Number);
    assert_eq!(model.get_cell_type(0, 1, 2).unwrap(), CellType::Text);
    assert_eq!(
        model.get_cell_type(0, 1, 3).unwrap(),
        CellType::LogicalValue
    );
    assert_eq!(model.get_cell_type(0, 1, 4).unwrap(), CellType::ErrorValue);

    // empty cells are number type
    assert_eq!(model.get_cell_type(0, 40, 40).unwrap(), CellType::Number);
}

#[test]
fn insert_remove_rows() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    let height = model.get_row_height(0, 5).unwrap();

    // Insert some data in row 5 (and change the style)
    assert!(model.set_user_input(0, 5, 1, "100$").is_ok());
    // Change the height of the column
    assert!(model.set_rows_height(0, 5, 5, 3.0 * height).is_ok());

    // remove the row
    assert!(model.delete_rows(0, 5, 1).is_ok());
    // Row 5 has now the normal height
    assert_eq!(model.get_row_height(0, 5), Ok(height));
    // There is no value in A5
    assert_eq!(model.get_formatted_cell_value(0, 5, 1), Ok("".to_string()));
    // Setting a value will not format it
    assert!(model.set_user_input(0, 5, 1, "125").is_ok());
    assert_eq!(
        model.get_formatted_cell_value(0, 5, 1),
        Ok("125".to_string())
    );

    // undo twice
    assert!(model.undo().is_ok());
    assert!(model.undo().is_ok());

    assert_eq!(model.get_row_height(0, 5), Ok(3.0 * height));
    assert_eq!(
        model.get_formatted_cell_value(0, 5, 1),
        Ok("100$".to_string())
    );
}

#[test]
fn insert_remove_columns() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // column E
    let column_width = model.get_column_width(0, 5).unwrap();

    // Insert some data in row 5 (and change the style) in E1
    assert!(model.set_user_input(0, 1, 5, "100$").is_ok());
    // Change the width of the column
    assert!(model.set_columns_width(0, 5, 5, 3.0 * column_width).is_ok());
    assert_eq!(model.get_column_width(0, 5).unwrap(), 3.0 * column_width);

    // remove the column
    assert!(model.delete_columns(0, 5, 1).is_ok());
    // Column 5 has now the normal width
    assert_eq!(model.get_column_width(0, 5), Ok(column_width));
    // There is no value in E5
    assert_eq!(model.get_formatted_cell_value(0, 1, 5), Ok("".to_string()));
    // Setting a value will not format it
    assert!(model.set_user_input(0, 1, 5, "125").is_ok());
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 5),
        Ok("125".to_string())
    );

    // undo twice (set_user_input and delete_column)
    assert!(model.undo().is_ok());
    assert!(model.undo().is_ok());

    assert_eq!(model.get_column_width(0, 5), Ok(3.0 * column_width));
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 5),
        Ok("100$".to_string())
    );
}

#[test]
fn delete_remove_cell() {
    let mut model = new_empty_user_model();
    let (sheet, row, column) = (0, 1, 1);
    model.set_user_input(sheet, row, column, "100$").unwrap();
}

#[test]
fn get_and_set_name() {
    let mut model = UserModel::new_empty("MyWorkbook123", "en", "UTC", "en").unwrap();
    assert_eq!(model.get_name(), "MyWorkbook123");

    model.set_name("Another name");
    assert_eq!(model.get_name(), "Another name");
}

#[test]
fn set_name_undo_redo() {
    let mut model = UserModel::new_empty("MyWorkbook123", "en", "UTC", "en").unwrap();
    model.set_name("Another name");
    assert_eq!(model.get_name(), "Another name");

    model.undo().unwrap();
    assert_eq!(model.get_name(), "MyWorkbook123");

    model.redo().unwrap();
    assert_eq!(model.get_name(), "Another name");

    let send_queue = model.flush_send_queue();

    let mut model2 = UserModel::new_empty("MyWorkbook123", "en", "UTC", "en").unwrap();
    model2.apply_external_diffs(&send_queue).unwrap();
    assert_eq!(model2.get_name(), "Another name");
}

#[test]
fn set_name_with_same_name_is_not_added_to_history() {
    let mut model = UserModel::new_empty("MyWorkbook123", "en", "UTC", "en").unwrap();
    model.set_name("Another name");
    // A no-op rename must not push a new entry to the undo stack
    model.set_name("Another name");

    model.undo().unwrap();
    assert_eq!(model.get_name(), "MyWorkbook123");
}
