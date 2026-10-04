use crate::test::util::new_empty_model;

#[test]
fn fn_getstep() {
    let mut model = new_empty_model();
    model._set("A1", "=GESTEP(7, 4.6)");
    model._set("A2", "=GESTEP(45, 45)");
    model._set("A3", "=GESTEP(-7, -6)");
    model._set("A4", "=GESTEP(0.1)");
    model._set("A5", "=GESTEP(-0.1)");

    model._set("B1", "=GESTEP()");
    model._set("B2", "=GESTEP(1,2,3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"1");
    assert_eq!(model._get_text("A2"), *"1");
    assert_eq!(model._get_text("A3"), *"0");
    assert_eq!(model._get_text("A4"), *"1");
    assert_eq!(model._get_text("A5"), *"0");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_delta() {
    let mut model = new_empty_model();
    model._set("A1", "=DELTA(7, 7)");
    model._set("A2", "=DELTA(-7, -7)");
    model._set("A3", "=DELTA(-7, 7)");
    model._set("A4", "=DELTA(5, 0.5)");
    model._set("A5", "=DELTA(-0, 0)");

    model._set("B1", "=DELTA()");
    model._set("B2", "=DELTA(1,2,3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"1");
    assert_eq!(model._get_text("A2"), *"1");
    assert_eq!(model._get_text("A3"), *"0");
    assert_eq!(model._get_text("A4"), *"0");
    assert_eq!(model._get_text("A5"), *"1");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_delta_misc() {
    let mut model = new_empty_model();
    model._set("A1", "=3+1e-16");
    model._set("A2", "=3");
    model._set("A3", "=3+1e-15");
    model._set("B1", "=DELTA(A1, A2)");
    model._set("B2", "=DELTA(A1, A3)");

    model._set("B1", "1");
    model._set("B2", "0");

    model.evaluate();

    assert_eq!(model._get_text("B1"), *"1");
}
