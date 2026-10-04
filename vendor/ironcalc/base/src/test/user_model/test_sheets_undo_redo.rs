#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;
use crate::UserModel;

#[test]
fn basic_undo_redo() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    assert_eq!(model.get_selected_sheet(), 0);

    model.new_sheet().unwrap();
    assert_eq!(model.get_selected_sheet(), 1);
    model.undo().unwrap();
    assert_eq!(model.get_selected_sheet(), 0);
    {
        let props = model.get_worksheets_properties();
        assert_eq!(props.len(), 1);
        let view = model.get_selected_view();
        assert_eq!(view.sheet, 0);
    }

    model.redo().unwrap();
    assert_eq!(model.get_selected_sheet(), 1);
    {
        let props = model.get_worksheets_properties();
        assert_eq!(props.len(), 2);
        let view = model.get_selected_view();

        assert_eq!(view.sheet, 1);
    }
}

#[test]
fn delete_undo() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    assert_eq!(model.get_selected_sheet(), 0);

    model.new_sheet().unwrap();
    assert_eq!(model.get_selected_sheet(), 1);
    model.set_user_input(1, 1, 1, "42").unwrap();
    model.set_user_input(1, 1, 2, "=A1*2").unwrap();
    model.delete_sheet(1).unwrap();

    assert_eq!(model.get_selected_sheet(), 0);

    model.undo().unwrap();
    assert_eq!(model.get_selected_sheet(), 1);
    model.redo().unwrap();
    assert_eq!(model.get_selected_sheet(), 0);
}
