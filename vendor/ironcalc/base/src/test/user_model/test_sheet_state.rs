#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;
use crate::UserModel;

#[test]
fn basic_tests() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);

    // add three more sheets
    model.new_sheet().unwrap();
    model.new_sheet().unwrap();
    model.new_sheet().unwrap();

    let info = model.get_worksheets_properties();
    assert_eq!(info.len(), 4);
    for sheet in &info {
        assert_eq!(sheet.state, "visible".to_string());
    }

    model.set_selected_sheet(2).unwrap();
    assert_eq!(info.get(2).unwrap().name, "Sheet3".to_string());

    model.hide_sheet(2).unwrap();

    let info = model.get_worksheets_properties();
    assert_eq!(model.get_selected_sheet(), 3);
    assert_eq!(info.get(2).unwrap().state, "hidden".to_string());

    model.undo().unwrap();
    let info = model.get_worksheets_properties();
    assert_eq!(info.get(2).unwrap().state, "visible".to_string());
    model.redo().unwrap();
    let info = model.get_worksheets_properties();
    assert_eq!(info.get(2).unwrap().state, "hidden".to_string());

    model.set_selected_sheet(3).unwrap();
    model.hide_sheet(3).unwrap();
    assert_eq!(model.get_selected_sheet(), 0);

    model.unhide_sheet(2).unwrap();
    model.unhide_sheet(3).unwrap();

    let info = model.get_worksheets_properties();
    assert_eq!(info.len(), 4);
    for sheet in &info {
        assert_eq!(sheet.state, "visible".to_string());
    }

    model.undo().unwrap();
    let info = model.get_worksheets_properties();
    assert_eq!(info.get(3).unwrap().state, "hidden".to_string());
    model.redo().unwrap();
    let info = model.get_worksheets_properties();
    assert_eq!(info.get(3).unwrap().state, "visible".to_string());
}
