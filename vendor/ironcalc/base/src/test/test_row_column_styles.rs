#![allow(clippy::unwrap_used)]

use crate::{constants::DEFAULT_COLUMN_WIDTH, test::util::new_empty_model};

#[test]
fn test_model_set_cells_with_values_styles() {
    let mut model = new_empty_model();

    let style_base = model.get_style_for_cell(0, 1, 1).unwrap();
    let mut style = style_base.clone();
    style.font.b = true;

    model.set_column_style(0, 10, &style).unwrap();

    assert!(model.get_style_for_cell(0, 21, 10).unwrap().font.b);

    model.delete_column_style(0, 10).unwrap();

    // There are no styles in the column
    assert!(model.workbook.worksheets[0].cols.is_empty());

    // lets change the column width and check it does not affect the style
    model
        .set_column_width(0, 10, DEFAULT_COLUMN_WIDTH * 2.0)
        .unwrap();
    model.set_column_style(0, 10, &style).unwrap();

    model.delete_column_style(0, 10).unwrap();

    // There are no styles in the column
    assert!(model.workbook.worksheets[0].cols.len() == 1);
}
