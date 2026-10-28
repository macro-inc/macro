#![allow(clippy::unwrap_used)]

//! LEN, TRIM, PROPER, CLEAN, FIND, SEARCH, REPT, SUBSTITUTE and REPLACE work
//! element by element when any of their arguments is a range or an array.

use crate::model::Model;
use crate::test::util::new_empty_model;

/// A1:C1 holds three texts
fn model_with_texts<'a>() -> Model<'a> {
    let mut model = new_empty_model();
    model._set("A1", "Hello World");
    model._set("B1", "' ab  c ");
    model._set("C1", "x-y-z");
    model
}

fn row(model: &Model, row: i32, columns: i32) -> Vec<String> {
    (1..=columns)
        .map(|column| model._get_text_at(0, row, column))
        .collect()
}

#[test]
fn len() {
    let mut model = model_with_texts();
    model._set("A3", "=LEN(A1:C1)");
    model._set("A4", "=SUM(LEN(A1:C1))");
    model._set("A5", "=LEN({\"a\",\"bb\";\"ccc\",\"\"})");
    model._set("A8", "=LEN({1234,TRUE})");
    model.evaluate();

    assert_eq!(row(&model, 3, 4), ["11", "7", "5", ""]);
    assert_eq!(model._get_text("A4"), *"23");
    assert_eq!(row(&model, 5, 3), ["1", "2", ""]);
    assert_eq!(row(&model, 6, 3), ["3", "0", ""]);
    assert_eq!(row(&model, 8, 3), ["4", "4", ""]);
}

#[test]
fn trim_proper_clean() {
    let mut model = model_with_texts();
    model._set("A3", "=TRIM(A1:C1)");
    model._set("A4", "=PROPER({\"hello world\",\"FOO bar\"})");
    // A bell at the end of each text, and then without it
    model._set("A5", "=LEN(A1:C1&CHAR(7))");
    model._set("A6", "=LEN(CLEAN(A1:C1&CHAR(7)))");
    model._set("A7", "=CLEAN(A1:C1&CHAR(7))=A1:C1");
    model.evaluate();

    assert_eq!(row(&model, 3, 4), ["Hello World", "ab c", "x-y-z", ""]);
    assert_eq!(row(&model, 4, 3), ["Hello World", "Foo Bar", ""]);
    assert_eq!(row(&model, 5, 4), ["12", "8", "6", ""]);
    assert_eq!(row(&model, 6, 4), ["11", "7", "5", ""]);
    assert_eq!(row(&model, 7, 4), ["TRUE", "TRUE", "TRUE", ""]);
}

#[test]
fn find() {
    let mut model = model_with_texts();
    model._set("A3", "=FIND(\"o\", A1:C1)");
    model._set("A4", "=FIND({\"H\",\"W\",\"h\"}, \"Hello World\")");
    model._set("A5", "=FIND(\"o\", \"Hello World\", {1,6,9})");
    // A column of texts to find against a row of texts
    model._set("A6", "=FIND({\"l\";\"-\"}, A1:C1)");
    model.evaluate();

    assert_eq!(row(&model, 3, 4), ["5", "#VALUE!", "#VALUE!", ""]);
    // FIND is case sensitive
    assert_eq!(row(&model, 4, 4), ["1", "7", "#VALUE!", ""]);
    assert_eq!(row(&model, 5, 4), ["5", "8", "#VALUE!", ""]);
    assert_eq!(row(&model, 6, 4), ["3", "#VALUE!", "#VALUE!", ""]);
    assert_eq!(row(&model, 7, 4), ["#VALUE!", "#VALUE!", "2", ""]);
}

#[test]
fn search() {
    let mut model = model_with_texts();
    model._set("A3", "=SEARCH(\"O\", A1:C1)");
    // With wildcards
    model._set("A4", "=SEARCH(\"?-\", A1:C1)");
    model._set("A5", "=SEARCH({\"h\",\"w*d\"}, \"Hello World\")");
    model._set("A6", "=SEARCH(\"o\", \"Hello World\", {1,6})");
    model.evaluate();

    assert_eq!(row(&model, 3, 4), ["5", "#VALUE!", "#VALUE!", ""]);
    assert_eq!(row(&model, 4, 4), ["#VALUE!", "#VALUE!", "1", ""]);
    assert_eq!(row(&model, 5, 3), ["1", "7", ""]);
    assert_eq!(row(&model, 6, 3), ["5", "8", ""]);
}

