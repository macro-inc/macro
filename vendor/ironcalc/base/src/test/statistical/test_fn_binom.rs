#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_fn_binom_dist_smoke() {
    let mut model = new_empty_model();
    model._set("A1", "=BINOM.DIST(6, 10, 0.5, TRUE)");
    model._set("A2", "=BINOM.DIST(6, 10, 0.5, FALSE)");
    model._set("A3", "=BINOM.DIST(6, 10, 0.5)"); // wrong args
    model._set("A4", "=BINOM.DIST(6, 10, 0.5, TRUE, FALSE)"); // too many args
    model.evaluate();

    // P(X <= 6) for X ~ Bin(10, 0.5) = 0.828125
    assert_eq!(model._get_text("A1"), *"0.828125");

    // P(X = 6) for X ~ Bin(10, 0.5) = 0.205078125
    assert_eq!(model._get_text("A2"), *"0.205078125");

    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
}

#[test]
fn test_fn_binom_dist_range_smoke() {
    let mut model = new_empty_model();
    model._set("A1", "=BINOM.DIST.RANGE(60, 0.75, 48)");
    model._set("A2", "=BINOM.DIST.RANGE(60, 0.75, 45, 50)");
    model._set("A3", "=BINOM.DIST.RANGE(60, 1.2, 45, 50)"); // p > 1 -> #NUM!
    model._set("A4", "=BINOM.DIST.RANGE(60, 0.75, 50, 45)"); // lower > upper -> #NUM!");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0.083974967");

    assert_eq!(model._get_text("A2"), *"0.523629793");

    assert_eq!(model._get_text("A3"), *"#NUM!");
    assert_eq!(model._get_text("A4"), *"#NUM!");
}

#[test]
fn test_fn_binom_inv_smoke() {
    let mut model = new_empty_model();
    model._set("A1", "=BINOM.INV(6, 0.5, 0.75)");
    model._set("A2", "=BINOM.INV(6, 0.5, -0.1)"); // alpha < 0 -> #NUM!
    model._set("A3", "=BINOM.INV(6, 1.2, 0.75)"); // p > 1 -> #NUM!
    model._set("A4", "=BINOM.INV(6, 0.5)"); // args error
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"4");
    assert_eq!(model._get_text("A2"), *"#NUM!");
    assert_eq!(model._get_text("A3"), *"#NUM!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
}

#[test]
fn test_fn_binom_inv_small_trials_and_probabilities() {
    // These used to panic inside statrs' `inverse_cdf`.
    // Expected values: smallest k with CDF(k) >= alpha (scipy.stats.binom.ppf).
    let cases = [
        ("=BINOM.INV(1, 0.001, 0.1)", "0"),
        ("=BINOM.INV(1, 0.001, 0.9999)", "1"),
        ("=BINOM.INV(1, 0.5, 0.6)", "1"),
        ("=BINOM.INV(10, 0.01, 0.5)", "0"),
        ("=BINOM.INV(10, 0.01, 0.999)", "2"),
        ("=BINOM.INV(50, 0.001, 0.999)", "2"),
        ("=BINOM.INV(20, 0.3, 0.05)", "3"),
        ("=BINOM.INV(100, 0.99, 0.01)", "96"),
        ("=BINOM.INV(1000, 0.5, 0.5)", "500"),
        ("=BINOM.INV(1000000, 0.3, 0.9)", "300587"),
    ];
    let mut model = new_empty_model();
    for (row, (formula, _)) in cases.iter().enumerate() {
        model._set(&format!("A{}", row + 1), formula);
    }
    model.evaluate();
    for (row, (formula, expected)) in cases.iter().enumerate() {
        assert_eq!(
            model._get_text(&format!("A{}", row + 1)),
            *expected,
            "{formula}"
        );
    }
}

