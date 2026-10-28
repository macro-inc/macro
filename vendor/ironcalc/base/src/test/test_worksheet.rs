#![allow(clippy::unwrap_used)]

use crate::{
    constants::{LAST_COLUMN, LAST_ROW},
    expressions::types::Area,
    test::util::new_empty_model,
    worksheet::{NavigationDirection, WorksheetDimension},
};

#[test]
fn test_worksheet_dimension_empty_sheet() {
    let model = new_empty_model();
    assert_eq!(
        model.workbook.worksheet(0).unwrap().dimension(),
        WorksheetDimension {
            min_row: 1,
            min_column: 1,
            max_row: 1,
            max_column: 1
        }
    );
}

#[test]
fn test_worksheet_dimension_single_cell() {
    let mut model = new_empty_model();
    model._set("W11", "1");
    assert_eq!(
        model.workbook.worksheet(0).unwrap().dimension(),
        WorksheetDimension {
            min_row: 11,
            min_column: 23,
            max_row: 11,
            max_column: 23
        }
    );
}

#[test]
fn test_worksheet_dimension_single_cell_set_empty() {
    let mut model = new_empty_model();
    model._set("W11", "1");
    model._cell_clear_contents(0, 11, 23).unwrap();
    assert_eq!(
        model.workbook.worksheet(0).unwrap().dimension(),
        WorksheetDimension {
            min_row: 11,
            min_column: 23,
            max_row: 11,
            max_column: 23
        }
    );
}

#[test]
fn test_worksheet_dimension_single_cell_deleted() {
    let mut model = new_empty_model();
    model._set("W11", "1");
    let area = Area {
        sheet: 0,
        row: 11,
        column: 23,
        width: 1,
        height: 1,
    };
    model.range_clear_all(&area).unwrap();
    assert_eq!(
        model.workbook.worksheet(0).unwrap().dimension(),
        WorksheetDimension {
            min_row: 1,
            min_column: 1,
            max_row: 1,
            max_column: 1
        }
    );
}

#[test]
fn test_worksheet_dimension_multiple_cells() {
    let mut model = new_empty_model();
    model._set("W11", "1");
    model._set("E11", "1");
    model._set("AA17", "1");
    model._set("G17", "1");
    model._set("B19", "1");
    let area = Area {
        sheet: 0,
        row: 11,
        column: 23,
        width: 1,
        height: 1,
    };
    model.range_clear_all(&area).unwrap();
    assert_eq!(
        model.workbook.worksheet(0).unwrap().dimension(),
        WorksheetDimension {
            min_row: 11,
            min_column: 2,
            max_row: 19,
            max_column: 27
        }
    );
}

#[test]
fn test_worksheet_dimension_progressive() {
    let mut model = new_empty_model();
    assert_eq!(
        model.workbook.worksheet(0).unwrap().dimension(),
        WorksheetDimension {
            min_row: 1,
            min_column: 1,
            max_row: 1,
            max_column: 1
        }
    );

    model
        .set_user_input(0, 30, 50, "Hello World".to_string())
        .unwrap();
    assert_eq!(
        model.workbook.worksheet(0).unwrap().dimension(),
        WorksheetDimension {
            min_row: 30,
            min_column: 50,
            max_row: 30,
            max_column: 50
        }
    );

    model
        .set_user_input(0, 10, 15, "Hello World".to_string())
        .unwrap();
    assert_eq!(
        model.workbook.worksheet(0).unwrap().dimension(),
        WorksheetDimension {
            min_row: 10,
            min_column: 15,
            max_row: 30,
            max_column: 50
        }
    );

    model
        .set_user_input(0, 5, 25, "Hello World".to_string())
        .unwrap();
    assert_eq!(
        model.workbook.worksheet(0).unwrap().dimension(),
        WorksheetDimension {
            min_row: 5,
            min_column: 15,
            max_row: 30,
            max_column: 50
        }
    );

    model
        .set_user_input(0, 10, 250, "Hello World".to_string())
        .unwrap();
    assert_eq!(
        model.workbook.worksheet(0).unwrap().dimension(),
        WorksheetDimension {
            min_row: 5,
            min_column: 15,
            max_row: 30,
            max_column: 250
        }
    );
}

