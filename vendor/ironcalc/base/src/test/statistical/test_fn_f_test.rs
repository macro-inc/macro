#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_fn_f_test_sanity() {
    let mut model = new_empty_model();

    // Valid call
    model._set("A1", "=F.TEST(A2:A7, B2:B7)");
    model._set("A2", "9");
    model._set("A3", "12");
    model._set("A4", "14");
    model._set("A5", "16");
    model._set("A6", "18");
    model._set("A7", "20");
    model._set("B2", "11");
    model._set("B3", "10");
    model._set("B4", "15");
    model._set("B5", "17");
    model._set("B6", "19");
    model._set("B7", "21");

    // Too few args
    model._set("A8", "=F.TEST(A2:A7)");

    // Too many args
    model._set("A9", "=F.TEST(A2:A7, B2:B7, C2:C7)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0.859284302");
    assert_eq!(model._get_text("A8"), *"#ERROR!");
    assert_eq!(model._get_text("A9"), *"#ERROR!");
}
