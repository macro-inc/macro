//! A tokenizer for spreadsheet formulas.
//!
//! This is meant to feed a formula parser.
//!
//! You will need to instantiate it with a language and a locale.
//!
//! It supports two working modes:
//!
//! 1. A1 or display mode
//!    This is for user formulas. References are like `D4`, `D$4` or `F5:T10`
//! 2. R1C1, internal or runtime mode
//!    A reference like R1C1 refers to $A$1 and R3C4 to $D$4
//!    `R[2]C[5]` refers to a cell two rows below and five columns to the right
//!    It uses the 'en' locale and language.
//!    This is used internally at runtime.
//!
//! Formulas look different in different locales:
//!
//! =IF(A1, B1, NA()) versus =IF(A1; B1; NA())
//!
//! Also numbers are different:
//!
//! 1,123.45 versus 1.123,45
//!
//! The names of the errors and functions are different in different languages,
//! but they stay the same in different locales.
//!
//! Note that in IronCalc if you are using a locale different from 'en' or a language different from 'en'
//! you will still need the 'en' locale and language because formulas are stored in that language and locale
//!
//! # Examples:
//! ```
//! use ironcalc_base::expressions::lexer::{Lexer, LexerMode};
//! use ironcalc_base::expressions::token::{TokenType, OpCompare};
//! use ironcalc_base::locale::get_locale;
//! use ironcalc_base::language::get_language;
//!
//! let locale = get_locale("en").unwrap();
//! let language = get_language("en").unwrap();
//! let mut lexer = Lexer::new("=A1*SUM(Sheet2!C3:D5)", LexerMode::A1, &locale, &language);
//! assert_eq!(lexer.next_token(), TokenType::Compare(OpCompare::Equal));
//! assert!(matches!(lexer.next_token(), TokenType::Reference { .. }));
//! ```

use std::mem;

use serde::{Deserialize, Serialize};

use crate::expressions::token::{OpCompare, OpProduct, OpSum};
use crate::number_format::parse_finite_number;

use crate::language::Language;
use crate::locale::Locale;

use super::token::{Error, TokenType};
use super::types::*;
use super::utils;

pub mod util;

#[cfg(test)]
mod test;

mod ranges;
mod structured_references;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LexerError {
    pub position: usize,
    pub message: String,
}

pub(super) type Result<T> = std::result::Result<T, LexerError>;

/// Decides whether `name` should be accepted as an identifier in R1C1 mode, once
/// the reference-parsing paths have already failed.
///
/// This uses the A1 identifier rules (`is_valid_a1_identifier`) rather than
/// `is_valid_identifier`, so the single-character names "R"/"C" are accepted: they
/// are valid LAMBDA parameters and LET variables. This matters on reload, because
/// formulas are stored internally in R1C1 format, so a formula like
/// `=BYROW(A1:C1, LAMBDA(c, MAX(c)))` is re-parsed in R1C1 mode and must not reject
/// the `c` parameter.
///
/// The one exception is a bare "R"/"C" immediately followed by '[': that is a
/// malformed R1C1 reference (e.g. `R[`), not an identifier, so it is rejected.
/// Genuine R1C1 references (`R[n]C[n]`, `RnCn`) are consumed before this fallback.
fn is_valid_r1c1_identifier(name: &str, next_char: Option<char>) -> bool {
    if !utils::is_valid_a1_identifier(name) {
        return false;
    }
    // `is_valid_identifier` differs from `is_valid_a1_identifier` only for "R"/"C".
    // For those, only reject when they start a (malformed) reference, i.e. `R[`.
    utils::is_valid_identifier(name) || next_char != Some('[')
}

#[derive(Clone, PartialEq, Eq)]
pub enum LexerMode {
    A1,
    R1C1,
}

/// Tokenize an input
#[derive(Clone)]
pub struct Lexer<'a> {
    position: usize,
    next_token_position: Option<usize>,
    len: usize,
    chars: Vec<char>,
    mode: LexerMode,
    locale: &'a Locale,
    language: &'a Language,
}

