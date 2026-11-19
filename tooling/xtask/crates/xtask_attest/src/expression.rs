//! The part of GitHub Actions' expression language the attested jobs use:
//! literals, context lookups, `!`, `==`, `!=`, `&&`, `||`, parentheses, and
//! the functions in [`call`]. Anything else is an error, so a job that starts
//! to depend on more is reported instead of guessed at.

use std::fmt;

use nom::{
    IResult, Parser,
    branch::alt,
    bytes::complete::{tag, take_while1},
    character::complete::{char, multispace0},
    combinator::{map, map_res, opt, recognize, value},
    multi::{many0, separated_list0},
    sequence::{delimited, pair, preceded},
};
use rootcause::prelude::*;

#[cfg(test)]
mod test;

/// What an expression evaluates to.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
}

impl Value {
    /// GitHub's truthiness: `false`, `0`, `''` and `null` are false.
    pub fn truthy(&self) -> bool {
        match self {
            Value::Null => false,
            Value::Bool(value) => *value,
            Value::Number(value) => *value != 0.0 && !value.is_nan(),
            Value::String(value) => !value.is_empty(),
        }
    }

    /// The number GitHub compares this as when the two sides differ in type.
    fn as_number(&self) -> f64 {
        match self {
            Value::Null => 0.0,
            Value::Bool(value) => f64::from(u8::from(*value)),
            Value::Number(value) => *value,
            Value::String(value) if value.is_empty() => 0.0,
            Value::String(value) => value.trim().parse().unwrap_or(f64::NAN),
        }
    }

