use crate::test::util::new_empty_model;

#[test]
fn fn_bitand() {
    let mut model = new_empty_model();
    model._set("A1", "=BITAND(1,5)");
    model._set("A2", "=BITAND(13, 25");

    model._set("B1", "=BITAND(1)");
    model._set("B2", "=BITAND(1, 2, 3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("A2"), "9");
    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_bitor() {
    let mut model = new_empty_model();
    model._set("A1", "=BITOR(1, 5)");
    model._set("A2", "=BITOR(13, 10");

    model._set("B1", "=BITOR(1)");
    model._set("B2", "=BITOR(1, 2, 3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "5");
    assert_eq!(model._get_text("A2"), "15");
    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_bitxor() {
    let mut model = new_empty_model();
    model._set("A1", "=BITXOR(1, 5)");
    model._set("A2", "=BITXOR(13, 25");

    model._set("B1", "=BITXOR(1)");
    model._set("B2", "=BITXOR(1, 2, 3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "4");
    assert_eq!(model._get_text("A2"), "20");
    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_bitlshift() {
    let mut model = new_empty_model();
    model._set("A1", "=BITLSHIFT(4, 2)");
    model._set("A2", "=BITLSHIFT(13, 7");

    model._set("B1", "=BITLSHIFT(1)");
    model._set("B2", "=BITLSHIFT(1, 2, 3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "16");
    assert_eq!(model._get_text("A2"), "1664");
    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_bitrshift() {
    let mut model = new_empty_model();
    model._set("A1", "=BITRSHIFT(4, 2)");
    model._set("A2", "=BITRSHIFT(13, 7");
    model._set("A3", "=BITRSHIFT(145, -3");

    model._set("B1", "=BITRSHIFT(1)");
    model._set("B2", "=BITRSHIFT(1, 2, 3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("A2"), "0");
    assert_eq!(model._get_text("A3"), "1160");
    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

// Excel does not pass this test (g sheets does)
#[test]
fn fn_bitshift_overflow() {
    let mut model = new_empty_model();
    model._set("A1", "=BITRSHIFT(12, -53)");
    model._set("A2", "=BITLSHIFT(12, 53)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
    assert_eq!(model._get_text("A2"), *"#NUM!");
}
