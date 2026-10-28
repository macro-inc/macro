#![allow(clippy::unwrap_used)]
use crate::types::Color;

use crate::{cf_types::CfRuleInput, test::util::new_empty_model};

// Ten distinct values in ascending order, one per row.
// Sorted ascending:  10 20 30 40 50 60 70 80 90 100
// Top-3 threshold  : 80  (rows 8–10 match  v >= 80)
// Bottom-3 threshold: 30 (rows 1–3  match  v <= 30)
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

fn top_n(rank: u32, percent: bool) -> CfRuleInput {
    CfRuleInput::Top10 {
        rank,
        percent,
        format: super::red_fill(),
        stop_if_true: false,
    }
}

fn bottom_n(rank: u32, percent: bool) -> CfRuleInput {
    CfRuleInput::Bottom10 {
        rank,
        percent,
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
// Top10 — count-based
// ---------------------------------------------------------------------------

#[test]
fn test_top3_highlights_three_highest() {
    let mut model = model_with_values();
    model
        .add_conditional_formatting(0, "A1:A10", top_n(3, false))
        .unwrap();
    model.evaluate();

    // threshold = 80; rows 8 (80), 9 (90), 10 (100) match
    for row in 8..=10 {
        assert!(
            is_red(&model, row),
            "row {row} (value {}) should be in the top 3",
            VALUES[row as usize - 1]
        );
    }
    for row in 1..=7 {
        assert!(
            !is_red(&model, row),
            "row {row} (value {}) should not be in the top 3",
            VALUES[row as usize - 1]
        );
    }
}

#[test]
fn test_top1_highlights_only_maximum() {
    let mut model = model_with_values();
    model
        .add_conditional_formatting(0, "A1:A10", top_n(1, false))
        .unwrap();
    model.evaluate();

    assert!(is_red(&model, 10), "row 10 (100) should be the top 1");
    for row in 1..=9 {
        assert!(!is_red(&model, row), "row {row} should not be the top 1");
    }
}

// ---------------------------------------------------------------------------
// Top10 — percent-based
// ---------------------------------------------------------------------------

#[test]
fn test_top_20_percent_highlights_two_highest() {
    // ceil(20% × 10) = 2  →  top 2 = 90, 100  (rows 9, 10)
    let mut model = model_with_values();
    model
        .add_conditional_formatting(0, "A1:A10", top_n(20, true))
        .unwrap();
    model.evaluate();

    for row in 9..=10 {
        assert!(is_red(&model, row), "row {row} should be in the top 20 %");
    }
    for row in 1..=8 {
        assert!(
            !is_red(&model, row),
            "row {row} should not be in the top 20 %"
        );
    }
}

#[test]
fn test_top_30_percent_highlights_three_highest() {
    // ceil(30% × 10) = 3  →  rows 8, 9, 10
    let mut model = model_with_values();
    model
        .add_conditional_formatting(0, "A1:A10", top_n(30, true))
        .unwrap();
    model.evaluate();

    for row in 8..=10 {
        assert!(is_red(&model, row), "row {row} should be in the top 30 %");
    }
    for row in 1..=7 {
        assert!(
            !is_red(&model, row),
            "row {row} should not be in the top 30 %"
        );
    }
}

// ---------------------------------------------------------------------------
// Bottom10 — count-based
// ---------------------------------------------------------------------------

#[test]
fn test_bottom3_highlights_three_lowest() {
    let mut model = model_with_values();
    model
        .add_conditional_formatting(0, "A1:A10", bottom_n(3, false))
        .unwrap();
    model.evaluate();

    // threshold = 30; rows 1 (10), 2 (20), 3 (30) match
    for row in 1..=3 {
        assert!(
            is_red(&model, row),
            "row {row} (value {}) should be in the bottom 3",
            VALUES[row as usize - 1]
        );
    }
    for row in 4..=10 {
        assert!(
            !is_red(&model, row),
            "row {row} (value {}) should not be in the bottom 3",
            VALUES[row as usize - 1]
        );
    }
}

#[test]
fn test_bottom1_highlights_only_minimum() {
    let mut model = model_with_values();
    model
        .add_conditional_formatting(0, "A1:A10", bottom_n(1, false))
        .unwrap();
    model.evaluate();

    assert!(is_red(&model, 1), "row 1 (10) should be the bottom 1");
    for row in 2..=10 {
        assert!(!is_red(&model, row), "row {row} should not be the bottom 1");
    }
}

// ---------------------------------------------------------------------------
// Bottom10 — percent-based
// ---------------------------------------------------------------------------

#[test]
fn test_bottom_20_percent_highlights_two_lowest() {
    // ceil(20% × 10) = 2  →  bottom 2 = 10, 20  (rows 1, 2)
    let mut model = model_with_values();
    model
        .add_conditional_formatting(0, "A1:A10", bottom_n(20, true))
        .unwrap();
    model.evaluate();

    for row in 1..=2 {
        assert!(
            is_red(&model, row),
            "row {row} should be in the bottom 20 %"
        );
    }
    for row in 3..=10 {
        assert!(
            !is_red(&model, row),
            "row {row} should not be in the bottom 20 %"
        );
    }
}

// ---------------------------------------------------------------------------
// Tie at threshold boundary
// ---------------------------------------------------------------------------

#[test]
fn test_top_includes_all_values_at_threshold() {
    // Values: 10, 80, 80, 80.  Top-1 threshold = 80.
    // All three 80s satisfy v >= 80, so all three rows are highlighted.
    let mut model = new_empty_model();
    for (row, &v) in [10i32, 80, 80, 80].iter().enumerate() {
        model
            .set_user_input(0, row as i32 + 1, 1, v.to_string())
            .unwrap();
    }
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1:A4", top_n(1, false))
        .unwrap();
    model.evaluate();

    assert!(!is_red(&model, 1), "10 should not be in top-1");
    for row in 2..=4 {
        assert!(
            is_red(&model, row),
            "row {row} (value 80) equals the threshold and should match"
        );
    }
}

#[test]
fn test_bottom_includes_all_values_at_threshold() {
    // Values: 10, 10, 10, 80.  Bottom-1 threshold = 10.
    // All three 10s satisfy v <= 10.
    let mut model = new_empty_model();
    for (row, &v) in [10i32, 10, 10, 80].iter().enumerate() {
        model
            .set_user_input(0, row as i32 + 1, 1, v.to_string())
            .unwrap();
    }
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1:A4", bottom_n(1, false))
        .unwrap();
    model.evaluate();

    for row in 1..=3 {
        assert!(
            is_red(&model, row),
            "row {row} (value 10) equals the threshold and should match"
        );
    }
    assert!(!is_red(&model, 4), "80 should not be in bottom-1");
}

// ---------------------------------------------------------------------------
// Non-numeric cells are ignored
// ---------------------------------------------------------------------------

#[test]
fn test_top_ignores_text_cells() {
    let mut model = new_empty_model();
    // A1 = "hello" (text), A2 = 5, A3 = 10
    model.set_user_input(0, 1, 1, "hello".to_string()).unwrap();
    model.set_user_input(0, 2, 1, "5".to_string()).unwrap();
    model.set_user_input(0, 3, 1, "10".to_string()).unwrap();
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1:A3", top_n(1, false))
        .unwrap();
    model.evaluate();

    assert!(!is_red(&model, 1), "text cell should not be highlighted");
    assert!(!is_red(&model, 2), "5 is not the top value");
    assert!(is_red(&model, 3), "10 is the top value");
}
