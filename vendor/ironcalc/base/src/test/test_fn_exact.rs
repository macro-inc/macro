#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn fn_exact_args_number() {
    let mut model = new_empty_model();

    model._set("A1", "=EXACT(1)");
    model._set("A2", "=EXACT(1, 1, 1)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
}

#[test]
fn fn_exact() {
    let mut model = new_empty_model();

    model._set("A1", "=EXACT(2.3, 2.3)");
    model._set("A2", r#"=EXACT(2.3, "2.3")"#);
    model._set("A3", r#"=EXACT("Hello", "hello")"#);

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"TRUE");
    assert_eq!(model._get_text("A2"), *"TRUE");
    assert_eq!(model._get_text("A3"), *"FALSE");
}

#[test]
fn single_cells() {
    let mut model = new_empty_model();
    model._set("A1", "Hello");
    model._set("A2", "hello");
    model._set("A3", "Hello");
    model._set("B1", "=EXACT(A1, A2)");
    model._set("B2", "=EXACT(A1, A3)");
    // An empty cell is the empty string
    model._set("B3", "=EXACT(A4, \"\")");
    model._set("B4", "=EXACT(TRUE, \"TRUE\")");
    model._set("B5", "=EXACT(1/0, \"a\")");
    model.evaluate();

    assert_eq!(model._get_text("B1"), *"FALSE");
    assert_eq!(model._get_text("B2"), *"TRUE");
    assert_eq!(model._get_text("B3"), *"TRUE");
    assert_eq!(model._get_text("B4"), *"TRUE");
    assert_eq!(model._get_text("B5"), *"#DIV/0!");
}

#[test]
fn range_and_text() {
    let mut model = new_empty_model();
    model._set("A1", "he");
    model._set("A2", "He");
    model._set("A3", "HE");
    model._set("C1", "=EXACT(A1:A4, \"He\")");
    model._set("D1", "=EXACT(\"he\", A1:A4)");
    model.evaluate();

    assert_eq!(model._get_text("C1"), *"FALSE");
    assert_eq!(model._get_text("C2"), *"TRUE");
    assert_eq!(model._get_text("C3"), *"FALSE");
    assert_eq!(model._get_text("C4"), *"FALSE");
    assert_eq!(model._get_text("C5"), *"");

    assert_eq!(model._get_text("D1"), *"TRUE");
    assert_eq!(model._get_text("D2"), *"FALSE");
    assert_eq!(model._get_text("D3"), *"FALSE");
    assert_eq!(model._get_text("D4"), *"FALSE");
}

#[test]
fn two_ranges() {
    let mut model = new_empty_model();
    model._set("A1", "a");
    model._set("A2", "b");
    model._set("A3", "c");
    model._set("B1", "a");
    model._set("B2", "B");
    model._set("B3", "c");
    model._set("D1", "=EXACT(A1:A3, B1:B3)");
    // A column and a row make a table
    model._set("F1", "=EXACT(A1:A2, {\"a\",\"b\",\"c\"})");
    model.evaluate();

    assert_eq!(model._get_text("D1"), *"TRUE");
    assert_eq!(model._get_text("D2"), *"FALSE");
    assert_eq!(model._get_text("D3"), *"TRUE");

    assert_eq!(model._get_text("F1"), *"TRUE");
    assert_eq!(model._get_text("G1"), *"FALSE");
    assert_eq!(model._get_text("H1"), *"FALSE");
    assert_eq!(model._get_text("F2"), *"FALSE");
    assert_eq!(model._get_text("G2"), *"TRUE");
    assert_eq!(model._get_text("H2"), *"FALSE");
}

#[test]
fn ranges_of_different_sizes() {
    let mut model = new_empty_model();
    model._set("A1", "a");
    model._set("A2", "b");
    model._set("A3", "c");
    model._set("B1", "a");
    model._set("B2", "b");
    model._set("D1", "=EXACT(A1:A3, B1:B2)");
    model.evaluate();

    assert_eq!(model._get_text("D1"), *"TRUE");
    assert_eq!(model._get_text("D2"), *"TRUE");
    assert_eq!(model._get_text("D3"), *"#N/A");
}

#[test]
fn numbers_and_errors_in_ranges() {
    let mut model = new_empty_model();
    model._set("A1", "2.3");
    model._set("A2", "=1/0");
    model._set("A3", "0.1");
    model._set("A4", "TRUE");
    model._set("B1", "'2.3");
    model._set("B2", "a");
    model._set("B3", "=0.3-0.2");
    model._set("B4", "'TRUE");
    model._set("D1", "=EXACT(A1:A4, B1:B4)");
    model.evaluate();

    assert_eq!(model._get_text("D1"), *"TRUE");
    assert_eq!(model._get_text("D2"), *"#DIV/0!");
    // The same up to 15 digits
    assert_eq!(model._get_text("D3"), *"TRUE");
    assert_eq!(model._get_text("D4"), *"TRUE");
}

#[test]
fn array_inside_other_functions() {
    let mut model = new_empty_model();
    model._set("A1", "the");
    model._set("A2", "The");
    model._set("A3", "THE");
    model._set("A4", "The");
    model._set("C1", "=SUM(EXACT(A1:A4, \"The\")*1)");
    model._set("C2", "=SUMPRODUCT(EXACT(A1:A4, A2)*1)");
    model.evaluate();

    assert_eq!(model._get_text("C1"), *"2");
    assert_eq!(model._get_text("C2"), *"2");
}

#[test]
fn case_sensitive_lookup_in_whole_columns() {
    let mut model = new_empty_model();
    model.new_sheet();
    model._set("Sheet2!A1", "the");
    model._set("Sheet2!B1", "1169");
    model._set("Sheet2!A2", "The");
    model._set("Sheet2!B2", "464");
    model._set("Sheet2!A3", "THE");
    model._set("Sheet2!B3", "10970");
    model._set("A1", "The");
    model._set(
        "B1",
        "=IF(A1=\"\", \"\", FILTER(Sheet2!$B:$B, EXACT(Sheet2!$A:$A, A1)))",
    );
    model._set(
        "B2",
        "=IF(A2=\"\", \"\", FILTER(Sheet2!$B:$B, EXACT(Sheet2!$A:$A, A2)))",
    );
    model.evaluate();

    assert_eq!(model._get_text("B1"), *"464");
    assert_eq!(model._get_text("B2"), *"");
}

#[test]
fn implicit_intersection() {
    let mut model = new_empty_model();
    model._set("A1", "a");
    model._set("A2", "b");
    model._set("A3", "c");
    model._set("C2", "=EXACT(@A1:A3, \"b\")");
    model.evaluate();

    assert_eq!(model._get_text("C2"), *"TRUE");
    assert_eq!(model._get_text("C3"), *"");
}
