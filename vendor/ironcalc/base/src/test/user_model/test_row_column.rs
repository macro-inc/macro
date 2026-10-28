#![allow(clippy::unwrap_used)]

use crate::{
    constants::{DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT, LAST_COLUMN},
    test::{user_model::util::new_empty_user_model, util::new_empty_model},
    UserModel,
};

#[test]
fn simple_insert_row() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    let (sheet, column) = (0, 5);
    for row in 1..5 {
        assert!(model.set_user_input(sheet, row, column, "123").is_ok());
    }
    assert!(model.insert_rows(sheet, 3, 1).is_ok());
    assert_eq!(
        model.get_formatted_cell_value(sheet, 3, column).unwrap(),
        ""
    );

    assert!(model.undo().is_ok());
    assert_eq!(
        model.get_formatted_cell_value(sheet, 3, column).unwrap(),
        "123"
    );
    assert!(model.redo().is_ok());
    assert_eq!(
        model.get_formatted_cell_value(sheet, 3, column).unwrap(),
        ""
    );
}

#[test]
fn simple_insert_column() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    let (sheet, row) = (0, 5);
    for column in 1..5 {
        assert!(model.set_user_input(sheet, row, column, "123").is_ok());
    }
    assert!(model.insert_columns(sheet, 3, 1).is_ok());
    assert_eq!(model.get_formatted_cell_value(sheet, row, 3).unwrap(), "");

    assert!(model.undo().is_ok());
    assert_eq!(
        model.get_formatted_cell_value(sheet, row, 3).unwrap(),
        "123"
    );
    assert!(model.redo().is_ok());
    assert_eq!(model.get_formatted_cell_value(sheet, row, 3).unwrap(), "");
}

#[test]
fn simple_delete_column() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 5, "3").unwrap();
    model.set_user_input(0, 2, 5, "=E1*2").unwrap();
    model
        .set_columns_width(0, 5, 5, DEFAULT_COLUMN_WIDTH * 3.0)
        .unwrap();

    model.delete_columns(0, 5, 1).unwrap();

    assert_eq!(model.get_formatted_cell_value(0, 2, 5), Ok("".to_string()));
    assert_eq!(model.get_column_width(0, 5), Ok(DEFAULT_COLUMN_WIDTH));

    model.undo().unwrap();

    assert_eq!(model.get_formatted_cell_value(0, 2, 5), Ok("6".to_string()));
    assert_eq!(model.get_column_width(0, 5), Ok(DEFAULT_COLUMN_WIDTH * 3.0));

    let send_queue = model.flush_send_queue();

    let mut model2 = new_empty_user_model();
    model2.apply_external_diffs(&send_queue).unwrap();

    assert_eq!(
        model2.get_formatted_cell_value(0, 2, 5),
        Ok("6".to_string())
    );
    assert_eq!(
        model2.get_column_width(0, 5),
        Ok(DEFAULT_COLUMN_WIDTH * 3.0)
    );
}

#[test]
fn delete_column_errors() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    assert_eq!(
        model.delete_columns(1, 1, 1),
        Err("Invalid sheet index".to_string())
    );

    assert_eq!(
        model.delete_columns(0, 0, 1),
        Err("Column number '0' is not valid.".to_string())
    );
    assert_eq!(
        model.delete_columns(0, LAST_COLUMN + 1, 1),
        Err(format!("Column number '{}' is not valid.", LAST_COLUMN + 1))
    );

    assert_eq!(model.delete_columns(0, LAST_COLUMN, 1), Ok(()));
}

#[test]
fn simple_delete_row() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 15, 4, "3").unwrap();
    model.set_user_input(0, 15, 6, "=D15*2").unwrap();

    model
        .set_rows_height(0, 15, 15, DEFAULT_ROW_HEIGHT * 3.0)
        .unwrap();

    model.delete_rows(0, 15, 1).unwrap();

    assert_eq!(model.get_formatted_cell_value(0, 15, 6), Ok("".to_string()));
    assert_eq!(model.get_row_height(0, 15), Ok(DEFAULT_ROW_HEIGHT));

    model.undo().unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 15, 6),
        Ok("6".to_string())
    );
    assert_eq!(model.get_row_height(0, 15), Ok(DEFAULT_ROW_HEIGHT * 3.0));

    let send_queue = model.flush_send_queue();

    let mut model2 = new_empty_user_model();
    model2.apply_external_diffs(&send_queue).unwrap();

    assert_eq!(
        model2.get_formatted_cell_value(0, 15, 6),
        Ok("6".to_string())
    );
    assert_eq!(model2.get_row_height(0, 15), Ok(DEFAULT_ROW_HEIGHT * 3.0));
}

