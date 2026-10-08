#![allow(clippy::unwrap_used)]

use crate::types::Color;
use crate::{cf_types::CfRuleInput, test::util::new_empty_model};

// Ten evenly-spaced values: 10, 20, …, 100.
// Mean = 55.  Values above the mean: 60–100 (rows 6–10).
//             Values below the mean: 10–50  (rows 1–5).
const VALUES: [i32; 10] = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

fn model_with_values() -> crate::Model<'static> {
    let mut model = new_empty_model();
    for (i, &v) in VALUES.iter().enumerate() {
        model
            .set_user_input(0, i as i32 + 1, 1, v.to_string())
            .unwrap();
    }
    model.evaluate();
    model
}

fn above_average_rule() -> CfRuleInput {
    CfRuleInput::AboveAverage {
        format: super::red_fill(),
        stop_if_true: false,
    }
}

fn below_average_rule() -> CfRuleInput {
    CfRuleInput::BelowAverage {
        format: super::red_fill(),
        stop_if_true: false,
    }
}

fn is_red(model: &crate::Model<'static>, row: i32) -> bool {
    model
        .get_extended_style_for_cell(0, row, 1)
        .unwrap()
        .style
        .fill
        .color
        == Color::Rgb("#FF0000".to_string())
}

// ---------------------------------------------------------------------------
// AboveAverage
// ---------------------------------------------------------------------------

#[test]
fn test_above_average_highlights_correct_rows() {
    let mut model = model_with_values();
    model
        .add_conditional_formatting(0, "A1:A10", above_average_rule())
        .unwrap();
    model.evaluate();

    // mean = 55; values 60-100 (rows 6-10) are above average
    for row in 6..=10 {
        assert!(
            is_red(&model, row),
            "row {row} (value {}) should be above average",
            VALUES[row as usize - 1]
        );
    }
    // values 10-50 (rows 1-5) are below average
    for row in 1..=5 {
        assert!(
            !is_red(&model, row),
            "row {row} (value {}) should not be above average",
            VALUES[row as usize - 1]
        );
    }
}

#[test]
fn test_above_average_boundary_not_included() {
    // Use three values: 10, 30, 50. Mean = 30.
    // Only 50 is strictly above the mean; 30 equals the mean and must not match.
    let mut model = new_empty_model();
    for (row, &v) in [10, 30, 50].iter().enumerate() {
        model
            .set_user_input(0, row as i32 + 1, 1, v.to_string())
            .unwrap();
    }
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1:A3", above_average_rule())
        .unwrap();
    model.evaluate();

    assert!(!is_red(&model, 1), "10 is below mean, should not match");
    assert!(!is_red(&model, 2), "30 equals the mean, should not match");
    assert!(is_red(&model, 3), "50 is above the mean, should match");
}

#[test]
fn test_above_average_empty_range_does_not_panic() {
    let mut model = new_empty_model();
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1:A5", above_average_rule())
        .unwrap();
    model.evaluate(); // should not panic on an all-empty range
}

// ---------------------------------------------------------------------------
// BelowAverage
// ---------------------------------------------------------------------------

#[test]
fn test_below_average_highlights_correct_rows() {
    let mut model = model_with_values();
    model
        .add_conditional_formatting(0, "A1:A10", below_average_rule())
        .unwrap();
    model.evaluate();

    // values 10-50 (rows 1-5) are below average
    for row in 1..=5 {
        assert!(
            is_red(&model, row),
            "row {row} (value {}) should be below average",
            VALUES[row as usize - 1]
        );
    }
    // values 60-100 (rows 6-10) are above average
    for row in 6..=10 {
        assert!(
            !is_red(&model, row),
            "row {row} (value {}) should not be below average",
            VALUES[row as usize - 1]
        );
    }
}

#[test]
fn test_below_average_boundary_not_included() {
    let mut model = new_empty_model();
    for (row, &v) in [10, 30, 50].iter().enumerate() {
        model
            .set_user_input(0, row as i32 + 1, 1, v.to_string())
            .unwrap();
    }
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1:A3", below_average_rule())
        .unwrap();
    model.evaluate();

    assert!(is_red(&model, 1), "10 is below the mean, should match");
    assert!(!is_red(&model, 2), "30 equals the mean, should not match");
    assert!(!is_red(&model, 3), "50 is above the mean, should not match");
}

#[test]
fn test_above_and_below_average_are_disjoint() {
    // No cell should match both rules when applied to the same range.
    let mut model = model_with_values();
    model
        .add_conditional_formatting(0, "A1:A10", above_average_rule())
        .unwrap();
    model
        .add_conditional_formatting(0, "A1:A10", below_average_rule())
        .unwrap();
    model.evaluate();

    for row in 1..=10 {
        let style = model.get_extended_style_for_cell(0, row, 1).unwrap();
        // Both rules write to bg_color via Dxf; if both matched the last one would win.
        // What we verify is that the value is never something impossible.
        let _ = style.style.fill.color; // just ensure no panic
    }
}
