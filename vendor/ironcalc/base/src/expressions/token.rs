use std::fmt;

use bitcode::{Decode, Encode};
use serde::{Deserialize, Serialize};

use crate::language::Language;

use super::{lexer::LexerError, types::ParsedReference};

#[derive(Debug, PartialEq, Eq, Clone, Serialize, Deserialize)]
pub enum OpCompare {
    LessThan,
    GreaterThan,
    Equal,
    LessOrEqualThan,
    GreaterOrEqualThan,
    NonEqual,
}

impl fmt::Display for OpCompare {
    fn fmt(&self, fmt: &mut fmt::Formatter) -> fmt::Result {
        match self {
            OpCompare::LessThan => write!(fmt, "<"),
            OpCompare::GreaterThan => write!(fmt, ">"),
            OpCompare::Equal => write!(fmt, "="),
            OpCompare::LessOrEqualThan => write!(fmt, "<="),
            OpCompare::GreaterOrEqualThan => write!(fmt, ">="),
            OpCompare::NonEqual => write!(fmt, "<>"),
        }
    }
}

#[derive(Debug, PartialEq, Eq, Clone)]
pub enum OpUnary {
    Minus,
    Percentage,
}

impl fmt::Display for OpUnary {
    fn fmt(&self, fmt: &mut fmt::Formatter) -> fmt::Result {
        match self {
            OpUnary::Minus => write!(fmt, "-"),
            OpUnary::Percentage => write!(fmt, "%"),
        }
    }
}

#[derive(Debug, PartialEq, Eq, Clone, Serialize, Deserialize)]
pub enum OpSum {
    Add,
    Minus,
}

impl fmt::Display for OpSum {
    fn fmt(&self, fmt: &mut fmt::Formatter) -> fmt::Result {
        match self {
            OpSum::Add => write!(fmt, "+"),
            OpSum::Minus => write!(fmt, "-"),
        }
    }
}

#[derive(Debug, PartialEq, Eq, Clone, Serialize, Deserialize)]
pub enum OpProduct {
    Times,
    Divide,
}

impl fmt::Display for OpProduct {
    fn fmt(&self, fmt: &mut fmt::Formatter) -> fmt::Result {
        match self {
            OpProduct::Times => write!(fmt, "*"),
            OpProduct::Divide => write!(fmt, "/"),
        }
    }
}

/// List of `errors`
/// Note that "#ERROR!" and "#N/IMPL!" are not part of the xlsx standard
///  * "#ERROR!" means there was an error processing the formula (for instance "=A1+")
///  * "#N/IMPL!" means the formula or feature in Excel but has not been implemented in IronCalc
///    Note that they are serialized/deserialized by index
#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Eq, Clone)]
pub enum Error {
    REF,
    NAME,
    VALUE,
    DIV,
    NA,
    NUM,
    ERROR,
    NIMPL,
    SPILL,
    CALC,
    CIRC,
    NULL,
}

impl fmt::Display for Error {
    fn fmt(&self, fmt: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Error::NULL => write!(fmt, "#NULL!"),
            Error::REF => write!(fmt, "#REF!"),
            Error::NAME => write!(fmt, "#NAME?"),
            Error::VALUE => write!(fmt, "#VALUE!"),
            Error::DIV => write!(fmt, "#DIV/0!"),
            Error::NA => write!(fmt, "#N/A"),
            Error::NUM => write!(fmt, "#NUM!"),
            Error::ERROR => write!(fmt, "#ERROR!"),
            Error::NIMPL => write!(fmt, "#N/IMPL"),
            Error::SPILL => write!(fmt, "#SPILL!"),
            Error::CALC => write!(fmt, "#CALC!"),
            Error::CIRC => write!(fmt, "#CIRC!"),
        }
    }
}
impl Error {
    pub fn to_localized_error_string(&self, language: &Language) -> String {
        match self {
            Error::NULL => language.errors.null.to_string(),
            Error::REF => language.errors.r#ref.to_string(),
            Error::NAME => language.errors.name.to_string(),
            Error::VALUE => language.errors.value.to_string(),
            Error::DIV => language.errors.div.to_string(),
            Error::NA => language.errors.na.to_string(),
            Error::NUM => language.errors.num.to_string(),
            Error::ERROR => language.errors.error.to_string(),
            Error::NIMPL => language.errors.nimpl.to_string(),
            Error::SPILL => language.errors.spill.to_string(),
            Error::CALC => language.errors.calc.to_string(),
            Error::CIRC => language.errors.circ.to_string(),
        }
    }
}

