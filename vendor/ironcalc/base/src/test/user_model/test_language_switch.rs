#![allow(clippy::unwrap_used, clippy::panic)]
//! Regression tests for #1126 at the
//! `UserModel` level. They make sure the undo/redo diff machinery keeps working
//! when conditional-formatting rules and defined names are created in a
//! non-English language: the diffs hold the internal (English) formula, so they
//! replay correctly regardless of the active language.

use crate::{
    cf_types::{CfRule, CfRuleInput},
    test::user_model::util::new_empty_user_model,
    types::{Color, Dxf, Fill},
    UserModel,
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

fn stored_cf_formula(model: &UserModel<'static>) -> String {
    match &model.model.workbook.worksheets[0].conditional_formatting[0].cf_rule {
        CfRule::Formula { formula, .. } => formula.clone(),
        other => panic!("expected a Formula rule, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Defined names
// ---------------------------------------------------------------------------
#[test]
fn defined_name_created_in_spanish_undo_redo() {
    let mut model = new_empty_user_model();
    model.set_language("es").unwrap();
    model
        .new_defined_name("MiSi", None, "=LAMBDA(x, SI(x>0, 1, 2))")
        .unwrap();
    model.set_user_input(0, 1, 1, "=MiSi(5)").unwrap();
    assert_eq!(model.model._get_text("A1"), *"1");

    // Stored in English, displayed in Spanish.
    assert_eq!(
        model.model.workbook.defined_names[0].formula,
        "=LAMBDA(x,IF(x>0,1,2))"
    );
    assert_eq!(model.get_defined_name_list()[0].2, "=LAMBDA(x,SI(x>0,1,2))");

    // Switching language must not break undo/redo: the diff carries English.
    model.set_language("en").unwrap();

    model.undo().unwrap(); // undo the A1 = "=MiSi(5)" input
    model.undo().unwrap(); // undo the defined-name creation
    assert!(model.get_defined_name_list().is_empty());

    model.redo().unwrap(); // redo the defined-name creation
    assert_eq!(
        model.model.workbook.defined_names[0].formula,
        "=LAMBDA(x,IF(x>0,1,2))"
    );
    model.redo().unwrap(); // redo the A1 input
    assert_eq!(model.model._get_text("A1"), *"1");
}

// ---------------------------------------------------------------------------
// Row/column displacement (#1252)
// ---------------------------------------------------------------------------

// Regression test for #1252: deleting a column rewrote every formula in the
// workbook in English, which the active (Spanish) parser could not read back,
// turning them all into #NAME? errors.
#[test]
fn delete_column_keeps_formulas_in_active_language() {
    let mut model = new_empty_user_model();
    model.set_language("es").unwrap();
    model.set_user_input(0, 1, 1, "5").unwrap();
    model
        .set_user_input(0, 1, 2, "=SI(ESNUMERO(A1),A1*2,0)")
        .unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 2).unwrap(), "10");

    // Column D is empty: no formula references it, but the displacement
    // machinery still visits (and used to rewrite) every formula.
    model.delete_columns(0, 4, 1).unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 2).unwrap(),
        "=SI(ESNUMERO(A1),A1*2,0)"
    );
    assert_eq!(model.get_formatted_cell_value(0, 1, 2).unwrap(), "10");
}

// Same as above but the deleted column actually displaces the references.
#[test]
fn delete_column_displaces_formulas_in_active_language() {
    let mut model = new_empty_user_model();
    model.set_language("es").unwrap();
    model.set_user_input(0, 1, 5, "5").unwrap();
    model
        .set_user_input(0, 1, 7, "=SI(ESNUMERO(E1),E1*2,0)")
        .unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 7).unwrap(), "10");

    // Delete column C: E1 -> D1, the formula moves from G1 to F1.
    model.delete_columns(0, 3, 1).unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 6).unwrap(),
        "=SI(ESNUMERO(D1),D1*2,0)"
    );
    assert_eq!(model.get_formatted_cell_value(0, 1, 6).unwrap(), "10");
}

