#![allow(clippy::unwrap_used)]

use crate::cf_types::{CfRuleInput, ValueOperator};
use crate::test::user_model::util::new_empty_user_model;
use crate::types::{Color, Dxf, Fill};

fn red_fill() -> Dxf {
    Dxf {
        font: None,
        fill: Some(Fill {
            color: Color::Rgb("#FF0000".to_string()),
        }),
        border: None,
        num_fmt: None,
        alignment: None,
    }
}

#[test]
fn duplicate_basic_selects_copy() {
    let mut model = new_empty_user_model();
    model.duplicate_sheet(0).unwrap();

    let properties = model.get_worksheets_properties();
    assert_eq!(properties.len(), 2);
    assert_eq!(properties[0].name, "Sheet1");
    assert_eq!(properties[1].name, "Sheet1 (1)");
    // The copy is placed right after the source and gets selected.
    assert_eq!(model.get_selected_sheet(), 1);
}

#[test]
fn duplicate_copies_formulas() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "10").unwrap();
    model.set_user_input(0, 1, 2, "=A1*2").unwrap();

    model.duplicate_sheet(0).unwrap();

    // The implicit self-reference is preserved and points to the copy.
    assert_eq!(model.get_cell_content(1, 1, 2).unwrap(), "=A1*2");
    assert_eq!(model.get_formatted_cell_value(1, 1, 2).unwrap(), "20");

    // The copy is independent of the original.
    model.set_user_input(1, 1, 1, "100").unwrap();
    assert_eq!(model.get_formatted_cell_value(1, 1, 2).unwrap(), "200");
    assert_eq!(model.get_formatted_cell_value(0, 1, 2).unwrap(), "20");
}

#[test]
fn duplicate_keeps_cross_sheet_and_retargets_self() {
    let mut model = new_empty_user_model();
    model.new_sheet().unwrap();
    model.rename_sheet(1, "Other").unwrap();
    model.set_user_input(1, 1, 1, "7").unwrap();

    // A reference to another sheet and an explicit self-reference.
    model.set_user_input(0, 1, 1, "=Other!A1").unwrap();
    model.set_user_input(0, 2, 1, "42").unwrap();
    model.set_user_input(0, 1, 2, "=Sheet1!A2").unwrap();

    model.duplicate_sheet(0).unwrap();
    // The copy is inserted at index 1, pushing "Other" to index 2.
    let copy = 1;

    // Cross-sheet reference unchanged.
    assert_eq!(model.get_cell_content(copy, 1, 1).unwrap(), "=Other!A1");
    assert_eq!(model.get_formatted_cell_value(copy, 1, 1).unwrap(), "7");

    // Explicit self-reference retargeted to the copy.
    assert_eq!(
        model.get_cell_content(copy, 1, 2).unwrap(),
        "='Sheet1 (1)'!A2"
    );
    assert_eq!(model.get_formatted_cell_value(copy, 1, 2).unwrap(), "42");
}

#[test]
fn duplicate_handles_defined_names() {
    let mut model = new_empty_user_model();
    model.new_sheet().unwrap();
    model.rename_sheet(1, "Other").unwrap();
    model.set_user_input(0, 1, 1, "5").unwrap();

    model
        .new_defined_name("local_name", Some(0), "Sheet1!$A$1")
        .unwrap();
    model
        .new_defined_name("from_source", None, "Sheet1!$A$1")
        .unwrap();
    model
        .new_defined_name("from_other", None, "Other!$A$1")
        .unwrap();

    model.duplicate_sheet(0).unwrap();
    let copy = 1;
    let names = model.get_defined_name_list();

    // Local name duplicated as local-to-copy and retargeted.
    assert!(names
        .iter()
        .any(|(n, s, f)| n == "local_name" && *s == Some(copy) && f == "'Sheet1 (1)'!$A$1"));
    // Original local name preserved.
    assert!(names
        .iter()
        .any(|(n, s, f)| n == "local_name" && *s == Some(0) && f == "Sheet1!$A$1"));

    // Global name referencing the source becomes a local name on the copy.
    assert!(names
        .iter()
        .any(|(n, s, f)| n == "from_source" && *s == Some(copy) && f == "'Sheet1 (1)'!$A$1"));
    // Original global preserved.
    assert!(names
        .iter()
        .any(|(n, s, _)| n == "from_source" && s.is_none()));

    // Global name not referencing the source is NOT duplicated onto the copy.
    assert!(!names
        .iter()
        .any(|(n, s, _)| n == "from_other" && *s == Some(copy)));
}

