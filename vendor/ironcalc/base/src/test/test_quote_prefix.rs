#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_quote_prefix_formula() {
    let mut model = new_empty_model();
    model._set("A1", "'= 1 + 3");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"= 1 + 3");
    assert!(!model._has_formula("A1"));
}

#[test]
fn test_quote_prefix_number() {
    let mut model = new_empty_model();
    model._set("A1", "'13");
    model._set("A2", "=ISNUMBER(A1)");
    model._set("A3", "=A1+1");
    model._set("A4", "=ISNUMBER(A3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"13");
    assert!(!model._has_formula("A1"));

    assert_eq!(model._get_text("A2"), *"FALSE");
    assert_eq!(model._get_text("A3"), *"14");

    assert_eq!(model._get_text("A4"), *"TRUE");
}

#[test]
fn test_quote_prefix_error() {
    let mut model = new_empty_model();
    model._set("A1", "'#N/A");
    model._set("A2", "=ISERROR(A1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#N/A");

    assert_eq!(model._get_text("A2"), *"FALSE");
}

#[test]
fn test_quote_prefix_boolean() {
    let mut model = new_empty_model();
    model._set("A1", "'FALSE");
    model._set("A2", "=ISTEXT(A1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"FALSE");

    assert_eq!(model._get_text("A2"), *"TRUE");
}

#[test]
fn test_quote_prefix_enter() {
    let mut model = new_empty_model();
    model._set("A1", "'123");
    model._set("A2", "=ISTEXT(A1)");
    model.evaluate();
    // We introduce a value with a "quote prefix" index
    model.set_user_input(0, 1, 3, "'=A1".to_string()).unwrap();
    model.evaluate();
    assert_eq!(model._get_text("C1"), *"=A1");

    // But if we enter with a quote_prefix but without the "'" it won't be quote_prefix
    model.set_user_input(0, 1, 4, "=A1".to_string()).unwrap();
    model.evaluate();
    assert_eq!(model._get_text("D1"), *"123");
}

#[test]
fn test_quote_prefix_reenter() {
    let mut model = new_empty_model();
    model._set("A1", "'123");
    model._set("A2", "=ISTEXT(A1)");
    model.evaluate();
    assert_eq!(model._get_text("A2"), *"TRUE");
    // We introduce a value with a "quote prefix" index
    model.set_user_input(0, 1, 1, "123".to_string()).unwrap();
    model.evaluate();
    assert_eq!(model._get_text("A2"), *"FALSE");
}

#[test]
fn test_update_cell_quote() {
    let mut model = new_empty_model();
    model.update_cell_with_text(0, 1, 1, "= 1 + 3").unwrap();
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"= 1 + 3");
    assert!(!model._has_formula("A1"));
}

#[test]
fn test_update_quote_prefix_reenter() {
    let mut model = new_empty_model();
    model.update_cell_with_text(0, 1, 1, "123").unwrap();
    model._set("A2", "=ISTEXT(A1)");
    model.evaluate();
    assert_eq!(model._get_text("A2"), *"TRUE");
    // We reenter as a number
    model.update_cell_with_number(0, 1, 1, 123.0).unwrap();
    model.evaluate();
    assert_eq!(model._get_text("A2"), *"FALSE");
}

#[test]
fn test_update_quote_prefix_reenter_bool() {
    let mut model = new_empty_model();
    model.update_cell_with_text(0, 1, 1, "TRUE").unwrap();
    model._set("A2", "=ISTEXT(A1)");
    model.evaluate();
    assert_eq!(model._get_text("A2"), *"TRUE");
    // We enter a bool
    model.update_cell_with_bool(0, 1, 1, true).unwrap();
    model.evaluate();
    assert_eq!(model._get_text("A2"), *"FALSE");
}

#[test]
fn test_update_quote_prefix_reenter_text() {
    let mut model = new_empty_model();
    model.update_cell_with_text(0, 1, 1, "123").unwrap();
    model._set("A2", "=ISTEXT(A1)");
    model.evaluate();
    assert_eq!(model._get_text("A2"), *"TRUE");
    assert!(model.get_style_for_cell(0, 1, 1).unwrap().quote_prefix);
    // We enter a string
    model.update_cell_with_text(0, 1, 1, "Hello").unwrap();
    model.evaluate();
    assert_eq!(model._get_text("A2"), *"TRUE");
    assert!(!model.get_style_for_cell(0, 1, 1).unwrap().quote_prefix);
}

#[test]
fn test_update_quote_prefix_reenter_text_2() {
    let mut model = new_empty_model();
    model.update_cell_with_text(0, 1, 1, "123").unwrap();
    model._set("A2", "=ISTEXT(A1)");
    model.evaluate();
    assert_eq!(model._get_text("A2"), *"TRUE");
    assert!(model.get_style_for_cell(0, 1, 1).unwrap().quote_prefix);
    // We enter another number
    model.update_cell_with_text(0, 1, 1, "42").unwrap();
    model.evaluate();
    assert_eq!(model._get_text("A2"), *"TRUE");
    assert!(model.get_style_for_cell(0, 1, 1).unwrap().quote_prefix);
}

#[test]
fn normal_string_with_quote_prefix() {
    let mut model = new_empty_model();
    model.set_user_input(0, 1, 1, "'Hello".to_string()).unwrap();
    model.evaluate();
    assert!(model.get_style_for_cell(0, 1, 1).unwrap().quote_prefix);
    assert_eq!(model._get_text("A1"), *"Hello");
    assert_eq!(
        model.get_localized_cell_content(0, 1, 1).unwrap(),
        *"'Hello"
    );
}

#[test]
fn dates_with_quote_prefix() {
    let mut model = new_empty_model();
    model
        .set_user_input(0, 1, 1, "'2024-01-01".to_string())
        .unwrap();
    model.evaluate();
    assert!(model.get_style_for_cell(0, 1, 1).unwrap().quote_prefix);
    assert_eq!(model._get_text("A1"), *"2024-01-01");
    assert_eq!(
        model.get_localized_cell_content(0, 1, 1).unwrap(),
        *"'2024-01-01"
    );
}
