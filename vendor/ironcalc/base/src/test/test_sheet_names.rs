#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn sheet_number_name() {
    let mut model = new_empty_model();
    model.new_sheet();
    model._set("A1", "7");
    model._set("A2", "=Sheet2!C3");
    model.evaluate();
    model.rename_sheet("Sheet2", "2024").unwrap();
    model.evaluate();
    assert_eq!(model.workbook.get_worksheet_names(), ["Sheet1", "2024"]);
    assert_eq!(model._get_text("A2"), "0");
}
