//! Schema grammar; shares identifiers, literals and column types with row SQL.
use super::*;
use crate::parse::schema::{ColumnDefinition, SchemaChange, SchemaColumnKind, SchemaStatement};
use nom::branch::alt;
use nom::combinator::{cut, eof, opt};
use nom::multi::separated_list1;
use nom::sequence::{delimited, preceded, terminated};
use nom::{Finish, Parser};

pub(crate) fn parse(tokens: &[Token], end: usize) -> Result<Option<SchemaStatement>, ParseError> {
    let input = Tokens { tokens, end };
    let is_ddl = tokens.first().is_some_and(|token| matches!(&token.kind, TokenKind::Identifier(word) if ["create", "alter", "drop"].iter().any(|key| word.eq_ignore_ascii_case(key))));
    if !is_ddl {
        return Ok(None);
    }
    // Keep ordinary ALTER COLUMN TYPE on the shared row engine, preserving its cast outcome.
    if super::schema::alter(input).is_ok() {
        return Ok(None);
    }
    terminated(
        alt((create, alter, drop_table)),
        (
            opt(keyword(TokenKind::Semicolon)),
            cut(expecting("end of statement", eof)),
        ),
    )
    .parse(input)
    .finish()
    .map(|(_, statement)| Some(statement))
}

fn names(input: Tokens<'_>) -> ParseResult<'_, Vec<Identifier>> {
    delimited(
        token(TokenKind::LeftParen, "("),
        separated_list1(comma, identifier("a name")),
        cut(token(TokenKind::RightParen, ")")),
    )
    .parse(input)
}
fn labels(input: Tokens<'_>) -> ParseResult<'_, Vec<String>> {
    delimited(
        token(TokenKind::LeftParen, "("),
        separated_list1(
            comma,
            next_token("an option label in single quotes", |token| {
                match &token.kind {
                    TokenKind::StringLiteral(label) => Some(label.clone()),
                    _ => None,
                }
            }),
        ),
        cut(token(TokenKind::RightParen, ")")),
    )
    .parse(input)
}
fn kind(input: Tokens<'_>) -> ParseResult<'_, SchemaColumnKind> {
    alt((
        preceded(
            word("relation", ""),
            cut(delimited(
                token(TokenKind::LeftParen, "("),
                table("a relation target table"),
                token(TokenKind::RightParen, ")"),
            )),
        )
        .map(SchemaColumnKind::Relation),
        super::schema::column_type.map(SchemaColumnKind::Value),
    ))
    .parse(input)
}
fn column(input: Tokens<'_>) -> ParseResult<'_, ColumnDefinition> {
    let (input, name) = identifier("a column name")(input)?;
    let (input, kind) = cut(kind).parse(input)?;
    let (input, options) = opt(preceded(word("options", ""), cut(labels))).parse(input)?;
    Ok((
        input,
        ColumnDefinition {
            name,
            kind,
            options: options.unwrap_or_default(),
        },
    ))
}
fn create(input: Tokens<'_>) -> ParseResult<'_, SchemaStatement> {
    let (input, ()) = word("create", "CREATE")(input)?;
    cut(alt((create_database, create_table))).parse(input)
}
fn create_database(input: Tokens<'_>) -> ParseResult<'_, SchemaStatement> {
    let (input, ()) = word("database", "DATABASE")(input)?;
    let (input, name) = identifier("a database name")(input)?;
    let (input, template) = opt(preceded(
        word("template", ""),
        cut(identifier("a template slug")),
    ))
    .parse(input)?;
    Ok((input, SchemaStatement::CreateDatabase { name, template }))
}
fn create_table(input: Tokens<'_>) -> ParseResult<'_, SchemaStatement> {
    let (input, ()) = word("table", "TABLE")(input)?;
    let (input, table) = table("a table name; qualify with its database")(input)?;
    let (input, columns) = delimited(
        token(TokenKind::LeftParen, "( and column definitions"),
        separated_list1(comma, column),
        cut(token(TokenKind::RightParen, ")")),
    )
    .parse(input)?;
    Ok((input, SchemaStatement::CreateTable { table, columns }))
}
fn drop_table(input: Tokens<'_>) -> ParseResult<'_, SchemaStatement> {
    let (input, ()) = word("drop", "DROP")(input)?;
    cut(preceded(word("table", "TABLE"), table("a table name")))
        .map(SchemaStatement::DropTable)
        .parse(input)
}
fn alter(input: Tokens<'_>) -> ParseResult<'_, SchemaStatement> {
    let (input, ()) = word("alter", "ALTER")(input)?;
    cut(alt((alter_database, alter_table))).parse(input)
}
fn alter_database(input: Tokens<'_>) -> ParseResult<'_, SchemaStatement> {
    let (input, ()) = word("database", "DATABASE")(input)?;
    let (input, database) = identifier("a database name")(input)?;
    alt((
        preceded(
            (word("rename", "RENAME"), word("to", "TO")),
            identifier("a new name"),
        )
        .map(|name| SchemaStatement::RenameDatabase {
            database: database.clone(),
            name,
        }),
        preceded(
            (word("reorder", "REORDER"), word("tables", "TABLES")),
            names,
        )
        .map(|tables| SchemaStatement::ReorderTables {
            database: database.clone(),
            tables,
        }),
    ))
    .parse(input)
}
fn alter_table(input: Tokens<'_>) -> ParseResult<'_, SchemaStatement> {
    let (input, ()) = word("table", "TABLE")(input)?;
    let (input, table) = table("a table name")(input)?;
    let (input, change) = cut(alt((
        rename,
        preceded((word("add", ""), opt(word("column", ""))), column).map(SchemaChange::AddColumn),
        preceded(
            (word("drop", ""), opt(word("column", ""))),
            identifier("a column name"),
        )
        .map(SchemaChange::DropColumn),
        preceded((word("reorder", ""), word("columns", "COLUMNS")), names)
            .map(SchemaChange::ReorderColumns),
        alter_column,
    )))
    .parse(input)?;
    Ok((input, SchemaStatement::AlterTable { table, change }))
}
fn rename(input: Tokens<'_>) -> ParseResult<'_, SchemaChange> {
    let (input, ()) = word("rename", "RENAME")(input)?;
    alt((
        preceded(word("to", "TO"), identifier("a new table name")).map(SchemaChange::Rename),
        |input| {
            let (input, ()) = word("column", "COLUMN")(input)?;
            let (input, column) = identifier("a column name")(input)?;
            let (input, ()) = word("to", "TO")(input)?;
            let (input, name) = identifier("a new column name")(input)?;
            Ok((input, SchemaChange::RenameColumn { column, name }))
        },
    ))
    .parse(input)
}
fn alter_column(input: Tokens<'_>) -> ParseResult<'_, SchemaChange> {
    let (input, ()) = word("alter", "ALTER")(input)?;
    let (input, _) = opt(word("column", "")).parse(input)?;
    let (input, column) = identifier("a column name")(input)?;
    alt((
        preceded((word("add", "ADD"), word("options", "OPTIONS")), labels).map(|labels| {
            SchemaChange::AddOptions {
                column: column.clone(),
                labels,
            }
        }),
        preceded(word("type", "TYPE"), kind).map(|kind| SchemaChange::ChangeType {
            column: column.clone(),
            kind,
        }),
    ))
    .parse(input)
}
