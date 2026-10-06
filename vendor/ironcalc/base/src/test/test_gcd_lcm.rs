#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

const MAX_LCM_GCD: i64 = 2_i64.pow(53);

#[test]
fn arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=LCM()");
    model._set("A2", "=LCM(2, 3)");

    model._set("A3", "=GCD()");
    model._set("A4", "=GCD(10, 25)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"6");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"5");
}

#[test]
fn arrays() {
    let mut model = new_empty_model();
    model._set("A1", "=LCM({2, 3}, {4, 5, 6})");
    model._set("A2", "=GCD({10, 25}, {35, 40, 50})");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"60");
    assert_eq!(model._get_text("A2"), *"5");
}

#[test]
fn invalid_inputs() {
    let mut model = new_empty_model();
    model._set("A1", "=LCM(-5, 6)");
    model._set("A2", "=LCM(\"-5\", 6)");
    model._set("A3", "=GCD(-5, 6)");
    model._set("A4", "=GCD(\"-5\", 6)");

    model._set("A5", "=LCM({1, 2, 3}, {4, -5, 6})");
    model._set("A6", "=LCM({1, 2, 3}, {4, \"-5\", 6})");
    model._set("A7", "=GCD({1, 2, 3}, {4, -5, 6})");
    model._set("A8", "=GCD({1, 2, 3}, {4, \"-5\", 6})");

    model._set("B1", &format!("=LCM({}, 6)", MAX_LCM_GCD + 1));
    model._set("B2", &format!("=LCM(\"{}\", 6)", MAX_LCM_GCD + 1));
    model._set("B3", &format!("=GCD({}, 6)", MAX_LCM_GCD + 1));
    model._set("B4", &format!("=GCD(\"{}\", 6)", MAX_LCM_GCD + 1));

    model._set(
        "B5",
        &format!("=LCM({{1, 2, 3}}, {{4, {}, 6}})", MAX_LCM_GCD + 1),
    );
    model._set(
        "B6",
        &format!("=LCM({{1, 2, 3}}, {{4, \"{}\", 6}})", MAX_LCM_GCD + 1),
    );
    model._set(
        "B7",
        &format!("=GCD({{1, 2, 3}}, {{4, {}, 6}})", MAX_LCM_GCD + 1),
    );
    model._set(
        "B8",
        &format!("=GCD({{1, 2, 3}}, {{4, \"{}\", 6}})", MAX_LCM_GCD + 1),
    );

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#NUM!");
    assert_eq!(model._get_text("A2"), *"#NUM!");
    assert_eq!(model._get_text("A3"), *"#NUM!");
    assert_eq!(model._get_text("A4"), *"#NUM!");

    assert_eq!(model._get_text("A5"), *"#NUM!");
    assert_eq!(model._get_text("A6"), *"#NUM!");
    assert_eq!(model._get_text("A7"), *"#NUM!");
    assert_eq!(model._get_text("A8"), *"#NUM!");

    assert_eq!(model._get_text("B1"), *"#NUM!");
    assert_eq!(model._get_text("B2"), *"#NUM!");
    assert_eq!(model._get_text("B3"), *"#NUM!");
    assert_eq!(model._get_text("B4"), *"#NUM!");

    assert_eq!(model._get_text("B5"), *"#NUM!");
    assert_eq!(model._get_text("B6"), *"#NUM!");
    assert_eq!(model._get_text("B7"), *"#NUM!");
    assert_eq!(model._get_text("B8"), *"#NUM!");
}

// ── whole-column range and a spill beyond the used area ─────────────────────

// A whole-column range is clipped to the sheet's used area before it is
// walked. Inside an anchor, the column may be spilled on demand during the
// walk, past the bound the walk was clipped to. The skipped part is on
// record, so the spill restarts the pass and the second run sees it all.
#[test]
fn whole_column_sees_a_spill_beyond_the_used_area() {
    let cases = [("GCD(D:D)", "1"), ("LCM(D:D)", "60")];
    for (formula, expected) in cases {
        let mut model = new_empty_model();
        model._set("A1", &format!("=SEQUENCE(1,1,{formula})"));
        model._set("C1", "=SEQUENCE(3,1,10)");
        model._set("D1", "=SEQUENCE(5)");
        model.evaluate();
        assert_eq!(model._get_text("A1"), expected, "{formula}");
        assert_eq!(model.evaluation.restarts_in_last_evaluation, 1, "{formula}");
    }
}
