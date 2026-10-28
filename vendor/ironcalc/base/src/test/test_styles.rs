#![allow(clippy::unwrap_used)]

use crate::types::StyleIncludes;

use crate::test::util::new_empty_model;

#[test]
fn test_model_set_cells_with_values_styles() {
    let mut model = new_empty_model();
    // Inputs
    model.set_user_input(0, 1, 1, "21".to_string()).unwrap(); // A1
    model.set_user_input(0, 2, 1, "42".to_string()).unwrap(); // A2

    let style_base = model.get_style_for_cell(0, 1, 1).unwrap();
    let mut style = style_base.clone();
    style.font.b = true;
    style.num_fmt = "#,##0.00".to_string();
    assert!(model.set_cell_style(0, 1, 1, &style).is_ok());

    let mut style = style_base;
    style.num_fmt = "#,##0.00".to_string();
    assert!(model.set_cell_style(0, 2, 1, &style).is_ok());
    let style = model.get_style_for_cell(0, 2, 1).unwrap();
    assert_eq!(style.num_fmt, "#,##0.00".to_string());
}

#[test]
fn test_create_named_style() {
    let mut model = new_empty_model();
    model._set("A1", "42");

    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    assert!(!style.font.b);

    style.font.b = true;
    let e = model
        .workbook
        .styles
        .create_named_style("bold", &style, StyleIncludes::default());
    assert!(e.is_ok());

    let e = model.set_cell_style_by_name(0, 1, 1, "bold");
    assert!(e.is_ok());

    let style = model.get_style_for_cell(0, 1, 1).unwrap();
    assert!(style.font.b);
}

#[test]
fn test_get_named_style_list() {
    let model = new_empty_model();
    let list = model.get_named_style_list();
    // Default model has one entry: "normal"
    assert_eq!(list, vec!["normal".to_string()]);
}

#[test]
fn test_get_named_style() {
    let mut model = new_empty_model();
    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    style.font.b = true;
    model
        .create_named_style("bold", &style, StyleIncludes::default())
        .unwrap();
    let retrieved = model.get_named_style("bold").unwrap();
    assert!(retrieved.font.b);
}

#[test]
fn test_create_named_style_via_model() {
    let mut model = new_empty_model();
    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    style.font.b = true;
    assert!(model
        .create_named_style("bold", &style, StyleIncludes::default())
        .is_ok());
    // Duplicate name fails
    assert!(model
        .create_named_style("bold", &style, StyleIncludes::default())
        .is_err());
    // Can apply the style to a cell
    model.set_cell_style_by_name(0, 1, 1, "bold").unwrap();
    assert!(model.get_style_for_cell(0, 1, 1).unwrap().font.b);
}

#[test]
fn test_delete_named_style() {
    let mut model = new_empty_model();
    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    style.font.b = true;
    model
        .create_named_style("bold", &style, StyleIncludes::default())
        .unwrap();
    // Apply it to a cell
    model.set_cell_style_by_name(0, 1, 1, "bold").unwrap();
    assert!(model.get_style_for_cell(0, 1, 1).unwrap().font.b);
    // Delete the named style
    assert!(model.delete_named_style("bold").is_ok());
    // Named style is gone
    assert!(model.get_named_style("bold").is_err());
    // Cell retains its formatting
    assert!(model.get_style_for_cell(0, 1, 1).unwrap().font.b);
    // Built-in "normal" cannot be deleted
    assert!(model.delete_named_style("normal").is_err());
    // Deleting a non-existent style fails
    assert!(model.delete_named_style("nonexistent").is_err());
}

#[test]
fn test_update_named_style_updates_cells() {
    let mut model = new_empty_model();
    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    style.font.b = true;
    model
        .create_named_style("bold", &style, StyleIncludes::default())
        .unwrap();
    // Apply to A1 and A2
    model.set_cell_style_by_name(0, 1, 1, "bold").unwrap();
    model.set_cell_style_by_name(0, 2, 1, "bold").unwrap();
    // Update the style to also be italic
    let mut new_style = model.get_named_style("bold").unwrap();
    new_style.font.i = true;
    model
        .update_named_style("bold", "bold", &new_style, StyleIncludes::default())
        .unwrap();
    // Both cells now have the updated style
    assert!(model.get_style_for_cell(0, 1, 1).unwrap().font.i);
    assert!(model.get_style_for_cell(0, 2, 1).unwrap().font.i);
    // The named style reflects the new formatting
    assert!(model.get_named_style("bold").unwrap().font.i);
}

