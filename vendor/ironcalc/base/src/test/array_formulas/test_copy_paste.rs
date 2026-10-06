#![allow(clippy::unwrap_used)]

use crate::expressions::types::Area;
use crate::test::util::new_empty_model;
use crate::UserModel;

#[test]
fn paste_to_partial_formula() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // Set an array formula in B3:F3 (row=3, col=2, width=5, height=1)
    model.set_user_array_formula(0, 3, 2, 5, 1, "=123").unwrap();

    // Set up source data: A1:C1 (3 columns wide)
    model.set_user_input(0, 1, 1, "X").unwrap();
    model.set_user_input(0, 1, 2, "Y").unwrap();
    model.set_user_input(0, 1, 3, "Z").unwrap();

    model.set_selected_range(1, 1, 1, 3).unwrap();
    let cp = model.copy_to_clipboard().unwrap();

    // Paste at A3 — target is A3:C3, which partially overlaps the array at B3:F3
    model.set_selected_cell(3, 1).unwrap();
    let source_range = (1, 1, 1, 3);
    let result = model.paste_from_clipboard(0, source_range, &cp.data, false);
    assert!(result.is_err());
}

#[test]
fn paste_to_full_formula() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // Set an array formula in B3:F3 (row=3, col=2, width=5, height=1)
    model.set_user_array_formula(0, 3, 2, 5, 1, "=123").unwrap();

    // Set up source data: A1:E1 (5 columns wide)
    model.set_user_input(0, 1, 1, "A").unwrap();
    model.set_user_input(0, 1, 2, "B").unwrap();
    model.set_user_input(0, 1, 3, "C").unwrap();
    model.set_user_input(0, 1, 4, "D").unwrap();
    model.set_user_input(0, 1, 5, "E").unwrap();

    model.set_selected_range(1, 1, 1, 5).unwrap();
    let cp = model.copy_to_clipboard().unwrap();

    // Paste at B3 — target is B3:F3, which exactly covers the array formula
    model.set_selected_cell(3, 2).unwrap();
    let source_range = (1, 1, 1, 5);
    let result = model.paste_from_clipboard(0, source_range, &cp.data, false);
    assert!(result.is_ok());

    // Verify the values were written
    assert_eq!(model.get_formatted_cell_value(0, 3, 2).unwrap(), "A");
    assert_eq!(model.get_formatted_cell_value(0, 3, 3).unwrap(), "B");
    assert_eq!(model.get_formatted_cell_value(0, 3, 4).unwrap(), "C");
    assert_eq!(model.get_formatted_cell_value(0, 3, 5).unwrap(), "D");
    assert_eq!(model.get_formatted_cell_value(0, 3, 6).unwrap(), "E");
}

// Pasting a CSV string that partially overlaps a static array formula must fail
// atomically — no cell should be written before the error is detected.
#[test]
fn paste_csv_to_partial_formula() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // Array at B3:F3 (row=3, col=2, width=5, height=1)
    model.set_user_array_formula(0, 3, 2, 5, 1, "=123").unwrap();

    // CSV is 3 columns wide; pasting at A3 produces target A3:C3, which partially overlaps B3:F3
    let area = Area {
        sheet: 0,
        row: 3,
        column: 1,
        width: 1,
        height: 1,
    };
    let result = model.paste_csv_string(&area, "X\tY\tZ");
    assert!(result.is_err());

    // A3 must not have been partially written before the error
    assert_eq!(model.get_formatted_cell_value(0, 3, 1).unwrap(), "");
}

// Pasting a CSV string that exactly covers a static array formula must succeed.
#[test]
fn paste_csv_to_full_formula() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // Array at B3:F3 (row=3, col=2, width=5, height=1)
    model.set_user_array_formula(0, 3, 2, 5, 1, "=123").unwrap();

    // CSV is 5 columns wide; pasting at B3 produces target B3:F3, exactly covering the array
    let area = Area {
        sheet: 0,
        row: 3,
        column: 2,
        width: 1,
        height: 1,
    };
    model.set_selected_cell(3, 2).unwrap();
    let result = model.paste_csv_string(&area, "A\tB\tC\tD\tE");
    assert!(result.is_ok());

    assert_eq!(model.get_formatted_cell_value(0, 3, 2).unwrap(), "A");
    assert_eq!(model.get_formatted_cell_value(0, 3, 3).unwrap(), "B");
    assert_eq!(model.get_formatted_cell_value(0, 3, 4).unwrap(), "C");
    assert_eq!(model.get_formatted_cell_value(0, 3, 5).unwrap(), "D");
    assert_eq!(model.get_formatted_cell_value(0, 3, 6).unwrap(), "E");
}

// Undoing a CSV paste over a static array formula must restore the original array.
#[test]
fn paste_csv_undo_restores_array_formula() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // Array at B3:F3, formula "=123" → all five cells display "123"
    model.set_user_array_formula(0, 3, 2, 5, 1, "=123").unwrap();

    let area = Area {
        sheet: 0,
        row: 3,
        column: 2,
        width: 1,
        height: 1,
    };
    model.set_selected_cell(3, 2).unwrap();
    model.paste_csv_string(&area, "A\tB\tC\tD\tE").unwrap();

    // Confirm paste landed
    assert_eq!(model.get_formatted_cell_value(0, 3, 2).unwrap(), "A");

    model.undo().unwrap();

    // All five cells must show the original array value again
    assert_eq!(model.get_formatted_cell_value(0, 3, 2).unwrap(), "123");
    assert_eq!(model.get_formatted_cell_value(0, 3, 3).unwrap(), "123");
    assert_eq!(model.get_formatted_cell_value(0, 3, 4).unwrap(), "123");
    assert_eq!(model.get_formatted_cell_value(0, 3, 5).unwrap(), "123");
    assert_eq!(model.get_formatted_cell_value(0, 3, 6).unwrap(), "123");
}

// Undoing a clipboard paste over a static array formula must also restore the original array.
#[test]
fn paste_clipboard_undo_restores_array_formula() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // Array at B3:F3, formula "=123"
    model.set_user_array_formula(0, 3, 2, 5, 1, "=123").unwrap();

    // Source data in row 1
    model.set_user_input(0, 1, 1, "A").unwrap();
    model.set_user_input(0, 1, 2, "B").unwrap();
    model.set_user_input(0, 1, 3, "C").unwrap();
    model.set_user_input(0, 1, 4, "D").unwrap();
    model.set_user_input(0, 1, 5, "E").unwrap();

    model.set_selected_range(1, 1, 1, 5).unwrap();
    let cp = model.copy_to_clipboard().unwrap();

    model.set_selected_cell(3, 2).unwrap();
    model
        .paste_from_clipboard(0, (1, 1, 1, 5), &cp.data, false)
        .unwrap();

    // Confirm paste landed
    assert_eq!(model.get_formatted_cell_value(0, 3, 2).unwrap(), "A");

    model.undo().unwrap();

    // All five cells must show the original array value again
    assert_eq!(model.get_formatted_cell_value(0, 3, 2).unwrap(), "123");
    assert_eq!(model.get_formatted_cell_value(0, 3, 3).unwrap(), "123");
    assert_eq!(model.get_formatted_cell_value(0, 3, 4).unwrap(), "123");
    assert_eq!(model.get_formatted_cell_value(0, 3, 5).unwrap(), "123");
    assert_eq!(model.get_formatted_cell_value(0, 3, 6).unwrap(), "123");
}
