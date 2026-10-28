#![allow(clippy::unwrap_used)]

use crate::{
    constants::{DEFAULT_COLUMN_WIDTH, DEFAULT_WINDOW_WIDTH, LAST_COLUMN},
    expressions::types::Area,
    expressions::utils::number_to_column,
    test::util::new_empty_model,
    UserModel,
};

#[test]
fn arrow_right() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.on_expand_selected_range("ArrowRight").unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.range, [1, 1, 1, 2]);
}

#[test]
fn arrow_right_decreases() {
    // if the selected cell is on the upper right corner, right-arrow will decrease the size of teh area
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    let (start_row, start_column, end_row, end_column) = (5, 3, 10, 8);
    model.set_selected_cell(start_row, end_column).unwrap();
    model
        .set_selected_range(start_row, start_column, end_row, end_column)
        .unwrap();

    model.on_expand_selected_range("ArrowRight").unwrap();
    let view = model.get_selected_view();
    assert_eq!(
        view.range,
        [start_row, start_column + 1, end_row, end_column]
    );
}

#[test]
fn arrow_right_last_column() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_selected_cell(1, LAST_COLUMN).unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.range, [1, LAST_COLUMN, 1, LAST_COLUMN]);
}

#[test]
fn arrow_right_scroll_right() {
    let window_width = DEFAULT_WINDOW_WIDTH as f64;
    let column_width = DEFAULT_COLUMN_WIDTH;
    let column_count = f64::floor(window_width / column_width) as i32;

    let model = new_empty_model();
    let mut model = UserModel::from_model(model);

    // initially the column to the left is A
    let view = model.get_selected_view();
    assert_eq!(view.left_column, 1);

    // We select all columns from 1 to the last visible
    let (start_row, start_column, end_row, end_column) = (1, 1, 1, column_count);
    model.set_selected_cell(start_row, start_column).unwrap();
    model
        .set_selected_range(start_row, start_column, end_row, end_column)
        .unwrap();

    // Now we select one more column
    model.on_expand_selected_range("ArrowRight").unwrap();

    // The view has updated and the first visible column is B
    let view = model.get_selected_view();
    assert_eq!(
        view.range,
        [start_row, start_column, end_row, end_column + 1]
    );
    assert_eq!(view.left_column, 2);

    // now we click on cell B2 and we
    model.set_selected_cell(2, 2).unwrap();
    model.on_expand_selected_range("ArrowLeft").unwrap();

    let view = model.get_selected_view();
    assert_eq!(view.range, [2, 1, 2, 2]);
    assert_eq!(view.left_column, 1);

    // a second arrow left won't do anything
    model.on_expand_selected_range("ArrowLeft").unwrap();

    let view = model.get_selected_view();
    assert_eq!(view.range, [2, 1, 2, 2]);
    assert_eq!(view.left_column, 1);
}

#[test]
fn arrow_left() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_selected_cell(5, 3).unwrap();
    model.set_selected_range(5, 3, 10, 8).unwrap();
    model.on_expand_selected_range("ArrowLeft").unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.range, [5, 3, 10, 7]);
}

#[test]
fn arrow_left_left_border() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.on_expand_selected_range("ArrowLeft").unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.range, [1, 1, 1, 1]);
}

#[test]
fn arrow_left_increases() {
    // If the selected cell is on the top right corner
    // arrow left increases the selected area by
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);

    let (start_row, start_column, end_row, end_column) = (4, 10, 4, 20);
    model.set_selected_cell(start_row, end_column).unwrap();
    model
        .set_selected_range(start_row, start_column, end_row, end_column)
        .unwrap();
    model.on_expand_selected_range("ArrowLeft").unwrap();
    let view = model.get_selected_view();
    assert_eq!(
        view.range,
        [start_row, start_column - 1, end_row, end_column]
    );
}

#[test]
fn arrow_left_scrolls_left() {
    // If the selected cell is on the top right corner
    // arrow left increases the selected area by
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);

    model.set_top_left_visible_cell(1, 50).unwrap();

    model.set_selected_cell(1, 50).unwrap();
    // arrow left x 2
    model.on_expand_selected_range("ArrowLeft").unwrap();
    model.on_expand_selected_range("ArrowLeft").unwrap();

    let view = model.get_selected_view();
    assert_eq!(view.range, [1, 48, 1, 50]);
    assert_eq!(view.left_column, 48);
    assert_eq!(view.column, 50);
}

#[test]
fn arrow_right_with_hidden_columns() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);

    // Hide columns 2 and 3
    model.set_columns_hidden(0, 2, 3, true).unwrap();

    // Select cell A1
    model.set_selected_cell(1, 1).unwrap();

    // Shift + right arrow should select A1:D1, skipping the hidden columns
    model.on_expand_selected_range("ArrowRight").unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.range, [1, 1, 1, 4]);

    // Now go left
    model.on_expand_selected_range("ArrowLeft").unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.range, [1, 1, 1, 1]);
}

