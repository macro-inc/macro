#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn arguments() {
    let mut model = new_empty_model();
    // 01/01/2025 = serial number 45658
    // 01/01/2026 = serial number 46023
    model._set("A1", "=NETWORKDAYS()");
    model._set("A2", "=NETWORKDAYS(45658)");
    model._set("A3", "=NETWORKDAYS(45658, 46023)");
    model._set("A4", "=NETWORKDAYS(45658, 46023, 46000)");
    model._set("A5", "=NETWORKDAYS(45658, 46023, 5, 6)");

    model._set("B1", "=NETWORKDAYS.INTL()");
    model._set("B2", "=NETWORKDAYS.INTL(45658)");
    model._set("B3", "=NETWORKDAYS.INTL(45658, 46023)");
    model._set("B4", "=NETWORKDAYS.INTL(45658, 46023, 5)");
    model._set("B5", "=NETWORKDAYS.INTL(45658, 46023, 5, 46000)");
    model._set("B6", "=NETWORKDAYS.INTL(45658, 46023, 5, 46000, 5)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"262");
    assert_eq!(model._get_text("A4"), *"261");
    assert_eq!(model._get_text("A5"), *"#ERROR!");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"262");
    assert_eq!(model._get_text("B4"), *"260");
    assert_eq!(model._get_text("B5"), *"259");
    assert_eq!(model._get_text("B6"), *"#ERROR!");
}
