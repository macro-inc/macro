#![allow(clippy::unwrap_used)]

use crate::types::Color;
use crate::types::StyleIncludes;

use crate::test::user_model::util::new_empty_user_model;

#[test]
fn create_named_style() {
    let mut model = new_empty_user_model();
    let mut style = model.get_cell_style(0, 1, 1).unwrap();
    style.font.b = true;
    model
        .create_named_style("bold", &style, StyleIncludes::default())
        .unwrap();

    assert!(model.get_named_style_list().contains(&"bold".to_string()));
    assert!(model.get_named_style("bold").unwrap().font.b);

    // Duplicate name fails
    assert!(model
        .create_named_style("bold", &style, StyleIncludes::default())
        .is_err());
}

#[test]
fn create_named_style_undo_redo() {
    let mut model = new_empty_user_model();
    let mut style = model.get_cell_style(0, 1, 1).unwrap();
    style.font.b = true;
    model
        .create_named_style("bold", &style, StyleIncludes::default())
        .unwrap();
    assert!(model.get_named_style_list().contains(&"bold".to_string()));

    // Undo removes the named style
    model.undo().unwrap();
    assert!(!model.get_named_style_list().contains(&"bold".to_string()));

    // Redo restores it
    model.redo().unwrap();
    assert!(model.get_named_style_list().contains(&"bold".to_string()));
    assert!(model.get_named_style("bold").unwrap().font.b);
}

#[test]
fn delete_named_style() {
    let mut model = new_empty_user_model();
    let mut style = model.get_cell_style(0, 1, 1).unwrap();
    style.font.b = true;
    model
        .create_named_style("bold", &style, StyleIncludes::default())
        .unwrap();
    // Apply to a cell via the raw model API
    model.model.set_cell_style_by_name(0, 1, 1, "bold").unwrap();
    assert!(model.get_cell_style(0, 1, 1).unwrap().font.b);

    // Delete the named style
    model.delete_named_style("bold").unwrap();
    assert!(!model.get_named_style_list().contains(&"bold".to_string()));
    // Cell retains its formatting after the named style is deleted
    assert!(model.get_cell_style(0, 1, 1).unwrap().font.b);

    // Built-in "normal" cannot be deleted
    assert!(model.delete_named_style("normal").is_err());
    // Non-existent style fails
    assert!(model.delete_named_style("nonexistent").is_err());
}

#[test]
fn delete_named_style_undo_redo() {
    let mut model = new_empty_user_model();
    let mut style = model.get_cell_style(0, 1, 1).unwrap();
    style.font.b = true;
    model
        .create_named_style("bold", &style, StyleIncludes::default())
        .unwrap();
    model.delete_named_style("bold").unwrap();
    assert!(!model.get_named_style_list().contains(&"bold".to_string()));

    // Undo restores the named style
    model.undo().unwrap();
    assert!(model.get_named_style_list().contains(&"bold".to_string()));
    assert!(model.get_named_style("bold").unwrap().font.b);

    // Redo deletes it again
    model.redo().unwrap();
    assert!(!model.get_named_style_list().contains(&"bold".to_string()));
}

#[test]
fn update_named_style_updates_cells() {
    let mut model = new_empty_user_model();
    let mut style = model.get_cell_style(0, 1, 1).unwrap();
    style.font.b = true;
    model
        .create_named_style("bold", &style, StyleIncludes::default())
        .unwrap();

    // Apply the named style to A1 by setting the style directly
    model.model.set_cell_style_by_name(0, 1, 1, "bold").unwrap();
    model.model.set_cell_style_by_name(0, 2, 1, "bold").unwrap();

    // Update the style to also be italic
    let mut new_style = model.get_named_style("bold").unwrap();
    new_style.font.i = true;
    model
        .update_named_style("bold", "bold", &new_style, StyleIncludes::default())
        .unwrap();

    // Both cells should reflect the new formatting
    assert!(model.get_cell_style(0, 1, 1).unwrap().font.i);
    assert!(model.get_cell_style(0, 2, 1).unwrap().font.i);
    assert!(model.get_named_style("bold").unwrap().font.i);
}