// Deleting a row goes through the same displacement machinery as deleting a
// column and suffered from the same bug.
#[test]
fn delete_row_keeps_formulas_in_active_language() {
    let mut model = new_empty_user_model();
    model.set_language("es").unwrap();
    model.set_user_input(0, 1, 1, "5").unwrap();
    model
        .set_user_input(0, 1, 2, "=SI(ESNUMERO(A1),A1*2,0)")
        .unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 2).unwrap(), "10");

    // Row 4 is empty: no formula references it, but the displacement
    // machinery still visits (and used to rewrite) every formula.
    model.delete_rows(0, 4, 1).unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 2).unwrap(),
        "=SI(ESNUMERO(A1),A1*2,0)"
    );
    assert_eq!(model.get_formatted_cell_value(0, 1, 2).unwrap(), "10");
}

// Same as above but the deleted row actually displaces the references.
#[test]
fn delete_row_displaces_formulas_in_active_language() {
    let mut model = new_empty_user_model();
    model.set_language("es").unwrap();
    model.set_user_input(0, 5, 1, "5").unwrap();
    model
        .set_user_input(0, 7, 1, "=SI(ESNUMERO(A5),A5*2,0)")
        .unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 7, 1).unwrap(), "10");

    // Delete row 3: A5 -> A4, the formula moves from A7 to A6.
    model.delete_rows(0, 3, 1).unwrap();

    assert_eq!(
        model.get_cell_content(0, 6, 1).unwrap(),
        "=SI(ESNUMERO(A4),A4*2,0)"
    );
    assert_eq!(model.get_formatted_cell_value(0, 6, 1).unwrap(), "10");
}

// Inserting a column also goes through the displacement machinery.
#[test]
fn insert_column_displaces_formulas_in_active_language() {
    let mut model = new_empty_user_model();
    model.set_language("es").unwrap();
    model.set_user_input(0, 1, 5, "5").unwrap();
    model
        .set_user_input(0, 1, 7, "=SI(ESNUMERO(E1),E1*2,0)")
        .unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 7).unwrap(), "10");

    // Insert a column at C: E1 -> F1, the formula moves from G1 to H1.
    model.insert_columns(0, 3, 1).unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 8).unwrap(),
        "=SI(ESNUMERO(F1),F1*2,0)"
    );
    assert_eq!(model.get_formatted_cell_value(0, 1, 8).unwrap(), "10");
}

// Inserting a row also goes through the displacement machinery.
#[test]
fn insert_row_displaces_formulas_in_active_language() {
    let mut model = new_empty_user_model();
    model.set_language("es").unwrap();
    model.set_user_input(0, 5, 1, "5").unwrap();
    model
        .set_user_input(0, 7, 1, "=SI(ESNUMERO(A5),A5*2,0)")
        .unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 7, 1).unwrap(), "10");

    // Insert a row at 3: A5 -> A6, the formula moves from A7 to A8.
    model.insert_rows(0, 3, 1).unwrap();

    assert_eq!(
        model.get_cell_content(0, 8, 1).unwrap(),
        "=SI(ESNUMERO(A6),A6*2,0)"
    );
    assert_eq!(model.get_formatted_cell_value(0, 8, 1).unwrap(), "10");
}

// Moving a column also goes through the displacement machinery.
#[test]
fn move_column_displaces_formulas_in_active_language() {
    let mut model = new_empty_user_model();
    model.set_language("es").unwrap();
    model.set_user_input(0, 1, 5, "5").unwrap();
    model
        .set_user_input(0, 1, 7, "=SI(ESNUMERO(E1),E1*2,0)")
        .unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 7).unwrap(), "10");

    // Move column E one to the right: E1 -> F1, the formula stays in G1.
    model.move_columns_action(0, 5, 1, 1).unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 7).unwrap(),
        "=SI(ESNUMERO(F1),F1*2,0)"
    );
    assert_eq!(model.get_formatted_cell_value(0, 1, 7).unwrap(), "10");
}

