#![allow(clippy::unwrap_used)]

use crate::constants::{DEFAULT_ROW_HEIGHT, LAST_COLUMN, LAST_ROW};
use crate::model::Model;
use crate::test::util::new_empty_model;
use crate::types::Col;

#[test]
fn test_insert_columns() {
    let mut model = new_empty_model();
    // We populate cells A1 to C1
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("C1", "=B1*2");

    model._set("F1", "=B1");

    model._set("L11", "300");
    model._set("M11", "=L11*5");

    model.evaluate();
    assert_eq!(model._get_text("C1"), *"4");

    // Let's insert 5 columns in column F (6)
    let r = model.insert_columns(0, 6, 5);
    assert!(r.is_ok());
    model.evaluate();

    // Check F1 is now empty
    assert!(model.is_empty_cell(0, 1, 6).unwrap());

    // The old F1 is K1
    assert_eq!(model._get_formula("K1"), *"=B1");

    // L11 and M11 are Q11 and R11
    assert_eq!(model._get_text("Q11"), *"300");
    assert_eq!(model._get_formula("R11"), *"=Q11*5");

    assert_eq!(model._get_formula("C1"), "=B1*2");
    assert_eq!(model._get_text("A1"), "1");

    // inserting a negative number of columns fails:
    let r = model.insert_columns(0, 6, -5);
    assert!(r.is_err());
    let r = model.insert_columns(0, 6, -5);
    assert!(r.is_err());

    // If you have data at the very ebd it fails
    model._set("XFC12", "300");
    let r = model.insert_columns(0, 6, 5);
    assert!(r.is_err());
}

#[test]
fn test_insert_rows() {
    let mut model = new_empty_model();

    model._set("C4", "3");
    model._set("C5", "7");
    model._set("C6", "=C5");

    model._set("H11", "=C4");

    model._set("R10", "=C6");

    model.evaluate();

    // Let's insert 5 rows in row 6
    let r = model.insert_rows(0, 6, 5);
    assert!(r.is_ok());
    model.evaluate();

    // Check C6 is now empty
    assert!(model.is_empty_cell(0, 6, 3).unwrap());

    // Old C6 is now C11
    assert_eq!(model._get_formula("C11"), *"=C5");
    assert_eq!(model._get_formula("H16"), *"=C4");

    assert_eq!(model._get_formula("R15"), *"=C11");
    assert_eq!(model._get_text("C4"), *"3");
    assert_eq!(model._get_text("C5"), *"7");
}

#[test]
fn test_insert_rows_styles() {
    let mut model = new_empty_model();

    assert!(
        (DEFAULT_ROW_HEIGHT - model.workbook.worksheet(0).unwrap().row_height(10).unwrap()).abs()
            < f64::EPSILON
    );
    // sets height 42 in row 10
    model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_row_height(10, 42.0)
        .unwrap();
    assert!(
        (42.0 - model.workbook.worksheet(0).unwrap().row_height(10).unwrap()).abs() < f64::EPSILON
    );

    // Let's insert 5 rows in row 3
    let r = model.insert_rows(0, 3, 5);
    assert!(r.is_ok());

    // Row 10 has the default height
    assert!(
        (DEFAULT_ROW_HEIGHT - model.workbook.worksheet(0).unwrap().row_height(10).unwrap()).abs()
            < f64::EPSILON
    );

    // Row 10 is now row 15
    assert!(
        (42.0 - model.workbook.worksheet(0).unwrap().row_height(15).unwrap()).abs() < f64::EPSILON
    );
}

#[test]
fn test_delete_rows_styles() {
    let mut model = new_empty_model();

    assert!(
        (DEFAULT_ROW_HEIGHT - model.workbook.worksheet(0).unwrap().row_height(10).unwrap()).abs()
            < f64::EPSILON
    );
    // sets height 42 in row 10
    model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_row_height(10, 42.0)
        .unwrap();
    assert!(
        (42.0 - model.workbook.worksheet(0).unwrap().row_height(10).unwrap()).abs() < f64::EPSILON
    );

    // Let's delete 5 rows in row 3 (3-8)
    let r = model.delete_rows(0, 3, 5);
    assert!(r.is_ok());

    // Row 10 has the default height
    assert!(
        (DEFAULT_ROW_HEIGHT - model.workbook.worksheet(0).unwrap().row_height(10).unwrap()).abs()
            < f64::EPSILON
    );

    // Row 10 is now row 5
    assert!(
        (42.0 - model.workbook.worksheet(0).unwrap().row_height(5).unwrap()).abs() < f64::EPSILON
    );
}

