#![allow(clippy::unwrap_used)]

use crate::test::user_model::util::new_empty_user_model;
use crate::{
    constants::{LAST_COLUMN, LAST_ROW},
    expressions::{types::Area, utils::number_to_column},
    types::{Border, BorderItem, BorderStyle, Color},
    BorderArea, UserModel,
};

// checks there are no borders in the sheet
#[track_caller]
fn check_no_borders(model: &UserModel) {
    let workbook = &model.model.workbook;
    for ws in &workbook.worksheets {
        for (_, _, cell) in ws.sheet_data.cells() {
            {
                let style_index = cell.get_style();
                let style = workbook.styles.get_style(style_index).unwrap();
                assert_eq!(
                    style.border,
                    Border {
                        diagonal_up: false,
                        diagonal_down: false,
                        left: None,
                        right: None,
                        top: None,
                        bottom: None,
                        diagonal: None
                    }
                )
            }
        }
    }
}

// checks that all the borders are consistent
#[track_caller]
fn check_borders(model: &UserModel) {
    let workbook = &model.model.workbook;
    for (sheet_index, ws) in workbook.worksheets.iter().enumerate() {
        let sheet = sheet_index as u32;
        for (row, column, cell) in ws.sheet_data.cells() {
            {
                let style_index = cell.get_style();
                let style = workbook.styles.get_style(style_index).unwrap();
                // Top border:
                if let Some(top_border) = style.border.top {
                    if row > 1 {
                        let top_cell_style = model.get_cell_style(sheet, row - 1, column).unwrap();
                        assert_eq!(
                            Some(top_border),
                            top_cell_style.border.bottom,
                            "(Top). Sheet: {sheet}, row: {row}, column: {column}"
                        );
                    }
                }
                // Border to the right
                if let Some(right_border) = style.border.right {
                    if column < LAST_COLUMN {
                        let right_cell_style =
                            model.get_cell_style(sheet, row, column + 1).unwrap();
                        assert_eq!(
                            Some(right_border),
                            right_cell_style.border.left,
                            "(Right). Sheet: {sheet}, row: {row}, column: {column}"
                        );
                    }
                }
                // Bottom border:
                if let Some(bottom_border) = style.border.bottom {
                    if row < LAST_ROW {
                        let bottom_cell_style =
                            model.get_cell_style(sheet, row + 1, column).unwrap();
                        assert_eq!(
                            Some(bottom_border),
                            bottom_cell_style.border.top,
                            "(Bottom). Sheet: {sheet}, row: {row}, column: {column}"
                        );
                    }
                }
                // Left Border
                if let Some(left_border) = style.border.left {
                    if column > 1 {
                        let left_cell_style = model.get_cell_style(sheet, row, column - 1).unwrap();
                        assert_eq!(
                            Some(left_border),
                            left_cell_style.border.right,
                            "(Left). Sheet: {sheet}, row: {row}, column: {column}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn borders_all() {
    let mut model = new_empty_user_model();
    // We set an outer border in cells F5:H9
    let range = &Area {
        sheet: 0,
        row: 5,
        column: 6,
        width: 3,
        height: 4,
    };
    assert_eq!(number_to_column(6).unwrap(), "F");
    assert_eq!(number_to_column(8).unwrap(), "H");
    // ATM we don't have a way to create the object from Rust, that's ok.
    let border_area: BorderArea = serde_json::from_str(
        r##"{
      "item": {
        "style": "thin",
        "color": "#FF5566"
      },
      "type": "All"
    }"##,
    )
    .unwrap();
    model.set_area_with_border(range, &border_area).unwrap();
    for row in 5..9 {
        for column in 6..9 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let border_item = BorderItem {
                style: BorderStyle::Thin,
                color: Color::Rgb("#FF5566".to_string()),
            };
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left: Some(border_item.clone()),
                right: Some(border_item.clone()),
                top: Some(border_item.clone()),
                bottom: Some(border_item.clone()),
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
    }

    // let's check the borders around
    {
        let row = 4;
        for column in 6..9 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let border_item = BorderItem {
                style: BorderStyle::Thin,
                color: Color::Rgb("#FF5566".to_string()),
            };
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left: None,
                right: None,
                top: None,
                bottom: Some(border_item.clone()),
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
        let row = 9;
        for column in 6..9 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let border_item = BorderItem {
                style: BorderStyle::Thin,
                color: Color::Rgb("#FF5566".to_string()),
            };
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left: None,
                right: None,
                top: Some(border_item.clone()),
                bottom: None,
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
    }
    {
        let column = 5;
        for row in 5..9 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let border_item = BorderItem {
                style: BorderStyle::Thin,
                color: Color::Rgb("#FF5566".to_string()),
            };
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left: None,
                right: Some(border_item.clone()),
                top: None,
                bottom: None,
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
        let column = 9;
        for row in 5..9 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let border_item = BorderItem {
                style: BorderStyle::Thin,
                color: Color::Rgb("#FF5566".to_string()),
            };
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left: Some(border_item.clone()),
                right: None,
                top: None,
                bottom: None,
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
    }

    check_borders(&model);

    // Lets remove all of them:
    let border_area: BorderArea = serde_json::from_str(
        r##"{
      "item": {
        "style": "thin",
        "color": "#FF5566"
      },
      "type": "None"
    }"##,
    )
    .unwrap();
    model.set_area_with_border(range, &border_area).unwrap();
    for row in 4..10 {
        for column in 5..10 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left: None,
                right: None,
                top: None,
                bottom: None,
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
    }

    check_borders(&model);
}

#[test]
fn borders_inner() {
    let mut model = new_empty_user_model();
    check_borders(&model);
    // We set an outer border in cells F5:H9
    let range = &Area {
        sheet: 0,
        row: 5,
        column: 6,
        width: 3,
        height: 4,
    };
    assert_eq!(number_to_column(6).unwrap(), "F");
    assert_eq!(number_to_column(8).unwrap(), "H");
    // ATM we don't have a way to create the object from Rust, that's ok.
    let border_area: BorderArea = serde_json::from_str(
        r##"{
      "item": {
        "style": "thin",
        "color": "#FF5566"
      },
      "type": "Inner"
    }"##,
    )
    .unwrap();
    model.set_area_with_border(range, &border_area).unwrap();
    check_borders(&model);
    // The inner part all have borders
    for row in 6..8 {
        for column in 7..8 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let border_item = BorderItem {
                style: BorderStyle::Thin,
                color: Color::Rgb("#FF5566".to_string()),
            };
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left: Some(border_item.clone()),
                right: Some(border_item.clone()),
                top: Some(border_item.clone()),
                bottom: Some(border_item.clone()),
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
    }
    // F5 has border only left and bottom
    {
        // We check the border on F5
        let style = model.get_cell_style(0, 5, 6).unwrap();
        let border_item = BorderItem {
            style: BorderStyle::Thin,
            color: Color::Rgb("#FF5566".to_string()),
        };
        // It should be right and bottom
        let expected_border = Border {
            diagonal_up: false,
            diagonal_down: false,
            left: None,
            right: Some(border_item.clone()),
            top: None,
            bottom: Some(border_item),
            diagonal: None,
        };
        assert_eq!(style.border, expected_border);
    }
    {
        // Then let's try the bottom-right border
        let style = model.get_cell_style(0, 8, 8).unwrap();
        let border_item = BorderItem {
            style: BorderStyle::Thin,
            color: Color::Rgb("#FF5566".to_string()),
        };
        // It should be only left and top
        let expected_border = Border {
            diagonal_up: false,
            diagonal_down: false,
            left: Some(border_item.clone()),
            right: None,
            top: Some(border_item.clone()),
            bottom: None,
            diagonal: None,
        };
        assert_eq!(style.border, expected_border);
    }
}

#[test]
fn borders_outer() {
    let mut model = new_empty_user_model();
    // We set an outer border in cells F5:H9
    let range = &Area {
        sheet: 0,
        row: 5,
        column: 6,
        width: 3,
        height: 4,
    };
    assert_eq!(number_to_column(6).unwrap(), "F");
    assert_eq!(number_to_column(8).unwrap(), "H");
    // ATM we don't have a way to create the object from Rust, that's ok.
    let border_area: BorderArea = serde_json::from_str(
        r##"{
      "item": {
        "style": "thin",
        "color": "#FF5566"
      },
      "type": "Outer"
    }"##,
    )
    .unwrap();
    model.set_area_with_border(range, &border_area).unwrap();
    check_borders(&model);
    {
        // We check the border on F5
        let style = model.get_cell_style(0, 5, 6).unwrap();
        let border_item = BorderItem {
            style: BorderStyle::Thin,
            color: Color::Rgb("#FF5566".to_string()),
        };
        // It should be only left and top
        let expected_border = Border {
            diagonal_up: false,
            diagonal_down: false,
            left: Some(border_item.clone()),
            right: None,
            top: Some(border_item),
            bottom: None,
            diagonal: None,
        };
        assert_eq!(style.border, expected_border);
    }
    {
        // Then let's try the bottom-right border
        let style = model.get_cell_style(0, 8, 8).unwrap();
        let border_item = BorderItem {
            style: BorderStyle::Thin,
            color: Color::Rgb("#FF5566".to_string()),
        };
        // It should be only left and top
        let expected_border = Border {
            diagonal_up: false,
            diagonal_down: false,
            left: None,
            right: Some(border_item.clone()),
            top: None,
            bottom: Some(border_item.clone()),
            diagonal: None,
        };
        assert_eq!(style.border, expected_border);
    }

    // let's check the borders around
    {
        let row = 4;
        for column in 6..9 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let border_item = BorderItem {
                style: BorderStyle::Thin,
                color: Color::Rgb("#FF5566".to_string()),
            };
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left: None,
                right: None,
                top: None,
                bottom: Some(border_item.clone()),
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
        let row = 9;
        for column in 6..9 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let border_item = BorderItem {
                style: BorderStyle::Thin,
                color: Color::Rgb("#FF5566".to_string()),
            };
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left: None,
                right: None,
                top: Some(border_item.clone()),
                bottom: None,
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
    }
    {
        let column = 5;
        for row in 5..9 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let border_item = BorderItem {
                style: BorderStyle::Thin,
                color: Color::Rgb("#FF5566".to_string()),
            };
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left: None,
                right: Some(border_item.clone()),
                top: None,
                bottom: None,
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
        let column = 9;
        for row in 5..9 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let border_item = BorderItem {
                style: BorderStyle::Thin,
                color: Color::Rgb("#FF5566".to_string()),
            };
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left: Some(border_item.clone()),
                right: None,
                top: None,
                bottom: None,
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
    }
}

#[test]
fn borders_top() {
    let mut model = new_empty_user_model();
    // We set an outer border in cells F5:H9
    let range = &Area {
        sheet: 0,
        row: 5,
        column: 6,
        width: 3,
        height: 4,
    };
    assert_eq!(number_to_column(6).unwrap(), "F");
    assert_eq!(number_to_column(8).unwrap(), "H");
    // ATM we don't have a way to create the object from Rust, that's ok.
    let border_area: BorderArea = serde_json::from_str(
        r##"{
      "item": {
        "style": "thin",
        "color": "#FF5566"
      },
      "type": "Top"
    }"##,
    )
    .unwrap();
    model.set_area_with_border(range, &border_area).unwrap();
    check_borders(&model);
    for row in 4..9 {
        for column in 6..9 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let border_item = BorderItem {
                style: BorderStyle::Thin,
                color: Color::Rgb("#FF5566".to_string()),
            };
            let bottom = if row != 4 {
                None
            } else {
                Some(border_item.clone())
            };
            let top = if row != 5 {
                None
            } else {
                Some(border_item.clone())
            };
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left: None,
                right: None,
                top,
                bottom,
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
    }

    // let's check the borders around
    {
        let row = 4;
        for column in 6..9 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let border_item = BorderItem {
                style: BorderStyle::Thin,
                color: Color::Rgb("#FF5566".to_string()),
            };
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left: None,
                right: None,
                top: None,
                bottom: Some(border_item.clone()),
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
        let row = 9;
        for column in 6..9 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left: None,
                right: None,
                top: None,
                bottom: None,
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
    }
    {
        let column = 5;
        for row in 5..9 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left: None,
                right: None,
                top: None,
                bottom: None,
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
        let column = 9;
        for row in 5..9 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left: None,
                right: None,
                top: None,
                bottom: None,
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
    }
    assert!(model.undo().is_ok());
    check_no_borders(&model);
}

#[test]
fn borders_right() {
    let mut model = new_empty_user_model();
    // We set an outer border in cells F5:H9
    let range = &Area {
        sheet: 0,
        row: 5,
        column: 6,
        width: 3,
        height: 4,
    };
    assert_eq!(number_to_column(6).unwrap(), "F");
    assert_eq!(number_to_column(8).unwrap(), "H");
    // ATM we don't have a way to create the object from Rust, that's ok.
    let border_area: BorderArea = serde_json::from_str(
        r##"{
      "item": {
        "style": "thin",
        "color": "#FF5566"
      },
      "type": "Right"
    }"##,
    )
    .unwrap();
    model.set_area_with_border(range, &border_area).unwrap();

    for row in 5..9 {
        for column in 6..10 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let border_item = BorderItem {
                style: BorderStyle::Thin,
                color: Color::Rgb("#FF5566".to_string()),
            };
            let left = if column != 9 {
                None
            } else {
                Some(border_item.clone())
            };
            let right = if column != 8 {
                None
            } else {
                Some(border_item.clone())
            };
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left,
                right,
                top: None,
                bottom: None,
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
    }
}

