#![allow(clippy::unwrap_used)]

use crate::constants::{LAST_COLUMN, LAST_ROW};
use crate::test::util::new_empty_model;

#[test]
fn no_argument_and_single_cell() {
    let mut model = new_empty_model();
    model._set("C5", "=ROW()");
    model._set("D5", "=COLUMN()");
    model._set("C6", "=ROW(F9)");
    model._set("D6", "=COLUMN(F9)");
    model.evaluate();

    assert_eq!(model._get_text("C5"), *"5");
    assert_eq!(model._get_text("D5"), *"4");
    assert_eq!(model._get_text("C6"), *"9");
    assert_eq!(model._get_text("D6"), *"6");
}

#[test]
fn row_of_a_range_spills_down() {
    let mut model = new_empty_model();
    model._set("A1", "=ROW(C2:E4)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"2");
    assert_eq!(model._get_text("A2"), *"3");
    assert_eq!(model._get_text("A3"), *"4");
    assert_eq!(model._get_text("A4"), *"");
    // One column, however wide the range
    assert_eq!(model._get_text("B1"), *"");
}

#[test]
fn column_of_a_range_spills_right() {
    let mut model = new_empty_model();
    model._set("A1", "=COLUMN(C2:E4)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"3");
    assert_eq!(model._get_text("B1"), *"4");
    assert_eq!(model._get_text("C1"), *"5");
    assert_eq!(model._get_text("D1"), *"");
    // One row, however tall the range
    assert_eq!(model._get_text("A2"), *"");
}

#[test]
fn range_within_one_row_or_column_is_a_number() {
    let mut model = new_empty_model();
    model._set("A1", "=ROW(C7:E7)");
    model._set("A2", "=COLUMN(C7:C9)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"7");
    assert_eq!(model._get_text("B1"), *"");
    assert_eq!(model._get_text("A2"), *"3");
    assert_eq!(model._get_text("A3"), *"");
}

#[test]
fn as_argument_of_other_functions() {
    let mut model = new_empty_model();
    model._set("A1", "=SUM(ROW(C2:C4))");
    model._set("A2", "=SUM(COLUMN(C2:E2))");
    model._set("A3", "=SUM(ROW(C2:C4)*COLUMN(C2:E2))");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"9");
    assert_eq!(model._get_text("A2"), *"12");
    // (2+3+4)*(3+4+5)
    assert_eq!(model._get_text("A3"), *"108");
}

#[test]
fn range_from_a_function() {
    let mut model = new_empty_model();
    model._set("A1", "=ROW(OFFSET(C2,1,0,3,1))");
    model._set("B1", "=SUM(COLUMN(OFFSET(C2,0,1,1,3)))");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"3");
    assert_eq!(model._get_text("A2"), *"4");
    assert_eq!(model._get_text("A3"), *"5");
    assert_eq!(model._get_text("B1"), *"15");
}

#[test]
fn last_non_empty_row_and_column() {
    let mut model = new_empty_model();
    model._set("C3", "a");
    model._set("C5", "b");
    model._set("E3", "c");
    model._set("G3", "d");
    model._set("A1", "=MAX((C1:C20<>\"\")*ROW(C1:C20))");
    model._set("A2", "=MAX((A3:J3<>\"\")*COLUMN(A3:J3))");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"5");
    assert_eq!(model._get_text("A2"), *"7");
}

#[test]
fn whole_column_and_whole_row() {
    let mut model = new_empty_model();
    model.new_sheet();
    model._set("Sheet2!B1", "a");
    model._set("Sheet2!B2", "b");
    model._set("Sheet2!B4", "c");
    model._set("Sheet2!D7", "d");
    model._set("A1", "=MAX(ROW(Sheet2!B:B))");
    model._set("A2", "=MAX(COLUMN(Sheet2!7:7))");
    model._set("A3", "=MAX((Sheet2!B:B<>\"\")*ROW(Sheet2!B:B))");
    model._set("A4", "=MAX((Sheet2!7:7<>\"\")*COLUMN(Sheet2!7:7))");
    model.evaluate();

    assert_eq!(model._get_text("A1"), LAST_ROW.to_string());
    assert_eq!(model._get_text("A2"), LAST_COLUMN.to_string());
    assert_eq!(model._get_text("A3"), *"4");
    assert_eq!(model._get_text("A4"), *"4");
}

#[test]
fn inside_a_lambda() {
    let mut model = new_empty_model();
    model
        .new_defined_name(
            "Last_Non_Empty_Row",
            None,
            "=LAMBDA(range, SUMPRODUCT(MAX((range<>\"\")*ROW(range))))",
        )
        .unwrap();
    model
        .new_defined_name(
            "Last_Non_Empty_Column",
            None,
            "=LAMBDA(range, SUMPRODUCT(MAX((range<>\"\")*COLUMN(range))))",
        )
        .unwrap();
    model._set("C1", "Prompt");
    model._set("C2", "Mike");
    model._set("C3", "is");
    model._set("C4", "quick");
    model._set("D10", "a");
    model._set("E10", "b");
    model._set("F10", "=\"\"");
    model._set("A1", "=Last_Non_Empty_Row(C:C)-1");
    model._set("A2", "=Last_Non_Empty_Column(D10:N10)-1");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"3");
    assert_eq!(model._get_text("A2"), *"4");
}

#[test]
fn implicit_intersection_takes_the_first() {
    let mut model = new_empty_model();
    model._set("A1", "=@ROW(C2:C4)");
    model._set("B1", "=@COLUMN(C2:E2)");
    model._set("C1", "=SIN(@ROW(C2:C4))");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"2");
    assert_eq!(model._get_text("A2"), *"");
    assert_eq!(model._get_text("B1"), *"3");
    assert_eq!(model._get_text("C1"), *"0.909297427");
    assert_eq!(model._get_text("D1"), *"");
}

#[test]
fn wrong_arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=ROW(C2, C3)");
    model._set("A2", "=COLUMN(C2, C3)");
    model._set("A3", "=ROW(3)");
    model._set("A4", "=COLUMN(\"C\")");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#VALUE!");
    assert_eq!(model._get_text("A4"), *"#VALUE!");
}