#[test]
fn update_named_style_undo_redo() {
    let mut model = new_empty_user_model();
    let mut style = model.get_cell_style(0, 1, 1).unwrap();
    style.font.b = true;
    model
        .create_named_style("bold", &style, StyleIncludes::default())
        .unwrap();
    model.model.set_cell_style_by_name(0, 1, 1, "bold").unwrap();

    let mut new_style = model.get_named_style("bold").unwrap();
    new_style.font.i = true;
    model
        .update_named_style("bold", "bold", &new_style, StyleIncludes::default())
        .unwrap();

    assert!(model.get_cell_style(0, 1, 1).unwrap().font.i);

    // Undo: cell should lose the italic
    model.undo().unwrap();
    assert!(!model.get_cell_style(0, 1, 1).unwrap().font.i);
    assert!(!model.get_named_style("bold").unwrap().font.i);

    // Redo: cell gets italic back
    model.redo().unwrap();
    assert!(model.get_cell_style(0, 1, 1).unwrap().font.i);
    assert!(model.get_named_style("bold").unwrap().font.i);
}

#[test]
fn update_named_style_rename() {
    let mut model = new_empty_user_model();
    let mut style = model.get_cell_style(0, 1, 1).unwrap();
    style.font.b = true;
    model
        .create_named_style("bold", &style, StyleIncludes::default())
        .unwrap();

    // Rename without changing the style
    model
        .update_named_style("bold", "bold2", &style, StyleIncludes::default())
        .unwrap();
    assert!(!model.get_named_style_list().contains(&"bold".to_string()));
    assert!(model.get_named_style_list().contains(&"bold2".to_string()));

    // Undo restores original name
    model.undo().unwrap();
    assert!(model.get_named_style_list().contains(&"bold".to_string()));
    assert!(!model.get_named_style_list().contains(&"bold2".to_string()));

    // Redo renames again
    model.redo().unwrap();
    assert!(model.get_named_style_list().contains(&"bold2".to_string()));
}

#[test]
fn update_named_style_rejects_builtin() {
    let mut model = new_empty_user_model();
    let style = model.get_cell_style(0, 1, 1).unwrap();
    assert!(model
        .update_named_style("normal", "normal", &style, StyleIncludes::default())
        .is_err());
    assert!(model.delete_named_style("normal").is_err());
}

#[test]
fn apply_named_style_with_invalid_xf_id_errors() {
    // A malformed workbook can contain a cellStyles entry pointing at a
    // non-existent cellStyleXfs record. Applying it must surface that error,
    // not fall back to the builtin styles.
    let mut model = new_empty_user_model();
    model
        .model
        .workbook
        .styles
        .cell_styles
        .push(crate::types::CellStyles {
            name: "corrupt".to_string(),
            xf_id: 999,
            builtin_id: 0,
        });
    let err = model.on_apply_named_style("corrupt").unwrap_err();
    assert!(err.contains("invalid xf id"), "unexpected error: {err}");
    // Nothing was added or applied
    assert!(!model.get_cell_style(0, 1, 1).unwrap().font.b);
    assert!(!model.can_undo());
}

