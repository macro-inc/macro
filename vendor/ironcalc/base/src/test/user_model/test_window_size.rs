#![allow(clippy::unwrap_used)]

use crate::{
    constants::{DEFAULT_ROW_HEIGHT, DEFAULT_WINDOW_HEIGHT, DEFAULT_WINDOW_WIDTH},
    test::util::new_empty_model,
    UserModel,
};

#[test]
fn basic_test() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    let window_height = model.get_window_height().unwrap();
    assert_eq!(window_height, DEFAULT_WINDOW_HEIGHT);

    let window_width = model.get_window_width().unwrap();
    assert_eq!(window_width, DEFAULT_WINDOW_WIDTH);

    // Set the window height to double the default and check that page_down behaves as expected
    model.set_window_height((window_height * 2) as f64);
    model.on_page_down().unwrap();

    let row_height = DEFAULT_ROW_HEIGHT;
    let row_count = f64::floor((window_height * 2) as f64 / row_height) as i32;
    let view = model.get_selected_view();
    assert_eq!(view.row, 1 + row_count);
    let scroll_y = model.get_scroll_y().unwrap();
    assert_eq!(scroll_y, (row_count as f64) * DEFAULT_ROW_HEIGHT);
}
