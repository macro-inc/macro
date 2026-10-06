#![allow(clippy::unwrap_used)]

//! The minus in front of a value turns it into a number, and two of them do
//! not cancel out: `--x` is the usual way to turn `TRUE` into 1. The minus and
//! the percentage work element by element on ranges and arrays.

use crate::expressions::types::{Area, CellReferenceIndex};
use crate::model::Model;
use crate::test::util::new_empty_model;

/// A1:A4 holds h, e, h, l; B1:B4 holds 1 to 4; C1:C4 holds the text 3, TRUE,
/// nothing and abc
fn model_with_data<'a>() -> Model<'a> {
    let mut model = new_empty_model();
    for (cell, value) in [
        ("A1", "h"),
        ("A2", "e"),
        ("A3", "h"),
        ("A4", "l"),
        ("B1", "1"),
        ("B2", "2"),
        ("B3", "3"),
        ("B4", "4"),
        ("C1", "'3"),
        ("C2", "TRUE"),
        ("C4", "abc"),
    ] {
        model._set(cell, value);
    }
    model
}

/// Sets each formula in column E, from row 1, and returns what each one shows.
fn evaluate(formulas: &[&str]) -> Vec<String> {
    let mut model = model_with_data();
    for (r, formula) in formulas.iter().enumerate() {
        model
            .set_user_input(0, r as i32 + 1, 5, formula.to_string())
            .unwrap();
    }
    model.evaluate();
    (1..=formulas.len() as i32)
        .map(|r| model._get_text_at(0, r, 5))
        .collect()
}

/// What a formula set in E10 spills, as rows of `columns` cells
fn spill(formula: &str, rows: i32, columns: i32) -> Vec<Vec<String>> {
    let mut model = model_with_data();
    model._set("E10", formula);
    model.evaluate();
    (0..rows)
        .map(|r| {
            (0..columns)
                .map(|c| model._get_text_at(0, 10 + r, 5 + c))
                .collect()
        })
        .collect()
}

#[test]
fn two_minus_make_a_number() {
    assert_eq!(
        evaluate(&[
            "=--TRUE",
            "=--FALSE",
            "=--\"3\"",
            "=ISNUMBER(--\"3\")",
            "=TYPE(--TRUE)",
            "=--C1",
            "=--C2",
            "=--C3",
            "=ISNUMBER(--C1)",
        ]),
        ["1", "0", "3", "TRUE", "1", "3", "1", "0", "TRUE"]
    );
}

#[test]
fn two_minus_of_what_is_not_a_number() {
    assert_eq!(
        evaluate(&["=--\"abc\"", "=--\"\"", "=--C4", "=--NA()", "=--(1/0)"]),
        ["#VALUE!", "#VALUE!", "#VALUE!", "#N/A", "#DIV/0!"]
    );
}

#[test]
fn two_minus_of_text_that_reads_as_a_number() {
    assert_eq!(
        evaluate(&[
            "=--\"50%\"",
            "=--\"$5\"",
            "=--\"1e3\"",
            "=--\"2020-01-01\"",
            "=--\"12:00\"",
            "=--\"6:00:00\"",
            "=--\"6 PM\"",
            "=\"12:00\"+1",
            "=ISNUMBER(--\"12:00\")",
        ]),
        ["0.5", "5", "1000", "43831", "0.5", "0.25", "0.75", "1.5", "TRUE"]
    );
}

#[test]
fn one_and_three_minus() {
    assert_eq!(
        evaluate(&[
            "=-TRUE", "=---TRUE", "=-\"3\"", "=-B2", "=---B2", "=----B2", "=-(-3)", "=2--3",
            "=2---3", "=2- -3",
        ]),
        ["-1", "-1", "-3", "-2", "-2", "2", "3", "5", "-1", "5"]
    );
}

#[test]
fn the_minus_comes_before_the_power() {
    assert_eq!(
        evaluate(&["=-2^2", "=0-2^2", "=--2^2", "=-B2^2", "=2^-1"]),
        ["4", "-4", "4", "4", "0.5"]
    );
}

#[test]
fn a_plus_changes_nothing() {
    assert_eq!(
        evaluate(&[
            "=+TRUE",
            "=TYPE(+TRUE)",
            "=TYPE(+\"3\")",
            "=+\"abc\"",
            "=++C4",
            "=+-TRUE",
            "=-+TRUE",
            "=+B2",
        ]),
        ["TRUE", "4", "2", "abc", "abc", "-1", "-1", "2"]
    );
}