#[test]
fn test_delete_columns() {
    let mut model = new_empty_model();

    model._set("C4", "3");
    model._set("D4", "7");
    model._set("E4", "=D4");
    model._set("F4", "=C4");

    model._set("H11", "=D4");

    model._set("R10", "=C6");

    model._set("M5", "300");
    model._set("N5", "=M5*6");

    model._set("A1", "=SUM(M5:N5)");
    model._set("A2", "=SUM(C4:M4)");
    model._set("A3", "=SUM(E4:M4)");

    model.evaluate();

    // We delete columns D and E
    let r = model.delete_columns(0, 4, 2);
    assert!(r.is_ok());
    model.evaluate();

    // Old H11 will be F11 and contain =#REF!
    assert_eq!(model._get_formula("F11"), *"=#REF!");

    // Old F4 will be D4 now
    assert_eq!(model._get_formula("D4"), *"=C4");

    // Old N5 will be L5
    assert_eq!(model._get_formula("L5"), *"=K5*6");

    // Range in A1 is displaced correctly
    assert_eq!(model._get_formula("A1"), *"=SUM(K5:L5)");

    // Note that range in A2 would contain some of the deleted cells
    // A long as the borders of the range are not included that's ok.
    assert_eq!(model._get_formula("A2"), *"=SUM(C4:K4)");

    // FIXME: In Excel this would be (lower limit won't change)
    // assert_eq!(model._get_formula("A3"), *"=SUM(E4:K4)");
    assert_eq!(model._get_formula("A3"), *"=SUM(#REF!:K4)");
}

#[test]
fn test_delete_column_width() {
    let mut model = new_empty_model();
    let (sheet, column) = (0, 5);
    let normal_width = model.get_column_width(sheet, column).unwrap();
    // Set the width of one column to 5 times the normal width
    assert!(model
        .set_column_width(sheet, column, normal_width * 5.0)
        .is_ok());

    // delete it
    assert!(model.delete_columns(sheet, column, 1).is_ok());

    // all the columns around have the expected width
    assert_eq!(
        model.get_column_width(sheet, column - 1).unwrap(),
        normal_width
    );
    assert_eq!(model.get_column_width(sheet, column).unwrap(), normal_width);
    assert_eq!(
        model.get_column_width(sheet, column + 1).unwrap(),
        normal_width
    );
}

#[test]
// We set the style of columns 4 to 7 and delete column 4
// We check that columns 4 to 6 have the new style
fn test_delete_first_column_width() {
    let mut model = new_empty_model();
    model.workbook.worksheets[0].cols = vec![Col {
        min: 4,
        max: 7,
        width: 300.0,
        custom_width: true,
        style: None,
        hidden: false,
    }];
    let (sheet, column) = (0, 4);
    assert!(model.delete_columns(sheet, column, 1).is_ok());
    let cols = &model.workbook.worksheets[0].cols;
    assert_eq!(cols.len(), 1);
    assert_eq!(
        cols[0],
        Col {
            min: 4,
            max: 6,
            width: 300.0,
            custom_width: true,
            style: None,
            hidden: false,
        }
    );
}

#[test]
// Delete the last column in the range
fn test_delete_last_column_width() {
    let mut model = new_empty_model();
    model.workbook.worksheets[0].cols = vec![Col {
        min: 4,
        max: 7,
        width: 300.0,
        custom_width: true,
        style: None,
        hidden: false,
    }];
    let (sheet, column) = (0, 7);
    assert!(model.delete_columns(sheet, column, 1).is_ok());
    let cols = &model.workbook.worksheets[0].cols;
    assert_eq!(cols.len(), 1);
    assert_eq!(
        cols[0],
        Col {
            min: 4,
            max: 6,
            width: 300.0,
            custom_width: true,
            style: None,
            hidden: false,
        }
    );
}

