#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// ── SCAN ──────────────────────────────────────────────────────────────────────

#[test]
fn scan_running_sum_with_initial() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    // SCAN(0, A1:A3, LAMBDA(acc, x, acc + x)) → [1, 3, 6]
    model._set("B1", "=SCAN(0, A1:A3, LAMBDA(acc, x, acc + x))");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "1");
    assert_eq!(model._get_text("B2"), "3");
    assert_eq!(model._get_text("B3"), "6");
    assert_eq!(model._get_text("B4"), "");
}

#[test]
fn scan_running_product_with_initial() {
    let mut model = new_empty_model();
    model._set("A1", "2");
    model._set("A2", "3");
    model._set("A3", "4");
    // SCAN(1, A1:A3, LAMBDA(acc, x, acc * x)) → [2, 6, 24]
    model._set("B1", "=SCAN(1, A1:A3, LAMBDA(acc, x, acc * x))");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "2");
    assert_eq!(model._get_text("B2"), "6");
    assert_eq!(model._get_text("B3"), "24");
    assert_eq!(model._get_text("B4"), "");
}

#[test]
fn scan_running_max_with_initial() {
    let mut model = new_empty_model();
    model._set("A1", "3");
    model._set("A2", "1");
    model._set("A3", "4");
    model._set("A4", "2");
    // Running max starting from 0 → [3, 3, 4, 4]
    model._set("B1", "=SCAN(0, A1:A4, LAMBDA(acc, x, IF(x > acc, x, acc)))");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "3");
    assert_eq!(model._get_text("B2"), "3");
    assert_eq!(model._get_text("B3"), "4");
    assert_eq!(model._get_text("B4"), "4");
    assert_eq!(model._get_text("B5"), "");
}

#[test]
fn scan_without_initial_uses_first_element_as_seed() {
    let mut model = new_empty_model();
    model._set("A1", "10");
    model._set("A2", "20");
    model._set("A3", "30");
    // Without initial: seed = 10 (output[0] = 10), then 10+20=30, 30+30=60 → [10, 30, 60]
    model._set("B1", "=SCAN(A1:A3, LAMBDA(acc, x, acc + x))");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "10");
    assert_eq!(model._get_text("B2"), "30");
    assert_eq!(model._get_text("B3"), "60");
    assert_eq!(model._get_text("B4"), "");
}

#[test]
fn scan_2d_array_row_major() {
    let mut model = new_empty_model();
    // 2×2 grid iterated row-major: 1, 2, 3, 4
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("A2", "3");
    model._set("B2", "4");
    // Running sum from 0: 1, 3, 6, 10
    model._set("D1", "=SCAN(0, A1:B2, LAMBDA(acc, x, acc + x))");
    model.evaluate();
    assert_eq!(model._get_text("D1"), "1");
    assert_eq!(model._get_text("E1"), "3");
    assert_eq!(model._get_text("D2"), "6");
    assert_eq!(model._get_text("E2"), "10");
    assert_eq!(model._get_text("D3"), "");
}

#[test]
fn scan_wrong_arg_count() {
    let mut model = new_empty_model();
    model._set("A1", "=SCAN(0, A2:A3, LAMBDA(a, b, a+b), 1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#ERROR!");
}

#[test]
fn scan_too_few_args() {
    let mut model = new_empty_model();
    model._set("A1", "=SCAN(A2:A3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#ERROR!");
}
