#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_fn_choose_args_number() {
    let mut model = new_empty_model();
    model._set("A1", "=CHOOSE()");
    model._set("A2", "=CHOOSE(1)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
}

#[test]
fn test_fn_choose_incorrect_index() {
    let mut model = new_empty_model();
    model._set("A1", "=CHOOSE(-1, 42)");
    model._set("A2", "=CHOOSE(0, 42)");
    model._set("A3", "=CHOOSE(1, 42)");
    model._set("A4", "=CHOOSE(2, 42)");
    model._set("B1", "TEST");
    model._set("A5", "=CHOOSE(B1, 42)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#VALUE!");
    assert_eq!(model._get_text("A2"), *"#VALUE!");
    assert_eq!(model._get_text("A3"), *"42");
    assert_eq!(model._get_text("A4"), *"#VALUE!");
    assert_eq!(model._get_text("A5"), *"#VALUE!");
}

#[test]
fn test_fn_choose_basic_tests() {
    let mut model = new_empty_model();
    model._set("B1", "1");
    model._set("B2", "2");
    model._set("B3", "3");
    model._set("A1", "=CHOOSE(3.1, B1, B2, B3)");
    model._set("A2", "=SUM(B1:CHOOSE(1, B1, B2, B3))");
    model._set("A3", "=SUM(CHOOSE(3, B1:B1, B1:B2, B1:B3))");
    model._set("A4", "=CHOOSE(3,\"Wide\",115,\"world\",8)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"3");
    assert_eq!(model._get_text("A2"), *"1");
    assert_eq!(model._get_text("A3"), *"6");
    assert_eq!(model._get_text("A4"), *"world");
}

// CHOOSE broadcasts when the index argument is an array/range: each index element
// selects the matching value argument, and the result spills with the index shape.
#[test]
fn test_fn_choose_array_index() {
    let mut model = new_empty_model();
    model._set("A1", "10");
    model._set("A2", "20");
    model._set("A3", "30");

    // Inline array index reorders the scalar values.
    model._set("C1", "=CHOOSE({1;3;2}, 100, 200, 300)");
    // Array index selecting cell references (collapsed to scalars).
    model._set("E1", "=CHOOSE({1;2;3}, A1, A2, A3)");
    // An out-of-range index errors only in its own cell.
    model._set("G1", "=CHOOSE({1;5}, 7, 8)");

    model.evaluate();

    assert_eq!(model._get_text("C1"), "100");
    assert_eq!(model._get_text("C2"), "300");
    assert_eq!(model._get_text("C3"), "200");
    assert_eq!(model._get_text("C4"), "");

    assert_eq!(model._get_text("E1"), "10");
    assert_eq!(model._get_text("E2"), "20");
    assert_eq!(model._get_text("E3"), "30");

    assert_eq!(model._get_text("G1"), "7");
    assert_eq!(model._get_text("G2"), "#VALUE!");
}

// A scalar index keeps the original behaviour, including selecting a range that spills.
#[test]
fn test_fn_choose_scalar_index_unaffected() {
    let mut model = new_empty_model();
    model._set("A1", "10");
    model._set("A2", "20");
    model._set("A3", "30");
    model._set("C1", "=CHOOSE(1, A1:A3, 999)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "10");
    assert_eq!(model._get_text("C2"), "20");
    assert_eq!(model._get_text("C3"), "30");
}

// CHOOSE passes references through: a chosen range arm reaches a range consumer
// whole (Excel: SUM(CHOOSE(2, A1:A5, B1:B5)) sums the chosen range).
#[test]
fn test_fn_choose_range_arm_flows_to_range_consumer() {
    let mut model = new_empty_model();
    model._set("A1", "10");
    model._set("A2", "20");
    model._set("A3", "30");
    model._set("C1", "=SUM(CHOOSE(2, A1:A2, A1:A3))");
    // CHOOSE as a range endpoint: A1:CHOOSE(2, A2, A3) -> A1:A3.
    model._set("C2", "=SUM(A1:CHOOSE(2, A2, A3))");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "60");
    assert_eq!(model._get_text("C2"), "60");
}

// The legacy-import shape: `@` on the CHOOSE call intersects its result at the
// consuming cell (Excel upgrades legacy `=CHOOSE(2,A1:A10,...)` to `=@CHOOSE(...)`).
#[test]
fn test_fn_choose_at_call_intersects_result() {
    let mut model = new_empty_model();
    model._set("A1", "10");
    model._set("A2", "20");
    model._set("A3", "30");
    model._set("C2", "=@CHOOSE(1, A1:A3, 999)");
    model.evaluate();
    assert_eq!(model._get_text("C2"), "20");
    // No spill: C3 stays empty.
    assert_eq!(model._get_text("C3"), "");
}
