#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_fn_norm_dist_smoke() {
    let mut model = new_empty_model();

    // Valid: standard normal as a special case
    model._set("A1", "=NORM.DIST(1, 0, 1, TRUE)");
    model._set("A2", "=NORM.DIST(1, 0, 1, FALSE)");

    // Wrong number of arguments -> #ERROR!
    model._set("A3", "=NORM.DIST(1, 0, 1)");
    model._set("A4", "=NORM.DIST(1, 0, 1, TRUE, FALSE)");

    // Domain errors: standard_dev <= 0 -> #NUM!
    model._set("A5", "=NORM.DIST(1, 0, 0, TRUE)");
    model._set("A6", "=NORM.DIST(1, 0, -1, TRUE)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0.841344746");
    assert_eq!(model._get_text("A2"), *"0.241970725");

    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#NUM!");
    assert_eq!(model._get_text("A6"), *"#NUM!");
}

#[test]
fn test_fn_norm_inv_smoke() {
    let mut model = new_empty_model();

    // Valid: median of standard normal
    model._set("A1", "=NORM.INV(0.5, 0, 1)");

    // Wrong number of arguments -> #ERROR!
    model._set("A2", "=NORM.INV(0.5, 0)");
    model._set("A3", "=NORM.INV(0.5, 0, 1, 0)");

    // Domain errors:
    // probability <= 0 or >= 1 -> #NUM!
    model._set("A4", "=NORM.INV(0, 0, 1)");
    model._set("A5", "=NORM.INV(1, 0, 1)");
    // standard_dev <= 0 -> #NUM!
    model._set("A6", "=NORM.INV(0.5, 0, 0)");

    model._set("A7", "=NORM.INV(0.7, 0.2, 1)");
    model._set("A8", "=NORM.INV(0.7, 0.2, 5)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0");

    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#NUM!");
    assert_eq!(model._get_text("A5"), *"#NUM!");
    assert_eq!(model._get_text("A6"), *"#NUM!");
    assert_eq!(model._get_text("A7"), *"0.724400513");
    assert_eq!(model._get_text("A8"), *"2.822002564");
}

#[test]
fn test_fn_norm_s_dist_smoke() {
    let mut model = new_empty_model();

    // Valid: CDF and PDF at z = 0
    model._set("A1", "=NORM.S.DIST(0, TRUE)");
    model._set("A2", "=NORM.S.DIST(0, FALSE)");

    // Wrong number of arguments -> #ERROR!
    model._set("A3", "=NORM.S.DIST(0)");
    model._set("A4", "=NORM.S.DIST(0, TRUE, FALSE)");

    model._set("A5", "=NORM.S.DIST(0.2, FALSE)");
    model._set("A6", "=NORM.S.DIST(2.2, TRUE)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0.5");
    assert_eq!(model._get_text("A2"), *"0.39894228");

    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");

    assert_eq!(model._get_text("A5"), *"0.391042694");
    assert_eq!(model._get_text("A6"), *"0.986096552");
}

#[test]
fn test_fn_norm_s_inv_smoke() {
    let mut model = new_empty_model();

    // Valid: symmetric points
    model._set("A1", "=NORM.S.INV(0.5)");
    model._set("A2", "=NORM.S.INV(0.841344746)");

    // Wrong number of arguments -> #ERROR!
    model._set("A3", "=NORM.S.INV()");
    model._set("A4", "=NORM.S.INV(0.5, 0)");

    // Domain errors: probability <= 0 or >= 1 -> #NUM!
    model._set("A5", "=NORM.S.INV(0)");
    model._set("A6", "=NORM.S.INV(1)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0");
    // Approximately 1
    assert_eq!(model._get_text("A2"), *"1");

    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#NUM!");
    assert_eq!(model._get_text("A6"), *"#NUM!");
}

#[test]
fn test_fn_norm_arguments() {
    let mut model = new_empty_model();

    model._set("A1", "=NORM.DIST()");
    model._set("A2", "=NORM.DIST(0)");
    model._set("A3", "=NORM.DIST(0, 0)");
    model._set("A4", "=NORM.DIST(0, 0, 1)");
    model._set("A5", "=NORM.DIST(0, 0, 1, TRUE)");
    model._set("A6", "=NORM.DIST(0, 0, 1, TRUE, 1)");

    model._set("B1", "=NORM.INV()");
    model._set("B2", "=NORM.INV(0.5)");
    model._set("B3", "=NORM.INV(0.5, 40)");
    model._set("B4", "=NORM.INV(0.5, 40, 1.5)");
    model._set("B5", "=NORM.INV(0.5, 40, 1.5, 1)");

    model._set("C1", "=NORM.S.DIST()");
    model._set("C2", "=NORM.S.DIST(0)");
    model._set("C3", "=NORM.S.DIST(0, TRUE)");
    model._set("C4", "=NORM.S.DIST(0, TRUE, 1)");

    model._set("D1", "=NORM.S.INV()");
    model._set("D2", "=NORM.S.INV(0.5)");
    model._set("D3", "=NORM.S.INV(0.5, 1)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"0.5");
    assert_eq!(model._get_text("A6"), *"#ERROR!");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"#ERROR!");
    assert_eq!(model._get_text("B4"), *"40");
    assert_eq!(model._get_text("B5"), *"#ERROR!");

    assert_eq!(model._get_text("C1"), *"#ERROR!");
    assert_eq!(model._get_text("C2"), *"#ERROR!");
    assert_eq!(model._get_text("C3"), *"0.5");
    assert_eq!(model._get_text("C4"), *"#ERROR!");

    assert_eq!(model._get_text("D1"), *"#ERROR!");
    assert_eq!(model._get_text("D2"), *"0");
    assert_eq!(model._get_text("D3"), *"#ERROR!");
}
