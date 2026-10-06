#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn arguments_smoke_test() {
    let mut model = new_empty_model();
    model._set("A1", "=DEVSQ()");
    model._set("A2", "=DEVSQ(1, 2, 3)");
    model._set("A3", "=DEVSQ(1, )");
    model._set("A4", "=DEVSQ(1,   , 3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"2");
    assert_eq!(model._get_text("A3"), *"0");
    assert_eq!(model._get_text("A4"), *"2");
}

#[test]
fn ranges() {
    let mut model = new_empty_model();
    model._set("A1", "=DEVSQ(A2:A8)");
    model._set("A2", "4");
    model._set("A3", "5");
    model._set("A4", "8");
    model._set("A5", "7");
    model._set("A6", "11");
    model._set("A7", "4");
    model._set("A8", "3");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"48");
}

#[test]
fn arrays() {
    let mut model = new_empty_model();
    model._set("A1", "=DEVSQ({1, 2, 3})");
    model._set("A2", "=DEVSQ({1; 2; 3})");
    model._set("A3", "=DEVSQ({1, 2; 3, 4})");
    model._set("A4", "=DEVSQ({1, 2; 3, 4; 5, 6})");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"2");
    assert_eq!(model._get_text("A2"), *"2");
    assert_eq!(model._get_text("A3"), *"5");
    assert_eq!(model._get_text("A4"), *"17.5");
}

// ── whole-column range and a spill beyond the used area ─────────────────────

// A whole-column range is clipped to the sheet's used area before it is
// walked. Inside an anchor, the column may be spilled on demand during the
// walk, past the bound the walk was clipped to. The skipped part is on
// record, so the spill restarts the pass and the second run sees it all.
#[test]
fn whole_column_sees_a_spill_beyond_the_used_area() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(1,1,DEVSQ(D:D))");
    model._set("C1", "=SEQUENCE(3,1,10)");
    model._set("D1", "=SEQUENCE(5)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "10");
    assert_eq!(model.evaluation.restarts_in_last_evaluation, 1);

    model.evaluate();
    assert_eq!(model._get_text("A1"), "10");
    assert_eq!(model.evaluation.restarts_in_last_evaluation, 0);
}
