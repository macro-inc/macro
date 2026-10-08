#![allow(clippy::unwrap_used)]

use crate::constants::{LAST_COLUMN, LAST_ROW};
use crate::test::util::new_empty_model;

#[test]
fn test_empty_model() {
    let mut model = new_empty_model();
    let worksheet = model.workbook.worksheet_mut(0).unwrap();
    assert_eq!(worksheet.frozen_rows, 0);
    assert_eq!(worksheet.frozen_columns, 0);

    let e = worksheet.set_frozen_rows(3);
    assert!(e.is_ok());
    assert_eq!(worksheet.frozen_rows, 3);
    assert_eq!(worksheet.frozen_columns, 0);

    let e = worksheet.set_frozen_columns(53);
    assert!(e.is_ok());
    assert_eq!(worksheet.frozen_rows, 3);
    assert_eq!(worksheet.frozen_columns, 53);

    // Set them back to zero
    let e = worksheet.set_frozen_rows(0);
    assert!(e.is_ok());
    let e = worksheet.set_frozen_columns(0);
    assert!(e.is_ok());
    assert_eq!(worksheet.frozen_rows, 0);
    assert_eq!(worksheet.frozen_columns, 0);
}

#[test]
fn test_invalid_rows_columns() {
    let mut model = new_empty_model();
    let worksheet = model.workbook.worksheet_mut(0).unwrap();

    assert_eq!(
        worksheet.set_frozen_rows(-3),
        Err("Frozen rows cannot be negative".to_string())
    );
    assert_eq!(
        worksheet.set_frozen_columns(-5),
        Err("Frozen columns cannot be negative".to_string())
    );

    assert_eq!(
        worksheet.set_frozen_rows(LAST_ROW),
        Err("Too many rows".to_string())
    );
    assert_eq!(
        worksheet.set_frozen_columns(LAST_COLUMN),
        Err("Too many columns".to_string())
    );
}
