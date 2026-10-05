use serde::{Deserialize, Serialize};

use crate::expressions::token;
use crate::language::{get_language, Language};
use crate::locale::{get_locale, Locale};

use super::{Lexer, LexerMode};

/// A MarkedToken is a token together with its position on a formula
#[derive(Debug, PartialEq, Serialize, Deserialize)]
pub struct MarkedToken {
    pub token: token::TokenType,
    pub start: i32,
    pub end: i32,
}

/// Returns a list of marked tokens for a formula
///
/// # Examples
/// ```
/// use ironcalc_base::expressions::{
///      lexer::util::{get_tokens, MarkedToken},
///      token::{OpSum, TokenType},
/// };
///
/// let marked_tokens = get_tokens("A1+1");
/// let first_t = MarkedToken {
///     token: TokenType::Reference {
///         sheet: None,
///         row: 1,
///         column: 1,
///         absolute_column: false,
///         absolute_row: false,
///     },
///     start: 0,
///     end: 2,
/// };
/// let second_t = MarkedToken {
///     token: TokenType::Addition(OpSum::Add),
///     start:2,
///     end: 3
/// };
/// let third_t = MarkedToken {
///     token: TokenType::Number(1.0),
///     start:3,
///     end: 4
/// };
/// assert_eq!(marked_tokens, vec![first_t, second_t, third_t]);
/// ```
pub fn get_tokens(formula: &str) -> Vec<MarkedToken> {
    get_tokens_with_locale(
        formula,
        #[allow(clippy::expect_used)]
        get_locale("en").expect(""),
        #[allow(clippy::expect_used)]
        get_language("en").expect(""),
    )
}

/// Returns a list of marked tokens for a formula using the given locale and language
pub fn get_tokens_with_locale(
    formula: &str,
    locale: &Locale,
    language: &Language,
) -> Vec<MarkedToken> {
    let mut tokens = Vec::new();
    let mut lexer = Lexer::new(formula, LexerMode::A1, locale, language);
    let mut start = lexer.get_position();
    let mut next_token = lexer.next_token();
    let mut end = lexer.get_position();
    loop {
        match next_token {
            token::TokenType::EOF => {
                break;
            }
            _ => {
                tokens.push(MarkedToken {
                    start,
                    end,
                    token: next_token,
                });
                start = lexer.get_position();
                next_token = lexer.next_token();
                end = lexer.get_position();
            }
        }
    }
    tokens
}

// Excel's F4 cycle for the absolute/relative state of a reference:
// A1 -> $A$1 -> A$1 -> $A1 -> A1
fn next_state(absolute_column: bool, absolute_row: bool) -> (bool, bool) {
    match (absolute_column, absolute_row) {
        (false, false) => (true, true),
        (true, true) => (false, true),
        (false, true) => (true, false),
        (true, false) => (false, false),
    }
}

// Cycles one endpoint of a range like "$C3" -> "C3".
// An endpoint is [$]column[$]row where either the column or the row
// (but not both) may be missing. Anything else is left untouched.
fn cycle_endpoint(part: &[char]) -> Vec<char> {
    let n = part.len();
    let mut i = 0;
    let mut absolute_column = false;
    if part.first() == Some(&'$') {
        absolute_column = true;
        i += 1;
    }
    let column_start = i;
    while i < n && part[i].is_ascii_alphabetic() {
        i += 1;
    }
    let column = &part[column_start..i];
    let mut absolute_row = false;
    if i < n && part[i] == '$' {
        absolute_row = true;
        i += 1;
    }
    let row_start = i;
    while i < n && part[i].is_ascii_digit() {
        i += 1;
    }
    let row = &part[row_start..i];
    if i != n || (column.is_empty() && row.is_empty()) {
        return part.to_vec();
    }
    let (new_column, new_row) = if column.is_empty() {
        // a row-only endpoint like "5" in "5:5"; a leading '$' belongs to the row
        (false, !(absolute_column || absolute_row))
    } else if row.is_empty() {
        // a column-only endpoint like "D" in "D:D"
        (!absolute_column, false)
    } else {
        next_state(absolute_column, absolute_row)
    };
    let mut result = Vec::with_capacity(n + 2);
    if new_column {
        result.push('$');
    }
    // cycling also normalizes the reference to uppercase, "a1" -> "$A$1"
    result.extend(column.iter().map(|c| c.to_ascii_uppercase()));
    if new_row {
        result.push('$');
    }
    result.extend_from_slice(row);
    result
}

