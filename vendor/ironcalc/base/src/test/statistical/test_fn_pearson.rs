#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_fn_chisq_test_smoke() {
    let mut model = new_empty_model();
    model._set("A2", "48");
    model._set("A3", "32");
    model._set("A4", "12");
    model._set("A5", "1");
    model._set("A6", "'13");
    model._set("A7", "TRUE");
    model._set("A8", "1");
    model._set("A9", "13");
    model._set("A10", "15");

    model._set("B2", "55");
    model._set("B3", "34");
    model._set("B4", "13");
    model._set("B5", "blah");
    model._set("B6", "13");
    model._set("B7", "1");
    model._set("B8", "TRUE");
    model._set("B9", "'14");
    model._set("B10", "16");

    model._set("C1", "=PEARSON(A2:A10, B2:B10)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), *"0.998381439");
}
