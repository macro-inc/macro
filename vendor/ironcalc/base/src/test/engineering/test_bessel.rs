use crate::test::util::new_empty_model;

#[test]
fn fn_besseli() {
    let mut model = new_empty_model();

    model._set("B1", "=BESSELI()");
    model._set("B2", "=BESSELI(1,2, 1)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_besselj() {
    let mut model = new_empty_model();

    model._set("B1", "=BESSELJ()");
    model._set("B2", "=BESSELJ(1,2, 1)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_besselk() {
    let mut model = new_empty_model();

    model._set("B1", "=BESSELK()");
    model._set("B2", "=BESSELK(1,2, 1)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_bessely() {
    let mut model = new_empty_model();

    model._set("B1", "=BESSELY()");
    model._set("B2", "=BESSELY(1,2, 1)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}
