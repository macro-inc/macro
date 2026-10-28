#![allow(clippy::unwrap_used)]
use crate::types::Color;

use crate::{
    constants::{DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT, LAST_COLUMN, LAST_ROW},
    expressions::types::Area,
    test::user_model::util::new_empty_user_model,
};

#[test]
fn delete_column_formatting() {
    // We are going to delete formatting in column G (7)
    // There are cells with their own styles
    // There are rows with their own styles
    let mut model = new_empty_user_model();
    let cell_g123 = Area {
        sheet: 0,
        row: 123,
        column: 7,
        width: 1,
        height: 1,
    };

    let column_g_range = Area {
        sheet: 0,
        row: 1,
        column: 7,
        width: 1,
        height: LAST_ROW,
    };

    let row_3_range = Area {
        sheet: 0,
        row: 3,
        column: 1,
        width: LAST_COLUMN,
        height: 1,
    };

    // Set the style of the whole column
    model
        .update_range_style(&column_g_range, "fill.color", "#555666")
        .unwrap();

    // Set G123 background to red
    model
        .update_range_style(&cell_g123, "fill.color", "#FF5533")
        .unwrap();

    // Set the style of the whole row
    model
        .update_range_style(&row_3_range, "fill.color", "#333444")
        .unwrap();

    // Delete the column formatting
    model.range_clear_formatting(&column_g_range).unwrap();

    // Check the style of G123 is now what it was before
    let style = model.get_cell_style(0, 123, 7).unwrap();
    assert_eq!(style.fill.color, Color::None);

    // Check the style of the whole row is still there
    let style = model.get_cell_style(0, 3, 1).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#333444".to_owned()));

    // Check the style of the whole column is now gone
    let style = model.get_cell_style(0, 3, 7).unwrap();
    assert_eq!(style.fill.color, Color::None);

    let style = model.get_cell_style(0, 40, 7).unwrap();
    assert_eq!(style.fill.color, Color::None);

    model.undo().unwrap();

    // Check the style of G123 is now what it was before
    let style = model.get_cell_style(0, 123, 7).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#FF5533".to_owned()));

    // Check G3 is the row style
    let style = model.get_cell_style(0, 3, 7).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#333444".to_owned()));

    // Check G40 is the column style
    let style = model.get_cell_style(0, 40, 7).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#555666".to_owned()));

    model.redo().unwrap();

    // Check the style of G123 is now what it was before
    let style = model.get_cell_style(0, 123, 7).unwrap();
    assert_eq!(style.fill.color, Color::None);

    // Check the style of the whole row is still there
    let style = model.get_cell_style(0, 3, 1).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#333444".to_owned()));

    // Check the style of the whole column is now gone
    let style = model.get_cell_style(0, 3, 7).unwrap();
    assert_eq!(style.fill.color, Color::None);

    let style = model.get_cell_style(0, 40, 7).unwrap();
    assert_eq!(style.fill.color, Color::None);
}

#[test]
fn column_width() {
    let mut model = new_empty_user_model();
    model
        .set_columns_width(0, 7, 7, DEFAULT_COLUMN_WIDTH * 2.0)
        .unwrap();

    let column_g_range = Area {
        sheet: 0,
        row: 1,
        column: 7,
        width: 1,
        height: LAST_ROW,
    };

    // Set the style of the whole column
    model
        .update_range_style(&column_g_range, "fill.color", "#555666")
        .unwrap();

    // Delete the column formatting
    model.range_clear_formatting(&column_g_range).unwrap();
    // This does not change the column width
    assert_eq!(
        model.get_column_width(0, 7).unwrap(),
        2.0 * DEFAULT_COLUMN_WIDTH
    );

    model.undo().unwrap();
    assert_eq!(
        model.get_column_width(0, 7).unwrap(),
        2.0 * DEFAULT_COLUMN_WIDTH
    );
    model.redo().unwrap();
    assert_eq!(
        model.get_column_width(0, 7).unwrap(),
        2.0 * DEFAULT_COLUMN_WIDTH
    );
}

#[test]
fn column_row_style_undo() {
    let mut model = new_empty_user_model();
    model
        .set_columns_width(0, 7, 7, DEFAULT_COLUMN_WIDTH * 2.0)
        .unwrap();

    let column_g_range = Area {
        sheet: 0,
        row: 1,
        column: 7,
        width: 1,
        height: LAST_ROW,
    };

    let row_123_range = Area {
        sheet: 0,
        row: 123,
        column: 1,
        width: LAST_COLUMN,
        height: 1,
    };

    let delete_range = Area {
        sheet: 0,
        row: 120,
        column: 5,
        width: 20,
        height: 20,
    };

    // Set the style of the whole column
    model
        .update_range_style(&column_g_range, "fill.color", "#555666")
        .unwrap();

    model
        .update_range_style(&row_123_range, "fill.color", "#111222")
        .unwrap();

    model.range_clear_formatting(&delete_range).unwrap();

    // check G123 is empty
    let style = model.get_cell_style(0, 123, 7).unwrap();
    assert_eq!(style.fill.color, Color::None);

    // uno clear formatting
    model.undo().unwrap();

    // G123 has the row style
    let style = model.get_cell_style(0, 123, 7).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#111222".to_owned()));

    // undo twice
    model.undo().unwrap();
    model.undo().unwrap();

    // check G123 is empty
    let style = model.get_cell_style(0, 123, 7).unwrap();
    assert_eq!(style.fill.color, Color::None);
}

