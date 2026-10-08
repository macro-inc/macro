//! nom combinators over the formula text, one function per grammar rule.
//! Errors carry the byte range they point at, measured from what input is
//! left when they are raised.

use nom::branch::alt;
use nom::bytes::complete::{take_till, take_while1};
use nom::character::complete::{char, multispace0};
use nom::combinator::{cut, map, opt, recognize};
use nom::multi::many0;
use nom::number::complete::recognize_float;
use nom::sequence::{delimited, preceded, terminated};
use nom::{Finish, IResult, Parser};

use models_databases::{Formula, Operator};

use crate::catalog::Table;
use crate::parse::ParseError;

/// What failed and how much input was left there.
#[derive(Debug)]
struct Failure {
    remaining: usize,
    length: usize,
    message: String,
}

impl<'a> nom::error::ParseError<&'a str> for Failure {
    fn from_error_kind(input: &'a str, _kind: nom::error::ErrorKind) -> Self {
        Failure {
            remaining: input.len(),
            length: 0,
            message: match input.trim_start().chars().next() {
                Some(found) => format!("Expected a column, a number or `(`, found `{found}`."),
                None => "The formula ends too soon.".into(),
            },
        }
    }

    fn append(_input: &'a str, _kind: nom::error::ErrorKind, other: Self) -> Self {
        other
    }

    fn or(self, other: Self) -> Self {
        // Keep the failure that got furthest.
        if other.remaining < self.remaining {
            other
        } else {
            self
        }
    }
}

type Parsed<'a, Output> = IResult<&'a str, Output, Failure>;

pub(super) fn formula(table: &Table, text: &str) -> Result<Formula, ParseError> {
    let error = |failure: Failure| {
        let start = text.len() - failure.remaining;
        ParseError {
            span: start..(start + failure.length).min(text.len()),
            message: failure.message,
        }
    };
    if text.trim().is_empty() {
        return Err(ParseError {
            span: 0..0,
            message: "Write a formula, like `Price * Quantity`.".into(),
        });
    }
    let (rest, formula) = terminated(|input| sum(table, input), multispace0)
        .parse(text)
        .finish()
        .map_err(error)?;
    match rest.chars().next() {
        None => Ok(formula),
        Some(found) => Err(error(Failure {
            remaining: rest.len(),
            length: found.len_utf8(),
            message: format!("Expected an operator (+ - * /), found `{found}`."),
        })),
    }
}

fn token<'a, Output>(
    parser: impl Parser<&'a str, Output = Output, Error = Failure>,
) -> impl Parser<&'a str, Output = Output, Error = Failure> {
    preceded(multispace0, parser)
}

fn binary(operator: Operator, left: Formula, right: Formula) -> Formula {
    Formula::Binary {
        operator,
        left: Box::new(left),
        right: Box::new(right),
    }
}

fn sum<'a>(table: &Table, input: &'a str) -> Parsed<'a, Formula> {
    let (input, first) = product(table, input)?;
    let (input, rest) = many0((
        token(alt((
            map(char('+'), |_| Operator::Add),
            map(char('-'), |_| Operator::Subtract),
        ))),
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

fn product<'a>(table: &Table, input: &'a str) -> Parsed<'a, Formula> {
    let (input, first) = unary(table, input)?;
    let (input, rest) = many0((
        token(alt((
            map(char('*'), |_| Operator::Multiply),
            map(char('/'), |_| Operator::Divide),
        ))),
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

fn unary<'a>(table: &Table, input: &'a str) -> Parsed<'a, Formula> {
    let (input, minus) = opt(token(char('-'))).parse(input)?;
    match minus {
        Some(_) => map(cut(|input| unary(table, input)), |operand| match operand {
            Formula::Number { value } => Formula::Number { value: -value },
            operand => Formula::Negate {
                operand: Box::new(operand),
            },
        })
        .parse(input),
        None => atom(table, input),
    }
}

fn atom<'a>(table: &Table, input: &'a str) -> Parsed<'a, Formula> {
    let (input, _) = multispace0(input)?;
    alt((
        |input| number(input),
        |input| braced(table, input),
        |input| word(table, input),
        |input| parenthesized(table, input),
    ))
    .parse(input)
}

fn number(input: &str) -> Parsed<'_, Formula> {
    let (rest, digits) = recognize_float(input)?;
    match digits.parse::<f64>() {
        Ok(value) if value.is_finite() => Ok((rest, Formula::Number { value })),
        _ => Err(nom::Err::Failure(Failure {
            remaining: input.len(),
            length: digits.len(),
            message: format!("`{digits}` isn't a number."),
        })),
    }
}

fn braced<'a>(table: &Table, input: &'a str) -> Parsed<'a, Formula> {
    let start = input;
    let (input, name) =
        preceded(char('{'), cut(take_till(|character| character == '}'))).parse(input)?;
    let (input, _) = cut(char('}'))
        .parse(input)
        .map_err(|_: nom::Err<Failure>| {
            nom::Err::Failure(Failure {
                remaining: start.len(),
                length: start.len(),
                message: "A `{` needs a closing `}`.".into(),
            })
        })?;
    column(table, name, start, input)
}

fn word<'a>(table: &Table, input: &'a str) -> Parsed<'a, Formula> {
    let start = input;
    let (input, name) = recognize((
        take_while1(|character: char| character.is_alphabetic() || character == '_'),
        opt(take_while1(|character: char| {
            character.is_alphanumeric() || character == '_'
        })),
    ))
    .parse(input)?;
    column(table, name, start, input)
}

/// The column `name` names; `start` is where its text began and `rest` what
/// follows it.
fn column<'a>(table: &Table, name: &str, start: &'a str, rest: &'a str) -> Parsed<'a, Formula> {
    let name = name.trim();
    match table
        .columns
        .iter()
        .find(|column| column.name.to_lowercase() == name.to_lowercase())
    {
        Some(column) => Ok((
            rest,
            Formula::Column {
                column: column.placement,
            },
        )),
        None => Err(nom::Err::Failure(Failure {
            remaining: start.len(),
            length: start.len() - rest.len(),
            message: if name.contains(' ') || start.starts_with('{') {
                format!("There's no column called {name}.")
            } else {
                format!(
                    "There's no column called {name}. Write a name with spaces in braces, like {{Unit price}}."
                )
            },
        })),
    }
}

fn parenthesized<'a>(table: &Table, input: &'a str) -> Parsed<'a, Formula> {
    let start = input;
    delimited(
        char('('),
        cut(|input| sum(table, input)),
        cut(token(char(')'))),
    )
    .parse(input)
    .map_err(|error| match error {
        nom::Err::Failure(failure)
            if failure.length == 0 && failure.message.ends_with("too soon.") =>
        {
            nom::Err::Failure(Failure {
                remaining: start.len(),
                length: 1,
                message: "A `(` needs a closing `)`.".into(),
            })
        }
        other => other,
    })
}