#[test]
fn apply_partial_named_style_honors_includes() {
    use crate::types::Style;
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "0.5").unwrap();
    // A1 is bold
    let mut bold = model.get_cell_style(0, 1, 1).unwrap();
    bold.font.b = true;
    model.model.set_cell_style(0, 1, 1, &bold).unwrap();

    // "my percent" includes only the number format
    let percent = Style {
        num_fmt: "0%".to_string(),
        ..Default::default()
    };
    let includes = StyleIncludes {
        number_format: true,
        font: false,
        fill: false,
        border: false,
        alignment: false,
        protection: false,
    };
    model
        .create_named_style("my percent", &percent, includes)
        .unwrap();

    // Apply to the default selection (A1)
    model.on_apply_named_style("my percent").unwrap();
    let a1 = model.get_cell_style(0, 1, 1).unwrap();
    assert_eq!(a1.num_fmt, "0%");
    assert!(a1.font.b, "excluded category must keep the cell's format");

    // Undo restores the previous format
    model.undo().unwrap();
    let a1 = model.get_cell_style(0, 1, 1).unwrap();
    assert_eq!(a1.num_fmt, "general");
    assert!(a1.font.b);

    // Redo merges again
    model.redo().unwrap();
    let a1 = model.get_cell_style(0, 1, 1).unwrap();
    assert_eq!(a1.num_fmt, "0%");
    assert!(a1.font.b);
}

#[test]
fn update_named_style_includes_undo_redo() {
    use crate::types::Style;
    let mut model = new_empty_user_model();
    let percent = Style {
        num_fmt: "0%".to_string(),
        ..Default::default()
    };
    let partial = StyleIncludes {
        number_format: true,
        font: false,
        fill: false,
        border: false,
        alignment: false,
        protection: false,
    };
    model.create_named_style("pct", &percent, partial).unwrap();

    // Update the includes to a full style
    model
        .update_named_style("pct", "pct", &percent, StyleIncludes::default())
        .unwrap();
    assert_eq!(
        model.get_named_style_includes("pct").unwrap(),
        StyleIncludes::default()
    );

    // Undo restores the partial includes
    model.undo().unwrap();
    assert_eq!(model.get_named_style_includes("pct").unwrap(), partial);

    // Redo makes it full again
    model.redo().unwrap();
    assert_eq!(
        model.get_named_style_includes("pct").unwrap(),
        StyleIncludes::default()
    );
}

#[test]
fn builtin_percent_keeps_cell_font() {
    // Excel's "Percent" includes only the number format: applying it must not
    // touch the cell's font.
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "0.5").unwrap();
    let mut bold = model.get_cell_style(0, 1, 1).unwrap();
    bold.font.b = true;
    model.model.set_cell_style(0, 1, 1, &bold).unwrap();

    model.on_apply_named_style("Percent").unwrap();
    let a1 = model.get_cell_style(0, 1, 1).unwrap();
    assert_eq!(a1.num_fmt, "0%");
    assert!(a1.font.b, "Percent must not touch the font");

    // The materialized record carries Excel's flags
    let styles = &model.model.workbook.styles;
    let xf_id = styles.get_xf_id_by_name("Percent").unwrap();
    let record = &styles.cell_style_xfs[xf_id as usize];
    assert!(record.apply_number_format);
    assert!(!record.apply_font);
    assert!(!record.apply_fill);
    assert!(!record.apply_border);
    assert!(!record.apply_alignment);
    assert!(!record.apply_protection);
}

#[test]
fn builtin_good_stamps_font_keeps_number_format() {
    // Excel's "Good" includes font and fill: applying it replaces the cell's
    // font but keeps the cell's number format.
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "0.5").unwrap();
    let mut style = model.get_cell_style(0, 1, 1).unwrap();
    style.font.b = true;
    style.num_fmt = "0.00".to_string();
    model.model.set_cell_style(0, 1, 1, &style).unwrap();

    model.on_apply_named_style("Good").unwrap();
    let a1 = model.get_cell_style(0, 1, 1).unwrap();
    assert_eq!(a1.num_fmt, "0.00", "number format is not part of Good");
    assert!(
        !a1.font.b,
        "the font IS part of Good and replaces the cell's"
    );
    assert_eq!(a1.font.color, Color::Rgb("#006100".to_string()));
    assert_eq!(a1.fill.color, Color::Rgb("#C6EFCE".to_string()));
}

#[test]
fn get_named_style_list_includes_default() {
    let model = new_empty_user_model();
    let list = model.get_named_style_list();
    // Default model has "normal"
    assert!(list.iter().any(|n| n.eq_ignore_ascii_case("normal")));
}

