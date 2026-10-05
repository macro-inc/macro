#![allow(clippy::unwrap_used)]

use crate::{
    constants::{LAST_COLUMN, LAST_ROW},
    test::util::new_empty_model,
    UserModel,
};

#[test]
fn insert_multiple_rows_shifts_cells() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // Place a value below the insertion point.
    model.set_user_input(0, 10, 1, "42").unwrap();

    // Insert 3 rows starting at row 5.
    assert!(model.insert_rows(0, 5, 3).is_ok());

    // The original value should have moved down by 3 rows.
    assert_eq!(model.get_formatted_cell_value(0, 13, 1).unwrap(), "42");

    // Undo / redo cycle should restore the same behaviour.
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 10, 1).unwrap(), "42");
    model.redo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 13, 1).unwrap(), "42");
}

#[test]
fn insert_rows_errors() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);

    // Negative or zero counts are rejected.
    assert_eq!(
        model.insert_rows(0, 1, -2),
        Err("Cannot add a negative number of cells :)".to_string())
    );
    assert_eq!(
        model.insert_rows(0, 1, 0),
        Err("Cannot add a negative number of cells :)".to_string())
    );

    // Inserting too many rows so that the sheet would overflow.
    let too_many = LAST_ROW; // This guarantees max_row + too_many > LAST_ROW.
    assert_eq!(
        model.insert_rows(0, 1, too_many),
        Err(
            "Cannot shift cells because that would delete cells at the end of a column".to_string()
        )
    );
}

#[test]
fn insert_multiple_columns_shifts_cells() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // Place a value to the right of the insertion point.
    model.set_user_input(0, 1, 10, "99").unwrap();

    // Insert 3 columns starting at column 5.
    assert!(model.insert_columns(0, 5, 3).is_ok());

    // The original value should have moved right by 3 columns.
    assert_eq!(model.get_formatted_cell_value(0, 1, 13).unwrap(), "99");

    // Undo / redo cycle.
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 10).unwrap(), "99");
    model.redo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 13).unwrap(), "99");
}

#[test]
fn insert_columns_errors() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);

    // Negative or zero counts are rejected.
    assert_eq!(
        model.insert_columns(0, 1, -2),
        Err("Cannot add a negative number of cells :)".to_string())
    );
    assert_eq!(
        model.insert_columns(0, 1, 0),
        Err("Cannot add a negative number of cells :)".to_string())
    );

    // Overflow to the right.
    let too_many = LAST_COLUMN; // Ensures max_column + too_many > LAST_COLUMN
    assert_eq!(
        model.insert_columns(0, 1, too_many),
        Err("Cannot shift cells because that would delete cells at the end of a row".to_string())
    );
}

#[test]
fn delete_multiple_rows_shifts_cells_upwards() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);

    // Populate rows 10..14 (to be deleted) so that the diff builder does not fail.
    for r in 10..15 {
        model.set_user_input(0, r, 1, "del").unwrap();
    }
    // Place a value below the deletion range.
    model.set_user_input(0, 20, 1, "keep").unwrap();

    // Delete 5 rows starting at row 10.
    assert!(model.delete_rows(0, 10, 5).is_ok());

    // The value originally at row 20 should now be at row 15.
    assert_eq!(model.get_formatted_cell_value(0, 15, 1).unwrap(), "keep");

    // Undo / redo cycle.
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 20, 1).unwrap(), "keep");
    model.redo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 15, 1).unwrap(), "keep");
}

#[test]
fn delete_rows_errors() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);

    // Negative or zero counts are rejected.
    assert_eq!(
        model.delete_rows(0, 1, -3),
        Err("Please use insert rows instead".to_string())
    );
    assert_eq!(
        model.delete_rows(0, 1, 0),
        Err("Please use insert rows instead".to_string())
    );
}

#[test]
fn delete_multiple_columns_shifts_cells_left() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);

    // Place a value to the right of the deletion range.
    model.set_user_input(0, 1, 15, "88").unwrap();

    // Delete 4 columns starting at column 5.
    assert!(model.delete_columns(0, 5, 4).is_ok());

    // The value originally at column 15 should now be at column 11.
    assert_eq!(model.get_formatted_cell_value(0, 1, 11).unwrap(), "88");

    // Undo / redo cycle.
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 15).unwrap(), "88");
    model.redo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 11).unwrap(), "88");
}

#[test]
fn delete_columns_errors() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);

    // Negative or zero counts are rejected.
    assert_eq!(
        model.delete_columns(0, 1, -4),
        Err("Please use insert columns instead".to_string())
    );
    assert_eq!(
        model.delete_columns(0, 1, 0),
        Err("Please use insert columns instead".to_string())
    );
}