#[test]
fn rept() {
    let mut model = new_empty_model();
    model._set("A1", "=REPT({\"a\",\"b\"}, 2)");
    model._set("A2", "=REPT(\"ab\", {0,1,2})");
    model._set("A3", "=REPT({\"a\",\"b\"}, {1;2})");
    model._set("A5", "=REPT(\"a\", {1,-1})");
    model.evaluate();

    assert_eq!(row(&model, 1, 3), ["aa", "bb", ""]);
    assert_eq!(row(&model, 2, 4), ["", "ab", "abab", ""]);
    assert_eq!(row(&model, 3, 3), ["a", "b", ""]);
    assert_eq!(row(&model, 4, 3), ["aa", "bb", ""]);
    assert_eq!(row(&model, 5, 3), ["a", "#VALUE!", ""]);
}

#[test]
fn substitute() {
    let mut model = model_with_texts();
    model._set("A3", "=SUBSTITUTE(A1:C1, \"-\", \"+\")");
    model._set("A4", "=SUBSTITUTE(\"a-b-c\", \"-\", \"+\", {1,2,3})");
    model._set("A5", "=SUBSTITUTE(\"abc\", {\"a\",\"b\"}, {\"X\",\"Y\"})");
    model._set("A6", "=SUBSTITUTE(\"a-b-c\", \"-\", \"+\", {1,0})");
    model.evaluate();

    assert_eq!(row(&model, 3, 4), ["Hello World", " ab  c ", "x+y+z", ""]);
    assert_eq!(row(&model, 4, 4), ["a+b-c", "a-b+c", "a-b-c", ""]);
    assert_eq!(row(&model, 5, 3), ["Xbc", "aYc", ""]);
    assert_eq!(row(&model, 6, 3), ["a+b-c", "#VALUE!", ""]);
}

#[test]
fn replace() {
    let mut model = model_with_texts();
    model._set("A3", "=REPLACE(A1:C1, 1, 1, \"Z\")");
    model._set("A4", "=REPLACE(\"abcdef\", {1,3,9}, 2, \"-\")");
    model._set(
        "A5",
        "=REPLACE(\"abcdef\", 2, {0,1,9}, {\"X\",\"Y\",\"Z\"})",
    );
    model._set("A6", "=REPLACE(\"abcdef\", {1,0}, {-1,1}, \"-\")");
    model.evaluate();

    assert_eq!(row(&model, 3, 4), ["Zello World", "Zab  c ", "Z-y-z", ""]);
    assert_eq!(row(&model, 4, 4), ["-cdef", "ab-ef", "abcdef-", ""]);
    assert_eq!(row(&model, 5, 4), ["aXbcdef", "aYcdef", "aZ", ""]);
    assert_eq!(row(&model, 6, 3), ["#VALUE!", "#VALUE!", ""]);
}

#[test]
fn errors_are_per_element() {
    let mut model = model_with_texts();
    model._set("B1", "=1/0");
    model._set("A3", "=LEN(A1:C1)");
    model._set("A4", "=TRIM(A1:C1)");
    model._set("A5", "=PROPER(A1:C1)");
    model._set("A6", "=CLEAN(A1:C1)");
    model._set("A7", "=FIND(\"-\", A1:C1)");
    model._set("A8", "=SEARCH(\"-\", A1:C1)");
    model._set("A9", "=REPT(A1:C1, 1)");
    model._set("A10", "=SUBSTITUTE(A1:C1, \"-\", \"\")");
    model._set("A11", "=REPLACE(A1:C1, 1, 1, \"\")");
    model.evaluate();

    for r in 3..=11 {
        assert_eq!(model._get_text_at(0, r, 2), "#DIV/0!", "row {r}");
        assert_ne!(model._get_text_at(0, r, 3), "#DIV/0!", "row {r}");
    }
    assert_eq!(row(&model, 3, 4), ["11", "#DIV/0!", "5", ""]);
    assert_eq!(row(&model, 7, 4), ["#VALUE!", "#DIV/0!", "2", ""]);
}

#[test]
fn arrays_of_different_sizes() {
    let mut model = new_empty_model();
    model._set("A1", "=FIND({\"a\",\"b\"}, {\"ab\",\"ab\",\"ab\"})");
    model._set("A2", "=REPT({\"a\",\"b\",\"c\"}, {1,2})");
    model.evaluate();

    assert_eq!(row(&model, 1, 4), ["1", "2", "#N/A", ""]);
    assert_eq!(row(&model, 2, 4), ["a", "bb", "#N/A", ""]);
}