#[test]
fn two_minus_on_arrays() {
    let column = |values: [&str; 4]| -> Vec<Vec<String>> {
        values.iter().map(|v| vec![v.to_string()]).collect()
    };
    assert_eq!(
        spill("=--(A1:A4=\"h\")", 4, 1),
        column(["1", "0", "1", "0"])
    );
    assert_eq!(spill("=--C1:C4", 4, 1), column(["3", "1", "0", "#VALUE!"]));
    assert_eq!(
        spill("=--EXACT(A1:A4, \"h\")", 4, 1),
        column(["1", "0", "1", "0"])
    );
    assert_eq!(
        spill("=LAMBDA(x, --x)(A1:A4=\"h\")", 4, 1),
        column(["1", "0", "1", "0"])
    );
    assert_eq!(spill("=--{TRUE,FALSE}", 1, 3), [["1", "0", ""]]);
    assert_eq!(spill("=--{\"1\",\"x\"}", 1, 3), [["1", "#VALUE!", ""]]);
}

#[test]
fn two_minus_inside_functions() {
    assert_eq!(
        evaluate(&[
            "=SUM(--(A1:A4=\"h\"))",
            "=SUMPRODUCT(--(A1:A4=\"h\"))",
            "=SUMPRODUCT(--(A1:A4=\"h\"), B1:B4)",
            "=SUMPRODUCT(--(A1:A4=\"h\"), --(B1:B4>1))",
            "=SUM(--C1:C4)",
            "=SUM(--C1:C3)",
            "=SUM(--(B1:B4>2))",
        ]),
        ["2", "2", "4", "1", "#VALUE!", "4", "2"]
    );
}

#[test]
fn one_minus_on_arrays() {
    let column = |values: [&str; 4]| -> Vec<Vec<String>> {
        values.iter().map(|v| vec![v.to_string()]).collect()
    };
    assert_eq!(spill("=-B1:B4", 4, 1), column(["-1", "-2", "-3", "-4"]));
    assert_eq!(spill("=-(B1:B4*2)", 4, 1), column(["-2", "-4", "-6", "-8"]));
    assert_eq!(
        spill("=-SEQUENCE(4)", 4, 1),
        column(["-1", "-2", "-3", "-4"])
    );
    assert_eq!(spill("=-{1,2,3}", 1, 4), [["-1", "-2", "-3", ""]]);
    assert_eq!(
        spill("=-{1,\"a\",TRUE}", 1, 4),
        [["-1", "#VALUE!", "-1", ""]]
    );
    assert_eq!(spill("=-{1,#N/A}", 1, 3), [["-1", "#N/A", ""]]);
    assert_eq!(evaluate(&["=SUM(-B1:B4)", "=-SUM(B1:B4)"]), ["-10", "-10"]);
}

#[test]
fn percentage_on_arrays() {
    assert_eq!(
        spill("=B1:B4%", 4, 1),
        [["0.01"], ["0.02"], ["0.03"], ["0.04"]]
    );
    assert_eq!(spill("={10,20}%", 1, 3), [["0.1", "0.2", ""]]);
    assert_eq!(spill("={10,\"a\"}%", 1, 3), [["0.1", "#VALUE!", ""]]);
    assert_eq!(
        evaluate(&["=10%", "=B2%", "=50%%", "=-50%", "=SUM(B1:B4%)"]),
        ["0.1", "0.02", "0.005", "-0.5", "0.1"]
    );
}

#[test]
fn the_formula_is_kept_as_written() {
    let mut model = model_with_data();
    for (r, formula) in [
        "=--TRUE",
        "=---B2",
        "=--(A1:A4=\"h\")",
        "=SUMPRODUCT(--(A1:A4=\"h\"),B1:B4)",
        "=-(A1=B1)",
        "=-(A1&B1)",
        "=-(B1+B2)",
        "=2--3",
        "=-B1:B4",
        "=--C1:C4",
        "=-2^2",
    ]
    .iter()
    .enumerate()
    {
        let row = 20 + r as i32;
        model
            .set_user_input(0, row, 7, formula.to_string())
            .unwrap();
        assert_eq!(
            model.get_cell_formula(0, row, 7).unwrap(),
            Some(formula.to_string())
        );
    }
}

#[test]
fn the_formula_is_kept_when_moved() {
    let mut model = new_empty_model();
    let source = &CellReferenceIndex {
        sheet: 0,
        column: 1,
        row: 1,
    };
    let target = &CellReferenceIndex {
        sheet: 0,
        column: 10,
        row: 10,
    };
    // The 2x2 square moves, and A2 with it
    let area = &Area {
        sheet: 0,
        row: 1,
        column: 1,
        width: 2,
        height: 2,
    };
    for (formula, moved) in [
        ("=--A2", "=--J11"),
        ("=--(A2=\"h\")", "=--(J11=\"h\")"),
        ("=-(A2=B2)", "=-(J11=K11)"),
        ("=-(A2&B2)", "=-(J11&K11)"),
        ("=-(A2+3)", "=-(J11+3)"),
        (
            "=SUMPRODUCT(--(A1:A2=\"h\"))",
            "=SUMPRODUCT(--(J10:J11=\"h\"))",
        ),
        ("=-A2^2", "=-J11^2"),
        ("=-A2*3", "=-J11*3"),
    ] {
        assert_eq!(
            model.move_cell_value_to_area(formula, source, target, area),
            Ok(moved.to_string()),
            "{formula}"
        );
    }
}
