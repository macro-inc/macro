#![allow(clippy::unwrap_used)]

//! "NaN", "inf" and "infinity" are words, and a number too large to hold,
//! like 1e400, is not a number either. None of them is ever read as a number,
//! and no cell ever holds a number that is not finite.

use crate::model::Model;
use crate::number_format::parse_finite_number;
use crate::test::util::new_empty_model;
use crate::types::CellType;

/// The texts that the parser of numbers of the language takes for numbers
const WORDS: [&str; 12] = [
    "NaN",
    "nan",
    "NAN",
    "inf",
    "Inf",
    "INF",
    "infinity",
    "Infinity",
    "+inf",
    "-inf",
    "+NaN",
    "-infinity",
];

fn row(model: &Model, row: i32, columns: i32) -> Vec<String> {
    (1..=columns)
        .map(|column| model._get_text_at(0, row, column))
        .collect()
}

/// Sets each formula in column A, from row 1, and returns what each one shows.
fn evaluate(formulas: &[&str]) -> Vec<String> {
    let mut model = new_empty_model();
    for (r, formula) in formulas.iter().enumerate() {
        model
            .set_user_input(0, r as i32 + 1, 1, formula.to_string())
            .unwrap();
    }
    model.evaluate();
    (1..=formulas.len() as i32)
        .map(|r| model._get_text_at(0, r, 1))
        .collect()
}

#[test]
fn reading_numbers() {
    for (text, number) in [
        ("12", 12.0),
        ("-3.5", -3.5),
        ("+7", 7.0),
        (".5", 0.5),
        ("5.", 5.0),
        ("1e5", 100000.0),
        ("1E-3", 0.001),
        ("1e308", 1e308),
        ("0", 0.0),
        // Too small to hold is zero, which is a number
        ("1e-400", 0.0),
    ] {
        assert_eq!(parse_finite_number(text), Some(number), "{text}");
    }
    for text in WORDS {
        assert_eq!(parse_finite_number(text), None, "{text}");
    }
    for text in [
        "1e400", "-1e400", "1e309", "", " ", "abc", "1e", "--1", "1,5",
    ] {
        assert_eq!(parse_finite_number(text), None, "{text}");
    }
}

#[test]
fn the_words_typed_in_a_cell_are_text() {
    for word in ["NaN", "nan", "inf", "Inf", "infinity", "Infinity"] {
        let mut model = new_empty_model();
        model._set("A1", word);
        model._set("B1", "=A1+1");
        model._set("C1", "=ISNUMBER(A1)");
        model._set("D1", "=ISTEXT(A1)");
        model._set("E1", "=A1&\"!\"");
        model.evaluate();

        assert_eq!(model.get_cell_type(0, 1, 1), Ok(CellType::Text), "{word}");
        assert_eq!(
            row(&model, 1, 5),
            [word, "#VALUE!", "FALSE", "TRUE", &format!("{word}!")],
            "{word}"
        );
        // It is shown as it was typed when edited
        assert_eq!(model.get_localized_cell_content(0, 1, 1).unwrap(), word);
    }
}

#[test]
fn a_number_too_large_typed_in_a_cell_is_text() {
    for text in ["1e400", "1E400", "1e309", "1e400%", "$1e400"] {
        let mut model = new_empty_model();
        model._set("A1", text);
        model._set("B1", "=A1+1");
        model._set("C1", "=ISNUMBER(A1)");
        model.evaluate();

        assert_eq!(model.get_cell_type(0, 1, 1), Ok(CellType::Text), "{text}");
        assert_eq!(row(&model, 1, 3), [text, "#VALUE!", "FALSE"], "{text}");
        assert_eq!(model.get_localized_cell_content(0, 1, 1).unwrap(), text);
    }
    // The largest numbers are still numbers
    let mut model = new_empty_model();
    model._set("A1", "1e308");
    model._set("B1", "=ISNUMBER(A1)");
    model.evaluate();
    assert_eq!(model.get_cell_type(0, 1, 1), Ok(CellType::Number));
    assert_eq!(model._get_text("B1"), "TRUE");
}

#[test]
fn a_text_cell_with_the_words_needs_no_quote() {
    let mut model = new_empty_model();
    model.update_cell_with_text(0, 1, 1, "inf").unwrap();
    model.update_cell_with_text(0, 2, 1, "NaN").unwrap();
    model.update_cell_with_text(0, 3, 1, "1e400").unwrap();
    // A text that reads as a number does: without the quote it would be one
    model.update_cell_with_text(0, 4, 1, "12").unwrap();
    model.update_cell_with_text(0, 5, 1, "1e5").unwrap();

    let content = |r: i32| model.get_localized_cell_content(0, r, 1).unwrap();
    assert_eq!(content(1), "inf");
    assert_eq!(content(2), "NaN");
    assert_eq!(content(3), "1e400");
    assert_eq!(content(4), "'12");
    assert_eq!(content(5), "'1e5");
}

