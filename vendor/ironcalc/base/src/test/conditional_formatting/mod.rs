#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod average;
mod cell_is;
mod duplicates;
mod formula;
mod priority;
mod stop_if_true;
mod text;
mod time_period;
mod top_bottom;

use crate::{
    cf_types::{CfRule, CfRuleInput, Cfvo, ColorScaleThreshold, Icon, ValueOperator},
    test::util::new_empty_model,
    types::{Color, Dxf, Fill},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn model_with_values() -> crate::Model<'static> {
    let mut model = new_empty_model();
    for i in 1i32..=5 {
        model.set_user_input(0, i, 1, i.to_string()).unwrap();
    }
    model.evaluate();
    model
}

fn color_scale_rule() -> CfRuleInput {
    CfRuleInput::ColorScale {
        thresholds: vec![
            ColorScaleThreshold {
                cfvo: Cfvo::Min,
                color: Color::Rgb("#FF0000".to_string()),
            },
            ColorScaleThreshold {
                cfvo: Cfvo::Max,
                color: Color::Rgb("#00FF00".to_string()),
            },
        ],
    }
}

fn data_bar_rule() -> CfRuleInput {
    CfRuleInput::DataBar {
        min: Some(Cfvo::Min),
        max: Some(Cfvo::Max),
        positive_color: Color::Rgb("#0000FF".to_string()),
        negative_color: Color::Rgb("#FF0000".to_string()),
        is_gradient: true,
        show_value: true,
    }
}

fn cell_is_gt(threshold: &str) -> CfRuleInput {
    CfRuleInput::CellIs {
        operator: ValueOperator::GreaterThan,
        formula: threshold.to_string(),
        formula2: None,
        format: Dxf::default(),
        stop_if_true: false,
    }
}

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

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

#[test]
fn test_add_rule_appears_in_list() {
    let mut model = new_empty_model();
    model
        .add_conditional_formatting(0, "A1:A5", color_scale_rule())
        .unwrap();
    let list = model.get_conditional_formatting_list(0).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].range, "A1:A5");
    assert!(matches!(list[0].cf_rule, CfRule::ColorScale { .. }));
}

#[test]
fn test_add_multiple_rules() {
    let mut model = new_empty_model();
    model
        .add_conditional_formatting(0, "A1:A5", color_scale_rule())
        .unwrap();
    model
        .add_conditional_formatting(0, "B1:B10", data_bar_rule())
        .unwrap();
    let list = model.get_conditional_formatting_list(0).unwrap();
    assert_eq!(list.len(), 2);
    // The list is ordered by priority descending (highest priority number first),
    // so the last-added rule (B1:B10, priority 2) comes before A1:A5 (priority 1).
    assert_eq!(list[0].range, "B1:B10");
    assert_eq!(list[1].range, "A1:A5");
}

#[test]
fn test_add_invalid_sheet_errors() {
    let mut model = new_empty_model();
    assert!(model
        .add_conditional_formatting(99, "A1:A5", color_scale_rule())
        .is_err());
}

#[test]
fn test_add_invalid_range_errors() {
    let mut model = new_empty_model();
    assert!(model
        .add_conditional_formatting(0, "not_a_range", color_scale_rule())
        .is_err());
}

#[test]
fn test_add_assigns_increasing_priorities() {
    let mut model = new_empty_model();
    model
        .add_conditional_formatting(0, "A1:A5", color_scale_rule())
        .unwrap();
    model
        .add_conditional_formatting(0, "B1:B5", data_bar_rule())
        .unwrap();
    let list = model.get_conditional_formatting_list(0).unwrap();
    // The list is ordered by priority descending, so the last-added rule (with the
    // higher priority number) appears first.
    assert!(
        list[0].priority > list[1].priority,
        "last-added rule should appear first with the higher priority number"
    );
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

#[test]
fn test_delete_rule() {
    let mut model = new_empty_model();
    model
        .add_conditional_formatting(0, "A1:A5", color_scale_rule())
        .unwrap();
    model.delete_conditional_formatting(0, 0).unwrap();
    assert_eq!(model.get_conditional_formatting_list(0).unwrap().len(), 0);
}

#[test]
fn test_delete_first_of_two() {
    let mut model = new_empty_model();
    model
        .add_conditional_formatting(0, "A1:A5", color_scale_rule())
        .unwrap();
    model
        .add_conditional_formatting(0, "B1:B5", data_bar_rule())
        .unwrap();
    model.delete_conditional_formatting(0, 0).unwrap();
    let list = model.get_conditional_formatting_list(0).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].range, "B1:B5");
}

