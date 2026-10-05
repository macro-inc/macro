#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Place a static array formula at (row, column) spanning width × height cells.
/// The formula "=1+1" is used so evaluation is deterministic.
fn place_array(model: &mut crate::model::Model, row: i32, column: i32, width: i32, height: i32) {
    model
        .set_user_array_formula(0, row, column, width, height, "=1+1")
        .unwrap();
    model.evaluate();
}

// ═══════════════════════════════════════════════════════════════════════════
// insert_rows — static array formulas
// ═══════════════════════════════════════════════════════════════════════════

// Array at B3:C5 (row=3, col=2, width=2, height=3, spans rows 3-5).
// Inserting ABOVE row 3 is always fine.
#[test]
fn insert_rows_ok_above_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.insert_rows(0, 1, 1).is_ok());
    assert!(model.insert_rows(0, 2, 2).is_ok());
}

// Inserting at the anchor row itself shifts the whole formula down — fine.
#[test]
fn insert_rows_ok_at_anchor() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.insert_rows(0, 3, 1).is_ok());
}

// Inserting below the last spill row is fine.
#[test]
fn insert_rows_ok_below_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.insert_rows(0, 6, 1).is_ok());
    assert!(model.insert_rows(0, 10, 3).is_ok());
}

// Inserting inside the formula (rows 4 or 5) must fail.
#[test]
fn insert_rows_fail_inside_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    // row 4 is inside [3, 5]
    assert!(model.insert_rows(0, 4, 1).is_err());
    // row 5 is the last spill row — still inside
    let mut model2 = new_empty_model();
    place_array(&mut model2, 3, 2, 2, 3);
    assert!(model2.insert_rows(0, 5, 1).is_err());
}

// ═══════════════════════════════════════════════════════════════════════════
// insert_rows — dynamic arrays
// ═══════════════════════════════════════════════════════════════════════════

// Dynamic formula "=B1:B5" at A1 spills to A1:A5 (rows 1-5, height=5).
#[test]
fn insert_rows_ok_above_dynamic() {
    let mut model = new_empty_model();
    model._set("A1", "=B1:B5");
    model.evaluate();
    // Inserting at row 1 (at anchor) is fine.
    assert!(model.insert_rows(0, 1, 1).is_ok());
}

#[test]
fn insert_rows_ok_below_dynamic() {
    let mut model = new_empty_model();
    model._set("A1", "=B1:B5");
    model.evaluate();
    assert!(model.insert_rows(0, 6, 1).is_ok());
}

#[test]
fn insert_rows_ok_inside_dynamic() {
    let mut model = new_empty_model();
    model._set("A1", "=B1:B5");
    model.evaluate();
    // Dynamic arrays can be broken — inserting inside the spill is allowed.
    assert!(model.insert_rows(0, 3, 1).is_ok());
}

// ═══════════════════════════════════════════════════════════════════════════
// insert_columns — static array formulas
// ═══════════════════════════════════════════════════════════════════════════

// Array at B3:C5 (row=3, col=2, width=2, height=3, spans cols B-C, i.e. 2-3).
#[test]
fn insert_columns_ok_before_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.insert_columns(0, 1, 1).is_ok());
    assert!(model.insert_columns(0, 2, 2).is_ok());
}

#[test]
fn insert_columns_ok_at_anchor() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.insert_columns(0, 2, 1).is_ok());
}

#[test]
fn insert_columns_ok_after_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.insert_columns(0, 4, 1).is_ok());
}

// Inserting between columns B and C (col 3, inside span [2,3]) must fail.
#[test]
fn insert_columns_fail_inside_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    // col 3 is inside [2, 3]
    assert!(model.insert_columns(0, 3, 1).is_err());
}

// ═══════════════════════════════════════════════════════════════════════════
// insert_columns — dynamic arrays
// ═══════════════════════════════════════════════════════════════════════════

// Dynamic formula "=A1:C1" at D1 spills to D1:F1 (cols 4-6, width=3).
#[test]
fn insert_columns_ok_inside_dynamic() {
    let mut model = new_empty_model();
    model._set("A1", "=B1:D1");
    model.evaluate();
    // Dynamic arrays can be broken — inserting inside the spill is allowed.
    assert!(model.insert_columns(0, 2, 1).is_ok());
}

#[test]
fn insert_columns_ok_outside_dynamic() {
    let mut model = new_empty_model();
    model._set("A1", "=B1:D1");
    model.evaluate();
    // Col 4 is after the spill — fine.
    assert!(model.insert_columns(0, 4, 1).is_ok());
}

