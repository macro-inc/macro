#![allow(clippy::unwrap_used, clippy::panic)]

//! Formula strings stored outside of cells (conditional-formatting rules and
//! defined names) are always stored internally in English. They are translated
//! into the active language/locale for display and parsed from the active
//! language/locale on input. This keeps them working when the user switches
//! language: the stored (English) formula is unaffected, the display follows
//! the language, and evaluation always parses the English form.

use crate::{
    cf_types::{CfRule, CfRuleInput},
    test::util::new_empty_model,
    types::{Color, Dxf, Fill},
    Model,
};

fn red_fill() -> Dxf {
    Dxf {
        fill: Some(Fill {
            color: Color::Rgb("#FF0000".to_string()),
        }),
        font: None,
        border: None,
        num_fmt: None,
        alignment: None,
    }
}

fn is_red(model: &Model<'static>, row: i32, col: i32) -> bool {
    model
        .get_extended_style_for_cell(0, row, col)
        .unwrap()
        .style
        .fill
        .color
        == Color::Rgb("#FF0000".to_string())
}

/// The formula stored internally for the (single) CF rule on sheet 0.
fn stored_cf_formula(model: &Model<'static>) -> String {
    match &model.workbook.worksheets[0].conditional_formatting[0].cf_rule {
        CfRule::Formula { formula, .. } => formula.clone(),
        other => panic!("expected a Formula rule, got {other:?}"),
    }
}

/// The formula shown to the user for the (single) CF rule on sheet 0.
fn displayed_cf_formula(model: &Model<'static>) -> String {
    let list = model.get_conditional_formatting_list(0).unwrap();
    match &list[0].cf_rule {
        CfRule::Formula { formula, .. } => formula.clone(),
        other => panic!("expected a Formula rule, got {other:?}"),
    }
}

fn model_with_column_a() -> Model<'static> {
    let mut model = new_empty_model();
    for row in 1..=10 {
        model.set_user_input(0, row, 1, row.to_string()).unwrap();
    }
    model
}

// ---------------------------------------------------------------------------
// Conditional formatting
// ---------------------------------------------------------------------------