#[test]
fn single_values_still_work() {
    let mut model = model_with_texts();
    model._set("A3", "=LEN(A1)");
    model._set("B3", "=LEN(1234)");
    model._set("C3", "=LEN(D1)");
    model._set("A4", "=TRIM(B1)");
    model._set("B4", "=PROPER(\"it's a test\")");
    model._set("A5", "=FIND(\"l\", A1, \"4\")");
    model._set("B5", "=SEARCH(\"L\", A1, TRUE)");
    model._set("A6", "=REPT(\"ab\", 2.9)");
    model._set("B6", "=REPT(\"ab\", 2000000000)");
    model._set("A7", "=SUBSTITUTE(C1, \"-\", \"+\", 2)");
    model._set("B7", "=SUBSTITUTE(C1, \"\", \"+\")");
    model._set("A8", "=REPLACE(C1, 2, 3, \"\")");
    // An error argument is the result
    model._set("A9", "=LEN(1/0)");
    model._set("B9", "=FIND(\"a\", NA())");
    // Implicit intersection
    model._set("B10", "=LEN(@A1:C1)");
    model.evaluate();

    assert_eq!(row(&model, 3, 3), ["11", "4", "0"]);
    assert_eq!(row(&model, 4, 2), ["ab c", "It'S A Test"]);
    assert_eq!(row(&model, 5, 2), ["4", "3"]);
    assert_eq!(row(&model, 6, 2), ["abab", "#VALUE!"]);
    assert_eq!(row(&model, 7, 2), ["x-y+z", "x-y-z"]);
    assert_eq!(model._get_text("A8"), *"xz");
    assert_eq!(row(&model, 9, 2), ["#DIV/0!", "#N/A"]);
    assert_eq!(model._get_text("B10"), *"7");
}

#[test]
fn wrong_number_of_arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=LEN()");
    model._set("A2", "=TRIM(\"a\", \"b\")");
    model._set("A3", "=FIND(\"a\")");
    model._set("A4", "=SEARCH(\"a\", \"a\", 1, 1)");
    model._set("A5", "=SUBSTITUTE(\"a\", \"b\")");
    model._set("A6", "=SUBSTITUTE(\"a\", \"b\", \"c\", 1, 1)");
    model._set("A7", "=REPLACE(\"a\", 1, 1)");
    model._set("A8", "=PROPER()");
    model._set("A9", "=CLEAN()");
    model.evaluate();

    for r in 1..=9 {
        assert_eq!(model._get_text_at(0, r, 1), "#ERROR!", "row {r}");
    }
}

// Where one array is shorter than the other the missing elements are #N/A,
// and like any other error they wait their turn: the error of an earlier
// argument comes first.

/// A1:A9 holds texts, with an error in A6 and another one in A8
fn model_with_a_column<'a>() -> Model<'a> {
    let mut model = new_empty_model();
    for (r, value) in [
        "Hello",
        "Adios",
        "Vamos",
        "x-y-z",
        "abcde",
        "=1/0",
        "seven",
        "=SQRT(-1)",
        "nine9",
    ]
    .iter()
    .enumerate()
    {
        model
            .set_user_input(0, r as i32 + 1, 1, value.to_string())
            .unwrap();
    }
    model
}

fn column(model: &Model, column: i32, rows: i32) -> Vec<String> {
    (1..=rows)
        .map(|row| model._get_text_at(0, row, column))
        .collect()
}

#[test]
fn missing_elements_and_errors_left_right_mid() {
    let mut model = model_with_a_column();
    // Nine texts and five numbers
    model._set("C1", "=LEFT(A1:A9, SEQUENCE(5))");
    model._set("D1", "=RIGHT(A1:A9, SEQUENCE(5))");
    model._set("E1", "=MID(A1:A9, SEQUENCE(5), 1)");
    model._set("F1", "=MID(A1:A9, 1, SEQUENCE(5))");
    model.evaluate();

    let tail = ["#DIV/0!", "#N/A", "#NUM!", "#N/A", ""];
    assert_eq!(column(&model, 3, 5), ["H", "Ad", "Vam", "x-y-", "abcde"]);
    assert_eq!(column(&model, 4, 5), ["o", "os", "mos", "-y-z", "abcde"]);
    assert_eq!(column(&model, 5, 5), ["H", "d", "m", "-", "e"]);
    for c in 3..=6 {
        assert_eq!(column(&model, c, 10)[5..], tail, "column {c}");
    }
}

