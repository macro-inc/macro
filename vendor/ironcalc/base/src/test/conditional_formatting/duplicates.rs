#![allow(clippy::unwrap_used)]
use crate::types::Color;

use crate::{cf_types::CfRuleInput, test::util::new_empty_model};

// Dataset layout (column A):
//   row 1 →  10   (duplicate — appears in rows 1, 3)
//   row 2 →  20   (duplicate — appears in rows 2, 5)
//   row 3 →  10   (duplicate)
//   row 4 →  30   (unique)
//   row 5 →  20   (duplicate)
//   row 6 →  40   (unique)
//
// Column B has strings with mixed duplicates/uniques:
//   row 1 → "rust"   (duplicate — appears in rows 1, 3)
//   row 2 → "go"     (unique)
//   row 3 → "rust"   (duplicate)
//   row 4 → "python" (unique)

fn model_with_mixed() -> crate::Model<'static> {
    let mut model = new_empty_model();
    // Column A — numbers
    for (row, v) in [(1, 10), (2, 20), (3, 10), (4, 30), (5, 20), (6, 40)] {
        model.set_user_input(0, row, 1, v.to_string()).unwrap();
    }
    // Column B — strings
    for (row, v) in [(1, "rust"), (2, "go"), (3, "rust"), (4, "python")] {
        model.set_user_input(0, row, 2, v.to_string()).unwrap();
    }
    model.evaluate();
    model
}

fn duplicate_rule() -> CfRuleInput {
    CfRuleInput::DuplicateValues {
        format: super::red_fill(),
        stop_if_true: false,
    }
}

fn unique_rule() -> CfRuleInput {
    CfRuleInput::UniqueValues {
        format: super::red_fill(),
        stop_if_true: false,
    }
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
// DuplicateValues — numeric
// ---------------------------------------------------------------------------

#[test]
fn test_duplicate_values_highlights_repeated_numbers() {
    let mut model = model_with_mixed();
    model
        .add_conditional_formatting(0, "A1:A6", duplicate_rule())
        .unwrap();
    model.evaluate();

    // 10 appears in rows 1 and 3; 20 appears in rows 2 and 5
    for row in [1, 2, 3, 5] {
        assert!(
            is_red(&model, row, 1),
            "row {row} contains a duplicate value and should be highlighted"
        );
    }
    // 30 (row 4) and 40 (row 6) are unique
    for row in [4, 6] {
        assert!(
            !is_red(&model, row, 1),
            "row {row} contains a unique value and should not be highlighted"
        );
    }
}

#[test]
fn test_duplicate_values_highlights_repeated_strings() {
    let mut model = model_with_mixed();
    model
        .add_conditional_formatting(0, "B1:B4", duplicate_rule())
        .unwrap();
    model.evaluate();

    // "rust" appears in rows 1 and 3
    for row in [1, 3] {
        assert!(
            is_red(&model, row, 2),
            "row {row} (\"rust\") is a duplicate string and should be highlighted"
        );
    }
    // "go" (row 2) and "python" (row 4) are unique
    for row in [2, 4] {
        assert!(
            !is_red(&model, row, 2),
            "row {row} is a unique string and should not be highlighted"
        );
    }
}

#[test]
fn test_duplicate_values_all_unique_highlights_none() {
    let mut model = new_empty_model();
    for (row, v) in [(1, 10), (2, 20), (3, 30)] {
        model.set_user_input(0, row, 1, v.to_string()).unwrap();
    }
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1:A3", duplicate_rule())
        .unwrap();
    model.evaluate();

    for row in 1..=3 {
        assert!(
            !is_red(&model, row, 1),
            "row {row} is unique, should not be highlighted"
        );
    }
}

#[test]
fn test_duplicate_values_all_same_highlights_all() {
    let mut model = new_empty_model();
    for row in 1..=4 {
        model.set_user_input(0, row, 1, "42".to_string()).unwrap();
    }
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1:A4", duplicate_rule())
        .unwrap();
    model.evaluate();

    for row in 1..=4 {
        assert!(
            is_red(&model, row, 1),
            "row {row} shares value 42 with every other row and should be highlighted"
        );
    }
}

// ---------------------------------------------------------------------------
// UniqueValues — numeric
// ---------------------------------------------------------------------------

#[test]
fn test_unique_values_highlights_non_repeated_numbers() {
    let mut model = model_with_mixed();
    model
        .add_conditional_formatting(0, "A1:A6", unique_rule())
        .unwrap();
    model.evaluate();

    // 30 (row 4) and 40 (row 6) appear exactly once
    for row in [4, 6] {
        assert!(
            is_red(&model, row, 1),
            "row {row} contains a unique value and should be highlighted"
        );
    }
    // 10 and 20 are duplicated
    for row in [1, 2, 3, 5] {
        assert!(
            !is_red(&model, row, 1),
            "row {row} contains a duplicate value and should not be highlighted"
        );
    }
}

#[test]
fn test_unique_values_highlights_non_repeated_strings() {
    let mut model = model_with_mixed();
    model
        .add_conditional_formatting(0, "B1:B4", unique_rule())
        .unwrap();
    model.evaluate();

    // "go" (row 2) and "python" (row 4) each appear once
    for row in [2, 4] {
        assert!(
            is_red(&model, row, 2),
            "row {row} is a unique string and should be highlighted"
        );
    }
    // "rust" (rows 1, 3) is duplicated
    for row in [1, 3] {
        assert!(
            !is_red(&model, row, 2),
            "row {row} (\"rust\") is duplicated and should not be highlighted"
        );
    }
}

#[test]
fn test_unique_values_all_same_highlights_none() {
    let mut model = new_empty_model();
    for row in 1..=4 {
        model.set_user_input(0, row, 1, "7".to_string()).unwrap();
    }
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1:A4", unique_rule())
        .unwrap();
    model.evaluate();

    for row in 1..=4 {
        assert!(
            !is_red(&model, row, 1),
            "row {row} has no unique value when all cells share 7"
        );
    }
}

#[test]
fn test_unique_values_all_different_highlights_all() {
    let mut model = new_empty_model();
    for (row, v) in [(1, 10), (2, 20), (3, 30)] {
        model.set_user_input(0, row, 1, v.to_string()).unwrap();
    }
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1:A3", unique_rule())
        .unwrap();
    model.evaluate();

    for row in 1..=3 {
        assert!(
            is_red(&model, row, 1),
            "row {row} has a distinct value and should be highlighted"
        );
    }
}

// ---------------------------------------------------------------------------
// Duplicate and Unique are complementary within the same range
// ---------------------------------------------------------------------------

#[test]
fn test_duplicate_and_unique_are_mutually_exclusive() {
    // Every cell is either duplicated or unique, never both.
    let mut model = model_with_mixed();
    model
        .add_conditional_formatting(0, "A1:A6", duplicate_rule())
        .unwrap();
    model.evaluate();

    let mut model2 = model_with_mixed();
    model2
        .add_conditional_formatting(0, "A1:A6", unique_rule())
        .unwrap();
    model2.evaluate();

    for row in 1..=6 {
        let is_dup = is_red(&model, row, 1);
        let is_uniq = is_red(&model2, row, 1);
        assert!(
            is_dup ^ is_uniq,
            "row {row} should be exactly one of duplicate or unique, not both or neither"
        );
    }
}
