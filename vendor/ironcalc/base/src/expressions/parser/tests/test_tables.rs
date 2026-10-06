#![allow(clippy::unwrap_used)]

use std::collections::HashMap;

use crate::expressions::parser::tests::utils::{new_parser, to_english_localized_string};
use crate::expressions::types::CellReferenceRC;
use crate::expressions::utils::{number_to_column, parse_reference_a1};
use crate::types::{Table, TableColumn, TableStyleInfo};

fn create_test_table(
    table_name: &str,
    column_names: &[&str],
    cell_ref: &str,
    row_count: i32,
) -> HashMap<String, Table> {
    let mut table = HashMap::new();
    let mut columns = Vec::new();
    for (id, name) in column_names.iter().enumerate() {
        columns.push(TableColumn {
            id: id as u32,
            name: name.to_string(),
            ..Default::default()
        })
    }
    let init_cell = parse_reference_a1(cell_ref).unwrap();
    let start_row = init_cell.row;
    let start_column = number_to_column(init_cell.column).unwrap();
    let end_column = number_to_column(init_cell.column + column_names.len() as i32).unwrap();
    let end_row = start_row + row_count - 1;

    let area_ref = format!("{start_column}{start_row}:{end_column}{end_row}");

    table.insert(
        table_name.to_string(),
        Table {
            name: table_name.to_string(),
            display_name: table_name.to_string(),
            sheet_name: "Sheet One".to_string(),
            reference: area_ref,
            totals_row_count: 0,
            header_row_count: 1,
            header_row_dxf_id: None,
            data_dxf_id: None,
            columns,
            style_info: TableStyleInfo {
                ..Default::default()
            },
            totals_row_dxf_id: None,
            has_filters: false,
        },
    );
    table
}

#[test]
fn simple_table() {
    let worksheets = vec!["Sheet One".to_string(), "Second Sheet".to_string()];

    // This is a table A1:F3, the column F has a formula
    let column_names = ["Jan", "Feb", "Mar", "Apr", "Dec", "Year"];
    let row_count = 3;
    let tables = create_test_table("tblIncome", &column_names, "A1", row_count);

    let mut parser = new_parser(worksheets, vec![], tables);
    // Reference cell is 'Sheet One'!F2
    let cell_reference = CellReferenceRC {
        sheet: "Sheet One".to_string(),
        row: 2,
        column: 6,
    };

    let formula = "SUM(tblIncome[[#This Row],[Jan]:[Dec]])";
    let t = parser.parse(formula, &cell_reference);
    assert_eq!(
        to_english_localized_string(&t, &cell_reference),
        "SUM($A$2:$E$2)"
    );

    // Cell A3
    let cell_reference = CellReferenceRC {
        sheet: "Sheet One".to_string(),
        row: 4,
        column: 1,
    };
    let formula = "SUBTOTAL(109, tblIncome[Jan])";
    let t = parser.parse(formula, &cell_reference);
    assert_eq!(
        to_english_localized_string(&t, &cell_reference),
        "SUBTOTAL(109,$A$2:$A$3)"
    );

    // Cell A3 in 'Second Sheet'
    let cell_reference = CellReferenceRC {
        sheet: "Second Sheet".to_string(),
        row: 4,
        column: 1,
    };
    let formula = "SUBTOTAL(109, tblIncome[Jan])";
    let t = parser.parse(formula, &cell_reference);
    assert_eq!(
        to_english_localized_string(&t, &cell_reference),
        "SUBTOTAL(109,'Sheet One'!$A$2:$A$3)"
    );
}
