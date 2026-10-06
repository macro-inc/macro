#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_add_remove_sheets() {
    let mut model = new_empty_model();
    model._set("A1", "7");
    model._set("A2", "=Sheet2!C3");
    model.evaluate();
    assert_eq!(model.workbook.get_worksheet_names(), ["Sheet1"]);
    assert_eq!(model._get_text("A2"), "#REF!");

    // Add a sheet
    model.new_sheet();
    assert_eq!(model.workbook.get_worksheet_names(), ["Sheet1", "Sheet2"]);
    assert_eq!(model._get_text("A2"), "0");
    model._set("Sheet2!A1", "=Sheet1!A1");
    model.evaluate();
    assert_eq!(model._get_text("Sheet2!A1"), "7");

    // Rename the first sheet
    let r = model.rename_sheet("Sheet1", "Ricci");
    assert!(r.is_ok());

    assert_eq!(model.workbook.get_worksheet_names(), ["Ricci", "Sheet2"]);
    assert_eq!(model._get_text("Sheet2!A1"), "7");
    assert_eq!(model._get_formula("Sheet2!A1"), "=Ricci!A1");

    // Remove the first sheet
    let r = model.delete_sheet_by_name("Ricci");
    assert!(r.is_ok());
    assert_eq!(model.workbook.get_worksheet_names(), ["Sheet2"]);
    assert_eq!(model._get_text("Sheet2!A1"), "#REF!");
}

#[test]
fn test_rename_delete_to_existing() {
    let mut model = new_empty_model();
    model.new_sheet();
    // Cannot rename to an existing one
    let r = model.rename_sheet("Sheet1", "Sheet2");
    assert!(r.is_err());

    // Not every name is valid
    let r = model.rename_sheet("Sheet1", "Invalid[]");
    assert!(r.is_err());

    // Cannot delete something that does not exist
    let r = model.delete_sheet_by_name("NonExists");
    assert!(r.is_err());
}

#[test]
fn rename_into_different_case() {
    let mut model = new_empty_model();
    let r = model.rename_sheet("Sheet1", "sHeEt1");
    assert!(r.is_ok());
    assert_eq!(model.workbook.get_worksheet_names(), ["sHeEt1"]);
}

#[test]
fn test_rename_one_sheet() {
    let mut model = new_empty_model();
    let r = model.rename_sheet("Sheet1", "Sheet2");
    assert!(r.is_ok());
    model.new_sheet();
    assert_eq!(model.workbook.get_worksheet_names(), ["Sheet2", "Sheet1"]);
}

#[test]
fn test_rename_and_formula() {
    let mut model = new_empty_model();
    model._set("A1", "=A2*3");
    model._set("A2", "42");
    model.evaluate();
    let r = model.rename_sheet("Sheet1", "Sheet2");
    assert!(r.is_ok());
    model.new_sheet();
    assert_eq!(model.workbook.get_worksheet_names(), ["Sheet2", "Sheet1"]);
    model._set("Sheet2!A3", "= A1 * 3");
    model.evaluate();
    assert_eq!(model._get_formula("Sheet2!A3"), "=A1*3");
}

#[test]
fn test_correct_quoting() {
    let mut model = new_empty_model();
    model.new_sheet();
    model._set("Sheet2!B3", "400");
    model._set("A1", "=Sheet2!B3*2");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "800");
    let r = model.rename_sheet("Sheet2", "New Sheet");
    assert!(r.is_ok());
    assert_eq!(model._get_text("A1"), "800");
    assert_eq!(model._get_formula("A1"), "='New Sheet'!B3*2")
}

#[test]
fn test_cannot_delete_last_sheet() {
    let mut model = new_empty_model();
    let r = model.delete_sheet_by_name("Sheet1");
    assert_eq!(r, Err("Cannot delete only sheet".to_string()));
    model.new_sheet();

    let r = model.delete_sheet_by_name("Sheet10");
    assert_eq!(r, Err("Sheet not found".to_string()));

    let r = model.delete_sheet_by_name("Sheet1");
    assert!(r.is_ok());
}

#[test]
fn test_ranges() {
    let mut model = new_empty_model();
    model._set("A1", "=SUM(Sheet2!A1:C3)*Sheet3!A2");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#REF!");
    model.new_sheet();
    assert_eq!(model._get_text("A1"), "#REF!");
    model.new_sheet();
    assert_eq!(model._get_text("A1"), "0");

    model._set("Sheet3!A2", "42");
    model._set("Sheet2!A1", "2");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "84");
    let r = model.rename_sheet("Sheet2", "Other Sheet");
    assert!(r.is_ok());
    assert_eq!(
        model._get_formula("A1"),
        "=SUM('Other Sheet'!A1:C3)*Sheet3!A2"
    );
}

