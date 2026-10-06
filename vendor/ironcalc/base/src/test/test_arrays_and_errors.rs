#![allow(clippy::unwrap_used)]

//! An operator with an array on one side and an error on the other gives an
//! array of errors, not a single error. So does a function that works element
//! by element when one argument is an array and another one an error.

use crate::model::Model;
use crate::test::util::new_empty_model;

/// A1:C2 holds 1, 2, 3 / 4, 5, 6
fn model_with_numbers<'a>() -> Model<'a> {
    let mut model = new_empty_model();
    for (cell, value) in [
        ("A1", "1"),
        ("B1", "2"),
        ("C1", "3"),
        ("A2", "4"),
        ("B2", "5"),
        ("C2", "6"),
    ] {
        model._set(cell, value);
    }
    model
}

fn row(model: &Model, row: i32, columns: i32) -> Vec<String> {
    (1..=columns)
        .map(|column| model._get_text_at(0, row, column))
        .collect()
}

#[test]
fn array_and_error() {
    let mut model = model_with_numbers();
    model._set("A5", "=A1:C1-1/0");
    model._set("A6", "=A1:C1+NA()");
    model._set("A7", "=A1:C1*(1/0)");
    model._set("A8", "=A1:C1/NA()");
    model._set("A9", "=A1:C1^(1/0)");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
    assert_eq!(row(&model, 6, 4), ["#N/A", "#N/A", "#N/A", ""]);
    assert_eq!(row(&model, 7, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
    assert_eq!(row(&model, 8, 4), ["#N/A", "#N/A", "#N/A", ""]);
    assert_eq!(row(&model, 9, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
}

#[test]
fn error_and_array() {
    let mut model = model_with_numbers();
    model._set("A5", "=1/0-A1:C1");
    model._set("A6", "=NA()+A1:C1");
    model._set("A7", "=NA()^{1,2}");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
    assert_eq!(row(&model, 6, 4), ["#N/A", "#N/A", "#N/A", ""]);
    assert_eq!(row(&model, 7, 3), ["#N/A", "#N/A", ""]);
}

#[test]
fn the_array_keeps_its_size() {
    let mut model = model_with_numbers();
    model._set("A5", "=A1:C2-1/0");
    model._set("E1", "=A1:A2*NA()");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
    assert_eq!(row(&model, 6, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
    assert_eq!(row(&model, 7, 4), ["", "", "", ""]);
    assert_eq!(model._get_text("E1"), *"#N/A");
    assert_eq!(model._get_text("E2"), *"#N/A");
    assert_eq!(model._get_text("E3"), *"");
    assert_eq!(model._get_text("F1"), *"");
}

#[test]
fn text_that_is_not_a_number_is_an_error() {
    let mut model = model_with_numbers();
    model._set("A5", "=A1:C1+\"a\"");
    model._set("A6", "=\"a\"*A1:C1");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["#VALUE!", "#VALUE!", "#VALUE!", ""]);
    assert_eq!(row(&model, 6, 4), ["#VALUE!", "#VALUE!", "#VALUE!", ""]);
}

#[test]
fn the_error_on_the_left_comes_first() {
    let mut model = model_with_numbers();
    model._set("B1", "=NA()");
    model._set("C1", "text");
    // The elements of the array are on the left
    model._set("A5", "=A1:C1+1/0");
    // The single error is on the left
    model._set("A6", "=1/0+A1:C1");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["#DIV/0!", "#N/A", "#VALUE!", ""]);
    assert_eq!(row(&model, 6, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
}

#[test]
fn without_an_array_it_is_a_single_error() {
    let mut model = model_with_numbers();
    model._set("A5", "=A1-1/0");
    model._set("A6", "=1/0+NA()");
    model._set("A7", "=NA()&A1");
    model._set("A8", "=A1=NA()");
    model.evaluate();

    assert_eq!(row(&model, 5, 2), ["#DIV/0!", ""]);
    assert_eq!(row(&model, 6, 2), ["#DIV/0!", ""]);
    assert_eq!(row(&model, 7, 2), ["#N/A", ""]);
    assert_eq!(row(&model, 8, 2), ["#N/A", ""]);
}

#[test]
fn concatenation() {
    let mut model = model_with_numbers();
    model._set("B1", "=NA()");
    model._set("A5", "=A1:C1&1/0");
    model._set("A6", "=1/0&A1:C1");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["#DIV/0!", "#N/A", "#DIV/0!", ""]);
    assert_eq!(row(&model, 6, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
}

#[test]
fn comparison() {
    let mut model = model_with_numbers();
    model._set("B1", "=NA()");
    model._set("A5", "=A1:C1=1/0");
    model._set("A6", "=1/0<A1:C1");
    model._set("A7", "=A1:C1<>1/0");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["#DIV/0!", "#N/A", "#DIV/0!", ""]);
    assert_eq!(row(&model, 6, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
    assert_eq!(row(&model, 7, 4), ["#DIV/0!", "#N/A", "#DIV/0!", ""]);
}

#[test]
fn power() {
    let mut model = model_with_numbers();
    model._set("A5", "=POWER(A1:C1, 1/0)");
    model._set("A6", "=POWER(NA(), A1:C1)");
    model._set("A7", "=POWER(A1, 1/0)");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
    assert_eq!(row(&model, 6, 4), ["#N/A", "#N/A", "#N/A", ""]);
    assert_eq!(row(&model, 7, 2), ["#DIV/0!", ""]);
}

#[test]
fn iferror_replaces_every_element() {
    let mut model = model_with_numbers();
    // The average of empty cells is an error
    model._set("A5", "=IFERROR(A1:C1-AVERAGE(K1:K3), 0)");
    model._set("A6", "=SUM(IFERROR(A1:C1/NA(), 2))");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["0", "0", "0", ""]);
    assert_eq!(model._get_text("A6"), *"6");
}

#[test]
fn inside_a_lambda() {
    let mut model = model_with_numbers();
    model
        .new_defined_name(
            "layer_norm",
            None,
            "=LAMBDA(range,(range-AVERAGE(range))/SQRT(VAR.P(range)+0.00001))",
        )
        .unwrap();
    // A row with numbers and an empty one
    model._set("A5", "=IFERROR(layer_norm(A1:C1), 0)");
    model._set("A6", "=IFERROR(layer_norm(K1:M1), 0)");
    model._set("A7", "=layer_norm(K1:M1)");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["-1.224735686", "0", "1.224735686", ""]);
    assert_eq!(row(&model, 6, 4), ["0", "0", "0", ""]);
    assert_eq!(row(&model, 7, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
}

// The same goes for the functions that work element by element.

#[test]
fn left_and_right() {
    let mut model = model_with_numbers();
    model._set("A5", "=LEFT(A1:C1, NA())");
    model._set("A6", "=RIGHT(A1:C1, 1/0)");
    model._set("A7", "=LEFT(NA(), {1,2})");
    model._set("A8", "=RIGHT(1/0, A1:C1)");
    model._set("A9", "=IFERROR(LEFT(A1:C1, NA()), \"x\")");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["#N/A", "#N/A", "#N/A", ""]);
    assert_eq!(row(&model, 6, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
    assert_eq!(row(&model, 7, 3), ["#N/A", "#N/A", ""]);
    assert_eq!(row(&model, 8, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
    assert_eq!(row(&model, 9, 4), ["x", "x", "x", ""]);
}

#[test]
fn mid() {
    let mut model = model_with_numbers();
    model._set("A5", "=MID(A1:C1, NA(), 1)");
    model._set("A6", "=MID(A1:C1, 1, 1/0)");
    model._set("A7", "=MID(NA(), {1,2}, 1)");
    model._set("A8", "=MID(\"abc\", A1:C1, NA())");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["#N/A", "#N/A", "#N/A", ""]);
    assert_eq!(row(&model, 6, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
    assert_eq!(row(&model, 7, 3), ["#N/A", "#N/A", ""]);
    assert_eq!(row(&model, 8, 4), ["#N/A", "#N/A", "#N/A", ""]);
}

#[test]
fn exact() {
    let mut model = model_with_numbers();
    model._set("A5", "=EXACT(A1:C1, NA())");
    model._set("A6", "=EXACT(1/0, A1:C1)");
    model._set("A7", "=EXACT(A1:C2, NA())");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["#N/A", "#N/A", "#N/A", ""]);
    assert_eq!(row(&model, 6, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
    assert_eq!(row(&model, 7, 4), ["#N/A", "#N/A", "#N/A", ""]);
    assert_eq!(row(&model, 8, 4), ["#N/A", "#N/A", "#N/A", ""]);
    assert_eq!(row(&model, 9, 4), ["", "", "", ""]);
}

#[test]
fn text() {
    let mut model = model_with_numbers();
    model._set("B1", "=1/0");
    model._set("A5", "=TEXT(A1:C1, NA())");
    model._set("A6", "=TEXT(A2:C2, NA())");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["#N/A", "#DIV/0!", "#N/A", ""]);
    assert_eq!(row(&model, 6, 4), ["#N/A", "#N/A", "#N/A", ""]);
}

#[test]
fn text_with_an_error_format() {
    // Whatever the value, text and boolean included, an error in the format
    // is the result; an error in the value comes first
    let mut model = model_with_numbers();
    model._set("A5", "=TEXT(\"x\", NA())");
    model._set("A6", "=TEXT(TRUE, 1/0)");
    model._set("A7", "=TEXT(5, NA())");
    model._set("A8", "=TEXT(K1, NA())");
    model._set("A9", "=TEXT(NA(), 1/0)");
    model._set("A10", "=TEXT({\"x\",TRUE,1}, NA())");
    // Without an error the value is formatted, or kept as it is
    model._set("A11", "=TEXT(\"x\", \"0\")");
    model._set("A12", "=TEXT(5, \"0.0\")");
    model.evaluate();

    assert_eq!(model._get_text("A5"), *"#N/A");
    assert_eq!(model._get_text("A6"), *"#DIV/0!");
    assert_eq!(model._get_text("A7"), *"#N/A");
    assert_eq!(model._get_text("A8"), *"#N/A");
    assert_eq!(model._get_text("A9"), *"#N/A");
    assert_eq!(row(&model, 10, 4), ["#N/A", "#N/A", "#N/A", ""]);
    assert_eq!(model._get_text("A11"), *"x");
    assert_eq!(model._get_text("A12"), *"5.0");
}

#[test]
fn date() {
    let mut model = model_with_numbers();
    model._set("A5", "=DATE({2020,2021}, NA(), 1)");
    model._set("A6", "=DATE(NA(), A1:C1, 1)");
    model._set("A7", "=DATE(2020, A1:C1, 1/0)");
    // The first argument that is an error
    model._set("A8", "=DATE(1/0, A1:C1, NA())");
    model.evaluate();

    assert_eq!(row(&model, 5, 3), ["#N/A", "#N/A", ""]);
    assert_eq!(row(&model, 6, 4), ["#N/A", "#N/A", "#N/A", ""]);
    assert_eq!(row(&model, 7, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
    assert_eq!(row(&model, 8, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
}

#[test]
fn weekday() {
    let mut model = model_with_numbers();
    model._set("A5", "=WEEKDAY(A1:C1, NA())");
    model._set("A6", "=WEEKDAY(A1:C2, 1/0)");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["#N/A", "#N/A", "#N/A", ""]);
    assert_eq!(row(&model, 6, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
    assert_eq!(row(&model, 7, 4), ["#DIV/0!", "#DIV/0!", "#DIV/0!", ""]);
    assert_eq!(row(&model, 8, 4), ["", "", "", ""]);
}

#[test]
fn in_functions_the_first_error_comes_first() {
    let mut model = model_with_numbers();
    model._set("B1", "=1/0");
    model._set("A5", "=LEFT(A1:C1, NA())");
    model._set("A6", "=MID(A1:C1, 1, NA())");
    model._set("A7", "=EXACT(A1:C1, NA())");
    model._set("A8", "=WEEKDAY(A1:C1, NA())");
    model._set("A9", "=DATE(2020, A1:C1, NA())");
    // The single error is in an earlier argument
    model._set("A10", "=EXACT(NA(), A1:C1)");
    model._set("A11", "=DATE(NA(), A1:C1, 1)");
    model.evaluate();

    for r in 5..=9 {
        assert_eq!(
            row(&model, r, 4),
            ["#N/A", "#DIV/0!", "#N/A", ""],
            "row {r}"
        );
    }
    assert_eq!(row(&model, 10, 4), ["#N/A", "#N/A", "#N/A", ""]);
    assert_eq!(row(&model, 11, 4), ["#N/A", "#N/A", "#N/A", ""]);
}

#[test]
fn in_functions_without_an_array_it_is_a_single_error() {
    let mut model = model_with_numbers();
    model._set("A5", "=LEFT(A1, NA())");
    model._set("A6", "=MID(1/0, 1, NA())");
    model._set("A7", "=EXACT(1/0, NA())");
    model._set("A8", "=TEXT(A1, NA())");
    model._set("A9", "=DATE(2020, NA(), 1/0)");
    model._set("A10", "=WEEKDAY(A1, NA())");
    model._set("A11", "=WEEKDAY(1/0, NA())");
    model.evaluate();

    assert_eq!(row(&model, 5, 2), ["#N/A", ""]);
    assert_eq!(row(&model, 6, 2), ["#DIV/0!", ""]);
    assert_eq!(row(&model, 7, 2), ["#DIV/0!", ""]);
    assert_eq!(row(&model, 8, 2), ["#N/A", ""]);
    assert_eq!(row(&model, 9, 2), ["#N/A", ""]);
    assert_eq!(row(&model, 10, 2), ["#N/A", ""]);
    assert_eq!(row(&model, 11, 2), ["#DIV/0!", ""]);
}

// An error inside an array is the result of comparing it with anything.

#[test]
fn comparison_with_an_error_inside_the_array() {
    let mut model = model_with_numbers();
    model._set("B1", "=NA()");
    model._set("A5", "=A1:C1=1");
    model._set("A6", "=2<A1:C1");
    model._set("A7", "=A1:C1<>\"a\"");
    model._set("A8", "={1,#DIV/0!,3}>=3");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["TRUE", "#N/A", "FALSE", ""]);
    assert_eq!(row(&model, 6, 4), ["FALSE", "#N/A", "TRUE", ""]);
    assert_eq!(row(&model, 7, 4), ["TRUE", "#N/A", "TRUE", ""]);
    assert_eq!(row(&model, 8, 4), ["FALSE", "#DIV/0!", "TRUE", ""]);
}

#[test]
fn comparison_of_two_arrays_with_errors() {
    let mut model = model_with_numbers();
    model._set("B1", "=NA()");
    model._set("B2", "=1/0");
    model._set("C2", "=1/0");
    // 1, #N/A, 3 against 4, #DIV/0!, #DIV/0!: the error on the left comes first
    model._set("A5", "=A1:C1=A2:C2");
    model._set("A6", "=A2:C2=A1:C1");
    model._set("A7", "=A1:C1<{1;2}");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["FALSE", "#N/A", "#DIV/0!", ""]);
    assert_eq!(row(&model, 6, 4), ["FALSE", "#DIV/0!", "#DIV/0!", ""]);
    // A row against a column
    assert_eq!(row(&model, 7, 4), ["FALSE", "#N/A", "FALSE", ""]);
    assert_eq!(row(&model, 8, 4), ["TRUE", "#N/A", "FALSE", ""]);
}

#[test]
fn every_comparison_operator_keeps_the_error() {
    let mut model = model_with_numbers();
    model._set("B1", "=NA()");
    for (r, operator) in ["=", "<>", "<", ">", "<=", ">="].iter().enumerate() {
        let r = r as i32;
        model
            .set_user_input(0, 5 + r, 1, format!("=A1:C1{operator}2"))
            .unwrap();
        model
            .set_user_input(0, 12 + r, 1, format!("=2{operator}A1:C1"))
            .unwrap();
    }
    model.evaluate();

    for r in (5..=10).chain(12..=17) {
        assert_eq!(model._get_text_at(0, r, 2), "#N/A", "row {r}");
        assert!(
            ["TRUE", "FALSE"].contains(&model._get_text_at(0, r, 1).as_str()),
            "row {r}"
        );
    }
}

#[test]
fn the_error_reaches_the_function_that_uses_the_comparison() {
    let mut model = model_with_numbers();
    model._set("B1", "=NA()");
    model._set("A5", "=SUM((A1:C1=1)*1)");
    model._set("A6", "=IFERROR(A1:C1=1, \"e\")");
    model.evaluate();

    assert_eq!(model._get_text("A5"), *"#N/A");
    assert_eq!(row(&model, 6, 4), ["TRUE", "e", "FALSE", ""]);
}

// Where one array is shorter than the other the missing elements are #N/A,
// for the operators as for the functions: an error like any other, so the
// error of the left operand comes first.

#[test]
fn operators_on_arrays_of_different_sizes() {
    let mut model = model_with_numbers();
    model._set("A5", "=A1:C1+A1:B1");
    model._set("A6", "=A1:B1*A1:C1");
    model._set("A7", "=A1:C1&A1:B1");
    model._set("A8", "=A1:C1=A1:B1");
    model._set("A9", "=A1:B1<A1:C1");
    model._set("A10", "=A1:C1^{1,2}");
    // A row and a column make a table: nothing is missing
    model._set("A12", "=A1:C1+A1:A2");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["2", "4", "#N/A", ""]);
    assert_eq!(row(&model, 6, 4), ["1", "4", "#N/A", ""]);
    assert_eq!(row(&model, 7, 4), ["11", "22", "#N/A", ""]);
    assert_eq!(row(&model, 8, 4), ["TRUE", "TRUE", "#N/A", ""]);
    assert_eq!(row(&model, 9, 4), ["FALSE", "FALSE", "#N/A", ""]);
    assert_eq!(row(&model, 10, 4), ["1", "4", "#N/A", ""]);
    assert_eq!(row(&model, 12, 4), ["2", "3", "4", ""]);
    assert_eq!(row(&model, 13, 4), ["5", "6", "7", ""]);
}

#[test]
fn missing_elements_and_errors_in_operators() {
    let mut model = model_with_numbers();
    model._set("B1", "=1/0");
    // 1, #DIV/0!, 3 against 1, 2: the third is missing on the right
    model._set("A5", "=A1:C1+{1,2}");
    model._set("A6", "={1,2}+A1:C1");
    model._set("A7", "=A1:C1&{1,2}");
    model._set("A8", "=A1:C1={1,2}");
    // Missing on the left, an error on the right: the left comes first
    model._set("A9", "={1,2}+{1,#NUM!,3}");
    model._set("A10", "={1,2}={1,#NUM!,3}");
    model.evaluate();

    assert_eq!(row(&model, 5, 4), ["2", "#DIV/0!", "#N/A", ""]);
    assert_eq!(row(&model, 6, 4), ["2", "#DIV/0!", "#N/A", ""]);
    assert_eq!(row(&model, 7, 4), ["11", "#DIV/0!", "#N/A", ""]);
    assert_eq!(row(&model, 8, 4), ["TRUE", "#DIV/0!", "#N/A", ""]);
    assert_eq!(row(&model, 9, 4), ["2", "#NUM!", "#N/A", ""]);
    assert_eq!(row(&model, 10, 4), ["TRUE", "#NUM!", "#N/A", ""]);
}