#[test]
fn borders_bottom() {
    let mut model = new_empty_user_model();
    // We set an outer border in cells F5:H9
    let range = &Area {
        sheet: 0,
        row: 5,
        column: 6,
        width: 3,
        height: 4,
    };
    assert_eq!(number_to_column(6).unwrap(), "F");
    assert_eq!(number_to_column(8).unwrap(), "H");
    // ATM we don't have a way to create the object from Rust, that's ok.
    let border_area: BorderArea = serde_json::from_str(
        r##"{
      "item": {
        "style": "thin",
        "color": "#FF5566"
      },
      "type": "Bottom"
    }"##,
    )
    .unwrap();
    model.set_area_with_border(range, &border_area).unwrap();
    check_borders(&model);
    for row in 5..9 {
        for column in 6..9 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let border_item = BorderItem {
                style: BorderStyle::Thin,
                color: Color::Rgb("#FF5566".to_string()),
            };
            // The top will also have a value for all but the first one
            let bottom = if row != 8 {
                None
            } else {
                Some(border_item.clone())
            };
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left: None,
                right: None,
                top: None,
                bottom,
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
    }
}

#[test]
fn borders_left() {
    let mut model = new_empty_user_model();
    // We set an outer border in cells F5:H9
    let range = &Area {
        sheet: 0,
        row: 5,
        column: 6,
        width: 3,
        height: 4,
    };
    assert_eq!(number_to_column(6).unwrap(), "F");
    assert_eq!(number_to_column(8).unwrap(), "H");
    // ATM we don't have a way to create the object from Rust, that's ok.
    let border_area: BorderArea = serde_json::from_str(
        r##"{
      "item": {
        "style": "thin",
        "color": "#FF5566"
      },
      "type": "Left"
    }"##,
    )
    .unwrap();
    model.set_area_with_border(range, &border_area).unwrap();

    for row in 5..9 {
        for column in 6..9 {
            let style = model.get_cell_style(0, row, column).unwrap();
            let border_item = BorderItem {
                style: BorderStyle::Thin,
                color: Color::Rgb("#FF5566".to_string()),
            };
            let left = if column != 6 {
                None
            } else {
                Some(border_item.clone())
            };
            let expected_border = Border {
                diagonal_up: false,
                diagonal_down: false,
                left,
                right: None,
                top: None,
                bottom: None,
                diagonal: None,
            };
            assert_eq!(style.border, expected_border);
        }
        // Column 5 has a border to the right, of course:
        let style = model.get_cell_style(0, row, 5).unwrap();
        let border_item = BorderItem {
            style: BorderStyle::Thin,
            color: Color::Rgb("#FF5566".to_string()),
        };
        let expected_border = Border {
            diagonal_up: false,
            diagonal_down: false,
            left: None,
            right: Some(border_item.clone()),
            top: None,
            bottom: None,
            diagonal: None,
        };
        assert_eq!(style.border, expected_border);
    }
}