pub fn get_error_by_name(name: &str, language: &Language) -> Option<Error> {
    let errors = &language.errors;
    if name == errors.r#ref {
        return Some(Error::REF);
    } else if name == errors.name {
        return Some(Error::NAME);
    } else if name == errors.value {
        return Some(Error::VALUE);
    } else if name == errors.div {
        return Some(Error::DIV);
    } else if name == errors.na {
        return Some(Error::NA);
    } else if name == errors.num {
        return Some(Error::NUM);
    } else if name == errors.error {
        return Some(Error::ERROR);
    } else if name == errors.nimpl {
        return Some(Error::NIMPL);
    } else if name == errors.spill {
        return Some(Error::SPILL);
    } else if name == errors.calc {
        return Some(Error::CALC);
    } else if name == errors.circ {
        return Some(Error::CIRC);
    } else if name == errors.null {
        return Some(Error::NULL);
    }
    None
}

pub fn get_error_by_english_name(name: &str) -> Option<Error> {
    if name == "#REF!" {
        return Some(Error::REF);
    } else if name == "#NAME?" {
        return Some(Error::NAME);
    } else if name == "#VALUE!" {
        return Some(Error::VALUE);
    } else if name == "#DIV/0!" {
        return Some(Error::DIV);
    } else if name == "#N/A" {
        return Some(Error::NA);
    } else if name == "#NUM!" {
        return Some(Error::NUM);
    } else if name == "#ERROR!" {
        return Some(Error::ERROR);
    } else if name == "#N/IMPL!" {
        return Some(Error::NIMPL);
    } else if name == "#SPILL!" {
        return Some(Error::SPILL);
    } else if name == "#CALC!" {
        return Some(Error::CALC);
    } else if name == "#CIRC!" {
        return Some(Error::CIRC);
    } else if name == "#NULL!" {
        return Some(Error::NULL);
    }
    None
}

pub fn is_english_error_string(name: &str) -> bool {
    let names = [
        "#REF!", "#NAME?", "#VALUE!", "#DIV/0!", "#N/A", "#NUM!", "#ERROR!", "#N/IMPL!", "#SPILL!",
        "#CALC!", "#CIRC!", "#NULL!",
    ];
    names.contains(&name)
}

#[derive(Debug, PartialEq, Clone, Serialize, Deserialize)]
pub enum TableSpecifier {
    All,
    Data,
    Headers,
    ThisRow,
    Totals,
}

#[derive(Debug, PartialEq, Clone, Serialize, Deserialize)]
pub enum TableReference {
    ColumnReference(String),
    RangeReference((String, String)),
}

#[derive(Debug, PartialEq, Clone, Serialize, Deserialize)]
pub enum TokenType {
    Illegal(LexerError),
    EOF,
    Ident(String),      // abc123
    String(String),     // "A season"
    Number(f64),        // 123.4
    Boolean(bool),      // TRUE | FALSE
    Error(Error),       // #VALUE!
    Compare(OpCompare), // <,>, ...
    Addition(OpSum),    // +,-
    Product(OpProduct), // *,/
    Power,              // ^
    LeftParenthesis,    // (
    RightParenthesis,   // )
    Colon,              // :
    Semicolon,          // ;
    LeftBracket,        // [
    RightBracket,       // ]
    LeftBrace,          // {
    RightBrace,         // }
    Comma,              // ,
    Bang,               // !
    Percent,            // %
    And,                // &
    At,                 // @
    Spill,              // #
    Backslash,          // \
    Reference {
        sheet: Option<String>,
        row: i32,
        column: i32,
        absolute_column: bool,
        absolute_row: bool,
    },
    Range {
        sheet: Option<String>,
        left: ParsedReference,
        right: ParsedReference,
    },
    StructuredReference {
        table_name: String,
        specifier: Option<TableSpecifier>,
        table_reference: Option<TableReference>,
    },
}
