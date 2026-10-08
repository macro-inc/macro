#![allow(clippy::unwrap_used)]
use crate::test::util::new_empty_model;

// ── Scalar behaviour is preserved ─────────────────────────────────────────────

#[test]
fn scalar_still_works() {
    let mut model = new_empty_model();
    model._set("A1", "=LEFT(\"hello\", 3)");
    model._set("A2", "=RIGHT(\"hello\", 3)");
    model._set("A3", "=MID(\"hello\", 2, 3)");
    // Defaults and coercions
    model._set("A4", "=LEFT(\"hello\")");
    model._set("A5", "=RIGHT(\"hello\")");
    model._set("A6", "=MID(12345, 2, 3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "hel");
    assert_eq!(model._get_text("A2"), "llo");
    assert_eq!(model._get_text("A3"), "ell");
    assert_eq!(model._get_text("A4"), "h");
    assert_eq!(model._get_text("A5"), "o");
    assert_eq!(model._get_text("A6"), "234");
}

// ── MID over an array of start positions (the motivating example) ─────────────

#[test]
fn mid_spills_characters() {
    let mut model = new_empty_model();
    model._set("N2", "hello");
    // =MID(N2, SEQUENCE(LEN(N2)), 1) splits the word into one char per row.
    model._set("A1", "=MID(N2, SEQUENCE(LEN(N2)), 1)");
    model.evaluate();
    assert_eq!(model._get_text_at(0, 1, 1), "h");
    assert_eq!(model._get_text_at(0, 2, 1), "e");
    assert_eq!(model._get_text_at(0, 3, 1), "l");
    assert_eq!(model._get_text_at(0, 4, 1), "l");
    assert_eq!(model._get_text_at(0, 5, 1), "o");
}

// ── LEFT/RIGHT broadcast a scalar text over an array length ───────────────────

#[test]
fn left_right_broadcast_length() {
    let mut model = new_empty_model();
    model._set("A1", "=LEFT(\"abcde\", SEQUENCE(3))");
    model._set("B1", "=RIGHT(\"abcde\", SEQUENCE(3))");
    model.evaluate();
    // LEFT with 1, 2, 3
    assert_eq!(model._get_text_at(0, 1, 1), "a");
    assert_eq!(model._get_text_at(0, 2, 1), "ab");
    assert_eq!(model._get_text_at(0, 3, 1), "abc");
    // RIGHT with 1, 2, 3
    assert_eq!(model._get_text_at(0, 1, 2), "e");
    assert_eq!(model._get_text_at(0, 2, 2), "de");
    assert_eq!(model._get_text_at(0, 3, 2), "cde");
}

// ── A range of texts broadcasts against a scalar count ────────────────────────

#[test]
fn text_range_broadcasts() {
    let mut model = new_empty_model();
    model._set("A1", "one");
    model._set("A2", "two");
    model._set("A3", "three");
    model._set("C1", "=LEFT(A1:A3, 2)");
    model.evaluate();
    assert_eq!(model._get_text_at(0, 1, 3), "on");
    assert_eq!(model._get_text_at(0, 2, 3), "tw");
    assert_eq!(model._get_text_at(0, 3, 3), "th");
}

// ── Both arguments are arrays: element-wise pairing ───────────────────────────

#[test]
fn both_arrays_pair_elementwise() {
    let mut model = new_empty_model();
    model._set("A1", "alpha");
    model._set("A2", "beta");
    model._set("B1", "1");
    model._set("B2", "3");
    model._set("C1", "=LEFT(A1:A2, B1:B2)");
    model.evaluate();
    assert_eq!(model._get_text_at(0, 1, 3), "a");
    assert_eq!(model._get_text_at(0, 2, 3), "bet");
}

// ── Errors inside an array element propagate to that element ──────────────────

#[test]
fn error_element_propagates() {
    let mut model = new_empty_model();
    model._set("A1", "ok");
    model._set("A2", "=1/0");
    model._set("C1", "=LEFT(A1:A2, 1)");
    model.evaluate();
    assert_eq!(model._get_text_at(0, 1, 3), "o");
    assert_eq!(model._get_text_at(0, 2, 3), "#DIV/0!");
}

// ── A negative length inside an array element yields #VALUE! there ─────────────

#[test]
fn mid_array_negative_length() {
    let mut model = new_empty_model();
    model._set("A1", "=MID(\"hello\", {1;2}, {2;-1})");
    model.evaluate();
    assert_eq!(model._get_text_at(0, 1, 1), "he");
    assert_eq!(model._get_text_at(0, 2, 1), "#VALUE!");
}
// The array argument must survive a round-trip without an automatic implicit
// intersection (`@`) being inserted, which would collapse it back to a scalar.
#[test]
fn roundtrip_mid_array_formula() {
    let mut model = new_empty_model();
    model._set("N2", "hello");
    model._set("A1", "=MID(N2, SEQUENCE(LEN(N2)), 1)");
    model.evaluate();
    let f = model.get_cell_formula(0, 1, 1).unwrap().unwrap();
    assert_eq!(f, "=MID(N2,SEQUENCE(LEN(N2)),1)");
}