#[test]
fn none_borders_get_neighbour() {
    let mut model = new_empty_user_model();
    // We set an outer border in cells F5:
    let range = &Area {
        sheet: 0,
        row: 5,
        column: 6,
        width: 1,
        height: 1,
    };
    let border_area: BorderArea = serde_json::from_str(
        r##"{
      "item": {
        "style": "thin",
        "color": "#FF5566"
      },
      "type": "All"
    }"##,
    )
    .unwrap();
    model.set_area_with_border(range, &border_area).unwrap();

    // Get adjacent cells
    {
        // F4
        let style = model.get_cell_style(0, 4, 6).unwrap();
        let border_item = BorderItem {
            style: BorderStyle::Thin,
            color: Color::Rgb("#FF5566".to_string()),
        };

        let expected_border = Border {
            diagonal_up: false,
            diagonal_down: false,
            left: None,
            right: None,
            top: None,
            bottom: Some(border_item),
            diagonal: None,
        };
        assert_eq!(style.border, expected_border);
    }
    {
        // G5
        let style = model.get_cell_style(0, 5, 7).unwrap();
        let border_item = BorderItem {
            style: BorderStyle::Thin,
            color: Color::Rgb("#FF5566".to_string()),
        };

        let expected_border = Border {
            diagonal_up: false,
            diagonal_down: false,
            left: Some(border_item),
            right: None,
            top: None,
            bottom: None,
            diagonal: None,
        };
        assert_eq!(style.border, expected_border);
    }
    {
        // F6
        let style = model.get_cell_style(0, 6, 6).unwrap();
        let border_item = BorderItem {
            style: BorderStyle::Thin,
            color: Color::Rgb("#FF5566".to_string()),
        };

        let expected_border = Border {
            diagonal_up: false,
            diagonal_down: false,
            left: None,
            right: None,
            top: Some(border_item),
            bottom: None,
            diagonal: None,
        };
        assert_eq!(style.border, expected_border);
    }
    {
        // E5
        let style = model.get_cell_style(0, 5, 5).unwrap();
        let border_item = BorderItem {
            style: BorderStyle::Thin,
            color: Color::Rgb("#FF5566".to_string()),
        };

        let expected_border = Border {
            diagonal_up: false,
            diagonal_down: false,
            left: None,
            right: Some(border_item),
            top: None,
            bottom: None,
            diagonal: None,
        };
        assert_eq!(style.border, expected_border);
    }
}

