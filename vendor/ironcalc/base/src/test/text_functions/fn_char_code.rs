#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// ── CHAR ──────────────────────────────────────────────────────────────────────

#[test]
fn test_char_basic() {
    let mut model = new_empty_model();
    model._set("A1", "=CHAR(65)");
    model._set("A2", "=CHAR(97)");
    model._set("A3", "=CHAR(32)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "A");
    assert_eq!(model._get_text("A2"), "a");
    assert_eq!(model._get_text("A3"), " ");
}

#[test]
fn test_char_win1252() {
    let mut model = new_empty_model();
    // Code point 128 in Windows-1252 is €
    model._set("A1", "=CHAR(128)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "€");
}

#[test]
fn test_char_error() {
    let mut model = new_empty_model();
    model._set("A1", "=CHAR(0)");
    model._set("A2", "=CHAR(300)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#VALUE!");
    assert_eq!(model._get_text("A2"), "#VALUE!");
}

// ── CODE ──────────────────────────────────────────────────────────────────────

#[test]
fn test_code_basic() {
    let mut model = new_empty_model();
    model._set("A1", "=CODE(\"A\")");
    model._set("A2", "=CODE(\"ABC\")");
    model._set("A3", "=CODE(\" \")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "65");
    assert_eq!(model._get_text("A2"), "65"); // only first char
    assert_eq!(model._get_text("A3"), "32");
}

#[test]
fn test_code_empty() {
    let mut model = new_empty_model();
    model._set("A1", "=CODE(\"\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#VALUE!");
}

// ── UNICHAR ───────────────────────────────────────────────────────────────────

#[test]
fn test_unichar_basic() {
    let mut model = new_empty_model();
    model._set("A1", "=UNICHAR(65)");
    model._set("A2", "=UNICHAR(9786)"); // ☺ U+263A
    model.evaluate();
    assert_eq!(model._get_text("A1"), "A");
    assert_eq!(model._get_text("A2"), "☺");
}

#[test]
fn test_unichar_error() {
    let mut model = new_empty_model();
    model._set("A1", "=UNICHAR(0)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#VALUE!");
}
