#![allow(clippy::unwrap_used)]

use crate::model::Model;

#[test]
fn us_locale() {
    // en-US locale with MM/DD/YYYY format
    let mut model = Model::new_empty("model", "en", "UTC", "en").unwrap();

    model._set("A1", "10/02/2026");
    model._set("A2", "=DAY(A1)");
    model._set("A3", "=MONTH(A1)");
    model._set("A4", "=YEAR(A1)");
    model.evaluate();

    assert_eq!(model._get_text("A2"), "2");
    assert_eq!(model._get_text("A3"), "10");
    assert_eq!(model._get_text("A4"), "2026");
}

#[test]
fn uk_locale() {
    // en-GB locale with DD/MM/YYYY format
    let mut model = Model::new_empty("model", "en-GB", "UTC", "en").unwrap();

    model._set("A1", "10/02/2026");
    model._set("A2", "=DAY(A1)");
    model._set("A3", "=MONTH(A1)");
    model._set("A4", "=YEAR(A1)");
    model.evaluate();

    assert_eq!(model._get_text("A2"), "10");
    assert_eq!(model._get_text("A3"), "2");
    assert_eq!(model._get_text("A4"), "2026");
}

#[test]
fn es_locale() {
    // es-ES locale with DD/MM/YYYY format
    let mut model = Model::new_empty("model", "es", "UTC", "en").unwrap();

    model._set("A1", "10/marzo/2026");
    model._set("A2", "=DAY(A1)");
    model._set("A3", "=MONTH(A1)");
    model._set("A4", "=YEAR(A1)");
    model.evaluate();

    assert_eq!(model._get_text("A2"), "10");
    assert_eq!(model._get_text("A3"), "3");
    assert_eq!(model._get_text("A4"), "2026");
}

#[test]
fn fr_locale() {
    // fr-FR locale with DD/MM/YYYY format
    let mut model = Model::new_empty("model", "fr", "UTC", "en").unwrap();
    model._set("A1", "10/mars/2026");
    model._set("A2", "=DAY(A1)");
    model._set("A3", "=MONTH(A1)");
    model._set("A4", "=YEAR(A1)");
    model.evaluate();
    assert_eq!(model._get_text("A2"), "10");
    assert_eq!(model._get_text("A3"), "3");
    assert_eq!(model._get_text("A4"), "2026");
}