#[test]
// Deletes columns at the end
fn test_delete_last_few_columns_width() {
    let mut model = new_empty_model();
    model.workbook.worksheets[0].cols = vec![Col {
        min: 4,
        max: 17,
        width: 300.0,
        custom_width: true,
        style: None,
        hidden: false,
    }];
    let (sheet, column) = (0, 13);
    assert!(model.delete_columns(sheet, column, 10).is_ok());
    let cols = &model.workbook.worksheets[0].cols;
    assert_eq!(cols.len(), 1);
    assert_eq!(
        cols[0],
        Col {
            min: 4,
            max: 12,
            width: 300.0,
            custom_width: true,
            style: None,
            hidden: false,
        }
    );
}

#[test]
fn test_delete_columns_non_overlapping_left() {
    let mut model = new_empty_model();
    model.workbook.worksheets[0].cols = vec![Col {
        min: 10,
        max: 17,
        width: 300.0,
        custom_width: true,
        style: None,
        hidden: false,
    }];
    let (sheet, column) = (0, 3);
    assert!(model.delete_columns(sheet, column, 4).is_ok());
    let cols = &model.workbook.worksheets[0].cols;
    assert_eq!(cols.len(), 1);
    assert_eq!(
        cols[0],
        Col {
            min: 6,
            max: 13,
            width: 300.0,
            custom_width: true,
            style: None,
            hidden: false,
        }
    );
}

#[test]
fn test_delete_columns_overlapping_left() {
    let mut model = new_empty_model();
    model.workbook.worksheets[0].cols = vec![Col {
        min: 10,
        max: 20,
        width: 300.0,
        custom_width: true,
        style: None,
        hidden: false,
    }];
    let (sheet, column) = (0, 8);
    assert!(model.delete_columns(sheet, column, 4).is_ok());
    let cols = &model.workbook.worksheets[0].cols;
    assert_eq!(cols.len(), 1);
    assert_eq!(
        cols[0],
        Col {
            min: 8,
            max: 16,
            width: 300.0,
            custom_width: true,
            style: None,
            hidden: false,
        }
    );
}

#[test]
fn test_delete_columns_non_overlapping_right() {
    let mut model = new_empty_model();
    model.workbook.worksheets[0].cols = vec![Col {
        min: 10,
        max: 17,
        width: 300.0,
        custom_width: true,
        style: None,
        hidden: false,
    }];
    let (sheet, column) = (0, 23);
    assert!(model.delete_columns(sheet, column, 4).is_ok());
    let cols = &model.workbook.worksheets[0].cols;
    assert_eq!(cols.len(), 1);
    assert_eq!(
        cols[0],
        Col {
            min: 10,
            max: 17,
            width: 300.0,
            custom_width: true,
            style: None,
            hidden: false,
        }
    );
}

#[test]
// deletes some columns in the middle of the range
fn test_delete_middle_column_width() {
    let mut model = new_empty_model();
    // styled columns [4, 17]
    model.workbook.worksheets[0].cols = vec![Col {
        min: 4,
        max: 17,
        width: 300.0,
        custom_width: true,
        style: None,
        hidden: false,
    }];

    // deletes columns 10, 11, 12
    let (sheet, column) = (0, 10);
    assert!(model.delete_columns(sheet, column, 3).is_ok());
    let cols = &model.workbook.worksheets[0].cols;
    assert_eq!(cols.len(), 1);
    assert_eq!(
        cols[0],
        Col {
            min: 4,
            max: 14,
            width: 300.0,
            custom_width: true,
            style: None,
            hidden: false,
        }
    );
}

#[test]
// the range is inside the deleted columns
fn delete_range_in_columns() {
    let mut model = new_empty_model();
    // styled columns [6, 10]
    model.workbook.worksheets[0].cols = vec![Col {
        min: 6,
        max: 10,
        width: 300.0,
        custom_width: true,
        style: None,
        hidden: false,
    }];

    // deletes columns [4, 17]
    let (sheet, column) = (0, 4);
    assert!(model.delete_columns(sheet, column, 8).is_ok());
    let cols = &model.workbook.worksheets[0].cols;
    assert_eq!(cols.len(), 0);
}

#[test]
fn test_delete_columns_error() {
    let mut model = new_empty_model();
    let (sheet, column) = (0, 5);
    assert!(model.delete_columns(sheet, column, -1).is_err());
    assert!(model.delete_columns(sheet, column, 0).is_err());
    assert!(model.delete_columns(sheet, column, 1).is_ok());
}

