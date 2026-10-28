#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn datevalue_timevalue_arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=DATEVALUE()");
    model._set("A2", "=TIMEVALUE()");
    model._set("A3", "=DATEVALUE(\"2000-01-01\")");
    model._set("A4", "=TIMEVALUE(\"12:00:00\")");
    model._set("A5", "=DATEVALUE(1,2)");
    model._set("A6", "=TIMEVALUE(1,2)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"36526");
    assert_eq!(model._get_text("A4"), *"0.5");
    assert_eq!(model._get_text("A5"), *"#ERROR!");
    assert_eq!(model._get_text("A6"), *"#ERROR!");
}
