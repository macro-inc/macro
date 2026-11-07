//! CSS declaration parsing without splitting quoted or nested values.
use crate::collections::IndexMap;
use nom::{
    IResult, Parser,
    branch::alt,
    bytes::complete::{tag, take_until, take_while1},
    character::complete::char,
    combinator::recognize,
    multi::many0,
    sequence::delimited,
};

fn comment(input: &str) -> IResult<&str, &str> {
    recognize(delimited(tag("/*"), take_until("*/"), tag("*/"))).parse(input)
}
fn quoted(input: &str) -> IResult<&str, &str> {
    alt((
        recognize(delimited(
            char('"'),
            many0(alt((
                recognize((char('\\'), nom::character::complete::anychar)),
                take_while1(|c| c != '"' && c != '\\'),
            ))),
            char('"'),
        )),
        recognize(delimited(
            char('\''),
            many0(alt((
                recognize((char('\\'), nom::character::complete::anychar)),
                take_while1(|c| c != '\'' && c != '\\'),
            ))),
            char('\''),
        )),
    ))
    .parse(input)
}
fn nested(input: &str) -> IResult<&str, &str> {
    recognize(delimited(
        char('('),
        many0(alt((
            quoted,
            comment,
            nested,
            recognize((char('\\'), nom::character::complete::anychar)),
            take_while1(|c| !matches!(c, '(' | ')' | '"' | '\'' | '\\' | '/')),
            tag("/"),
        ))),
        char(')'),
    ))
    .parse(input)
}
fn value_part(input: &str) -> IResult<&str, &str> {
    alt((
        quoted,
        comment,
        nested,
        recognize((char('\\'), nom::character::complete::anychar)),
        take_while1(|c| !matches!(c, ';' | '(' | '"' | '\'' | '\\' | '/')),
        tag("/"),
    ))
    .parse(input)
}
/// Parse declarations in insertion order, honoring quotes, escapes, comments and parentheses.
/// Duplicate names replace values without moving their original position.
pub fn parse_css_declarations(css: &str) -> IndexMap<String, String> {
    let mut result = IndexMap::default();
    let mut input = css;
    while !input.is_empty() {
        let Ok((rest, parts)) = many0(alt((
            comment,
            take_while1(|c: char| c.is_whitespace() || c == ';'),
        )))
        .parse(input) else {
            break;
        };
        let _ = parts;
        input = rest;
        if input.is_empty() {
            break;
        }
        let property: IResult<&str, &str> = take_while1(|c| c != ':' && c != ';').parse(input);
        let Ok((rest, name)) = property else {
            let skipped: IResult<&str, &str> = take_until(";").parse(input);
            if let Ok((rest, _)) = skipped {
                input = rest;
                continue;
            }
            break;
        };
        let colon: IResult<&str, char> = char(':').parse(rest);
        let Ok((rest, _)) = colon else {
            let skipped: IResult<&str, &str> = take_until(";").parse(input);
            if let Ok((rest, _)) = skipped {
                input = rest;
                continue;
            }
            break;
        };
        let Ok((rest, parts)) = many0(value_part).parse(rest) else {
            break;
        };
        let value: String = parts
            .into_iter()
            .filter(|part| !part.starts_with("/*"))
            .collect();
        if !name.trim().is_empty() && !value.trim().is_empty() {
            result.insert(name.trim().to_owned(), value.trim().to_owned());
        }
        if rest == input {
            break;
        }
        input = rest;
    }
    result
}
#[cfg(test)]
mod test;
