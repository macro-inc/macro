#![allow(clippy::unwrap_used)]

use crate::{
    constants::LAST_ROW, expressions::types::Area, test::util::new_empty_model, UserModel,
};

#[test]
fn two_columns() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);

    // Set style in column C (column 3)
    let column_c_range = Area {
        sheet: 0,
        row: 1,
        column: 3,
        width: 1,
        height: LAST_ROW,
    };
    model
        .update_range_style(&column_c_range, "fill.color", "#333444")
        .unwrap();
    model.set_user_input(0, 5, 3, "2").unwrap();

    // Set Style in column G (column 7)
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
    model.set_user_input(0, 5, 6, "42").unwrap();
    // Set formula in G5: =F5*C5
    model.set_user_input(0, 5, 7, "=F5*C5").unwrap();

    assert_eq!(model.get_formatted_cell_value(0, 5, 7).unwrap(), "84");
}
