#![allow(clippy::unwrap_used)]

use crate::constants::{COLUMN_WIDTH_FACTOR, DEFAULT_COLUMN_WIDTH};
use crate::test::util::new_empty_model;
use crate::types::Col;

#[test]
fn test_column_width() {
    let mut model = new_empty_model();
    let cols = vec![Col {
        custom_width: false,
        max: 16384,
        min: 1,
        style: Some(6),
        width: 8.7,
        hidden: false,
    }];
    model.workbook.worksheets[0].cols = cols;
    model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_column_width(2, 30.0)
        .unwrap();
    assert_eq!(model.workbook.worksheets[0].cols.len(), 3);
    let worksheet = model.workbook.worksheet(0).unwrap();
    assert!((worksheet.get_column_width(1).unwrap() - DEFAULT_COLUMN_WIDTH).abs() < f64::EPSILON);
    assert!((worksheet.get_column_width(2).unwrap() - 30.0).abs() < f64::EPSILON);
    assert!((worksheet.get_column_width(3).unwrap() - DEFAULT_COLUMN_WIDTH).abs() < f64::EPSILON);
    assert_eq!(model.get_cell_style_index(0, 23, 2), Ok(6));
}

#[test]
fn test_column_width_lower_edge() {
    let mut model = new_empty_model();
    let cols = vec![Col {
        custom_width: true,
        max: 16,
        min: 5,
        style: Some(1),
        width: 10.0,
        hidden: false,
    }];
    model.workbook.worksheets[0].cols = cols;
    model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_column_width(5, 30.0)
        .unwrap();
    assert_eq!(model.workbook.worksheets[0].cols.len(), 2);
    let worksheet = model.workbook.worksheet(0).unwrap();
    assert!((worksheet.get_column_width(4).unwrap() - DEFAULT_COLUMN_WIDTH).abs() < f64::EPSILON);
    assert!((worksheet.get_column_width(5).unwrap() - 30.0).abs() < f64::EPSILON);
    assert!(
        (worksheet.get_column_width(6).unwrap() - 10.0 * COLUMN_WIDTH_FACTOR).abs() < f64::EPSILON
    );
    assert_eq!(model.get_cell_style_index(0, 23, 5), Ok(1));
}

#[test]
fn test_column_width_higher_edge() {
    let mut model = new_empty_model();
    let cols = vec![Col {
        custom_width: true,
        max: 16,
        min: 5,
        style: Some(1),
        width: 10.0,
        hidden: false,
    }];
    model.workbook.worksheets[0].cols = cols;
    model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_column_width(16, 30.0)
        .unwrap();
    assert_eq!(model.workbook.worksheets[0].cols.len(), 2);
    let worksheet = model.workbook.worksheet(0).unwrap();
    assert!(
        (worksheet.get_column_width(15).unwrap() - 10.0 * COLUMN_WIDTH_FACTOR).abs() < f64::EPSILON
    );
    assert!((worksheet.get_column_width(16).unwrap() - 30.0).abs() < f64::EPSILON);
    assert!((worksheet.get_column_width(17).unwrap() - DEFAULT_COLUMN_WIDTH).abs() < f64::EPSILON);
    assert_eq!(model.get_cell_style_index(0, 23, 16), Ok(1));
}

#[test]
fn test_column_width_negative() {
    let mut model = new_empty_model();
    let result = model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_column_width(16, -1.0);
    assert_eq!(result, Err("Can not set a negative width: -1".to_string()));
    assert_eq!(model.workbook.worksheets[0].cols.len(), 0);
    let worksheet = model.workbook.worksheet(0).unwrap();
    assert_eq!(
        (worksheet.get_column_width(16).unwrap()),
        DEFAULT_COLUMN_WIDTH
    );
    assert_eq!(model.get_cell_style_index(0, 23, 16), Ok(0));
}
