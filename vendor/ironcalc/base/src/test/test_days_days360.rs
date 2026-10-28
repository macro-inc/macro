use crate::test::util::new_empty_model;

#[test]
fn test_days_days360_arguments() {
    let mut model = new_empty_model();

    model._set("A1", "=DAYS()");
    model._set("A2", "=DAYS(DATE(2026,8,6))");
    model._set("A3", "=DAYS(DATE(2026,8,8), DATE(2026,8,6))");
    model._set(
        "A4",
        "=DAYS(DATE(2026,8,8), DATE(2026,8,6), DATE(2026,8,4))",
    );

    model._set("B1", "=DAYS360()");
    model._set("B2", "=DAYS360(DATE(2026,8,6))");
    model._set("B3", "=DAYS360(DATE(2026,8,8), DATE(2026,8,6))");
    model._set("B4", "=DAYS360(DATE(2026,8,8), DATE(2026,8,6), TRUE)");
    model._set(
        "B5",
        "=DAYS360(DATE(2026,8,8), DATE(2026,8,6), TRUE, FALSE)",
    );

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"2");
    assert_eq!(model._get_text("A4"), *"#ERROR!");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"-2");
    assert_eq!(model._get_text("B4"), *"-2");
    assert_eq!(model._get_text("B5"), *"#ERROR!");
}