#[test]
fn test_update_named_style_rename() {
    let mut model = new_empty_model();
    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    style.font.b = true;
    model
        .create_named_style("bold", &style, StyleIncludes::default())
        .unwrap();
    // Rename it
    model
        .update_named_style("bold", "bold2", &style, StyleIncludes::default())
        .unwrap();
    assert!(model.get_named_style("bold").is_err());
    assert!(model.get_named_style("bold2").is_ok());
}

#[test]
fn test_named_style_tables() {
    // Creating a named style adds one record to each of the three tables:
    // cell_style_xfs (the base record), cell_xfs (the plain representative
    // pointing at it) and cell_styles (the name).
    let mut model = new_empty_model();
    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    style.font.b = true;
    model
        .create_named_style("bold", &style, StyleIncludes::default())
        .unwrap();

    let styles = &model.workbook.styles;
    let cell_style = styles
        .cell_styles
        .iter()
        .find(|cs| cs.name == "bold")
        .unwrap();
    let xf_id = cell_style.xf_id;
    assert_eq!(xf_id, styles.cell_style_xfs.len() as i32 - 1);

    let representative = styles.get_style_index_by_name("bold").unwrap();
    let cell_xf = &styles.cell_xfs[representative as usize];
    assert_eq!(cell_xf.xf_id, xf_id);
    let style_xf = &styles.cell_style_xfs[xf_id as usize];
    assert_eq!(cell_xf.font_id, style_xf.font_id);
    assert!(styles.fonts[style_xf.font_id as usize].b);
}

#[test]
fn test_named_styles_with_same_format_are_independent() {
    let mut model = new_empty_model();
    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    style.font.b = true;
    model
        .create_named_style("bold1", &style, StyleIncludes::default())
        .unwrap();
    model
        .create_named_style("bold2", &style, StyleIncludes::default())
        .unwrap();

    // Each named style has its own base record even if the formatting is equal
    let xf_id1 = model.workbook.styles.get_xf_id_by_name("bold1").unwrap();
    let xf_id2 = model.workbook.styles.get_xf_id_by_name("bold2").unwrap();
    assert_ne!(xf_id1, xf_id2);

    model.set_cell_style_by_name(0, 1, 1, "bold1").unwrap();
    model.set_cell_style_by_name(0, 2, 1, "bold2").unwrap();

    // Updating one of them must not affect the other
    let mut new_style = style.clone();
    new_style.font.i = true;
    model
        .update_named_style("bold1", "bold1", &new_style, StyleIncludes::default())
        .unwrap();
    assert!(model.get_style_for_cell(0, 1, 1).unwrap().font.i);
    assert!(!model.get_style_for_cell(0, 2, 1).unwrap().font.i);
    assert!(!model.get_named_style("bold2").unwrap().font.i);
}

#[test]
fn test_update_named_style_leaves_anonymous_formatting_alone() {
    let mut model = new_empty_model();
    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    style.font.b = true;
    model
        .create_named_style("bold", &style, StyleIncludes::default())
        .unwrap();
    // A1 uses the named style; A2 has identical but anonymous formatting
    model.set_cell_style_by_name(0, 1, 1, "bold").unwrap();
    model.set_cell_style(0, 2, 1, &style).unwrap();

    let mut new_style = style.clone();
    new_style.font.i = true;
    model
        .update_named_style("bold", "bold", &new_style, StyleIncludes::default())
        .unwrap();

    assert!(model.get_style_for_cell(0, 1, 1).unwrap().font.i);
    assert!(!model.get_style_for_cell(0, 2, 1).unwrap().font.i);
}

