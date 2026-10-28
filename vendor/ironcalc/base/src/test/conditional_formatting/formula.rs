#![allow(clippy::unwrap_used)]
use crate::types::Color;

use crate::{
    cf_types::{CfRule, CfRuleInput},
    test::util::new_empty_model,
};

// Periodic table of the first 10 elements (atomic number, symbol, atomic mass):
//   row  1 → (1,  "H",  1.008)   Hydrogen
//   row  2 → (2,  "He", 4.003)   Helium
//   row  3 → (3,  "Li", 6.941)   Lithium
//   row  4 → (4,  "Be", 9.012)   Beryllium
//   row  5 → (5,  "B",  10.81)   Boron
//   row  6 → (6,  "C",  12.011)  Carbon
//   row  7 → (7,  "N",  14.007)  Nitrogen
//   row  8 → (8,  "O",  15.999)  Oxygen
//   row  9 → (9,  "F",  18.998)  Fluorine
//   row 10 → (10, "Ne", 20.180)  Neon
//
// Columns: A = atomic number, B = symbol, C = atomic mass

fn model_with_elements() -> crate::Model<'static> {
    let mut model = new_empty_model();
    let data: &[(i32, &str, &str)] = &[
        (1, "H", "1.008"),
        (2, "He", "4.003"),
        (3, "Li", "6.941"),
        (4, "Be", "9.012"),
        (5, "B", "10.81"),
        (6, "C", "12.011"),
        (7, "N", "14.007"),
        (8, "O", "15.999"),
        (9, "F", "18.998"),
        (10, "Ne", "20.180"),
    ];
    for (row, (num, sym, mass)) in data.iter().enumerate() {
        let r = row as i32 + 1;
        model.set_user_input(0, r, 1, num.to_string()).unwrap();
        model.set_user_input(0, r, 2, sym.to_string()).unwrap();
        model.set_user_input(0, r, 3, mass.to_string()).unwrap();
    }
    model.evaluate();
    model
}

fn is_red(model: &crate::Model<'static>, row: i32, col: i32) -> bool {
    model
        .get_extended_style_for_cell(0, row, col)
        .unwrap()
        .style
        .fill
        .color
        == Color::Rgb("#FF0000".to_string())
}

// ---------------------------------------------------------------------------
// Rule stored correctly
// ---------------------------------------------------------------------------