// Cycles a whole reference or range token like "Sheet1!C3:D5" or "'My Sheet'!A1".
// The sheet prefix, if any, is left untouched.
fn cycle_token_text(text: &[char]) -> Vec<char> {
    let n = text.len();
    let mut result = Vec::with_capacity(n + 4);
    let mut i = 0;
    // the token span can include leading whitespace
    while i < n && text[i].is_whitespace() {
        result.push(text[i]);
        i += 1;
    }
    if i < n && text[i] == '\'' {
        // quoted sheet name; quotes inside are escaped by doubling them
        result.push('\'');
        i += 1;
        while i < n {
            let c = text[i];
            result.push(c);
            i += 1;
            if c == '\'' {
                if i < n && text[i] == '\'' {
                    result.push('\'');
                    i += 1;
                } else {
                    break;
                }
            }
        }
        if i < n && text[i] == '!' {
            result.push('!');
            i += 1;
        }
    } else if let Some(bang) = text.iter().skip(i).position(|&c| c == '!') {
        let prefix_end = i + bang + 1;
        result.extend_from_slice(&text[i..prefix_end]);
        i = prefix_end;
    }
    // endpoints separated by ':'
    loop {
        let part_start = i;
        while i < n && text[i] != ':' {
            i += 1;
        }
        result.extend(cycle_endpoint(&text[part_start..i]));
        if i < n {
            result.push(':');
            i += 1;
        } else {
            break;
        }
    }
    result
}

/// Cycles the absolute/relative state of the references touched by the cursor,
/// Excel F4 style: A1 -> $A$1 -> A$1 -> $A1 -> A1.
///
/// `start` and `end` are cursor positions in characters; a cursor grazing the
/// edge of a reference counts as touching it. Returns the new text together
/// with the new cursor positions:
/// * If nothing is cycled the text and cursor are returned unchanged.
/// * A collapsed cursor lands collapsed at the end of the cycled reference.
/// * A selection spans all the cycled references in the new text.
pub fn cycle_reference(
    value: &str,
    start: usize,
    end: usize,
    locale: &Locale,
    language: &Language,
) -> Result<(String, i32, i32), String> {
    let chars: Vec<char> = value.chars().collect();
    if start > chars.len() || end > chars.len() {
        return Err("Cursor index out of bounds".to_string());
    }
    let (selection_start, selection_end) = if start <= end {
        (start, end)
    } else {
        (end, start)
    };
    if chars.first() != Some(&'=') {
        return Ok((value.to_string(), start as i32, end as i32));
    }
    let body = &chars[1..];
    let body_str: String = body.iter().collect();

    let mut result: Vec<char> = vec!['='];
    // characters of the body already copied to the result
    let mut copied = 0;
    let mut first_cycled_start = None;
    let mut last_cycled_end = 0;
    for marked in get_tokens_with_locale(&body_str, locale, language) {
        if !matches!(
            marked.token,
            token::TokenType::Reference { .. } | token::TokenType::Range { .. }
        ) {
            continue;
        }
        // token positions are relative to the body: shift by the leading '='
        let token_start = marked.start.max(0) as usize + 1;
        let token_end = marked.end.max(0) as usize + 1;
        if token_start > selection_end || selection_start > token_end {
            continue;
        }
        result.extend_from_slice(&body[copied..token_start - 1]);
        let token_text = &body[token_start - 1..token_end - 1];
        if first_cycled_start.is_none() {
            let whitespace = token_text.iter().take_while(|c| c.is_whitespace()).count();
            first_cycled_start = Some(result.len() + whitespace);
        }
        result.extend(cycle_token_text(token_text));
        last_cycled_end = result.len();
        copied = token_end - 1;
    }
    let Some(first_start) = first_cycled_start else {
        // the cursor is not touching any reference
        return Ok((value.to_string(), start as i32, end as i32));
    };
    result.extend_from_slice(&body[copied..]);
    let new_value: String = result.iter().collect();
    if start == end {
        return Ok((new_value, last_cycled_end as i32, last_cycled_end as i32));
    }
    Ok((new_value, first_start as i32, last_cycled_end as i32))
}