#[test]
fn missing_elements_and_errors_other_functions() {
    let mut model = model_with_a_column();
    model._set("C1", "=FIND(\"o\", A1:A9, {1;1;1;1;1})");
    model._set("D1", "=SEARCH(\"O\", A1:A9, {1;1;1;1;1})");
    model._set("E1", "=REPT(A1:A9, {1;1;1;1;1})");
    model._set(
        "F1",
        "=SUBSTITUTE(A1:A9, \"o\", {\"0\";\"0\";\"0\";\"0\";\"0\"})",
    );
    model._set(
        "G1",
        "=REPLACE(A1:A9, 1, 1, {\"Z\";\"Z\";\"Z\";\"Z\";\"Z\"})",
    );
    model._set("H1", "=EXACT(A1:A9, {\"Hello\";\"b\";\"c\";\"d\";\"e\"})");
    model.evaluate();

    let tail = ["#DIV/0!", "#N/A", "#NUM!", "#N/A", ""];
    assert_eq!(column(&model, 3, 2), ["5", "4"]);
    assert_eq!(column(&model, 5, 2), ["Hello", "Adios"]);
    assert_eq!(column(&model, 6, 2), ["Hell0", "Adi0s"]);
    assert_eq!(column(&model, 7, 2), ["Zello", "Zdios"]);
    assert_eq!(column(&model, 8, 2), ["TRUE", "FALSE"]);
    for c in 3..=8 {
        assert_eq!(column(&model, c, 10)[5..], tail, "column {c}");
    }
}

#[test]
fn a_missing_element_in_an_earlier_argument_comes_first() {
    let mut model = model_with_a_column();
    // Five texts and nine numbers, some of them errors: there is no text to
    // take anything from, whatever the number is
    model._set("C1", "=LEFT({\"a\";\"b\";\"c\";\"d\";\"e\"}, LEN(A1:A9))");
    model._set("D1", "=FIND({\"a\";\"b\";\"c\";\"d\";\"e\"}, A1:A9)");
    model.evaluate();

    assert_eq!(
        column(&model, 3, 10)[5..],
        ["#N/A", "#N/A", "#N/A", "#N/A", ""]
    );
    assert_eq!(
        column(&model, 4, 10)[5..],
        ["#N/A", "#N/A", "#N/A", "#N/A", ""]
    );
}

// "NaN" and "inf" are texts that the parser of numbers would take for
// numbers. They are not numbers these functions can count with.

#[test]
fn text_that_is_not_a_finite_number() {
    let mut model = new_empty_model();
    let formulas = [
        "=REPLACE(\"abc\", \"NaN\", 1, \"x\")",
        "=REPLACE(\"abc\", \"nan\", 1, \"x\")",
        "=REPLACE(\"abc\", 1, \"NaN\", \"x\")",
        "=REPLACE(\"abc\", \"inf\", 1, \"x\")",
        "=REPLACE(\"abc\", 1, \"infinity\", \"x\")",
        "=FIND(\"b\", \"abc\", \"NaN\")",
        "=FIND(\"b\", \"abc\", \"-inf\")",
        "=SEARCH(\"b\", \"abc\", \"NaN\")",
        "=REPT(\"ab\", \"NaN\")",
        "=REPT(\"\", \"inf\")",
        "=SUBSTITUTE(\"a-b-c\", \"-\", \"+\", \"NaN\")",
        "=SUBSTITUTE(\"a-b-c\", \"-\", \"+\", \"inf\")",
    ];
    for (r, formula) in formulas.iter().enumerate() {
        model
            .set_user_input(0, r as i32 + 1, 1, formula.to_string())
            .unwrap();
    }
    model.evaluate();

    for (r, formula) in formulas.iter().enumerate() {
        assert_eq!(
            model._get_text_at(0, r as i32 + 1, 1),
            "#VALUE!",
            "{formula}"
        );
    }
}

#[test]
fn text_that_is_not_a_finite_number_in_an_array() {
    let mut model = new_empty_model();
    model._set("A1", "=REPLACE(\"abc\", {\"NaN\",2,\"inf\"}, 1, \"x\")");
    model._set("A2", "=FIND(\"b\", \"abcb\", {\"NaN\",3})");
    model._set("A3", "=REPT(\"ab\", {\"NaN\",2})");
    model._set("A4", "=SUBSTITUTE(\"a-b-c\", \"-\", \"+\", {\"NaN\",2})");
    model.evaluate();

    assert_eq!(row(&model, 1, 4), ["#VALUE!", "axc", "#VALUE!", ""]);
    assert_eq!(row(&model, 2, 3), ["#VALUE!", "4", ""]);
    assert_eq!(row(&model, 3, 3), ["#VALUE!", "abab", ""]);
    assert_eq!(row(&model, 4, 3), ["#VALUE!", "a-b+c", ""]);
}
