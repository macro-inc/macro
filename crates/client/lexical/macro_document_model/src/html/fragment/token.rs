//! HTML lexical modes: Logos recognizes starts, nom parses names and attributes.
use logos::Logos;
use nom::{
    IResult, Parser,
    branch::alt,
    bytes::complete::{tag, tag_no_case, take_till, take_until, take_while, take_while1},
    character::complete::{anychar, one_of},
    combinator::{eof, peek, value},
    multi::many_till,
};
#[derive(Logos, Debug, PartialEq)]
enum Start {
    #[token("<!--")]
    Comment,
    #[token("</")]
    Close,
    #[token("<!")]
    Declaration,
    #[token("<?")]
    Processing,
    #[token("<")]
    Open,
    #[regex("[^<]+")]
    Text,
}
pub(super) enum Token<'a> {
    Text(&'a str),
    Cdata(&'a str),
    Comment(&'a str),
    Directive(&'a str),
    Close(String),
    Open {
        name: String,
        attributes: Vec<(String, String)>,
        self_close: bool,
    },
    Ignore,
}
pub(super) fn space(ch: char) -> bool {
    matches!(ch, ' ' | '\t' | '\n' | '\r' | '\x0c')
}
fn whitespace(input: &str) -> IResult<&str, &str> {
    take_while(space).parse(input)
}
fn name(input: &str) -> IResult<&str, &str> {
    take_while1(|ch| !space(ch) && ch != '/' && ch != '>').parse(input)
}
fn attribute(input: &str) -> IResult<&str, &str> {
    take_while1(|ch| !space(ch) && !matches!(ch, '=' | '/' | '>')).parse(input)
}
fn prefix<'a>(input: &'a str, needle: &str) -> Option<&'a str> {
    tag::<_, _, nom::error::Error<_>>(needle)
        .parse(input)
        .ok()
        .map(|(rest, _)| rest)
}
fn through<'a>(input: &'a str, needle: &str) -> (&'a str, &'a str, bool) {
    if let Ok((rest, content)) = take_until::<_, _, nom::error::Error<_>>(needle).parse(input)
        && let Some(rest) = prefix(rest, needle)
    {
        return (rest, content, true);
    }
    ("", input, false)
}
fn value_input(input: &str) -> IResult<&str, &str> {
    if let Some(rest) = prefix(input, "\"") {
        let (tail, value, _) = through(rest, "\"");
        return Ok((tail, value));
    }
    if let Some(rest) = prefix(input, "'") {
        let (tail, value, _) = through(rest, "'");
        return Ok((tail, value));
    }
    take_while(|ch| !space(ch) && ch != '>').parse(input)
}
/// Raw tokenizer modes stop at a matching case-insensitive closing tag boundary.
pub(super) fn raw_text<'a>(input: &'a str, name: &str) -> (&'a str, String) {
    let closing = peek((
        tag_no_case("</"),
        tag_no_case(name),
        alt((value((), one_of(" \t\n\r\x0c>")), value((), eof))),
    ));
    let parsed: IResult<&str, (Vec<char>, _)> = many_till(anychar, closing).parse(input);
    match parsed {
        Ok((rest, (content, _))) => (rest, content.into_iter().collect()),
        Err(_) => ("", input.into()),
    }
}
pub(super) fn next(input: &str) -> lexical_html::Result<(&str, Token<'_>)> {
    let mut lexer = Start::lexer(input);
    let start = lexer
        .next()
        .transpose()
        .map_err(|_| lexical_html::Error::InvalidExport("invalid HTML token"))?
        .ok_or(lexical_html::Error::InvalidExport("missing HTML token"))?;
    let mut rest = lexer.remainder();
    match start {
        Start::Text => return Ok((rest, Token::Text(lexer.slice()))),
        Start::Comment => {
            if rest.is_empty() {
                return Ok((rest, Token::Ignore));
            }
            if let Some(tail) = prefix(rest, ">").or_else(|| prefix(rest, "->")) {
                return Ok((tail, Token::Comment("")));
            }
            let (tail, comment, _) = through(rest, "-->");
            return Ok((tail, Token::Comment(comment)));
        }
        Start::Declaration | Start::Processing => {
            if start == Start::Declaration
                && let Some(content) = prefix(rest, "[CDATA[")
            {
                if content.is_empty() {
                    return Ok((content, Token::Ignore));
                }
                let (tail, content, _) = through(content, "]]>");
                return Ok((tail, Token::Cdata(content)));
            }
            let (tail, body, complete) = through(rest, ">");
            return Ok((
                tail,
                if complete && start == Start::Processing {
                    Token::Ignore
                } else if complete {
                    Token::Directive(body)
                } else if body == "[CDATA[" {
                    Token::Ignore
                } else {
                    Token::Text(body)
                },
            ));
        }
        Start::Close => {
            if rest
                .as_bytes()
                .first()
                .is_some_and(|byte| !byte.is_ascii_alphabetic() && *byte != b'>')
            {
                let (tail, comment, _) = through(rest, ">");
                return Ok((tail, Token::Comment(comment)));
            }
            if let Ok((_, name)) = name(rest) {
                let (tail, _, complete) = through(rest, ">");
                return Ok((
                    tail,
                    if complete {
                        Token::Close(name.to_ascii_lowercase())
                    } else {
                        Token::Ignore
                    },
                ));
            }
            return Ok((
                prefix(input, "<")
                    .ok_or(lexical_html::Error::InvalidExport("closing token prefix"))?,
                Token::Text("<"),
            ));
        }
        Start::Open => {}
    }
    if !rest.as_bytes().first().is_some_and(u8::is_ascii_alphabetic) {
        return Ok((rest, Token::Text("<")));
    }
    let (tail, node_name) =
        name(rest).map_err(|_| lexical_html::Error::InvalidExport("invalid tag name"))?;
    let name = node_name.to_ascii_lowercase();
    rest = tail;
    if rest.is_empty() {
        return Ok((
            rest,
            if ["script", "style", "title", "textarea", "xmp"]
                .iter()
                .any(|tag| tag.starts_with(&name))
            {
                Token::Text(node_name)
            } else {
                Token::Ignore
            },
        ));
    }
    let mut attributes = Vec::new();
    loop {
        rest = whitespace(rest)
            .map_err(|_| lexical_html::Error::InvalidExport("attribute whitespace"))?
            .0;
        if let Some(rest) = prefix(rest, ">") {
            return Ok((
                rest,
                Token::Open {
                    name,
                    attributes,
                    self_close: false,
                },
            ));
        }
        if let Some(rest) = prefix(rest, "/>") {
            return Ok((
                rest,
                Token::Open {
                    name,
                    attributes,
                    self_close: true,
                },
            ));
        }
        if rest == "/" {
            return Ok(("", Token::Text("/")));
        }
        if rest.is_empty() {
            return Ok((rest, Token::Ignore));
        }
        let Ok((tail, key)) = attribute(rest) else {
            let (tail, _): (&str, char) = anychar::<_, nom::error::Error<_>>(rest)
                .map_err(|_| lexical_html::Error::InvalidExport("invalid attribute delimiter"))?;
            rest = tail;
            continue;
        };
        rest = whitespace(tail)
            .map_err(|_| lexical_html::Error::InvalidExport("attribute whitespace"))?
            .0;
        let mut value = "";
        if let Some(tail) = prefix(rest, "=") {
            let tail = whitespace(tail)
                .map_err(|_| lexical_html::Error::InvalidExport("attribute value whitespace"))?
                .0;
            let (tail, parsed) = value_input(tail)
                .map_err(|_| lexical_html::Error::InvalidExport("attribute value"))?;
            rest = tail;
            value = parsed;
        }
        if key != "__proto__" && !attributes.iter().any(|(name, _)| name == key) {
            attributes.push((key.into(), super::entities::decode(value, true)?));
        }
    }
}
pub(super) fn directive_name(input: &str) -> lexical_html::Result<(&str, &str)> {
    take_till::<_, _, nom::error::Error<_>>(|ch: char| ch.is_whitespace() || ch == '/')
        .parse(input)
        .map_err(|_| lexical_html::Error::InvalidExport("directive name"))
}
