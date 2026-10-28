#![allow(clippy::unwrap_used)]
use crate::types::Color;

use crate::constants::DEFAULT_ROW_HEIGHT;

use crate::cell::CellValue;

use crate::number_format::to_excel_precision_str;

use crate::test::util::new_empty_model;

#[test]
fn test_empty_model() {
    let model = new_empty_model();
    let names = model.workbook.get_worksheet_names();
    assert_eq!(names.len(), 1);
    assert_eq!(names[0], "Sheet1");
}

#[test]
fn test_model_simple_evaluation() {
    let mut model = new_empty_model();
    model
        .set_user_input(0, 1, 1, "= 1 + 3".to_string())
        .unwrap();
    model.evaluate();
    let result = model._get_text_at(0, 1, 1);
    assert_eq!(result, *"4");
    let result = model._get_formula("A1");
    assert_eq!(result, *"=1+3");
}

#[test]
fn test_model_simple_evaluation_order() {
    let mut model = new_empty_model();
    model._set("A1", "=1/2/3");
    model._set("A2", "=(1/2)/3");
    model._set("A3", "=1/(2/3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"0.166666667");
    assert_eq!(model._get_text("A2"), *"0.166666667");
    assert_eq!(model._get_text("A3"), *"1.5");
    // Unnecessary parenthesis are lost
    assert_eq!(model._get_formula("A2"), *"=1/2/3");
    assert_eq!(model._get_formula("A3"), *"=1/(2/3)");
}

#[test]
fn test_model_invalid_formula() {
    let mut model = new_empty_model();
    model.set_user_input(0, 1, 1, "= 1 +".to_string()).unwrap();
    model.evaluate();
    let result = model._get_text_at(0, 1, 1);
    assert_eq!(result, *"#ERROR!");
    let result = model._get_formula("A1");
    assert_eq!(result, *"= 1 +");
}

#[test]
fn test_model_dependencies() {
    let mut model = new_empty_model();
    model.set_user_input(0, 1, 1, "23".to_string()).unwrap(); // A1
    model
        .set_user_input(0, 1, 2, "= A1* 2-4".to_string())
        .unwrap(); // B1
    model.evaluate();
    let result = model._get_text_at(0, 1, 1);
    assert_eq!(result, *"23");
    assert!(!model._has_formula("A1"));
    let result = model._get_text_at(0, 1, 2);
    assert_eq!(result, *"42");
    let result = model._get_formula("B1");
    assert_eq!(result, *"=A1*2-4");

    model
        .set_user_input(0, 2, 1, "=SUM(A1, B1)".to_string())
        .unwrap(); // A2
    model.evaluate();
    let result = model._get_text_at(0, 2, 1);
    assert_eq!(result, *"65");
}

#[test]
fn test_model_strings() {
    let mut model = new_empty_model();
    model
        .set_user_input(0, 1, 1, "Hello World".to_string())
        .unwrap();
    model.set_user_input(0, 1, 2, "=A1".to_string()).unwrap();
    model.evaluate();
    let result = model._get_text_at(0, 1, 1);
    assert_eq!(result, *"Hello World");
    let result = model._get_text_at(0, 1, 2);
    assert_eq!(result, *"Hello World");
}

#[test]
fn test_get_sheet_index_by_sheet_id() {
    let mut model = new_empty_model();
    model.new_sheet();

    assert_eq!(model.get_sheet_index_by_sheet_id(1), Some(0));
    assert_eq!(model.get_sheet_index_by_sheet_id(2), Some(1));
    assert_eq!(model.get_sheet_index_by_sheet_id(1337), None);
}

#[test]
fn test_set_row_height() {
    let mut model = new_empty_model();
    let worksheet = model.workbook.worksheet_mut(0).unwrap();
    worksheet.set_row_height(5, 25.0).unwrap();
    let worksheet = model.workbook.worksheet(0).unwrap();
    assert!((25.0 - worksheet.row_height(5).unwrap()).abs() < f64::EPSILON);

    let worksheet = model.workbook.worksheet_mut(0).unwrap();
    worksheet.set_row_height(5, 5.0).unwrap();
    let worksheet = model.workbook.worksheet(0).unwrap();
    assert!((5.0 - worksheet.row_height(5).unwrap()).abs() < f64::EPSILON);

    let worksheet = model.workbook.worksheet_mut(0).unwrap();
    let result = worksheet.set_row_height(6, -1.0);
    assert_eq!(result, Err("Can not set a negative height: -1".to_string()));

    assert_eq!(worksheet.row_height(6).unwrap(), DEFAULT_ROW_HEIGHT);

    worksheet.set_row_height(6, 0.0).unwrap();
    assert_eq!(worksheet.row_height(6).unwrap(), 0.0);
}

#[test]
fn test_to_excel_precision_str() {
    struct TestCase<'a> {
        value: f64,
        str: &'a str,
    }
    let test_cases = vec![
        TestCase {
            value: 2e-23,
            str: "2e-23",
        },
        TestCase {
            value: 42.0,
            str: "42",
        },
        TestCase {
            value: 200.0e-23,
            str: "2e-21",
        },
        TestCase {
            value: -200e-23,
            str: "-2e-21",
        },
        TestCase {
            value: 10.002,
            str: "10.002",
        },
        TestCase {
            value: f64::INFINITY,
            str: "inf",
        },
        TestCase {
            value: f64::NAN,
            str: "NaN",
        },
    ];
    for test_case in test_cases {
        let str = to_excel_precision_str(test_case.value);
        assert_eq!(str, test_case.str);
    }
}

