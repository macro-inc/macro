//! The expression grammar, loosest binding first:
//!
//! ```text
//! or      = and ("||" and)*
//! and     = equal ("&&" equal)*
//! equal   = compare (("==" | "!=") compare)*
//! compare = unary (("<=" | ">=" | "<" | ">") unary)*
//! unary   = "!" unary | postfix
//! postfix = primary ("." name | ".*" | "[" or "]")*
//! primary = "(" or ")" | string | number | name "(" args ")" | name
//! ```
//!
//! A bare `name` is `true`, `false`, `null`, or a context root.

use nom::branch::alt;
use nom::bytes::complete::{tag, take_while, take_while1};
use nom::character::complete::{char, digit1, hex_digit1, multispace0, one_of};
use nom::combinator::{all_consuming, map, opt, recognize};
use nom::multi::{many0, separated_list0};
use nom::sequence::{delimited, pair, preceded, terminated};
use nom::{IResult, Parser};

use super::{Ast, Op};

/// One piece of a string that may embed `${{ ... }}`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TemplatePart<'a> {
    Text(&'a str),
    Expression(Ast),
}

/// Parse a whole expression, such as an `if:` value without `${{ }}`.
pub fn parse(text: &str) -> Result<Ast, String> {
    all_consuming(delimited(multispace0, or_expr, multispace0))
        .parse(text)
        .map(|(_, ast)| ast)
        .map_err(|error| format!("cannot parse expression `{text}`: {error}"))
}

/// Split `text` into literal text and the expressions inside `${{ ... }}`.
pub fn parse_template(text: &str) -> Result<Vec<TemplatePart<'_>>, String> {
    let mut parts = Vec::new();
    let mut rest = text;

    while let Some(start) = rest.find("${{") {
        if start > 0 {
            parts.push(TemplatePart::Text(&rest[..start]));
        }
        let body = &rest[start + 3..];
        let (after, ast) = terminated(delimited(multispace0, or_expr, multispace0), tag("}}"))
            .parse(body)
            .map_err(|error| {
                format!(
                    "cannot parse the expression at `{}`: {error}",
                    &rest[start..]
                )
            })?;
        parts.push(TemplatePart::Expression(ast));
        rest = after;
    }

    if !rest.is_empty() {
        parts.push(TemplatePart::Text(rest));
    }
    Ok(parts)
}

type Parsed<'a> = IResult<&'a str, Ast>;

/// `parser` with optional whitespace around it.
fn spaced<'a, Output>(
    parser: impl Parser<&'a str, Output = Output, Error = nom::error::Error<&'a str>>,
) -> impl Parser<&'a str, Output = Output, Error = nom::error::Error<&'a str>> {
    delimited(multispace0, parser, multispace0)
}

/// A left-associative chain of `operand (operator operand)*`.
fn chain<'a>(
    input: &'a str,
    operand: fn(&'a str) -> Parsed<'a>,
    operator: fn(&'a str) -> IResult<&'a str, Op>,
) -> Parsed<'a> {
    let (input, first) = operand(input)?;
    let (input, rest) = many0(pair(spaced(operator), operand)).parse(input)?;
    let ast = rest.into_iter().fold(first, |left, (op, right)| {
        Ast::Binary(op, Box::new(left), Box::new(right))
    });
    Ok((input, ast))
}

fn or_expr(input: &str) -> Parsed<'_> {
    chain(input, and_expr, |input| {
        map(tag("||"), |_| Op::Or).parse(input)
    })
}

fn and_expr(input: &str) -> Parsed<'_> {
    chain(input, equal_expr, |input| {
        map(tag("&&"), |_| Op::And).parse(input)
    })
}

fn equal_expr(input: &str) -> Parsed<'_> {
    chain(input, compare_expr, |input| {
        alt((map(tag("=="), |_| Op::Eq), map(tag("!="), |_| Op::Ne))).parse(input)
    })
}

