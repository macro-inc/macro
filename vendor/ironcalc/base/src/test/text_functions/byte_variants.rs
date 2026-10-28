#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// ── BYTE VARIANTS (delegate to non-B) ────────────────────────────────────────

#[test]
fn test_findb_same_as_find() {
    let mut model = new_empty_model();
    model._set("A1", "=FINDB(\"b\", \"abc\")");
    model._set("A2", "=FIND(\"b\", \"abc\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
}

#[test]
fn test_leftb_same_as_left() {
    let mut model = new_empty_model();
    model._set("A1", "=LEFTB(\"hello\", 3)");
    model._set("A2", "=LEFT(\"hello\", 3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
}

#[test]
fn test_lenb_same_as_len() {
    let mut model = new_empty_model();
    model._set("A1", "=LENB(\"hello\")");
    model._set("A2", "=LEN(\"hello\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
}

#[test]
fn test_midb_same_as_mid() {
    let mut model = new_empty_model();
    model._set("A1", "=MIDB(\"hello\", 2, 3)");
    model._set("A2", "=MID(\"hello\", 2, 3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
}

#[test]
fn test_rightb_same_as_right() {
    let mut model = new_empty_model();
    model._set("A1", "=RIGHTB(\"hello\", 3)");
    model._set("A2", "=RIGHT(\"hello\", 3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
}

#[test]
fn test_searchb_same_as_search() {
    let mut model = new_empty_model();
    model._set("A1", "=SEARCHB(\"l\", \"hello\")");
    model._set("A2", "=SEARCH(\"l\", \"hello\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
}

#[test]
fn test_replaceb_same_as_replace() {
    let mut model = new_empty_model();
    model._set("A1", "=REPLACEB(\"hello\", 2, 2, \"XY\")");
    model._set("A2", "=REPLACE(\"hello\", 2, 2, \"XY\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
}
