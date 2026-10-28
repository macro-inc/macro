#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn simple_colum() {
    let mut model = new_empty_model();
    // We populate cells A1 to A3
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");

    model._set("C2", "=@A1:A3");

    model.evaluate();

    assert_eq!(model._get_text("C2"), "2".to_string());
}

#[test]
fn return_of_array_spills() {
    let mut model = new_empty_model();
    // We populate cells A1 to A3
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");

    // With dynamic arrays, =A1:A3 spills downward from C2
    model._set("C2", "=A1:A3");
    model._set("D2", "=SUM(SIN(A:A)");

    model.evaluate();

    assert_eq!(model._get_text("C2"), "1".to_string());
    assert_eq!(model._get_text("C3"), "2".to_string());
    assert_eq!(model._get_text("C4"), "3".to_string());
    assert_eq!(model._get_text("D2"), "1.89188842".to_string());
}

#[test]
fn concat() {
    let mut model = new_empty_model();
    model._set("A1", "=CONCAT(@B1:B3)");
    model._set("A2", "=CONCAT(B1:B3)");
    model._set("B1", "Hello");
    model._set("B2", " ");
    model._set("B3", "world!");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"Hello");
    assert_eq!(model._get_text("A2"), *"Hello world!");
}

#[test]
fn scalar_context_unwraps_1x1_array_from_offset() {
    // When a non-array formula produces a 1x1 array (e.g. via OFFSET), the
    // unwrapped scalar must be the value stored in the cell.
    let mut model = new_empty_model();
    model._set("B1", "10");
    model._set("B2", "20");
    model._set("B3", "30");

    model._set("A1", "=2 * IF(TRUE, OFFSET(B1, 2, 0), 0)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "60".to_string());
}

#[test]
fn scalar_context_unwraps_1x1_array_from_offset_for_dependents() {
    // When a non-array formula produces a 1x1 array (e.g. via OFFSET), the
    // unwrapped scalar must be visible to dependents that are evaluated in the
    // same recalculation pass via `ReferenceKind -> evaluate_cell(...)`.
    let mut model = new_empty_model();
    model._set("B1", "10");
    model._set("B2", "20");
    model._set("B3", "30");

    model._set("A1", "=IF(TRUE, OFFSET(B1, 2, 0), 0)");
    model._set("C1", "=A1 + 1");
    model._set("D1", "=A1");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "30".to_string());
    assert_eq!(model._get_text("C1"), "31".to_string());
    assert_eq!(model._get_text("D1"), "30".to_string());
}

// --- Cross-sheet implicit intersection (`@`) ---
//
// The `@` operator applied to a reference resolving to a SINGLE cell on ANOTHER
// sheet must dereference that cell (Excel: `=@Sheet2!D2` returns Sheet2!D2). A
// 1x1 range always dereferences, regardless of the consuming cell's sheet.

#[test]
fn at_operator_on_cross_sheet_single_cell_dereferences() {
    let mut model = new_empty_model();
    model.new_sheet(); // Sheet2 at index 1
    model._set("Sheet2!D2", "=42");
    model._set("A1", "=@Sheet2!D2");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"42");
}

#[test]
fn at_operator_on_offset_to_other_sheet_dereferences() {
    // OFFSET returns a reference; `@` in scalar context must dereference the
    // resulting single cell even when it lives on another sheet.
    let mut model = new_empty_model();
    model.new_sheet(); // Sheet2 at index 1
    model._set("Sheet2!C3", "=7");
    // OFFSET(Sheet2!A1, 2, 2) -> Sheet2!C3
    model._set("A1", "=@OFFSET(Sheet2!A1, 2, 2)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"7");
}

#[test]
fn at_operator_on_offset_indirect_cross_sheet_editpnl_shape() {
    // The exact editpnl leaf shape: IFERROR(@OFFSET(INDIRECT("Sheet2!"&ref),r,c)/1, 0)
    // with the OFFSET target a single cell on Sheet2. Must compute, not fall to 0.
    let mut model = new_empty_model();
    model.new_sheet(); // Sheet2
    model._set("Sheet2!B1", "=100"); // OFFSET(Sheet2!A1, 0, 1) -> Sheet2!B1
    model._set("A1", "A1"); // the INDIRECT anchor string component
    model._set(
        "B1",
        "=IFERROR(@OFFSET(INDIRECT(\"Sheet2!\"&A1), 0, 1)/1, -999)",
    );
    model.evaluate();

    assert_eq!(model._get_text("B1"), *"100");
}

#[test]
fn at_operator_on_same_sheet_single_cell_still_works() {
    // Guard against a fix that breaks the same-sheet case.
    let mut model = new_empty_model();
    model._set("D2", "=42");
    model._set("A1", "=@D2");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"42");
}

