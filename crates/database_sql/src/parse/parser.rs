//! nom combinators over the token stream, one function per grammar rule.
//!
//! Errors: a parser that fails before consuming anything returns
//! `nom::Err::Error` so an `alt` can try the next branch; once a rule has
//! committed (seen its keyword), everything after is wrapped in [`cut`] so a
//! failure is final and carries the message written for that spot. The
//! message text is the product for the agent reading it, so every leaf
//! names what it expected.

mod condition;
mod schema;
mod select;
mod write;

use std::ops::Range;

use nom::branch::alt;
use nom::bytes::complete::take;
use nom::combinator::{cut, eof, map_opt, opt, peek};
use nom::multi::separated_list1;
use nom::sequence::{delimited, preceded, terminated};
use nom::{Finish, IResult, Input, Parser};

use super::ParseError;
use super::ast::{ColumnRef, Identifier, Literal, Statement, TableName};
use super::lexer::{Token, TokenKind};

/// The input: the statement's tokens and where the statement ends. A
/// newtype because nom implements [`Input`] only for bytes and `&str`.
#[derive(Debug, Clone, Copy)]
pub struct Tokens<'a> {
    tokens: &'a [Token],
    end: usize,
}

impl std::ops::Deref for Tokens<'_> {
    type Target = [Token];
    fn deref(&self) -> &Self::Target {
        self.tokens
    }
}

impl<'a> Input for Tokens<'a> {
    type Item = &'a Token;
    type Iter = std::slice::Iter<'a, Token>;
    type IterIndices = std::iter::Enumerate<std::slice::Iter<'a, Token>>;

    fn input_len(&self) -> usize {
        self.tokens.len()
    }
    fn take(&self, index: usize) -> Self {
        Tokens {
            tokens: &self.tokens[..index],
            end: self.end,
        }
    }
    fn take_from(&self, index: usize) -> Self {
        Tokens {
            tokens: &self.tokens[index..],
            end: self.end,
        }
    }
    fn take_split(&self, index: usize) -> (Self, Self) {
        let (head, tail) = self.tokens.split_at(index);
        (
            Tokens {
                tokens: tail,
                end: self.end,
            },
            Tokens {
                tokens: head,
                end: self.end,
            },
        )
    }
    fn position<Predicate: Fn(Self::Item) -> bool>(&self, predicate: Predicate) -> Option<usize> {
        self.tokens.iter().position(predicate)
    }
    fn iter_elements(&self) -> Self::Iter {
        self.tokens.iter()
    }
    fn iter_indices(&self) -> Self::IterIndices {
        self.tokens.iter().enumerate()
    }
    fn slice_index(&self, count: usize) -> Result<usize, nom::Needed> {
        if count <= self.tokens.len() {
            Ok(count)
        } else {
            Err(nom::Needed::new(count - self.tokens.len()))
        }
    }
}

type ParseResult<'a, Output> = IResult<Tokens<'a>, Output, ParseError>;

impl nom::error::ParseError<Tokens<'_>> for ParseError {
    fn from_error_kind(input: Tokens<'_>, _: nom::error::ErrorKind) -> Self {
        // Only reached through combinators we never leave a message on; the
        // leaves below always say what they expected.
        let found = match input.tokens.first() {
            Some(token) => token.kind.describe(),
            None => "end of statement".into(),
        };
        message_at(input, &format!("unexpected {found}"))
    }

    fn append(_: Tokens<'_>, _: nom::error::ErrorKind, other: Self) -> Self {
        other
    }
}

/// Parse one statement from its tokens; `end` is the length of the source.
pub fn statement(tokens: &[Token], end: usize) -> Result<Statement, ParseError> {
    statement_rule(Tokens { tokens, end })
        .finish()
        .map(|(_, statement)| statement)
}

