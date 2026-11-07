//! nom combinators over the formula's tokens, one function per grammar rule.
//! A rule that declines its first token fails recoverably, so `alt` can try
//! the next; once a rule has committed (read an operator or a `(`), what
//! follows is `cut`, and its failure is final.

use nom::branch::alt;
use nom::combinator::{cut, opt};
use nom::multi::many0;
use nom::{Finish, IResult, Input, Parser};

use models_databases::{Formula, Operator};

use super::lexer::{self, Token, TokenKind};
use crate::catalog::Table;
use crate::parse::ParseError;
use crate::parse::tokens::Tokens;

type Formulas<'a> = Tokens<'a, Token>;
type Parsed<'a, Output> = IResult<Formulas<'a>, Output, ParseError>;

impl nom::error::ParseError<Formulas<'_>> for ParseError {
    fn from_error_kind(input: Formulas<'_>, _: nom::error::ErrorKind) -> Self {
        expected_operand(input)
    }

    fn append(_: Formulas<'_>, _: nom::error::ErrorKind, other: Self) -> Self {
        other
    }
}

pub(super) fn formula(table: &Table, text: &str) -> Result<Formula, ParseError> {
    if text.trim().is_empty() {
        return Err(ParseError {
            span: 0..0,
            message: "Write a formula, like `Price * Quantity`.".into(),
        });
    }
    let tokens = lexer::lex(text)?;
    let input = Tokens {
        tokens: &tokens,
        end: text.len(),
    };
    let (rest, formula) = sum(table, input).finish()?;
    match rest.first() {
        None => Ok(formula),
        Some(token) => Err(ParseError {
            span: token.span.clone(),
            message: format!(
                "Expected an operator (+ - * /), found `{}`.",
                &text[token.span.clone()]
            ),
        }),
    }
}

/// What the next token should have been: something to compute with.
fn expected_operand(input: Formulas<'_>) -> ParseError {
    match input.first() {
        Some(token) => ParseError {
            span: token.span.clone(),
            message: "Expected a column, a number or `(` here.".into(),
        },
        None => ParseError {
            span: input.end..input.end,
            message: "The formula ends too soon.".into(),
        },
    }
}

/// The next token as `read` takes it; a recoverable failure when it
/// declines it or none is left.
fn next<'a, Output>(
    read: impl Fn(&'a Token) -> Option<Output>,
) -> impl FnMut(Formulas<'a>) -> Parsed<'a, Output> {
    move |input: Formulas<'a>| match input.tokens.first().and_then(&read) {
        Some(output) => Ok((input.take_from(1), output)),
        None => Err(nom::Err::Error(expected_operand(input))),
    }
}

fn operator<'a>(
    operators: &'static [(TokenKind, Operator)],
) -> impl FnMut(Formulas<'a>) -> Parsed<'a, Operator> {
    next(move |token: &Token| {
        operators
            .iter()
            .find(|(kind, _)| *kind == token.kind)
            .map(|(_, operator)| *operator)
    })
}

fn binary(operator: Operator, left: Formula, right: Formula) -> Formula {
    Formula::Binary {
        operator,
        left: Box::new(left),
        right: Box::new(right),
    }
}

/// `term {(+ | -) term}`, grouping to the left.
fn sum<'a>(table: &Table, input: Formulas<'a>) -> Parsed<'a, Formula> {
    let (input, first) = product(table, input)?;
    let (input, rest) = many0((
        operator(&[
            (TokenKind::Plus, Operator::Add),
            (TokenKind::Minus, Operator::Subtract),
        ]),
        cut(|input| product(table, input)),
    ))
    .parse(input)?;
    Ok((
        input,
        rest.into_iter().fold(first, |left, (operator, right)| {
            binary(operator, left, right)
        }),
    ))
}

/// `unary {(* | /) unary}`, grouping to the left.
fn product<'a>(table: &Table, input: Formulas<'a>) -> Parsed<'a, Formula> {
    let (input, first) = unary(table, input)?;
    let (input, rest) = many0((
        operator(&[
            (TokenKind::Star, Operator::Multiply),
            (TokenKind::Slash, Operator::Divide),
        ]),
        cut(|input| unary(table, input)),
    ))
    .parse(input)?;
    Ok((
        input,
        rest.into_iter().fold(first, |left, (operator, right)| {
            binary(operator, left, right)
        }),
    ))
}

/// `- unary | atom`; a negated number is just a negative number.
fn unary<'a>(table: &Table, input: Formulas<'a>) -> Parsed<'a, Formula> {
    let (input, minus) = opt(next(|token: &Token| {
        (token.kind == TokenKind::Minus).then_some(())
    }))
    .parse(input)?;
    if minus.is_none() {
        return atom(table, input);
    }
    let (input, operand) = cut(|input| unary(table, input)).parse(input)?;
    Ok((
        input,
        match operand {
            Formula::Number { value } => Formula::Number { value: -value },
            operand => Formula::Negate {
                operand: Box::new(operand),
            },
        },
    ))
}

/// `number | name | ( sum )`.
fn atom<'a>(table: &Table, input: Formulas<'a>) -> Parsed<'a, Formula> {
    alt((
        number,
        |input| column(table, input),
        |input| parenthesized(table, input),
    ))
    .parse(input)
}

fn number(input: Formulas<'_>) -> Parsed<'_, Formula> {
    let (rest, (value, span)) = next(|token: &Token| match token.kind {
        TokenKind::Number(value) => Some((value, token.span.clone())),
        _ => None,
    })(input)?;
    if !value.is_finite() {
        return Err(nom::Err::Failure(ParseError {
            span,
            message: "That number is too large.".into(),
        }));
    }
    Ok((rest, Formula::Number { value }))
}

/// A word or a braced name, as the table's column it names, ignoring case.
fn column<'a>(table: &Table, input: Formulas<'a>) -> Parsed<'a, Formula> {
    let (rest, (name, braced, span)) = next(|token: &Token| match &token.kind {
        TokenKind::Word(name) => Some((name.as_str(), false, token.span.clone())),
        TokenKind::Braced(name) => Some((name.as_str(), true, token.span.clone())),
        _ => None,
    })(input)?;
    let wanted = name.to_lowercase();
    match table
        .columns
        .iter()
        .find(|column| column.name.to_lowercase() == wanted)
    {
        Some(column) => Ok((
            rest,
            Formula::Column {
                column: column.placement,
            },
        )),
        None => Err(nom::Err::Failure(ParseError {
            span,
            message: if braced {
                format!("There's no column called {name}.")
            } else {
                format!(
                    "There's no column called {name}. Write a name with spaces in braces, like {{Unit price}}."
                )
            },
        })),
    }
}

fn parenthesized<'a>(table: &Table, input: Formulas<'a>) -> Parsed<'a, Formula> {
    let (input, open) =
        next(|token: &Token| (token.kind == TokenKind::LeftParen).then(|| token.span.clone()))(
            input,
        )?;
    let (input, inner) = cut(|input| sum(table, input)).parse(input)?;
    let (input, _) = next(|token: &Token| (token.kind == TokenKind::RightParen).then_some(()))(
        input,
    )
    .map_err(|_| {
        nom::Err::Failure(ParseError {
            span: open,
            message: "A `(` needs a closing `)`.".into(),
        })
    })?;
    Ok((input, inner))
}