#[test]
fn simple_delete_row_no_style() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 15, 4, "3").unwrap();
    model.set_user_input(0, 15, 6, "=D15*2").unwrap();
    model.delete_rows(0, 15, 1).unwrap();

    assert_eq!(model.get_formatted_cell_value(0, 15, 6), Ok("".to_string()));
}

#[test]
fn row_heigh_increases_automatically() {
    let mut model = new_empty_user_model();
    assert_eq!(model.get_row_height(0, 1), Ok(DEFAULT_ROW_HEIGHT));

    // Entering a single line does not change the height
    model
        .set_user_input(0, 1, 1, "My home in Canada had horses")
        .unwrap();
    assert_eq!(model.get_row_height(0, 1), Ok(DEFAULT_ROW_HEIGHT));

    // entering a two liner does:
    model
        .set_user_input(0, 1, 1, "My home in Canada had horses\nAnd monkeys!")
        .unwrap();
    assert_eq!(model.get_row_height(0, 1), Ok(38.0));
}

#[test]
fn insert_row_evaluates() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "42").unwrap();
    model.set_user_input(0, 1, 2, "=A1*2").unwrap();

    assert!(model.insert_rows(0, 1, 1).is_ok());
    assert_eq!(model.get_formatted_cell_value(0, 2, 2).unwrap(), "84");
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 2).unwrap(), "84");
    model.redo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 2, 2).unwrap(), "84");

    model.delete_rows(0, 1, 1).unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 2).unwrap(), "84");
    assert_eq!(model.get_cell_content(0, 1, 2).unwrap(), "=A1*2");
}

#[test]
fn insert_column_evaluates() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "42").unwrap();
    model.set_user_input(0, 10, 1, "=A1*2").unwrap();

    assert!(model.insert_columns(0, 1, 1).is_ok());
    assert_eq!(model.get_formatted_cell_value(0, 10, 2).unwrap(), "84");

    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 10, 1).unwrap(), "84");
    model.redo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 10, 2).unwrap(), "84");

    model.delete_columns(0, 1, 1).unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 10, 1).unwrap(), "84");
    assert_eq!(model.get_cell_content(0, 10, 1).unwrap(), "=A1*2");
}

// Regression test: deleting a row that contains a spill cell and then undoing
// the deletion must restore the original spill without leaving a stray SpillCell
// that blocks re-evaluation of the formula anchor.
//
// Steps:
//   1. =SEQUENCE(6) in A1 — spills down A1:A6 (values 1..6)
//   2. Delete row 3 (A3 is a SpillCell)
//      → formula re-evaluates, A1:A6 still shows 1..6
//   3. Undo the deletion
//      → A1 must still show 1 (not #SPILL!)
//      → A1:A6 must display 1..6
#[test]
fn delete_row_with_spill_cell_undo_clears_stale_spill() {
    let mut model = new_empty_user_model();

    // Step 1: =SEQUENCE(6) in A1 — spills A1:A6
    model.set_user_input(0, 1, 1, "=SEQUENCE(6)").unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 1).unwrap(), "1");
    assert_eq!(model.get_formatted_cell_value(0, 2, 1).unwrap(), "2");
    assert_eq!(model.get_formatted_cell_value(0, 3, 1).unwrap(), "3");
    assert_eq!(model.get_formatted_cell_value(0, 4, 1).unwrap(), "4");
    assert_eq!(model.get_formatted_cell_value(0, 5, 1).unwrap(), "5");
    assert_eq!(model.get_formatted_cell_value(0, 6, 1).unwrap(), "6");

    // Step 2: delete row 3 (A3 is a SpillCell of the SEQUENCE)
    model.delete_rows(0, 3, 1).unwrap();
    // After deletion + re-evaluation the formula still spills 6 values into A1:A6
    assert_eq!(model.get_formatted_cell_value(0, 1, 1).unwrap(), "1");
    assert_eq!(model.get_formatted_cell_value(0, 2, 1).unwrap(), "2");
    assert_eq!(model.get_formatted_cell_value(0, 6, 1).unwrap(), "6");

    // Step 3: undo — row 3 is re-inserted
    model.undo().unwrap();

    // A1 must not show #SPILL! — the restored SpillCell from old_data must not
    // block re-evaluation of SEQUENCE(6).
    assert_ne!(
        model.get_formatted_cell_value(0, 1, 1).unwrap(),
        "#SPILL!",
        "A1 must not be #SPILL! after undoing the row deletion"
    );
    // Full spill must be intact
    assert_eq!(model.get_formatted_cell_value(0, 1, 1).unwrap(), "1");
    assert_eq!(model.get_formatted_cell_value(0, 2, 1).unwrap(), "2");
    assert_eq!(model.get_formatted_cell_value(0, 3, 1).unwrap(), "3");
    assert_eq!(model.get_formatted_cell_value(0, 4, 1).unwrap(), "4");
    assert_eq!(model.get_formatted_cell_value(0, 5, 1).unwrap(), "5");
    assert_eq!(model.get_formatted_cell_value(0, 6, 1).unwrap(), "6");
    // Row 7 and beyond must be empty
    assert_eq!(model.get_formatted_cell_value(0, 7, 1).unwrap(), "");
}

