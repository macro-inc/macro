#![allow(clippy::unwrap_used)]

use crate::{
    constants::{DEFAULT_COLUMN_WIDTH, DEFAULT_WINDOW_WIDTH},
    expressions::types::Area,
    test::util::new_empty_model,
    types::MergedCell,
    UserModel,
};

#[test]
fn basic_test() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);

    model.on_area_selecting(2, 4).unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.range, [1, 1, 2, 4]);
}

// this checks that is we select in the boundary we automatically scroll
#[test]
fn scroll_right() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    let window_width = DEFAULT_WINDOW_WIDTH as f64;
    let column_width = DEFAULT_COLUMN_WIDTH;
    let column_count = f64::floor(window_width / column_width) as i32;
    model.set_selected_cell(3, column_count).unwrap();

    model.on_area_selecting(3, column_count + 3).unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.range, [3, column_count, 3, column_count + 3]);
    assert_eq!(view.left_column, 4);
}

// Dragging a selection from the scrolling pane up into the frozen pane must
// not scroll: the frozen rows are always visible, so no scrolling is needed
// to reach them, and the scroll position the user chose must survive.
#[test]
fn selecting_across_frozen_rows_keeps_the_scroll_position() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_frozen_rows_count(0, 2).unwrap();
    // Scrolled down: the scrolling pane starts at row 10 (rows 3-9 hidden)
    model.set_top_left_visible_cell(10, 1).unwrap();
    // Click B10 in the scrolling pane and drag up across the frozen line to
    // B2 in the frozen pane
    model.set_selected_cell(10, 2).unwrap();
    model.on_area_selecting(2, 2).unwrap();

    let view = model.get_selected_view();
    assert_eq!(view.range, [2, 2, 10, 2]);
    assert_eq!(view.top_row, 10);

    // Merging the selection (what the toolbar button does) merges B2:B10 and
    // still leaves the scroll alone
    model
        .merge_cells(&Area {
            sheet: 0,
            row: 2,
            column: 2,
            width: 1,
            height: 9,
        })
        .unwrap();
    assert_eq!(
        model.get_merged_cells(0).unwrap(),
        vec![MergedCell {
            row: 2,
            column: 2,
            width: 1,
            height: 9,
        }]
    );
    assert_eq!(model.get_selected_view().top_row, 10);
}

// The same for frozen columns: dragging left into the frozen pane must not
// touch the horizontal scroll position
#[test]
fn selecting_across_frozen_columns_keeps_the_scroll_position() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_frozen_columns_count(0, 2).unwrap();
    // Scrolled right: the scrolling pane starts at column 10 (C-I hidden)
    model.set_top_left_visible_cell(1, 10).unwrap();
    // Click J2 in the scrolling pane and drag left across the frozen line to
    // B2 in the frozen pane
    model.set_selected_cell(2, 10).unwrap();
    model.on_area_selecting(2, 2).unwrap();

    let view = model.get_selected_view();
    assert_eq!(view.range, [2, 2, 2, 10]);
    assert_eq!(view.left_column, 10);
}

// Dragging over a merged cell and back retracts the selection (the range is
// recomputed from the anchor and the pointer, not stretched from the grown one)
#[test]
fn area_selection_retracts_over_a_merged_cell() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // merged B4:C5
    model
        .merge_cells(&Area {
            sheet: 0,
            row: 4,
            column: 2,
            width: 2,
            height: 2,
        })
        .unwrap();
    model.set_selected_cell(3, 2).unwrap(); // B3

    model.on_area_selecting(4, 2).unwrap();
    assert_eq!(model.get_selected_view().range, [3, 2, 5, 3]);

    model.on_area_selecting(3, 2).unwrap();
    assert_eq!(model.get_selected_view().range, [3, 2, 3, 2]);
}
