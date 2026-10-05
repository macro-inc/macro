#![allow(clippy::unwrap_used)]
use crate::types::Color;
use crate::{expressions::types::Area, test::user_model::util::new_empty_user_model};

#[test]
fn undo_redo_dynamic_array() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 2, "10").unwrap();
    model.set_user_input(0, 2, 2, "20").unwrap();
    model.set_user_input(0, 3, 2, "30").unwrap();

    // Dynamic formula in A1 that returns a 5×1 array
    model.set_user_input(0, 1, 1, "=B1:B5").unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 1, 1),
        Ok("10".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 1),
        Ok("20".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 3, 1),
        Ok("30".to_string())
    );

    model.set_user_input(0, 3, 1, "Bong!").unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 1, 1),
        Ok("#SPILL!".to_string())
    );

    // Undo the spill-blocking entry so the dynamic array can spill again
    model.undo().unwrap();
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 1),
        Ok("10".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 1),
        Ok("20".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 3, 1),
        Ok("30".to_string())
    );

    // Redo the blocking entry
    model.redo().unwrap();
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 1),
        Ok("#SPILL!".to_string())
    );
}

#[test]
fn undo_redo_dynamic_array_with_cse() {
    let mut model = new_empty_user_model();
    // B1
    model.set_user_input(0, 1, 2, "10").unwrap();
    // B2
    model.set_user_input(0, 2, 2, "20").unwrap();
    // B3
    model.set_user_input(0, 3, 2, "30").unwrap();

    // Dynamic formula in A1 that returns a dynamic array
    model.set_user_input(0, 1, 1, "=B1:B5").unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 1, 1),
        Ok("10".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 1),
        Ok("20".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 3, 1),
        Ok("30".to_string())
    );

    // value in A3 causes SPILL! (CSE range A3:E3, anchor overlaps dynamic spill)
    model.set_user_array_formula(0, 3, 1, 5, 1, "=123").unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 1, 1),
        Ok("#SPILL!".to_string())
    );

    // Undo the CSE entry
    model.undo().unwrap();
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 1),
        Ok("10".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 1),
        Ok("20".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 3, 1),
        Ok("30".to_string())
    );

    // Redo the CSE entry
    model.redo().unwrap();
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 1),
        Ok("#SPILL!".to_string())
    );
}

#[test]
fn spill_array_dynamic() {
    let mut model = new_empty_user_model();
    // A13
    model.set_user_input(0, 13, 1, "10").unwrap();
    // A14
    model.set_user_input(0, 14, 1, "20").unwrap();
    // A15
    model.set_user_input(0, 15, 1, "30").unwrap();
    // A16
    model.set_user_input(0, 16, 1, "40").unwrap();

    // Dynamic array formula in D13
    model.set_user_input(0, 13, 4, "=A13:A16").unwrap();

    // Array formula is C15:G15 — D15 is in D13's spill range
    model
        .set_user_array_formula(0, 15, 3, 5, 1, "=123")
        .unwrap();

    // The dynamic array in D13 should show #SPILL! because D15 (part of C15:G15) is in the spill range
    assert_eq!(
        model.get_formatted_cell_value(0, 13, 4),
        Ok("#SPILL!".to_string())
    );
}

#[test]
fn array_in_spill_formula() {
    let mut model = new_empty_user_model();
    // A13
    model.set_user_input(0, 13, 1, "10").unwrap();
    // A14
    model.set_user_input(0, 14, 1, "20").unwrap();
    // A15
    model.set_user_input(0, 15, 1, "30").unwrap();
    // A16
    model.set_user_input(0, 16, 1, "40").unwrap();

    model.set_user_input(0, 13, 4, "=A13:A16").unwrap();

    // an array formula with anchor in the spill range of the dynamic array formula
    model
        .set_user_array_formula(0, 15, 4, 1, 5, "=123")
        .unwrap();

    // The dynamic array in D13 should now spill into E13, F13, G13 and show #SPILL! error because of the array formula in D15:D19
    assert_eq!(
        model.get_formatted_cell_value(0, 13, 4),
        Ok("#SPILL!".to_string())
    );
}

// Regression test for: CSE (Ctrl+Shift+Enter) on a cell with an existing spill does not clean up spilled cells
// Steps: enter =SEQUENCE(6) in H3 (spills H4:H8) → press CSE on H3 to make it a 1×1 array formula
//        → H4:H8 should be cleared, not left showing stale spill values
#[test]
fn cse_on_dynamic_array_clears_old_spill() {
    let mut model = new_empty_user_model();

    // =SEQUENCE(6) in H3 (sheet 0, row 3, column 8) spills values 1-6 into H3:H8
    model.set_user_input(0, 3, 8, "=SEQUENCE(6)").unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 3, 8), Ok("1".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 4, 8), Ok("2".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 8, 8), Ok("6".to_string()));

    // Ctrl+Shift+Enter on H3: creates a 1×1 array formula from the same formula text.
    // This should replace the dynamic spill with a bounded array formula and clear H4:H8.
    model
        .set_user_array_formula(0, 3, 8, 1, 1, "=SEQUENCE(6)")
        .unwrap();

    // H3 is now a CSE formula — it evaluates to the first element (1)
    assert_eq!(model.get_formatted_cell_value(0, 3, 8), Ok("1".to_string()));

    // H4:H8 must be empty — the old spill must have been cleared
    assert_eq!(model.get_formatted_cell_value(0, 4, 8), Ok("".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 5, 8), Ok("".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 8, 8), Ok("".to_string()));
}

// Regression test for: cell styling lost when undoing an edit that caused a spill error
// Steps: apply style to a spilled cell → block the spill → undo the block → style must survive
#[test]
fn undo_spill_error_preserves_styling_on_spilled_cells() {
    let mut model = new_empty_user_model();

    // SEQUENCE(5) in A1 spills values 1–5 into A1:A5
    model.set_user_input(0, 1, 1, "=SEQUENCE(5)").unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 2, 1), Ok("2".to_string()));

    // Apply a background color to A2 (a spilled cell)
    let a2 = Area {
        sheet: 0,
        row: 2,
        column: 1,
        width: 1,
        height: 1,
    };
    model
        .update_range_style(&a2, "fill.color", "#FF0000")
        .unwrap();
    let style = model.get_cell_style(0, 2, 1).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#FF0000".to_owned()));

    // Enter a value in A2, blocking the spill → A1 shows #SPILL!
    model.set_user_input(0, 2, 1, "blocking").unwrap();
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 1),
        Ok("#SPILL!".to_string())
    );

    // Undo the blocking edit — the spill should be restored
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 1), Ok("1".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 2, 1), Ok("2".to_string()));

    // The background color applied before the spill-blocking edit must still be present
    let style = model.get_cell_style(0, 2, 1).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#FF0000".to_owned()));
}
