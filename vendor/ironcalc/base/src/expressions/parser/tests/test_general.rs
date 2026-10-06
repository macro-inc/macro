#![allow(clippy::panic)]

use std::collections::HashMap;

use crate::expressions::lexer::LexerMode;
use crate::expressions::parser::stringify::{to_rc_format, to_string_displaced, DisplaceData};
use crate::expressions::parser::Node;
use crate::expressions::types::CellReferenceRC;
use crate::language::get_default_language;
use crate::locale::get_default_locale;

use crate::expressions::parser::tests::utils::{new_parser, to_english_localized_string};

struct Formula<'a> {
    initial: &'a str,
    expected: &'a str,
}

#[test]
fn test_parser_reference() {
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let t = parser.parse("A2", &cell_reference);
    assert_eq!(to_rc_format(&t), "R[1]C[0]");
}

#[test]
fn test_parser_absolute_column() {
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let t = parser.parse("$A1", &cell_reference);
    assert_eq!(to_rc_format(&t), "R[0]C1");
}

#[test]
fn test_parser_absolute_row_col() {
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let t = parser.parse("$C$5", &cell_reference);
    assert_eq!(to_rc_format(&t), "R5C3");
}

#[test]
fn test_parser_absolute_row_col_1() {
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let t = parser.parse("$A$1", &cell_reference);
    assert_eq!(to_rc_format(&t), "R1C1");
}

#[test]
fn test_parser_simple_formula() {
    let worksheets = vec!["Sheet1".to_string(), "Sheet2".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };

    let t = parser.parse("C3+Sheet2!D4", &cell_reference);
    assert_eq!(to_rc_format(&t), "R[2]C[2]+Sheet2!R[3]C[3]");
}

#[test]
fn test_parser_boolean() {
    let worksheets = vec!["Sheet1".to_string(), "Sheet2".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };

    let t = parser.parse("true", &cell_reference);
    assert_eq!(to_rc_format(&t), "TRUE");
}

