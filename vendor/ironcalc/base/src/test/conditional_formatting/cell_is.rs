#![allow(clippy::unwrap_used)]
use crate::types::Color;

use crate::{
    cf_types::{CfRuleInput, ValueOperator},
    test::util::new_empty_model,
};

// Desktop CPU core counts across generations (powers of two):
//   row 1 →  1  (Intel 4004, single-core)
//   row 2 →  2  (Intel Core Duo, first dual-core)
//   row 3 →  4  (Core 2 Quad)
//   row 4 →  8  (Ryzen 7 1700)
//   row 5 → 16  (Ryzen 9 3950X)
//   row 6 → 32  (Threadripper 2990WX)
//   row 7 → 64  (Threadripper 3990X)
const CORES: [i32; 7] = [1, 2, 4, 8, 16, 32, 64];

fn model_with_cores() -> crate::Model<'static> {
    let mut model = new_empty_model();
    for (i, &v) in CORES.iter().enumerate() {
        model
            .set_user_input(0, i as i32 + 1, 1, v.to_string())
            .unwrap();
    }
    model.evaluate();
    model
}

fn cell_is(operator: ValueOperator, formula: &str, formula2: Option<&str>) -> CfRuleInput {
    CfRuleInput::CellIs {
        operator,
        formula: formula.to_string(),
        formula2: formula2.map(|s| s.to_string()),
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
// Equal / NotEqual
// ---------------------------------------------------------------------------

#[test]
fn test_equal() {
    let mut model = model_with_cores();
    model
        .add_conditional_formatting(0, "A1:A7", cell_is(ValueOperator::Equal, "8", None))
        .unwrap();
    model.evaluate();

    assert!(is_red(&model, 4), "row 4 (8 cores) should match Equal 8");
    for row in [1, 2, 3, 5, 6, 7] {
        assert!(!is_red(&model, row), "row {row} should not match Equal 8");
    }
}

#[test]
fn test_not_equal() {
    let mut model = model_with_cores();
    model
        .add_conditional_formatting(0, "A1:A7", cell_is(ValueOperator::NotEqual, "8", None))
        .unwrap();
    model.evaluate();

    for row in [1, 2, 3, 5, 6, 7] {
        assert!(is_red(&model, row), "row {row} should match NotEqual 8");
    }
    assert!(
        !is_red(&model, 4),
        "row 4 (8 cores) should not match NotEqual 8"
    );
}

// ---------------------------------------------------------------------------
// GreaterThan / GreaterThanOrEqual
// ---------------------------------------------------------------------------

#[test]
fn test_greater_than() {
    let mut model = model_with_cores();
    model
        .add_conditional_formatting(0, "A1:A7", cell_is(ValueOperator::GreaterThan, "8", None))
        .unwrap();
    model.evaluate();

    // rows 5 (16), 6 (32), 7 (64) are > 8
    for row in [5, 6, 7] {
        assert!(is_red(&model, row), "row {row} should match GreaterThan 8");
    }
    for row in [1, 2, 3, 4] {
        assert!(
            !is_red(&model, row),
            "row {row} should not match GreaterThan 8"
        );
    }
}

#[test]
fn test_greater_than_or_equal() {
    let mut model = model_with_cores();
    model
        .add_conditional_formatting(
            0,
            "A1:A7",
            cell_is(ValueOperator::GreaterThanOrEqual, "8", None),
        )
        .unwrap();
    model.evaluate();

    // rows 4 (8), 5 (16), 6 (32), 7 (64) are >= 8
    for row in [4, 5, 6, 7] {
        assert!(
            is_red(&model, row),
            "row {row} should match GreaterThanOrEqual 8"
        );
    }
    for row in [1, 2, 3] {
        assert!(
            !is_red(&model, row),
            "row {row} should not match GreaterThanOrEqual 8"
        );
    }
}

// ---------------------------------------------------------------------------
// LessThan / LessThanOrEqual
// ---------------------------------------------------------------------------

#[test]
fn test_less_than() {
    let mut model = model_with_cores();
    model
        .add_conditional_formatting(0, "A1:A7", cell_is(ValueOperator::LessThan, "8", None))
        .unwrap();
    model.evaluate();

    // rows 1 (1), 2 (2), 3 (4) are < 8
    for row in [1, 2, 3] {
        assert!(is_red(&model, row), "row {row} should match LessThan 8");
    }
    for row in [4, 5, 6, 7] {
        assert!(
            !is_red(&model, row),
            "row {row} should not match LessThan 8"
        );
    }
}

#[test]
fn test_less_than_or_equal() {
    let mut model = model_with_cores();
    model
        .add_conditional_formatting(
            0,
            "A1:A7",
            cell_is(ValueOperator::LessThanOrEqual, "8", None),
        )
        .unwrap();
    model.evaluate();

    // rows 1 (1), 2 (2), 3 (4), 4 (8) are <= 8
    for row in [1, 2, 3, 4] {
        assert!(
            is_red(&model, row),
            "row {row} should match LessThanOrEqual 8"
        );
    }
    for row in [5, 6, 7] {
        assert!(
            !is_red(&model, row),
            "row {row} should not match LessThanOrEqual 8"
        );
    }
}

// ---------------------------------------------------------------------------
// Between / NotBetween
// ---------------------------------------------------------------------------

#[test]
fn test_between() {
    let mut model = model_with_cores();
    model
        .add_conditional_formatting(0, "A1:A7", cell_is(ValueOperator::Between, "4", Some("16")))
        .unwrap();
    model.evaluate();

    // rows 3 (4), 4 (8), 5 (16) are in [4, 16]
    for row in [3, 4, 5] {
        assert!(
            is_red(&model, row),
            "row {row} should match Between 4 and 16"
        );
    }
    for row in [1, 2, 6, 7] {
        assert!(
            !is_red(&model, row),
            "row {row} should not match Between 4 and 16"
        );
    }
}

#[test]
fn test_not_between() {
    let mut model = model_with_cores();
    model
        .add_conditional_formatting(
            0,
            "A1:A7",
            cell_is(ValueOperator::NotBetween, "4", Some("16")),
        )
        .unwrap();
    model.evaluate();

    // rows 1 (1), 2 (2), 6 (32), 7 (64) are outside [4, 16]
    for row in [1, 2, 6, 7] {
        assert!(
            is_red(&model, row),
            "row {row} should match NotBetween 4 and 16"
        );
    }
    for row in [3, 4, 5] {
        assert!(
            !is_red(&model, row),
            "row {row} should not match NotBetween 4 and 16"
        );
    }
}

#[test]
fn inverted_ranges() {
    let mut model = model_with_cores();
    model
        .add_conditional_formatting(0, "A7:A1", cell_is(ValueOperator::NotEqual, "8", None))
        .unwrap();
    model.evaluate();

    for row in [1, 2, 3, 5, 6, 7] {
        assert!(is_red(&model, row), "row {row} should match NotEqual 8");
    }
    assert!(
        !is_red(&model, 4),
        "row 4 (8 cores) should not match NotEqual 8"
    );
}