#[test]
fn apply_builtin_named_style_lazy_adds_to_model() {
    let mut model = new_empty_user_model();

    // Fresh model has only "normal" — no builtin styles pre-loaded
    let initial_list = model.get_named_style_list();
    assert_eq!(initial_list, vec!["normal".to_string()]);
    assert!(!initial_list.contains(&"Calculation".to_string()));

    // Apply the "Calculation" builtin to the default selection (A1)
    model.on_apply_named_style("Calculation").unwrap();

    // "Calculation" is now in the model, and nothing else was added
    let list = model.get_named_style_list();
    assert_eq!(list.len(), 2);
    assert!(list.contains(&"Calculation".to_string()));

    // The cell A1 carries the correct Calculation properties
    let style = model.get_cell_style(0, 1, 1).unwrap();
    assert!(style.font.b);
    assert_eq!(style.font.color, Color::Rgb("#FA7D00".to_string()));
    assert_eq!(style.fill.color, Color::Rgb("#F2F2F2".to_string()));

    // Applying again does not add a duplicate entry
    model.on_apply_named_style("Calculation").unwrap();
    assert_eq!(model.get_named_style_list().len(), 2);
}

#[test]
fn apply_and_update_named_style_full_undo_redo() {
    let mut model = new_empty_user_model();

    // 1. Write "Hola" in D9
    model.set_user_input(0, 9, 4, "Hola").unwrap();

    // 2. Create a new named style
    let mut style = model.get_cell_style(0, 9, 4).unwrap();
    style.font.b = true;
    model
        .create_named_style("greeting", &style, StyleIncludes::default())
        .unwrap();

    // 3. Apply it to D9
    model.set_selected_cell(9, 4).unwrap();
    model.set_selected_range(9, 4, 9, 4).unwrap();
    model.on_apply_named_style("greeting").unwrap();
    assert!(model.get_cell_style(0, 9, 4).unwrap().font.b);

    // 4. Update the style with a text color
    let red = Color::Rgb("#FF0000".to_string());
    let mut new_style = model.get_named_style("greeting").unwrap();
    new_style.font.color = red.clone();
    model
        .update_named_style("greeting", "greeting", &new_style, StyleIncludes::default())
        .unwrap();
    assert_eq!(model.get_cell_style(0, 9, 4).unwrap().font.color, red);

    // 5. Undo everything
    while model.can_undo() {
        model.undo().unwrap();
    }
    assert_eq!(model.get_cell_content(0, 9, 4).unwrap(), "");
    assert!(!model
        .get_named_style_list()
        .contains(&"greeting".to_string()));

    // 6. Redo everything
    while model.can_redo() {
        model.redo().unwrap();
    }

    // D9 must show the style as of step 4 (red text), not as of step 3
    assert_eq!(model.get_cell_content(0, 9, 4).unwrap(), "Hola");
    assert_eq!(model.get_named_style("greeting").unwrap().font.color, red);
    let d9 = model.get_cell_style(0, 9, 4).unwrap();
    assert!(d9.font.b);
    assert_eq!(d9.font.color, red);
}

#[test]
fn apply_builtin_named_style_undo_redo() {
    let mut model = new_empty_user_model();

    model.on_apply_named_style("Calculation").unwrap();
    assert!(model
        .get_named_style_list()
        .contains(&"Calculation".to_string()));
    assert!(model.get_cell_style(0, 1, 1).unwrap().font.b);

    // Undo removes both the style application and the lazy-added named style
    model.undo().unwrap();
    assert!(!model
        .get_named_style_list()
        .contains(&"Calculation".to_string()));
    assert!(!model.get_cell_style(0, 1, 1).unwrap().font.b);

    // Redo restores it
    model.redo().unwrap();
    assert!(model
        .get_named_style_list()
        .contains(&"Calculation".to_string()));
    assert!(model.get_cell_style(0, 1, 1).unwrap().font.b);
}
