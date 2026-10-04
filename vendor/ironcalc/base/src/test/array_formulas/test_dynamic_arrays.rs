#![allow(clippy::unwrap_used)]
use crate::types::Color;

use crate::test::util::new_empty_model;
use crate::types::{ArrayKind, Cell, FormulaValue, SpillValue};

// ── Dynamic formula: spill does not overwrite existing cell background colors ─

#[test]
fn spill_preserves_background_color_in_column_direction() {
    let mut model = new_empty_model();

    // Put values in A4:A8
    model._set("A4", "10");
    model._set("A5", "20");
    model._set("A6", "30");
    model._set("A7", "40");
    model._set("A8", "50");

    // Set background color on D5 and D6 (which will be in the spill range of D2)
    // D2 + 5 rows = D2:D6, so D5 and D6 are in the spill area
    let mut style_d5 = model.get_style_for_cell(0, 5, 4).unwrap();
    style_d5.fill.color = Color::Rgb("#FF0000".to_string());
    model.set_cell_style(0, 5, 4, &style_d5).unwrap();

    let mut style_d6 = model.get_style_for_cell(0, 6, 4).unwrap();
    style_d6.fill.color = Color::Rgb("#00FF00".to_string());
    model.set_cell_style(0, 6, 4, &style_d6).unwrap();

    // Enter =A4:A8 in D2 — it spills into D3:D6
    model._set("D2", "=A4:A8");
    model.evaluate();

    // Spill values should be correct
    assert_eq!(model._get_text("D2"), "10");
    assert_eq!(model._get_text("D5"), "40");
    assert_eq!(model._get_text("D6"), "50");

    // Background colors in the spill area must be preserved
    let style_d5_after = model.get_style_for_cell(0, 5, 4).unwrap();
    assert_eq!(
        style_d5_after.fill.color,
        Color::Rgb("#FF0000".to_string()),
        "D5 background color should be preserved after spill"
    );

    let style_d6_after = model.get_style_for_cell(0, 6, 4).unwrap();
    assert_eq!(
        style_d6_after.fill.color,
        Color::Rgb("#00FF00".to_string()),
        "D6 background color should be preserved after spill"
    );
}

#[test]
fn spill_preserves_background_color_in_row_direction() {
    let mut model = new_empty_model();

    // Put values in A1:E1
    model._set("A1", "10");
    model._set("B1", "20");
    model._set("C1", "30");
    model._set("D1", "40");
    model._set("E1", "50");

    // Set background color on D3 and E3 (which will be in the spill range of B3)
    // =A1:E1 entered in B3 spills right: B3:F3, so D3 and E3 are spill cells
    let mut style_d3 = model.get_style_for_cell(0, 3, 4).unwrap();
    style_d3.fill.color = Color::Rgb("#0000FF".to_string());
    model.set_cell_style(0, 3, 4, &style_d3).unwrap();

    let mut style_e3 = model.get_style_for_cell(0, 3, 5).unwrap();
    style_e3.fill.color = Color::Rgb("#FFFF00".to_string());
    model.set_cell_style(0, 3, 5, &style_e3).unwrap();

    // Enter =A1:E1 in B3 — it spills right into C3:F3
    model._set("B3", "=A1:E1");
    model.evaluate();

    // Spill values should be correct
    assert_eq!(model._get_text("B3"), "10");
    assert_eq!(model._get_text("D3"), "30");
    assert_eq!(model._get_text("E3"), "40");

    // Background colors in the spill area must be preserved
    let style_d3_after = model.get_style_for_cell(0, 3, 4).unwrap();
    assert_eq!(
        style_d3_after.fill.color,
        Color::Rgb("#0000FF".to_string()),
        "D3 background color should be preserved after horizontal spill"
    );

    let style_e3_after = model.get_style_for_cell(0, 3, 5).unwrap();
    assert_eq!(
        style_e3_after.fill.color,
        Color::Rgb("#FFFF00".to_string()),
        "E3 background color should be preserved after horizontal spill"
    );
}

