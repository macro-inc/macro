#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn numbers() {
    let mut model = new_empty_model();
    model._set("A1", "=MAX(1, 5, 3)");
    model._set("A2", "=MIN(1, 5, 3)");
    model._set("A3", "=MAX(-1, -5)");
    model._set("A4", "=MIN(-1, -5)");
    // Nothing to compare
    model._set("A5", "=MAX(C1:C5)");
    model._set("A6", "=MIN(C1:C5)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"5");
    assert_eq!(model._get_text("A2"), *"1");
    assert_eq!(model._get_text("A3"), *"-1");
    assert_eq!(model._get_text("A4"), *"-5");
    assert_eq!(model._get_text("A5"), *"0");
    assert_eq!(model._get_text("A6"), *"0");
}

#[test]
fn text_and_booleans_in_ranges_are_ignored() {
    let mut model = new_empty_model();
    model._set("A1", "-2");
    model._set("A2", "text");
    model._set("A3", "TRUE");
    model._set("A4", "-10");
    model._set("A5", "'100");
    model._set("A6", "=\"\"");
    model._set("C1", "=MAX(A1:A6)");
    model._set("C2", "=MIN(A1:A6)");
    // Also when the reference is a single cell
    model._set("C3", "=MAX(A2)");
    model._set("C4", "=MAX(A2, -3)");
    model._set("C5", "=MIN(A3, 3)");
    model._set("C6", "=MAX(A5, 3)");
    model._set("C7", "=MAX(A6, -3)");
    model._set("C8", "=MAX(A7, -3)");
    model.evaluate();

    assert_eq!(model._get_text("C1"), *"-2");
    assert_eq!(model._get_text("C2"), *"-10");
    assert_eq!(model._get_text("C3"), *"0");
    assert_eq!(model._get_text("C4"), *"-3");
    assert_eq!(model._get_text("C5"), *"3");
    assert_eq!(model._get_text("C6"), *"3");
    assert_eq!(model._get_text("C7"), *"-3");
    assert_eq!(model._get_text("C8"), *"-3");
}

#[test]
fn text_and_booleans_in_arrays_are_ignored() {
    let mut model = new_empty_model();
    model._set("A1", "=MAX({-1, \"a\", TRUE, -7})");
    model._set("A2", "=MIN({3, \"a\", FALSE, 7})");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"-1");
    assert_eq!(model._get_text("A2"), *"3");
}

#[test]
fn text_as_argument() {
    let mut model = new_empty_model();
    model._set("A1", "=MAX(\"\")");
    model._set("A2", "=MIN(\"\")");
    model._set("A3", "=MAX(\"abc\", 1)");
    model._set("A4", "=MIN(1, \"abc\")");
    // Text that reads as a number is a number
    model._set("A5", "=MAX(\"3\", 2)");
    model._set("A6", "=MIN(\"-3\", 2)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#VALUE!");
    assert_eq!(model._get_text("A2"), *"#VALUE!");
    assert_eq!(model._get_text("A3"), *"#VALUE!");
    assert_eq!(model._get_text("A4"), *"#VALUE!");
    assert_eq!(model._get_text("A5"), *"3");
    assert_eq!(model._get_text("A6"), *"-3");
}

#[test]
fn boolean_as_argument() {
    let mut model = new_empty_model();
    model._set("A1", "=MAX(TRUE, 0.5)");
    model._set("A2", "=MIN(FALSE, 3)");
    model._set("A3", "=MAX(-1, FALSE)");
    model._set("A4", "=MIN(TRUE, 3)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"1");
    assert_eq!(model._get_text("A2"), *"0");
    assert_eq!(model._get_text("A3"), *"0");
    assert_eq!(model._get_text("A4"), *"1");
}

#[test]
fn text_from_a_function() {
    let mut model = new_empty_model();
    model._set("A1", "=MAX(LEFT(\"abc\", 1))");
    model._set("A2", "=MIN(IF(TRUE, \"\", 1))");
    model._set("A3", "=MAX(LEFT(\"34\", 1), 2)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#VALUE!");
    assert_eq!(model._get_text("A2"), *"#VALUE!");
    assert_eq!(model._get_text("A3"), *"3");
}

#[test]
fn filter_with_nothing_found() {
    let mut model = new_empty_model();
    model._set("A1", "10");
    model._set("A2", "30");
    model._set("A3", "20");
    model._set("C1", "=MAX(FILTER(A1:A3, A1:A3>15, \"\"))");
    model._set("C2", "=MAX(FILTER(A1:A3, A1:A3>100, \"\"))");
    model._set("C3", "=IFERROR(MAX(FILTER(A1:A3, A1:A3>100, \"\")), \"\")");
    model._set("C4", "=MIN(FILTER(A1:A3, A1:A3>100, \"\"))");
    model.evaluate();

    assert_eq!(model._get_text("C1"), *"30");
    assert_eq!(model._get_text("C2"), *"#VALUE!");
    assert_eq!(model._get_text("C3"), *"");
    assert_eq!(model._get_text("C4"), *"#VALUE!");
}

#[test]
fn errors() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "=1/0");
    model._set("C1", "=MAX(A1:A2)");
    model._set("C2", "=MIN(A1:A2)");
    model._set("C3", "=MAX(A2)");
    model._set("C4", "=MAX(1, 1/0)");
    model._set("C5", "=MIN({1, #N/A})");
    model.evaluate();

    assert_eq!(model._get_text("C1"), *"#DIV/0!");
    assert_eq!(model._get_text("C2"), *"#DIV/0!");
    assert_eq!(model._get_text("C3"), *"#DIV/0!");
    assert_eq!(model._get_text("C4"), *"#DIV/0!");
    assert_eq!(model._get_text("C5"), *"#N/A");
}

