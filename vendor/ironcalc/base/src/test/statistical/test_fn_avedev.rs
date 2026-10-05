#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn smoke_test() {
    let mut model = new_empty_model();
    model._set("A1", "=STDEV.P(10, 12, 23, 23, 16, 23, 21)");
    model._set("A2", "=STDEV.S(10, 12, 23, 23, 16, 23, 21)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"5.174505793");

    assert_eq!(model._get_text("A2"), *"5.589105048");
}

#[test]
fn numbers() {
    let mut model = new_empty_model();

    model._set("A2", "24");
    model._set("A3", "25");
    model._set("A4", "27");
    model._set("A5", "23");
    model._set("A6", "45");
    model._set("A7", "23.5");
    model._set("A8", "34");
    model._set("A9", "23");
    model._set("A10", "23");
    model._set("A11", "TRUE");
    model._set("A12", "'23");
    model._set("A13", "Text");
    model._set("A14", "FALSE");
    model._set("A15", "45");

    model._set("B1", "=AVEDEV(A2:A15)");
    model.evaluate();

    assert_eq!(model._get_text("B1"), *"7.25");
}

#[test]
fn arguments() {
    let mut model = new_empty_model();

    model._set("A1", "=AVEDEV()");
    model._set("A2", "=AVEDEV(1)");
    model._set("A3", "=AVEDEV(1, 2)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"0");
    assert_eq!(model._get_text("A3"), *"0.5");
}

// ── whole-column range and a spill beyond the used area ─────────────────────

// A whole-column range is clipped to the sheet's used area before it is
// walked. Inside an anchor, the column may be spilled on demand during the
// walk, past the bound the walk was clipped to. The skipped part is on
// record, so the spill restarts the pass and the second run sees it all.
#[test]
fn whole_column_sees_a_spill_beyond_the_used_area() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(1,1,AVEDEV(D:D))");
    model._set("C1", "=SEQUENCE(3,1,10)");
    model._set("D1", "=SEQUENCE(5)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1.2");
    assert_eq!(model.evaluation.restarts_in_last_evaluation, 1);

    model.evaluate();
    assert_eq!(model._get_text("A1"), "1.2");
    assert_eq!(model.evaluation.restarts_in_last_evaluation, 0);
}
