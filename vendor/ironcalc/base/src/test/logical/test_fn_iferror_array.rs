#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// ── Scalar value (no array) ───────────────────────────────────────────────────
//
// When value is a scalar, IFERROR keeps its historical behaviour: a non-error
// passes through, an error is replaced by the fallback.

#[test]
fn iferror_scalar_non_error_passes_through() {
    let mut model = new_empty_model();
    model._set("A1", r#"=IFERROR(42, "fallback")"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "42");
}

#[test]
fn iferror_scalar_error_uses_fallback() {
    let mut model = new_empty_model();
    model._set("A1", r#"=IFERROR(1/0, "fallback")"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "fallback");
}

#[test]
fn iferror_scalar_error_fallback_array_spills() {
    // A scalar error with an array fallback spills the fallback.
    let mut model = new_empty_model();
    model._set("A1", "=IFERROR(1/0, {1,2,3})");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "2");
    assert_eq!(model._get_text("C1"), "3");
}

// ── Array value, scalar fallback ──────────────────────────────────────────────
//
// Each error element of value is replaced by the (broadcast) scalar fallback;
// non-error elements pass through. Output size = value size.

#[test]
fn iferror_array_value_scalar_fallback_horizontal() {
    let mut model = new_empty_model();
    model._set("A1", r#"=IFERROR({1,#DIV/0!,3}, "x")"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "x");
    assert_eq!(model._get_text("C1"), "3");
}

#[test]
fn iferror_array_value_no_errors_passes_through() {
    let mut model = new_empty_model();
    model._set("A1", r#"=IFERROR({1,2,3}, "x")"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "2");
    assert_eq!(model._get_text("C1"), "3");
}

#[test]
fn iferror_array_value_all_errors() {
    let mut model = new_empty_model();
    model._set("A1", "=IFERROR({#N/A,#DIV/0!,#VALUE!}, 0)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "0");
    assert_eq!(model._get_text("B1"), "0");
    assert_eq!(model._get_text("C1"), "0");
}

// ── Range value, scalar fallback ──────────────────────────────────────────────
//
// A range value behaves like an array: errors in the range are replaced.

#[test]
fn iferror_range_value_vertical() {
    let mut model = new_empty_model();
    model._set("B1", "10");
    model._set("B2", "=1/0");
    model._set("B3", "30");
    model._set("A1", r#"=IFERROR(B1:B3, "err")"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "10");
    assert_eq!(model._get_text("A2"), "err");
    assert_eq!(model._get_text("A3"), "30");
}

// ── Array value, array fallback (same size) ───────────────────────────────────
//
// =IFERROR({1,#DIV/0!,3}, {10,20,30}) → {1,20,3}
// Each error position takes the matching element of the fallback array.

#[test]
fn iferror_array_value_array_fallback_same_size() {
    let mut model = new_empty_model();
    model._set("A1", "=IFERROR({1,#DIV/0!,3}, {10,20,30})");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "20");
    assert_eq!(model._get_text("C1"), "3");
}

// ── Array value smaller than fallback ─────────────────────────────────────────
//
// Output size = largest extent. Positions out of bounds in value are treated as
// #N/A (an error), so they take the fallback element.
// =IFERROR({1,#DIV/0!}, {10,20,30})
// Index 0: value=1            → 1
// Index 1: value=#DIV/0!      → fallback[1]=20
// Index 2: value missing(#N/A)→ fallback[2]=30

#[test]
fn iferror_value_smaller_than_fallback() {
    let mut model = new_empty_model();
    model._set("A1", "=IFERROR({1,#DIV/0!}, {10,20,30})");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "20");
    assert_eq!(model._get_text("C1"), "30");
}

// ── Array value larger than fallback ──────────────────────────────────────────
//
// When the fallback array is smaller, an error position with no matching
// fallback element yields #N/A.
// =IFERROR({#DIV/0!,#DIV/0!,#DIV/0!}, {10,20})
// Index 0: fallback[0]=10
// Index 1: fallback[1]=20
// Index 2: fallback missing → #N/A

#[test]
fn iferror_fallback_smaller_than_value() {
    let mut model = new_empty_model();
    model._set("A1", "=IFERROR({#DIV/0!,#DIV/0!,#DIV/0!}, {10,20})");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "10");
    assert_eq!(model._get_text("B1"), "20");
    assert_eq!(model._get_text("C1"), "#N/A");
}

// ── 2-D array value ───────────────────────────────────────────────────────────
//
// Inline arrays use `;` to separate rows.
// =IFERROR({1,#DIV/0!;#N/A,4}, {"A","B";"C","D"})
// → {{1,"B"},{"C",4}} — a 2×2 result that spills over a 2×2 block.

#[test]
fn iferror_2d_array_value() {
    let mut model = new_empty_model();
    model._set("A1", r#"=IFERROR({1,#DIV/0!;#N/A,4}, {"A","B";"C","D"})"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "B");
    assert_eq!(model._get_text("A2"), "C");
    assert_eq!(model._get_text("B2"), "4");
}

// ── Errors arising from computations inside a range ───────────────────────────
//
// A realistic use: clean up a column of divisions that may divide by zero.

#[test]
fn iferror_cleans_up_division_column() {
    let mut model = new_empty_model();
    model._set("A1", "10");
    model._set("A2", "20");
    model._set("A3", "30");
    model._set("B1", "2");
    model._set("B2", "0");
    model._set("B3", "5");
    model._set("C1", r#"=IFERROR(A1:A3/B1:B3, "n/a")"#);
    model.evaluate();
    assert_eq!(model._get_text("C1"), "5");
    assert_eq!(model._get_text("C2"), "n/a");
    assert_eq!(model._get_text("C3"), "6");
}

// ── Wrong number of arguments ─────────────────────────────────────────────────

#[test]
fn iferror_wrong_number_of_args() {
    let mut model = new_empty_model();
    model._set("A1", "=IFERROR(1)");
    model._set("A2", "=IFERROR(1,2,3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#ERROR!");
    assert_eq!(model._get_text("A2"), "#ERROR!");
}

// ── Size-1 broadcasting (row × column outer product) ─────────────────────────
//
// A 3×1 value broadcasts its single column and a 1×2 fallback broadcasts its
// single row, so the result is 3×2.
// =IFERROR({1;0;2}/{0;0;0}, {7,8}) → every cell is an error → fallback grid:
//   7 8
//   7 8
//   7 8

#[test]
fn iferror_broadcasts_column_value_and_row_fallback() {
    let mut model = new_empty_model();
    model._set("A1", "=IFERROR({1;0;2}/{0;0;0}, {7,8})");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "7");
    assert_eq!(model._get_text("B1"), "8");
    assert_eq!(model._get_text("A2"), "7");
    assert_eq!(model._get_text("B2"), "8");
    assert_eq!(model._get_text("A3"), "7");
    assert_eq!(model._get_text("B3"), "8");
}

// Same shapes, but only some value cells are errors. Non-error cells pass
// through (broadcast across the 2 output columns).
// =IFERROR({1;0;2}/{0;1;0}, {7,8}) → {#DIV/0!;0;#DIV/0!} broadcast over 2 cols:
//   7 8
//   0 0
//   7 8

#[test]
fn iferror_broadcast_passes_non_error_cells_through() {
    let mut model = new_empty_model();
    model._set("A1", "=IFERROR({1;0;2}/{0;1;0}, {7,8})");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "7");
    assert_eq!(model._get_text("B1"), "8");
    assert_eq!(model._get_text("A2"), "0");
    assert_eq!(model._get_text("B2"), "0");
    assert_eq!(model._get_text("A3"), "7");
    assert_eq!(model._get_text("B3"), "8");
}

// ── IFNA shares the same path, but only handles #N/A ──────────────────────────

#[test]
fn ifna_scalar_na_uses_fallback() {
    let mut model = new_empty_model();
    model._set("A1", r#"=IFNA(#N/A, "fallback")"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "fallback");
}

#[test]
fn ifna_scalar_non_na_error_passes_through() {
    // A non-#N/A error is NOT handled by IFNA: it passes through unchanged.
    let mut model = new_empty_model();
    model._set("A1", r#"=IFNA(1/0, "fallback")"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#DIV/0!");
}

#[test]
fn ifna_scalar_non_error_passes_through() {
    let mut model = new_empty_model();
    model._set("A1", r#"=IFNA(42, "fallback")"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "42");
}

#[test]
fn ifna_scalar_na_fallback_array_spills() {
    let mut model = new_empty_model();
    model._set("A1", "=IFNA(#N/A, {1,2,3})");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "2");
    assert_eq!(model._get_text("C1"), "3");
}

#[test]
fn ifna_array_only_replaces_na() {
    // Array path: #N/A is replaced, but #DIV/0! survives untouched.
    let mut model = new_empty_model();
    model._set("A1", r#"=IFNA({1,#N/A,#DIV/0!,4}, "x")"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "x");
    assert_eq!(model._get_text("C1"), "#DIV/0!");
    assert_eq!(model._get_text("D1"), "4");
}

#[test]
fn ifna_array_value_array_fallback() {
    let mut model = new_empty_model();
    model._set("A1", "=IFNA({1,#N/A,3}, {10,20,30})");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "20");
    assert_eq!(model._get_text("C1"), "3");
}

#[test]
fn ifna_value_smaller_than_fallback() {
    // Out-of-bounds positions in value are treated as #N/A → take fallback.
    let mut model = new_empty_model();
    model._set("A1", "=IFNA({1,#N/A}, {10,20,30})");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "20");
    assert_eq!(model._get_text("C1"), "30");
}

#[test]
fn ifna_range_value_vertical() {
    let mut model = new_empty_model();
    model._set("B1", "10");
    model._set("B2", "=NA()");
    model._set("B3", "30");
    model._set("A1", r#"=IFNA(B1:B3, "missing")"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "10");
    assert_eq!(model._get_text("A2"), "missing");
    assert_eq!(model._get_text("A3"), "30");
}

#[test]
fn ifna_wrong_number_of_args() {
    let mut model = new_empty_model();
    model._set("A1", "=IFNA(1)");
    model._set("A2", "=IFNA(1,2,3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#ERROR!");
    assert_eq!(model._get_text("A2"), "#ERROR!");
}