#[test]
fn heavier_borders() {
    let mut model = new_empty_user_model();

    model._set_cell_border("F5", "#F2F2F2");

    // We set an outer border in F4:
    model._set_cell_border("F4", "#000000");

    // We check the border between F4 and F5
    let border_item = BorderItem {
        style: BorderStyle::Thin,
        color: Color::Rgb("#000000".to_string()),
    };
    assert_eq!(model._get_cell_border("F5").top, Some(border_item.clone()));

    // But the border is actually NOT changed (because it is lighter)
    let border_item2 = BorderItem {
        style: BorderStyle::Thin,
        color: Color::Rgb("#F2F2F2".to_string()),
    };
    assert_eq!(model._get_cell_actual_border("F5").top, Some(border_item2));

    model._set_cell_border("F6", "#000000");
}

#[test]
fn lighter_borders() {
    let mut model = new_empty_user_model();

    model._set_cell_border("F5", "#000000");

    // We set an outer border all around that is "lighter":
    model._set_cell_border("F4", "#F2F2F2");
    model._set_cell_border("G5", "#F2F2F2");
    model._set_cell_border("F6", "#F2F2F2");
    model._set_cell_border("E5", "#F2F2F2");

    // We check the border around F5
    let border_item = BorderItem {
        style: BorderStyle::Thin,
        color: Color::Rgb("#F2F2F2".to_string()),
    };
    let border = model._get_cell_border("F5");
    assert_eq!(border.top, Some(border_item.clone()));
    assert_eq!(border.right, Some(border_item.clone()));
    assert_eq!(border.bottom, Some(border_item.clone()));
    assert_eq!(border.left, Some(border_item.clone()));

    // The border is actually changed (because it is heavier)
    let actual_border = model._get_cell_actual_border("F5");
    assert_eq!(actual_border.top, Some(border_item.clone()));
    assert_eq!(actual_border.right, Some(border_item.clone()));
    assert_eq!(actual_border.bottom, Some(border_item.clone()));
    assert_eq!(actual_border.left, Some(border_item));

    model.undo().unwrap();
    model.undo().unwrap();
    model.undo().unwrap();
    model.undo().unwrap();

    // after undoing the border is what it was
    let border_item = BorderItem {
        style: BorderStyle::Thin,
        color: Color::Rgb("#000000".to_string()),
    };
    let border = model._get_cell_border("F5");
    assert_eq!(border.top, Some(border_item.clone()));
    assert_eq!(border.right, Some(border_item.clone()));
    assert_eq!(border.bottom, Some(border_item.clone()));
    assert_eq!(border.left, Some(border_item.clone()));
}