#[test]
fn dynamic_formula_spills_array() {
    let mut model = new_empty_model();
    // Put data in B1:B3
    model._set("B1", "10");
    model._set("B2", "20");
    model._set("B3", "30");

    // Dynamic formula in A1 that returns a 5×1 array
    model._set("A1", "=B1:B5");
    model.evaluate();

    // A1 (anchor) holds 10; A2 and A3 are spill cells
    assert_eq!(model._get_text("A1"), "10");
    assert_eq!(model._get_text("A2"), "20");
    assert_eq!(model._get_text("A3"), "30");

    // A1 has a formula; spill cells do not
    assert!(model._has_formula("A1"));
    assert!(!model._has_formula("A2"));
    assert!(!model._has_formula("A3"));

    let cell_a1 = model._get_cell("A1");
    assert!(matches!(
        cell_a1,
        Cell::ArrayFormula {
            kind: ArrayKind::Dynamic,
            v: FormulaValue::Number(10.0),
            r: (1, 5),
            ..
        }
    ));

    // Spill cells point back to the anchor
    let cell_a2 = model._get_cell("A2");
    assert!(matches!(
        cell_a2,
        Cell::SpillCell {
            a: (1, 1),
            v: SpillValue::Number(20.0),
            ..
        }
    ));

    let cell_a5 = model._get_cell("A5");
    assert!(matches!(
        cell_a5,
        Cell::SpillCell {
            a: (1, 1),
            v: SpillValue::Number(0.0),
            ..
        }
    ));
}

#[test]
fn dynamic_formula_spill_error() {
    let mut model = new_empty_model();
    // Put data in B1:B3
    model._set("B1", "10");
    model._set("B2", "20");
    model._set("B3", "30");
    model._set("A3", "value");

    // Dynamic formula in A1 that returns a 5×1 array
    model._set("A1", "=B1:B5");
    model.evaluate();

    // A1 should show a spill error because A3 is blocking the spill
    assert_eq!(model._get_text("A1"), "#SPILL!");
}

// ── Dynamic formula: user enters range formula that spills ─────────────────

#[test]
fn user_range_formula_spills() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");

    // User enters =A1:A3 in B2 — it should spill into B3 and B4
    model._set("B2", "=A1:A3");
    model.evaluate();

    assert_eq!(model._get_text("B2"), "1");
    assert_eq!(model._get_text("B3"), "2");
    assert_eq!(model._get_text("B4"), "3");

    assert!(model._has_formula("B2"));
    assert!(!model._has_formula("B3"));
    assert!(!model._has_formula("B4"));
}

// ── Dynamic formula: re-evaluate shrinks the spill range ───────────────────

#[test]
fn dynamic_formula_spill_shrinks_on_re_evaluate() {
    let mut model = new_empty_model();
    model._set("B1", "1");
    model._set("B2", "2");
    model._set("B3", "3");

    model._set("A1", "=B1:B3");
    model.evaluate();
    assert_eq!(model._get_text("A3"), "3");

    // Replace B3 so the range B1:B2 is shorter — but the dynamic formula
    // still references B1:B3, so A3 stays. This just confirms stable re-eval.
    model._set("B3", "99");
    model.evaluate();
    assert_eq!(model._get_text("A3"), "99");
}

// ── Dynamic formula: writing into a spill cell clears the spill ────────────

#[test]
fn writing_into_spill_cell_clears_spill() {
    let mut model = new_empty_model();
    model._set("B1", "10");
    model._set("B2", "20");
    model._set("B3", "30");

    model._set("A1", "=B1:B3");
    model.evaluate();

    // A2 is a spill cell. Writing into it should succeed (unlike CSE spills).
    model.set_user_input(0, 2, 1, "999".to_string()).unwrap();

    // After clearing the spill, the anchor (A1) should have been reset to an
    // unevaluated DynamicFormula and the other spill cells cleared.
    let cell_a1 = model._get_cell("A1");
    assert!(
        matches!(
            cell_a1,
            Cell::ArrayFormula {
                kind: ArrayKind::Dynamic,
                v: FormulaValue::Unevaluated,
                ..
            }
        ),
        "anchor should be an unevaluated DynamicFormula after spill is broken"
    );

    // A3 should have been cleared (no longer a spill cell)
    assert_eq!(model._get_text("A3"), "");
}

// ── Dynamic formula: re-evaluate after spill is broken works ───────────────

#[test]
fn dynamic_formula_re_evaluates_after_spill_broken() {
    let mut model = new_empty_model();
    model._set("B1", "1");
    model._set("B2", "2");
    model._set("B3", "3");

    model._set("A1", "=B1:B3");
    model.evaluate();

    // Write into A2 to break the spill
    model.set_user_input(0, 2, 1, "999".to_string()).unwrap();

    // Now clear A2 to let the spill restore, then re-evaluate
    model._cell_clear_contents(0, 2, 1).unwrap();
    model.evaluate();

    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("A2"), "2");
    assert_eq!(model._get_text("A3"), "3");
}

// ── CSE array formula: array result fills declared range ──────────────────