#[test]
fn test_delete_out_of_bounds_errors() {
    let mut model = new_empty_model();
    model
        .add_conditional_formatting(0, "A1:A5", color_scale_rule())
        .unwrap();
    assert!(model.delete_conditional_formatting(0, 5).is_err());
}

#[test]
fn test_delete_invalid_sheet_errors() {
    let mut model = new_empty_model();
    assert!(model.delete_conditional_formatting(99, 0).is_err());
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

#[test]
fn test_update_rule_type() {
    let mut model = new_empty_model();
    model
        .add_conditional_formatting(0, "A1:A5", color_scale_rule())
        .unwrap();
    model
        .update_conditional_formatting(0, 0, "A1:A5", data_bar_rule())
        .unwrap();
    let list = model.get_conditional_formatting_list(0).unwrap();
    assert_eq!(list.len(), 1);
    assert!(matches!(list[0].cf_rule, CfRule::DataBar { .. }));
}

#[test]
fn test_update_range() {
    let mut model = new_empty_model();
    model
        .add_conditional_formatting(0, "A1:A5", color_scale_rule())
        .unwrap();
    model
        .update_conditional_formatting(0, 0, "C1:C10", color_scale_rule())
        .unwrap();
    let list = model.get_conditional_formatting_list(0).unwrap();
    assert_eq!(list[0].range, "C1:C10");
}

#[test]
fn test_update_preserves_priority() {
    let mut model = new_empty_model();
    model
        .add_conditional_formatting(0, "A1:A5", color_scale_rule())
        .unwrap();
    let priority_before = model.get_conditional_formatting_list(0).unwrap()[0].priority;
    model
        .update_conditional_formatting(0, 0, "C1:C10", data_bar_rule())
        .unwrap();
    let priority_after = model.get_conditional_formatting_list(0).unwrap()[0].priority;
    assert_eq!(priority_before, priority_after);
}

#[test]
fn test_update_out_of_bounds_errors() {
    let mut model = new_empty_model();
    assert!(model
        .update_conditional_formatting(0, 99, "A1:A5", color_scale_rule())
        .is_err());
}

#[test]
fn test_update_invalid_range_errors() {
    let mut model = new_empty_model();
    model
        .add_conditional_formatting(0, "A1:A5", color_scale_rule())
        .unwrap();
    assert!(model
        .update_conditional_formatting(0, 0, "!!!!", color_scale_rule())
        .is_err());
}

// ---------------------------------------------------------------------------
// Effect on evaluated cell styles
// ---------------------------------------------------------------------------

#[test]
fn test_color_scale_applies_fill() {
    let mut model = model_with_values();
    model
        .add_conditional_formatting(0, "A1:A5", color_scale_rule())
        .unwrap();
    model.evaluate();

    let style_a1 = model.get_extended_style_for_cell(0, 1, 1).unwrap();
    let style_a5 = model.get_extended_style_for_cell(0, 5, 1).unwrap();
    assert_eq!(style_a1.style.fill.color, Color::Rgb("#FF0000".to_string()));
    assert_eq!(style_a5.style.fill.color, Color::Rgb("#00FF00".to_string()));
}

#[test]
fn test_data_bar_applies() {
    let mut model = model_with_values();
    model
        .add_conditional_formatting(0, "A1:A5", data_bar_rule())
        .unwrap();
    model.evaluate();

    let style_a1 = model.get_extended_style_for_cell(0, 1, 1).unwrap();
    let style_a5 = model.get_extended_style_for_cell(0, 5, 1).unwrap();
    assert_eq!(style_a1.data_bar.unwrap().value, 0.0);
    assert_eq!(style_a5.data_bar.unwrap().value, 1.0);
}

#[test]
fn test_delete_removes_applied_style() {
    let mut model = model_with_values();
    model
        .add_conditional_formatting(0, "A1:A5", color_scale_rule())
        .unwrap();
    model.evaluate();
    assert!(model
        .get_extended_style_for_cell(0, 1, 1)
        .unwrap()
        .style
        .fill
        .color
        .is_some());

    model.delete_conditional_formatting(0, 0).unwrap();
    model.evaluate();
    assert!(model
        .get_extended_style_for_cell(0, 1, 1)
        .unwrap()
        .style
        .fill
        .color
        .is_none());
}

#[test]
fn test_rule_only_applies_inside_range() {
    let mut model = model_with_values();
    model
        .add_conditional_formatting(0, "A1:A3", color_scale_rule())
        .unwrap();
    model.evaluate();
    // A4 is outside the range
    assert!(model
        .get_extended_style_for_cell(0, 4, 1)
        .unwrap()
        .style
        .fill
        .color
        .is_none());
}

#[test]
fn test_higher_priority_number_wins() {
    let mut model = model_with_values();
    // First rule added gets priority=1 (lower = less important): red→green scale.
    model
        .add_conditional_formatting(0, "A1:A5", color_scale_rule())
        .unwrap();
    // Second rule added gets priority=2 (higher = more important): blue→yellow scale.
    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            CfRuleInput::ColorScale {
                thresholds: vec![
                    ColorScaleThreshold {
                        cfvo: Cfvo::Min,
                        color: Color::Rgb("#0000FF".to_string()),
                    },
                    ColorScaleThreshold {
                        cfvo: Cfvo::Max,
                        color: Color::Rgb("#FFFF00".to_string()),
                    },
                ],
            },
        )
        .unwrap();
    model.evaluate();

    // A1 = min: the second rule (higher priority number) must win → blue.
    let style = model.get_extended_style_for_cell(0, 1, 1).unwrap();
    assert_eq!(style.style.fill.color, Color::Rgb("#0000FF".to_string()));
}