#[test]
fn test_parser_bad_formula() {
    let worksheets = vec!["Sheet1".to_string(), "Sheet2".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let t = parser.parse("#Value", &cell_reference);
    match &t {
        Node::ParseErrorKind {
            formula,
            message,
            position,
            ..
        } => {
            assert_eq!(formula, "#Value");
            assert_eq!(message, "Unexpected token: 'Spill'");
            assert_eq!(*position, 0);
        }
        _ => {
            panic!("Expected error in formula");
        }
    }
    assert_eq!(to_rc_format(&t), "#Value");
}

#[test]
fn test_parser_bad_formula_1() {
    let worksheets = vec!["Sheet1".to_string(), "Sheet2".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let t = parser.parse("<5", &cell_reference);
    match &t {
        Node::ParseErrorKind {
            formula,
            message,
            position,
            ..
        } => {
            assert_eq!(formula, "<5");
            assert_eq!(message, "Unexpected token: 'COMPARE'");
            assert_eq!(*position, 0);
        }
        _ => {
            panic!("Expected error in formula");
        }
    }
    assert_eq!(to_rc_format(&t), "<5");
}

#[test]
fn test_parser_bad_formula_2() {
    let worksheets = vec!["Sheet1".to_string(), "Sheet2".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let t = parser.parse("*5", &cell_reference);
    match &t {
        Node::ParseErrorKind {
            formula,
            message,
            position,
            ..
        } => {
            assert_eq!(formula, "*5");
            assert_eq!(message, "Unexpected token: 'PRODUCT'");
            assert_eq!(*position, 0);
        }
        _ => {
            panic!("Expected error in formula");
        }
    }
    assert_eq!(to_rc_format(&t), "*5");
}

#[test]
fn test_parser_bad_formula_3() {
    let worksheets = vec!["Sheet1".to_string(), "Sheet2".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let t = parser.parse("SUM(#VALVE!)", &cell_reference);
    match &t {
        Node::ParseErrorKind {
            formula,
            message,
            position,
            ..
        } => {
            assert_eq!(formula, "SUM(#VALVE!)");
            assert_eq!(message, "Unexpected token: 'Spill'");
            assert_eq!(*position, 0);
        }
        _ => {
            panic!("Expected error in formula");
        }
    }
    assert_eq!(to_rc_format(&t), "SUM(#VALVE!)");
}

#[test]
fn test_parser_formulas() {
    let worksheets = vec!["Sheet1".to_string(), "Sheet2".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    let formulas = vec![
        Formula {
            initial: "IF(C3:D4>2,B5,SUM(D1:D7))",
            expected: "IF(R[2]C[2]:R[3]C[3]>2,R[4]C[1],SUM(R[0]C[3]:R[6]C[3]))",
        },
        Formula {
            initial: "-A1",
            expected: "-R[0]C[0]",
        },
        Formula {
            initial: "#VALUE!",
            expected: "#VALUE!",
        },
        Formula {
            initial: "SUM(C3:D4)",
            expected: "SUM(R[2]C[2]:R[3]C[3])",
        },
        Formula {
            initial: "A1/(B1-C1)",
            expected: "R[0]C[0]/(R[0]C[1]-R[0]C[2])",
        },
    ];

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    for formula in formulas {
        let t = parser.parse(
            formula.initial,
            &CellReferenceRC {
                sheet: "Sheet1".to_string(),
                row: 1,
                column: 1,
            },
        );
        assert_eq!(to_rc_format(&t), formula.expected);
        assert_eq!(
            to_english_localized_string(&t, &cell_reference),
            formula.initial
        );
    }
}

#[test]
fn test_parser_r1c1_formulas() {
    let worksheets = vec!["Sheet1".to_string(), "Sheet2".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());
    parser.set_lexer_mode(LexerMode::R1C1);

    let formulas = vec![
        Formula {
            initial: "IF(R[2]C[2]:R[3]C[3]>2,R[4]C[1],SUM(R[0]C[3]:R[6]C[3]))",
            expected: "IF(E5:F6>2,D7,SUM(F3:F9))",
        },
        Formula {
            initial: "-R[0]C[0]",
            expected: "-C3",
        },
        Formula {
            initial: "R[1]C[-1]+1",
            expected: "B4+1",
        },
        Formula {
            initial: "#VALUE!",
            expected: "#VALUE!",
        },
        Formula {
            initial: "SUM(R[2]C[2]:R[3]C[3])",
            expected: "SUM(E5:F6)",
        },
        Formula {
            initial: "R[-3]C[0]",
            expected: "#REF!",
        },
        Formula {
            initial: "R[0]C[-3]",
            expected: "#REF!",
        },
        Formula {
            initial: "R[-2]C[-2]",
            expected: "A1",
        },
        Formula {
            initial: "SIN(R[-3]C[-3])",
            expected: "SIN(#REF!)",
        },
    ];

    // Reference cell is Sheet1!C3
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 3,
        column: 3,
    };
    for formula in formulas {
        let t = parser.parse(
            formula.initial,
            &CellReferenceRC {
                sheet: "Sheet1".to_string(),
                row: 1,
                column: 1,
            },
        );
        assert_eq!(
            to_english_localized_string(&t, &cell_reference),
            formula.expected
        );
        assert_eq!(to_rc_format(&t), formula.initial);
    }
}

#[test]
fn test_parser_quotes() {
    let worksheets = vec!["Sheet1".to_string(), "Second Sheet".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };

    let t = parser.parse("C3+'Second Sheet'!D4", &cell_reference);
    assert_eq!(to_rc_format(&t), "R[2]C[2]+'Second Sheet'!R[3]C[3]");
}

#[test]
fn test_parser_escape_quotes() {
    let worksheets = vec!["Sheet1".to_string(), "Second '2' Sheet".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };

    let t = parser.parse("C3+'Second ''2'' Sheet'!D4", &cell_reference);
    assert_eq!(to_rc_format(&t), "R[2]C[2]+'Second ''2'' Sheet'!R[3]C[3]");
}

#[test]
fn test_parser_parenthesis() {
    let worksheets = vec!["Sheet1".to_string(), "Second2".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };

    let t = parser.parse("(C3=\"Yes\")*5", &cell_reference);
    assert_eq!(to_rc_format(&t), "(R[2]C[2]=\"Yes\")*5");
}

#[test]
fn test_parser_excel_xlfn() {
    let worksheets = vec!["Sheet1".to_string(), "Second2".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };

    let t = parser.parse("_xlfn.CONCAT(C3)", &cell_reference);
    assert_eq!(to_rc_format(&t), "CONCAT(R[2]C[2])");
}

#[test]
fn test_to_string_displaced() {
    let context = &CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    let node = parser.parse("C3", context);
    let displace_data = DisplaceData::Column {
        sheet: 0,
        column: 1,
        delta: 4,
    };
    let t = to_string_displaced(
        &node,
        context,
        &displace_data,
        get_default_locale(),
        get_default_language(),
    );
    assert_eq!(t, "G3".to_string());
}

#[test]
fn test_to_string_displaced_full_ranges() {
    let context = &CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    let node = parser.parse("SUM(3:3)", context);
    let displace_data = DisplaceData::Column {
        sheet: 0,
        column: 1,
        delta: 4,
    };
    assert_eq!(
        to_string_displaced(
            &node,
            context,
            &displace_data,
            get_default_locale(),
            get_default_language(),
        ),
        "SUM(3:3)".to_string()
    );

    let node = parser.parse("SUM(D:D)", context);
    let displace_data = DisplaceData::Row {
        sheet: 0,
        row: 3,
        delta: 4,
    };
    assert_eq!(
        to_string_displaced(
            &node,
            context,
            &displace_data,
            get_default_locale(),
            get_default_language(),
        ),
        "SUM(D:D)".to_string()
    );
}

#[test]
fn test_to_string_displaced_too_low() {
    let context = &CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    let node = parser.parse("C3", context);
    let displace_data = DisplaceData::Column {
        sheet: 0,
        column: 1,
        delta: -40,
    };
    let t = to_string_displaced(
        &node,
        context,
        &displace_data,
        get_default_locale(),
        get_default_language(),
    );
    assert_eq!(t, "#REF!".to_string());
}

#[test]
fn test_to_string_displaced_too_high() {
    let context = &CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    let node = parser.parse("C3", context);
    let displace_data = DisplaceData::Column {
        sheet: 0,
        column: 1,
        delta: 4000000,
    };
    let t = to_string_displaced(
        &node,
        context,
        &displace_data,
        get_default_locale(),
        get_default_language(),
    );
    assert_eq!(t, "#REF!".to_string());
}
