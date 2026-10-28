#![allow(clippy::unwrap_used)]
#![allow(clippy::panic)]

use crate::test::util::new_empty_model;
use crate::types::{Cell, FormulaValue};

#[test]
fn test_simple_error_propagation() {
    let mut model = new_empty_model();
    model._set("A1", "=1/0");
    model._set("A2", "=2+A1");
    model._set("A3", "=C2+A2");
    model.evaluate();
    match model._get_cell("Sheet1!A3") {
        Cell::CellFormula {
            v: FormulaValue::Error { o, .. },
            ..
        } => {
            assert_eq!(o, "Sheet1!A1");
        }
        _ => unreachable!(),
    }
}

#[test]
fn test_simple_errors() {
    let mut model = new_empty_model();
    model._set("A1", "#CALC!");
    model._set("A2", "#SPILL!");
    model._set("A3", "#OTHER!");

    model._set("B1", "=ISERROR(A1)");
    model._set("B2", "=ISERROR(A2)");
    model._set("B3", "=ISERROR(A3)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), "#CALC!");
    assert_eq!(model._get_text("A2"), "#SPILL!");
    assert_eq!(model._get_text("A3"), "#OTHER!");
    assert_eq!(model._get_text("B1"), "TRUE");
    assert_eq!(model._get_text("B2"), "TRUE");
    assert_eq!(model._get_text("B3"), "FALSE");
}
