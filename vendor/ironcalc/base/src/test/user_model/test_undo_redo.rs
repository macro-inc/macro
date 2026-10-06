#![allow(clippy::unwrap_used)]

use crate::{test::util::new_empty_model, UserModel};

#[test]
fn simple_undo_redo() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // at the beginning I cannot undo or redo
    assert!(!model.can_undo());
    assert!(!model.can_redo());
    assert!(model.set_user_input(0, 1, 1, "=1+2").is_ok());

    // Once I enter a value I can undo but not redo
    assert!(model.can_undo());
    assert!(!model.can_redo());
    assert_eq!(model.get_formatted_cell_value(0, 1, 1), Ok("3".to_string()));

    // If I undo, I can't undo anymore, but I can redo
    assert!(model.undo().is_ok());
    assert!(!model.can_undo());
    assert!(model.can_redo());
    assert_eq!(model.get_formatted_cell_value(0, 1, 1), Ok("".to_string()));

    // If I redo, I have the old value and formula
    assert!(model.redo().is_ok());
    assert_eq!(model.get_formatted_cell_value(0, 1, 1), Ok("3".to_string()));
    assert_eq!(model.get_cell_content(0, 1, 1), Ok("=1+2".to_string()));
    assert!(model.can_undo());
    assert!(!model.can_redo());
}

#[test]
fn undo_redo_respect_styles() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    assert!(model.set_user_input(0, 1, 1, "100").is_ok());
    assert!(model.set_user_input(0, 1, 1, "125$").is_ok());
    // The content of the cell is just the number 125
    assert_eq!(model.get_cell_content(0, 1, 1), Ok("125".to_string()));
    assert!(model.undo().is_ok());
    // The cell has no currency number formatting
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 1),
        Ok("100".to_string())
    );
    assert_eq!(model.get_cell_content(0, 1, 1), Ok("100".to_string()));
    assert!(model.redo().is_ok());
    // The cell has the number 125 formatted as '125$'
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 1),
        Ok("125$".to_string())
    );
    assert_eq!(model.get_cell_content(0, 1, 1), Ok("125".to_string()));
}

#[test]
fn can_undo_can_redo() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    assert!(!model.can_undo());
    assert!(!model.can_redo());

    assert!(model.undo().is_ok());
    assert!(model.redo().is_ok());
}
