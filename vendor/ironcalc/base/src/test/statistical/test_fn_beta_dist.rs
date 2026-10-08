#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn empty_argument_cumulative() {
    let mut model = new_empty_model();

    model._set("A1", "=BETA.DIST(0.234, 2, 2.5, , 0.15, 1.2)");
    model._set("A2", "=BETA.DIST(0.234, 2, 2.5, C15 , 0.15, 1.2)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0.588288667");
    assert_eq!(model._get_text("A2"), *"0.588288667");
}

#[test]
fn arguments() {
    let mut model = new_empty_model();

    model._set("A1", "=BETA.DIST()");
    model._set("A2", "=BETA.DIST(3)");
    model._set("A3", "=BETA.DIST(3, 2)");
    model._set("A4", "=BETA.DIST(3, 2, 3)");
    model._set("A5", "=BETA.DIST(3, 2, 3, 1)");
    model._set("A6", "=BETA.DIST(3, 2, 3, 1, 1)");
    model._set("A7", "=BETA.DIST(3, 2, 3, 1, 1, 10)");
    model._set("A8", "=BETA.DIST(3, 2, 3, 1, 1, 10, 1)");

    model._set("A9", "=BETA.DIST(0.23, 2, 3, 1)"); // Missing interval parameters
    model._set("A10", "=BETA.DIST(0.23, 2, 3, 1, 0)"); // Missing interval end
    model._set("A11", "=BETA.DIST(0.23, 2, 3, 1, , 1)"); // Empty interval start

    model._set("B1", "=BETA.INV()");
    model._set("B2", "=BETA.INV(0.5)");
    model._set("B3", "=BETA.INV(0.5, 2)");
    model._set("B4", "=BETA.INV(0.5, 2, 2)"); // Missing interval parameters
    model._set("B5", "=BETA.INV(0.5, 2, 2, 0)"); // Missing interval end
    model._set("B6", "=BETA.INV(0.5, 2, 2, 0, 1)");
    model._set("B7", "=BETA.INV(0.5, 2, 2, 0, 1, 10)");

    model._set("B8", "=BETA.INV(0.5, 2, 2, , 1)"); // Empty interval start

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#NUM!");
    assert_eq!(model._get_text("A6"), *"#NUM!");
    assert_eq!(model._get_text("A7"), *"0.215820759");
    assert_eq!(model._get_text("A8"), *"#ERROR!");

    assert_eq!(model._get_text("A9"), *"0.22845923");
    assert_eq!(model._get_text("A10"), *"0.22845923");
    assert_eq!(model._get_text("A11"), *"0.22845923");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"#ERROR!");
    assert_eq!(model._get_text("B4"), *"0.5");
    assert_eq!(model._get_text("B5"), *"0.5");
    assert_eq!(model._get_text("B6"), *"0.5");
    assert_eq!(model._get_text("B7"), *"#ERROR!");
}
