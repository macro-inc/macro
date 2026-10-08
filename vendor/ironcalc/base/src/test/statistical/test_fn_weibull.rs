#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_fn_weibull_dist_smoke() {
    let mut model = new_empty_model();

    // Valid: CDF and PDF for x = 1, alpha = 2, beta = 1
    model._set("A1", "=WEIBULL.DIST(1, 2, 1, TRUE)");
    model._set("A2", "=WEIBULL.DIST(1, 2, 1, FALSE)");

    // Wrong number of arguments -> #ERROR!
    model._set("A3", "=WEIBULL.DIST(1, 2, 1)");
    model._set("A4", "=WEIBULL.DIST(1, 2, 1, TRUE, FALSE)");

    // Domain errors:
    // x < 0  -> #NUM!
    model._set("A5", "=WEIBULL.DIST(-1, 2, 1, TRUE)");
    // alpha <= 0 -> #NUM!
    model._set("A6", "=WEIBULL.DIST(1, 0, 1, TRUE)");
    model._set("A7", "=WEIBULL.DIST(1, -1, 1, TRUE)");
    // beta <= 0 -> #NUM!
    model._set("A8", "=WEIBULL.DIST(1, 2, 0, TRUE)");
    model._set("A9", "=WEIBULL.DIST(1, 2, -1, TRUE)");

    model.evaluate();

    // 1 - e^-1
    assert_eq!(model._get_text("A1"), *"0.632120559");
    // 2 * e^-1
    assert_eq!(model._get_text("A2"), *"0.735758882");

    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#NUM!");
    assert_eq!(model._get_text("A6"), *"#NUM!");
    assert_eq!(model._get_text("A7"), *"#NUM!");
    assert_eq!(model._get_text("A8"), *"#NUM!");
    assert_eq!(model._get_text("A9"), *"#NUM!");
}
