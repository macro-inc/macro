#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;
use crate::UserModel;

#[test]
fn basic_tests() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.new_sheet().unwrap();

    // default sheet has show_grid_lines = true
    assert_eq!(model.get_show_grid_lines(0), Ok(true));

    // default new sheet has show_grid_lines = true
    assert_eq!(model.get_show_grid_lines(1), Ok(true));

    // wrong sheet number
    assert_eq!(
        model.get_show_grid_lines(2),
        Err("Invalid sheet index".to_string())
    );

    // we can set it
    model.set_show_grid_lines(1, false).unwrap();
    assert_eq!(model.get_show_grid_lines(1), Ok(false));
    assert_eq!(model.get_show_grid_lines(0), Ok(true));

    model.undo().unwrap();

    assert_eq!(model.get_show_grid_lines(1), Ok(true));
    assert_eq!(model.get_show_grid_lines(0), Ok(true));

    model.redo().unwrap();

    let send_queue = model.flush_send_queue();
    let mut model2 = UserModel::from_model(new_empty_model());
    model2.apply_external_diffs(&send_queue).unwrap();

    assert_eq!(model2.get_show_grid_lines(1), Ok(false));
    assert_eq!(model2.get_show_grid_lines(0), Ok(true));
}