#[test]
fn column_row_row_height_undo() {
    let mut model = new_empty_user_model();

    let column_g_range = Area {
        sheet: 0,
        row: 1,
        column: 7,
        width: 1,
        height: LAST_ROW,
    };

    let row_3_range = Area {
        sheet: 0,
        row: 3,
        column: 1,
        width: LAST_COLUMN,
        height: 1,
    };

    model
        .update_range_style(&column_g_range, "fill.color", "#555666")
        .unwrap();

    model
        .set_rows_height(0, 3, 3, DEFAULT_ROW_HEIGHT * 2.0)
        .unwrap();

    model
        .update_range_style(&row_3_range, "fill.color", "#111222")
        .unwrap();

    model.undo().unwrap();

    // check G3 has the column style
    let style = model.get_cell_style(0, 3, 7).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#555666".to_string()));
}

// Regression test: deleting a row removes SpillCell style information.
// reset_dynamic_array_spills() removes SpillCells entirely (with ws.remove_cell)
// before the row-shift moves other styled cells into their old positions.
// After evaluate() re-creates the SpillCells they use existing_style from sheet_data,
// but the positions are now empty so they get the default style instead of the
// background colour that was set on the region containing the spill area.
#[test]
fn delete_row_preserves_spill_cell_style() {
    let mut model = new_empty_user_model();

    // Step 1: =SEQUENCE(3) in D5 — spills to D5 (anchor), D6, D7
    model.set_user_input(0, 5, 4, "=SEQUENCE(3)").unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 6, 4).unwrap(), "2");
    assert_eq!(model.get_formatted_cell_value(0, 7, 4).unwrap(), "3");

    // Step 2: apply green background to C4:E9 (includes the spill cells D6 and D7)
    let range = Area {
        sheet: 0,
        row: 4,
        column: 3,
        width: 3,  // C, D, E
        height: 6, // rows 4–9
    };
    model
        .update_range_style(&range, "fill.color", "#00FF00")
        .unwrap();

    // Verify D6 and D7 carry the green style before deletion
    assert_eq!(
        model.get_cell_style(0, 6, 4).unwrap().fill.color,
        Color::Rgb("#00FF00".to_owned())
    );
    assert_eq!(
        model.get_cell_style(0, 7, 4).unwrap().fill.color,
        Color::Rgb("#00FF00".to_owned())
    );

    // Step 3: delete row 1 — everything shifts up by one
    // Old D6 → new D5, old D7 → new D6
    model.delete_rows(0, 1, 1).unwrap();

    // The spill cells (now at D5 and D6) must still carry the green background
    assert_eq!(
        model.get_cell_style(0, 5, 4).unwrap().fill.color,
        Color::Rgb("#00FF00".to_owned()),
        "D5 (ex-D6 spill cell) should retain green background after row deletion"
    );
    assert_eq!(
        model.get_cell_style(0, 6, 4).unwrap().fill.color,
        Color::Rgb("#00FF00".to_owned()),
        "D6 (ex-D7 spill cell) should retain green background after row deletion"
    );
}

// Regression test: undoing a row-6 deletion loses the green style on D6 (a SpillCell).
// After undo the row is restored, but D6 ends up with the default style instead of the
// background colour that was set before the deletion.
#[test]
fn undo_delete_row_preserves_spill_cell_style() {
    let mut model = new_empty_user_model();

    // =SEQUENCE(3) in D5 spills to D5 (anchor), D6, D7
    model.set_user_input(0, 5, 4, "=SEQUENCE(3)").unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 6, 4).unwrap(), "2");
    assert_eq!(model.get_formatted_cell_value(0, 7, 4).unwrap(), "3");

    // Apply green background to C4:E9 (covers D5, D6, D7)
    let range = Area {
        sheet: 0,
        row: 4,
        column: 3,
        width: 3,  // C, D, E
        height: 6, // rows 4–9
    };
    model
        .update_range_style(&range, "fill.color", "#00FF00")
        .unwrap();

    assert_eq!(
        model.get_cell_style(0, 6, 4).unwrap().fill.color,
        Color::Rgb("#00FF00".to_owned())
    );

    // Delete row 6 (the first spill cell of the array)
    model.delete_rows(0, 6, 1).unwrap();

    // Undo the deletion — D6 must recover the green background
    model.undo().unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 6, 4).unwrap(),
        "2",
        "D6 should show the spilled value 2 after undo"
    );
    assert_eq!(
        model.get_cell_style(0, 6, 4).unwrap().fill.color,
        Color::Rgb("#00FF00".to_owned()),
        "D6 (spill cell) should retain green background after undo of row deletion"
    );
}
