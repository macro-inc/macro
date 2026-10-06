#![allow(clippy::unwrap_used)]
use crate::types::Color;

use crate::{
    cf_types::{CfRuleInput, TextOperator},
    test::util::new_empty_model,
};

// Programming languages, chosen so that prefix / suffix / substring patterns
// all have clean, easy-to-verify matches:
//
//   row 1 → "Fortran"      starts with "For", ends with "tran"
//   row 2 → "Forth"        starts with "For"
//   row 3 → "TypeScript"   contains "Script", ends with "Script"
//   row 4 → "JavaScript"   contains "Script", ends with "Script"
//   row 5 → "Haskell"      unique prefix/suffix in the set
//   row 6 → "Erlang"       ends with "lang"  (E-r-l-a-n-g → last 4: "lang")
//   row 7 → "Prolog"       unique prefix/suffix in the set
const LANGS: [&str; 7] = [
    "Fortran",
    "Forth",
    "TypeScript",
    "JavaScript",
    "Haskell",
    "Erlang",
    "Prolog",
];

fn model_with_langs() -> crate::Model<'static> {
    let mut model = new_empty_model();
    for (i, &lang) in LANGS.iter().enumerate() {
        model
            .set_user_input(0, i as i32 + 1, 1, lang.to_string())
            .unwrap();
    }
    model.evaluate();
    model
}

fn text_rule(operator: TextOperator, value: &str) -> CfRuleInput {
    CfRuleInput::Text {
        operator,
        value: value.to_string(),
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
// Contains
// ---------------------------------------------------------------------------

#[test]
fn test_contains() {
    let mut model = model_with_langs();
    model
        .add_conditional_formatting(0, "A1:A7", text_rule(TextOperator::Contains, "Script"))
        .unwrap();
    model.evaluate();

    // TypeScript (3) and JavaScript (4) contain "Script"
    for row in [3, 4] {
        assert!(
            is_red(&model, row),
            "row {row} should match Contains 'Script'"
        );
    }
    for row in [1, 2, 5, 6, 7] {
        assert!(
            !is_red(&model, row),
            "row {row} should not match Contains 'Script'"
        );
    }
}

// ---------------------------------------------------------------------------
// DoesNotContain
// ---------------------------------------------------------------------------

#[test]
fn test_does_not_contain() {
    let mut model = model_with_langs();
    model
        .add_conditional_formatting(
            0,
            "A1:A7",
            text_rule(TextOperator::DoesNotContain, "Script"),
        )
        .unwrap();
    model.evaluate();

    // All except TypeScript (3) and JavaScript (4) do not contain "Script"
    for row in [1, 2, 5, 6, 7] {
        assert!(
            is_red(&model, row),
            "row {row} should match DoesNotContain 'Script'"
        );
    }
    for row in [3, 4] {
        assert!(
            !is_red(&model, row),
            "row {row} should not match DoesNotContain 'Script'"
        );
    }
}

// ---------------------------------------------------------------------------
// BeginsWith
// ---------------------------------------------------------------------------

#[test]
fn test_begins_with() {
    let mut model = model_with_langs();
    model
        .add_conditional_formatting(0, "A1:A7", text_rule(TextOperator::BeginsWith, "For"))
        .unwrap();
    model.evaluate();

    // Fortran (1) and Forth (2) begin with "For"
    for row in [1, 2] {
        assert!(
            is_red(&model, row),
            "row {row} should match BeginsWith 'For'"
        );
    }
    for row in [3, 4, 5, 6, 7] {
        assert!(
            !is_red(&model, row),
            "row {row} should not match BeginsWith 'For'"
        );
    }
}

// ---------------------------------------------------------------------------
// EndsWith
// ---------------------------------------------------------------------------

#[test]
fn test_ends_with() {
    let mut model = model_with_langs();
    model
        .add_conditional_formatting(0, "A1:A7", text_rule(TextOperator::EndsWith, "lang"))
        .unwrap();
    model.evaluate();

    // Only Erlang (6) ends with "lang"
    assert!(
        is_red(&model, 6),
        "row 6 (Erlang) should match EndsWith 'lang'"
    );
    for row in [1, 2, 3, 4, 5, 7] {
        assert!(
            !is_red(&model, row),
            "row {row} should not match EndsWith 'lang'"
        );
    }
}

// ---------------------------------------------------------------------------
// Equals (exact, case-insensitive)
// ---------------------------------------------------------------------------

#[test]
fn test_equals_exact_match() {
    let mut model = model_with_langs();
    model
        .add_conditional_formatting(0, "A1:A7", text_rule(TextOperator::Equals, "Haskell"))
        .unwrap();
    model.evaluate();

    // Only row 5 is exactly "Haskell"
    assert!(
        is_red(&model, 5),
        "row 5 (Haskell) should match Equals 'Haskell'"
    );
    for row in [1, 2, 3, 4, 6, 7] {
        assert!(
            !is_red(&model, row),
            "row {row} should not match Equals 'Haskell'"
        );
    }
}

#[test]
fn test_equals_case_insensitive() {
    let mut model = model_with_langs();
    // "haskell" (all lower-case) should still match "Haskell" (case-insensitive)
    model
        .add_conditional_formatting(0, "A1:A7", text_rule(TextOperator::Equals, "haskell"))
        .unwrap();
    model.evaluate();

    assert!(
        is_red(&model, 5),
        "row 5 (Haskell) should match case-insensitive Equals 'haskell'"
    );
    for row in [1, 2, 3, 4, 6, 7] {
        assert!(
            !is_red(&model, row),
            "row {row} should not match Equals 'haskell'"
        );
    }
}

#[test]
fn test_equals_no_partial_match() {
    let mut model = model_with_langs();
    // "Has" is a prefix of "Haskell" — Equals should NOT match it
    model
        .add_conditional_formatting(0, "A1:A7", text_rule(TextOperator::Equals, "Has"))
        .unwrap();
    model.evaluate();

    for row in 1..=7 {
        assert!(
            !is_red(&model, row),
            "row {row} should not match Equals 'Has' (partial prefix)"
        );
    }
}
