#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn fn_arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=CSC()");
    model._set("A2", "=SEC()");
    model._set("A3", "=COT()");

    model._set("A4", "=CSCH()");
    model._set("A5", "=SECH()");
    model._set("A6", "=COTH()");

    model._set("A7", "=ACOT()");
    model._set("A8", "=ACOTH()");

    model._set("B1", "=CSC(1, 2)");
    model._set("B2", "=SEC(1, 2)");
    model._set("B3", "=COT(1, 2)");

    model._set("B4", "=CSCH(1, 2)");
    model._set("B5", "=SECH(1, 2)");
    model._set("B6", "=COTH(1, 2)");

    model._set("B7", "=ACOT(1, 2)");
    model._set("B8", "=ACOTH(1, 2)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");

    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#ERROR!");
    assert_eq!(model._get_text("A6"), *"#ERROR!");

    assert_eq!(model._get_text("A7"), *"#ERROR!");
    assert_eq!(model._get_text("A8"), *"#ERROR!");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"#ERROR!");

    assert_eq!(model._get_text("B4"), *"#ERROR!");
    assert_eq!(model._get_text("B5"), *"#ERROR!");
    assert_eq!(model._get_text("B6"), *"#ERROR!");

    assert_eq!(model._get_text("B7"), *"#ERROR!");
    assert_eq!(model._get_text("B8"), *"#ERROR!");
}