fn compare_expr(input: &str) -> Parsed<'_> {
    chain(input, unary_expr, |input| {
        alt((
            map(tag("<="), |_| Op::Le),
            map(tag(">="), |_| Op::Ge),
            map(tag("<"), |_| Op::Lt),
            map(tag(">"), |_| Op::Gt),
        ))
        .parse(input)
    })
}

fn unary_expr(input: &str) -> Parsed<'_> {
    alt((
        map(
            preceded(terminated(char('!'), multispace0), unary_expr),
            |operand| Ast::Not(Box::new(operand)),
        ),
        postfix_expr,
    ))
    .parse(input)
}

enum Postfix {
    Property(String),
    Star,
    Index(Ast),
}

fn postfix_expr(input: &str) -> Parsed<'_> {
    let (input, object) = primary.parse(input)?;
    let (input, accesses) = many0(alt((
        map(tag(".*"), |_| Postfix::Star),
        map(preceded(char('.'), property_name), |name: &str| {
            Postfix::Property(name.to_string())
        }),
        map(
            delimited(spaced(char('[')), or_expr, spaced(char(']'))),
            Postfix::Index,
        ),
    )))
    .parse(input)?;

    let ast = accesses
        .into_iter()
        .fold(object, |object, access| match access {
            Postfix::Property(name) => Ast::Property(Box::new(object), name),
            Postfix::Star => Ast::Star(Box::new(object)),
            Postfix::Index(index) => Ast::Index(Box::new(object), Box::new(index)),
        });
    Ok((input, ast))
}

fn primary(input: &str) -> Parsed<'_> {
    alt((
        map(
            delimited(
                terminated(char('('), multispace0),
                or_expr,
                preceded(multispace0, char(')')),
            ),
            |inner| Ast::Group(Box::new(inner)),
        ),
        string,
        number,
        call,
        name,
    ))
    .parse(input)
}

/// `'text'`, where `''` is a literal quote.
fn string(input: &str) -> Parsed<'_> {
    let (input, pieces) = delimited(
        char('\''),
        many0(alt((map(tag("''"), |_| "'"), take_while1(|c| c != '\'')))),
        char('\''),
    )
    .parse(input)?;
    Ok((input, Ast::Str(pieces.concat())))
}

fn number(input: &str) -> Parsed<'_> {
    let hex = recognize(pair(alt((tag("0x"), tag("0X"))), hex_digit1));
    let decimal = recognize((
        digit1,
        opt(pair(char('.'), digit1)),
        opt((one_of("eE"), opt(one_of("+-")), digit1)),
    ));
    map(
        recognize(pair(opt(char('-')), alt((hex, decimal)))),
        |text: &str| Ast::Number(text.to_string()),
    )
    .parse(input)
}

fn call(input: &str) -> Parsed<'_> {
    map(
        pair(
            identifier,
            delimited(
                spaced(char('(')),
                separated_list0(spaced(char(',')), or_expr),
                preceded(multispace0, char(')')),
            ),
        ),
        |(name, args)| Ast::Call(name.to_string(), args),
    )
    .parse(input)
}

fn name(input: &str) -> Parsed<'_> {
    map(identifier, |name: &str| match name {
        "true" => Ast::Bool(true),
        "false" => Ast::Bool(false),
        "null" => Ast::Null,
        context => Ast::Context(context.to_string()),
    })
    .parse(input)
}

/// A context or function name: a letter or `_`, then letters, digits, `_`
/// and `-`.
fn identifier(input: &str) -> IResult<&str, &str> {
    recognize(pair(
        take_while1(|c: char| c.is_ascii_alphabetic() || c == '_'),
        take_while(|c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-'),
    ))
    .parse(input)
}

/// A property after `.`: job, step and output ids may start with a digit.
fn property_name(input: &str) -> IResult<&str, &str> {
    take_while1(|c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-').parse(input)
}
