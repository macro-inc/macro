#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=CEILING()");
    model._set("A2", "=CEILING(5.2)");
    model._set("A3", "=CEILING(5.2, 2)");
    model._set("A4", "=CEILING(5.2, 2, 3)");

    model._set("A5", "=CEILING.PRECISE()");
    model._set("A6", "=CEILING.PRECISE(5.2)");
    model._set("A7", "=CEILING.PRECISE(5.2, 2)");
    model._set("A8", "=CEILING.PRECISE(5.2, 2, 3)");

    model._set("A9", "=CEILING.MATH()");
    model._set("A10", "=CEILING.MATH(5.2)");
    model._set("A11", "=CEILING.MATH(5.2, 2)");
    model._set("A12", "=CEILING.MATH(5.2, 2, 3)");
    model._set("A13", "=CEILING.MATH(5.2, 2, 3, 4)");

    model._set("B1", "=FLOOR()");
    model._set("B2", "=FLOOR(5.2)");
    model._set("B3", "=FLOOR(5.2, 2)");
    model._set("B4", "=FLOOR(5.2, 2, 3)");

    model._set("B5", "=FLOOR.PRECISE()");
    model._set("B6", "=FLOOR.PRECISE(5.2)");
    model._set("B7", "=FLOOR.PRECISE(5.2, 2)");
    model._set("B8", "=FLOOR.PRECISE(5.2, 2, 3)");

    model._set("B9", "=FLOOR.MATH()");
    model._set("B10", "=FLOOR.MATH(5.2)");
    model._set("B11", "=FLOOR.MATH(5.2, 2)");
    model._set("B12", "=FLOOR.MATH(5.2, 2, 3)");
    model._set("B13", "=FLOOR.MATH(5.2, 2, 3, 4)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"6");
    assert_eq!(model._get_text("A4"), *"#ERROR!");

    assert_eq!(model._get_text("A5"), *"#ERROR!");
    assert_eq!(model._get_text("A6"), *"6");
    assert_eq!(model._get_text("A7"), *"6");
    assert_eq!(model._get_text("A8"), *"#ERROR!");

    assert_eq!(model._get_text("A9"), *"#ERROR!");
    assert_eq!(model._get_text("A10"), *"6");
    assert_eq!(model._get_text("A11"), *"6");
    assert_eq!(model._get_text("A12"), *"6");
    assert_eq!(model._get_text("A13"), *"#ERROR!");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"4");
    assert_eq!(model._get_text("B4"), *"#ERROR!");

    assert_eq!(model._get_text("B5"), *"#ERROR!");
    assert_eq!(model._get_text("B6"), *"5");
    assert_eq!(model._get_text("B7"), *"4");
    assert_eq!(model._get_text("B8"), *"#ERROR!");

    assert_eq!(model._get_text("B9"), *"#ERROR!");
    assert_eq!(model._get_text("B10"), *"5");
    assert_eq!(model._get_text("B11"), *"4");
    assert_eq!(model._get_text("B12"), *"4");
    assert_eq!(model._get_text("B13"), *"#ERROR!");
}