#[test]
fn the_words_are_not_numbers_for_the_operators() {
    for word in WORDS.iter().chain(&["1e400", "-1e400"]) {
        let results = evaluate(&[
            &format!("=\"{word}\"+1"),
            &format!("=1-\"{word}\""),
            &format!("=\"{word}\"*2"),
            &format!("=2/\"{word}\""),
            &format!("=\"{word}\"^2"),
            &format!("=-\"{word}\""),
            &format!("=\"{word}\"%"),
        ]);
        for result in results {
            assert_eq!(result, "#VALUE!", "{word}");
        }
    }
    // They are still texts for everything else
    assert_eq!(
        evaluate(&[
            "=\"inf\"=\"INF\"",
            "=\"inf\"&\"inity\"",
            "=\"nan\">1",
            "=LEN(\"NaN\")"
        ]),
        ["TRUE", "infinity", "TRUE", "3"]
    );
}

#[test]
fn the_words_inside_arrays() {
    let mut model = new_empty_model();
    model._set("A1", "={\"NaN\",1,\"inf\",\"2\"}+1");
    model._set("A2", "={\"1e400\",3}*{2,\"-inf\"}");
    model._set("A3", "=SUM({\"NaN\",1,\"inf\"})");
    model.evaluate();

    assert_eq!(row(&model, 1, 5), ["#VALUE!", "2", "#VALUE!", "3", ""]);
    assert_eq!(row(&model, 2, 3), ["#VALUE!", "#VALUE!", ""]);
    // Texts in an array are not counted
    assert_eq!(model._get_text("A3"), "1");
}

#[test]
fn the_words_are_not_numbers_for_the_functions() {
    for word in ["NaN", "inf", "-inf", "infinity", "1e400"] {
        let results = evaluate(&[
            &format!("=SUM(\"{word}\", 1)"),
            &format!("=PRODUCT(\"{word}\", 2)"),
            &format!("=AVERAGE(\"{word}\", 1)"),
            &format!("=AVERAGEA(\"{word}\", 1)"),
            &format!("=SIN(\"{word}\")"),
            &format!("=ABS(\"{word}\")"),
            &format!("=ROUND(\"{word}\", 1)"),
            &format!("=INT(\"{word}\")"),
            &format!("=MOD(\"{word}\", 2)"),
            &format!("=POWER(\"{word}\", 2)"),
            &format!("=DATE(\"{word}\", 1, 1)"),
            &format!("=DATE(2020, 1, \"{word}\")"),
            &format!("=VALUE(\"{word}\")"),
            &format!("=NUMBERVALUE(\"{word}\")"),
            &format!("=REPT(\"a\", \"{word}\")"),
            &format!("=LEFT(\"abc\", \"{word}\")"),
        ]);
        for (i, result) in results.iter().enumerate() {
            assert_eq!(result, "#VALUE!", "{word}, formula {i}");
        }
    }
}

#[test]
fn the_words_are_not_counted_as_numbers() {
    assert_eq!(
        evaluate(&[
            "=COUNT(\"NaN\", 1)",
            "=COUNT(\"inf\", \"1e400\", \"2\", 1)",
            "=COUNTA(\"NaN\", 1)",
            "=N(\"NaN\")",
            "=ISNUMBER(\"inf\"*1)",
            "=TEXT(\"inf\", \"0\")",
            "=T(\"NaN\")",
        ]),
        ["1", "2", "2", "0", "FALSE", "inf", "NaN"]
    );
}

#[test]
fn criteria_with_the_words_are_texts() {
    let mut model = new_empty_model();
    model.update_cell_with_text(0, 1, 1, "inf").unwrap();
    model.update_cell_with_text(0, 2, 1, "nan").unwrap();
    model.update_cell_with_text(0, 3, 1, "abc").unwrap();
    model.update_cell_with_text(0, 4, 1, "Infinity").unwrap();
    model._set("A5", "5");
    model._set("B1", "10");
    model._set("B2", "20");
    model._set("B3", "30");
    model._set("B4", "40");
    model._set("B5", "50");
    model._set("D1", "=COUNTIF(A1:A5, \"inf\")");
    model._set("D2", "=COUNTIF(A1:A5, \"NaN\")");
    model._set("D3", "=COUNTIF(A1:A5, \"=infinity\")");
    model._set("D4", "=SUMIF(A1:A5, \"nan\", B1:B5)");
    model._set("D5", "=SUMIFS(B1:B5, A1:A5, \"inf\")");
    model._set("D6", "=AVERAGEIF(A1:A5, \"inf\", B1:B5)");
    model._set("D7", "=COUNTIF(A1:A5, \"inf*\")");
    // Numbers are still numbers
    model._set("D8", "=COUNTIF(A1:A5, \"<10\")");
    model._set("D9", "=COUNTIF(A1:A5, \"5\")");
    // A number too large to hold is a text too: no number is below it
    model._set("D10", "=COUNTIF(A1:A5, \"<1e400\")");
    model.evaluate();

    assert_eq!(model._get_text("D1"), "1");
    assert_eq!(model._get_text("D2"), "1");
    assert_eq!(model._get_text("D3"), "1");
    assert_eq!(model._get_text("D4"), "20");
    assert_eq!(model._get_text("D5"), "10");
    assert_eq!(model._get_text("D6"), "10");
    assert_eq!(model._get_text("D7"), "2");
    assert_eq!(model._get_text("D8"), "1");
    assert_eq!(model._get_text("D9"), "1");
    assert_eq!(model._get_text("D10"), "0");
}