#[test]
fn test_fn_negbinom_dist_smoke() {
    let mut model = new_empty_model();

    // Valid: PMF (non-cumulative) and CDF (cumulative)
    model._set("A1", "=NEGBINOM.DIST(10, 5, 0.25, FALSE)");
    model._set("A2", "=NEGBINOM.DIST(10, 5, 0.25, TRUE)");

    // Wrong number of arguments -> #ERROR!
    model._set("A3", "=NEGBINOM.DIST(10, 5, 0.25)");
    model._set("A4", "=NEGBINOM.DIST(10, 5, 0.25, TRUE, FALSE)");

    // Domain errors:
    // p < 0 or p > 1 -> #NUM!
    model._set("A5", "=NEGBINOM.DIST(10, 5, 1.5, TRUE)");
    // number_f < 0 -> #NUM!
    model._set("A6", "=NEGBINOM.DIST(-1, 5, 0.25, TRUE)");
    // number_s < 1 -> #NUM!
    model._set("A7", "=NEGBINOM.DIST(10, 0, 0.25, TRUE)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0.05504866");
    assert_eq!(model._get_text("A2"), *"0.313514058");

    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#NUM!");
    assert_eq!(model._get_text("A6"), *"#NUM!");
    assert_eq!(model._get_text("A7"), *"#NUM!");
}

#[test]
fn test_arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=BINOM.DIST()");
    model._set("A2", "=BINOM.DIST(3)");
    model._set("A3", "=BINOM.DIST(3, 10)");
    model._set("A4", "=BINOM.DIST(3, 10, 0.3)");
    model._set("A5", "=BINOM.DIST(3, 10, 0.3, FALSE)");
    model._set("A6", "=BINOM.DIST(3, 10, 0.3, FALSE, TRUE)");

    model._set("B1", "=BINOM.DIST.RANGE()");
    model._set("B2", "=BINOM.DIST.RANGE(10)");
    model._set("B3", "=BINOM.DIST.RANGE(10, 0.3)");
    model._set("B4", "=BINOM.DIST.RANGE(10, 0.3, 3)");
    model._set("B5", "=BINOM.DIST.RANGE(10, 0.3, 3, 4)");
    model._set("B6", "=BINOM.DIST.RANGE(10, 0.3, 3, 4, TRUE)");

    model._set("C1", "=BINOM.INV()");
    model._set("C2", "=BINOM.INV(10)");
    model._set("C3", "=BINOM.INV(10, 0.5)");
    model._set("C4", "=BINOM.INV(10, 0.5, 0.5)");
    model._set("C5", "=BINOM.INV(10, 0.5, 0.5, TRUE)");

    model._set("D1", "=NEGBINOM.DIST()");
    model._set("D2", "=NEGBINOM.DIST(5)");
    model._set("D3", "=NEGBINOM.DIST(5, 10)");
    model._set("D4", "=NEGBINOM.DIST(5, 10, 0.3)");
    model._set("D5", "=NEGBINOM.DIST(5, 10, 0.3, TRUE)");
    model._set("D6", "=NEGBINOM.DIST(5, 10, 0.3, TRUE, FALSE)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"0.266827932");
    assert_eq!(model._get_text("A6"), *"#ERROR!");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"#ERROR!");
    assert_eq!(model._get_text("B4"), *"0.266827932");
    assert_eq!(model._get_text("B5"), *"0.466948881");
    assert_eq!(model._get_text("B6"), *"#ERROR!");

    assert_eq!(model._get_text("C1"), *"#ERROR!");
    assert_eq!(model._get_text("C2"), *"#ERROR!");
    assert_eq!(model._get_text("C3"), *"#ERROR!");
    assert_eq!(model._get_text("C4"), *"5");
    assert_eq!(model._get_text("C5"), *"#ERROR!");

    assert_eq!(model._get_text("D1"), *"#ERROR!");
    assert_eq!(model._get_text("D2"), *"#ERROR!");
    assert_eq!(model._get_text("D3"), *"#ERROR!");
    assert_eq!(model._get_text("D4"), *"#ERROR!");
    assert_eq!(model._get_text("D5"), *"0.003652521");
    assert_eq!(model._get_text("D6"), *"#ERROR!");
}

#[test]
fn test_booleans() {
    let mut model = new_empty_model();
    model._set("A1", "=BINOM.DIST(1,TRUE,0.7,TRUE)");
    model._set("A2", "=BINOM.DIST.RANGE(TRUE,0.3,0,1)");
    model._set("A3", "=BINOM.INV(TRUE,0.5,0.8)");
    model._set("A4", "=NEGBINOM.DIST(0,TRUE,0.7,TRUE)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"1");
    assert_eq!(model._get_text("A2"), *"1");
    assert_eq!(model._get_text("A3"), *"1");
    assert_eq!(model._get_text("A4"), *"0.7");
}
