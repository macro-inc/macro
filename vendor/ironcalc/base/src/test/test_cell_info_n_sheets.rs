#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=CELL(\"address\",A1)");
    model._set("A2", "=CELL()");

    model._set("A3", "=INFO(\"recalc\")");
    model._set("A4", "=INFO()");

    model._set("A5", "=N(TRUE)");
    model._set("A6", "=N()");
    model._set("A7", "=N(1, 2)");

    model._set("A8", "=SHEETS()");
    model._set("A9", "=SHEETS(1)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"$A$1");
    assert_eq!(model._get_text("A2"), *"#ERROR!");

    assert_eq!(model._get_text("A3"), *"Automatic");
    assert_eq!(model._get_text("A4"), *"#ERROR!");

    assert_eq!(model._get_text("A5"), *"1");
    assert_eq!(model._get_text("A6"), *"#ERROR!");
    assert_eq!(model._get_text("A7"), *"#ERROR!");

    assert_eq!(model._get_text("A8"), *"1");
    assert_eq!(model._get_text("A9"), *"#N/IMPL!");
}

#[test]
fn info_timezone() {
    let mut model = new_empty_model();
    model._set("A1", "=INFO(\"timezone\")");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"UTC");

    model.set_timezone("America/Panama").unwrap();

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"America/Panama");
}

#[test]
fn info_timezones() {
    let mut model = new_empty_model();
    model._set("A1", "=INFO(\"timezones\")");
    model._set("B1", "=COUNTA(A:A)");

    model.evaluate();

    assert_ne!(model._get_text("A1"), *"");
    let timezones = model._get_text("B1").parse::<i32>().unwrap();
    assert!(timezones > 400);
}

#[test]
fn cell_filename() {
    // Default workbook name is model
    let mut model = new_empty_model();

    model._set("A1", "=CELL(\"filename\")");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"[model.xlsx]Sheet1");

    model.workbook.name = "Expenses".to_string();
    model.rename_sheet("Sheet1", "2026").unwrap();

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"[Expenses.xlsx]2026");
}
