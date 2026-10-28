#![allow(clippy::unwrap_used)]

use crate::test::user_model::util::new_empty_user_model;

#[test]
fn basic_rename() {
    let mut model = new_empty_user_model();
    model.rename_sheet(0, "NewSheet").unwrap();
    assert_eq!(model.get_worksheets_properties()[0].name, "NewSheet");
}

#[test]
fn rename_with_same_name() {
    let mut model = new_empty_user_model();
    model.rename_sheet(0, "Sheet1").unwrap();
    assert_eq!(model.get_worksheets_properties()[0].name, "Sheet1");
}

#[test]
fn undo_redo() {
    let mut model = new_empty_user_model();
    model.rename_sheet(0, "NewSheet").unwrap();
    model.undo().unwrap();
    assert_eq!(model.get_worksheets_properties()[0].name, "Sheet1");
    model.redo().unwrap();
    assert_eq!(model.get_worksheets_properties()[0].name, "NewSheet");

    let send_queue = model.flush_send_queue();

    let mut model2 = new_empty_user_model();
    model2.apply_external_diffs(&send_queue).unwrap();
    assert_eq!(model.get_worksheets_properties()[0].name, "NewSheet");
}

#[test]
fn errors() {
    let mut model = new_empty_user_model();
    assert_eq!(
        model.rename_sheet(0, ""),
        Err("Invalid name for a sheet: ''.".to_string())
    );
    assert_eq!(
        model.rename_sheet(1, "Hello"),
        Err("Invalid sheet index".to_string())
    );
}
