use crate::test::util::new_empty_model;

#[test]
fn arguments() {
    let mut model = new_empty_model();

    model._set("A1", "=DATEDIF()");
    model._set("A2", "=DATEDIF(\"1/1/2025\")");
    model._set("A3", "=DATEDIF(\"1/1/2025\", \"1/1/2026\")");
    model._set("A4", "=DATEDIF(\"1/1/2025\", \"1/1/2026\", \"D\")");
    model._set("A5", "=DATEDIF(\"1/1/2025\", \"1/1/2026\", \"D\", \"D\")");

    model._set("B1", "=YEARFRAC()");
    model._set("B2", "=YEARFRAC(\"1/1/2025\")");
    model._set("B3", "=YEARFRAC(\"1/1/2025\", \"1/1/2026\")");
    model._set("B4", "=YEARFRAC(\"1/1/2025\", \"1/1/2026\", 3)");
    model._set("B5", "=YEARFRAC(\"1/1/2025\", \"1/1/2026\", 3, 3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"365");
    assert_eq!(model._get_text("A5"), *"#ERROR!");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"1");
    assert_eq!(model._get_text("B4"), *"1");
    assert_eq!(model._get_text("B5"), *"#ERROR!");
}
