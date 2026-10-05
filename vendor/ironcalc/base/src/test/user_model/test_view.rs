#![allow(clippy::unwrap_used)]

use std::collections::HashMap;

use crate::{
    constants::{LAST_COLUMN, LAST_ROW},
    test::util::new_empty_model,
    user_model::SelectedView,
    UserModel,
};

#[test]
fn initial_view() {
    let model = new_empty_model();
    let model = UserModel::from_model(model);
    assert_eq!(model.get_selected_sheet(), 0);
    assert_eq!(model.get_selected_cell(), (0, 1, 1));
    assert_eq!(
        model.get_selected_view(),
        SelectedView {
            sheet: 0,
            row: 1,
            column: 1,
            range: [1, 1, 1, 1],
            top_row: 1,
            left_column: 1
        }
    );
}

#[test]
fn set_the_cell_sets_the_range() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_selected_cell(5, 4).unwrap();
    assert_eq!(model.get_selected_sheet(), 0);
    assert_eq!(model.get_selected_cell(), (0, 5, 4));
    assert_eq!(
        model.get_selected_view(),
        SelectedView {
            sheet: 0,
            row: 5,
            column: 4,
            range: [5, 4, 5, 4],
            top_row: 1,
            left_column: 1
        }
    );
}

#[test]
fn set_the_range_does_not_set_the_cell() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    assert_eq!(
        model.set_selected_range(5, 4, 10, 6),
        Err(
            "The selected cell is not inside the range. Row: '1' and row range '(5, 10)'"
                .to_string()
        )
    );
}

#[test]
fn add_new_sheet_and_back() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.new_sheet().unwrap();
    assert_eq!(model.get_selected_sheet(), 1);
    model.set_selected_cell(5, 4).unwrap();
    model.set_selected_sheet(0).unwrap();
    assert_eq!(model.get_selected_cell(), (0, 1, 1));
    model.set_selected_sheet(1).unwrap();
    assert_eq!(model.get_selected_cell(), (1, 5, 4));
}

#[test]
fn set_selected_cell_errors() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    assert_eq!(
        model.set_selected_cell(-5, 4),
        Err("Invalid row: '-5'".to_string())
    );
    assert_eq!(
        model.set_selected_cell(5, -4),
        Err("Invalid column: '-4'".to_string())
    );
    assert_eq!(
        model.set_selected_range(-1, 1, 1, 1),
        Err("Invalid row: '-1'".to_string())
    );
    assert_eq!(
        model.set_selected_range(1, 0, 1, 1),
        Err("Invalid column: '0'".to_string())
    );
    assert_eq!(
        model.set_selected_range(1, 1, LAST_ROW + 1, 1),
        Err("Invalid row: '1048577'".to_string())
    );
    assert_eq!(
        model.set_selected_range(1, 1, 1, LAST_COLUMN + 1),
        Err("Invalid column: '16385'".to_string())
    );
}

#[test]
fn set_selected_cell_errors_wrong_sheet() {
    let mut model = new_empty_model();
    // forcefully set a wrong index
    model.workbook.views.get_mut(&0).unwrap().sheet = 2;
    let mut model = UserModel::from_model(model);
    // It's returning the wrong number
    assert_eq!(model.get_selected_sheet(), 2);

    // But we can't set the selected cell anymore
    assert_eq!(
        model.set_selected_cell(3, 4),
        Err("Invalid worksheet index 2".to_string())
    );
    assert_eq!(
        model.set_selected_range(3, 4, 5, 6),
        Err("Invalid worksheet index 2".to_string())
    );

    assert_eq!(
        model.set_top_left_visible_cell(3, 4),
        Err("Invalid worksheet index 2".to_string())
    );

    // we can fix it by setting the right cell
    model.set_selected_sheet(0).unwrap();
    model.set_selected_cell(3, 4).unwrap();
}

#[test]
fn set_visible_cell() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_top_left_visible_cell(100, 12).unwrap();

    assert_eq!(
        model.get_selected_view(),
        SelectedView {
            sheet: 0,
            row: 1,
            column: 1,
            range: [1, 1, 1, 1],
            top_row: 100,
            left_column: 12
        }
    );

    let s = serde_json::to_string(&model.get_selected_view()).unwrap();
    assert_eq!(
        serde_json::from_str::<SelectedView>(&s).unwrap(),
        SelectedView {
            sheet: 0,
            row: 1,
            column: 1,
            range: [1, 1, 1, 1],
            top_row: 100,
            left_column: 12
        }
    );
}

#[test]
fn set_visible_cell_errors() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    assert_eq!(
        model.set_top_left_visible_cell(-100, 12),
        Err("Invalid row: '-100'".to_string())
    );
    assert_eq!(
        model.set_top_left_visible_cell(100, -12),
        Err("Invalid column: '-12'".to_string())
    );
}

#[test]
fn errors_no_views() {
    let mut model = new_empty_model();
    // forcefully remove the view
    model.workbook.views = HashMap::new();
    // also in the sheet
    model.workbook.worksheets[0].views = HashMap::new();
    let mut model = UserModel::from_model(model);
    // get methods will return defaults
    assert_eq!(model.get_selected_sheet(), 0);
    assert_eq!(model.get_selected_cell(), (0, 1, 1));
    assert_eq!(
        model.get_selected_view(),
        SelectedView {
            sheet: 0,
            row: 1,
            column: 1,
            range: [1, 1, 1, 1],
            top_row: 1,
            left_column: 1
        }
    );

    // set methods won't complain. but won't work either
    model.set_selected_sheet(0).unwrap();
    model.set_selected_cell(5, 6).unwrap();
    assert_eq!(model.get_selected_cell(), (0, 1, 1));
}

#[test]
fn scroll_offsets_sum_rounded_sizes() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // The UI renders every row and column at a whole number of pixels
    // (rounding each size), so the scroll offsets must be the sum of the
    // individually rounded sizes — not the rounded sum of the raw sizes.
    // These sizes are chosen so the two disagree:
    //   heights: round(20.4) + round(15.4) = 35, but round(20.4 + 15.4) = 36
    //   widths: round(80.6) + round(90.6) = 172, but round(80.6 + 90.6) = 171
    model.set_rows_height(0, 1, 1, 20.4).unwrap();
    model.set_rows_height(0, 2, 2, 15.4).unwrap();
    model.set_columns_width(0, 1, 1, 80.6).unwrap();
    model.set_columns_width(0, 2, 2, 90.6).unwrap();

    model.set_top_left_visible_cell(3, 3).unwrap();

    assert_eq!(model.get_scroll_y(), Ok(35.0));
    assert_eq!(model.get_scroll_x(), Ok(172.0));
}
