#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn computation() {
    let i2 = "=-C2*(1+D2)^E2-F2*((D2+1)*((1+D2)^E2-1))/D2";

    let mut model = new_empty_model();
    model._set("C2", "1");
    model._set("D2", "2");
    model._set("E2", "3");
    model._set("F2", "4");

    model._set("I2", i2);

    model.evaluate();

    assert_eq!(model._get_text("I2"), "-183");
    assert_eq!(model._get_formula("I2"), i2);
}

#[test]
fn format_as_currency() {
    let mut model = new_empty_model();
    model._set("C2", "1");
    model._set("D2", "2");
    model._set("E2", "3");
    model._set("F2", "4");

    model._set("I2", "=FV(D2,E2,F2,C2,1)");

    model.evaluate();

    assert_eq!(model._get_text("I2"), "-$183.00");
}
