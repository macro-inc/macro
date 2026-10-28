#![allow(clippy::unwrap_used)]

use crate::test::user_model::util::new_empty_user_model;

/// Returns the worksheet names in workbook (tab) order.
fn sheet_names(model: &crate::UserModel) -> Vec<String> {
    model
        .get_worksheets_properties()
        .iter()
        .map(|p| p.name.clone())
        .collect()
}

/// Name of the currently selected sheet, so we can assert the selection follows
/// a sheet across a reorder by identity (not by slot).
fn selected_name(model: &crate::UserModel) -> String {
    let properties = model.get_worksheets_properties();
    properties[model.get_selected_sheet() as usize].name.clone()
}

#[test]
fn move_reorders_sheets() {
    let mut model = new_empty_user_model();
    model.new_sheet().unwrap();
    model.new_sheet().unwrap();
    assert_eq!(sheet_names(&model), ["Sheet1", "Sheet2", "Sheet3"]);

    // Move the first sheet to the end.
    model.move_sheet(0, 2).unwrap();
    assert_eq!(sheet_names(&model), ["Sheet2", "Sheet3", "Sheet1"]);

    // Move the last sheet to the front.
    model.move_sheet(2, 0).unwrap();
    assert_eq!(sheet_names(&model), ["Sheet1", "Sheet2", "Sheet3"]);

    // Move a middle sheet.
    model.move_sheet(1, 2).unwrap();
    assert_eq!(sheet_names(&model), ["Sheet1", "Sheet3", "Sheet2"]);
}

#[test]
fn move_undo_redo() {
    let mut model = new_empty_user_model();
    model.new_sheet().unwrap();
    model.new_sheet().unwrap();

    model.move_sheet(0, 2).unwrap();
    assert_eq!(sheet_names(&model), ["Sheet2", "Sheet3", "Sheet1"]);

    model.undo().unwrap();
    assert_eq!(sheet_names(&model), ["Sheet1", "Sheet2", "Sheet3"]);

    model.redo().unwrap();
    assert_eq!(sheet_names(&model), ["Sheet2", "Sheet3", "Sheet1"]);
}

#[test]
fn move_to_same_index_is_noop() {
    let mut model = new_empty_user_model();
    model.new_sheet().unwrap();

    model.move_sheet(1, 1).unwrap();
    assert_eq!(sheet_names(&model), ["Sheet1", "Sheet2"]);
    // A no-op move records no history: the only undoable action is the
    // `new_sheet`, so a single undo drops back to one sheet.
    model.undo().unwrap();
    assert_eq!(sheet_names(&model), ["Sheet1"]);
    assert!(!model.can_undo());
}

#[test]
fn move_out_of_range_is_rejected() {
    let mut model = new_empty_user_model();
    model.new_sheet().unwrap();

    assert!(model.move_sheet(2, 0).is_err());
    assert!(model.move_sheet(0, 2).is_err());
    // A rejected move leaves the order untouched and records no history: the
    // only undoable action is the `new_sheet`.
    assert_eq!(sheet_names(&model), ["Sheet1", "Sheet2"]);
    model.undo().unwrap();
    assert_eq!(sheet_names(&model), ["Sheet1"]);
    assert!(!model.can_undo());
}

#[test]
fn move_preserves_cross_sheet_references() {
    let mut model = new_empty_user_model();
    model.new_sheet().unwrap();
    model.new_sheet().unwrap();
    // Sheet1=0, Sheet2=1, Sheet3=2.
    model.set_user_input(1, 1, 1, "42").unwrap(); // Sheet2!A1 = 42
    model.set_user_input(0, 1, 1, "=Sheet2!A1").unwrap(); // Sheet1!A1
    model.set_user_input(2, 1, 1, "=Sheet2!A1").unwrap(); // Sheet3!A1
    assert_eq!(model.get_formatted_cell_value(0, 1, 1).unwrap(), "42");
    assert_eq!(model.get_formatted_cell_value(2, 1, 1).unwrap(), "42");

    // Reorder: move Sheet2 (the referenced sheet) to the front.
    model.move_sheet(1, 0).unwrap();
    assert_eq!(sheet_names(&model), ["Sheet2", "Sheet1", "Sheet3"]);
    // The formulas moved with their sheets and still resolve by name.
    // Sheet1 is now at index 1, Sheet3 at index 2, Sheet2 at index 0.
    assert_eq!(model.get_formatted_cell_value(1, 1, 1).unwrap(), "42");
    assert_eq!(model.get_formatted_cell_value(2, 1, 1).unwrap(), "42");
    assert_eq!(model.get_formatted_cell_value(0, 1, 1).unwrap(), "42");

    // A dependent recompute still flows across the reorder.
    model.set_user_input(0, 1, 1, "100").unwrap(); // Sheet2!A1 = 100
    assert_eq!(model.get_formatted_cell_value(1, 1, 1).unwrap(), "100");

    // Undo the value edit and the move; references remain intact throughout.
    model.undo().unwrap();
    model.undo().unwrap();
    assert_eq!(sheet_names(&model), ["Sheet1", "Sheet2", "Sheet3"]);
    assert_eq!(model.get_formatted_cell_value(0, 1, 1).unwrap(), "42");
    assert_eq!(model.get_formatted_cell_value(2, 1, 1).unwrap(), "42");
}

#[test]
fn move_keeps_the_same_sheet_selected() {
    let mut model = new_empty_user_model();
    model.new_sheet().unwrap();
    model.new_sheet().unwrap();

    // Select a sheet that is not the one being moved.
    model.set_selected_sheet(1).unwrap();
    assert_eq!(selected_name(&model), "Sheet2");

    // Move a different sheet; selection follows Sheet2 by identity.
    model.move_sheet(0, 2).unwrap();
    assert_eq!(sheet_names(&model), ["Sheet2", "Sheet3", "Sheet1"]);
    assert_eq!(selected_name(&model), "Sheet2");

    // Moving the selected sheet keeps it selected at its new slot.
    model.move_sheet(0, 2).unwrap();
    assert_eq!(sheet_names(&model), ["Sheet3", "Sheet1", "Sheet2"]);
    assert_eq!(selected_name(&model), "Sheet2");

    // Undo restores order and the same sheet stays selected.
    model.undo().unwrap();
    assert_eq!(sheet_names(&model), ["Sheet2", "Sheet3", "Sheet1"]);
    assert_eq!(selected_name(&model), "Sheet2");
}

#[test]
fn move_propagates() {
    let mut model = new_empty_user_model();
    model.new_sheet().unwrap();
    model.new_sheet().unwrap();
    model.move_sheet(0, 2).unwrap();

    let send_queue = model.flush_send_queue();

    // A fresh peer replays the whole queue (the two `new_sheet`s and the move).
    let mut model2 = new_empty_user_model();
    model2.apply_external_diffs(&send_queue).unwrap();

    assert_eq!(sheet_names(&model2), ["Sheet2", "Sheet3", "Sheet1"]);
}