#[test]
fn at_operator_row_aligned_intersection_across_sheets() {
    // A column range on another sheet, row-aligned to the consuming cell, picks
    // the cell on the range's own sheet at the consuming row (Excel:
    // `=Sheet2!D1:D5` on C3 -> Sheet2!D3).
    let mut model = new_empty_model();
    model.new_sheet(); // Sheet2
    model._set("Sheet2!D3", "=55");
    model._set("C3", "=@Sheet2!D1:D5");
    model.evaluate();

    assert_eq!(model._get_text("C3"), *"55");
}

// --- Scalar @-child in REFERENCE context ---
//
// `fn_choose` (and other reference-context callers) evaluate the selected node
// via `evaluate_node_with_reference`. When the importer auto-wraps a scalar-
// signature CHOOSE arm (e.g. an `IF(...)` that returns a scalar) in `@`, that
// `@`-node reaches `model.rs` `evaluate_node_with_reference`'s
// `ImplicitIntersection` arm.

#[test]
fn choose_arm_at_wrapped_scalar_if_flows_through() {
    // CHOOSE selects arm 1, an @-wrapped IF that returns a scalar. The scalar
    // must flow through the reference-context intersection, not error to 0.
    let mut model = new_empty_model();
    model._set("A1", "10");
    model._set("A2", "20");
    // Arm 1 = @IF(TRUE, 5, AVERAGE(A1:A2)) -> scalar 5.
    model._set(
        "C1",
        "=IFERROR(CHOOSE(1, @IF(TRUE, 5, AVERAGE(A1:A2)), 99), -1)",
    );
    model.evaluate();

    assert_eq!(model._get_text("C1"), "5".to_string());
}

#[test]
fn choose_arm_at_wrapped_scalar_cellref_flows_through() {
    // The editpnl shape: CHOOSE arm = @IF(cond, single-cell, AVERAGE(range)).
    // When the IF picks the single cell, the @-scalar must dereference, not error.
    let mut model = new_empty_model();
    model._set("A1", "10");
    model._set("A2", "20");
    model._set(
        "C1",
        "=IFERROR(CHOOSE(1, @IF(TRUE, A1, AVERAGE(A1:A2)), 99), -777)",
    );
    model.evaluate();

    assert_eq!(model._get_text("C1"), "10".to_string());
}

// --- `@` on a RANGE in reference context ---
//
// `@` intersects in reference context too: the `ImplicitIntersection` arm in
// `evaluate_node_with_reference` (and `get_reference`) returns the intersected
// single cell as a 1x1 Range, so reference consumers (CHOOSE, FORMULATEXT,
// COLUMNS, ...) see one cell, matching Excel.

#[test]
fn at_range_in_reference_context_intersects() {
    let mut model = new_empty_model();
    model._set("B1", "1");
    model._set("B2", "2");
    model._set("B3", "3");
    // CHOOSE evaluates the selected arm in reference context; @B1:B3 must
    // intersect at the consuming cell A2 -> B2, so SUM gets a single cell.
    model._set("A2", "=SUM(CHOOSE(1, @B1:B3))");
    model.evaluate();

    assert_eq!(model._get_text("A2"), "2".to_string());
}

#[test]
fn formulatext_of_at_column_intersects() {
    let mut model = new_empty_model();
    model._set("A1", "=1+2");
    // @A:A in B1 intersects to A1; FORMULATEXT must receive that single cell.
    model._set("B1", "=FORMULATEXT(@A:A)");
    model.evaluate();

    assert_eq!(model._get_text("B1"), "=1+2".to_string());
}

#[test]
fn columns_of_at_range_intersects() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("C1", "3");
    // @A1:C1 in B3 is column-aligned -> B1, a single cell.
    model._set("B3", "=COLUMNS(@A1:C1)");
    model.evaluate();

    assert_eq!(model._get_text("B3"), "1".to_string());
}