#[test]
fn test_booleans() {
    let mut model = new_empty_model();
    model.set_user_input(0, 1, 1, "true".to_string()).unwrap();
    model.set_user_input(0, 2, 1, "TRUE".to_string()).unwrap();
    model.set_user_input(0, 3, 1, "True".to_string()).unwrap();
    model.set_user_input(0, 4, 1, "false".to_string()).unwrap();
    model.set_user_input(0, 5, 1, "FALSE".to_string()).unwrap();
    model.set_user_input(0, 6, 1, "False".to_string()).unwrap();

    model
        .set_user_input(0, 1, 2, "=ISLOGICAL(A1)".to_string())
        .unwrap();
    model
        .set_user_input(0, 2, 2, "=ISLOGICAL(A2)".to_string())
        .unwrap();
    model
        .set_user_input(0, 3, 2, "=ISLOGICAL(A3)".to_string())
        .unwrap();
    model
        .set_user_input(0, 4, 2, "=ISLOGICAL(A4)".to_string())
        .unwrap();
    model
        .set_user_input(0, 5, 2, "=ISLOGICAL(A5)".to_string())
        .unwrap();
    model
        .set_user_input(0, 6, 2, "=ISLOGICAL(A6)".to_string())
        .unwrap();

    model
        .set_user_input(0, 1, 5, "=IF(false, True, FALSe)".to_string())
        .unwrap();

    model.evaluate();

    assert_eq!(model._get_text_at(0, 1, 1), *"TRUE");
    assert_eq!(model._get_text_at(0, 2, 1), *"TRUE");
    assert_eq!(model._get_text_at(0, 3, 1), *"TRUE");

    assert_eq!(model._get_text_at(0, 4, 1), *"FALSE");
    assert_eq!(model._get_text_at(0, 5, 1), *"FALSE");
    assert_eq!(model._get_text_at(0, 6, 1), *"FALSE");

    assert_eq!(model._get_text_at(0, 1, 2), *"TRUE");
    assert_eq!(model._get_text_at(0, 2, 2), *"TRUE");
    assert_eq!(model._get_text_at(0, 3, 2), *"TRUE");
    assert_eq!(model._get_text_at(0, 4, 2), *"TRUE");
    assert_eq!(model._get_text_at(0, 5, 2), *"TRUE");
    assert_eq!(model._get_text_at(0, 6, 2), *"TRUE");

    assert_eq!(model._get_formula("E1"), *"=IF(FALSE,TRUE,FALSE)");
}

#[test]
fn test_set_cell_style() {
    let mut model = new_empty_model();
    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    assert!(!style.font.b);

    style.font.b = true;
    assert!(model.set_cell_style(0, 1, 1, &style).is_ok());

    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    assert!(style.font.b);

    style.font.b = false;
    assert!(model.set_cell_style(0, 1, 1, &style).is_ok());

    let style = model.get_style_for_cell(0, 1, 1).unwrap();
    assert!(!style.font.b);
}

#[test]
fn test_copy_cell_style() {
    let mut model = new_empty_model();

    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    style.font.b = true;
    assert!(model.set_cell_style(0, 1, 1, &style).is_ok());

    let mut style = model.get_style_for_cell(0, 1, 2).unwrap();
    style.font.i = true;
    assert!(model.set_cell_style(0, 1, 2, &style).is_ok());

    assert!(model.copy_cell_style((0, 1, 1), (0, 1, 2)).is_ok());

    let style = model.get_style_for_cell(0, 1, 1).unwrap();
    assert!(style.font.b);
    assert!(!style.font.i);

    let style = model.get_style_for_cell(0, 1, 2).unwrap();
    assert!(style.font.b);
    assert!(!style.font.i);
}

#[test]
fn test_get_cell_style_index() {
    let mut model = new_empty_model();

    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    let style_index = model.get_cell_style_index(0, 1, 1).unwrap();
    assert_eq!(style_index, 0);
    assert!(!style.font.b);

    style.font.b = true;
    assert!(model.set_cell_style(0, 1, 1, &style).is_ok());

    let style_index = model.get_cell_style_index(0, 1, 1).unwrap();
    assert_eq!(style_index, 1);
}