#[test]
fn test_delete_rows() {
    let mut model = new_empty_model();

    model._set("C4", "4");
    model._set("C5", "5");
    model._set("C6", "6");
    model._set("C7", "=C6*2");

    model._set("C72", "=C1*3");

    model.evaluate();

    // We delete rows 5, 6
    let r = model.delete_rows(0, 5, 2);
    assert!(r.is_ok());
    model.evaluate();

    assert_eq!(model._get_formula("C5"), *"=#REF!*2");
    assert_eq!(model._get_formula("C70"), *"=C1*3");
}

// E	F	G	H	I	J	K
// 			3	1	1	2
// 			4	2	5	8
// 			-2	3	6	7
fn populate_table(model: &mut Model) {
    model._set("G1", "3");
    model._set("H1", "1");
    model._set("I1", "1");
    model._set("J1", "2");

    model._set("G2", "4");
    model._set("H2", "2");
    model._set("I2", "5");
    model._set("J2", "8");

    model._set("G3", "-2");
    model._set("H3", "3");
    model._set("I3", "6");
    model._set("J3", "7");
}

#[test]
fn test_move_column_right() {
    let mut model = new_empty_model();
    populate_table(&mut model);
    model._set("E3", "=G3");
    model._set("E4", "=H3");
    model._set("E5", "=SUM(G3:J7)");
    model._set("E6", "=SUM(G3:G7)");
    model._set("E7", "=SUM(H3:H7)");
    model.evaluate();

    // Wee swap column G with column H
    let result = model.move_columns_action(0, 7, 1, 1);
    assert!(result.is_ok());
    model.evaluate();

    assert_eq!(model._get_formula("E3"), "=H3");
    assert_eq!(model._get_formula("E4"), "=G3");
    assert_eq!(model._get_formula("E5"), "=SUM(H3:J7)");
    assert_eq!(model._get_formula("E6"), "=SUM(H3:H7)");
    assert_eq!(model._get_formula("E7"), "=SUM(G3:G7)");

    // Data moved as well
    assert_eq!(model._get_text("G1"), "1");
    assert_eq!(model._get_text("H1"), "3");
}

#[test]
fn tets_move_column_error() {
    let mut model = new_empty_model();
    model.evaluate();

    let result = model.move_columns_action(0, 7, 1, -10);
    assert!(result.is_err());

    let result = model.move_columns_action(0, -7, 1, 20);
    assert!(result.is_err());

    let result = model.move_columns_action(0, LAST_COLUMN, 1, 1);
    assert!(result.is_err());

    let result = model.move_columns_action(0, LAST_COLUMN + 1, 1, -10);
    assert!(result.is_err());

    // This works
    let result = model.move_columns_action(0, LAST_COLUMN, 1, -1);
    assert!(result.is_ok());
}

#[test]
fn test_move_row_down() {
    let mut model = new_empty_model();
    populate_table(&mut model);
    // Formulas referencing rows 3 and 4
    model._set("E3", "=G3");
    model._set("E4", "=G4");
    model._set("E5", "=SUM(G3:J3)");
    model._set("E6", "=SUM(G3:G3)");
    model._set("E7", "=SUM(G4:G4)");
    model.evaluate();

    // Move row 3 down by one position
    let result = model.move_rows_action(0, 3, 1, 1);
    assert!(result.is_ok());
    model.evaluate();

    assert_eq!(model._get_formula("E3"), "=G3");
    assert_eq!(model._get_formula("E4"), "=G4");
    assert_eq!(model._get_formula("E5"), "=SUM(G4:J4)");
    assert_eq!(model._get_formula("E6"), "=SUM(G4:G4)");
    assert_eq!(model._get_formula("E7"), "=SUM(G3:G3)");

    // Data moved as well
    assert_eq!(model._get_text("G4"), "-2");
    assert_eq!(model._get_text("G3"), "");
}

