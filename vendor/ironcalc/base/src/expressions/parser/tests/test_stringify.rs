#![allow(clippy::panic)]

use std::collections::HashMap;

use crate::expressions::parser::tests::utils::{new_parser, to_english_localized_string};
use crate::expressions::types::CellReferenceRC;

#[test]
fn exp_order() {
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let t = parser.parse("(1 + 2)^3  + 4", &cell_reference);
    assert_eq!(
        to_english_localized_string(&t, &cell_reference),
        "(1+2)^3+4"
    );

    let t = parser.parse("(C5 + 3)^R4", &cell_reference);
    assert_eq!(
        to_english_localized_string(&t, &cell_reference),
        "(C5+3)^R4"
    );

    let t = parser.parse("(C5 + 3)^(R4*6)", &cell_reference);
    assert_eq!(
        to_english_localized_string(&t, &cell_reference),
        "(C5+3)^(R4*6)"
    );

    let t = parser.parse("(C5)^(R4)", &cell_reference);
    assert_eq!(to_english_localized_string(&t, &cell_reference), "C5^R4");

    let t = parser.parse("(5)^(4)", &cell_reference);
    assert_eq!(to_english_localized_string(&t, &cell_reference), "5^4");
}

#[test]
fn correct_parenthesis() {
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };

    let t = parser.parse("-(1 + 1)", &cell_reference);
    assert_eq!(to_english_localized_string(&t, &cell_reference), "-(1+1)");

    let t = parser.parse("1 - (3 + 4)", &cell_reference);
    assert_eq!(to_english_localized_string(&t, &cell_reference), "1-(3+4)");

    let t = parser.parse("-(1.05*(0.0284 + 0.0046) - 0.0284)", &cell_reference);
    assert_eq!(
        to_english_localized_string(&t, &cell_reference),
        "-(1.05*(0.0284+0.0046)-0.0284)"
    );

    let t = parser.parse("1 + (3+5)", &cell_reference);
    assert_eq!(to_english_localized_string(&t, &cell_reference), "1+3+5");

    let t = parser.parse("1 - (3+5)", &cell_reference);
    assert_eq!(to_english_localized_string(&t, &cell_reference), "1-(3+5)");

    let t = parser.parse("(1 - 3) - (3+5)", &cell_reference);
    assert_eq!(
        to_english_localized_string(&t, &cell_reference),
        "1-3-(3+5)"
    );

    let t = parser.parse("1 + (3<5)", &cell_reference);
    assert_eq!(to_english_localized_string(&t, &cell_reference), "1+(3<5)");
}