#[test]
fn duplicate_copies_conditional_formatting() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "10").unwrap();
    model
        .add_conditional_formatting(
            0,
            "A1:A10",
            CfRuleInput::CellIs {
                operator: ValueOperator::GreaterThan,
                formula: "5".to_string(),
                formula2: None,
                format: red_fill(),
                stop_if_true: false,
            },
        )
        .unwrap();

    model.duplicate_sheet(0).unwrap();

    let source_rules = model.get_conditional_formatting_list(0).unwrap();
    let copy_rules = model.get_conditional_formatting_list(1).unwrap();
    assert_eq!(copy_rules.len(), 1);
    assert_eq!(copy_rules[0].range, "A1:A10");
    assert_eq!(copy_rules[0].cf_rule, source_rules[0].cf_rule);
}

#[test]
fn duplicate_copies_tab_color() {
    let mut model = new_empty_user_model();
    let color = Color::Rgb("#123456".to_string());
    model.set_sheet_color(0, &color).unwrap();

    model.duplicate_sheet(0).unwrap();
    assert_eq!(model.get_worksheets_properties()[1].color, color);
}

#[test]
fn duplicate_undo_redo() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "10").unwrap();
    model.set_user_input(0, 1, 2, "=A1*2").unwrap();
    model
        .new_defined_name("local_name", Some(0), "Sheet1!$A$1")
        .unwrap();
    model
        .new_defined_name("from_source", None, "Sheet1!$A$1")
        .unwrap();

    let names_before = model.get_defined_name_list().len();

    model.duplicate_sheet(0).unwrap();
    assert_eq!(model.get_worksheets_properties().len(), 2);
    // Two new local names (the duplicated local + the made-local global).
    assert_eq!(model.get_defined_name_list().len(), names_before + 2);

    // Undo removes the copy and the defined names it created.
    model.undo().unwrap();
    assert_eq!(model.get_worksheets_properties().len(), 1);
    assert_eq!(model.get_defined_name_list().len(), names_before);
    assert_eq!(model.get_selected_sheet(), 0);

    // Redo recreates the copy identically.
    model.redo().unwrap();
    assert_eq!(model.get_worksheets_properties().len(), 2);
    assert_eq!(model.get_defined_name_list().len(), names_before + 2);
    assert_eq!(model.get_selected_sheet(), 1);
    assert_eq!(model.get_cell_content(1, 1, 2).unwrap(), "=A1*2");
    assert_eq!(model.get_formatted_cell_value(1, 1, 2).unwrap(), "20");
}

#[test]
fn duplicate_propagates() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "10").unwrap();
    model.set_user_input(0, 1, 2, "=A1*2").unwrap();
    model.duplicate_sheet(0).unwrap();

    let send_queue = model.flush_send_queue();

    let mut model2 = new_empty_user_model();
    model2.set_user_input(0, 1, 1, "10").unwrap();
    model2.set_user_input(0, 1, 2, "=A1*2").unwrap();
    model2.flush_send_queue();
    model2.apply_external_diffs(&send_queue).unwrap();

    let properties = model2.get_worksheets_properties();
    assert_eq!(properties.len(), 2);
    assert_eq!(properties[1].name, "Sheet1 (1)");
    assert_eq!(model2.get_formatted_cell_value(1, 1, 2).unwrap(), "20");
}

#[test]
fn duplicate_naming_sequence() {
    let mut model = new_empty_user_model();
    model.duplicate_sheet(0).unwrap();
    model.duplicate_sheet(0).unwrap();
    // Each copy is inserted right after the source, so the second copy sits
    // between the source and the first copy.
    let names: Vec<String> = model
        .get_worksheets_properties()
        .iter()
        .map(|p| p.name.clone())
        .collect();
    assert_eq!(names, vec!["Sheet1", "Sheet1 (2)", "Sheet1 (1)"]);

    // Out of range fails.
    assert!(model.duplicate_sheet(50).is_err());
}