// ═══════════════════════════════════════════════════════════════════════════
// delete_rows — static array formulas
// ═══════════════════════════════════════════════════════════════════════════

// Array at B3:C5 (rows 3-5).
#[test]
fn delete_rows_ok_above_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.delete_rows(0, 1, 1).is_ok());
    let mut model2 = new_empty_model();
    place_array(&mut model2, 3, 2, 2, 3);
    assert!(model2.delete_rows(0, 2, 1).is_ok());
}

#[test]
fn delete_rows_ok_below_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.delete_rows(0, 6, 2).is_ok());
}

// Deleting exactly the rows that contain the full array (rows 3-5) is fine.
#[test]
fn delete_rows_ok_full_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.delete_rows(0, 3, 3).is_ok());
}

// Deleting a superset of the array rows (rows 2-6) is also fine.
#[test]
fn delete_rows_ok_superset_of_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.delete_rows(0, 2, 5).is_ok());
}

// Deleting only row 3 (the anchor) while spill extends to rows 4-5 must fail.
#[test]
fn delete_rows_fail_anchor_only() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.delete_rows(0, 3, 1).is_err());
}

// Deleting rows 2-4 (partial overlap from above) must fail.
#[test]
fn delete_rows_fail_partial_overlap_from_above() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.delete_rows(0, 2, 3).is_err());
}

// Deleting rows 4-6 (partial overlap from below) must fail.
#[test]
fn delete_rows_fail_partial_overlap_from_below() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.delete_rows(0, 4, 3).is_err());
}

// ═══════════════════════════════════════════════════════════════════════════
// delete_rows — dynamic arrays
// ═══════════════════════════════════════════════════════════════════════════

// Dynamic formula "=B1:B5" at A1 spills to A1:A5 (rows 1-5).
#[test]
fn delete_rows_ok_full_dynamic() {
    let mut model = new_empty_model();
    model._set("A1", "=B1:B5");
    model.evaluate();
    // Deleting all 5 rows that the spill occupies should be fine.
    assert!(model.delete_rows(0, 1, 5).is_ok());
}

#[test]
fn delete_rows_ok_partial_dynamic() {
    let mut model = new_empty_model();
    model._set("A1", "=B1:B5");
    model.evaluate();
    // Dynamic arrays can be broken — deleting only part of the spill is allowed.
    assert!(model.delete_rows(0, 1, 3).is_ok());
}

// ═══════════════════════════════════════════════════════════════════════════
// delete_columns — static array formulas
// ═══════════════════════════════════════════════════════════════════════════

// Array at B3:C5 (col=2, width=2, spans cols 2-3).
#[test]
fn delete_columns_ok_before_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.delete_columns(0, 1, 1).is_ok());
}

#[test]
fn delete_columns_ok_after_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.delete_columns(0, 4, 2).is_ok());
}

// Deleting exactly cols 2-3 (the full array width) is fine.
#[test]
fn delete_columns_ok_full_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.delete_columns(0, 2, 2).is_ok());
}

// Deleting only col 2 (anchor column) while the formula spans to col 3 must fail.
#[test]
fn delete_columns_fail_anchor_only() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.delete_columns(0, 2, 1).is_err());
}

// Deleting cols 1-2 (overlap from the left) must fail.
#[test]
fn delete_columns_fail_partial_overlap_from_left() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.delete_columns(0, 1, 2).is_err());
}

// Deleting cols 3-4 (overlap from the right) must fail.
#[test]
fn delete_columns_fail_partial_overlap_from_right() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.delete_columns(0, 3, 2).is_err());
}

// ═══════════════════════════════════════════════════════════════════════════
// delete_columns — dynamic arrays
// ═══════════════════════════════════════════════════════════════════════════

// Dynamic formula "=A1:C1" at D1 spills horizontally (cols 4-6, width=3).
// Actually place it at A1 referencing a row range: "=B1:D1" spills to cols 1-3.
#[test]
fn delete_columns_ok_full_dynamic() {
    let mut model = new_empty_model();
    model._set("A1", "=B1:D1");
    model.evaluate();
    // A1 anchor is col 1, width 3 (spills cols 1-3). Deleting all 3 is fine.
    assert!(model.delete_columns(0, 1, 3).is_ok());
}

#[test]
fn delete_columns_ok_partial_dynamic() {
    let mut model = new_empty_model();
    model._set("A1", "=B1:D1");
    model.evaluate();
    // Dynamic arrays can be broken — deleting only part of the spill is allowed.
    assert!(model.delete_columns(0, 1, 2).is_ok());
}