#[test]
fn test_formula_rule_stored() {
    let mut model = new_empty_model();
    model
        .add_conditional_formatting(
            0,
            "A1:A10",
            CfRuleInput::Formula {
                formula: "=$A1>5".to_string(),
                format: super::red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    let list = model.get_conditional_formatting_list(0).unwrap();
    assert!(matches!(list[0].cf_rule, CfRule::Formula { .. }));
}

// ---------------------------------------------------------------------------
// Simple absolute formula: highlight cells where the value in column A > 5
// (formula =$A1>5 applied to A1:C10)
// ---------------------------------------------------------------------------

#[test]
fn test_formula_absolute_column_highlights_correct_rows() {
    let mut model = model_with_elements();
    // =$A1>5 on A1:A10 — highlights rows where atomic number > 5 (rows 6..10)
    model
        .add_conditional_formatting(
            0,
            "A1:A10",
            CfRuleInput::Formula {
                formula: "=$A1>5".to_string(),
                format: super::red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    model.evaluate();

    for row in 6..=10 {
        assert!(
            is_red(&model, row, 1),
            "row {row} (atomic# {row}) should be highlighted"
        );
    }
    for row in 1..=5 {
        assert!(
            !is_red(&model, row, 1),
            "row {row} (atomic# {row}) should not be highlighted"
        );
    }
}

// ---------------------------------------------------------------------------
// Relative-row reference: =$A1>5 spans both columns A and B (C2:D10-style).
// The formula moves row-by-row but the $A column is fixed.
// ---------------------------------------------------------------------------

#[test]
fn test_formula_relative_row_across_columns() {
    let mut model = model_with_elements();
    // Apply =$A1>5 over A1:B10 — both columns should track column A's value per row.
    model
        .add_conditional_formatting(
            0,
            "A1:B10",
            CfRuleInput::Formula {
                formula: "=$A1>5".to_string(),
                format: super::red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    model.evaluate();

    // Rows 6–10: both A and B columns should be red (formula checks $A of same row)
    for row in 6..=10 {
        assert!(is_red(&model, row, 1), "A{row} should be highlighted");
        assert!(
            is_red(&model, row, 2),
            "B{row} should be highlighted (same row check via $A)"
        );
    }
    // Rows 1–5: neither column
    for row in 1..=5 {
        assert!(!is_red(&model, row, 1), "A{row} should not be highlighted");
        assert!(!is_red(&model, row, 2), "B{row} should not be highlighted");
    }
}

// ---------------------------------------------------------------------------
// Cross-column reference: =$C1>10 highlights cells in A where atomic mass > 10.
// Atomic masses > 10: rows 5 (10.81), 6 (12.011), 7 (14.007), 8 (15.999),
//                     9 (18.998), 10 (20.180)
// ---------------------------------------------------------------------------

#[test]
fn test_formula_cross_column_reference() {
    let mut model = model_with_elements();
    model
        .add_conditional_formatting(
            0,
            "A1:A10",
            CfRuleInput::Formula {
                formula: "=$C1>10".to_string(),
                format: super::red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    model.evaluate();

    // Rows 5–10: atomic mass > 10
    for row in 5..=10 {
        assert!(
            is_red(&model, row, 1),
            "row {row} (mass > 10) should be highlighted"
        );
    }
    // Rows 1–4: atomic mass <= 10
    for row in 1..=4 {
        assert!(
            !is_red(&model, row, 1),
            "row {row} (mass <= 10) should not be highlighted"
        );
    }
}

// ---------------------------------------------------------------------------
// Fully absolute formula: =$A$1>0 — always evaluates A1, which is 1 > 0 = TRUE.
// Every cell in the range should be highlighted.
// ---------------------------------------------------------------------------

#[test]
fn test_formula_fully_absolute_always_true() {
    let mut model = model_with_elements();
    model
        .add_conditional_formatting(
            0,
            "A1:A10",
            CfRuleInput::Formula {
                formula: "=$A$1>0".to_string(),
                format: super::red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    model.evaluate();

    for row in 1..=10 {
        assert!(
            is_red(&model, row, 1),
            "row {row} should be highlighted (A1=1>0 is always true)"
        );
    }
}

// ---------------------------------------------------------------------------
// String equality formula: =$B1="C" highlights the Carbon row (row 6).
// ---------------------------------------------------------------------------

#[test]
fn test_formula_string_equality() {
    let mut model = model_with_elements();
    model
        .add_conditional_formatting(
            0,
            "A1:A10",
            CfRuleInput::Formula {
                formula: r#"=$B1="C""#.to_string(),
                format: super::red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    model.evaluate();

    assert!(
        is_red(&model, 6, 1),
        "row 6 (Carbon, symbol C) should be highlighted"
    );
    for row in [1, 2, 3, 4, 5, 7, 8, 9, 10] {
        assert!(
            !is_red(&model, row, 1),
            "row {row} should not be highlighted"
        );
    }
}

// ---------------------------------------------------------------------------
// Formula returning FALSE never applies.
// ---------------------------------------------------------------------------

#[test]
fn test_formula_always_false_no_highlight() {
    let mut model = model_with_elements();
    model
        .add_conditional_formatting(
            0,
            "A1:A10",
            CfRuleInput::Formula {
                formula: "=FALSE()".to_string(),
                format: super::red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    model.evaluate();

    for row in 1..=10 {
        assert!(
            !is_red(&model, row, 1),
            "no row should be highlighted with FALSE formula"
        );
    }
}
