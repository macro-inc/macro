use crate::test::util::new_empty_model;

#[test]
fn fn_convert() {
    let mut model = new_empty_model();
    model._set("A1", r#"=CONVERT(1, "lbm", "kg")"#);
    model._set("A2", r#"=CONVERT(68, "F", "C")"#);
    model._set("A3", r#"=CONVERT(2.5, "ft", "sec")"#);
    model._set("A4", r#"=CONVERT(CONVERT(100,"ft","m"),"ft","m""#);

    model._set("B1", "6");

    model._set("A5", r#"=CONVERT(B1,"C","F")"#);
    model._set("A6", r#"=CONVERT(B1,"tsp","tbs")"#);
    model._set("A7", r#"=CONVERT(B1,"gal","l")"#);
    model._set("A8", r#"=CONVERT(B1,"mi","km")"#);
    model._set("A9", r#"=CONVERT(B1,"km","mi")"#);
    model._set("A10", r#"=CONVERT(B1,"in","ft")"#);
    model._set("A11", r#"=CONVERT(B1,"cm","in")"#);

    model.evaluate();

    assert_eq!(model._get_text("A1"), "0.45359237");
    assert_eq!(model._get_text("A2"), "19.65");
    assert_eq!(model._get_text("A3"), "#N/A");
    assert_eq!(model._get_text("A4"), "9.290304");

    assert_eq!(model._get_text("A5"), "42.8");
    assert_eq!(model._get_text("A6"), "2");
    assert_eq!(model._get_text("A7"), "22.712470704"); //22.71741274");
    assert_eq!(model._get_text("A8"), "9.656064");
    assert_eq!(model._get_text("A9"), "3.728227153");
    assert_eq!(model._get_text("A10"), "0.5");
    assert_eq!(model._get_text("A11"), "2.362204724");
}
