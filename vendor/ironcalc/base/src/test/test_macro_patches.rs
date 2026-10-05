#![allow(clippy::unwrap_used)]

//! MACRO: tests for the patches made to the vendored engine (see the
//! repository's vendor/ironcalc/README.md).

use crate::test::util::new_empty_model;

#[test]
fn single_value_parameters_are_lifted() {
    let mut model = new_empty_model();
    model._set("A1", "apple");
    model._set("A2", "pear");
    model._set("A3", "pineapple");
    model._set("B1", "1.4");
    model._set("B2", "2.6");
    model._set("B3", "3.5");
    model._set("C1", r#"=SUMPRODUCT(--ISNUMBER(SEARCH("apple",A1:A3)))"#);
    model._set("C2", "=SUM(ROUND(B1:B3,0))");
    model._set("C3", "=SUMPRODUCT(1/COUNTIF(A1:A3,A1:A3))");
    model._set("C4", r#"=SUM(N(ISNUMBER(MATCH({"pear","fig"},A1:A3,0))))"#);
    model._set("C5", "=SUM(COUNTIFS(A1:A3,A1:A3))");
    model._set("C6", "=SUM(MOD(B1:B3*10,3))");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "2");
    assert_eq!(model._get_text("C2"), "8");
    assert_eq!(model._get_text("C3"), "3");
    assert_eq!(model._get_text("C4"), "1");
    assert_eq!(model._get_text("C5"), "3");
    assert_eq!(model._get_text("C6"), "6");
}

#[test]
fn lifted_calls_spill() {
    let mut model = new_empty_model();
    model._set("A1", "1.25");
    model._set("A2", "2.5");
    model._set("B1", "=ROUND(A1:A2,0)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "1");
    assert_eq!(model._get_text("B2"), "3");
}

#[test]
fn aggregates_read_arrays() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "x");
    model._set("A3", "3");
    model._set("B1", "=COUNT(A1:A3*1)");
    model._set("B2", "=PRODUCT(A1:A3*2)");
    model._set("B3", "=PRODUCT(IFERROR(A1:A3*2,1))");
    model._set("B4", r#"=TEXTJOIN(",",TRUE,IF(ISNUMBER(A1:A3),A1:A3,""))"#);
    model._set("B5", r#"=TEXTJOIN(",",FALSE,IF(ISNUMBER(A1:A3),A1:A3,""))"#);
    model._set("B6", r#"=CONCAT(A1:A3&"-")"#);
    model.evaluate();
    assert_eq!(model._get_text("B1"), "2");
    assert_eq!(model._get_text("B2"), "#VALUE!");
    assert_eq!(model._get_text("B3"), "12");
    assert_eq!(model._get_text("B4"), "1,3");
    assert_eq!(model._get_text("B5"), "1,,3");
    assert_eq!(model._get_text("B6"), "1-x-3-");
}

#[test]
fn xlookup_searches_computed_arrays() {
    let mut model = new_empty_model();
    model._set("A1", "x");
    model._set("A2", "y");
    model._set("A3", "y");
    model._set("B1", "1");
    model._set("B2", "1");
    model._set("B3", "2");
    model._set("C1", "a");
    model._set("C2", "b");
    model._set("C3", "c");
    model._set("D1", r#"=XLOOKUP(1,(A1:A3="y")*(B1:B3=2),C1:C3)"#);
    model._set("D2", r#"=XLOOKUP(1,(A1:A3="y")*1,C1:C3)"#);
    model._set("D3", r#"=XLOOKUP("y",A1:A3,C1:C3&"!")"#);
    model._set("D4", r#"=XLOOKUP(2,{1,2,3},{"one","two","three"})"#);
    model._set("D5", r#"=XLOOKUP(1,(A1:A3="z")*1,C1:C3,"none")"#);
    model._set("D6", r#"=XLOOKUP(2.5,B1:B3*1,C1:C3,,1)"#);
    model._set("D7", r#"=XLOOKUP(3,B1:B3,C1:C3,"none",0,2)"#);
    model.evaluate();
    assert_eq!(model._get_text("D1"), "c");
    assert_eq!(model._get_text("D2"), "b");
    assert_eq!(model._get_text("D3"), "b!");
    assert_eq!(model._get_text("D4"), "two");
    assert_eq!(model._get_text("D5"), "none");
    assert_eq!(model._get_text("D6"), "#N/A");
    assert_eq!(model._get_text("D7"), "none");
}

#[test]
fn xlookup_returns_whole_rows_and_columns() {
    let mut model = new_empty_model();
    model._set("A1", "x");
    model._set("A2", "y");
    model._set("B1", "1");
    model._set("B2", "2");
    model._set("C1", "3");
    model._set("C2", "4");
    model._set("E1", r#"=XLOOKUP("y",A1:A2,B1:C2)"#);
    model._set("E3", r#"=SUM(XLOOKUP("y",A1:A2,B1:C2))"#);
    model._set("G1", "=XLOOKUP(4,B2:C2,B1:C2)");
    model.evaluate();
    assert_eq!(model._get_text("E1"), "2");
    assert_eq!(model._get_text("F1"), "4");
    assert_eq!(model._get_text("E3"), "6");
    assert_eq!(model._get_text("G1"), "3");
    assert_eq!(model._get_text("G2"), "4");
}

#[test]
fn range_operator_takes_index_references() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("B1", "=SUM(A1:INDEX(A1:A3,2))");
    model._set("B2", "=SUM(INDEX(A1:A3,2):A3)");
    model._set("B3", "=ROWS(A1:INDEX(A:A,3))");
    model._set("B4", "=ROW(INDEX(A1:A3,3))");
    model._set("B5", "=INDEX(A1:A3,2)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "3");
    assert_eq!(model._get_text("B2"), "5");
    assert_eq!(model._get_text("B3"), "3");
    assert_eq!(model._get_text("B4"), "3");
    assert_eq!(model._get_text("B5"), "2");
}

#[test]
fn aggregate() {
    let mut model = new_empty_model();
    model._set("A1", "4");
    model._set("A2", "=1/0");
    model._set("A3", "1");
    model._set("A4", "text");
    model._set("A5", "=SUBTOTAL(9,A1:A3)");
    model._set("A6", "9");
    model._set("B1", "=AGGREGATE(9,6,A1:A6)");
    model._set("B2", "=AGGREGATE(9,4,A1:A6)");
    model._set("B3", "=AGGREGATE(9,7,A1:A6)");
    model._set("B4", "=AGGREGATE(14,6,A1:A6,1)");
    model._set("B5", "=AGGREGATE(15,6,A1:A6,2)");
    model._set("B6", "=AGGREGATE(3,6,A1:A6)");
    model._set("B7", "=AGGREGATE(1,6,A1:A6)");
    model._set("B8", "=AGGREGATE(4,3,A:A)");
    model._set("B9", r#"=AGGREGATE(15,6,ROW(A1:A6)/(A1:A6="text"),1)"#);
    model._set("B10", "=AGGREGATE(14,6,A1:A6)");
    model._set("B11", "=AGGREGATE(20,6,A1:A6)");
    model._set("B12", "=AGGREGATE(12,6,A1:A3,A6)");
    model._set("B13", "=AGGREGATE(16,6,A1:A6,0.5)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "14");
    assert_eq!(model._get_text("B2"), "#DIV/0!");
    assert_eq!(model._get_text("B3"), "14");
    assert_eq!(model._get_text("B4"), "9");
    assert_eq!(model._get_text("B5"), "4");
    assert_eq!(model._get_text("B6"), "4");
    assert_eq!(model._get_text("B7"), "4.666666667");
    assert_eq!(model._get_text("B8"), "9");
    assert_eq!(model._get_text("B9"), "4");
    assert_eq!(model._get_text("B10"), "#ERROR!");
    assert_eq!(model._get_text("B11"), "#VALUE!");
    assert_eq!(model._get_text("B12"), "4");
    assert_eq!(model._get_text("B13"), "4");
}

#[test]
fn not_equal_text_criteria_match_other_values() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "x");
    model._set("A3", "3");
    model._set("B1", "4");
    model._set("B2", "5");
    model._set("B3", "6");
    model._set("C1", r#"=MINIFS(B1:B3,A1:A3,"<>x")"#);
    model._set("C2", r#"=COUNTIF(A1:A4,"<>x")"#);
    model._set("C3", r#"=SUMIFS(B1:B3,A1:A3,"<>y")"#);
    model.evaluate();
    assert_eq!(model._get_text("C1"), "4");
    assert_eq!(model._get_text("C2"), "3");
    assert_eq!(model._get_text("C3"), "15");
}

#[test]
fn sheet_of_a_reference() {
    let mut model = new_empty_model();
    model.add_sheet("Data").unwrap();
    model._set("A1", "=SHEET(Data!A1:B3)");
    model._set("A2", "=SHEET(Data!C4)");
    model._set("A3", r#"=SHEET("Data")"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "2");
    assert_eq!(model._get_text("A2"), "2");
    assert_eq!(model._get_text("A3"), "2");
}

#[test]
fn text_functions_count_with_numeric_text() {
    let mut model = new_empty_model();
    model._set("A1", r#"=LEFT("a string","6")"#);
    model._set("A2", r#"=RIGHT("a string",TRUE)"#);
    model._set("A3", r#"=MID("a string","3","3")"#);
    model._set("A4", r#"=LEFT("a string","six")"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "a stri");
    assert_eq!(model._get_text("A2"), "g");
    assert_eq!(model._get_text("A3"), "str");
    assert_eq!(model._get_text("A4"), "#VALUE!");
}

#[test]
fn approximate_lookups_compare_values_of_the_same_type() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "text");
    model._set("A4", "3");
    model._set("A5", "more");
    model._set("B1", "one");
    model._set("B2", "two");
    model._set("B3", "x");
    model._set("B4", "three");
    model._set("B5", "y");
    model._set("C1", r#"=LOOKUP("",A1:A2,B1:B2)"#);
    model._set("C2", "=LOOKUP(9.99E+307,A1:A5,B1:B5)");
    model._set("C3", r#"=LOOKUP("zzz",A1:A5,B1:B5)"#);
    model._set("C4", "=VLOOKUP(2.5,A1:B5,2,TRUE)");
    model._set("C5", "=MATCH(9,A1:A5,1)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "#N/A");
    assert_eq!(model._get_text("C2"), "three");
    assert_eq!(model._get_text("C3"), "y");
    assert_eq!(model._get_text("C4"), "two");
    assert_eq!(model._get_text("C5"), "4");
}

#[test]
fn lifted_whole_columns_are_evaluated_within_the_used_area() {
    let mut model = new_empty_model();
    model._set("A1", "x");
    model._set("A2", "y");
    model._set("A3", "x");
    model._set("B1", "x");
    model._set("C1", "=SUMPRODUCT(--ISNUMBER(MATCH(A:A,B:B,0)))");
    model._set("C2", "=SUMPRODUCT(1/COUNTIF(A1:A3,A1:A3))");
    let start = std::time::Instant::now();
    model.evaluate();
    assert!(start.elapsed().as_secs() < 5);
    assert_eq!(model._get_text("C1"), "2");
    assert_eq!(model._get_text("C2"), "2");
}

#[test]
fn conditional_formatting_overlay() {
    let mut model = new_empty_model();
    model._set("A1", "5");
    model._set("A2", "15");
    let rule: crate::cf_types::CfRuleInput = serde_json::from_str(
        r##"{"type":"CellIs","operator":"GreaterThan","formula":"10","formula2":null,
        "format":{"font":{"b":true,"color":"#FF0000"},"fill":{"color":"#FFFF00"}},
        "stop_if_true":false}"##,
    )
    .unwrap();
    model.add_conditional_formatting(0, "A1:A3", rule).unwrap();
    let scale: crate::cf_types::CfRuleInput = serde_json::from_str(
        r##"{"type":"ColorScale","thresholds":[
        {"cfvo":"Min","color":"#000000"},{"cfvo":"Max","color":"#FFFFFF"}]}"##,
    )
    .unwrap();
    model.add_conditional_formatting(0, "B1:B2", scale).unwrap();
    model._set("B1", "0");
    model._set("B2", "10");
    model.evaluate();
    let mut overlay = model.get_conditional_formatting_overlay(0);
    overlay.sort_by_key(|cell| (cell.column, cell.row));
    assert_eq!(overlay.len(), 3);
    assert_eq!((overlay[0].row, overlay[0].column), (2, 1));
    assert_eq!(overlay[0].bold, Some(true));
    assert_eq!(overlay[0].color.as_deref(), Some("#FF0000"));
    assert_eq!(overlay[0].fill.as_deref(), Some("#FFFF00"));
    assert_eq!(overlay[1].fill.as_deref(), Some("#000000"));
    assert_eq!(overlay[2].fill.as_deref(), Some("#FFFFFF"));
}

#[test]
fn lifted_calls_reuse_results_for_repeated_values() {
    let mut model = new_empty_model();
    for row in 1..=300 {
        model._set(&format!("B{row}"), &format!("name{}", row % 7));
    }
    model._set("C1", r#"=SUMPRODUCT((B:B<>"")/COUNTIF(B:B,B:B&""))"#);
    model._set("C2", r#"=SUMPRODUCT(1/COUNTIF(B1:B300,B1:B300))"#);
    let start = std::time::Instant::now();
    model.evaluate();
    assert!(start.elapsed().as_secs() < 10);
    assert_eq!(model._get_text("C1"), "7");
    assert_eq!(model._get_text("C2"), "7");
}

#[test]
fn getpivotdata_reads_the_cells_of_a_described_pivot_table() {
    let mut model = new_empty_model();
    // Sales by region and city down, by quarter across, filtered to 2024.
    let rows = [
        ("A5", "East", ["10", "20", "30"]),
        ("A6", "Boston", ["4", "5", "9"]),
        ("A7", "NYC", ["6", "15", "21"]),
        ("A8", "West", ["1", "2", "3"]),
        ("A9", "Grand Total", ["11", "22", "33"]),
    ];
    for (label, text, values) in rows {
        model._set(label, text);
        let row = &label[1..];
        for (column, value) in ["B", "C", "D"].iter().zip(values) {
            model._set(&format!("{column}{row}"), value);
        }
    }
    model._set("A3", "Sum of Sales");
    let layout = r#"[{
        "sheet": 0,
        "range": [3, 1, 9, 4],
        "data": [["sum of sales", "sales"]],
        "fields": [
            {"names": ["region"], "items": [{"text": "east"}, {"text": "west"}]},
            {"names": ["city"], "items": [{"text": "boston"}, {"text": "nyc"}]},
            {"names": ["quarter"], "items": [{"text": "q1"}, {"text": "q2"}]},
            {"names": ["sales"], "items": []},
            {"names": ["year"], "items": [{"text": "2023", "number": 2023}, {"text": "2024", "number": 2024}]}
        ],
        "filters": [[4, 1]],
        "rows": [
            {"at": 5, "items": [[0, 0]]},
            {"at": 6, "items": [[0, 0], [1, 0]]},
            {"at": 7, "items": [[0, 0], [1, 1]]},
            {"at": 8, "items": [[0, 1]]},
            {"at": 9, "items": [], "total": true}
        ],
        "columns": [
            {"at": 2, "items": [[2, 0]]},
            {"at": 3, "items": [[2, 1]]},
            {"at": 4, "items": [], "total": true}
        ]
    }]"#;
    model.set_pivot_tables(serde_json::from_str(layout).unwrap());
    model._set("E1", "West");
    model._set("F1", r#"=GETPIVOTDATA("Sales",A3)"#);
    model._set(
        "F2",
        r#"=GETPIVOTDATA("Sum of Sales",$A$3,"Region","East")"#,
    );
    model._set(
        "F3",
        r#"=GETPIVOTDATA(" sales ",B5,"region","east","City","NYC","Quarter","Q2")"#,
    );
    model._set("F4", r#"=GETPIVOTDATA("Sales",A3,"Quarter","Q1")"#);
    model._set("F5", r#"=GETPIVOTDATA("Sales",A3,"Region",E1)"#);
    model._set("F6", r#"=GETPIVOTDATA("Sales",A3,"Year",2024)"#);
    model._set(
        "F7",
        r#"=GETPIVOTDATA("Sales",A3,"Year","2024","Region","West")"#,
    );
    model._set(
        "F8",
        r#"=SUM(GETPIVOTDATA("Sales",$A$3,"Region",{"East","West"}))"#,
    );
    // What the table does not show.
    model._set("G1", r#"=GETPIVOTDATA("Sales",A3,"Region","North")"#);
    model._set("G2", r#"=GETPIVOTDATA("Sales",A3,"Year",2023)"#);
    model._set("G3", r#"=GETPIVOTDATA("Profit",A3)"#);
    model._set("G4", r#"=GETPIVOTDATA("Sales",E1)"#);
    model._set("G5", r#"=GETPIVOTDATA("Sales",A3,"Country","US")"#);
    model._set("G6", r#"=GETPIVOTDATA("Sales",A3,"Sales",1)"#);
    model._set("G7", r#"=GETPIVOTDATA("Sales",A3,"Region")"#);
    model._set("G8", r#"=GETPIVOTDATA("Sales",A3,"City","Boston")"#);
    model.evaluate();
    assert_eq!(model._get_text("F1"), "33");
    assert_eq!(model._get_text("F2"), "30");
    assert_eq!(model._get_text("F3"), "15");
    assert_eq!(model._get_text("F4"), "11");
    assert_eq!(model._get_text("F5"), "3");
    assert_eq!(model._get_text("F6"), "33");
    assert_eq!(model._get_text("F7"), "3");
    assert_eq!(model._get_text("F8"), "33");
    for cell in ["G1", "G2", "G3", "G4", "G5", "G6", "G8"] {
        assert_eq!(model._get_text(cell), "#REF!", "{cell}");
    }
    assert_eq!(model._get_text("G7"), "#ERROR!");
    assert_eq!(
        model._get_formula("F2"),
        r#"=GETPIVOTDATA("Sum of Sales",$A$3,"Region","East")"#
    );

    // It reads the cells as they are now; an empty one shows nothing.
    model._set("C7", "16");
    model._set("C8", "");
    model._set(
        "G9",
        r#"=GETPIVOTDATA("Sales",A3,"Region","West","Quarter","Q2")"#,
    );
    model.evaluate();
    assert_eq!(model._get_text("F3"), "16");
    assert_eq!(model._get_text("G9"), "#REF!");
}
