#![allow(clippy::unwrap_used)]

use crate::constants::LAST_ROW;
use crate::expressions::types::Area;
use crate::test::util::new_empty_model;
use crate::UserModel;

#[test]
fn basic_tests() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // This is the first row, column 5
    model.set_user_input(0, 3, 5, "todo").unwrap();

    // Row 3 before column 5 should be empty
    assert_eq!(
        model
            .get_last_non_empty_in_row_before_column(0, 3, 4)
            .unwrap(),
        None
    );
    // Row 3 before column 5 should be 5
    assert_eq!(
        model
            .get_last_non_empty_in_row_before_column(0, 3, 7)
            .unwrap(),
        Some(5)
    );
}

#[test]
fn test_last_empty_cell() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);

    let column_g_range = Area {
        sheet: 0,
        row: 1,
        column: 7,
        width: 1,
        height: LAST_ROW,
    };

    model
        .update_range_style(&column_g_range, "fill.color", "#333444")
        .unwrap();

    // Column 7 has a style but it is empty
    assert_eq!(
        model
            .get_last_non_empty_in_row_before_column(0, 3, 14)
            .unwrap(),
        None
    );
}