// ═══════════════════════════════════════════════════════════════════════════
// move_columns_action — guards
// ═══════════════════════════════════════════════════════════════════════════

// Array at B3:C5 (cols 2-3, width=2). Moving column 2 alone must fail
#[test]
fn move_column_fail_partial_array_overlap() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.move_columns_action(0, 2, 1, 1).is_err());
}

// Array at B3:C5. We move columns B and C, allowed :)
#[test]
fn move_column_ok_full_array_in_range() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.move_columns_action(0, 2, 2, 1).is_ok());
}

// Moving col 1 forward by 1 → affected range [1, 2].
// Formula cols [2,3]: only col 2 is inside [1,2], col 3 is outside — must fail.
#[test]
fn move_column_fail_anchor_inside_spill_outside() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.move_columns_action(0, 1, 1, 1).is_err());
}

// Moving col 5 to col 6 doesn't touch the array at cols 2-3 — should succeed.
#[test]
fn move_column_ok_outside_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.move_columns_action(0, 5, 1, 1).is_ok());
}

// ═══════════════════════════════════════════════════════════════════════════
// move_rows_action — guards
// ═══════════════════════════════════════════════════════════════════════════

// Array at B3:C5 (rows 3-5, height=3). Moving rows 3 and 4 forward by 1 → affected
// range [3, 4]. Must fail
#[test]
fn move_row_fail_full_array_in_range() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.move_rows_action(0, 3, 2, 1).is_err());
}

// Moving row 4 forward by 2 → affected range [4, 6].
// Formula rows [3,5] partially overlaps [4,6] — must fail.
#[test]
fn move_row_fail_partial_array_overlap() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.move_rows_action(0, 4, 2, 1).is_err());
}

// Moving row 2 forward by 1 → affected range [2, 3].
// Formula rows [3,5]: row 3 is inside, rows 4-5 are outside — must fail.
#[test]
fn move_row_fail_anchor_inside_spill_outside() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.move_rows_action(0, 2, 1, 1).is_err());
}

// Moving row 6 to row 7 doesn't touch the array at rows 3-5 — should succeed.
#[test]
fn move_row_ok_outside_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.move_rows_action(0, 6, 1, 1).is_ok());
}

// ═══════════════════════════════════════════════════════════════════════════
// move_columns_action — dynamic arrays (can always be broken)
// ═══════════════════════════════════════════════════════════════════════════

// Dynamic formula "=B1:D1" at A1 spills to cols 1-3 (width=3).
// Moving col 2 (inside the spill) is allowed because dynamic arrays can be broken.
#[test]
fn move_column_ok_partial_dynamic_overlap() {
    let mut model = new_empty_model();
    model._set("A1", "=B1:D1");
    model.evaluate();
    // Col 2 is inside the spill [1, 3]; partial overlap with affected range [2,3] is fine.
    assert!(model.move_columns_action(0, 2, 1, 1).is_ok());
}

// Moving col 1 (the anchor) forward by 2 → affected range [1, 3].
// The whole spill [1, 3] is contained — also fine even for a static array,
// but confirms dynamic arrays are never blocked.
#[test]
fn move_column_ok_full_dynamic_in_range() {
    let mut model = new_empty_model();
    model._set("A1", "=B1:D1");
    model.evaluate();
    assert!(model.move_columns_action(0, 1, 2, 1).is_ok());
}

// ═══════════════════════════════════════════════════════════════════════════
// move_rows_action — dynamic arrays (can always be broken)
// ═══════════════════════════════════════════════════════════════════════════

// Dynamic formula "=B1:B5" at A1 spills to rows 1-5 (height=5).
// Moving row 3 (inside the spill) is allowed because dynamic arrays can be broken.
#[test]
fn move_row_ok_partial_dynamic_overlap() {
    let mut model = new_empty_model();
    model._set("A1", "=B1:B5");
    model.evaluate();
    // Row 3 is inside the spill [1, 5]; partial overlap with affected range [3,4] is fine.
    assert!(model.move_rows_action(0, 3, 1, 1).is_ok());
}

// Moving row 1 (the anchor) forward by 4 → affected range [1, 5].
// The whole spill [1, 5] is contained — also fine.
#[test]
fn move_row_ok_full_dynamic_in_range() {
    let mut model = new_empty_model();
    model._set("A1", "=B1:B5");
    model.evaluate();
    assert!(model.move_rows_action(0, 1, 4, 1).is_ok());
}

// ═══════════════════════════════════════════════════════════════════════════
// move_columns_action / move_rows_action — group moves with CSE arrays
// ═══════════════════════════════════════════════════════════════════════════