#[test]
fn test_model_set_cells_with_values_styles() {
    let mut model = new_empty_model();
    // Inputs
    model.set_user_input(0, 1, 1, "21".to_string()).unwrap(); // A1
    model.set_user_input(0, 2, 1, "2".to_string()).unwrap(); // A2

    let style_index = model.get_cell_style_index(0, 1, 1).unwrap();
    assert_eq!(style_index, 0);
    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    style.font.b = true;
    assert!(model.set_cell_style(0, 1, 1, &style).is_ok());
    assert!(model.set_cell_style(0, 2, 1, &style).is_ok());
    let style_index = model.get_cell_style_index(0, 1, 1).unwrap();
    assert_eq!(style_index, 1);
    let style_index = model.get_cell_style_index(0, 2, 1).unwrap();
    assert_eq!(style_index, 1);

    model.update_cell_with_number(0, 1, 2, 1.0).unwrap();
    model.update_cell_with_number(0, 2, 1, 2.0).unwrap();

    model.evaluate();

    // Styles are not modified
    let style_index = model.get_cell_style_index(0, 1, 1).unwrap();
    assert_eq!(style_index, 1);
    let style_index = model.get_cell_style_index(0, 2, 1).unwrap();
    assert_eq!(style_index, 1);
}

#[test]
fn test_style_fmt_id() {
    let mut model = new_empty_model();

    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    style.num_fmt = "#.##".to_string();
    assert!(model.set_cell_style(0, 1, 1, &style).is_ok());
    let style = model.get_style_for_cell(0, 1, 1).unwrap();
    assert_eq!(style.num_fmt, "#.##");

    let mut style = model.get_style_for_cell(0, 10, 1).unwrap();
    style.num_fmt = "$$#,##0.0000".to_string();
    assert!(model.set_cell_style(0, 10, 1, &style).is_ok());
    let style = model.get_style_for_cell(0, 10, 1).unwrap();
    assert_eq!(style.num_fmt, "$$#,##0.0000");

    // Make sure old style is not touched
    let style = model.get_style_for_cell(0, 1, 1).unwrap();
    assert_eq!(style.num_fmt, "#.##");
}

#[test]
fn test_set_sheet_color() {
    let mut model = new_empty_model();
    assert_eq!(model.workbook.worksheet(0).unwrap().color, Color::None);
    assert!(model
        .set_sheet_color(0, &Color::from_rgb("#FFFAAA").unwrap())
        .is_ok());

    // Test new tab color is properly set
    assert_eq!(
        model.workbook.worksheet(0).unwrap().color,
        Color::Rgb("#FFFAAA".to_string())
    );

    // Test we can remove it
    assert!(model.set_sheet_color(0, &Color::None).is_ok());
    assert_eq!(model.workbook.worksheet(0).unwrap().color, Color::None);
}

#[test]
fn test_set_sheet_color_invalid_sheet() {
    let mut model = new_empty_model();
    assert_eq!(
        model.set_sheet_color(10, &Color::Rgb("#FFFAAA".to_string())),
        Err("Invalid sheet index".to_string())
    );
}

#[test]
fn test_set_sheet_color_invalid() {
    let mut model = new_empty_model();
    // Boundaries
    assert!(model
        .set_sheet_color(0, &Color::Rgb("#FFFFFF".to_string()))
        .is_ok());
    assert!(model
        .set_sheet_color(0, &Color::Rgb("#000000".to_string()))
        .is_ok());
}

#[test]
fn set_input_autocomplete() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model
        .set_user_input(0, 3, 1, "=SUM(A1:A2".to_string())
        .unwrap();
    // This will fail anyway
    model
        .set_user_input(0, 4, 1, "=SUM(A1*".to_string())
        .unwrap();
    model.evaluate();

    assert_eq!(model._get_formula("A3"), "=SUM(A1:A2)");
    assert_eq!(model._get_text("A3"), "3");

    assert_eq!(model._get_formula("A4"), "=SUM(A1*");
    assert_eq!(model._get_text("A4"), "#ERROR!");
}

#[test]
fn test_get_cell_value_by_ref() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model.evaluate();

    // Correct
    assert_eq!(
        model.get_cell_value_by_ref("Sheet1!A1"),
        Ok(CellValue::Number(1.0))
    );

    // You need to specify full reference
    assert_eq!(
        model.get_cell_value_by_ref("A1"),
        Err("Error parsing reference: 'A1'".to_string())
    );

    // Error, it has a trailing space
    assert_eq!(
        model.get_cell_value_by_ref("Sheet1!A1 "),
        Err("Error parsing reference: 'Sheet1!A1 '".to_string())
    );
}