#[test]
fn test_update_named_style_respects_cell_overrides() {
    use crate::types::Color;
    let mut model = new_empty_model();
    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    style.font.b = true;
    model
        .create_named_style("bold", &style, StyleIncludes::default())
        .unwrap();
    model.set_cell_style_by_name(0, 1, 1, "bold").unwrap();

    // Simulate an imported cell parented to "bold" with a local font override
    // (applyFont="1"), as Excel produces when a styled cell is tweaked.
    let representative = model
        .workbook
        .styles
        .get_style_index_by_name("bold")
        .unwrap();
    let mut cell_xf = model.workbook.styles.cell_xfs[representative as usize].clone();
    cell_xf.apply_font = true;
    cell_xf.font_id = 0; // the default (non-bold) font
    model.workbook.styles.cell_xfs.push(cell_xf);
    let override_index = model.workbook.styles.cell_xfs.len() as i32 - 1;
    model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_cell_style(2, 1, override_index)
        .unwrap();

    // Update the style: italic font and a yellow fill
    let mut new_style = model.get_named_style("bold").unwrap();
    new_style.font.i = true;
    new_style.fill.color = Color::Rgb("#FFFF00".to_string());
    model
        .update_named_style("bold", "bold", &new_style, StyleIncludes::default())
        .unwrap();

    // The plain cell picks up both changes
    let a1 = model.get_style_for_cell(0, 1, 1).unwrap();
    assert!(a1.font.i);
    assert_eq!(a1.fill.color, Color::Rgb("#FFFF00".to_string()));

    // The overriding cell keeps its own font but inherits the new fill
    let a2 = model.get_style_for_cell(0, 2, 1).unwrap();
    assert!(!a2.font.i);
    assert!(!a2.font.b);
    assert_eq!(a2.fill.color, Color::Rgb("#FFFF00".to_string()));
}

#[test]
fn test_apply_named_style_without_representative() {
    use crate::types::{CellStyleXfs, CellStyles};
    // Simulate an imported workbook where a named style is defined but applied
    // to no cell: there is no cell_xfs entry parented to it.
    let mut model = new_empty_model();
    let styles = &mut model.workbook.styles;
    styles.fonts.push(crate::types::Font {
        b: true,
        ..Default::default()
    });
    let font_id = styles.fonts.len() as i32 - 1;
    styles.cell_style_xfs.push(CellStyleXfs {
        font_id,
        ..Default::default()
    });
    let xf_id = styles.cell_style_xfs.len() as i32 - 1;
    styles.cell_styles.push(CellStyles {
        name: "imported bold".to_string(),
        xf_id,
        builtin_id: 0,
    });

    // No representative yet
    assert!(model
        .workbook
        .styles
        .get_style_index_by_name("imported bold")
        .is_err());
    // But the style can be read and applied; the representative is created on demand
    assert!(model.get_named_style("imported bold").unwrap().font.b);
    model
        .set_cell_style_by_name(0, 1, 1, "imported bold")
        .unwrap();
    assert!(model.get_style_for_cell(0, 1, 1).unwrap().font.b);
    let index = model
        .workbook
        .styles
        .get_style_index_by_name("imported bold")
        .unwrap();
    assert_eq!(model.workbook.styles.cell_xfs[index as usize].xf_id, xf_id);
}

#[test]
fn test_named_style_base_record_includes_all_categories() {
    // In cellStyleXfs the apply* flags mean "the style includes this formatting
    // category" and default to true.
    // IronCalc styles are full styles, so records we create or update must have
    // all flags true; false would export as applyX="0" and Excel would treat
    // the style as including nothing.
    fn assert_all_included(model: &crate::model::Model, name: &str) {
        let styles = &model.workbook.styles;
        let xf_id = styles.get_xf_id_by_name(name).unwrap();
        let record = &styles.cell_style_xfs[xf_id as usize];
        assert!(record.apply_number_format, "number format not included");
        assert!(record.apply_font, "font not included");
        assert!(record.apply_fill, "fill not included");
        assert!(record.apply_border, "border not included");
        assert!(record.apply_alignment, "alignment not included");
        assert!(record.apply_protection, "protection not included");
    }

    let mut model = new_empty_model();
    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    style.font.b = true;
    model
        .create_named_style("bold", &style, StyleIncludes::default())
        .unwrap();
    assert_all_included(&model, "bold");

    style.font.i = true;
    model
        .update_named_style("bold", "bold", &style, StyleIncludes::default())
        .unwrap();
    assert_all_included(&model, "bold");
}

