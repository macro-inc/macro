//! `INSERT`, `UPDATE` and `DELETE`.

use nom::Parser;
use nom::branch::alt;
use nom::combinator::cut;
use nom::multi::separated_list1;
use nom::sequence::{delimited, preceded};

use super::super::ParseError;
use super::super::ast::{Condition, Delete, Identifier, Insert, Literal, SetValue, Update};
use super::super::lexer::TokenKind;
use super::condition::condition;
use super::{
    ParseResult, Tokens, comma, expecting, identifier, keyword, table, token, token_span, value,
};

pub(super) fn insert(input: Tokens<'_>) -> ParseResult<'_, Insert> {
    let (input, _) = keyword(TokenKind::Insert)(input)?;
    let (input, _) = cut(token(TokenKind::Into, "INTO after INSERT")).parse(input)?;
    let (input, table) = cut(table("a table name after INTO, like database.table")).parse(input)?;
    if let Ok((input, ())) = keyword(TokenKind::Default)(input) {
        let (input, ()) = cut(token(TokenKind::Values, "VALUES after DEFAULT")).parse(input)?;
        return Ok((
            input,
            Insert {
                table,
                columns: Vec::new(),
                rows: vec![Vec::new()],
            },
        ));
    }
    let (input, columns) = cut(delimited(
        token(
            TokenKind::LeftParen,
            "( and the column list, or DEFAULT VALUES, after the table name",
        ),
        separated_list1(comma, identifier("a column name in the column list")),
        token(TokenKind::RightParen, ", or ) in the column list"),
    ))
    .parse(input)?;
    let (input, _) = cut(token(TokenKind::Values, "VALUES after the column list")).parse(input)?;
    let mut number = 0;
    let (input, rows) = separated_list1(
        comma,
        cut(|input| {
            number += 1;
            row(input, columns.len(), number)
        }),
    )
    .parse(input)?;
    Ok((
        input,
        Insert {
            table,
            columns,
            rows,
        },
    ))
}

/// One `(v, …)` row, which must be as wide as the column list.
fn row(input: Tokens<'_>, width: usize, number: usize) -> ParseResult<'_, Vec<Literal>> {
    let (rest, (open, values, close)) = (
        token_span(TokenKind::LeftParen, "( to start a row of values"),
        cut(separated_list1(comma, value)),
        cut(token_span(
            TokenKind::RightParen,
            ", or ) in the row of values",
        )),
    )
        .parse(input)?;
    if values.len() != width {
        return Err(nom::Err::Failure(ParseError {
            span: open.start..close.end,
            message: format!(
                "row {number} has {} values but {width} columns were listed",
                values.len()
            ),
        }));
    }
    Ok((rest, values))
}

pub(super) fn update(input: Tokens<'_>) -> ParseResult<'_, Update> {
    let (input, _) = keyword(TokenKind::Update)(input)?;
    let (input, table) =
        cut(table("a table name after UPDATE, like database.table")).parse(input)?;
    let (input, _) = cut(token(TokenKind::Set, "SET after the table name")).parse(input)?;
    let (input, assignments) = cut(separated_list1(comma, assignment)).parse(input)?;
    let (input, where_) = where_clause("UPDATE").parse(input)?;
    Ok((
        input,
        Update {
            table,
            assignments,
            where_,
        },
    ))
}

fn assignment(input: Tokens<'_>) -> ParseResult<'_, (Identifier, SetValue)> {
    let (input, column) = identifier("a column name to set")(input)?;
    let (input, ()) = cut(expecting(
        format!("= after \"{}\"", column.0),
        keyword(TokenKind::Equal),
    ))
    .parse(input)?;
    let (input, value) = cut(expecting(
        "a value ('text', a number, TRUE, FALSE, NULL or a [list]) or a column name",
        alt((
            value.map(SetValue::Literal),
            identifier("").map(SetValue::Column),
        )),
    ))
    .parse(input)?;
    Ok((input, (column, value)))
}

pub(super) fn delete(input: Tokens<'_>) -> ParseResult<'_, Delete> {
    let (input, _) = keyword(TokenKind::Delete)(input)?;
    let (input, _) = cut(token(TokenKind::From, "FROM after DELETE")).parse(input)?;
    let (input, table) = cut(table("a table name after FROM, like database.table")).parse(input)?;
    let (input, where_) = where_clause("DELETE").parse(input)?;
    Ok((input, Delete { table, where_ }))
}

/// The `WHERE` a write must have, so no statement changes a whole table by
/// leaving it out.
fn where_clause<'a>(
    statement: &str,
) -> impl Parser<Tokens<'a>, Output = Condition, Error = ParseError> {
    preceded(
        cut(expecting(
            format!(
                "WHERE and the rows to change ({statement} needs one; WHERE row_id = '<id>' names a single row)"
            ),
            keyword(TokenKind::Where),
        )),
        cut(condition),
    )
}