// Moving a group of columns that contains a complete CSE array (the original bug).
// Array formula =123 at F11:I11 (col=6, width=4, height=1).
// Moving cols 6-9 right by 1 should succeed and preserve the array.
#[test]
fn move_columns_ok_group_contains_full_cse_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 11, 6, 4, 1);
    assert!(model.move_columns_action(0, 6, 4, 1).is_ok());
}

// Moving a group of columns that only partially overlaps a CSE array must fail.
#[test]
fn move_columns_fail_group_partially_overlaps_cse_array() {
    let mut model = new_empty_model();
    // Array at cols 6-9.  Moving cols 7-10 (partial overlap: cols 7-9 inside array, col 10 outside).
    place_array(&mut model, 11, 6, 4, 1);
    assert!(model.move_columns_action(0, 7, 4, 1).is_err());
}

// Moving a group of columns entirely outside a CSE array is fine.
#[test]
fn move_columns_ok_group_outside_cse_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 11, 6, 4, 1);
    // Move cols 1-2 right by 1 — doesn't touch the array at 6-9.
    assert!(model.move_columns_action(0, 1, 2, 1).is_ok());
}

// Moving a group where the displaced zone partially overlaps a CSE array must fail.
// Array at cols 10-13 (width=4). Move group cols 5-8 right by 4 → displaced zone [9,12].
// Array [10,13] partially overlaps [9,12] — must fail.
#[test]
fn move_columns_fail_displaced_zone_partially_overlaps_cse_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 11, 10, 4, 1);
    assert!(model.move_columns_action(0, 5, 4, 4).is_err());
}

// E12:J12 scenario (cols 5-10): moving any single column within the array must fail.

// Moving the last column of the array (J=col 10) right by 1 must fail.
#[test]
fn move_columns_fail_last_col_of_cse_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 12, 5, 6, 1);
    assert!(model.move_columns_action(0, 10, 1, 1).is_err());
}

// Moving the first column of the array (E=col 5) left by 1 must fail.
#[test]
fn move_columns_fail_first_col_of_cse_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 12, 5, 6, 1);
    assert!(model.move_columns_action(0, 5, 1, -1).is_err());
}

// Moving an interior column of the array (col 7) right by 1 must fail.
#[test]
fn move_columns_fail_interior_col_of_cse_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 12, 5, 6, 1);
    assert!(model.move_columns_action(0, 7, 1, 1).is_err());
}

// Moving all columns of the array together (E:J, cols 5-10) must succeed.
#[test]
fn move_columns_ok_all_cols_of_cse_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 12, 5, 6, 1);
    assert!(model.move_columns_action(0, 5, 6, 1).is_ok());
}

// Moving a group of rows that contains a complete CSE array.
// Array formula =1+1 at B3:C3 (row=3, col=2, width=2, height=1).
// Moving rows 3-4 down by 1 should succeed.
#[test]
fn move_rows_ok_group_contains_full_cse_array() {
    let mut model = new_empty_model();
    place_array(&mut model, 3, 2, 2, 1);
    assert!(model.move_rows_action(0, 3, 2, 1).is_ok());
}

// Moving a group of rows that partially overlaps a CSE array must fail.
#[test]
fn move_rows_fail_group_partially_overlaps_cse_array() {
    let mut model = new_empty_model();
    // Array at rows 3-5 (height=3). Moving rows 4-6 (partial: rows 4-5 inside, row 6 outside).
    place_array(&mut model, 3, 2, 2, 3);
    assert!(model.move_rows_action(0, 4, 3, 1).is_err());
}

// ═══════════════════════════════════════════════════════════════════════════
// Regression: delete_rows must clear every deleted row, not just the first
// ═══════════════════════════════════════════════════════════════════════════

// Deleting rows 2-4 should leave all three rows empty. The bug caused only
// row 2 (the start of the range) to be cleared; rows 3 and 4 survived.
#[test]
fn delete_rows_clears_all_deleted_rows() {
    let mut model = new_empty_model();
    model._set("A2", "foo");
    model._set("A3", "bar");
    model._set("A4", "baz");
    model._set("A5", "keep");
    model.evaluate();

    assert!(model.delete_rows(0, 2, 3).is_ok());
    model.evaluate();

    // The bug cleared only the first deleted row (2); rows 3 and 4 were left with stale data.
    assert_eq!(model._get_text_at(0, 3, 1), "");
    assert_eq!(model._get_text_at(0, 4, 1), "");

    // The row below the deleted range (originally row 5) shifted up by 3 to row 2.
    assert_eq!(model._get_text_at(0, 2, 1), "keep");
}
