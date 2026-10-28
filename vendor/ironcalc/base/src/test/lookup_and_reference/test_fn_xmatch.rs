#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// ── exact match (default) ─────────────────────────────────────────────────────

#[test]
fn test_xmatch_exact_found() {
    let mut model = new_empty_model();
    model._set("A1", "apple");
    model._set("A2", "banana");
    model._set("A3", "cherry");
    model._set("C1", "=XMATCH(\"banana\",A1:A3)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "2");
}

#[test]
fn test_xmatch_exact_not_found() {
    let mut model = new_empty_model();
    model._set("A1", "apple");
    model._set("A2", "banana");
    model._set("C1", "=XMATCH(\"cherry\",A1:A2)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "#N/A");
}

#[test]
fn test_xmatch_exact_number() {
    let mut model = new_empty_model();
    model._set("A1", "10");
    model._set("A2", "20");
    model._set("A3", "30");
    model._set("C1", "=XMATCH(20,A1:A3)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "2");
}

// ── next-smaller / next-larger (unsorted) ────────────────────────────────────

#[test]
fn test_xmatch_next_smaller() {
    // match_mode=-1: exact or next smaller
    let mut model = new_empty_model();
    model._set("A1", "5");
    model._set("A2", "10");
    model._set("A3", "15");
    // Looking for 12: no exact match, next smaller is 10 at position 2
    model._set("C1", "=XMATCH(12,A1:A3,-1)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "2");
}

#[test]
fn test_xmatch_next_larger() {
    // match_mode=1: exact or next larger
    let mut model = new_empty_model();
    model._set("A1", "5");
    model._set("A2", "10");
    model._set("A3", "15");
    // Looking for 12: no exact match, next larger is 15 at position 3
    model._set("C1", "=XMATCH(12,A1:A3,1)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "3");
}

// ── wildcard match ────────────────────────────────────────────────────────────

#[test]
fn test_xmatch_wildcard() {
    let mut model = new_empty_model();
    model._set("A1", "apple");
    model._set("A2", "apricot");
    model._set("A3", "banana");
    // "ap*" should match the first entry starting with "ap"
    model._set("C1", "=XMATCH(\"ap*\",A1:A3,2)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "1");
}

#[test]
fn test_xmatch_wildcard_question_mark() {
    let mut model = new_empty_model();
    model._set("A1", "cat");
    model._set("A2", "bat");
    model._set("A3", "hat");
    // "?at" matches all three; should return first (position 1)
    model._set("C1", "=XMATCH(\"?at\",A1:A3,2)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "1");
}

// ── reverse search ────────────────────────────────────────────────────────────

#[test]
fn test_xmatch_reverse_search() {
    let mut model = new_empty_model();
    model._set("A1", "x");
    model._set("A2", "y");
    model._set("A3", "x");
    // Last-to-first: last "x" is at position 3
    model._set("C1", "=XMATCH(\"x\",A1:A3,0,-1)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "3");
}

// ── binary search ─────────────────────────────────────────────────────────────

#[test]
fn test_xmatch_binary_ascending() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "3");
    model._set("A3", "5");
    model._set("A4", "7");
    // Exact match in sorted array
    model._set("C1", "=XMATCH(5,A1:A4,0,2)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "3");
}

#[test]
fn test_xmatch_binary_descending() {
    let mut model = new_empty_model();
    model._set("A1", "7");
    model._set("A2", "5");
    model._set("A3", "3");
    model._set("A4", "1");
    model._set("C1", "=XMATCH(5,A1:A4,0,-2)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "2");
}

// ── regex match (match_mode=3) ────────────────────────────────────────────────

#[test]
fn test_xmatch_regex_basic() {
    let mut model = new_empty_model();
    model._set("A1", "Monday");
    model._set("A2", "Tuesday");
    model._set("A3", "Wednesday");
    // Matches words ending in "day"
    model._set("C1", "=XMATCH(\"[A-Z][a-z]*day\",A1:A3,3)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "1");
}

#[test]
fn test_xmatch_regex_second_match() {
    let mut model = new_empty_model();
    model._set("A1", "cat");
    model._set("A2", "Cart");
    model._set("A3", "car");
    // Capital letter followed by lowercase letters ending in "t"
    model._set("C1", "=XMATCH(\"[A-Z][a-z]*t\",A1:A3,3)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "2");
}

#[test]
fn test_xmatch_regex_not_found() {
    let mut model = new_empty_model();
    model._set("A1", "apple");
    model._set("A2", "banana");
    model._set("C1", "=XMATCH(\"^\\d+$\",A1:A2,3)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "#N/A");
}

#[test]
fn test_xmatch_regex_invalid_pattern() {
    let mut model = new_empty_model();
    model._set("A1", "apple");
    model._set("C1", "=XMATCH(\"[\",A1:A1,3)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "#VALUE!");
}

#[test]
fn test_xmatch_regex_reverse_search() {
    let mut model = new_empty_model();
    model._set("A1", "Bay");
    model._set("A2", "Cat");
    model._set("A3", "Day");
    // Last-to-first: last match for capital+lowercase+y pattern is "Day" at position 3
    model._set("C1", "=XMATCH(\"[A-Z][a-z]*y\",A1:A3,3,-1)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "3");
}

// ── regex mode: non-string lookup_value → #N/A (matches Excel) ───────────────

#[test]
fn test_xmatch_regex_non_string_lookup_is_na() {
    let mut model = new_empty_model();
    model._set("A1", "apple");
    model._set("A2", "banana");
    // Excel returns #N/A (not found) when lookup_value is not a string in regex mode
    model._set("C1", "=XMATCH(42,A1:A2,3)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "#N/A");
}

// ── row vector ────────────────────────────────────────────────────────────────

#[test]
fn test_xmatch_row_vector() {
    let mut model = new_empty_model();
    model._set("A1", "red");
    model._set("B1", "green");
    model._set("C1", "blue");
    model._set("A3", "=XMATCH(\"green\",A1:C1)");
    model.evaluate();
    assert_eq!(model._get_text("A3"), "2");
}

// ── array constants as lookup_array ─────────────────────────────────────────────

#[test]
fn test_xmatch_array_constant_wildcard() {
    let mut model = new_empty_model();
    // Wildcard match against an in-formula array constant.
    model._set("A1", r#"=XMATCH("ban*", {"apple","banana","cherry"}, 2)"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "2");
}

#[test]
fn test_xmatch_array_constant_numeric() {
    let mut model = new_empty_model();
    // Exact numeric match against a numeric array constant.
    model._set("A1", "=XMATCH(30, {10,20,30,40,50})");
    // Exact-or-next-larger against a numeric array constant.
    model._set("A2", "=XMATCH(35, {10,20,30,40,50}, 1)");
    // A column-oriented array constant works too.
    model._set("A3", "=XMATCH(30, {10;20;30;40;50})");
    // Not found is #N/A, not #VALUE!.
    model._set("A4", "=XMATCH(99, {10,20,30})");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "3");
    assert_eq!(model._get_text("A2"), "4");
    assert_eq!(model._get_text("A3"), "3");
    assert_eq!(model._get_text("A4"), "#N/A");
}

// ── whole-column lookup array and a spill beyond the used area ───────────────

// XMATCH clips a whole-column lookup array to the sheet's used area. When it
// runs inside an anchor, the array it looks in may be spilled on demand
// during the walk, past the bound the walk was clipped to. The skipped part
// is on record, so the spill restarts the pass and the match is found.
#[test]
fn test_xmatch_whole_column_sees_a_spill_beyond_the_used_area() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(1,1,XMATCH(5,D:D))");
    model._set("C1", "=SEQUENCE(3,1,10)");
    model._set("D1", "=SEQUENCE(5)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "5");
    assert_eq!(model.evaluation.restarts_in_last_evaluation, 1);

    model.evaluate();
    assert_eq!(model._get_text("A1"), "5");
    assert_eq!(model.evaluation.restarts_in_last_evaluation, 0);
}