#[test]
fn a_number_too_large_in_a_formula_is_an_error() {
    let mut model = new_empty_model();
    model._set("A1", "=1e400");
    model._set("A2", "=SUM(1e400, 1)");
    model._set("A3", "=1e308");
    // Too small to hold is zero
    model._set("A4", "=1e-400");
    model.evaluate();

    assert_eq!(model._get_text("A1"), "#ERROR!");
    assert_eq!(model._get_text("A2"), "#ERROR!");
    assert_eq!(model._get_text("A3"), "1E+308");
    assert_eq!(model._get_text("A4"), "0");
    // The formula is kept as it was written, not as an infinity
    assert_eq!(model._get_formula("A1"), "=1e400");
    assert_eq!(model._get_formula("A2"), "=SUM(1e400, 1)");
}

#[test]
fn a_calculation_that_overflows_is_an_error() {
    let mut model = new_empty_model();
    // In a single cell
    model._set("A1", "=EXP(1000)");
    model._set("A2", "=1e308*10");
    model._set("A3", "=-1e308*10");
    // And in every element of an array
    model._set("A5", "=EXP({1000,1})");
    model._set("A6", "={1e308,1}*10");
    model._set("A7", "=EXP(SEQUENCE(1,3,708,1))");
    model._set("A8", "={-1,-1e308}*10");
    model._set("A9", "=SUM(EXP({1000,1}))");
    model.evaluate();

    assert_eq!(model._get_text("A1"), "#NUM!");
    assert_eq!(model._get_text("A2"), "#NUM!");
    assert_eq!(model._get_text("A3"), "#NUM!");
    assert_eq!(row(&model, 5, 3), ["#NUM!", "2.718281828", ""]);
    assert_eq!(row(&model, 6, 3), ["#NUM!", "10", ""]);
    assert_eq!(row(&model, 7, 4)[2..], ["#NUM!", ""]);
    assert_eq!(row(&model, 8, 3), ["-10", "#NUM!", ""]);
    assert_eq!(model._get_text("A9"), "#NUM!");
    // No cell holds a number that is not finite
    for r in 1..=9 {
        for c in 1..=3 {
            if let Ok(crate::cell::CellValue::Number(v)) = model.get_cell_value_by_index(0, r, c) {
                assert!(v.is_finite(), "row {r} column {c}");
            }
        }
    }
}

#[test]
fn a_number_that_is_not_finite_cannot_be_set_in_a_cell() {
    let mut model = new_empty_model();
    model._set("A1", "7");
    model._set("B1", "=A1+1");
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(
            model.update_cell_with_number(0, 1, 1, value).is_err(),
            "{value}"
        );
        // Also in an empty cell
        assert!(
            model.update_cell_with_number(0, 5, 5, value).is_err(),
            "{value}"
        );
        // And straight in the worksheet
        assert!(
            model
                .workbook
                .worksheet_mut(0)
                .unwrap()
                .set_cell_with_number(1, 1, value, 0)
                .is_err(),
            "{value}"
        );
    }
    model.evaluate();

    // The cells are as they were
    assert_eq!(model._get_text("A1"), "7");
    assert_eq!(model._get_text("B1"), "8");
    assert_eq!(model.is_empty_cell(0, 5, 5), Ok(true));

    // Any other number can
    for value in [0.0, -0.0, 1e308, -1e308, f64::MIN_POSITIVE, f64::MAX] {
        assert_eq!(model.update_cell_with_number(0, 1, 1, value), Ok(()));
    }
    model.update_cell_with_number(0, 1, 1, 41.0).unwrap();
    model.evaluate();
    assert_eq!(model._get_text("B1"), "42");
}

#[test]
fn a_number_too_large_in_a_number_format_is_an_error() {
    assert_eq!(
        evaluate(&[
            "=TEXT(5, \"[>1e400]0.0;0\")",
            "=TEXT(5, \"[<-1e400]0.0;0\")",
            "=TEXT(5, \"[>1e308]0.0;0\")",
            "=TEXT(5, \"[>]0.0;0\")",
        ]),
        ["#VALUE!", "#VALUE!", "5.0", "5.0"]
    );
}