fn statement_rule(input: Tokens<'_>) -> ParseResult<'_, Statement> {
    terminated(
        expecting(
            "SELECT, INSERT, UPDATE, DELETE or ALTER TABLE",
            alt((
                select::select.map(Statement::Select),
                write::insert.map(Statement::Insert),
                write::update.map(Statement::Update),
                write::delete.map(Statement::Delete),
                schema::alter.map(Statement::AlterColumnType),
            )),
        ),
        (
            opt(keyword(TokenKind::Semicolon)),
            cut(expecting("end of statement", eof)),
        ),
    )
    .parse(input)
}

/// The next token's span; the empty span at the end once none is left.
fn next_span(input: Tokens<'_>) -> Range<usize> {
    match input.tokens.first() {
        Some(token) => token.span.clone(),
        None => input.end..input.end,
    }
}

/// `expected …, found …` at the next token.
fn at(input: Tokens<'_>, expected: &str) -> ParseError {
    let found = match input.tokens.first() {
        Some(token) => token.kind.describe(),
        None => "end of statement".into(),
    };
    ParseError {
        span: next_span(input),
        message: format!("expected {expected}, found {found}"),
    }
}

/// A message that stands on its own (not `expected …, found …`) at the next
/// token.
fn message_at(input: Tokens<'_>, message: &str) -> ParseError {
    ParseError {
        span: next_span(input),
        message: message.into(),
    }
}

/// A final failure with `message` at the next token, for the forms the
/// grammar recognizes only to explain that they are not supported.
fn refusal<'a, Output>(input: Tokens<'a>, message: &str) -> ParseResult<'a, Output> {
    Err(nom::Err::Failure(message_at(input, message)))
}

/// Replace a recoverable failure's message with `expected`, keeping the
/// position. For an `alt` whose branches each know only their own keyword.
fn expecting<'a, Output>(
    expected: impl AsRef<str>,
    mut parser: impl Parser<Tokens<'a>, Output = Output, Error = ParseError>,
) -> impl FnMut(Tokens<'a>) -> ParseResult<'a, Output> {
    move |input| match parser.parse(input) {
        Err(nom::Err::Error(_)) => Err(nom::Err::Error(at(input, expected.as_ref()))),
        other => other,
    }
}

/// The next token as `read` takes it, or a recoverable failure that names
/// `expected` when `read` declines it.
fn next_token<'a, Output>(
    expected: impl AsRef<str>,
    read: impl Fn(&'a Token) -> Option<Output>,
) -> impl FnMut(Tokens<'a>) -> ParseResult<'a, Output> {
    expecting(
        expected,
        map_opt(take(1usize), move |taken: Tokens<'a>| {
            taken.tokens.first().and_then(&read)
        }),
    )
}

/// The token `kind`, or a recoverable failure that names `expected`.
fn token<'a>(
    kind: TokenKind,
    expected: &'static str,
) -> impl FnMut(Tokens<'a>) -> ParseResult<'a, ()> {
    next_token(expected, move |token| (token.kind == kind).then_some(()))
}

/// The token `kind`, and the span it came from.
fn token_span<'a>(
    kind: TokenKind,
    expected: &'static str,
) -> impl FnMut(Tokens<'a>) -> ParseResult<'a, Range<usize>> {
    next_token(expected, move |token| {
        (token.kind == kind).then(|| token.span.clone())
    })
}

/// The token `kind` as a branch discriminator; the message is never shown
/// because the enclosing `alt` supplies its own.
fn keyword<'a>(kind: TokenKind) -> impl FnMut(Tokens<'a>) -> ParseResult<'a, ()> {
    token(kind, "")
}

