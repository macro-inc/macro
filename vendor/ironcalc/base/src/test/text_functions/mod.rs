#![allow(clippy::unwrap_used)]

mod byte_variants;
mod fn_arraytotext;
mod fn_char_code;
mod fn_clean;
mod fn_left_right_mid_arrays;
mod fn_regex;
mod fn_text_arrays;
mod fn_textbefore;
mod fn_textjoin;
mod fn_textsplit;
mod fn_unicode;

use crate::test::util::new_empty_model;

// ── ASC ───────────────────────────────────────────────────────────────────────

#[test]
fn test_asc_fullwidth() {
    let mut model = new_empty_model();
    // Full-width A (U+FF21) → A (U+0041)
    model._set("A1", "=ASC(\"\u{FF21}\u{FF22}\u{FF23}\")");
    // Full-width space (U+3000) → regular space
    model._set("A2", "=ASC(\"\u{3000}\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "ABC");
    assert_eq!(model._get_text("A2"), " ");
}

#[test]
fn test_asc_passthrough() {
    let mut model = new_empty_model();
    model._set("A1", "=ASC(\"hello\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "hello");
}

// ── DOLLAR ────────────────────────────────────────────────────────────────────

#[test]
fn test_dollar_basic() {
    let mut model = new_empty_model();
    model._set("A1", "=DOLLAR(1234.567)");
    model._set("A2", "=DOLLAR(1234.567, 0)");
    model._set("A3", "=DOLLAR(-1234.5, 2)");
    model._set("A4", "=DOLLAR(1234.5, -2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "$1,234.57");
    assert_eq!(model._get_text("A2"), "$1,235");
    assert_eq!(model._get_text("A3"), "($1,234.50)");
    assert_eq!(model._get_text("A4"), "$1,200");
}

// ── FIXED ─────────────────────────────────────────────────────────────────────

#[test]
fn test_fixed_basic() {
    let mut model = new_empty_model();
    model._set("A1", "=FIXED(1234.567, 2)");
    model._set("A2", "=FIXED(1234.567, 0)");
    model._set("A3", "=FIXED(1234.567, 2, TRUE)");
    model._set("A4", "=FIXED(-1234.5, 2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1,234.57");
    assert_eq!(model._get_text("A2"), "1,235");
    assert_eq!(model._get_text("A3"), "1234.57");
    assert_eq!(model._get_text("A4"), "-1,234.50");
}

// ── NUMBERVALUE ───────────────────────────────────────────────────────────────

#[test]
fn test_numbervalue_basic() {
    let mut model = new_empty_model();
    model._set("A1", "=NUMBERVALUE(\"1234.56\")");
    model._set("A2", "=NUMBERVALUE(\"1.234,56\", \",\", \".\")");
    model._set("A3", "=NUMBERVALUE(\"3.5%\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1234.56");
    assert_eq!(model._get_text("A2"), "1234.56");
    assert_eq!(model._get_text("A3"), "0.035");
}

#[test]
fn test_numbervalue_error() {
    let mut model = new_empty_model();
    model._set("A1", "=NUMBERVALUE(\"abc\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#VALUE!");
}

// ── PROPER ────────────────────────────────────────────────────────────────────

#[test]
fn test_proper_basic() {
    let mut model = new_empty_model();
    model._set("A1", "=PROPER(\"hello world\")");
    model._set("A2", "=PROPER(\"HELLO WORLD\")");
    model._set("A3", "=PROPER(\"it's a test\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "Hello World");
    assert_eq!(model._get_text("A2"), "Hello World");
    assert_eq!(model._get_text("A3"), "It'S A Test");
}

// ── TRIM ──────────────────────────────────────────────────────────────────────

#[test]
fn test_trim_collapse_internal_runs() {
    let mut model = new_empty_model();
    // Leading/trailing spaces trimmed AND internal runs collapsed to a single space.
    model._set("A1", "=TRIM(\"  hello   world  \")");
    // Interior-only collapse (ends already correct) — the load-bearing regressions.
    model._set("A2", "=TRIM(\"a    b\")");
    model._set("A3", "=TRIM(\"no  extra\")");
    // No change needed.
    model._set("A4", "=TRIM(\"single\")");
    // All spaces collapse to empty string.
    model._set("A5", "=TRIM(\"   \")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "hello world");
    assert_eq!(model._get_text("A2"), "a b");
    assert_eq!(model._get_text("A3"), "no extra");
    assert_eq!(model._get_text("A4"), "single");
    assert_eq!(model._get_text("A5"), "");
}

#[test]
fn test_trim_only_ascii_space() {
    let mut model = new_empty_model();
    // Tabs (0x09) must NOT be collapsed or trimmed — TRIM is 0x20-only.
    model._set("A1", "=TRIM(\"a\"&CHAR(9)&CHAR(9)&\"b\")");
    // Non-breaking space (0xA0) must NOT be trimmed.
    model._set("A2", "=TRIM(CHAR(160)&\"x\"&CHAR(160))");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "a\u{9}\u{9}b");
    assert_eq!(model._get_text("A2"), "\u{a0}x\u{a0}");
}

// ── REPLACE ───────────────────────────────────────────────────────────────────

#[test]
fn test_replace_basic() {
    let mut model = new_empty_model();
    model._set("A1", "=REPLACE(\"abcdef\", 2, 3, \"XY\")");
    model._set("A2", "=REPLACE(\"hello\", 1, 0, \"start-\")");
    model._set("A3", "=REPLACE(\"hello\", 6, 0, \"-end\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "aXYef");
    assert_eq!(model._get_text("A2"), "start-hello");
    assert_eq!(model._get_text("A3"), "hello-end");
}
