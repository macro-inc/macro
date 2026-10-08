#![allow(clippy::unwrap_used)]

use crate::{expressions::types::Area, test::user_model::util::new_empty_user_model};

#[test]
fn quote_prefix() {
    let mut user_model = new_empty_user_model();
    user_model.set_user_input(0, 1, 1, "'=1+1").unwrap();
    assert_eq!(user_model.get_cell_content(0, 1, 1).unwrap(), "'=1+1");
}

#[test]
fn dates() {
    let mut user_model = new_empty_user_model();
    user_model.set_user_input(0, 1, 1, "2024-06-01").unwrap();
    assert_eq!(user_model.get_cell_content(0, 1, 1).unwrap(), "2024-06-01");
}

#[test]
fn dates_format() {
    let mut user_model = new_empty_user_model();
    user_model.set_user_input(0, 1, 1, "Whatever").unwrap();
    user_model.set_user_input(0, 2, 1, "2024-06-01").unwrap();
    // format A1 as date
    let style = user_model.get_cell_style(0, 2, 1).unwrap();
    assert_eq!(style.num_fmt, "yyyy-mm-dd");
    let range = Area {
        sheet: 0,
        row: 1,
        column: 1,
        width: 1,
        height: 1,
    };
    user_model
        .update_range_style(&range, "num_fmt", "yyyy-mm-dd")
        .unwrap();
    assert_eq!(user_model.get_cell_content(0, 1, 1).unwrap(), "Whatever");
}
