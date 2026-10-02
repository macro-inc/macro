//! `ALTER TABLE … ALTER COLUMN … TYPE …` and the column types it names.

use nom::Parser;
use nom::branch::alt;
use nom::combinator::{cut, not, opt};
use nom::sequence::{preceded, terminated};
use strum::IntoEnumIterator;

use models_databases::cast::ColumnTypeName;
use models_databases::{ColumnKind as OpColumnKind, EntityKind as OpEntityKind};

use super::super::ast::AlterColumnType;
use super::super::lexer::TokenKind;
use super::{ParseResult, Tokens, identifier, keyword, message_at, next_token, table, token, word};
use crate::catalog::EntityKind;

const COLUMN_TYPES: &str = "text, number, boolean, date, link, select, select_number, tag or \
                            entity(<KIND>) such as entity(USER); add [] after select, \
                            select_number or entity(…) for several values";

pub(super) fn alter(input: Tokens<'_>) -> ParseResult<'_, AlterColumnType> {
    let (input, ()) = word("alter", "ALTER")(input)?;
    let (input, ()) = cut(word("table", "TABLE after ALTER")).parse(input)?;
    let (input, table) =
        cut(table("a table name after ALTER TABLE, like database.table")).parse(input)?;
    let (input, ()) = cut(word(
        "alter",
        "ALTER COLUMN after the table name (ALTER TABLE only changes a column's type)",
    ))
    .parse(input)?;
    // A column itself named `column` is the one followed by `TYPE`.
    let (input, column) = cut(preceded(
        opt(terminated(word("column", ""), not(word("type", "")))),
        identifier("the column to change after ALTER COLUMN"),
    ))
    .parse(input)?;
    let (input, ()) = cut(word("type", "TYPE and the new type after the column")).parse(input)?;
    let (input, to) = column_type(input)?;
    Ok((input, AlterColumnType { table, column, to }))
}

/// `name` or `entity(KIND)`, either with `[]` for several values.
fn column_type(input: Tokens<'_>) -> ParseResult<'_, OpColumnKind> {
    alt((preceded(word("entity", ""), cut(entity_type)), plain_type)).parse(input)
}

/// `[]` after a type: whether a cell holds several values.
fn several(input: Tokens<'_>) -> ParseResult<'_, bool> {
    opt(preceded(
        keyword(TokenKind::LeftBracket),
        cut(token(TokenKind::RightBracket, "] after [")),
    ))
    .map(|brackets| brackets.is_some())
    .parse(input)
}

fn plain_type(input: Tokens<'_>) -> ParseResult<'_, OpColumnKind> {
    let (rest, name) = cut(next_token(
        format!("a column type: {COLUMN_TYPES}"),
        |token| match &token.kind {
            TokenKind::Identifier(name) => Some(name.as_str()),
            TokenKind::Select => Some("select"),
            _ => None,
        },
    ))
    .parse(input)?;
    let unknown = || {
        nom::Err::Failure(message_at(
            input,
            &format!("unknown column type \"{name}\"; the types are {COLUMN_TYPES}"),
        ))
    };
    let type_name: ColumnTypeName = name.parse().map_err(|_| unknown())?;
    let (end, multi) = several(rest)?;
    let single = |to: OpColumnKind| {
        if multi {
            let name: &'static str = type_name.into();
            Err(nom::Err::Failure(message_at(
                rest,
                &format!("{name} holds one value; [] is for select, select_number and entity(…)"),
            )))
        } else {
            Ok(to)
        }
    };
    let to = match type_name {
        ColumnTypeName::Text => single(OpColumnKind::Text)?,
        ColumnTypeName::Number => single(OpColumnKind::Number)?,
        ColumnTypeName::Boolean => single(OpColumnKind::Boolean)?,
        ColumnTypeName::Date => single(OpColumnKind::Date)?,
        ColumnTypeName::Link => single(OpColumnKind::Link)?,
        ColumnTypeName::Select => OpColumnKind::Select { multi },
        ColumnTypeName::SelectNumber => OpColumnKind::SelectNumber { multi },
        ColumnTypeName::Tag if multi => {
            return Err(nom::Err::Failure(message_at(
                rest,
                "tag always holds several values; write tag",
            )));
        }
        ColumnTypeName::Tag => OpColumnKind::Tag,
        // `entity` is only a type with its kind, and a relation is made
        // with the ChangeColumnType tool, not by name.
        ColumnTypeName::Entity | ColumnTypeName::Relation => return Err(unknown()),
    };
    Ok((end, to))
}

/// `(KIND)` after `entity`, and the `[]` that may follow.
fn entity_type(input: Tokens<'_>) -> ParseResult<'_, OpColumnKind> {
    let (input, ()) = cut(token(
        TokenKind::LeftParen,
        "( and an entity kind after entity, like entity(USER)",
    ))
    .parse(input)?;
    let (rest, written) = cut(next_token(
        "an entity kind such as USER",
        |token| match &token.kind {
            TokenKind::Identifier(written) => Some(written.as_str()),
            _ => None,
        },
    ))
    .parse(input)?;
    let target = match written.parse::<EntityKind>() {
        Ok(kind) => OpEntityKind::try_from(kind).map_err(|_| {
            nom::Err::Failure(message_at(
                input,
                "a relation to another table's rows is made with the ChangeColumnType tool's \
                 linkToTableId, not ALTER COLUMN",
            ))
        })?,
        Err(_) => {
            let kinds: Vec<&str> = EntityKind::iter()
                .filter(|kind| *kind != EntityKind::Row)
                .map(EntityKind::sql_name)
                .collect();
            return Err(nom::Err::Failure(message_at(
                input,
                &format!(
                    "unknown entity kind \"{written}\"; the kinds are {}",
                    kinds.join(", ")
                ),
            )));
        }
    };
    let (rest, ()) = cut(token(TokenKind::RightParen, ") after the entity kind")).parse(rest)?;
    let (rest, multi) = several(rest)?;
    Ok((rest, OpColumnKind::Entity { target, multi }))
}
