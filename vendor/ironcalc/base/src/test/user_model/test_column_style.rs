#![allow(clippy::unwrap_used)]
use crate::types::Color;

use crate::constants::{DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT, LAST_COLUMN, LAST_ROW};
use crate::expressions::types::Area;
use crate::test::user_model::util::new_empty_user_model;

#[test]
fn column_width() {
    let mut model = new_empty_user_model();
    let range = Area {
        sheet: 0,
        row: 1,
        column: 7,
        width: 1,
        height: LAST_ROW,
    };

    let style = model.get_cell_style(0, 1, 1).unwrap();
    assert!(!style.font.i);
    assert!(!style.font.b);
    assert!(!style.font.u);
    assert!(!style.font.strike);
    // Default font has no color set — see Font::default() in types.rs.
    assert_eq!(style.font.color, Color::None);

    // Set the whole column style and check it works
    model.update_range_style(&range, "font.b", "true").unwrap();
    let style = model.get_cell_style(0, 109, 7).unwrap();
    assert!(style.font.b);

    // undo and check it works
    model.undo().unwrap();
    let style = model.get_cell_style(0, 109, 7).unwrap();
    assert!(!style.font.b);

    // redo and check it works
    model.redo().unwrap();
    let style = model.get_cell_style(0, 109, 7).unwrap();
    assert!(style.font.b);

    // change the column width and check it does not affect the style
    model
        .set_columns_width(0, 7, 7, DEFAULT_COLUMN_WIDTH * 2.0)
        .unwrap();
    let style = model.get_cell_style(0, 109, 7).unwrap();
    assert!(style.font.b);
}

#[test]
fn existing_style() {
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

    // Set G123 background to red
    model
        .update_range_style(&cell_g123, "fill.color", "#333444")
        .unwrap();

    // Now set the style of the whole column
    model
        .update_range_style(&column_g_range, "fill.color", "#555666")
        .unwrap();

    // Get the style of G123
    let style = model.get_cell_style(0, 123, 7).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#555666".to_owned()));

    model.undo().unwrap();

    // Check the style of G123 is now what it was before
    let style = model.get_cell_style(0, 123, 7).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#333444".to_owned()));

    model.redo().unwrap();

    // Check G123 has the column style now
    let style = model.get_cell_style(0, 123, 7).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#555666".to_owned()));
}

#[test]
fn row_column() {
    // We set the row style, then a column style
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

    // update the row style
    model
        .update_range_style(&row_3_range, "fill.color", "#333444")
        .unwrap();

    // update the column style
    model
        .update_range_style(&column_g_range, "fill.color", "#555666")
        .unwrap();

    // Check G3 has the column style
    let style = model.get_cell_style(0, 3, 7).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#555666".to_owned()));

    // undo twice. Color must be default
    model.undo().unwrap();
    let style = model.get_cell_style(0, 3, 7).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#333444".to_owned()));
    model.undo().unwrap();
    let style = model.get_cell_style(0, 3, 7).unwrap();
    assert_eq!(style.fill.color, Color::None);
}

#[test]
fn column_row() {
    let mut model = new_empty_user_model();

    let default_style = model.get_cell_style(0, 3, 7).unwrap();

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

    // update the column style
    model
        .update_range_style(&column_g_range, "fill.color", "#555666")
        .unwrap();

    // update the row style
    model
        .update_range_style(&row_3_range, "fill.color", "#333444")
        .unwrap();

    // Check G3 has the row style
    let style = model.get_cell_style(0, 3, 7).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#333444".to_owned()));

    model.undo().unwrap();

    // Check G3 has the column style
    let style = model.get_cell_style(0, 3, 7).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#555666".to_owned()));

    model.undo().unwrap();

    // Check G3 has the default_style
    let style = model.get_cell_style(0, 3, 7).unwrap();
    assert_eq!(style.fill.color, default_style.fill.color);
}

#[test]
fn row_column_column() {
    let mut model = new_empty_user_model();

    let column_c_range = Area {
        sheet: 0,
        row: 1,
        column: 3,
        width: 1,
        height: LAST_ROW,
    };

    let column_e_range = Area {
        sheet: 0,
        row: 1,
        column: 5,
        width: 1,
        height: LAST_ROW,
    };

    let row_5_range = Area {
        sheet: 0,
        row: 5,
        column: 1,
        width: LAST_COLUMN,
        height: 1,
    };

    // update the row style
    model
        .update_range_style(&row_5_range, "fill.color", "#333444")
        .unwrap();

    // update the column style
    model
        .update_range_style(&column_c_range, "fill.color", "#555666")
        .unwrap();

    model
        .update_range_style(&column_e_range, "fill.color", "#CCC111")
        .unwrap();

    model.undo().unwrap();
    model.undo().unwrap();
    model.undo().unwrap();

    // Test E5 has the default style
    let style = model.get_cell_style(0, 5, 5).unwrap();
    assert_eq!(style.fill.color, Color::None);
}

#[test]
fn width_column_undo() {
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
    model
        .update_range_style(&column_g_range, "fill.color", "#CCC111")
        .unwrap();

    model.undo().unwrap();

    assert_eq!(
        model.get_column_width(0, 7).unwrap(),
        DEFAULT_COLUMN_WIDTH * 2.0
    );
}