// Moving a row also goes through the displacement machinery.
#[test]
fn move_row_displaces_formulas_in_active_language() {
    let mut model = new_empty_user_model();
    model.set_language("es").unwrap();
    model.set_user_input(0, 5, 1, "5").unwrap();
    model
        .set_user_input(0, 7, 1, "=SI(ESNUMERO(A5),A5*2,0)")
        .unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 7, 1).unwrap(), "10");

    // Move row 5 one down: A5 -> A6, the formula stays in A7.
    model.move_rows_action(0, 5, 1, 1).unwrap();

    assert_eq!(
        model.get_cell_content(0, 7, 1).unwrap(),
        "=SI(ESNUMERO(A6),A6*2,0)"
    );
    assert_eq!(model.get_formatted_cell_value(0, 7, 1).unwrap(), "10");
}

// Row analogue of the CF test below: deleting a row must displace the stored
// (English) CF formula even when the active language is Spanish.
#[test]
fn delete_row_displaces_cf_formulas_in_spanish_model() {
    let mut model = new_empty_user_model();
    for row in 5..=14 {
        model.set_user_input(0, row, 1, &row.to_string()).unwrap();
    }
    model.set_language("es").unwrap();
    model
        .add_conditional_formatting(
            0,
            "A5:A14",
            CfRuleInput::Formula {
                formula: "=SI($A5>5.5,VERDADERO,FALSO)".to_string(),
                format: red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    assert_eq!(stored_cf_formula(&model), "=IF($A5>5.5,TRUE,FALSE)");

    // Delete row 3: the rule range and formula shift up one row.
    model.delete_rows(0, 3, 1).unwrap();

    assert_eq!(
        model.model.workbook.worksheets[0].conditional_formatting[0].range,
        "A4:A13"
    );
    assert_eq!(stored_cf_formula(&model), "=IF($A4>5.5,TRUE,FALSE)");
}

// Companion to #1252 for conditional formatting: CF formulas are stored in
// English, so displacing them must parse (and re-stringify) them as English
// even when the active language is Spanish.
#[test]
fn delete_column_displaces_cf_formulas_in_spanish_model() {
    let mut model = new_empty_user_model();
    for row in 1..=10 {
        model.set_user_input(0, row, 5, &row.to_string()).unwrap();
    }
    model.set_language("es").unwrap();
    model
        .add_conditional_formatting(
            0,
            "E1:E10",
            CfRuleInput::Formula {
                formula: "=SI($E1>5.5,VERDADERO,FALSO)".to_string(),
                format: red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    assert_eq!(stored_cf_formula(&model), "=IF($E1>5.5,TRUE,FALSE)");

    // Delete column C: the rule range and formula shift from E to D.
    model.delete_columns(0, 3, 1).unwrap();

    assert_eq!(
        model.model.workbook.worksheets[0].conditional_formatting[0].range,
        "D1:D10"
    );
    assert_eq!(stored_cf_formula(&model), "=IF($D1>5.5,TRUE,FALSE)");
}

// ---------------------------------------------------------------------------
// Conditional formatting
// ---------------------------------------------------------------------------
#[test]
fn cf_formula_created_in_spanish_undo_redo() {
    let mut model = new_empty_user_model();
    for row in 1..=10 {
        model.set_user_input(0, row, 1, &row.to_string()).unwrap();
    }
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

    // Stored in English, displayed in Spanish.
    assert_eq!(stored_cf_formula(&model), "=IF($A1>5,TRUE,FALSE)");
    let list = model.get_conditional_formatting_list(0).unwrap();
    let CfRule::Formula { formula, .. } = &list[0].cf_rule else {
        panic!("expected a Formula rule");
    };
    assert_eq!(formula, "=SI($A1>5,VERDADERO,FALSO)");

    let is_red = |m: &UserModel<'static>, row: i32| {
        m.model
            .get_extended_style_for_cell(0, row, 1)
            .unwrap()
            .style
            .fill
            .color
            == Color::Rgb("#FF0000".to_string())
    };
    assert!(is_red(&model, 10));

    // Switch to English then undo/redo.
    model.set_language("en").unwrap();

    model.undo().unwrap();
    assert!(model.get_conditional_formatting_list(0).unwrap().is_empty());

    model.redo().unwrap();
    assert_eq!(stored_cf_formula(&model), "=IF($A1>5,TRUE,FALSE)");
    assert!(is_red(&model, 10));
    assert!(!is_red(&model, 1));
}
