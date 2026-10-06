use std::collections::HashMap;

use crate::expressions::lexer::LexerMode;

use crate::expressions::parser::stringify::to_rc_format;
use crate::expressions::parser::tests::utils::{new_parser, to_english_localized_string};
use crate::expressions::types::CellReferenceRC;

struct Formula<'a> {
    formula_a1: &'a str,
    formula_r1c1: &'a str,
}

#[test]
fn test_parser_formulas_with_full_ranges() {
    let worksheets = vec!["Sheet1".to_string(), "Second Sheet".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    let formulas = vec![
        Formula {
            formula_a1: "IF(C:D>2,B5,SUM(D:D))",
            formula_r1c1: "IF(R1C[2]:R1048576C[3]>2,R[4]C[1],SUM(R1C[3]:R1048576C[3]))",
        },
        Formula {
            formula_a1: "A:A",
            formula_r1c1: "R1C[0]:R1048576C[0]",
        },
        Formula {
            formula_a1: "SUM(3:3)",
            formula_r1c1: "SUM(R[2]C1:R[2]C16384)",
        },
        Formula {
            formula_a1: "SUM($3:$3)",
            formula_r1c1: "SUM(R3C1:R3C16384)",
        },
        Formula {
            formula_a1: "SUM(Sheet1!3:$3)",
            formula_r1c1: "SUM(Sheet1!R[2]C1:R3C16384)",
        },
        Formula {
            formula_a1: "SUM('Second Sheet'!C:D)",
            formula_r1c1: "SUM('Second Sheet'!R1C[2]:R1048576C[3])",
        },
    ];

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    for formula in &formulas {
        let t = parser.parse(
            formula.formula_a1,
            &CellReferenceRC {
                sheet: "Sheet1".to_string(),
                row: 1,
                column: 1,
            },
        );
        assert_eq!(to_rc_format(&t), formula.formula_r1c1);
        assert_eq!(
            to_english_localized_string(&t, &cell_reference),
            formula.formula_a1
        );
    }

    // Now the inverse
    parser.set_lexer_mode(LexerMode::R1C1);
    for formula in &formulas {
        let t = parser.parse(
            formula.formula_r1c1,
            &CellReferenceRC {
                sheet: "Sheet1".to_string(),
                row: 1,
                column: 1,
            },
        );
        assert_eq!(to_rc_format(&t), formula.formula_r1c1);
        assert_eq!(
            to_english_localized_string(&t, &cell_reference),
            formula.formula_a1
        );
    }
}

#[test]
fn test_range_inverse_order() {
    let worksheets = vec!["Sheet1".to_string(), "Sheet2".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };

    // D4:C2 => C2:D4
    let t = parser.parse(
        "SUM(D4:C2)*SUM(Sheet2!D4:C20)*SUM($C$20:D4)",
        &cell_reference,
    );
    assert_eq!(
        to_english_localized_string(&t, &cell_reference),
        "SUM(C2:D4)*SUM(Sheet2!C4:D20)*SUM($C4:D$20)".to_string()
    );
}