#[test]
fn cse_array_formula_fills_declared_range() {
    let mut model = new_empty_model();
    model._set("B1", "5");
    model._set("B2", "10");
    model._set("B3", "15");

    // Array formula A1:A3 = B1:B3 * 2
    model
        .set_user_array_formula(0, 1, 1, 1, 3, "=B1:B3*2")
        .unwrap();
    model.evaluate();

    assert_eq!(model._get_text("A1"), "10");
    assert_eq!(model._get_text("A2"), "20");
    assert_eq!(model._get_text("A3"), "30");
}

// ── CSE array formula: spill cells cannot be modified ─────────────────────

#[test]
fn cse_spill_cells_are_locked() {
    let mut model = new_empty_model();
    model.set_user_array_formula(0, 1, 1, 1, 3, "=1+1").unwrap();
    model.evaluate();

    // A2 and A3 are spill cells of a CSE formula — writes must be rejected.
    assert!(model.set_user_input(0, 2, 1, "42".to_string()).is_err());
    assert!(model._cell_clear_contents(0, 2, 1).is_err());
    assert!(model._cell_clear_all(0, 2, 1).is_err());
}

#[test]
fn cse_cannot_user_input_anchor() {
    let mut model = new_empty_model();
    model.set_user_array_formula(0, 1, 1, 1, 3, "=1+1").unwrap();
    model.evaluate();
    assert_eq!(model._get_text("A2"), "2");

    assert!(model.set_user_input(0, 1, 1, "".to_string()).is_err());
    model.evaluate();

    assert_eq!(model._get_text("A1"), "2");
    assert_eq!(model._get_text("A2"), "2");
    assert_eq!(model._get_text("A3"), "2");
}

// ── CSE array formula: existing styles in the selected range are preserved ────

#[test]
fn cse_array_formula_preserves_background_color_in_column_direction() {
    let mut model = new_empty_model();

    // Set background colors on A2 and A3 before entering the CSE formula A1:A3
    let mut style_a2 = model.get_style_for_cell(0, 2, 1).unwrap();
    style_a2.fill.color = Color::Rgb("#FF0000".to_string());
    model.set_cell_style(0, 2, 1, &style_a2).unwrap();

    let mut style_a3 = model.get_style_for_cell(0, 3, 1).unwrap();
    style_a3.fill.color = Color::Rgb("#00FF00".to_string());
    model.set_cell_style(0, 3, 1, &style_a3).unwrap();

    // Enter CSE formula =123 over A1:A3
    model.set_user_array_formula(0, 1, 1, 1, 3, "=123").unwrap();
    model.evaluate();

    assert_eq!(model._get_text("A1"), "123");
    assert_eq!(model._get_text("A2"), "123");
    assert_eq!(model._get_text("A3"), "123");

    // Background colors on A2 and A3 must be preserved
    let style_a2_after = model.get_style_for_cell(0, 2, 1).unwrap();
    assert_eq!(
        style_a2_after.fill.color,
        Color::Rgb("#FF0000".to_string()),
        "A2 background color should be preserved after CSE array formula"
    );

    let style_a3_after = model.get_style_for_cell(0, 3, 1).unwrap();
    assert_eq!(
        style_a3_after.fill.color,
        Color::Rgb("#00FF00".to_string()),
        "A3 background color should be preserved after CSE array formula"
    );
}

#[test]
fn cse_array_formula_preserves_background_color_in_row_direction() {
    let mut model = new_empty_model();

    // Set background colors on B1 and C1 before entering the CSE formula A1:C1
    let mut style_b1 = model.get_style_for_cell(0, 1, 2).unwrap();
    style_b1.fill.color = Color::Rgb("#0000FF".to_string());
    model.set_cell_style(0, 1, 2, &style_b1).unwrap();

    let mut style_c1 = model.get_style_for_cell(0, 1, 3).unwrap();
    style_c1.fill.color = Color::Rgb("#FFFF00".to_string());
    model.set_cell_style(0, 1, 3, &style_c1).unwrap();

    // Enter CSE formula =456 over A1:C1
    model.set_user_array_formula(0, 1, 1, 3, 1, "=456").unwrap();
    model.evaluate();

    assert_eq!(model._get_text("A1"), "456");
    assert_eq!(model._get_text("B1"), "456");
    assert_eq!(model._get_text("C1"), "456");

    // Background colors on B1 and C1 must be preserved
    let style_b1_after = model.get_style_for_cell(0, 1, 2).unwrap();
    assert_eq!(
        style_b1_after.fill.color,
        Color::Rgb("#0000FF".to_string()),
        "B1 background color should be preserved after CSE array formula"
    );

    let style_c1_after = model.get_style_for_cell(0, 1, 3).unwrap();
    assert_eq!(
        style_c1_after.fill.color,
        Color::Rgb("#FFFF00".to_string()),
        "C1 background color should be preserved after CSE array formula"
    );
}