#[test]
fn test_named_style_partial_includes() {
    // A style created with partial includes stores them on its cellStyleXfs record,
    // and updating the style preserves them.
    let mut model = new_empty_model();
    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    style.num_fmt = "0%".to_string();
    let includes = StyleIncludes {
        number_format: true,
        font: false,
        fill: false,
        border: false,
        alignment: false,
        protection: false,
    };
    model
        .create_named_style("my percent", &style, includes)
        .unwrap();

    let assert_includes = |model: &crate::model::Model| {
        let styles = &model.workbook.styles;
        let xf_id = styles.get_xf_id_by_name("my percent").unwrap();
        let record = &styles.cell_style_xfs[xf_id as usize];
        assert!(record.apply_number_format);
        assert!(!record.apply_font);
        assert!(!record.apply_fill);
        assert!(!record.apply_border);
        assert!(!record.apply_alignment);
        assert!(!record.apply_protection);
    };
    assert_includes(&model);

    // Updating the formatting with the same includes keeps them
    let mut new_style = model.get_named_style("my percent").unwrap();
    new_style.num_fmt = "0.00%".to_string();
    model
        .update_named_style("my percent", "my percent", &new_style, includes)
        .unwrap();
    assert_includes(&model);
}

#[test]
fn test_apply_partial_named_style_merges_with_cell_format() {
    use crate::types::Style;
    let mut model = new_empty_model();
    model._set("A1", "0.5");
    // A1 is bold
    let mut bold = model.get_style_for_cell(0, 1, 1).unwrap();
    bold.font.b = true;
    model.set_cell_style(0, 1, 1, &bold).unwrap();

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

    // Applying it stamps the number format but keeps the cell's font
    model.set_cell_style_by_name(0, 1, 1, "my percent").unwrap();
    let a1 = model.get_style_for_cell(0, 1, 1).unwrap();
    assert_eq!(a1.num_fmt, "0%");
    assert!(a1.font.b, "excluded category must keep the cell's format");

    // The cell is parented to the style; the font is marked as its own
    let index = model.get_cell_style_index(0, 1, 1).unwrap();
    let cell_xf = &model.workbook.styles.cell_xfs[index as usize];
    let xf_id = model
        .workbook
        .styles
        .get_xf_id_by_name("my percent")
        .unwrap();
    assert_eq!(cell_xf.xf_id, xf_id);
    assert!(cell_xf.apply_font);
    assert!(!cell_xf.apply_number_format);

    // A later update of the style reaches the cell's number format only
    let mut new_style = model.get_named_style("my percent").unwrap();
    new_style.num_fmt = "0.00%".to_string();
    new_style.font.i = true; // font is not included: must not reach the cell
    model
        .update_named_style("my percent", "my percent", &new_style, includes)
        .unwrap();
    let a1 = model.get_style_for_cell(0, 1, 1).unwrap();
    assert_eq!(a1.num_fmt, "0.00%");
    assert!(a1.font.b);
    assert!(!a1.font.i);
}

#[test]
fn test_apply_named_style_keeps_quote_prefix() {
    use crate::types::Style;
    let mut model = new_empty_model();
    // A quote-prefixed cell
    model.set_user_input(0, 1, 1, "'123".to_string()).unwrap();
    assert!(model.get_style_for_cell(0, 1, 1).unwrap().quote_prefix);

    let bold = Style {
        font: crate::types::Font {
            b: true,
            ..Default::default()
        },
        ..Default::default()
    };
    model
        .create_named_style("bold", &bold, StyleIncludes::default())
        .unwrap();
    model.set_cell_style_by_name(0, 1, 1, "bold").unwrap();

    let a1 = model.get_style_for_cell(0, 1, 1).unwrap();
    assert!(a1.font.b);
    assert!(
        a1.quote_prefix,
        "applying a named style must not remove the quote prefix"
    );
}