#[test]
fn autofill() {
    let mut model = new_empty_user_model();

    model._set_area_border("C4:F6", "#F4F4F4", "All");

    // Set a border in D2
    model._set_cell_border("D2", "#000000");
    // now we extend to D8
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 2,
                column: 4,
                width: 1,
                height: 1,
            },
            8,
        )
        .unwrap();
    // auto filling does not change the borders
    let border_item = BorderItem {
        style: BorderStyle::Thin,
        color: Color::Rgb("#000000".to_string()),
    };
    let border = model._get_cell_border("D4");
    assert_eq!(border.top, Some(border_item.clone()));
    assert_eq!(border.right, Some(border_item.clone()));
    assert_eq!(border.bottom, Some(border_item.clone()));
    assert_eq!(border.left, Some(border_item.clone()));

    // E5
    let border_e5 = model._get_cell_border("E5");
    assert_eq!(border_e5.left, Some(border_item.clone()));

    // but it hasn't really changed
    let border_item = BorderItem {
        style: BorderStyle::Thin,
        color: Color::Rgb("#F4F4F4".to_string()),
    };
    let border_e5_actual = model._get_cell_actual_border("E5");
    assert_eq!(border_e5_actual.left, Some(border_item.clone()));
}

#[test]
fn border_top() {
    let mut model = new_empty_user_model();

    model._set_area_border("C4:F6", "#000000", "All");

    // We set all with a lighter color in the top
    model._set_area_border("C4:F6", "#F2F2F2", "Top");

    // C3 doesn't have a border in the bottom
    assert_eq!(model._get_cell_actual_border("C3").bottom, None);

    // But C4 was changed
    let border_item = BorderItem {
        style: BorderStyle::Thin,
        color: Color::Rgb("#F2F2F2".to_string()),
    };
    assert_eq!(model._get_cell_actual_border("C4").top, Some(border_item));

    model.undo().unwrap();

    // This tests that diff lists go in the right order
    let border_item = BorderItem {
        style: BorderStyle::Thin,
        color: Color::Rgb("#000000".to_string()),
    };
    assert_eq!(model._get_cell_actual_border("C4").top, Some(border_item));
}
