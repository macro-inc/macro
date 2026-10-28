#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_fn_expon_dist_smoke() {
    let mut model = new_empty_model();

    // λ = 1, x = 0.5
    // CDF = 1 - e^-0.5 ≈ 0.393469340
    // PDF = e^-0.5 ≈ 0.606530660
    model._set("A1", "=EXPON.DIST(0.5, 1, TRUE)");
    model._set("A2", "=EXPON.DIST(0.5, 1, FALSE)");

    // Wrong number of args
    model._set("A3", "=EXPON.DIST()");
    model._set("A4", "=EXPON.DIST(0.5)");
    model._set("A5", "=EXPON.DIST(0.5, 1)");
    model._set("A6", "=EXPON.DIST(0.5, 1, TRUE, FALSE)");

    // Domain errors
    model._set("A7", "=EXPON.DIST(-1, 1, TRUE)"); // x < 0
    model._set("A8", "=EXPON.DIST(0.5, 0, TRUE)"); // lambda <= 0

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0.39346934");
    assert_eq!(model._get_text("A2"), *"0.60653066");

    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#ERROR!");
    assert_eq!(model._get_text("A6"), *"#ERROR!");

    assert_eq!(model._get_text("A7"), *"#NUM!");
    assert_eq!(model._get_text("A8"), *"#NUM!");
}
