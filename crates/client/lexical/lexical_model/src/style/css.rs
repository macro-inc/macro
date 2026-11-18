//! Ordered CSS declaration parsing without a parse cache.
/// Ordered property/value declarations.
pub type StyleObject = indexmap::IndexMap<String, String>;
/// Trim ECMAScript WhiteSpace and LineTerminator characters, including BOM.
pub fn js_trim(value: &str) -> &str {
    value.trim_matches(is_js_whitespace)
}
use nom::{
    IResult, Parser,
    branch::alt,
    bytes::complete::{tag, take_until, take_while1},
    character::complete::{anychar, char},
    combinator::{map, opt, recognize, rest, value},
    multi::many0,
};
#[derive(Clone, Copy)]
enum Token<'a> {
    Fragment(&'a str),
    Comment,
    Open,
    Close,
    Colon,
    Semicolon,
}
fn comment(input: &str) -> IResult<&str, &str> {
    recognize((
        tag("/*"),
        alt((recognize((take_until("*/"), tag("*/"))), rest)),
    ))
    .parse(input)
}
fn single_quoted(input: &str) -> IResult<&str, &str> {
    quoted(input, '\'')
}
fn double_quoted(input: &str) -> IResult<&str, &str> {
    quoted(input, '"')
}
fn quoted(input: &str, quote: char) -> IResult<&str, &str> {
    // Unterminated quotes consume the rest, matching the upstream CSS scanner.
    recognize((
        char(quote),
        many0(alt((
            recognize((char('\\'), anychar)),
            take_while1(move |ch| ch != quote && ch != '\\'),
            tag("\\"),
        ))),
        opt(char(quote)),
    ))
    .parse(input)
}
fn token(input: &str) -> IResult<&str, Token<'_>> {
    alt((
        value(Token::Comment, comment),
        map(single_quoted, Token::Fragment),
        map(double_quoted, Token::Fragment),
        value(Token::Open, char('(')),
        value(Token::Close, char(')')),
        value(Token::Colon, char(':')),
        value(Token::Semicolon, char(';')),
        map(
            take_while1(|ch| !matches!(ch, '/' | '\'' | '"' | '(' | ')' | ':' | ';')),
            Token::Fragment,
        ),
        map(recognize(anychar), Token::Fragment),
    ))
    .parse(input)
}
/// Parse comments, quoted strings, escapes and parenthesized CSS values with nom.
pub fn style_object_from_css(css: &str) -> StyleObject {
    let mut styles = StyleObject::new();
    let (mut property, mut value) = (String::new(), String::new());
    let (mut parsing_value, mut depth) = (false, 0u32);
    let mut input = css;
    while let Ok((rest, token)) = token(input) {
        input = rest;
        let target = if parsing_value {
            &mut value
        } else {
            &mut property
        };
        match token {
            Token::Comment => {}
            Token::Fragment(fragment) => target.push_str(fragment),
            Token::Open => {
                depth += 1;
                target.push('(');
            }
            Token::Close => {
                depth = depth.saturating_sub(1);
                target.push(')');
            }
            Token::Colon if !parsing_value && depth == 0 => parsing_value = true,
            Token::Colon => target.push(':'),
            Token::Semicolon if depth == 0 => {
                commit(&mut styles, &property, &value);
                property.clear();
                value.clear();
                parsing_value = false;
            }
            Token::Semicolon => target.push(';'),
        }
    }
    commit(&mut styles, &property, &value);
    styles
}
fn commit(styles: &mut StyleObject, property: &str, value: &str) {
    let (property, value) = (js_trim(property), js_trim(value));
    if !property.is_empty() && !value.is_empty() {
        styles.insert(property.to_owned(), value.to_owned());
    }
}
/// Serialize nonempty keys in insertion order without separators between declarations.
pub fn css_from_style_object(styles: &StyleObject) -> String {
    let mut css = String::new();
    for (key, value) in styles {
        if !key.is_empty() {
            css.push_str(key);
            css.push_str(": ");
            css.push_str(value);
            css.push(';');
        }
    }
    css
}
#[cfg(test)]
mod test;

/// ECMAScript WhiteSpace and LineTerminator, excluding Unicode-only NEL.
pub fn is_js_whitespace(ch: char) -> bool {
    matches!(ch, '\u{0009}'..='\u{000d}' | ' ' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
