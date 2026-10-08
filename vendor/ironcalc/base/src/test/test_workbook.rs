#![allow(clippy::unwrap_used)]

use crate::{
    test::util::new_empty_model,
    types::{Color, SheetProperties},
};

#[test]
fn workbook_worksheets_info() {
    let model = new_empty_model();
    let sheets_info = model.get_worksheets_properties();
    assert_eq!(
        sheets_info[0],
        SheetProperties {
            name: "Sheet1".to_string(),
            state: "visible".to_string(),
            sheet_id: 1,
            color: Color::None
        }
    );
}

#[test]
fn workbook_worksheets_ids_and_names() {
    let mut model = new_empty_model();
    assert!(model.add_sheet("New Sheet").is_ok());
    assert!(model.add_sheet("Newer Sheet").is_ok());

    let sheet_ids = model.workbook.get_worksheet_ids();
    assert_eq!(sheet_ids, vec![1, 2, 3]);

    let sheet_names = model.workbook.get_worksheet_names();
    assert_eq!(sheet_names, vec!["Sheet1", "New Sheet", "Newer Sheet"]);
}