#[test]
fn height_row_undo() {
    let mut model = new_empty_user_model();
    model
        .set_rows_height(0, 10, 10, DEFAULT_ROW_HEIGHT * 2.0)
        .unwrap();

    let row_10_range = Area {
        sheet: 0,
        row: 10,
        column: 1,
        width: LAST_COLUMN,
        height: 1,
    };

    model
        .update_range_style(&row_10_range, "fill.color", "#CCC111")
        .unwrap();

    assert_eq!(
        model.get_row_height(0, 10).unwrap(),
        2.0 * DEFAULT_ROW_HEIGHT
    );
    model.undo().unwrap();
    assert_eq!(
        model.get_row_height(0, 10).unwrap(),
        2.0 * DEFAULT_ROW_HEIGHT
    );
    model.undo().unwrap();
    assert_eq!(model.get_row_height(0, 10).unwrap(), DEFAULT_ROW_HEIGHT);
}

#[test]
fn cell_row_undo() {
    let mut model = new_empty_user_model();
    let cell_g12 = Area {
        sheet: 0,
        row: 12,
        column: 7,
        width: 1,
        height: 1,
    };

    let row_12_range = Area {
        sheet: 0,
        row: 12,
        column: 1,
        width: LAST_COLUMN,
        height: 1,
    };

    // Set G12 background to red
    model
        .update_range_style(&cell_g12, "fill.color", "#333444")
        .unwrap();

    model
        .update_range_style(&row_12_range, "fill.color", "#CCC111")
        .unwrap();

    let style = model.get_cell_style(0, 12, 7).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#CCC111".to_string()));
    model.undo().unwrap();

    let style = model.get_cell_style(0, 12, 7).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#333444".to_string()));
}

#[test]
fn set_column_style_then_cell() {
    // We check that if we set a cell style in a column that already has a style
    // the styles compound
    let mut model = new_empty_user_model();
    let cell_g12 = Area {
        sheet: 0,
        row: 12,
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

    // Set G12 background to red
    model
        .update_range_style(&column_g_range, "fill.color", "#333444")
        .unwrap();

    model
        .update_range_style(&cell_g12, "alignment.horizontal", "center")
        .unwrap();

    let style = model.get_cell_style(0, 12, 7).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#333444".to_string()));

    model.undo().unwrap();
    model.undo().unwrap();
    let style = model.get_cell_style(0, 12, 7).unwrap();
    assert_eq!(style.fill.color, Color::None);
}

#[test]
fn set_row_style_then_cell() {
    // We check that if we set a cell style in a column that already has a style
    // the styles compound
    let mut model = new_empty_user_model();
    let cell_g12 = Area {
        sheet: 0,
        row: 12,
        column: 7,
        width: 1,
        height: 1,
    };

    let row_12_range = Area {
        sheet: 0,
        row: 12,
        column: 1,
        width: LAST_COLUMN,
        height: 1,
    };

    // Set G12 background to red
    model
        .update_range_style(&row_12_range, "fill.color", "#333444")
        .unwrap();

    model
        .update_range_style(&cell_g12, "alignment.horizontal", "center")
        .unwrap();

    let style = model.get_cell_style(0, 12, 7).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#333444".to_string()));
}

#[test]
fn column_style_then_row_alignment() {
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
        .update_range_style(&row_3_range, "alignment.horizontal", "center")
        .unwrap();
    // check the row alignment does not affect the column style
    let style = model.get_cell_style(0, 3, 7).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#555666".to_string()));
}

#[test]
fn column_style_then_width() {
    let mut model = new_empty_user_model();
    let column_g_range = Area {
        sheet: 0,
        row: 1,
        column: 7,
        width: 1,
        height: LAST_ROW,
    };
    model
        .update_range_style(&column_g_range, "fill.color", "#555666")
        .unwrap();
    model
        .set_columns_width(0, 7, 7, DEFAULT_COLUMN_WIDTH * 2.0)
        .unwrap();

    // Check column width worked:
    assert_eq!(
        model.get_column_width(0, 7).unwrap(),
        DEFAULT_COLUMN_WIDTH * 2.0
    );
}

#[test]
fn test_row_column_column() {
    let mut model = new_empty_user_model();

    let column_c_range = Area {
        sheet: 0,
        row: 1,
        column: 3,
        width: 1,
        height: LAST_ROW,
    };

    let column_e_range = Area {
        sheet: 0,
        row: 1,
        column: 5,
        width: 1,
        height: LAST_ROW,
    };

    let row_5_range = Area {
        sheet: 0,
        row: 5,
        column: 1,
        width: LAST_COLUMN,
        height: 1,
    };

    // update the row style
    model
        .update_range_style(&row_5_range, "fill.color", "#333444")
        .unwrap();

    // update the column style
    model
        .update_range_style(&column_c_range, "fill.color", "#555666")
        .unwrap();

    model
        .update_range_style(&column_e_range, "fill.color", "#CCC111")
        .unwrap();

    // test E5 has the column style
    let style = model.get_cell_style(0, 5, 5).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#CCC111".to_string()));
}
