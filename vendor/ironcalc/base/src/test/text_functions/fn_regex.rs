use crate::test::util::new_empty_model;

// ── REGEXTEST ─────────────────────────────────────────────────────────────────

#[test]
fn test_regextest_basic_match() {
    let mut model = new_empty_model();
    model._set("A1", "=REGEXTEST(\"hello world\", \"world\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "TRUE");
}

#[test]
fn test_regextest_no_match() {
    let mut model = new_empty_model();
    model._set("A1", "=REGEXTEST(\"hello world\", \"xyz\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "FALSE");
}

#[test]
fn test_regextest_anchored() {
    let mut model = new_empty_model();
    model._set("A1", "=REGEXTEST(\"abc123\", \"^[a-z]+$\")");
    model._set("A2", "=REGEXTEST(\"abc123\", \"^[a-z0-9]+$\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "FALSE");
    assert_eq!(model._get_text("A2"), "TRUE");
}

#[test]
fn test_regextest_invalid_regex() {
    let mut model = new_empty_model();
    model._set("A1", "=REGEXTEST(\"text\", \"[\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#VALUE!");
}

#[test]
fn test_regextest_case_sensitive() {
    let mut model = new_empty_model();
    model._set("A1", "=REGEXTEST(\"Hello\", \"hello\")");
    model._set("A2", "=REGEXTEST(\"Hello\", \"Hello\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "FALSE");
    assert_eq!(model._get_text("A2"), "TRUE");
}

#[test]
fn test_regextest_wrong_arg_count() {
    let mut model = new_empty_model();
    model._set("A1", "=REGEXTEST(\"text\")");
    model._set("A2", "=REGEXTEST(\"text\", \".\", \"extra\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#ERROR!");
    assert_eq!(model._get_text("A2"), "#ERROR!");
}

// ── REGEXEXTRACT ──────────────────────────────────────────────────────────────

#[test]
fn test_regexextract_full_match() {
    let mut model = new_empty_model();
    model._set("A1", "=REGEXEXTRACT(\"foo 42 bar\", \"[0-9]+\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "42");
}

#[test]
fn test_regexextract_capture_group() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=REGEXEXTRACT(\"2024-01-15\", \"(\\d{4})-\\d{2}-\\d{2}\")",
    );
    model.evaluate();
    assert_eq!(model._get_text("A1"), "2024");
}

#[test]
fn test_regexextract_no_match() {
    let mut model = new_empty_model();
    model._set("A1", "=REGEXEXTRACT(\"hello\", \"[0-9]+\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#N/A");
}

#[test]
fn test_regexextract_invalid_regex() {
    let mut model = new_empty_model();
    model._set("A1", "=REGEXEXTRACT(\"text\", \"[\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#VALUE!");
}

#[test]
fn test_regexextract_wrong_arg_count() {
    let mut model = new_empty_model();
    model._set("A1", "=REGEXEXTRACT(\"text\")");
    model._set("A2", "=REGEXEXTRACT(\"text\", \".\", \"0\", \"extra\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#ERROR!");
    assert_eq!(model._get_text("A2"), "#ERROR!");
}

#[test]
fn test_regexextract_all_matches() {
    let mut model = new_empty_model();
    model._set("A1", "=REGEXEXTRACT(\"LonelyPlanet\", \"[A-Z][a-z]+\", 1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "Lonely");
    assert_eq!(model._get_text("B1"), "Planet");
}

#[test]
fn test_regexextract_all_matches_no_match() {
    let mut model = new_empty_model();
    model._set("A1", "=REGEXEXTRACT(\"nouppercase\", \"[A-Z][a-z]+\", 1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#N/A");
}

// ── REGEXREPLACE ──────────────────────────────────────────────────────────────

#[test]
fn test_regexreplace_basic() {
    let mut model = new_empty_model();
    model._set("A1", "=REGEXREPLACE(\"hello world\", \"world\", \"Rust\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "hello Rust");
}

#[test]
fn test_regexreplace_all_occurrences() {
    let mut model = new_empty_model();
    model._set("A1", "=REGEXREPLACE(\"aabbcc\", \"[a-c]\", \"x\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "xxxxxx");
}

#[test]
fn test_regexreplace_no_match() {
    let mut model = new_empty_model();
    model._set("A1", "=REGEXREPLACE(\"hello\", \"[0-9]+\", \"NUM\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "hello");
}

#[test]
fn test_regexreplace_digits() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=REGEXREPLACE(\"abc 123 def 456\", \"[0-9]+\", \"N\")",
    );
    model.evaluate();
    assert_eq!(model._get_text("A1"), "abc N def N");
}

#[test]
fn test_regexreplace_invalid_regex() {
    let mut model = new_empty_model();
    model._set("A1", "=REGEXREPLACE(\"text\", \"[\", \"x\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#VALUE!");
}

#[test]
fn test_regexreplace_wrong_arg_count() {
    let mut model = new_empty_model();
    model._set("A1", "=REGEXREPLACE(\"text\", \".\")");
    model._set("A2", "=REGEXREPLACE(\"text\", \".\", \"x\", \"extra\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#ERROR!");
    assert_eq!(model._get_text("A2"), "#ERROR!");
}
