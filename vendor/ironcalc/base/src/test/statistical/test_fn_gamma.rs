#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;
#[test]
fn test_fn_gamma() {
    let mut model = new_empty_model();

    // Valid inputs
    model._set("A1", "=GAMMA(1)");
    model._set("A2", "=GAMMA(5)");
    model._set("A3", "=GAMMA(2.5)");

    // Domain errors: x <= 0 -> #NUM!
    model._set("A4", "=GAMMA(0)");
    model._set("A5", "=GAMMA(-1)");

    // Wrong number of arguments -> #ERROR!
    model._set("A6", "=GAMMA()");
    model._set("A7", "=GAMMA(0.1, 2)");

    // Should accept booleans
    model._set("A8", "=GAMMA(TRUE)");
    model._set("A9", "=GAMMA(FALSE)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"1");
    assert_eq!(model._get_text("A2"), *"24");
    assert_eq!(model._get_text("A3"), *"1.329340388");

    assert_eq!(model._get_text("A4"), *"#NUM!");
    assert_eq!(model._get_text("A5"), *"#NUM!");

    assert_eq!(model._get_text("A6"), *"#ERROR!");
    assert_eq!(model._get_text("A7"), *"#ERROR!");

    assert_eq!(model._get_text("A8"), *"1");
    assert_eq!(model._get_text("A9"), *"#NUM!");
}

#[test]
fn test_fn_gamma_dist() {
    let mut model = new_empty_model();

    // Valid inputs
    model._set("A1", "=GAMMA.DIST(10, 9, 2, TRUE)");
    model._set("A2", "=GAMMA.DIST(2, 2, 2, TRUE)");
    model._set("A3", "=GAMMA.DIST(0, 9, 2, FALSE)");

    // Wrong number of arguments -> #ERROR!
    model._set("A4", "=GAMMA.DIST()");
    model._set("A5", "=GAMMA.DIST(10)");
    model._set("A6", "=GAMMA.DIST(10, 9)");
    model._set("A7", "=GAMMA.DIST(10, 9, 2)");
    model._set("A8", "=GAMMA.DIST(10, 9, 2, TRUE, 2)");

    // Should accept booleans
    model._set("A9", "=GAMMA.DIST(TRUE, 1, 2, TRUE)");
    model._set("A10", "=GAMMA.DIST(10, TRUE, 2, TRUE)");
    model._set("A11", "=GAMMA.DIST(10, 9, TRUE, TRUE)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0.068093635");
    assert_eq!(model._get_text("A2"), *"0.264241118");
    assert_eq!(model._get_text("A3"), *"0");

    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#ERROR!");
    assert_eq!(model._get_text("A6"), *"#ERROR!");
    assert_eq!(model._get_text("A7"), *"#ERROR!");
    assert_eq!(model._get_text("A8"), *"#ERROR!");

    assert_eq!(model._get_text("A9"), *"0.39346934");
    assert_eq!(model._get_text("A10"), *"0.993262053");
    assert_eq!(model._get_text("A11"), *"0.667180321");
}

#[test]
fn test_fn_gamma_inv() {
    let mut model = new_empty_model();

    // Valid inputs
    model._set("A1", "=GAMMA.INV(0.5, 9, 2)");
    model._set("A2", "=GAMMA.INV(0.25, 9, 2)");
    model._set("A3", "=GAMMA.INV(0.75, 9, 2)");

    // Wrong number of arguments -> #ERROR!
    model._set("A4", "=GAMMA.INV()");
    model._set("A5", "=GAMMA.INV(0.5)");
    model._set("A6", "=GAMMA.INV(0.5, 9)");
    model._set("A7", "=GAMMA.INV(0.5, 9, 2, 1)");

    // Should accept booleans
    model._set("A8", "=GAMMA.INV(TRUE, 1, 2)");
    model._set("A9", "=GAMMA.INV(0.5, TRUE, 2)");
    model._set("A10", "=GAMMA.INV(0.5, 9, TRUE)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"17.337902369");
    assert_eq!(model._get_text("A2"), *"13.67529035");
    assert_eq!(model._get_text("A3"), *"21.604889796");

    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#ERROR!");
    assert_eq!(model._get_text("A6"), *"#ERROR!");
    assert_eq!(model._get_text("A7"), *"#ERROR!");

    assert_eq!(model._get_text("A8"), *"#NUM!");
    assert_eq!(model._get_text("A9"), *"1.386294361");
    assert_eq!(model._get_text("A10"), *"8.668951184");
}

#[test]
fn test_fn_gammaln() {
    let mut model = new_empty_model();

    // Valid inputs
    model._set("A1", "=GAMMALN(0.5)");

    // Wrong number of arguments -> #ERROR!
    model._set("A2", "=GAMMALN()");
    model._set("A3", "=GAMMALN(0.5, 9)");

    // Should accept booleans
    model._set("A4", "=GAMMALN(FALSE)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0.572364943");

    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");

    assert_eq!(model._get_text("A4"), *"#NUM!");
}

#[test]
fn test_fn_gammaln_precise() {
    let mut model = new_empty_model();

    // Valid inputs
    model._set("A1", "=GAMMALN.PRECISE(0.5)");

    // Wrong number of arguments -> #ERROR!
    model._set("A2", "=GAMMALN.PRECISE()");
    model._set("A3", "=GAMMALN.PRECISE(0.5, 9)");

    // Should accept booleans
    model._set("A4", "=GAMMALN.PRECISE(FALSE)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0.572364943");

    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");

    assert_eq!(model._get_text("A4"), *"#NUM!");
}