#[test]
fn test_move_row_up() {
    let mut model = new_empty_model();
    populate_table(&mut model);
    // Formulas referencing rows 4 and 5
    model._set("E4", "=G4");
    model._set("E5", "=G5");
    model._set("E6", "=SUM(G4:J4)");
    model._set("E7", "=SUM(G4:G4)");
    model._set("E8", "=SUM(G5:G5)");
    model.evaluate();

    // Move row 5 up by one position
    let result = model.move_rows_action(0, 5, 1, -1);
    assert!(result.is_ok());
    model.evaluate();

    assert_eq!(model._get_formula("E4"), "=G4");
    assert_eq!(model._get_formula("E5"), "=G5");
    assert_eq!(model._get_formula("E6"), "=SUM(G5:J5)");
    assert_eq!(model._get_formula("E7"), "=SUM(G5:G5)");
    assert_eq!(model._get_formula("E8"), "=SUM(G4:G4)");

    // Data moved as well
    assert_eq!(model._get_text("G4"), "");
    assert_eq!(model._get_text("G5"), "");
}

#[test]
fn test_move_row_error() {
    let mut model = new_empty_model();
    model.evaluate();

    let result = model.move_rows_action(0, 7, 1, -10);
    assert!(result.is_err());

    let result = model.move_rows_action(0, -7, 1, 20);
    assert!(result.is_err());

    let result = model.move_rows_action(0, LAST_ROW, 1, 1);
    assert!(result.is_err());

    let result = model.move_rows_action(0, LAST_ROW + 1, 1, -10);
    assert!(result.is_err());

    // This works
    let result = model.move_rows_action(0, LAST_ROW, 1, -1);
    assert!(result.is_ok());
}

#[test]
fn test_move_row_down_absolute_refs() {
    let mut model = new_empty_model();
    populate_table(&mut model);
    // Absolute references
    model._set("E3", "=$G$3");
    model._set("E4", "=$G$4");
    model._set("E5", "=SUM($G$3:$J$3)");
    model._set("E6", "=SUM($G$3:$G$3)");
    model._set("E7", "=SUM($G$4:$G$4)");
    model.evaluate();

    assert!(model.move_rows_action(0, 3, 1, 1).is_ok());
    model.evaluate();

    assert_eq!(model._get_formula("E3"), "=$G$3");
    assert_eq!(model._get_formula("E4"), "=$G$4");
    assert_eq!(model._get_formula("E5"), "=SUM($G$4:$J$4)");
    assert_eq!(model._get_formula("E6"), "=SUM($G$4:$G$4)");
    assert_eq!(model._get_formula("E7"), "=SUM($G$3:$G$3)");
}

#[test]
fn test_move_column_right_absolute_refs() {
    let mut model = new_empty_model();
    populate_table(&mut model);
    // Absolute references
    model._set("E3", "=$G$3");
    model._set("E4", "=$H$3");
    model._set("E5", "=SUM($G$3:$J$7)");
    model._set("E6", "=SUM($G$3:$G$7)");
    model._set("E7", "=SUM($H$3:$H$7)");
    model.evaluate();

    assert!(model.move_columns_action(0, 7, 1, 1).is_ok());
    model.evaluate();

    assert_eq!(model._get_formula("E3"), "=$H$3");
    assert_eq!(model._get_formula("E4"), "=$G$3");
    assert_eq!(model._get_formula("E5"), "=SUM($H$3:$J$7)");
    assert_eq!(model._get_formula("E6"), "=SUM($H$3:$H$7)");
    assert_eq!(model._get_formula("E7"), "=SUM($G$3:$G$7)");
}

#[test]
fn test_move_row_down_mixed_refs() {
    let mut model = new_empty_model();
    populate_table(&mut model);
    model._set("E3", "=$G3"); // absolute col, relative row
    model._set("E4", "=$G4");
    model._set("E5", "=SUM($G3:$J3)");
    model._set("E6", "=SUM($G3:$G3)");
    model._set("E7", "=SUM($G4:$G4)");
    model._set("F3", "=H$3"); // relative col, absolute row
    model._set("F4", "=G$3");
    model.evaluate();

    assert!(model.move_rows_action(0, 3, 1, 1).is_ok());
    model.evaluate();

    assert_eq!(model._get_formula("E3"), "=$G3");
    assert_eq!(model._get_formula("E4"), "=$G4");
    assert_eq!(model._get_formula("E5"), "=SUM($G4:$J4)");
    assert_eq!(model._get_formula("E6"), "=SUM($G4:$G4)");
    assert_eq!(model._get_formula("E7"), "=SUM($G3:$G3)");
    assert_eq!(model._get_formula("F3"), "=G$4");
    assert_eq!(model._get_formula("F4"), "=H$4");
}