#[test]
fn test_worksheet_navigate_to_edge_in_direction() {
    let inline_spreadsheet = [
        [0, 0, 0, 0, 0, 0, 0, 0], // row 1
        [0, 1, 0, 1, 1, 1, 0, 1], // row 2
        [0, 1, 0, 1, 1, 0, 0, 0], // row 3
        [0, 1, 0, 1, 1, 0, 0, 0], // row 4
        [0, 0, 0, 1, 0, 0, 0, 0], // row 5
        [0, 1, 1, 0, 1, 0, 0, 0], // row 6
        [0, 0, 0, 0, 0, 0, 0, 0], // row 7
    ];
    //   1, 2, 3, 4, 5, 6, 7, 8  - columns

    let mut model = new_empty_model();
    for (row_index, row) in inline_spreadsheet.into_iter().enumerate() {
        for (column_index, value) in row.into_iter().enumerate() {
            if value != 0 {
                model
                    .update_cell_with_number(
                        0,
                        (row_index as i32) + 1,
                        (column_index as i32) + 1,
                        value.into(),
                    )
                    .unwrap();
            }
        }
    }

    let worksheet = model.workbook.worksheet(0).unwrap();

    // Simple alias for readability of tests
    let navigate = |row, column, direction| {
        worksheet
            .navigate_to_edge_in_direction(row, column, direction)
            .unwrap()
    };

    assert_eq!(navigate(1, 1, NavigationDirection::Up), (1, 1));
    assert_eq!(navigate(1, 1, NavigationDirection::Left), (1, 1));
    assert_eq!(navigate(1, 1, NavigationDirection::Down), (LAST_ROW, 1));
    assert_eq!(navigate(1, 1, NavigationDirection::Right), (1, LAST_COLUMN));

    assert_eq!(navigate(LAST_ROW, 1, NavigationDirection::Up), (1, 1));
    assert_eq!(
        navigate(LAST_ROW, 1, NavigationDirection::Left),
        (LAST_ROW, 1)
    );
    assert_eq!(
        navigate(LAST_ROW, 1, NavigationDirection::Down),
        (LAST_ROW, 1)
    );
    assert_eq!(
        navigate(LAST_ROW, 1, NavigationDirection::Right),
        (LAST_ROW, LAST_COLUMN)
    );

    assert_eq!(
        navigate(1, LAST_COLUMN, NavigationDirection::Up),
        (1, LAST_COLUMN)
    );
    assert_eq!(navigate(1, LAST_COLUMN, NavigationDirection::Left), (1, 1));
    assert_eq!(
        navigate(1, LAST_COLUMN, NavigationDirection::Down),
        (LAST_ROW, LAST_COLUMN)
    );
    assert_eq!(
        navigate(1, LAST_COLUMN, NavigationDirection::Right),
        (1, LAST_COLUMN)
    );

    assert_eq!(
        navigate(LAST_ROW, LAST_COLUMN, NavigationDirection::Up),
        (1, LAST_COLUMN)
    );
    assert_eq!(
        navigate(LAST_ROW, LAST_COLUMN, NavigationDirection::Left),
        (LAST_ROW, 1)
    );
    assert_eq!(
        navigate(LAST_ROW, LAST_COLUMN, NavigationDirection::Down),
        (LAST_ROW, LAST_COLUMN)
    );
    assert_eq!(
        navigate(LAST_ROW, LAST_COLUMN, NavigationDirection::Right),
        (LAST_ROW, LAST_COLUMN)
    );

    // Direction = right
    assert_eq!(navigate(2, 1, NavigationDirection::Right), (2, 2));
    assert_eq!(navigate(2, 2, NavigationDirection::Right), (2, 4));
    assert_eq!(navigate(2, 4, NavigationDirection::Right), (2, 6));
    assert_eq!(navigate(2, 6, NavigationDirection::Right), (2, 8));
    assert_eq!(navigate(2, 8, NavigationDirection::Right), (2, LAST_COLUMN));

    assert_eq!(navigate(2, 3, NavigationDirection::Right), (2, 4));
    assert_eq!(navigate(5, 1, NavigationDirection::Right), (5, 4));
    assert_eq!(navigate(5, 2, NavigationDirection::Right), (5, 4));

    // Direction = left
    assert_eq!(navigate(2, LAST_COLUMN, NavigationDirection::Left), (2, 8));
    assert_eq!(navigate(2, 8, NavigationDirection::Left), (2, 6));
    assert_eq!(navigate(2, 6, NavigationDirection::Left), (2, 4));
    assert_eq!(navigate(2, 4, NavigationDirection::Left), (2, 2));
    assert_eq!(navigate(2, 2, NavigationDirection::Left), (2, 1));

    assert_eq!(navigate(2, 3, NavigationDirection::Left), (2, 2));
    assert_eq!(navigate(5, 8, NavigationDirection::Left), (5, 4));
    assert_eq!(navigate(5, 7, NavigationDirection::Left), (5, 4));

    // Direction = down
    assert_eq!(navigate(1, 5, NavigationDirection::Down), (2, 5));
    assert_eq!(navigate(2, 5, NavigationDirection::Down), (4, 5));
    assert_eq!(navigate(4, 5, NavigationDirection::Down), (6, 5));
    assert_eq!(navigate(6, 5, NavigationDirection::Down), (LAST_ROW, 5));

    assert_eq!(navigate(2, 3, NavigationDirection::Down), (6, 3));
    assert_eq!(navigate(3, 3, NavigationDirection::Down), (6, 3));
    assert_eq!(navigate(5, 3, NavigationDirection::Down), (6, 3));

    // Direction = up
    assert_eq!(navigate(LAST_ROW, 5, NavigationDirection::Up), (6, 5));
    assert_eq!(navigate(6, 5, NavigationDirection::Up), (4, 5));
    assert_eq!(navigate(4, 5, NavigationDirection::Up), (2, 5));
    assert_eq!(navigate(2, 5, NavigationDirection::Up), (1, 5));

    assert_eq!(navigate(7, 3, NavigationDirection::Up), (6, 3));
    assert_eq!(navigate(8, 3, NavigationDirection::Up), (6, 3));
    assert_eq!(navigate(9, 3, NavigationDirection::Up), (6, 3));
}
