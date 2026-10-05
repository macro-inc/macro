#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn arguments() {
    // Day 9 Dec 2025 = serial number 46000, Tuesday, week 50
    let mut model = new_empty_model();
    model._set("A1", "=WORKDAY()");
    model._set("A2", "=WORKDAY(46000)");
    model._set("A3", "=WORKDAY(46000, 5)");
    model._set("A4", "=WORKDAY(46000, 5, 46001)");
    model._set("A5", "=WORKDAY(46000, 5, 46001, 2)");

    model._set("B1", "=WORKDAY.INTL()");
    model._set("B2", "=WORKDAY.INTL(46000)");
    model._set("B3", "=WORKDAY.INTL(46000, 5)");
    model._set("B4", "=WORKDAY.INTL(46000, 5, 11)");
    model._set("B5", "=WORKDAY.INTL(46000, 5, 11, 46001)");
    model._set("B6", "=WORKDAY.INTL(46000, 5, 11, 46001, 2)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"46007");
    assert_eq!(model._get_text("A4"), *"46008");
    assert_eq!(model._get_text("A5"), *"#ERROR!");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"46007");
    assert_eq!(model._get_text("B4"), *"46006");
    assert_eq!(model._get_text("B5"), *"46007");
    assert_eq!(model._get_text("B6"), *"#ERROR!");
}
