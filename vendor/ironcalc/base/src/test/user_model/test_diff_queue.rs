#![allow(clippy::unwrap_used)]

use crate::{
    constants::{DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT},
    test::util::new_empty_model,
    UserModel,
};

#[test]
fn send_queue() {
    let mut model1 = UserModel::from_model(new_empty_model());
    let width = model1.get_column_width(0, 3).unwrap() * 3.0;
    model1.set_columns_width(0, 3, 3, width).unwrap();
    model1.set_user_input(0, 1, 2, "Hello IronCalc!").unwrap();
    let send_queue = model1.flush_send_queue();

    let mut model2 = UserModel::from_model(new_empty_model());
    model2.apply_external_diffs(&send_queue).unwrap();

    assert_eq!(model2.get_column_width(0, 3), Ok(width));
    assert_eq!(
        model2.get_formatted_cell_value(0, 1, 2),
        Ok("Hello IronCalc!".to_string())
    );
}

#[test]
fn apply_external_diffs_wrong_str() {
    let mut model1 = UserModel::from_model(new_empty_model());
    assert!(model1.apply_external_diffs("invalid".as_bytes()).is_err());
}

#[test]
fn queue_undo_redo() {
    let mut model1 = UserModel::from_model(new_empty_model());
    let width = model1.get_column_width(0, 3).unwrap() * 3.0;
    model1.set_columns_width(0, 3, 3, width).unwrap();
    model1.set_user_input(0, 1, 2, "Hello IronCalc!").unwrap();
    assert!(model1.undo().is_ok());
    assert!(model1.redo().is_ok());
    let send_queue = model1.flush_send_queue();

    let mut model2 = UserModel::from_model(new_empty_model());
    model2.apply_external_diffs(&send_queue).unwrap();

    assert_eq!(model2.get_column_width(0, 3), Ok(width));
    assert_eq!(
        model2.get_formatted_cell_value(0, 1, 2),
        Ok("Hello IronCalc!".to_string())
    );
}

#[test]
fn queue_undo_redo_multiple() {
    let mut model1 = UserModel::from_model(new_empty_model());

    // do a bunch of things
    model1.set_frozen_columns_count(0, 5).unwrap();
    model1.set_frozen_rows_count(0, 6).unwrap();
    model1.set_columns_width(0, 7, 7, 300.0).unwrap();
    model1.set_rows_height(0, 23, 23, 123.0).unwrap();
    model1.set_user_input(0, 55, 55, "=42+8").unwrap();

    for row in 1..5 {
        model1.set_user_input(0, row, 17, "=ROW()").unwrap();
    }

    model1.insert_rows(0, 3, 1).unwrap();
    model1.insert_rows(0, 3, 1).unwrap();

    // undo al of them
    while model1.can_undo() {
        model1.undo().unwrap();
    }

    // check it is an empty model
    assert_eq!(model1.get_frozen_columns_count(0), Ok(0));
    assert_eq!(model1.get_frozen_rows_count(0), Ok(0));
    assert_eq!(model1.get_column_width(0, 7), Ok(DEFAULT_COLUMN_WIDTH));
    assert_eq!(
        model1.get_formatted_cell_value(0, 55, 55),
        Ok("".to_string())
    );
    assert_eq!(model1.get_row_height(0, 23), Ok(DEFAULT_ROW_HEIGHT));
    assert_eq!(
        model1.get_formatted_cell_value(0, 57, 55),
        Ok("".to_string())
    );
    assert_eq!(model1.get_row_height(0, 25), Ok(DEFAULT_ROW_HEIGHT));

    // redo all of them
    while model1.can_redo() {
        model1.redo().unwrap();
    }

    // now send all this to a new model
    let send_queue = model1.flush_send_queue();
    let mut model2 = UserModel::from_model(new_empty_model());
    model2.apply_external_diffs(&send_queue).unwrap();

    // Check everything is as expected
    assert_eq!(model2.get_frozen_columns_count(0), Ok(5));
    assert_eq!(model2.get_frozen_rows_count(0), Ok(6));
    assert_eq!(model2.get_column_width(0, 7), Ok(300.0));
    // I inserted two rows
    assert_eq!(
        model2.get_formatted_cell_value(0, 57, 55),
        Ok("50".to_string())
    );
    assert_eq!(model2.get_row_height(0, 25), Ok(123.0));

    assert_eq!(
        model2.get_formatted_cell_value(0, 1, 17),
        Ok("1".to_string())
    );
    assert_eq!(
        model2.get_formatted_cell_value(0, 2, 17),
        Ok("2".to_string())
    );

    assert_eq!(
        model2.get_formatted_cell_value(0, 3, 17),
        Ok("".to_string())
    );
    assert_eq!(
        model2.get_formatted_cell_value(0, 4, 17),
        Ok("".to_string())
    );

    assert_eq!(
        model2.get_formatted_cell_value(0, 5, 17),
        Ok("5".to_string())
    );
    assert_eq!(
        model2.get_formatted_cell_value(0, 6, 17),
        Ok("6".to_string())
    );
}

#[test]
fn new_sheet() {
    let mut model1 = UserModel::from_model(new_empty_model());
    model1.new_sheet().unwrap();
    model1.set_user_input(0, 1, 1, "42").unwrap();
    model1.set_user_input(1, 1, 1, "=Sheet1!A1*2").unwrap();

    let send_queue = model1.flush_send_queue();
    let mut model2 = UserModel::from_model(new_empty_model());
    model2.apply_external_diffs(&send_queue).unwrap();

    assert_eq!(
        model2.get_formatted_cell_value(1, 1, 1),
        Ok("84".to_string())
    );
}

#[test]
fn wrong_diffs_handled() {
    let mut model = UserModel::from_model(new_empty_model());
    assert!(model
        .apply_external_diffs("Hello world".as_bytes())
        .is_err());
}