#[test]
fn test_insert_sheet() {
    // Set a formula with a wrong sheet
    let mut model = new_empty_model();
    model._set("A1", "=Bacchus!A3");
    model._set("A2", "=Dionysus!A3");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#REF!");
    assert_eq!(model._get_text("A2"), "#REF!");

    // Insert the sheet at the end and check the formula
    assert!(model.insert_sheet("Bacchus", 1, None).is_ok());
    model.set_user_input(1, 3, 1, "42".to_string()).unwrap();
    model.evaluate();
    assert_eq!(model._get_text("A1"), "42");
    assert_eq!(model._get_text("A2"), "#REF!");

    // Insert a sheet in between the other two
    assert!(model.insert_sheet("Dionysus", 1, None).is_ok());
    model.set_user_input(1, 3, 1, "111".to_string()).unwrap();
    model.evaluate();
    assert_eq!(model._get_text("A1"), "42");
    assert_eq!(model._get_text("A2"), "111");
    assert_eq!(
        model.workbook.get_worksheet_names(),
        ["Sheet1", "Dionysus", "Bacchus"]
    );

    // Insert a sheet out of bounds
    assert!(model.insert_sheet("OutOfBounds", 4, None).is_err());
    model.evaluate();
    assert_eq!(
        model.workbook.get_worksheet_names(),
        ["Sheet1", "Dionysus", "Bacchus"]
    );

    // Insert at the beginning
    assert!(model.insert_sheet("FirstSheet", 0, None).is_ok());
    model.evaluate();
    assert_eq!(
        model.workbook.get_worksheet_names(),
        ["FirstSheet", "Sheet1", "Dionysus", "Bacchus"]
    );
}

#[test]
fn test_rename_sheet() {
    let mut model = new_empty_model();
    model.new_sheet();
    model._set("A1", "=NewSheet!A3");
    model.set_user_input(1, 3, 1, "25".to_string()).unwrap();
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#REF!");
    assert!(model.rename_sheet("Sheet2", "NewSheet").is_ok());
    model.evaluate();
    assert_eq!(model._get_text("A1"), "25");
}

#[test]
fn test_rename_sheet_by_index() {
    let mut model = new_empty_model();
    model.new_sheet();
    model._set("A1", "=NewSheet!A1");
    model.set_user_input(1, 1, 1, "25".to_string()).unwrap();
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#REF!");
    assert!(model.rename_sheet_by_index(1, "NewSheet").is_ok());
    model.evaluate();
    assert_eq!(model._get_text("A1"), "25");
}

#[test]
fn test_rename_sheet_by_index_error() {
    let mut model = new_empty_model();
    model.new_sheet();
    assert!(model.rename_sheet_by_index(0, "OldSheet").is_ok());
    assert!(model.rename_sheet_by_index(2, "NewSheet").is_err());
}

#[test]
fn test_delete_sheet_by_index() {
    let mut model = new_empty_model();
    model._set("A1", "7");
    model._set("A2", "=Sheet2!C3");
    model.evaluate();
    assert_eq!(model.workbook.get_worksheet_names(), ["Sheet1"]);
    assert_eq!(model._get_text("A2"), "#REF!");

    // Add a sheet
    model.new_sheet();
    assert_eq!(model.workbook.get_worksheet_names(), ["Sheet1", "Sheet2"]);
    assert_eq!(model._get_text("A2"), "0");
    model._set("Sheet2!A1", "=Sheet1!A1");
    model.evaluate();
    assert_eq!(model._get_text("Sheet2!A1"), "7");

    // Rename the first sheet
    let r = model.rename_sheet("Sheet1", "Ricci");
    assert!(r.is_ok());

    assert_eq!(model.workbook.get_worksheet_names(), ["Ricci", "Sheet2"]);
    assert_eq!(model._get_text("Sheet2!A1"), "7");
    assert_eq!(model._get_formula("Sheet2!A1"), "=Ricci!A1");

    // Remove the first sheet
    let r = model.delete_sheet_by_name("Ricci");
    assert!(r.is_ok());
    assert_eq!(model.workbook.get_worksheet_names(), ["Sheet2"]);
    assert_eq!(model._get_text("Sheet2!A1"), "#REF!");
}

#[test]
fn delete_sheet_error() {
    let mut model = new_empty_model();
    model.new_sheet();
    assert!(model.delete_sheet(2).is_err());
    assert!(model.delete_sheet(1).is_ok());
}
