#![allow(clippy::unwrap_used)]

use crate::expressions::utils::column_to_number;
use crate::language::get_language;
use crate::locale::get_locale;

use crate::expressions::{
    lexer::{Lexer, LexerError, LexerMode},
    token::TokenType::*,
    token::{Error, OpCompare, OpProduct, OpSum},
    types::ParsedReference,
};

fn new_lexer(formula: &str, a1_mode: bool) -> Lexer<'_> {
    let locale = get_locale("en").unwrap();
    let language = get_language("en").unwrap();
    let mode = if a1_mode {
        LexerMode::A1
    } else {
        LexerMode::R1C1
    };
    Lexer::new(formula, mode, locale, language)
}

#[test]
fn test_number_zero() {
    let mut lx = new_lexer("0", true);
    assert_eq!(lx.next_token(), Number(0.0));
    assert_eq!(lx.next_token(), EOF);
}
#[test]
fn test_number_integer() {
    let mut lx = new_lexer("42", true);
    assert_eq!(lx.next_token(), Number(42.0));
    assert_eq!(lx.next_token(), EOF);
}
#[test]
fn test_number_pi() {
    let mut lx = new_lexer("3.415", true);
    assert_eq!(lx.next_token(), Number(3.415));
    assert_eq!(lx.next_token(), EOF);
}
#[test]
fn test_number_less_than_one() {
    let mut lx = new_lexer(".1415", true);
    assert_eq!(lx.next_token(), Number(0.1415));
    assert_eq!(lx.next_token(), EOF);
}
#[test]
fn test_number_less_than_one_bis() {
    let mut lx = new_lexer("0.1415", true);
    assert_eq!(lx.next_token(), Number(0.1415));
    assert_eq!(lx.next_token(), EOF);
}
#[test]
fn test_number_scientific() {
    let mut lx = new_lexer("1.1415e12", true);
    assert_eq!(lx.next_token(), Number(1.1415e12));
    assert_eq!(lx.next_token(), EOF);
}
#[test]
fn test_number_scientific_1() {
    let mut lx = new_lexer("2.4e-12", true);
    assert_eq!(lx.next_token(), Number(2.4e-12));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_number_scientific_1b() {
    let mut lx = new_lexer("2.4E-12", true);
    assert_eq!(lx.next_token(), Number(2.4e-12));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_not_a_number() {
    let mut lx = new_lexer("..", true);
    assert!(matches!(lx.next_token(), Illegal(_)));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_string() {
    let mut lx = new_lexer("\"Hello World!\"", true);
    assert_eq!(lx.next_token(), String("Hello World!".to_string()));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_string_unicode() {
    let mut lx = new_lexer("\"你好，世界！\"", true);
    assert_eq!(lx.next_token(), String("你好，世界！".to_string()));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_boolean() {
    let mut lx = new_lexer("FALSE", true);
    assert_eq!(lx.next_token(), Boolean(false));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_boolean_true() {
    let mut lx = new_lexer("True", true);
    assert_eq!(lx.next_token(), Boolean(true));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_reference() {
    let mut lx = new_lexer("A1", true);
    assert_eq!(
        lx.next_token(),
        Reference {
            sheet: None,
            column: 1,
            row: 1,
            absolute_column: false,
            absolute_row: false,
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_reference_absolute() {
    let mut lx = new_lexer("$A$1", true);
    assert_eq!(
        lx.next_token(),
        Reference {
            sheet: None,
            column: 1,
            row: 1,
            absolute_column: true,
            absolute_row: true,
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_reference_absolute_1() {
    let mut lx = new_lexer("AB$12", true);
    assert_eq!(
        lx.next_token(),
        Reference {
            sheet: None,
            column: 28,
            row: 12,
            absolute_column: false,
            absolute_row: true,
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_reference_absolute_2() {
    let mut lx = new_lexer("$CC234", true);
    assert_eq!(
        lx.next_token(),
        Reference {
            sheet: None,
            column: 81,
            row: 234,
            absolute_column: true,
            absolute_row: false,
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_reference_sheet() {
    let mut lx = new_lexer("Sheet1!C34", true);
    assert_eq!(
        lx.next_token(),
        Reference {
            sheet: Some("Sheet1".to_string()),
            column: 3,
            row: 34,
            absolute_column: false,
            absolute_row: false,
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_reference_sheet_unicode() {
    // Not that also tests the '!'
    let mut lx = new_lexer("'A € world!'!C34", true);
    assert_eq!(
        lx.next_token(),
        Reference {
            sheet: Some("A € world!".to_string()),
            column: 3,
            row: 34,
            absolute_column: false,
            absolute_row: false,
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_reference_sheet_unicode_absolute() {
    let mut lx = new_lexer("'A €'!$C$34", true);
    assert_eq!(
        lx.next_token(),
        Reference {
            sheet: Some("A €".to_string()),
            column: 3,
            row: 34,
            absolute_column: true,
            absolute_row: true,
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_unmatched_quote() {
    let mut lx = new_lexer("'A €!$C$34", true);
    assert!(matches!(lx.next_token(), Illegal(_)));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_sum() {
    let mut lx = new_lexer("2.4+3.415", true);
    assert_eq!(lx.next_token(), Number(2.4));
    assert_eq!(lx.next_token(), Addition(OpSum::Add));
    assert_eq!(lx.next_token(), Number(3.415));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_sum_1() {
    let mut lx = new_lexer("A2 + 'First Sheet'!$B$3", true);
    assert_eq!(
        lx.next_token(),
        Reference {
            sheet: None,
            column: 1,
            row: 2,
            absolute_column: false,
            absolute_row: false,
        }
    );
    assert_eq!(lx.next_token(), Addition(OpSum::Add));
    assert_eq!(
        lx.next_token(),
        Reference {
            sheet: Some("First Sheet".to_string()),
            column: 2,
            row: 3,
            absolute_column: true,
            absolute_row: true,
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_error_value() {
    let mut lx = new_lexer("#VALUE!", true);
    assert_eq!(lx.next_token(), Error(Error::VALUE));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_error_error() {
    let mut lx = new_lexer("#ERROR!", true);
    assert_eq!(lx.next_token(), Error(Error::ERROR));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_error_div() {
    let mut lx = new_lexer("#DIV/0!", true);
    assert_eq!(lx.next_token(), Error(Error::DIV));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_error_na() {
    let mut lx = new_lexer("#N/A", true);
    assert_eq!(lx.next_token(), Error(Error::NA));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_error_name() {
    let mut lx = new_lexer("#NAME?", true);
    assert_eq!(lx.next_token(), Error(Error::NAME));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_error_num() {
    let mut lx = new_lexer("#NUM!", true);
    assert_eq!(lx.next_token(), Error(Error::NUM));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_error_calc() {
    let mut lx = new_lexer("#CALC!", true);
    assert_eq!(lx.next_token(), Error(Error::CALC));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_error_null() {
    let mut lx = new_lexer("#NULL!", true);
    assert_eq!(lx.next_token(), Error(Error::NULL));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_error_spill() {
    let mut lx = new_lexer("#SPILL!", true);
    assert_eq!(lx.next_token(), Error(Error::SPILL));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_error_circ() {
    let mut lx = new_lexer("#CIRC!", true);
    assert_eq!(lx.next_token(), Error(Error::CIRC));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_error_invalid() {
    let mut lx = new_lexer("#VALU!", true);
    assert!(matches!(lx.next_token(), Spill));
    assert!(matches!(lx.next_token(), Illegal(_)));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_add_errors() {
    let mut lx = new_lexer("#DIV/0!+#NUM!", true);
    assert_eq!(lx.next_token(), Error(Error::DIV));
    assert_eq!(lx.next_token(), Addition(OpSum::Add));
    assert_eq!(lx.next_token(), Error(Error::NUM));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_variable_name() {
    let mut lx = new_lexer("MyVar", true);
    assert_eq!(lx.next_token(), Ident("MyVar".to_string()));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_last_reference() {
    let mut lx = new_lexer("XFD1048576", true);
    assert_eq!(
        lx.next_token(),
        Reference {
            sheet: None,
            column: 16384,
            row: 1048576,
            absolute_column: false,
            absolute_row: false,
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_not_a_reference() {
    let mut lx = new_lexer("XFE10", true);
    assert_eq!(lx.next_token(), Ident("XFE10".to_string()));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_reference_r1c1() {
    let mut lx = new_lexer("R1C1", false);
    assert_eq!(
        lx.next_token(),
        Reference {
            sheet: None,
            column: 1,
            row: 1,
            absolute_column: true,
            absolute_row: true,
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_reference_r1c1_true() {
    let mut lx = new_lexer("R1C1", true);
    // NOTE: This is what google docs does.
    // Excel will not let you enter this formula.
    // Online Excel will let you and will mark the cell as in Error
    assert!(matches!(lx.next_token(), Illegal(_)));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_name_r1c1p() {
    let mut lx = new_lexer("R1C1P", false);
    assert_eq!(lx.next_token(), Ident("R1C1P".to_string()));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_reference_r1c1_error() {
    let mut lx = new_lexer("$A$4", false);
    lx.mode = LexerMode::R1C1;
    assert_eq!(
        lx.next_token(),
        Illegal(LexerError {
            position: 1,
            message: "Cannot parse A1 reference in R1C1 mode".to_string(),
        })
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_name_wrong_ref() {
    let mut lx = new_lexer("Sheet1!2", false);
    assert!(matches!(lx.next_token(), Illegal(_)));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_reference_1() {
    let mut lx = new_lexer("Sheet1!R[1]C[2]", false);
    assert_eq!(
        lx.next_token(),
        Reference {
            sheet: Some("Sheet1".to_string()),
            column: 2,
            row: 1,
            absolute_column: false,
            absolute_row: false,
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_reference_quotes() {
    let mut lx = new_lexer("'Sheet 1'!R[1]C[2]", false);
    assert_eq!(
        lx.next_token(),
        Reference {
            sheet: Some("Sheet 1".to_string()),
            column: 2,
            row: 1,
            absolute_column: false,
            absolute_row: false,
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_reference_escape_quotes() {
    let mut lx = new_lexer("'Sheet ''one'' 1'!R[1]C[2]", false);
    assert_eq!(
        lx.next_token(),
        Reference {
            sheet: Some("Sheet 'one' 1".to_string()),
            column: 2,
            row: 1,
            absolute_column: false,
            absolute_row: false,
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_reference_unfinished_quotes() {
    let mut lx = new_lexer("'Sheet 1!R[1]C[2]", false);
    assert!(matches!(lx.next_token(), Illegal(_)));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_round_function() {
    let mut lx = new_lexer("ROUND", false);
    assert_eq!(lx.next_token(), Ident("ROUND".to_string()));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_ident_with_underscore() {
    let mut lx = new_lexer("_IDENT", false);
    assert_eq!(lx.next_token(), Ident("_IDENT".to_string()));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_ident_with_period() {
    let mut lx = new_lexer("IDENT.IFIER", false);
    assert_eq!(lx.next_token(), Ident("IDENT.IFIER".to_string()));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_ident_cannot_start_with_period() {
    let mut lx = new_lexer(".IFIER", false);
    assert!(matches!(lx.next_token(), Illegal(_)));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_xlfn() {
    let mut lx = new_lexer("_xlfn.MyVar", true);
    assert_eq!(lx.next_token(), Ident("_xlfn.MyVar".to_string()));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_power() {
    let mut lx = new_lexer("4 ^ 2", false);
    assert_eq!(lx.next_token(), Number(4.0));
    assert_eq!(lx.next_token(), Power);
    assert_eq!(lx.next_token(), Number(2.0));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_parenthesis() {
    let mut lx = new_lexer("(1)", false);
    assert_eq!(lx.next_token(), LeftParenthesis);
    assert_eq!(lx.next_token(), Number(1.0));
    assert_eq!(lx.next_token(), RightParenthesis);
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_brackets() {
    let mut lx = new_lexer("[1]", false);
    assert_eq!(lx.next_token(), LeftBracket);
    assert_eq!(lx.next_token(), Number(1.0));
    assert_eq!(lx.next_token(), RightBracket);
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_braces() {
    let mut lx = new_lexer("{1}", false);
    assert_eq!(lx.next_token(), LeftBrace);
    assert_eq!(lx.next_token(), Number(1.0));
    assert_eq!(lx.next_token(), RightBrace);
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_percent() {
    let mut lx = new_lexer("10%", false);
    assert_eq!(lx.next_token(), Number(10.0));
    assert_eq!(lx.next_token(), Percent);
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_range() {
    let mut lx = new_lexer("A1:B3", true);
    assert_eq!(
        lx.next_token(),
        Range {
            sheet: None,
            left: ParsedReference {
                column: 1,
                row: 1,
                absolute_column: false,
                absolute_row: false
            },
            right: ParsedReference {
                column: 2,
                row: 3,
                absolute_column: false,
                absolute_row: false
            },
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_addition() {
    let mut lx = new_lexer("1 + 2", false);
    assert_eq!(lx.next_token(), Number(1.0));
    assert_eq!(lx.next_token(), Addition(OpSum::Add));
    assert_eq!(lx.next_token(), Number(2.0));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_subtraction() {
    let mut lx = new_lexer("1 - 2", false);
    assert_eq!(lx.next_token(), Number(1.0));
    assert_eq!(lx.next_token(), Addition(OpSum::Minus));
    assert_eq!(lx.next_token(), Number(2.0));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_multiplication() {
    let mut lx = new_lexer("1 * 2", false);
    assert_eq!(lx.next_token(), Number(1.0));
    assert_eq!(lx.next_token(), Product(OpProduct::Times));
    assert_eq!(lx.next_token(), Number(2.0));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_division() {
    let mut lx = new_lexer("4 / 2", false);
    assert_eq!(lx.next_token(), Number(4.0));
    assert_eq!(lx.next_token(), Product(OpProduct::Divide));
    assert_eq!(lx.next_token(), Number(2.0));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_bang() {
    let mut lx = new_lexer("!FALSE", false);
    assert_eq!(lx.next_token(), Bang);
    assert_eq!(lx.next_token(), Boolean(false));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_ampersand() {
    let mut lx = new_lexer("1 & 2", false);
    assert_eq!(lx.next_token(), Number(1.0));
    assert_eq!(lx.next_token(), And);
    assert_eq!(lx.next_token(), Number(2.0));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_comma() {
    // Used for testing locales where the comma is not a decimal separator
    let mut lx = new_lexer("12,34", false);
    assert_eq!(lx.next_token(), Number(12.0));
    assert_eq!(lx.next_token(), Comma);
    assert_eq!(lx.next_token(), Number(34.0));
    assert_eq!(lx.next_token(), EOF);

    // Used for testing locales where the comma is the decimal separator
    let mut lx = new_lexer("12,34", false);
    let locale = get_locale("de").unwrap();
    lx.locale = locale;

    assert_eq!(lx.next_token(), Number(12.34));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_semicolon() {
    let mut lx = new_lexer("FALSE;", false);
    assert_eq!(lx.next_token(), Boolean(false));
    assert_eq!(lx.next_token(), Semicolon);
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_comparisons() {
    let mut lx = new_lexer("1 < 2 > 3 <= 4 >= 5 = 6 <> 7", false);
    assert_eq!(lx.next_token(), Number(1.0));
    assert_eq!(lx.next_token(), Compare(OpCompare::LessThan));
    assert_eq!(lx.next_token(), Number(2.0));
    assert_eq!(lx.next_token(), Compare(OpCompare::GreaterThan));
    assert_eq!(lx.next_token(), Number(3.0));
    assert_eq!(lx.next_token(), Compare(OpCompare::LessOrEqualThan));
    assert_eq!(lx.next_token(), Number(4.0));
    assert_eq!(lx.next_token(), Compare(OpCompare::GreaterOrEqualThan));
    assert_eq!(lx.next_token(), Number(5.0));
    assert_eq!(lx.next_token(), Compare(OpCompare::Equal));
    assert_eq!(lx.next_token(), Number(6.0));
    assert_eq!(lx.next_token(), Compare(OpCompare::NonEqual));
    assert_eq!(lx.next_token(), Number(7.0));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_log10_is_cell_reference() {
    let mut lx = new_lexer("LOG10", true);
    assert_eq!(
        lx.next_token(),
        Reference {
            sheet: None,
            column: column_to_number("LOG").unwrap(),
            row: 10,
            absolute_column: false,
            absolute_row: false,
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_log10_is_function() {
    let mut lx = new_lexer("LOG10(100)", true);
    assert_eq!(lx.next_token(), Ident("LOG10".to_string()));
    assert_eq!(lx.next_token(), LeftParenthesis);
    assert_eq!(lx.next_token(), Number(100.0));
    assert_eq!(lx.next_token(), RightParenthesis);
    assert_eq!(lx.next_token(), EOF);
}