#[test]
fn test_get_formatted_cell_value() {
    let mut model = new_empty_model();
    model._set("A1", "foobar");
    model._set("A2", "true");
    model._set("A3", "");
    model._set("A4", "123.456");
    model._set("A5", "123.456");

    // change A5 format
    let mut style = model.get_style_for_cell(0, 5, 1).unwrap();
    style.num_fmt = "$#,##0.00".to_string();
    model.set_cell_style(0, 5, 1, &style).unwrap();

    model.evaluate();

    assert_eq!(model.get_formatted_cell_value(0, 1, 1).unwrap(), "foobar");
    assert_eq!(model.get_formatted_cell_value(0, 2, 1).unwrap(), "TRUE");
    assert_eq!(model.get_formatted_cell_value(0, 3, 1).unwrap(), "");
    assert_eq!(model.get_formatted_cell_value(0, 4, 1).unwrap(), "123.456");
    assert_eq!(model.get_formatted_cell_value(0, 5, 1).unwrap(), "$123.46");
}

#[test]
fn test_cell_formula() {
    let mut model = new_empty_model();
    model._set("A1", "=1+2+3");
    model._set("A2", "foobar");
    model.evaluate();

    assert_eq!(
        model.get_cell_formula(0, 1, 1), // A1
        Ok(Some("=1+2+3".to_string())),
    );
    assert_eq!(
        model.get_cell_formula(0, 2, 1), // A2
        Ok(None),
    );
    assert_eq!(
        model.get_cell_formula(0, 3, 1), // A3 - empty cell
        Ok(None),
    );

    assert_eq!(
        model.get_cell_formula(42, 1, 1),
        Err("Invalid sheet index".to_string()),
    );
}

// skip xlfn tests for now
#[test]
#[ignore]
fn test_xlfn() {
    let mut model = new_empty_model();
    model._set("A1", "=_xlfn.SIN(1)");
    model._set("A2", "=_xlfn.SINY(1)");
    model._set("A3", "=_xlfn.CONCAT(3, 4.0)");
    model.evaluate();
    // Only modern formulas strip the '_xlfn.'
    assert_eq!(
        model.get_cell_formula(0, 1, 1).unwrap(),
        Some("=_xlfn.SIN(1)".to_string())
    );
    // unknown formulas keep the '_xlfn.' prefix
    assert_eq!(
        model.get_cell_formula(0, 2, 1).unwrap(),
        Some("=_xlfn.SINY(1)".to_string())
    );
    assert_eq!(
        model.get_cell_formula(0, 3, 1).unwrap(),
        Some("=CONCAT(3,4)".to_string())
    );
}

// Empty cell compared to Boolean should treat the empty cell as FALSE (0).
// Before the fix, both (EmptyCell, Boolean(_)) and (Boolean(_), EmptyCell)
// fell through to the catch-all `(_, _) => 1`, which returned "greater-than"
// in both directions — violating antisymmetry and producing wrong comparisons.
#[test]
fn test_compare_empty_cell_and_boolean() {
    let mut model = new_empty_model();
    // A1 is intentionally left empty.

    // empty == FALSE  → TRUE  (empty coerces to FALSE)
    model._set("B1", "=A1=FALSE");
    // empty == TRUE   → FALSE
    model._set("B2", "=A1=TRUE");
    // empty < TRUE    → TRUE  (FALSE < TRUE)
    model._set("B3", "=A1<TRUE");
    // empty > FALSE   → FALSE (FALSE is not greater than FALSE)
    model._set("B4", "=A1>FALSE");
    // FALSE > empty   → FALSE (symmetric: empty == FALSE)
    model._set("B5", "=FALSE>A1");
    // TRUE > empty    → TRUE  (TRUE > FALSE)
    model._set("B6", "=TRUE>A1");

    model.evaluate();

    assert_eq!(model._get_text("B1"), "TRUE");
    assert_eq!(model._get_text("B2"), "FALSE");
    assert_eq!(model._get_text("B3"), "TRUE");
    assert_eq!(model._get_text("B4"), "FALSE");
    assert_eq!(model._get_text("B5"), "FALSE");
    assert_eq!(model._get_text("B6"), "TRUE");
}

#[test]
fn test_letter_case() {
    let mut model = new_empty_model();
    model._set("A1", "=sin(1)");
    model._set("A2", "=sIn(2)");
    model.evaluate();
    assert_eq!(
        model.get_cell_formula(0, 1, 1).unwrap(),
        Some("=SIN(1)".to_string())
    );
    assert_eq!(
        model.get_cell_formula(0, 2, 1).unwrap(),
        Some("=SIN(2)".to_string())
    );
}