#[test]
fn test_update_named_style_changes_includes() {
    use crate::types::Style;
    let mut model = new_empty_model();
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
    assert_eq!(
        model.workbook.styles.get_style_includes("pct").unwrap(),
        partial
    );

    // Update to a full style with a bold font: includes become all-true
    let mut full_style = model.get_named_style("pct").unwrap();
    full_style.font.b = true;
    model
        .update_named_style("pct", "pct", &full_style, StyleIncludes::default())
        .unwrap();
    assert_eq!(
        model.workbook.styles.get_style_includes("pct").unwrap(),
        StyleIncludes::default()
    );

    // Applying the style now stamps the font too
    model._set("A1", "0.5");
    let mut italic = model.get_style_for_cell(0, 1, 1).unwrap();
    italic.font.i = true;
    model.set_cell_style(0, 1, 1, &italic).unwrap();
    model.set_cell_style_by_name(0, 1, 1, "pct").unwrap();
    let a1 = model.get_style_for_cell(0, 1, 1).unwrap();
    assert!(a1.font.b);
    assert!(!a1.font.i);

    // And back to number-format only: applying keeps the cell's font again
    model
        .update_named_style("pct", "pct", &full_style, partial)
        .unwrap();
    assert_eq!(
        model.workbook.styles.get_style_includes("pct").unwrap(),
        partial
    );
    model._set("B1", "0.5");
    let mut italic = model.get_style_for_cell(0, 1, 2).unwrap();
    italic.font.i = true;
    model.set_cell_style(0, 1, 2, &italic).unwrap();
    model.set_cell_style_by_name(0, 1, 2, "pct").unwrap();
    let b1 = model.get_style_for_cell(0, 1, 2).unwrap();
    assert_eq!(b1.num_fmt, "0%");
    assert!(
        b1.font.i,
        "font is no longer included: the cell keeps its own"
    );
    assert!(!b1.font.b);
}

#[test]
fn test_named_style_ignores_quote_prefix() {
    // A quote prefix marks a cell's own apostrophe-escaped content; it is not
    // a named-style category and must be normalized out on create.
    let mut model = new_empty_model();
    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    style.font.b = true;
    style.quote_prefix = true;
    model
        .create_named_style("bold", &style, StyleIncludes::default())
        .unwrap();
    assert!(!model.get_named_style("bold").unwrap().quote_prefix);
    // Applying the style to a cell does not add a quote prefix
    model.set_cell_style_by_name(0, 1, 1, "bold").unwrap();
    let cell_style = model.get_style_for_cell(0, 1, 1).unwrap();
    assert!(cell_style.font.b);
    assert!(!cell_style.quote_prefix);
}

#[test]
fn test_update_named_style_keeps_cell_quote_prefix() {
    // A cell parented to a named style can carry its own quote prefix (an
    // imported "'123" cell); updating the style must not clobber it.
    let mut model = new_empty_model();
    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    style.font.b = true;
    model
        .create_named_style("bold", &style, StyleIncludes::default())
        .unwrap();
    let representative = model
        .workbook
        .styles
        .get_style_index_by_name("bold")
        .unwrap();
    let mut cell_xf = model.workbook.styles.cell_xfs[representative as usize].clone();
    cell_xf.quote_prefix = true;
    model.workbook.styles.cell_xfs.push(cell_xf);
    let quoted_index = model.workbook.styles.cell_xfs.len() as i32 - 1;
    model
        .workbook
        .worksheet_mut(0)
        .unwrap()
        .set_cell_style(1, 1, quoted_index)
        .unwrap();

    let mut new_style = model.get_named_style("bold").unwrap();
    new_style.font.i = true;
    new_style.quote_prefix = true; // must be ignored
    model
        .update_named_style("bold", "bold", &new_style, StyleIncludes::default())
        .unwrap();

    // The quoted cell keeps its prefix and still picks up the new font
    let a1 = model.get_style_for_cell(0, 1, 1).unwrap();
    assert!(a1.quote_prefix);
    assert!(a1.font.i);
    // The named style itself carries no quote prefix
    assert!(!model.get_named_style("bold").unwrap().quote_prefix);
}