#[test]
fn arrow_right_decreases_hidden_columns() {
    // if the selected cell is on the upper right corner, right-arrow will decrease the size of the area
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // Hide column D
    model.set_columns_hidden(0, 4, 4, true).unwrap();
    // Range from C5:H10
    let (start_row, start_column, end_row, end_column) = (5, 3, 10, 8);
    assert_eq!(number_to_column(start_column).unwrap(), "C");
    assert_eq!(number_to_column(end_column).unwrap(), "H");

    // Select cell H5 and the range C5:H10
    model.set_selected_cell(start_row, end_column).unwrap();
    model
        .set_selected_range(start_row, start_column, end_row, end_column)
        .unwrap();

    model.on_expand_selected_range("ArrowRight").unwrap();
    let view = model.get_selected_view();
    // Selected range should now be E5:H10, skipping the hidden column D
    assert_eq!(
        view.range,
        [start_row, start_column + 2, end_row, end_column]
    );

    model.on_expand_selected_range("ArrowLeft").unwrap();
    let view = model.get_selected_view();
    // Selected range should now be C5:H10 again
    assert_eq!(view.range, [start_row, start_column, end_row, end_column]);
}

// Merged cell T47:V51 (columns 20-22). Once the selection grows over the
// merge the selected cell U46 sits mid-edge (not on a corner): expansion must
// keep working and shrinking must collapse back over the merged cell.
#[test]
fn expand_selection_over_a_merged_cell() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model
        .merge_cells(&Area {
            sheet: 0,
            row: 47,
            column: 20,
            width: 3,
            height: 5,
        })
        .unwrap();
    model.set_selected_cell(46, 21).unwrap(); // U46

    // shift+down drags the whole merge in: T46:V51, selected cell still U46
    model.on_expand_selected_range("ArrowDown").unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.range, [46, 20, 51, 22]);
    assert_eq!((view.row, view.column), (46, 21));

    // the next one crosses the merge in a single keystroke: T46:V52
    model.on_expand_selected_range("ArrowDown").unwrap();
    assert_eq!(model.get_selected_view().range, [46, 20, 52, 22]);

    // shrinking retraces the same steps back to the single cell U46
    model.on_expand_selected_range("ArrowUp").unwrap();
    assert_eq!(model.get_selected_view().range, [46, 20, 51, 22]);
    model.on_expand_selected_range("ArrowUp").unwrap();
    assert_eq!(model.get_selected_view().range, [46, 21, 46, 21]);
}

// The same sideways: merged D2:F4, anchor G3 to its right
#[test]
fn expand_selection_sideways_over_a_merged_cell() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model
        .merge_cells(&Area {
            sheet: 0,
            row: 2,
            column: 4,
            width: 3,
            height: 3,
        })
        .unwrap();
    model.set_selected_cell(3, 7).unwrap(); // G3

    model.on_expand_selected_range("ArrowLeft").unwrap();
    assert_eq!(model.get_selected_view().range, [2, 4, 4, 7]);
    model.on_expand_selected_range("ArrowLeft").unwrap();
    assert_eq!(model.get_selected_view().range, [2, 3, 4, 7]);

    model.on_expand_selected_range("ArrowRight").unwrap();
    assert_eq!(model.get_selected_view().range, [2, 4, 4, 7]);
    model.on_expand_selected_range("ArrowRight").unwrap();
    assert_eq!(model.get_selected_view().range, [3, 7, 3, 7]);
}

// With the anchor on a corner, a selection extended past a merged cell must
// be able to shrink back over it (recomputing from anchor and focus; growing
// the previous range would re-add the merge forever)
#[test]
fn selection_shrinks_back_over_a_merged_cell() {
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

    model.on_expand_selected_range("ArrowDown").unwrap();
    assert_eq!(model.get_selected_view().range, [3, 2, 5, 3]);
    model.on_expand_selected_range("ArrowDown").unwrap();
    assert_eq!(model.get_selected_view().range, [3, 2, 6, 3]);

    model.on_expand_selected_range("ArrowUp").unwrap();
    assert_eq!(model.get_selected_view().range, [3, 2, 5, 3]);
    model.on_expand_selected_range("ArrowUp").unwrap();
    assert_eq!(model.get_selected_view().range, [3, 2, 3, 2]);
}

// A selection restored with the selected cell mid-edge (a merge grew the
// range past it) is accepted and expansion keeps working
#[test]
fn set_selected_range_accepts_a_mid_edge_selected_cell() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model
        .merge_cells(&Area {
            sheet: 0,
            row: 47,
            column: 20,
            width: 3,
            height: 5,
        })
        .unwrap();
    model.set_selected_cell(46, 21).unwrap(); // U46
    model.set_selected_range(46, 20, 51, 22).unwrap();
    assert_eq!(model.get_selected_view().range, [46, 20, 51, 22]);

    model.on_expand_selected_range("ArrowDown").unwrap();
    assert_eq!(model.get_selected_view().range, [46, 20, 52, 22]);
}