impl<'a> Lexer<'a> {
    /// Creates a new `Lexer` that returns the tokens of a formula.
    pub fn new(
        formula: &str,
        mode: LexerMode,
        locale: &'a Locale,
        language: &'a Language,
    ) -> Lexer<'a> {
        let chars: Vec<char> = formula.chars().collect();
        let len = chars.len();
        Lexer {
            chars,
            position: 0,
            next_token_position: None,
            len,
            mode,
            locale,
            language,
        }
    }

    /// Changes the lexer mode
    pub fn set_lexer_mode(&mut self, mode: LexerMode) {
        self.mode = mode;
    }

    /// Sets the locale
    pub fn set_locale(&mut self, locale: &'a Locale) {
        self.locale = locale;
    }

    /// Sets the language
    pub fn set_language(&mut self, language: &'a Language) {
        self.language = language;
    }

    // FIXME: I don't think we should have `is_a1_mode` and   `get_formula`.
    // The caller already knows those two

    /// Returns true if mode is A1
    pub fn is_a1_mode(&self) -> bool {
        self.mode == LexerMode::A1
    }

    /// Returns the formula
    pub fn get_formula(&self) -> String {
        self.chars.iter().collect()
    }

    // FIXME: This is used to get the "marked tokens"
    // I think a better API would be to return the marked tokens
    /// Returns the position of the lexer
    pub fn get_position(&self) -> i32 {
        self.position as i32
    }

    /// Resets the formula
    pub fn set_formula(&mut self, content: &str) {
        self.chars = content.chars().collect();
        self.len = self.chars.len();
        self.position = 0;
        self.next_token_position = None;
    }

    /// Returns an error if the token is not the expected one.
    pub fn expect(&mut self, tk: TokenType) -> Result<()> {
        let nt = self.next_token();
        if mem::discriminant(&nt) != mem::discriminant(&tk) {
            return Err(self.set_error(&format!("Error, expected {tk:?}"), self.position));
        }
        Ok(())
    }

    /// Checks the next token without advancing position
    /// See also [advance_token](Self::advance_token)
    pub fn peek_token(&mut self) -> TokenType {
        let position = self.position;
        let tk = self.next_token();
        self.next_token_position = Some(self.position);
        self.position = position;
        tk
    }

    /// Advances position. This is used in conjunction with [`peek_token`](Self::peek_token)
    /// It is a noop if the has not been a previous peek_token
    pub fn advance_token(&mut self) {
        if let Some(position) = self.next_token_position {
            self.position = position;
            self.next_token_position = None;
        }
    }

    /// Returns the next token
    pub fn next_token(&mut self) -> TokenType {
        self.next_token_position = None;
        self.consume_whitespace();

        match self.read_next_char() {
            Some(char) => {
                match char {
                    '+' => TokenType::Addition(OpSum::Add),
                    '-' => TokenType::Addition(OpSum::Minus),
                    '*' => TokenType::Product(OpProduct::Times),
                    '/' => TokenType::Product(OpProduct::Divide),
                    '(' => TokenType::LeftParenthesis,
                    ')' => TokenType::RightParenthesis,
                    '=' => TokenType::Compare(OpCompare::Equal),
                    '{' => TokenType::LeftBrace,
                    '}' => TokenType::RightBrace,
                    '[' => TokenType::LeftBracket,
                    ']' => TokenType::RightBracket,
                    ':' => TokenType::Colon,
                    ';' => TokenType::Semicolon,
                    '@' => TokenType::At,
                    '\\' => TokenType::Backslash,
                    ',' => {
                        if self.locale.numbers.symbols.decimal == "," {
                            match self.consume_number(',') {
                                Ok(number) => TokenType::Number(number),
                                Err(error) => TokenType::Illegal(error),
                            }
                        } else {
                            TokenType::Comma
                        }
                    }
                    '.' => {
                        if self.locale.numbers.symbols.decimal == "." {
                            match self.consume_number('.') {
                                Ok(number) => TokenType::Number(number),
                                Err(error) => TokenType::Illegal(error),
                            }
                        } else {
                            // There is no TokenType::PERIOD
                            TokenType::Illegal(self.set_error("Expecting a number", self.position))
                        }
                    }
                    '!' => TokenType::Bang,
                    '^' => TokenType::Power,
                    '%' => TokenType::Percent,
                    '&' => TokenType::And,
                    '$' => self.consume_absolute_reference(),
                    '<' => {
                        let next_token = self.peek_char();
                        if next_token == Some('=') {
                            self.position += 1;
                            TokenType::Compare(OpCompare::LessOrEqualThan)
                        } else if next_token == Some('>') {
                            self.position += 1;
                            TokenType::Compare(OpCompare::NonEqual)
                        } else {
                            TokenType::Compare(OpCompare::LessThan)
                        }
                    }
                    '>' => {
                        if self.peek_char() == Some('=') {
                            self.position += 1;
                            TokenType::Compare(OpCompare::GreaterOrEqualThan)
                        } else {
                            TokenType::Compare(OpCompare::GreaterThan)
                        }
                    }
                    '#' => self.consume_error(),
                    '"' => match self.consume_string() {
                        Ok(s) => TokenType::String(s),
                        Err(error) => TokenType::Illegal(error),
                    },
                    '\'' => self.consume_quoted_sheet_reference(),
                    '0'..='9' => {
                        let position = self.position - 1;
                        match self.consume_number(char) {
                            Ok(number) => {
                                if self.peek_token() == TokenType::Colon
                                    && self.mode == LexerMode::A1
                                {
                                    // Its a row range  3:5
                                    // FIXME: There are faster ways of parsing this
                                    // Like checking that 'number' is integer and that the next token is integer
                                    self.position = position;
                                    match self.consume_range_a1() {
                                        Ok(ParsedRange { left, right }) => {
                                            if let Some(right) = right {
                                                TokenType::Range {
                                                    sheet: None,
                                                    left,
                                                    right,
                                                }
                                            } else {
                                                TokenType::Illegal(
                                                    self.set_error("Expecting row range", position),
                                                )
                                            }
                                        }
                                        Err(error) => {
                                            // Examples:
                                            //   * 'Sheet 1'!3.4:5
                                            //   * 'Sheet 1'!3:A2
                                            //   * 'Sheet 1'!3:
                                            TokenType::Illegal(error)
                                        }
                                    }
                                } else {
                                    TokenType::Number(number)
                                }
                            }
                            Err(error) => {
                                // tried to read a number but failed
                                self.position = self.len;
                                TokenType::Illegal(error)
                            }
                        }
                    }
                    _ => {
                        if char.is_alphabetic() || char == '_' {
                            // At this point is one of the following:
                            //   1. A range with sheet: Sheet3!A3:D7
                            //   2. A boolean: TRUE or FALSE (dependent on the language)
                            //   3. A reference like WS34 or R3C5
                            //   4. A range without sheet ER4:ER7
                            //   5. A column range E:E
                            //   6. An identifier like a function name or a defined name
                            //   7. A range operator A1:OFFSET(...)
                            //   8. An Invalid token
                            let position = self.position;
                            self.position -= 1;
                            let name = self.consume_identifier();
                            let position_indent = self.position;

                            let peek_char = self.peek_char();
                            let next_char_is_colon = self.peek_char() == Some(':');

                            if peek_char == Some('!') {
                                // reference
                                self.position += 1;
                                return self.consume_range(Some(name));
                            } else if peek_char == Some('$') {
                                self.position = position - 1;
                                return self.consume_range(None);
                            }
                            let name_upper = name.to_uppercase();
                            if name_upper == self.language.booleans.r#true {
                                return TokenType::Boolean(true);
                            } else if name_upper == self.language.booleans.r#false {
                                return TokenType::Boolean(false);
                            }
                            if self.peek_char() == Some('(') {
                                return TokenType::Ident(name);
                            }
                            if self.mode == LexerMode::A1 {
                                let parsed_reference = utils::parse_reference_a1(&name_upper);
                                if parsed_reference.is_some()
                                    || (utils::is_valid_column(name_upper.trim_start_matches('$'))
                                        && next_char_is_colon)
                                {
                                    self.position = position - 1;
                                    match self.consume_range_a1() {
                                        Ok(ParsedRange { left, right }) => {
                                            if let Some(right) = right {
                                                return TokenType::Range {
                                                    sheet: None,
                                                    left,
                                                    right,
                                                };
                                            } else {
                                                return TokenType::Reference {
                                                    sheet: None,
                                                    column: left.column,
                                                    row: left.row,
                                                    absolute_row: left.absolute_row,
                                                    absolute_column: left.absolute_column,
                                                };
                                            }
                                        }
                                        Err(error) => {
                                            // This could be the range operator: ":"
                                            if let Some(r) = parsed_reference {
                                                if next_char_is_colon {
                                                    self.position = position_indent;
                                                    return TokenType::Reference {
                                                        sheet: None,
                                                        row: r.row,
                                                        column: r.column,
                                                        absolute_column: r.absolute_column,
                                                        absolute_row: r.absolute_row,
                                                    };
                                                }
                                            }
                                            self.position = self.len;
                                            return TokenType::Illegal(error);
                                        }
                                    }
                                } else if utils::is_valid_a1_identifier(&name) {
                                    if peek_char == Some('[') {
                                        if let Ok(r) = self.consume_structured_reference(&name) {
                                            return r;
                                        }
                                        return TokenType::Illegal(self.set_error(
                                            "Invalid structured reference",
                                            self.position,
                                        ));
                                    }
                                    return TokenType::Ident(name);
                                } else {
                                    return TokenType::Illegal(
                                        self.set_error("Invalid identifier (A1)", self.position),
                                    );
                                }
                            } else {
                                let pos = self.position;
                                self.position = position - 1;
                                match self.consume_range_r1c1() {
                                    // it's a valid R1C1 range
                                    // We need to check it's not something like R1C1P
                                    Ok(ParsedRange { left, right }) => {
                                        if pos > self.position {
                                            self.position = pos;
                                            if is_valid_r1c1_identifier(&name, self.peek_char()) {
                                                return TokenType::Ident(name);
                                            } else {
                                                self.position = self.len;
                                                return TokenType::Illegal(
                                                    self.set_error(
                                                        "Invalid identifier (R1C1)",
                                                        pos,
                                                    ),
                                                );
                                            }
                                        }
                                        if let Some(right) = right {
                                            return TokenType::Range {
                                                sheet: None,
                                                left,
                                                right,
                                            };
                                        } else {
                                            return TokenType::Reference {
                                                sheet: None,
                                                column: left.column,
                                                row: left.row,
                                                absolute_row: left.absolute_row,
                                                absolute_column: left.absolute_column,
                                            };
                                        }
                                    }
                                    Err(error) => {
                                        self.position = position - 1;
                                        if let Ok(r) = self.consume_reference_r1c1() {
                                            if self.peek_char() == Some(':') {
                                                return TokenType::Reference {
                                                    sheet: None,
                                                    row: r.row,
                                                    column: r.column,
                                                    absolute_column: r.absolute_column,
                                                    absolute_row: r.absolute_row,
                                                };
                                            }
                                        }
                                        self.position = pos;

                                        if is_valid_r1c1_identifier(&name, self.peek_char()) {
                                            return TokenType::Ident(name);
                                        } else {
                                            return TokenType::Illegal(self.set_error(
                                                &format!("Invalid identifier (R1C1): {name}"),
                                                error.position,
                                            ));
                                        }
                                    }
                                }
                            }
                        }
                        TokenType::Illegal(self.set_error("Unknown error", self.position))
                    }
                }
            }
            None => TokenType::EOF,
        }
    }

    // Private methods

    fn set_error(&mut self, message: &str, position: usize) -> LexerError {
        self.position = self.len;
        LexerError {
            position,
            message: message.to_string(),
        }
    }

    fn peek_char(&mut self) -> Option<char> {
        let position = self.position;
        if position < self.len {
            Some(self.chars[position])
        } else {
            None
        }
    }

    fn expect_char(&mut self, ch_expected: char) -> Result<()> {
        let position = self.position;
        if position >= self.len {
            return Err(self.set_error(
                &format!("Error, expected {} found EOF", ch_expected),
                self.position,
            ));
        } else {
            let ch = self.chars[position];
            if ch_expected != ch {
                return Err(self.set_error(
                    &format!("Error, expected {} found {}", ch_expected, ch),
                    self.position,
                ));
            }
            self.position += 1;
        }
        Ok(())
    }

    fn read_next_char(&mut self) -> Option<char> {
        let position = self.position;
        if position < self.len {
            self.position = position + 1;
            Some(self.chars[position])
        } else {
            None
        }
    }

    // Consumes an integer from the input stream
    fn consume_integer(&mut self, first: char) -> Result<i32> {
        let mut position = self.position;
        let len = self.len;
        let mut chars = first.to_string();
        while position < len {
            let next_char = self.chars[position];
            if next_char.is_ascii_digit() {
                chars.push(next_char);
            } else {
                break;
            }
            position += 1;
        }
        self.position = position;
        chars.parse::<i32>().map_err(|_| LexerError {
            position,
            message: format!("Failed to parse to int: {chars}"),
        })
    }

    // Consumes a number in the current locale.
    // It only takes into account the decimal separator
    // Note that we do not parse the thousands separator
    // Let's say ',' is the thousands separator. Then 1,234 would be an error.
    // This is ok for most cases:
    // =IF(A1=1,234, TRUE, FALSE) will not work
    // If a user introduces a single number in the cell 1,234 we should be able to parse
    // and format the cell appropriately
    fn consume_number(&mut self, first: char) -> Result<f64> {
        let mut position = self.position;
        let len = self.len;
        let mut chars = first.to_string();
        // numbers before the decimal point
        while position < len {
            let x = self.chars[position];
            if x.is_ascii_digit() {
                chars.push(x);
            } else {
                break;
            }
            position += 1;
        }
        if position < len && self.chars[position].to_string() == self.locale.numbers.symbols.decimal
        {
            // numbers after the decimal point
            chars.push('.');
            position += 1;
            while position < len {
                let x = self.chars[position];
                if x.is_ascii_digit() {
                    chars.push(x);
                } else {
                    break;
                }
                position += 1;
            }
        }
        if position + 1 < len && (self.chars[position] == 'e' || self.chars[position] == 'E') {
            // exponential side
            let x = self.chars[position + 1];
            if x == '-' || x == '+' || x.is_ascii_digit() {
                chars.push('e');
                chars.push(x);
                position += 2;
                while position < len {
                    let x = self.chars[position];
                    if x.is_ascii_digit() {
                        chars.push(x);
                    } else {
                        break;
                    }
                    position += 1;
                }
            }
        }
        self.position = position;
        // A number too large to hold, like 1e400, is not a number: it would
        // be infinity, which cannot be written back as a formula.
        match parse_finite_number(&chars) {
            None => Err(self.set_error(&format!("Failed to parse to double: {chars}"), position)),
            Some(v) => Ok(v),
        }
    }

    // Consumes an identifier from the input stream
    fn consume_identifier(&mut self) -> String {
        let mut position = self.position;
        while position < self.len {
            let next_char = self.chars[position];
            if next_char.is_alphanumeric() || next_char == '_' || next_char == '.' {
                position += 1;
            } else {
                break;
            }
        }
        let chars = self.chars[self.position..position].iter().collect();
        self.position = position;
        chars
    }

    fn consume_string(&mut self) -> Result<String> {
        let mut position = self.position;
        let len = self.len;
        let mut chars = "".to_string();
        let mut terminated = false;
        while position < len {
            let x = self.chars[position];
            position += 1;
            if x != '"' {
                chars.push(x);
            } else if position < len && self.chars[position] == '"' {
                chars.push(x);
                chars.push(self.chars[position]);
                position += 1;
            } else {
                terminated = true;
                break;
            }
        }
        self.position = position;

        if !terminated {
            return Err(self.set_error("Expected closing '\"' but found end of input", position));
        }
        Ok(chars)
    }

    // Consumes a quoted string from input
    // 'This is a quoted string'
    // ' Also is a ''quoted'' string'
    // Returns an error if it does not find a closing quote
    fn consume_single_quote_string(&mut self) -> Result<String> {
        let mut position = self.position;
        let len = self.len;
        let mut success = false;
        let mut needs_escape = false;
        while position < len {
            let next_char = self.chars[position];
            position += 1;
            if next_char == '\'' {
                if position == len {
                    success = true;
                    break;
                }
                if self.chars[position] != '\'' {
                    success = true;
                    break;
                } else {
                    // In Excel we escape "'" with "''"
                    needs_escape = true;
                    position += 1;
                }
            }
        }
        if !success {
            // We reached the end without the closing quote
            return Err(self.set_error("Expected closing \"'\" but found end of input", position));
        }
        let chars: String = self.chars[self.position..position - 1].iter().collect();
        self.position = position;
        if needs_escape {
            // In most cases we will not needs escaping so this would be an overkill
            return Ok(chars.replace("''", "'"));
        }

        Ok(chars)
    }

    // Reads an error from the input stream
    fn consume_error(&mut self) -> TokenType {
        let errors = &self.language.errors;
        let rest_of_formula: String = self.chars[self.position - 1..self.len].iter().collect();
        if rest_of_formula.starts_with(&errors.r#ref) {
            self.position += errors.r#ref.chars().count() - 1;
            return TokenType::Error(Error::REF);
        } else if rest_of_formula.starts_with(&errors.name) {
            self.position += errors.name.chars().count() - 1;
            return TokenType::Error(Error::NAME);
        } else if rest_of_formula.starts_with(&errors.value) {
            self.position += errors.value.chars().count() - 1;
            return TokenType::Error(Error::VALUE);
        } else if rest_of_formula.starts_with(&errors.div) {
            self.position += errors.div.chars().count() - 1;
            return TokenType::Error(Error::DIV);
        } else if rest_of_formula.starts_with(&errors.na) {
            self.position += errors.na.chars().count() - 1;
            return TokenType::Error(Error::NA);
        } else if rest_of_formula.starts_with(&errors.num) {
            self.position += errors.num.chars().count() - 1;
            return TokenType::Error(Error::NUM);
        } else if rest_of_formula.starts_with(&errors.error) {
            self.position += errors.error.chars().count() - 1;
            return TokenType::Error(Error::ERROR);
        } else if rest_of_formula.starts_with(&errors.nimpl) {
            self.position += errors.nimpl.chars().count() - 1;
            return TokenType::Error(Error::NIMPL);
        } else if rest_of_formula.starts_with(&errors.spill) {
            self.position += errors.spill.chars().count() - 1;
            return TokenType::Error(Error::SPILL);
        } else if rest_of_formula.starts_with(&errors.calc) {
            self.position += errors.calc.chars().count() - 1;
            return TokenType::Error(Error::CALC);
        } else if rest_of_formula.starts_with(&errors.null) {
            self.position += errors.null.chars().count() - 1;
            return TokenType::Error(Error::NULL);
        } else if rest_of_formula.starts_with(&errors.circ) {
            self.position += errors.circ.chars().count() - 1;
            return TokenType::Error(Error::CIRC);
        }
        // If it is not an error it _might_ be a spill operator.
        TokenType::Spill
    }

    fn consume_whitespace(&mut self) {
        let mut position = self.position;
        let len = self.len;
        while position < len {
            let x = self.chars[position];
            if !x.is_whitespace() {
                break;
            }
            position += 1;
        }
        self.position = position;
    }

    fn consume_absolute_reference(&mut self) -> TokenType {
        // This is an absolute reference.
        // $A$4
        if self.mode == LexerMode::R1C1 {
            return TokenType::Illegal(
                self.set_error("Cannot parse A1 reference in R1C1 mode", self.position),
            );
        }
        self.position -= 1;
        self.consume_range(None)
    }

    fn consume_quoted_sheet_reference(&mut self) -> TokenType {
        // This is a reference:
        // 'First Sheet'!A34
        let sheet_name = match self.consume_single_quote_string() {
            Ok(v) => v,
            Err(error) => {
                return TokenType::Illegal(error);
            }
        };
        if self.next_token() != TokenType::Bang {
            return TokenType::Illegal(self.set_error("Expected '!'", self.position));
        }
        self.consume_range(Some(sheet_name))
    }

    fn consume_range(&mut self, sheet: Option<String>) -> TokenType {
        let m = if self.mode == LexerMode::A1 {
            self.consume_range_a1()
        } else {
            self.consume_range_r1c1()
        };
        match m {
            Ok(ParsedRange { left, right }) => {
                if let Some(right) = right {
                    TokenType::Range { sheet, left, right }
                } else {
                    TokenType::Reference {
                        sheet,
                        column: left.column,
                        row: left.row,
                        absolute_row: left.absolute_row,
                        absolute_column: left.absolute_column,
                    }
                }
            }
            Err(error) => TokenType::Illegal(error),
        }
    }
}