#[test]
fn test_update_named_style_rejects_builtin() {
    let mut model = new_empty_model();
    let style = model.get_style_for_cell(0, 1, 1).unwrap();
    assert!(model
        .update_named_style("normal", "normal", &style, StyleIncludes::default())
        .is_err());
    assert!(model.delete_named_style("normal").is_err());
}

#[test]
fn empty_models_have_two_fills() {
    let model = new_empty_model();
    assert_eq!(model.workbook.styles.fills.len(), 2);
}

#[test]
fn test_set_style_on_boolean_cell() {
    let mut model = new_empty_model();
    // Inputs
    model.set_user_input(0, 1, 1, "TRUE".to_string()).unwrap();

    let initial_style = model.get_style_for_cell(0, 1, 1).unwrap();
    let mut new_style = initial_style.clone();
    new_style.font.b = true;
    assert!(model.set_cell_style(0, 1, 1, &new_style).is_ok());

    let final_style = model.get_style_for_cell(0, 1, 1).unwrap();
    assert!(final_style.font.b);
}

#[test]
fn test_set_style_on_error_cell() {
    let mut model = new_empty_model();
    // Inputs
    model.set_user_input(0, 1, 1, "#CALC!".to_string()).unwrap();

    let initial_style = model.get_style_for_cell(0, 1, 1).unwrap();
    let mut new_style = initial_style.clone();
    new_style.font.b = true;
    assert!(model.set_cell_style(0, 1, 1, &new_style).is_ok());

    let final_style = model.get_style_for_cell(0, 1, 1).unwrap();
    assert!(final_style.font.b);
}

#[test]
fn test_set_style_on_formula_boolean_cell() {
    let mut model = new_empty_model();
    // Inputs
    model.set_user_input(0, 1, 1, "=TRUE".to_string()).unwrap();
    model.evaluate();

    let initial_style = model.get_style_for_cell(0, 1, 1).unwrap();
    let mut new_style = initial_style.clone();
    new_style.font.b = true;
    assert!(model.set_cell_style(0, 1, 1, &new_style).is_ok());

    let final_style = model.get_style_for_cell(0, 1, 1).unwrap();
    assert!(final_style.font.b);
}

#[test]
fn test_set_style_on_formula_number_cell() {
    let mut model = new_empty_model();
    // Inputs
    model.set_user_input(0, 1, 1, "=42".to_string()).unwrap();
    model.evaluate();

    let initial_style = model.get_style_for_cell(0, 1, 1).unwrap();
    let mut new_style = initial_style.clone();
    new_style.font.b = true;
    assert!(model.set_cell_style(0, 1, 1, &new_style).is_ok());

    let final_style = model.get_style_for_cell(0, 1, 1).unwrap();
    assert!(final_style.font.b);
}

#[test]
fn test_set_style_on_formula_string_cell() {
    let mut model = new_empty_model();
    // Inputs
    model.set_user_input(0, 1, 1, "foo".to_string()).unwrap(); // A1
    model.set_user_input(0, 2, 1, "=A1".to_string()).unwrap(); // A2
    model.evaluate();

    let initial_style = model.get_style_for_cell(0, 2, 1).unwrap();
    let mut new_style = initial_style.clone();
    new_style.font.b = true;
    assert!(model.set_cell_style(0, 2, 1, &new_style).is_ok());

    let final_style = model.get_style_for_cell(0, 2, 1).unwrap();
    assert!(final_style.font.b);
}

#[test]
fn test_set_style_on_formula_error_cell() {
    let mut model = new_empty_model();
    // Inputs
    model.set_user_input(0, 1, 1, "=foo".to_string()).unwrap();
    model.evaluate();

    let initial_style = model.get_style_for_cell(0, 1, 1).unwrap();
    let mut new_style = initial_style.clone();
    new_style.font.b = true;
    assert!(model.set_cell_style(0, 1, 1, &new_style).is_ok());

    let final_style = model.get_style_for_cell(0, 1, 1).unwrap();
    assert!(final_style.font.b);
}