/// The unquoted word `name`, in any case: for the words of the grammar that
/// are not keywords, so columns can still be named so.
fn word<'a>(
    name: &'static str,
    expected: &'static str,
) -> impl FnMut(Tokens<'a>) -> ParseResult<'a, ()> {
    next_token(expected, move |token| {
        matches!(&token.kind, TokenKind::Identifier(word) if word.eq_ignore_ascii_case(name))
            .then_some(())
    })
}

fn identifier<'a>(
    expected: impl AsRef<str>,
) -> impl FnMut(Tokens<'a>) -> ParseResult<'a, Identifier> {
    next_token(expected, |token| match &token.kind {
        TokenKind::Identifier(name) | TokenKind::QuotedIdentifier(name) => {
            Some(Identifier(name.clone()))
        }
        _ => None,
    })
}

fn string<'a>(expected: &'static str) -> impl FnMut(Tokens<'a>) -> ParseResult<'a, String> {
    next_token(expected, |token| match &token.kind {
        TokenKind::StringLiteral(text) => Some(text.clone()),
        _ => None,
    })
}

/// A number token's value.
fn number<'a>(expected: &'static str) -> impl FnMut(Tokens<'a>) -> ParseResult<'a, f64> {
    next_token(expected, |token| match &token.kind {
        TokenKind::NumberLiteral(number) => Some(*number),
        _ => None,
    })
}

/// A whole number a `u32` holds, as a `LIMIT` or a position is written.
fn whole(number: f64) -> Option<u32> {
    (number.fract() == 0.0 && (0.0..=f64::from(u32::MAX)).contains(&number))
        .then_some(number as u32)
}

/// A non-negative whole number.
fn count<'a>(expected: &'static str) -> impl FnMut(Tokens<'a>) -> ParseResult<'a, u32> {
    next_token(expected, |token| match &token.kind {
        TokenKind::NumberLiteral(number) => whole(*number),
        _ => None,
    })
}

const SUBQUERIES: &str = "subqueries are not supported: run the inner SELECT on its own first and use the values it returns";

fn literal(input: Tokens<'_>) -> ParseResult<'_, Literal> {
    expecting(
        "a value: 'text', a number, TRUE, FALSE or NULL",
        alt((
            next_token("", |token| match &token.kind {
                TokenKind::StringLiteral(text) => Some(Literal::Text(text.clone())),
                TokenKind::NumberLiteral(number) => Some(Literal::Number(*number)),
                TokenKind::True => Some(Literal::Boolean(true)),
                TokenKind::False => Some(Literal::Boolean(false)),
                TokenKind::Null => Some(Literal::Null),
                _ => None,
            }),
            preceded(keyword(TokenKind::Minus), cut(number("a number after -")))
                .map(|number| Literal::Number(-number)),
            preceded(opt(keyword(TokenKind::LeftParen)), subquery),
        )),
    )
    .parse(input)
}

/// `SELECT` where a value belongs.
fn subquery(input: Tokens<'_>) -> ParseResult<'_, Literal> {
    let (_, ()) = peek(keyword(TokenKind::Select)).parse(input)?;
    refusal(input, SUBQUERIES)
}

/// A literal, or `[literal, …]` for a multi-valued cell.
fn value(input: Tokens<'_>) -> ParseResult<'_, Literal> {
    alt((
        delimited(
            keyword(TokenKind::LeftBracket),
            cut(separated_list1(comma, literal)),
            cut(token(TokenKind::RightBracket, ", or ] in the list")),
        )
        .map(Literal::List),
        literal,
    ))
    .parse(input)
}

/// `column` or `alias.column`.
fn column_ref<'a>(expected: &'static str) -> impl FnMut(Tokens<'a>) -> ParseResult<'a, ColumnRef> {
    let mut parser = (
        identifier(expected),
        opt(preceded(
            keyword(TokenKind::Dot),
            cut(identifier("a column name after the .")),
        )),
    )
        .map(|(first, second)| match second {
            Some(column) => ColumnRef {
                table: Some(first),
                column,
            },
            None => ColumnRef {
                table: None,
                column: first,
            },
        });
    move |input| parser.parse(input)
}

/// `[database.]table`.
fn table<'a>(expected: &'static str) -> impl FnMut(Tokens<'a>) -> ParseResult<'a, TableName> {
    let mut parser = (
        identifier(expected),
        opt(preceded(
            keyword(TokenKind::Dot),
            cut(identifier("a table name after the .")),
        )),
    )
        .map(|(first, second)| match second {
            Some(table) => TableName {
                database: Some(first),
                table,
            },
            None => TableName {
                database: None,
                table: first,
            },
        });
    move |input| parser.parse(input)
}

fn comma(input: Tokens<'_>) -> ParseResult<'_, ()> {
    keyword(TokenKind::Comma)(input)
}
