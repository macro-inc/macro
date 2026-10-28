#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_fn_poisson_dist_smoke() {
    let mut model = new_empty_model();

    // λ = 2, x = 3
    // P(X = 3)  ≈ 0.180447045
    // P(X <= 3) ≈ 0.857123461
    model._set("A1", "=POISSON.DIST(3, 2, FALSE)");
    model._set("A2", "=POISSON.DIST(3, 2, TRUE)");

    // Wrong arg count
    model._set("A3", "=POISSON.DIST(3, 2)");
    model._set("A4", "=POISSON.DIST(3, 2, TRUE, FALSE)");

    // Domain errors
    model._set("A5", "=POISSON.DIST(-1, 2, TRUE)"); // x < 0
    model._set("A6", "=POISSON.DIST(3, -2, TRUE)"); // mean < 0

    // λ = 0 special cases
    model._set("A7", "=POISSON.DIST(0, 0, FALSE)"); // 1
    model._set("A8", "=POISSON.DIST(1, 0, FALSE)"); // 0
    model._set("A9", "=POISSON.DIST(5, 0, TRUE)"); // 1

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0.180447044");
    assert_eq!(model._get_text("A2"), *"0.85712346");

    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#NUM!");
    assert_eq!(model._get_text("A6"), *"#NUM!");

    assert_eq!(model._get_text("A7"), *"1");
    assert_eq!(model._get_text("A8"), *"0");
    assert_eq!(model._get_text("A9"), *"1");
}

#[test]
fn test_fn_poisson_dist_arguments() {
    let mut model = new_empty_model();

    model._set("A1", "=POISSON.DIST()");
    model._set("A2", "=POISSON.DIST(2)");
    model._set("A3", "=POISSON.DIST(2, 5)");
    model._set("A4", "=POISSON.DIST(2, 5, TRUE)");
    model._set("A5", "=POISSON.DIST(2, 5, TRUE, 1)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"0.124652019");
    assert_eq!(model._get_text("A5"), *"#ERROR!");
}