#[test]
fn implicit_intersection_is_a_reference() {
    let mut model = new_empty_model();
    model._set("A1", "5");
    model._set("A2", "text");
    model._set("A3", "7");
    model._set("C1", "=MAX(@A1:A3)");
    model._set("C2", "=MAX(@A1:A3)");
    model.evaluate();

    assert_eq!(model._get_text("C1"), *"5");
    assert_eq!(model._get_text("C2"), *"0");
}

#[test]
fn inside_a_lambda() {
    let mut model = new_empty_model();
    model.new_sheet();
    model._set("Sheet2!A1", "h");
    model._set("Sheet2!B1", "e");
    model._set("Sheet2!D1", "10");
    model._set("Sheet2!A2", "h");
    model._set("Sheet2!B2", "e");
    model._set("Sheet2!D2", "4");
    model
        .new_defined_name(
            "score",
            None,
            "=LAMBDA(left_char, right_char, IF((left_char = \"\") + (right_char = \"\"), \"\", IFERROR(MAX(FILTER(Sheet2!$D:$D, (left_char = Sheet2!$A:$A) * (right_char = Sheet2!$B:$B), \"\")), \"\")))",
        )
        .unwrap();
    model
        .new_defined_name("biggest", None, "=LAMBDA(x, MAX(x))")
        .unwrap();
    model._set("A1", "h");
    model._set("B1", "e");
    model._set("C1", "l");
    model._set("A3", "=score(A1, B1)");
    model._set("B3", "=score(B1, C1)");
    model._set("C3", "=score(C1, D1)");
    // The best score, and whether each pair has it
    model._set("A4", "=MAX(A3:C3)");
    model._set("A5", "=A4=A3");
    model._set("B5", "=A4=B3");
    // A parameter that is a reference is still a reference, to a single
    // cell as well: the text in A1 does not count
    model._set("A7", "=biggest(A1)");
    model._set("A8", "=biggest(A1:C1)");
    model._set("A9", "=biggest(\"h\")");
    model.evaluate();

    assert_eq!(model._get_text("A3"), *"10");
    assert_eq!(model._get_text("B3"), *"");
    assert_eq!(model._get_text("C3"), *"");
    assert_eq!(model._get_text("A4"), *"10");
    assert_eq!(model._get_text("A5"), *"TRUE");
    assert_eq!(model._get_text("B5"), *"FALSE");
    assert_eq!(model._get_text("A7"), *"0");
    assert_eq!(model._get_text("A8"), *"0");
    assert_eq!(model._get_text("A9"), *"#VALUE!");
}

#[test]
fn an_argument_left_out_counts_as_zero() {
    let mut model = new_empty_model();
    model._set("A1", "=MAX(,-1)");
    model._set("A2", "=MIN(5,)");
    model._set("A3", "=MAX(,)");
    model._set("A4", "=MAX(1,,2)");
    model._set("A5", "=MIN(1,,2)");
    model._set("A6", "=MIN(-1,)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0");
    assert_eq!(model._get_text("A2"), *"0");
    assert_eq!(model._get_text("A3"), *"0");
    assert_eq!(model._get_text("A4"), *"2");
    assert_eq!(model._get_text("A5"), *"0");
    assert_eq!(model._get_text("A6"), *"-1");
}

// A defined name that stands for a cell is a reference, like the cell itself:
// the text in it does not count. The same for a name local to a sheet.
#[test]
fn defined_names() {
    let mut model = new_empty_model();
    model.new_sheet();
    model._set("K1", "text");
    model._set("K2", "7");
    model._set("L1", "10");
    model._set("L2", "20");
    model
        .new_defined_name("TextCell", None, "Sheet1!$K$1")
        .unwrap();
    model
        .new_defined_name("NumCell", None, "Sheet1!$K$2")
        .unwrap();
    model
        .new_defined_name("NumCells", None, "Sheet1!$L$1:$L$2")
        .unwrap();
    model
        .new_defined_name("LocalText", Some(0), "Sheet1!$K$1")
        .unwrap();
    model._set("A1", "=MAX(TextCell)");
    model._set("A2", "=MIN(TextCell)");
    model._set("A3", "=MAX(TextCell, -3)");
    model._set("A4", "=MAX(NumCell)");
    model._set("A5", "=MAX(NumCells)");
    model._set("A6", "=MAX(K1)");
    model._set("A7", "=MAX(\"text\")");
    model._set("A8", "=MAX(LocalText)");
    model._set("A9", "=MIN(LocalText, 3)");
    model._set("A10", "=MIN(NumCells, NumCell, TextCell)");
    // From another sheet
    model._set("Sheet2!A1", "=MAX(TextCell)");
    model._set("Sheet2!A2", "=MAX(NumCells)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0");
    assert_eq!(model._get_text("A2"), *"0");
    assert_eq!(model._get_text("A3"), *"-3");
    assert_eq!(model._get_text("A4"), *"7");
    assert_eq!(model._get_text("A5"), *"20");
    assert_eq!(model._get_text("A6"), *"0");
    assert_eq!(model._get_text("A7"), *"#VALUE!");
    assert_eq!(model._get_text("A8"), *"0");
    assert_eq!(model._get_text("A9"), *"3");
    assert_eq!(model._get_text("A10"), *"7");
    assert_eq!(model._get_text("Sheet2!A1"), *"0");
    assert_eq!(model._get_text("Sheet2!A2"), *"20");
}