// Regression test: deleting a column that contains a spill cell and then undoing
// the deletion must restore the original spill without leaving a stray SpillCell
// that blocks re-evaluation of the formula anchor.
//
// Steps:
//   1. =SEQUENCE(1,6) in A1 — spills right A1:F1 (values 1..6)
//   2. Delete column C (col 3, which holds a SpillCell)
//      → formula re-evaluates, A1:F1 still shows 1..6
//   3. Undo the deletion
//      → A1 must still show 1 (not #SPILL!)
//      → A1:F1 must display 1..6
#[test]
fn delete_column_with_spill_cell_undo_clears_stale_spill() {
    let mut model = new_empty_user_model();

    // Step 1: =SEQUENCE(1,6) in A1 — spills A1:F1
    model.set_user_input(0, 1, 1, "=SEQUENCE(1,6)").unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 1).unwrap(), "1");
    assert_eq!(model.get_formatted_cell_value(0, 1, 2).unwrap(), "2");
    assert_eq!(model.get_formatted_cell_value(0, 1, 3).unwrap(), "3");
    assert_eq!(model.get_formatted_cell_value(0, 1, 4).unwrap(), "4");
    assert_eq!(model.get_formatted_cell_value(0, 1, 5).unwrap(), "5");
    assert_eq!(model.get_formatted_cell_value(0, 1, 6).unwrap(), "6");

    // Step 2: delete column C (col 3, a SpillCell of the SEQUENCE)
    model.delete_columns(0, 3, 1).unwrap();
    // After deletion + re-evaluation the formula still spills 6 values into A1:F1
    assert_eq!(model.get_formatted_cell_value(0, 1, 1).unwrap(), "1");
    assert_eq!(model.get_formatted_cell_value(0, 1, 2).unwrap(), "2");
    assert_eq!(model.get_formatted_cell_value(0, 1, 6).unwrap(), "6");

    // Step 3: undo — column C is re-inserted
    model.undo().unwrap();

    // A1 must not show #SPILL! — the restored SpillCell from old_data must not
    // block re-evaluation of SEQUENCE(1,6).
    assert_ne!(
        model.get_formatted_cell_value(0, 1, 1).unwrap(),
        "#SPILL!",
        "A1 must not be #SPILL! after undoing the column deletion"
    );
    // Full spill must be intact
    assert_eq!(model.get_formatted_cell_value(0, 1, 1).unwrap(), "1");
    assert_eq!(model.get_formatted_cell_value(0, 1, 2).unwrap(), "2");
    assert_eq!(model.get_formatted_cell_value(0, 1, 3).unwrap(), "3");
    assert_eq!(model.get_formatted_cell_value(0, 1, 4).unwrap(), "4");
    assert_eq!(model.get_formatted_cell_value(0, 1, 5).unwrap(), "5");
    assert_eq!(model.get_formatted_cell_value(0, 1, 6).unwrap(), "6");
    // Column G and beyond must be empty
    assert_eq!(model.get_formatted_cell_value(0, 1, 7).unwrap(), "");
}