#[test]
fn test_cell_is_rule_stored_correctly() {
    let mut model = model_with_values();
    model
        .add_conditional_formatting(0, "A1:A5", cell_is_gt("3"))
        .unwrap();
    model.evaluate();

    let list = model.get_conditional_formatting_list(0).unwrap();
    assert!(matches!(
        list[0].cf_rule,
        CfRule::CellIs {
            operator: ValueOperator::GreaterThan,
            ..
        }
    ));
}

#[test]
fn test_get_list_empty_initially() {
    let model = new_empty_model();
    assert!(model.get_conditional_formatting_list(0).unwrap().is_empty());
}

#[test]
fn test_rules_on_different_sheets_are_independent() {
    let mut model = new_empty_model();
    model.new_sheet();
    model
        .add_conditional_formatting(0, "A1:A5", color_scale_rule())
        .unwrap();
    assert!(model.get_conditional_formatting_list(1).unwrap().is_empty());
    assert_eq!(model.get_conditional_formatting_list(0).unwrap().len(), 1);
}

// ---------------------------------------------------------------------------
// get_dxf_for_conditional_formatting
// ---------------------------------------------------------------------------

#[test]
fn test_cell_is_with_format_applies_fill() {
    let mut model = model_with_values();
    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            CfRuleInput::CellIs {
                operator: ValueOperator::GreaterThan,
                formula: "3".to_string(),
                formula2: None,
                format: red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    model.evaluate();

    // A4 = 4 > 3, should have red fill
    let style_a4 = model.get_extended_style_for_cell(0, 4, 1).unwrap();
    assert_eq!(style_a4.style.fill.color, Color::Rgb("#FF0000".to_string()));

    // A1 = 1, not > 3, no CF fill
    let style_a1 = model.get_extended_style_for_cell(0, 1, 1).unwrap();
    assert!(style_a1.style.fill.color.is_none());
}

#[test]
fn test_format_retrieved_via_get_dxf() {
    let mut model = new_empty_model();
    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            CfRuleInput::DuplicateValues {
                format: red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();

    let dxf = model
        .get_dxf_for_conditional_formatting(0, 0)
        .unwrap()
        .unwrap();
    let fill = dxf.fill.unwrap();
    assert_eq!(fill.color, Color::Rgb("#FF0000".to_string()));
}

#[test]
fn test_no_format_gives_none_from_get_dxf() {
    let mut model = new_empty_model();
    // ColorScale has no dxf_id — should return None
    model
        .add_conditional_formatting(0, "A1:A5", color_scale_rule())
        .unwrap();
    let dxf = model.get_dxf_for_conditional_formatting(0, 0).unwrap();
    assert!(dxf.is_none());
}

#[test]
fn test_get_dxf_out_of_bounds_errors() {
    let model = new_empty_model();
    assert!(model.get_dxf_for_conditional_formatting(0, 99).is_err());
}

// Regression: the `index` carried by each list entry must address the rule's
// storage slot, even after a priority swap reorders the list. Resolving the dxf
// through `view.index` must return the format of *that* rule, not of whatever
// rule happens to sit at the same position in the priority-sorted list.
#[test]
fn test_list_index_resolves_dxf_after_priority_swap() {
    let blue_fill = Dxf {
        fill: Some(Fill {
            color: Color::Rgb("#0000FF".to_string()),
        }),
        ..Dxf::default()
    };
    let mut model = new_empty_model();
    // Storage index 0: A1:A5 → red. Storage index 1: B1:B5 → blue.
    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            CfRuleInput::DuplicateValues {
                format: red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    model
        .add_conditional_formatting(
            0,
            "B1:B5",
            CfRuleInput::DuplicateValues {
                format: blue_fill,
                stop_if_true: false,
            },
        )
        .unwrap();

    // Raising the first rule swaps the two priorities but does NOT move them in
    // storage, so storage order and priority order now disagree.
    model.raise_conditional_formatting_priority(0, 0).unwrap();

    let list = model.get_conditional_formatting_list(0).unwrap();
    // Each entry's index must point back at its own rule: the dxf retrieved via
    // `index` must match the color expected for that entry's range.
    for view in &list {
        let expected = match view.range.as_str() {
            "A1:A5" => Color::Rgb("#FF0000".to_string()),
            "B1:B5" => Color::Rgb("#0000FF".to_string()),
            other => panic!("unexpected range {other}"),
        };
        let dxf = model
            .get_dxf_for_conditional_formatting(0, view.index)
            .unwrap()
            .unwrap();
        assert_eq!(
            dxf.fill.unwrap().color,
            expected,
            "index {} for range {} resolved to the wrong rule's dxf",
            view.index,
            view.range
        );
    }
}

// ---------------------------------------------------------------------------
// Formula-based CF evaluation (evaluate_formula)
// ---------------------------------------------------------------------------

/// CellIs threshold computed via SUM: B1:B3 = {1,2,3}, SUM = 6; cells > SUM(B1:B3)/2 = 3.
#[test]
fn test_cell_is_threshold_from_sum() {
    let mut model = new_empty_model();
    // A1:A5 = 1..5
    for i in 1i32..=5 {
        model.set_user_input(0, i, 1, i.to_string()).unwrap();
    }
    // B1:B3 = 1, 2, 3  →  SUM = 6  →  SUM/2 = 3
    for i in 1i32..=3 {
        model.set_user_input(0, i, 2, i.to_string()).unwrap();
    }
    model.evaluate();

    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            CfRuleInput::CellIs {
                operator: ValueOperator::GreaterThan,
                formula: "=SUM($B$1:$B$3)/2".to_string(),
                formula2: None,
                format: red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    model.evaluate();

    // A4=4 and A5=5 are > 3
    assert_eq!(
        model
            .get_extended_style_for_cell(0, 4, 1)
            .unwrap()
            .style
            .fill
            .color,
        Color::Rgb("#FF0000".to_string())
    );
    // A3=3 is not > 3
    assert!(model
        .get_extended_style_for_cell(0, 3, 1)
        .unwrap()
        .style
        .fill
        .color
        .is_none());
}

/// CellIs threshold using addition: B1+B2 where B1=1, B2=2 → threshold=3.
#[test]
fn test_cell_is_threshold_addition() {
    let mut model = new_empty_model();
    for i in 1i32..=5 {
        model.set_user_input(0, i, 1, i.to_string()).unwrap();
    }
    model.set_user_input(0, 1, 2, "1".to_string()).unwrap();
    model.set_user_input(0, 2, 2, "2".to_string()).unwrap();
    model.evaluate();

    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            CfRuleInput::CellIs {
                operator: ValueOperator::GreaterThan,
                formula: "=$B$1+$B$2".to_string(),
                formula2: None,
                format: red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    model.evaluate();

    // A4=4 and A5=5 are > 3
    assert_eq!(
        model
            .get_extended_style_for_cell(0, 4, 1)
            .unwrap()
            .style
            .fill
            .color,
        Color::Rgb("#FF0000".to_string())
    );
    // A3=3 is not > 3
    assert!(model
        .get_extended_style_for_cell(0, 3, 1)
        .unwrap()
        .style
        .fill
        .color
        .is_none());
}

// ---------------------------------------------------------------------------
// Blanks / NotBlanks
// ---------------------------------------------------------------------------

#[test]
fn test_blanks_applies_to_empty_cells() {
    let mut model = new_empty_model();
    // A1=1, A2=2, A3 empty, A4=4, A5 empty
    model.set_user_input(0, 1, 1, "1".to_string()).unwrap();
    model.set_user_input(0, 2, 1, "2".to_string()).unwrap();
    model.set_user_input(0, 4, 1, "4".to_string()).unwrap();
    model.evaluate();

    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            CfRuleInput::Blanks {
                format: red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    model.evaluate();

    // A3 and A5 are blank → styled
    assert_eq!(
        model
            .get_extended_style_for_cell(0, 3, 1)
            .unwrap()
            .style
            .fill
            .color,
        Color::Rgb("#FF0000".to_string())
    );
    assert_eq!(
        model
            .get_extended_style_for_cell(0, 5, 1)
            .unwrap()
            .style
            .fill
            .color,
        Color::Rgb("#FF0000".to_string())
    );
    // A1, A2, A4 are not blank → unstyled
    assert!(model
        .get_extended_style_for_cell(0, 1, 1)
        .unwrap()
        .style
        .fill
        .color
        .is_none());
    assert!(model
        .get_extended_style_for_cell(0, 2, 1)
        .unwrap()
        .style
        .fill
        .color
        .is_none());
    assert!(model
        .get_extended_style_for_cell(0, 4, 1)
        .unwrap()
        .style
        .fill
        .color
        .is_none());
}

#[test]
fn test_not_blanks_applies_to_non_empty_cells() {
    let mut model = new_empty_model();
    // A1=1, A2=2, A3 empty, A4=4, A5 empty
    model.set_user_input(0, 1, 1, "1".to_string()).unwrap();
    model.set_user_input(0, 2, 1, "2".to_string()).unwrap();
    model.set_user_input(0, 4, 1, "4".to_string()).unwrap();
    model.evaluate();

    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            CfRuleInput::NotBlanks {
                format: red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    model.evaluate();

    // A1, A2, A4 are not blank → styled
    assert_eq!(
        model
            .get_extended_style_for_cell(0, 1, 1)
            .unwrap()
            .style
            .fill
            .color,
        Color::Rgb("#FF0000".to_string())
    );
    assert_eq!(
        model
            .get_extended_style_for_cell(0, 2, 1)
            .unwrap()
            .style
            .fill
            .color,
        Color::Rgb("#FF0000".to_string())
    );
    assert_eq!(
        model
            .get_extended_style_for_cell(0, 4, 1)
            .unwrap()
            .style
            .fill
            .color,
        Color::Rgb("#FF0000".to_string())
    );
    // A3, A5 are blank → unstyled
    assert!(model
        .get_extended_style_for_cell(0, 3, 1)
        .unwrap()
        .style
        .fill
        .color
        .is_none());
    assert!(model
        .get_extended_style_for_cell(0, 5, 1)
        .unwrap()
        .style
        .fill
        .color
        .is_none());
}

// ---------------------------------------------------------------------------
// Errors / NoErrors
// ---------------------------------------------------------------------------

#[test]
fn test_errors_applies_to_error_cells() {
    let mut model = new_empty_model();
    // A1=1 (number), A2=1/0 (error), A3="hello" (string), A4 empty
    model.set_user_input(0, 1, 1, "1".to_string()).unwrap();
    model.set_user_input(0, 2, 1, "=1/0".to_string()).unwrap();
    model.set_user_input(0, 3, 1, "hello".to_string()).unwrap();
    model.evaluate();

    model
        .add_conditional_formatting(
            0,
            "A1:A4",
            CfRuleInput::Errors {
                format: red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    model.evaluate();

    // A2 is an error (#DIV/0!) → styled
    assert_eq!(
        model
            .get_extended_style_for_cell(0, 2, 1)
            .unwrap()
            .style
            .fill
            .color,
        Color::Rgb("#FF0000".to_string())
    );
    // A1 (number), A3 (string), A4 (blank) are not errors → unstyled
    assert!(model
        .get_extended_style_for_cell(0, 1, 1)
        .unwrap()
        .style
        .fill
        .color
        .is_none());
    assert!(model
        .get_extended_style_for_cell(0, 3, 1)
        .unwrap()
        .style
        .fill
        .color
        .is_none());
    assert!(model
        .get_extended_style_for_cell(0, 4, 1)
        .unwrap()
        .style
        .fill
        .color
        .is_none());
}

#[test]
fn test_no_errors_applies_to_non_error_cells() {
    let mut model = new_empty_model();
    // A1=1 (number), A2=1/0 (error), A3="hello" (string)
    model.set_user_input(0, 1, 1, "1".to_string()).unwrap();
    model.set_user_input(0, 2, 1, "=1/0".to_string()).unwrap();
    model.set_user_input(0, 3, 1, "hello".to_string()).unwrap();
    model.evaluate();

    model
        .add_conditional_formatting(
            0,
            "A1:A3",
            CfRuleInput::NoErrors {
                format: red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();
    model.evaluate();

    // A1 (number) and A3 (string) are not errors → styled
    assert_eq!(
        model
            .get_extended_style_for_cell(0, 1, 1)
            .unwrap()
            .style
            .fill
            .color,
        Color::Rgb("#FF0000".to_string())
    );
    assert_eq!(
        model
            .get_extended_style_for_cell(0, 3, 1)
            .unwrap()
            .style
            .fill
            .color,
        Color::Rgb("#FF0000".to_string())
    );
    // A2 is an error → unstyled
    assert!(model
        .get_extended_style_for_cell(0, 2, 1)
        .unwrap()
        .style
        .fill
        .color
        .is_none());
}

/// ColorScale with Formula cfvo using SUM: min=SUM(B1:B2)=1, max=SUM(B3:B4)=5.
#[test]
fn test_color_scale_formula_cfvo_with_sum() {
    let mut model = new_empty_model();
    for i in 1i32..=5 {
        model.set_user_input(0, i, 1, i.to_string()).unwrap();
    }
    // SUM(B1:B2) = 0+1 = 1  (min),  SUM(B3:B5) = 2+3+0 = 5 but let's keep it simple:
    // B1=1, B2=0 → SUM(B1:B2)=1;  B3=2, B4=3 → SUM(B3:B4)=5
    model.set_user_input(0, 1, 2, "1".to_string()).unwrap();
    model.set_user_input(0, 2, 2, "0".to_string()).unwrap();
    model.set_user_input(0, 3, 2, "2".to_string()).unwrap();
    model.set_user_input(0, 4, 2, "3".to_string()).unwrap();
    model.evaluate();

    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            CfRuleInput::ColorScale {
                thresholds: vec![
                    ColorScaleThreshold {
                        cfvo: Cfvo::Formula("=SUM($B$1:$B$2)".to_string()),
                        color: Color::Rgb("#FF0000".to_string()),
                    },
                    ColorScaleThreshold {
                        cfvo: Cfvo::Formula("=SUM($B$3:$B$4)".to_string()),
                        color: Color::Rgb("#00FF00".to_string()),
                    },
                ],
            },
        )
        .unwrap();
    model.evaluate();

    // A1=1 is at the minimum (SUM=1) → red
    assert_eq!(
        model
            .get_extended_style_for_cell(0, 1, 1)
            .unwrap()
            .style
            .fill
            .color,
        Color::Rgb("#FF0000".to_string())
    );
    // A5=5 is at the maximum (SUM=5) → green
    assert_eq!(
        model
            .get_extended_style_for_cell(0, 5, 1)
            .unwrap()
            .style
            .fill
            .color,
        Color::Rgb("#00FF00".to_string())
    );
}

// ---------------------------------------------------------------------------
// IconRating count
// ---------------------------------------------------------------------------

/// A 3-star rating over A1:A5 = {1,2,3,4,5}.
/// Thresholds (lowest-first): Percent(0)=1.0, Percent(33)≈2.32, Percent(67)≈3.68.
/// Expected filled-star counts: 1→1, 2→1, 3→2, 4→2, 5→3.
#[test]
fn test_icon_rating_count() {
    let mut model = model_with_values();
    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            CfRuleInput::IconRating {
                icon: Icon::Star,
                color: Color::Rgb("#FFD700".to_string()),
                // stored lowest-first: 0% → 33% → 67%
                thresholds: vec![
                    (Cfvo::Percent(0.0), true),
                    (Cfvo::Percent(33.0), true),
                    (Cfvo::Percent(67.0), true),
                ],
                show_value: true,
            },
        )
        .unwrap();
    model.evaluate();

    let rating = |row: i32| {
        model
            .get_extended_style_for_cell(0, row, 1)
            .unwrap()
            .rating
            .expect("rating should be present")
    };

    // max must equal the number of thresholds (3), not thresholds+1.
    assert_eq!(rating(1).max, 3);

    // A1=1 and A2=2 are below the 33 % threshold → 1 filled star.
    assert_eq!(rating(1).count, 1, "A1 (value=1) should have 1 star");
    assert_eq!(rating(2).count, 1, "A2 (value=2) should have 1 star");

    // A3=3 is above the 33 % boundary (2.32) but below the 67 % one (3.68) → 2 stars.
    assert_eq!(rating(3).count, 2, "A3 (value=3) should have 2 stars");
    // A4=4 is above the 67 % boundary (3.68) → 3 stars.
    assert_eq!(rating(4).count, 3, "A4 (value=4) should have 3 stars");

    // A5=5 (max) is above all thresholds → 3 filled stars.
    assert_eq!(rating(5).count, 3, "A5 (value=5) should have 3 stars");
}
