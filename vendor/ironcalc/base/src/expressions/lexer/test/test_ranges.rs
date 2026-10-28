#![allow(clippy::unwrap_used)]

use crate::constants::{LAST_COLUMN, LAST_ROW};
use crate::expressions::lexer::LexerError;
use crate::expressions::{
    lexer::{Lexer, LexerMode},
    token::TokenType::*,
    types::ParsedReference,
};
use crate::language::get_language;
use crate::locale::get_locale;

fn new_lexer(formula: &str) -> Lexer<'_> {
    let locale = get_locale("en").unwrap();
    let language = get_language("en").unwrap();
    Lexer::new(formula, LexerMode::A1, locale, language)
}

#[test]
fn test_range() {
    let mut lx = new_lexer("C4:D4");
    assert_eq!(
        lx.next_token(),
        Range {
            sheet: None,
            left: ParsedReference {
                column: 3,
                row: 4,
                absolute_column: false,
                absolute_row: false,
            },
            right: ParsedReference {
                column: 4,
                row: 4,
                absolute_column: false,
                absolute_row: false,
            }
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_range_absolute_column() {
    let mut lx = new_lexer("$A1:B$4");
    assert_eq!(
        lx.next_token(),
        Range {
            sheet: None,
            left: ParsedReference {
                column: 1,
                row: 1,
                absolute_column: true,
                absolute_row: false,
            },
            right: ParsedReference {
                column: 2,
                row: 4,
                absolute_column: false,
                absolute_row: true,
            }
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_range_with_sheet() {
    let mut lx = new_lexer("Sheet1!A1:B4");
    assert_eq!(
        lx.next_token(),
        Range {
            sheet: Some("Sheet1".to_string()),
            left: ParsedReference {
                column: 1,
                row: 1,
                absolute_column: false,
                absolute_row: false,
            },
            right: ParsedReference {
                column: 2,
                row: 4,
                absolute_column: false,
                absolute_row: false,
            }
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_range_with_sheet_with_space() {
    let mut lx = new_lexer("'New sheet'!$A$1:B44");
    assert_eq!(
        lx.next_token(),
        Range {
            sheet: Some("New sheet".to_string()),
            left: ParsedReference {
                column: 1,
                row: 1,
                absolute_column: true,
                absolute_row: true,
            },
            right: ParsedReference {
                column: 2,
                row: 44,
                absolute_column: false,
                absolute_row: false,
            }
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_range_error() {
    let mut lx = new_lexer("'Sheet 1'!3.4:5");
    assert_eq!(
        lx.next_token(),
        Illegal(LexerError {
            position: 10,
            message: "Expecting reference in range".to_string(),
        })
    );
    assert_eq!(lx.next_token(), EOF);

    let mut lx = new_lexer("'Sheet 1'!3:A2");
    assert_eq!(
        lx.next_token(),
        Illegal(LexerError {
            position: 14,
            message: "Error parsing Range".to_string()
        })
    );
    assert_eq!(lx.next_token(), EOF);

    let mut lx = new_lexer("'Sheet 1'!3:");
    assert_eq!(
        lx.next_token(),
        Illegal(LexerError {
            position: 12,
            message: "Error parsing Range".to_string()
        })
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_range_column() {
    let mut lx = new_lexer("C:D");
    assert_eq!(
        lx.next_token(),
        Range {
            sheet: None,
            left: ParsedReference {
                column: 3,
                row: 1,
                absolute_column: false,
                absolute_row: true,
            },
            right: ParsedReference {
                column: 4,
                row: LAST_ROW,
                absolute_column: false,
                absolute_row: true,
            }
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_range_column_out_of_range() {
    let mut lx = new_lexer("C:XFE");
    assert_eq!(
        lx.next_token(),
        Illegal(LexerError {
            position: 5,
            message: "Column is not valid.".to_string(),
        })
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_range_column_absolute1() {
    let mut lx = new_lexer("$C:D");
    assert_eq!(
        lx.next_token(),
        Range {
            sheet: None,
            left: ParsedReference {
                column: 3,
                row: 1,
                absolute_column: true,
                absolute_row: true,
            },
            right: ParsedReference {
                column: 4,
                row: LAST_ROW,
                absolute_column: false,
                absolute_row: true,
            }
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_range_column_absolute2() {
    let mut lx = new_lexer("$C:$AA");
    assert_eq!(
        lx.next_token(),
        Range {
            sheet: None,
            left: ParsedReference {
                column: 3,
                row: 1,
                absolute_column: true,
                absolute_row: true,
            },
            right: ParsedReference {
                column: 27,
                row: LAST_ROW,
                absolute_column: true,
                absolute_row: true,
            }
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_range_rows() {
    let mut lx = new_lexer("3:5");
    assert_eq!(
        lx.next_token(),
        Range {
            sheet: None,
            left: ParsedReference {
                column: 1,
                row: 3,
                absolute_column: true,
                absolute_row: false,
            },
            right: ParsedReference {
                column: LAST_COLUMN,
                row: 5,
                absolute_column: true,
                absolute_row: false,
            }
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_range_rows_absolute1() {
    let mut lx = new_lexer("$3:5");
    assert_eq!(
        lx.next_token(),
        Range {
            sheet: None,
            left: ParsedReference {
                column: 1,
                row: 3,
                absolute_column: true,
                absolute_row: true,
            },
            right: ParsedReference {
                column: LAST_COLUMN,
                row: 5,
                absolute_column: true,
                absolute_row: false,
            }
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_range_rows_absolute2() {
    let mut lx = new_lexer("$3:$55");
    assert_eq!(
        lx.next_token(),
        Range {
            sheet: None,
            left: ParsedReference {
                column: 1,
                row: 3,
                absolute_column: true,
                absolute_row: true,
            },
            right: ParsedReference {
                column: LAST_COLUMN,
                row: 55,
                absolute_column: true,
                absolute_row: true,
            }
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_range_column_sheet() {
    let mut lx = new_lexer("Sheet1!C:D");
    assert_eq!(
        lx.next_token(),
        Range {
            sheet: Some("Sheet1".to_string()),
            left: ParsedReference {
                column: 3,
                row: 1,
                absolute_column: false,
                absolute_row: true,
            },
            right: ParsedReference {
                column: 4,
                row: LAST_ROW,
                absolute_column: false,
                absolute_row: true,
            }
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_range_column_sheet_absolute() {
    let mut lx = new_lexer("Sheet1!$C:$D");
    assert_eq!(
        lx.next_token(),
        Range {
            sheet: Some("Sheet1".to_string()),
            left: ParsedReference {
                column: 3,
                row: 1,
                absolute_column: true,
                absolute_row: true,
            },
            right: ParsedReference {
                column: 4,
                row: LAST_ROW,
                absolute_column: true,
                absolute_row: true,
            }
        }
    );
    assert_eq!(lx.next_token(), EOF);

    let mut lx = new_lexer("'Woops ans'!$C:$D");
    assert_eq!(
        lx.next_token(),
        Range {
            sheet: Some("Woops ans".to_string()),
            left: ParsedReference {
                column: 3,
                row: 1,
                absolute_column: true,
                absolute_row: true,
            },
            right: ParsedReference {
                column: 4,
                row: LAST_ROW,
                absolute_column: true,
                absolute_row: true,
            }
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_range_rows_sheet() {
    let mut lx = new_lexer("'A new sheet'!3:5");
    assert_eq!(
        lx.next_token(),
        Range {
            sheet: Some("A new sheet".to_string()),
            left: ParsedReference {
                column: 1,
                row: 3,
                absolute_column: true,
                absolute_row: false,
            },
            right: ParsedReference {
                column: LAST_COLUMN,
                row: 5,
                absolute_column: true,
                absolute_row: false,
            }
        }
    );
    assert_eq!(lx.next_token(), EOF);
    let mut lx = new_lexer("Sheet12!3:5");
    assert_eq!(
        lx.next_token(),
        Range {
            sheet: Some("Sheet12".to_string()),
            left: ParsedReference {
                column: 1,
                row: 3,
                absolute_column: true,
                absolute_row: false,
            },
            right: ParsedReference {
                column: LAST_COLUMN,
                row: 5,
                absolute_column: true,
                absolute_row: false,
            }
        }
    );
    assert_eq!(lx.next_token(), EOF);
}
// Non ranges

#[test]
fn test_non_range_variable_name() {
    let mut lx = new_lexer("AB");
    assert_eq!(lx.next_token(), Ident("AB".to_string()));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_non_range_invalid_variable_name() {
    let mut lx = new_lexer("$AB");
    assert!(matches!(lx.next_token(), Illegal(_)));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_non_range_invalid_variable_name_a03() {
    let mut lx = new_lexer("A03");
    assert_eq!(
        lx.next_token(),
        Reference {
            sheet: None,
            row: 3,
            column: 1,
            absolute_column: false,
            absolute_row: false
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_non_range_invalid_variable_name_sheet1_a03() {
    let mut lx = new_lexer("Sheet1!A03");
    assert_eq!(
        lx.next_token(),
        Reference {
            sheet: Some("Sheet1".to_string()),
            row: 3,
            column: 1,
            absolute_column: false,
            absolute_row: false
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_range_rows_with_0() {
    let mut lx = new_lexer("03:05");
    assert_eq!(
        lx.next_token(),
        Range {
            sheet: None,
            left: ParsedReference {
                column: 1,
                row: 3,
                absolute_column: true,
                absolute_row: false,
            },
            right: ParsedReference {
                column: LAST_COLUMN,
                row: 5,
                absolute_column: true,
                absolute_row: false,
            }
        }
    );
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_range_incomplete_row() {
    let mut lx = new_lexer("R[");
    lx.set_lexer_mode(LexerMode::R1C1);
    assert!(matches!(lx.next_token(), Illegal(_)));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn test_range_incomplete_column() {
    let mut lx = new_lexer("R[3][");
    lx.set_lexer_mode(LexerMode::R1C1);
    assert!(matches!(lx.next_token(), Illegal(_)));
    assert_eq!(lx.next_token(), EOF);
}

#[test]
fn range_operator() {
    let mut lx = new_lexer("A1:OFFSET(B1,1,2)");
    lx.set_lexer_mode(LexerMode::A1);
    assert!(matches!(lx.next_token(), Reference { .. }));
    assert!(matches!(lx.next_token(), Colon));
    assert!(matches!(lx.next_token(), Ident(_)));
    assert!(matches!(lx.next_token(), LeftParenthesis));
    assert!(matches!(lx.next_token(), Reference { .. }));
    assert_eq!(lx.next_token(), Comma);
    assert!(matches!(lx.next_token(), Number(_)));
    assert_eq!(lx.next_token(), Comma);
    assert!(matches!(lx.next_token(), Number(_)));
    assert!(matches!(lx.next_token(), RightParenthesis));
    assert_eq!(lx.next_token(), EOF);
}