/// A CF formula rule entered in English is stored in English, and after
/// switching to Spanish it is displayed in Spanish but still evaluates.
#[test]
fn cf_formula_entered_in_english_survives_switch_to_spanish() {
    let mut model = model_with_column_a();
    model
        .add_conditional_formatting(
            0,
            "A1:A10",
            CfRuleInput::Formula {
                formula: "=IF($A1>5,TRUE,FALSE)".to_string(),
                format: red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    model.evaluate();

    // Stored internally in English.
    assert_eq!(stored_cf_formula(&model), "=IF($A1>5,TRUE,FALSE)");
    // Displayed in English (the active language).
    assert_eq!(displayed_cf_formula(&model), "=IF($A1>5,TRUE,FALSE)");
    for row in 6..=10 {
        assert!(is_red(&model, row, 1), "row {row} should be red in English");
    }

    // Switch to Spanish.
    model.set_language("es").unwrap();

    // Still stored in English, but displayed in Spanish.
    assert_eq!(stored_cf_formula(&model), "=IF($A1>5,TRUE,FALSE)");
    assert_eq!(displayed_cf_formula(&model), "=SI($A1>5,VERDADERO,FALSO)");

    // And the rule keeps highlighting the same rows.
    model.evaluate();
    for row in 6..=10 {
        assert!(is_red(&model, row, 1), "row {row} should be red in Spanish");
    }
    for row in 1..=5 {
        assert!(!is_red(&model, row, 1), "row {row} should not be red");
    }
}

/// A CF formula rule entered in Spanish is stored in English (canonical) and
/// works straight away.
#[test]
fn cf_formula_entered_in_spanish_is_stored_in_english() {
    let mut model = model_with_column_a();
    model.set_language("es").unwrap();

    model
        .add_conditional_formatting(
            0,
            "A1:A10",
            CfRuleInput::Formula {
                formula: "=SI($A1>5,VERDADERO,FALSO)".to_string(),
                format: red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    model.evaluate();

    // Stored in English even though it was entered in Spanish.
    assert_eq!(stored_cf_formula(&model), "=IF($A1>5,TRUE,FALSE)");
    // Displayed back in Spanish.
    assert_eq!(displayed_cf_formula(&model), "=SI($A1>5,VERDADERO,FALSO)");
    for row in 6..=10 {
        assert!(is_red(&model, row, 1), "row {row} should be red");
    }

    // Switching back to English shows the English form.
    model.set_language("en").unwrap();
    assert_eq!(displayed_cf_formula(&model), "=IF($A1>5,TRUE,FALSE)");
    model.evaluate();
    for row in 6..=10 {
        assert!(is_red(&model, row, 1), "row {row} should still be red");
    }
}

/// An invalid CF formula is rejected rather than silently stored in a
/// non-canonical form (which would later fail to parse as English).
#[test]
fn cf_invalid_formula_is_rejected() {
    let mut model = model_with_column_a();
    let result = model.add_conditional_formatting(
        0,
        "A1:A10",
        CfRuleInput::Formula {
            formula: "=IF(".to_string(),
            format: red_fill(),
            stop_if_true: false,
        },
    );
    assert!(result.is_err(), "an invalid CF formula should be rejected");
    // Nothing was stored.
    assert!(model.get_conditional_formatting_list(0).unwrap().is_empty());
}

// ---------------------------------------------------------------------------
// Defined names
// ---------------------------------------------------------------------------

/// A LAMBDA defined name entered in English is stored in English, and after
/// switching to Spanish it is displayed in Spanish and keeps evaluating —
/// even after an edit that forces the defined names to be reparsed.
#[test]
fn defined_name_lambda_entered_in_english_survives_switch_to_spanish() {
    let mut model = new_empty_model();
    model
        .new_defined_name("MyIf", None, "=LAMBDA(x, IF(x>0, 1, 2))")
        .unwrap();
    model._set("A1", "=MyIf(5)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"1");

    // Stored internally in English.
    assert_eq!(
        model.workbook.defined_names[0].formula,
        "=LAMBDA(x,IF(x>0,1,2))"
    );

    model.set_language("es").unwrap();

    // Still stored in English, displayed in Spanish.
    assert_eq!(
        model.workbook.defined_names[0].formula,
        "=LAMBDA(x,IF(x>0,1,2))"
    );
    let names = model.get_defined_name_list();
    assert_eq!(names[0].2, "=LAMBDA(x,SI(x>0,1,2))");

    // An edit reparses the defined names; the English form must still parse.
    model
        .new_defined_name("Other", None, "Sheet1!$Z$1")
        .unwrap();
    model.evaluate();
    assert_eq!(
        model._get_text("A1"),
        *"1",
        "MyIf should still evaluate after the language switch and reparse"
    );
}

/// A LAMBDA defined name entered in Spanish is stored in English (canonical).
#[test]
fn defined_name_lambda_entered_in_spanish_is_stored_in_english() {
    let mut model = new_empty_model();
    model.set_language("es").unwrap();
    model
        .new_defined_name("MiSi", None, "=LAMBDA(x, SI(x>0, 1, 2))")
        .unwrap();
    model._set("A1", "=MiSi(5)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"1");

    // Stored in English even though it was entered in Spanish.
    assert_eq!(
        model.workbook.defined_names[0].formula,
        "=LAMBDA(x,IF(x>0,1,2))"
    );

    // Displayed in Spanish, and in English after switching.
    assert_eq!(model.get_defined_name_list()[0].2, "=LAMBDA(x,SI(x>0,1,2))");
    model.set_language("en").unwrap();
    assert_eq!(model.get_defined_name_list()[0].2, "=LAMBDA(x,IF(x>0,1,2))");
}
