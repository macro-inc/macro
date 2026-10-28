#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_fn_f_dist_sanity() {
    let mut model = new_empty_model();
    model._set("A1", "=F.DIST(15, 6, 4, TRUE)");
    model._set("A2", "=F.DIST(15, 6, 4, FALSE)");
    model._set("A3", "=F.DIST(15, 6, 4)");
    model._set("A4", "=F.DIST(15, 6, 4, TRUE, FALSE)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"0.989741952");
    assert_eq!(model._get_text("A2"), *"0.001271447");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
}

#[test]
fn test_fn_f_dist_rt_sanity() {
    let mut model = new_empty_model();

    // Valid call
    model._set("A1", "=F.DIST.RT(15, 6, 4)");
    // Too few args
    model._set("A2", "=F.DIST.RT(15, 6)");
    // Too many args
    model._set("A3", "=F.DIST.RT(15, 6, 4, 1)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0.010258048");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

#[test]
fn test_fn_f_inv_sanity() {
    let mut model = new_empty_model();

    // Valid call: left-tail inverse
    model._set("A1", "=F.INV(0.9897419523940, 6, 4)");

    // Too many args
    model._set("A2", "=F.INV(0.5, 6, 4, 2)");

    // Too few args
    model._set("A3", "=F.INV(0.5, 6)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"15");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

#[test]
fn test_fn_f_inv_rt_sanity() {
    let mut model = new_empty_model();

    // Valid call: left-tail inverse
    model._set("A1", "=F.INV.RT(0.0102580476059808, 6, 4)");

    // Too many args
    model._set("A2", "=F.INV.RT(0.5, 6, 4, 2)");

    // Too few args
    model._set("A3", "=F.INV.RT(0.5, 6)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"15");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}
