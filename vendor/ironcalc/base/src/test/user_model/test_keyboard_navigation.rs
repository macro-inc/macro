#![allow(clippy::unwrap_used)]

use crate::{
    constants::{
        DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT, DEFAULT_WINDOW_HEIGHT, DEFAULT_WINDOW_WIDTH,
        LAST_COLUMN,
    },
    test::util::new_empty_model,
    UserModel,
};

#[test]
fn basic_navigation() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.on_arrow_right().unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.range, [1, 2, 1, 2]);
    assert_eq!(view.column, 2);
    assert_eq!(view.row, 1);

    model.on_arrow_left().unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.range, [1, 1, 1, 1]);
    assert_eq!(view.column, 1);
    assert_eq!(view.row, 1);

    model.on_arrow_left().unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.range, [1, 1, 1, 1]);
    assert_eq!(view.column, 1);
    assert_eq!(view.row, 1);

    model.on_arrow_down().unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.range, [2, 1, 2, 1]);
    assert_eq!(view.column, 1);
    assert_eq!(view.row, 2);

    model.on_arrow_up().unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.range, [1, 1, 1, 1]);
    assert_eq!(view.column, 1);
    assert_eq!(view.row, 1);

    model.on_arrow_up().unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.range, [1, 1, 1, 1]);
    assert_eq!(view.column, 1);
    assert_eq!(view.row, 1);
}

#[test]
fn scroll_right() {
    let window_width = DEFAULT_WINDOW_WIDTH as f64;
    let column_width = DEFAULT_COLUMN_WIDTH;
    let column_count = f64::floor(window_width / column_width) as i32;

    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.on_arrow_right().unwrap();

    model.set_selected_cell(3, column_count).unwrap();
    model.on_arrow_right().unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.left_column, 2);

    model.on_arrow_right().unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.left_column, 3);
}

#[test]
fn last_colum() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_selected_cell(3, LAST_COLUMN).unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.column, LAST_COLUMN);

    model.on_arrow_right().unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.column, LAST_COLUMN);
}

#[test]
fn page_down() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    let window_height = DEFAULT_WINDOW_HEIGHT as f64;
    let row_height = DEFAULT_ROW_HEIGHT;
    let row_count = f64::floor(window_height / row_height) as i32;
    model.on_page_down().unwrap();

    let view = model.get_selected_view();
    assert_eq!(view.row, 1 + row_count);
    let scroll_y = model.get_scroll_y().unwrap();
    assert_eq!(scroll_y, (row_count as f64) * DEFAULT_ROW_HEIGHT);
}

// we just test that page up and page down are inverse operations
#[test]
fn page_up() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.on_page_down().unwrap();
    let row1 = model.get_selected_view().row;

    model.on_page_down().unwrap();
    let row2 = model.get_selected_view().row;

    model.on_page_down().unwrap();
    let row3 = model.get_selected_view().row;

    model.on_page_down().unwrap();

    model.on_page_up().unwrap();
    assert_eq!(model.get_selected_view().row, row3);

    model.on_page_up().unwrap();
    assert_eq!(model.get_selected_view().row, row2);

    model.on_page_up().unwrap();
    assert_eq!(model.get_selected_view().row, row1);

    model.on_page_up().unwrap();
    assert_eq!(model.get_selected_view().row, 1);
}

#[test]
fn page_up_fails_on_row1() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.on_arrow_up().unwrap();
    assert_eq!(model.get_selected_view().row, 1);
}
