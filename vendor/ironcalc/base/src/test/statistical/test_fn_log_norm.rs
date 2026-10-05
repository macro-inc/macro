#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_fn_log_norm_dist_smoke() {
    let mut model = new_empty_model();

    // Valid: CDF and PDF
    model._set("A1", "=LOGNORM.DIST(4, 3.5, 1.2, TRUE)");
    model._set("A2", "=LOGNORM.DIST(4, 3.5, 1.2, FALSE)");

    // Wrong number of arguments -> #ERROR!
    model._set("A3", "=LOGNORM.DIST(4, 3.5, 1.2)");
    model._set("A4", "=LOGNORM.DIST(4, 3.5, 1.2, TRUE, FALSE)");

    // Domain errors:
    // x <= 0 -> #NUM!
    model._set("A5", "=LOGNORM.DIST(0, 3.5, 1.2, TRUE)");
    // std_dev <= 0 -> #NUM!
    model._set("A6", "=LOGNORM.DIST(4, 3.5, 0, TRUE)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0.039083556");
    assert_eq!(model._get_text("A2"), *"0.017617597");

    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#NUM!");
    assert_eq!(model._get_text("A6"), *"#NUM!");
}

#[test]
fn test_fn_log_norm_inv_smoke() {
    let mut model = new_empty_model();

    // Valid call
    model._set("A1", "=LOGNORM.INV(0.5, 3.5, 1.2)");

    // Wrong number of arguments -> #ERROR!
    model._set("A2", "=LOGNORM.INV(0.5, 3.5)");
    model._set("A3", "=LOGNORM.INV(0.5, 3.5, 1.2, 0)");

    // Domain errors:
    // probability <= 0 or >= 1 -> #NUM!
    model._set("A4", "=LOGNORM.INV(0, 3.5, 1.2)");
    model._set("A5", "=LOGNORM.INV(1, 3.5, 1.2)");
    // std_dev <= 0 -> #NUM!
    model._set("A6", "=LOGNORM.INV(0.5, 3.5, 0)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"33.115451959");

    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#NUM!");
    assert_eq!(model._get_text("A5"), *"#NUM!");
    assert_eq!(model._get_text("A6"), *"#NUM!");
}

#[test]
fn test_fn_log_norm_arguments() {
    let mut model = new_empty_model();

    model._set("A1", "=LOGNORM.DIST()");
    model._set("A2", "=LOGNORM.DIST(0.5)");
    model._set("A3", "=LOGNORM.DIST(0.5, 3.5)");
    model._set("A4", "=LOGNORM.DIST(0.5, 3.5, 1.2)");
    model._set("A5", "=LOGNORM.DIST(0.5, 3.5, 1.2, 0)");
    model._set("A6", "=LOGNORM.DIST(0.5, 3.5, 1.2, 0, 1)");

    model._set("B1", "=LOGNORM.INV()");
    model._set("B2", "=LOGNORM.INV(0.5)");
    model._set("B3", "=LOGNORM.INV(0.5, 3.5)");
    model._set("B4", "=LOGNORM.INV(0.5, 3.5, 1.2)");
    model._set("B5", "=LOGNORM.INV(0.5, 3.5, 1.2, 0)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"0.001483811");
    assert_eq!(model._get_text("A6"), *"#ERROR!");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"#ERROR!");
    assert_eq!(model._get_text("B4"), *"33.115451959");
    assert_eq!(model._get_text("B5"), *"#ERROR!");
}
