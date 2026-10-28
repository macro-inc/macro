#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn fn_offset_reference() {
    let mut model = new_empty_model();
    model._set("B1", "12");
    model._set("B2", "13");
    model._set("B3", "15");

    model._set("A1", "=SUM(B1:OFFSET($B$1,3,0))");
    model._set("A2", "=SUM(OFFSET(A1, 1, 1):B3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"40");
    assert_eq!(model._get_text("A2"), *"28");
}

// `@` meets OFFSET in the two directions that route through `get_reference`'s
// fallback arm (cast.rs): the `@` node must reach it as a reference (the
// intersected 1x1 range), not be dereferenced to a value.

#[test]
fn fn_offset_of_at_range() {
    // `@` UNDER OFFSET: the ref argument is an @-wrapped range. In D2, @B1:B4
    // intersects to B2; OFFSET(B2, 1, 0) -> B3.
    let mut model = new_empty_model();
    model._set("B1", "10");
    model._set("B2", "20");
    model._set("B3", "30");
    model._set("B4", "40");
    model._set("D2", "=OFFSET(@B1:B4, 1, 0)");
    model.evaluate();

    assert_eq!(model._get_text("D2"), *"30");
}

#[test]
fn fn_rows_of_at_offset() {
    // `@` OVER OFFSET: OFFSET(B1,0,0,4,1) -> B1:B4; `@` in D2 intersects it to
    // B2, a single cell, so ROWS is 1 (not 4).
    let mut model = new_empty_model();
    model._set("B1", "10");
    model._set("B2", "20");
    model._set("B3", "30");
    model._set("B4", "40");
    model._set("D2", "=ROWS(@OFFSET(B1, 0, 0, 4, 1))");
    model.evaluate();

    assert_eq!(model._get_text("D2"), *"1");
}
