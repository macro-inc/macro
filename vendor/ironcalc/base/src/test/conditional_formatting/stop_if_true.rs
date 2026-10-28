#![allow(clippy::unwrap_used)]
use crate::types::Color;

use crate::{
    cf_types::{CfRule, CfRuleInput, Cfvo, ValueOperator},
    test::util::new_empty_model,
    types::{Dxf, Fill},
};

fn blue_fill() -> Dxf {
    Dxf {
        fill: Some(Fill {
            color: Color::Rgb("#0000FF".to_string()),
        }),
        font: None,
        border: None,
        num_fmt: None,
        alignment: None,
    }
}

fn data_bar_rule() -> CfRuleInput {
    CfRuleInput::DataBar {
        min: Some(Cfvo::Min),
        max: Some(Cfvo::Max),
        positive_color: Color::Rgb("#638EC6".to_string()),
        negative_color: Color::Rgb("#FF0000".to_string()),
        is_gradient: true,
        show_value: true,
    }
}

// ---------------------------------------------------------------------------
// Storage: the stop_if_true flag is round-tripped through add/list correctly.
// ---------------------------------------------------------------------------

#[test]
fn test_stop_if_true_stored_as_true() {
    let mut model = new_empty_model();
    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            CfRuleInput::CellIs {
                operator: ValueOperator::GreaterThan,
                formula: "0".to_string(),
                formula2: None,
                format: super::red_fill(),
                stop_if_true: true,
            },
        )
        .unwrap();
    let list = model.get_conditional_formatting_list(0).unwrap();
    assert!(matches!(
        list[0].cf_rule,
        CfRule::CellIs {
            stop_if_true: true,
            ..
        }
    ));
}

#[test]
fn test_stop_if_true_stored_as_false() {
    let mut model = new_empty_model();
    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            CfRuleInput::Formula {
                formula: "=A1>0".to_string(),
                format: super::red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    let list = model.get_conditional_formatting_list(0).unwrap();
    assert!(matches!(
        list[0].cf_rule,
        CfRule::Formula {
            stop_if_true: false,
            ..
        }
    ));
}

// ---------------------------------------------------------------------------
// Behavior: stop_if_true=true prevents lower-priority overlays from applying.
//
// Setup:
//   A1=1, A2=2, A3=3, A4=4, A5=5
//   Rule added first  → priority=1 (lower importance): DataBar
//   Rule added second → priority=2 (higher importance): CellIs > 3, blue fill, stop_if_true=true
//
// When stop_if_true is evaluated:
//   A4, A5 (value > 3): the higher-priority blue-fill rule matches and stops further
//       evaluation, so the DataBar from the lower-priority rule must NOT appear.
//   A1, A2, A3 (value ≤ 3): the stop rule does not match, so the DataBar applies normally.
//
// Expected cache behavior:
//   matched A4/A5 keep the blue fill and do not retain a DataBar entry;
//   unmatched A1/A2/A3 retain the DataBar as normal.
// ---------------------------------------------------------------------------

fn model_with_stop_if_true_over_data_bar() -> crate::Model<'static> {
    let mut model = new_empty_model();
    for i in 1i32..=5 {
        model.set_user_input(0, i, 1, i.to_string()).unwrap();
    }
    // Lower-importance rule (priority=1, added first): DataBar for the whole range.
    model
        .add_conditional_formatting(0, "A1:A5", data_bar_rule())
        .unwrap();
    // Higher-importance rule (priority=2, added second): blue fill for cells > 3, with
    // stop_if_true=true so the DataBar above must not appear on matched cells.
    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            CfRuleInput::CellIs {
                operator: ValueOperator::GreaterThan,
                formula: "3".to_string(),
                formula2: None,
                format: blue_fill(),
                stop_if_true: true,
            },
        )
        .unwrap();
    model.evaluate();
    model
}

#[test]
fn test_stop_if_true_matched_cell_has_no_data_bar() {
    let model = model_with_stop_if_true_over_data_bar();
    // A4=4 and A5=5 match the stop_if_true rule → DataBar must be suppressed.
    let style_a4 = model.get_extended_style_for_cell(0, 4, 1).unwrap();
    assert!(
        style_a4.data_bar.is_none(),
        "A4 matched stop_if_true rule: DataBar should be suppressed"
    );
    let style_a5 = model.get_extended_style_for_cell(0, 5, 1).unwrap();
    assert!(
        style_a5.data_bar.is_none(),
        "A5 matched stop_if_true rule: DataBar should be suppressed"
    );
}

#[test]
fn test_stop_if_true_matched_cell_gets_matching_rule_fill() {
    let model = model_with_stop_if_true_over_data_bar();
    let style_a4 = model.get_extended_style_for_cell(0, 4, 1).unwrap();
    assert_eq!(
        style_a4.style.fill.color,
        Color::Rgb("#0000FF".to_string()),
        "A4 should show the blue fill from the stop_if_true rule"
    );
}

#[test]
fn test_stop_if_true_unmatched_cell_still_gets_data_bar() {
    let model = model_with_stop_if_true_over_data_bar();
    // A1=1, A2=2, A3=3 do NOT match the stop_if_true rule → DataBar should still apply.
    for row in 1..=3 {
        let style = model.get_extended_style_for_cell(0, row, 1).unwrap();
        assert!(
            style.data_bar.is_some(),
            "A{row} did not match stop_if_true rule: DataBar should still show"
        );
    }
}

// ---------------------------------------------------------------------------
// Contrast: stop_if_true=false lets the DataBar co-exist with the Dxf fill.
// ---------------------------------------------------------------------------

#[test]
fn test_no_stop_if_true_matched_cell_has_both_fill_and_data_bar() {
    let mut model = new_empty_model();
    for i in 1i32..=5 {
        model.set_user_input(0, i, 1, i.to_string()).unwrap();
    }
    model
        .add_conditional_formatting(0, "A1:A5", data_bar_rule())
        .unwrap();
    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            CfRuleInput::CellIs {
                operator: ValueOperator::GreaterThan,
                formula: "3".to_string(),
                formula2: None,
                format: blue_fill(),
                stop_if_true: false, // no stop → DataBar from lower-priority rule still shows
            },
        )
        .unwrap();
    model.evaluate();

    let style_a4 = model.get_extended_style_for_cell(0, 4, 1).unwrap();
    assert_eq!(
        style_a4.style.fill.color,
        Color::Rgb("#0000FF".to_string()),
        "A4 should have the blue fill"
    );
    assert!(
        style_a4.data_bar.is_some(),
        "A4 should also show the DataBar since stop_if_true is false"
    );
}
