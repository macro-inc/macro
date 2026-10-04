#![allow(clippy::unwrap_used)]
use crate::types::Color;

use crate::{constants::DEFAULT_COLUMN_WIDTH, test::user_model::util::new_empty_user_model};

#[test]
fn add_undo_redo() {
    let mut model = new_empty_user_model();
    model.new_sheet().unwrap();
    model.set_user_input(1, 1, 1, "=1 + 1").unwrap();
    model.set_user_input(1, 1, 2, "=A1*3").unwrap();
    model
        .set_columns_width(1, 5, 5, 5.0 * DEFAULT_COLUMN_WIDTH)
        .unwrap();
    model.new_sheet().unwrap();
    model.set_user_input(2, 1, 1, "=Sheet2!B1").unwrap();

    model.undo().unwrap();
    model.undo().unwrap();

    assert!(model.get_formatted_cell_value(2, 1, 1).is_err());

    model.redo().unwrap();
    model.redo().unwrap();

    assert_eq!(model.get_formatted_cell_value(2, 1, 1), Ok("6".to_string()));

    model.delete_sheet(1).unwrap();
}

#[test]
fn set_sheet_color() {
    let mut model = new_empty_user_model();
    model
        .set_sheet_color(0, &Color::Rgb("#343434".to_string()))
        .unwrap();
    let worksheets_properties = model.get_worksheets_properties();
    assert_eq!(worksheets_properties.len(), 1);
    assert_eq!(
        worksheets_properties[0].color,
        Color::Rgb("#343434".to_owned())
    );
    model.undo().unwrap();
    assert_eq!(model.get_worksheets_properties()[0].color, Color::None);

    model.redo().unwrap();
    assert_eq!(
        model.get_worksheets_properties()[0].color,
        Color::Rgb("#343434".to_owned())
    );
    // changes the color if there is one
    model
        .set_sheet_color(0, &Color::Rgb("#2534FF".to_string()))
        .unwrap();
    assert_eq!(
        model.get_worksheets_properties()[0].color,
        Color::Rgb("#2534FF".to_owned())
    );
    // Setting it back to none
    model.set_sheet_color(0, &Color::None).unwrap();
    assert_eq!(model.get_worksheets_properties()[0].color, Color::None);
}

#[test]
fn new_sheet_propagates() {
    let mut model = new_empty_user_model();
    model.new_sheet().unwrap();

    let send_queue = model.flush_send_queue();

    let mut model2 = new_empty_user_model();
    model2.apply_external_diffs(&send_queue).unwrap();
    let worksheets_properties = model2.get_worksheets_properties();
    assert_eq!(worksheets_properties.len(), 2);
}

#[test]
fn delete_sheet_propagates() {
    let mut model = new_empty_user_model();
    model.new_sheet().unwrap();
    model.delete_sheet(0).unwrap();

    let send_queue = model.flush_send_queue();

    let mut model2 = new_empty_user_model();
    model2.apply_external_diffs(&send_queue).unwrap();
    let sheets_info = model2.get_worksheets_properties();
    assert_eq!(sheets_info.len(), 1);
}

#[test]
fn delete_last_sheet() {
    // Deleting the last sheet, selects the previous
    let mut model = new_empty_user_model();
    model.new_sheet().unwrap();
    model.new_sheet().unwrap();
    model.set_selected_sheet(2).unwrap();
    model.delete_sheet(2).unwrap();

    assert_eq!(model.get_selected_sheet(), 1);
}

#[test]
fn new_sheet_selects_it() {
    let mut model = new_empty_user_model();
    assert_eq!(model.get_selected_sheet(), 0);
    model.new_sheet().unwrap();
    assert_eq!(model.get_selected_sheet(), 1);
}
