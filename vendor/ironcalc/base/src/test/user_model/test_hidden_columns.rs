#![allow(clippy::unwrap_used)]

use crate::test::user_model::util::new_empty_user_model;

#[test]
fn smoke_test() {
    let mut user_model = new_empty_user_model();

    // Let's hide a single column
    user_model.set_columns_hidden(0, 3, 3, true).unwrap();

    assert!(!user_model.model.is_column_hidden(0, 4).unwrap());
    assert!(!user_model.model.is_column_hidden(0, 2).unwrap());
    assert!(user_model.model.is_column_hidden(0, 3).unwrap());

    // a hidden column has width 0.0
    assert_eq!(user_model.get_column_width(0, 3).unwrap(), 0.0);

    // Move around with arrow keys, skipping hidden columns
    user_model.set_selected_cell(1, 1).unwrap();
    user_model.on_arrow_right().unwrap();
    assert_eq!(user_model.get_selected_cell(), (0, 1, 2));

    user_model.on_arrow_right().unwrap();
    assert_eq!(user_model.get_selected_cell(), (0, 1, 4));

    user_model.on_arrow_right().unwrap();
    assert_eq!(user_model.get_selected_cell(), (0, 1, 5));

    user_model.on_arrow_left().unwrap();
    assert_eq!(user_model.get_selected_cell(), (0, 1, 4));

    user_model.on_arrow_left().unwrap();
    assert_eq!(user_model.get_selected_cell(), (0, 1, 2));
}

#[test]
fn undo_redo() {
    let mut user_model = new_empty_user_model();
    let width = user_model.get_column_width(0, 3).unwrap();

    user_model.set_columns_hidden(0, 3, 3, true).unwrap();
    assert_eq!(user_model.get_column_width(0, 3).unwrap(), 0.0);
    assert!(user_model.model.is_column_hidden(0, 3).unwrap());
    user_model.undo().unwrap();
    assert_eq!(user_model.get_column_width(0, 3).unwrap(), width);
    assert!(!user_model.model.is_column_hidden(0, 3).unwrap());
    user_model.redo().unwrap();
    assert!(user_model.model.is_column_hidden(0, 3).unwrap());
}

// Abracadabra || Hidden B || Hidden C || Column D
// After move:
// Hidden A || Hidden B || Column D || Abracadabra
#[test]
fn move_columns_with_hidden_columns() {
    let mut user_model = new_empty_user_model();
    // A1
    user_model.set_user_input(0, 1, 1, "Abracadabra").unwrap();

    // Set data in column 4
    user_model.set_user_input(0, 1, 4, "Column D").unwrap();

    // Hide columns 2 and 3
    user_model.set_columns_hidden(0, 2, 3, true).unwrap();

    // Move column 1 to the right by 1 (so they end up in column 4)
    user_model.move_columns_action(0, 1, 1, 1).unwrap();

    // Columns 1 is now hidden
    assert!(user_model.model.is_column_hidden(0, 1).unwrap());
    // Column 2 is hidden
    assert!(user_model.model.is_column_hidden(0, 2).unwrap());

    // Cell D1 contains "Abracadabra"
    assert_eq!(user_model.get_cell_content(0, 1, 4).unwrap(), "Abracadabra");

    // Column 3 is not hidden
    assert!(!user_model.model.is_column_hidden(0, 3).unwrap());
    // C1 contains "Column D"
    assert_eq!(user_model.get_cell_content(0, 1, 3).unwrap(), "Column D");

    // undo the move
    user_model.undo().unwrap();

    // Columns 1 and 4 are not hidden
    assert!(!user_model.model.is_column_hidden(0, 1).unwrap());
    assert!(!user_model.model.is_column_hidden(0, 4).unwrap());

    // column 2 and 3 are hidden
    assert!(user_model.model.is_column_hidden(0, 2).unwrap());
    assert!(user_model.model.is_column_hidden(0, 3).unwrap());

    // undo the hide columns
    user_model.undo().unwrap();

    // Columns 1 through 4 are not hidden
    assert!(!user_model.model.is_column_hidden(0, 1).unwrap());
    assert!(!user_model.model.is_column_hidden(0, 2).unwrap());
    assert!(!user_model.model.is_column_hidden(0, 3).unwrap());
    assert!(!user_model.model.is_column_hidden(0, 4).unwrap());
}

#[test]
fn move_columns_with_hidden_columns_2() {
    let mut user_model = new_empty_user_model();

    // Hide column 5
    user_model.set_columns_hidden(0, 5, 1, true).unwrap();

    // Move column 4
    user_model.move_columns_action(0, 4, 1, 1).unwrap();

    // undo both actions
    user_model.undo().unwrap();
    user_model.undo().unwrap();

    // None of the columns should be hidden
    assert!(!user_model.model.is_column_hidden(0, 4).unwrap());
    assert!(!user_model.model.is_column_hidden(0, 5).unwrap());
}