#[test]
fn test_move_column_right_mixed_refs() {
    let mut model = new_empty_model();
    populate_table(&mut model);
    model._set("E3", "=$G3");
    model._set("E4", "=$H3");
    model._set("E5", "=SUM($G3:$J7)");
    model._set("E6", "=SUM($G3:$G7)");
    model._set("E7", "=SUM($H3:$H7)");
    model._set("F3", "=H$3");
    model._set("F4", "=H$3");
    model.evaluate();

    assert!(model.move_columns_action(0, 7, 1, 1).is_ok());
    model.evaluate();

    assert_eq!(model._get_formula("E3"), "=$H3");
    assert_eq!(model._get_formula("E4"), "=$G3");
    assert_eq!(model._get_formula("E5"), "=SUM($H3:$J7)");
    assert_eq!(model._get_formula("E6"), "=SUM($H3:$H7)");
    assert_eq!(model._get_formula("E7"), "=SUM($G3:$G7)");
    assert_eq!(model._get_formula("F3"), "=G$3");
    assert_eq!(model._get_formula("F4"), "=G$3");
}

#[test]
fn test_move_row_height() {
    let mut model = new_empty_model();
    let sheet = 0;
    let custom_height = DEFAULT_ROW_HEIGHT * 2.0;
    // Set a custom height for row 3
    model
        .workbook
        .worksheet_mut(sheet)
        .unwrap()
        .set_row_height(3, custom_height)
        .unwrap();

    // Record the original height of row 4 (should be the default)
    let original_row4_height = model.get_row_height(sheet, 4).unwrap();

    // Move row 3 down by one position
    assert!(model.move_rows_action(sheet, 3, 1, 1).is_ok());

    // The custom height should now be on row 4
    assert_eq!(model.get_row_height(sheet, 4), Ok(custom_height));

    // Row 3 should now have the previous height of row 4
    assert_eq!(model.get_row_height(sheet, 3), Ok(original_row4_height));
}

/// Moving a row down by two positions should shift formulas on intermediate
/// rows by only one (the row that gets skipped), not by the full delta ‒ this
/// guards against the regression fixed in the RowMove displacement logic.
#[test]
fn test_row_move_down_two_updates_intermediate_refs_by_one() {
    let mut model = new_empty_model();
    populate_table(&mut model);
    // Set up formulas to verify intermediate rows shift by 1 (not full delta).
    model._set("E3", "=G3"); // target row
    model._set("E4", "=G4"); // intermediate row
    model._set("E5", "=SUM(G3:J3)");
    model.evaluate();

    // Move row 3 down by two positions (row 3 -> row 5)
    assert!(model.move_rows_action(0, 3, 1, 2).is_ok());
    model.evaluate();

    // Assert that references for the moved row and intermediate row are correct.
    assert_eq!(model._get_formula("E3"), "=G3");
    assert_eq!(model._get_formula("E5"), "=G5");
    assert_eq!(model._get_formula("E4"), "=SUM(G5:J5)");
}

/// Moving a column right by two positions should shift formulas on
/// intermediate columns by only one, ensuring the ColumnMove displacement
/// logic handles multi-position moves correctly.
#[test]
fn test_column_move_right_two_updates_intermediate_refs_by_one() {
    let mut model = new_empty_model();
    populate_table(&mut model);
    // Set up formulas to verify intermediate columns shift by 1 (not full delta).
    model._set("E3", "=$G3"); // target column
    model._set("E4", "=$H3"); // intermediate column
    model._set("E5", "=SUM($G3:$J7)");
    model.evaluate();

    // Move column G (7) right by two positions (G -> I)
    assert!(model.move_columns_action(0, 7, 1, 2).is_ok());
    model.evaluate();

    // Assert that references for moved and intermediate columns are correct.
    assert_eq!(model._get_formula("E3"), "=$I3");
    assert_eq!(model._get_formula("E4"), "=$G3");
    assert_eq!(model._get_formula("E5"), "=SUM($I3:$J7)");
}

// A  B  C  D  E  F  G   H  I  J   K   L   M   N   O   P   Q   R
// 1  2  3  4  5  6  7   8  9  10  11  12  13  14  15  16  17  18
