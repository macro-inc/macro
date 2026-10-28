#![allow(clippy::unwrap_used)]

use crate::Model;

pub fn new_empty_model<'a>() -> Model<'a> {
    Model::new_empty("model", "de", "UTC", "de").unwrap()
}

#[test]
fn german_functions() {
    let mut model = new_empty_model();
    model._set("A1", "=WENN(1>2; 3; 4)");
    model._set("A2", "=SUMME({1;2;3\\4;5;6})");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"4");
    assert_eq!(model._get_text("A2"), *"21");
}

#[test]
fn german_numbers() {
    let mut model = new_empty_model();
    model._set("A1", "=SUMME(1,23; 3,45; 4,56)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"9,24");
}
