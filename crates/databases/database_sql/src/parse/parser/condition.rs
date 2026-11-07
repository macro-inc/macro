//! `WHERE` conditions: `OR` over `AND` over parenthesized conditions and
//! single tests of one column.

use nom::Parser;
use nom::branch::alt;
use nom::combinator::{cut, opt};
use nom::multi::separated_list1;
use nom::sequence::{delimited, preceded};

use super::super::ast::{ColumnRef, ComparisonOperator, Condition};
use super::super::lexer::TokenKind;
use super::{
    ParseResult, Tokens, column_ref, comma, expecting, keyword, literal, message_at, next_token,
    string, token, word,
};

pub(super) fn condition(input: Tokens<'_>) -> ParseResult<'_, Condition> {
    separated_list1(keyword(TokenKind::Or), and_chain)
        .map(|parts| flatten(parts, Condition::Or))
        .parse(input)
}

fn and_chain(input: Tokens<'_>) -> ParseResult<'_, Condition> {
    separated_list1(keyword(TokenKind::And), term)
        .map(|parts| flatten(parts, Condition::And))
        .parse(input)
}

fn term(input: Tokens<'_>) -> ParseResult<'_, Condition> {
    alt((
        delimited(
            keyword(TokenKind::LeftParen),
            cut(condition),
            cut(token(TokenKind::RightParen, ") to close the condition")),
        ),
        test,
    ))
    .parse(input)
}

/// One test of one column.
fn test(input: Tokens<'_>) -> ParseResult<'_, Condition> {
    let (input, column) = column_ref("a column name to compare")(input)?;
    let (input, negated) = opt(keyword(TokenKind::Not))
        .map(|not| not.is_some())
        .parse(input)?;
    if negated {
        let expected = format!("IN, HAS or LIKE after \"{}\" NOT", column.column.0);
        return cut(expecting(expected, negatable(&column, true))).parse(input);
    }
    let expected = format!(
        "a comparison operator, IN, HAS, IS or LIKE after \"{}\"",
        column.column.0
    );
    cut(expecting(
        expected,
        alt((
            negatable(&column, false),
            is_null(&column),
            comparison(&column),
        )),
    ))
    .parse(input)
}

/// The forms that take `NOT`: `[NOT] IN`, `[NOT] HAS`, `[NOT] LIKE`.
fn negatable<'a>(
    column: &ColumnRef,
    negated: bool,
) -> impl Parser<Tokens<'a>, Output = Condition, Error = crate::parse::ParseError> {
    let (in_column, has_column, like_column) = (column.clone(), column.clone(), column.clone());
    alt((
        preceded(
            keyword(TokenKind::In),
            cut(delimited(
                token(TokenKind::LeftParen, "( after IN"),
                separated_list1(comma, literal),
                token(TokenKind::RightParen, ", or ) in the IN list"),
            )),
        )
        .map(move |values| Condition::In {
            column: in_column.clone(),
            values,
            negated,
        }),
        preceded(keyword(TokenKind::Has), cut(literal)).map(move |value| Condition::Has {
            column: has_column.clone(),
            value,
            negated,
        }),
        preceded(keyword(TokenKind::Like), cut(like_pattern)).map(move |(pattern, escape)| {
            Condition::Like {
                column: like_column.clone(),
                pattern,
                escape,
                negated,
            }
        }),
    ))
}

fn is_null<'a>(
    column: &ColumnRef,
) -> impl Parser<Tokens<'a>, Output = Condition, Error = crate::parse::ParseError> {
    let column = column.clone();
    preceded(
        keyword(TokenKind::Is),
        cut((
            opt(keyword(TokenKind::Not)),
            token(TokenKind::Null, "NULL after IS"),
        )),
    )
    .map(move |(not, ())| Condition::IsNull {
        column: column.clone(),
        negated: not.is_some(),
    })
}

fn comparison<'a>(
    column: &ColumnRef,
) -> impl Parser<Tokens<'a>, Output = Condition, Error = crate::parse::ParseError> {
    let column = column.clone();
    (comparison_operator, cut(literal)).map(move |(operator, value)| Condition::Comparison {
        column: column.clone(),
        operator,
        value,
    })
}

/// `'pattern' [ESCAPE 'c']`. `ESCAPE` is read as a word rather than a
/// keyword so a column named `escape` stays usable unquoted.
fn like_pattern(input: Tokens<'_>) -> ParseResult<'_, (String, Option<char>)> {
    let (rest, pattern) = string("a quoted pattern after LIKE")(input)?;
    let Ok((after, ())) = word("escape", "")(rest) else {
        return Ok((rest, (pattern, None)));
    };
    let (end, escape) = cut(string("a quoted escape character after ESCAPE")).parse(after)?;
    let mut characters = escape.chars();
    let (Some(escape), None) = (characters.next(), characters.next()) else {
        return Err(nom::Err::Failure(message_at(
            after,
            "the ESCAPE character must be exactly one character",
        )));
    };
    if ends_with_escape(&pattern, escape) {
        return Err(nom::Err::Failure(message_at(
            input,
            "a LIKE pattern cannot end with its ESCAPE character",
        )));
    }
    Ok((end, (pattern, Some(escape))))
}

/// Whether the last character is an escape with nothing left to escape.
fn ends_with_escape(pattern: &str, escape: char) -> bool {
    let mut escaping = false;
    for character in pattern.chars() {
        escaping = !escaping && character == escape;
    }
    escaping
}

/// The operator a comparison token spells.
fn comparison_operator(input: Tokens<'_>) -> ParseResult<'_, ComparisonOperator> {
    next_token("a comparison operator", |token| {
        <&'static str>::from(&token.kind).parse().ok()
    })(input)
}

/// One element stays itself; several become the combining node.
fn flatten(mut parts: Vec<Condition>, combine: fn(Vec<Condition>) -> Condition) -> Condition {
    if parts.len() == 1 {
        parts.remove(0)
    } else {
        combine(parts)
    }
}