    /// GitHub's loose equality: strings ignore case, mixed types compare as numbers.
    fn loosely_equals(&self, other: &Value) -> bool {
        match (self, other) {
            (Value::String(left), Value::String(right)) => left.eq_ignore_ascii_case(right),
            (Value::Null, Value::Null) => true,
            (Value::Bool(left), Value::Bool(right)) => left == right,
            _ => self.as_number() == other.as_number(),
        }
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Null => Ok(()),
            Value::Bool(value) => write!(f, "{value}"),
            Value::Number(value) => write!(f, "{value}"),
            Value::String(value) => write!(f, "{value}"),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Expression {
    Literal(Value),
    /// `needs.path-check.outputs.should_run`, as its dotted parts.
    Context(Vec<String>),
    Call(String, Vec<Expression>),
    Not(Box<Expression>),
    Equal(Box<Expression>, Box<Expression>),
    NotEqual(Box<Expression>, Box<Expression>),
    And(Box<Expression>, Box<Expression>),
    Or(Box<Expression>, Box<Expression>),
}

/// Where context lookups are answered: `steps.filter.outputs.should_run` and
/// the like. A context the caller can't answer (`secrets`) is an error.
pub trait Contexts {
    fn lookup(&self, path: &[String]) -> Result<Value, Report>;
}

fn spaced<'a, O>(
    parser: impl Parser<&'a str, Output = O, Error = nom::error::Error<&'a str>>,
) -> impl Parser<&'a str, Output = O, Error = nom::error::Error<&'a str>> {
    delimited(multispace0, parser, multispace0)
}

fn name(input: &str) -> IResult<&str, &str> {
    take_while1(|c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-').parse(input)
}

/// `'it''s'`: single quotes, doubled to escape one.
fn string(input: &str) -> IResult<&str, String> {
    map(
        delimited(
            char('\''),
            many0(alt((
                value("'", tag("''")),
                take_while1(|c: char| c != '\''),
            ))),
            char('\''),
        ),
        |parts: Vec<&str>| parts.concat(),
    )
    .parse(input)
}

fn literal(input: &str) -> IResult<&str, Expression> {
    alt((
        map(string, |text| Expression::Literal(Value::String(text))),
        map(
            map_res(
                take_while1(|c: char| c.is_ascii_digit() || c == '.'),
                str::parse::<f64>,
            ),
            |number| Expression::Literal(Value::Number(number)),
        ),
    ))
    .parse(input)
}

/// A function call, a keyword, or a context path; they all start with a name.
fn named(input: &str) -> IResult<&str, Expression> {
    let (rest, first) = name(input)?;

    let arguments = delimited(
        spaced(char('(')),
        separated_list0(spaced(char(',')), or),
        spaced(char(')')),
    );
    if let (rest, Some(arguments)) = opt(arguments).parse(rest)? {
        return Ok((rest, Expression::Call(first.to_owned(), arguments)));
    }

    let (rest, more) = many0(alt((
        preceded(char('.'), map(name, str::to_owned)),
        delimited(char('['), spaced(string), char(']')),
    )))
    .parse(rest)?;

    let expression = match (first, more.is_empty()) {
        ("true", true) => Expression::Literal(Value::Bool(true)),
        ("false", true) => Expression::Literal(Value::Bool(false)),
        ("null", true) => Expression::Literal(Value::Null),
        _ => {
            let mut path = vec![first.to_owned()];
            path.extend(more);
            Expression::Context(path)
        }
    };
    Ok((rest, expression))
}

fn primary(input: &str) -> IResult<&str, Expression> {
    spaced(alt((delimited(char('('), or, char(')')), literal, named))).parse(input)
}

fn unary(input: &str) -> IResult<&str, Expression> {
    alt((
        map(preceded(spaced(char('!')), unary), |inner| {
            Expression::Not(Box::new(inner))
        }),
        primary,
    ))
    .parse(input)
}

fn comparison(input: &str) -> IResult<&str, Expression> {
    let (rest, left) = unary(input)?;
    let (rest, right) =
        opt(pair(spaced(recognize(alt((tag("=="), tag("!="))))), unary)).parse(rest)?;

    let expression = match right {
        Some(("==", right)) => Expression::Equal(Box::new(left), Box::new(right)),
        Some((_, right)) => Expression::NotEqual(Box::new(left), Box::new(right)),
        None => left,
    };
    Ok((rest, expression))
}

fn and(input: &str) -> IResult<&str, Expression> {
    let (rest, first) = comparison(input)?;
    let (rest, more) = many0(preceded(spaced(tag("&&")), comparison)).parse(rest)?;
    let expression = more.into_iter().fold(first, |left, right| {
        Expression::And(Box::new(left), Box::new(right))
    });
    Ok((rest, expression))
}

fn or(input: &str) -> IResult<&str, Expression> {
    let (rest, first) = and(input)?;
    let (rest, more) = many0(preceded(spaced(tag("||")), and)).parse(rest)?;
    let expression = more.into_iter().fold(first, |left, right| {
        Expression::Or(Box::new(left), Box::new(right))
    });
    Ok((rest, expression))
}

/// The functions the attested jobs call. The status functions answer for a
/// job that is still passing: `cargo x attest` stops at the first failed step.
fn call(function: &str, arguments: &[Value]) -> Result<Value, Report> {
    let text = |value: &Value| value.to_string().to_lowercase();

    match (function.to_lowercase().as_str(), arguments) {
        ("always" | "success", []) => Ok(Value::Bool(true)),
        ("cancelled" | "failure", []) => Ok(Value::Bool(false)),
        ("contains", [search, item]) => Ok(Value::Bool(text(search).contains(&text(item)))),
        ("startswith", [search, prefix]) => {
            Ok(Value::Bool(text(search).starts_with(&text(prefix))))
        }
        ("endswith", [search, suffix]) => Ok(Value::Bool(text(search).ends_with(&text(suffix)))),
        _ => bail!(
            "`{function}` with {} arguments is not a function cargo x attest evaluates",
            arguments.len()
        ),
    }
}

fn evaluate_parsed(expression: &Expression, contexts: &dyn Contexts) -> Result<Value, Report> {
    let evaluate = |expression: &Expression| evaluate_parsed(expression, contexts);

    Ok(match expression {
        Expression::Literal(value) => value.clone(),
        Expression::Context(path) => contexts.lookup(path)?,
        Expression::Call(function, arguments) => {
            let arguments: Vec<Value> = arguments.iter().map(evaluate).collect::<Result<_, _>>()?;
            call(function, &arguments)?
        }
        Expression::Not(inner) => Value::Bool(!evaluate(inner)?.truthy()),
        Expression::Equal(left, right) => {
            Value::Bool(evaluate(left)?.loosely_equals(&evaluate(right)?))
        }
        Expression::NotEqual(left, right) => {
            Value::Bool(!evaluate(left)?.loosely_equals(&evaluate(right)?))
        }
        // Like JavaScript, `&&` and `||` give back an operand, which is how
        // `a == 'x' && 'yes' || 'no'` chooses a string.
        Expression::And(left, right) => {
            let left = evaluate(left)?;
            if left.truthy() {
                evaluate(right)?
            } else {
                left
            }
        }
        Expression::Or(left, right) => {
            let left = evaluate(left)?;
            if left.truthy() {
                left
            } else {
                evaluate(right)?
            }
        }
    })
}

/// Evaluate one expression: a job or step condition, with or without its
/// `${{ }}` wrapper.
pub fn evaluate(source: &str, contexts: &dyn Contexts) -> Result<Value, Report> {
    let trimmed = source.trim();
    let bare = trimmed
        .strip_prefix("${{")
        .and_then(|inner| inner.strip_suffix("}}"))
        .unwrap_or(trimmed);

    match or(bare) {
        Ok(("", expression)) => evaluate_parsed(&expression, contexts),
        Ok((rest, _)) => bail!("`{source}`: cargo x attest can't evaluate `{rest}`"),
        Err(error) => bail!("`{source}` is not an expression cargo x attest evaluates: {error}"),
    }
}

/// Replace every `${{ expression }}` in a text with its value.
pub fn render(text: &str, contexts: &dyn Contexts) -> Result<String, Report> {
    let mut rendered = String::new();
    let mut rest = text;

    while let Some(start) = rest.find("${{") {
        rendered.push_str(&rest[..start]);
        let after = &rest[start + 3..];

        let (after, expression) =
            or(after).map_err(|error| report!("`{text}`: not an expression: {error}"))?;
        let Some(after) = after.strip_prefix("}}") else {
            bail!("`{text}`: an expression is not closed where cargo x attest expects it");
        };

        rendered.push_str(&evaluate_parsed(&expression, contexts)?.to_string());
        rest = after;
    }

    rendered.push_str(rest);
    Ok(rendered)
}
