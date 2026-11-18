//! Searchable text of messages: channel messages and agent-session prompts and
//! replies. Their chip markup is written out by a flattener the caller picks;
//! a paste (a long pasted text or a quoted reply) is written as its content,
//! which `mention_utils`' formatter would drop with the tags it does not know.

use nom::{
    IResult, Parser,
    branch::alt,
    bytes::complete::{tag, take_until},
    combinator::{consumed, recognize, rest, verify},
    multi::many0,
    sequence::delimited,
};

const PASTE_OPEN: &str = "<m-paste>";
const PASTE_CLOSE: &str = "</m-paste>";

/// `text` with each paste written as its content and the markup around the
/// pastes through `flatten`. A paste whose JSON does not parse is kept as
/// written, and so is everything from an opener with no closer.
pub(crate) fn with_pastes_as_content(text: &str, flatten: impl Fn(&str) -> String) -> String {
    let Ok((_, pieces)) = many0(piece).parse(text) else {
        return flatten(text);
    };
    pieces
        .into_iter()
        .map(|piece| match piece {
            Piece::Markup(markup) => flatten(markup),
            Piece::Paste(content) => content,
            Piece::AsWritten(text) => text.to_owned(),
        })
        .collect()
}

enum Piece<'a> {
    Markup(&'a str),
    Paste(String),
    /// A paste whose JSON does not parse, or an opener with no closer and
    /// everything after it.
    AsWritten(&'a str),
}

/// A paste, or the markup up to the next one. Once an opener has no closer,
/// no later paste is complete either, so the rest is kept as written instead
/// of searching for a closer again from every later opener.
fn piece(input: &str) -> IResult<&str, Piece<'_>> {
    alt((
        paste,
        recognize((tag(PASTE_OPEN), rest)).map(Piece::AsWritten),
        verify(alt((take_until(PASTE_OPEN), rest)), |markup: &str| {
            !markup.is_empty()
        })
        .map(Piece::Markup),
    ))
    .parse(input)
}

#[derive(serde::Deserialize)]
struct Paste {
    content: String,
}

/// `<m-paste>{"content": ...}</m-paste>`. The editor escapes `<` and `>` in
/// the JSON, so the first closing tag ends it.
fn paste(input: &str) -> IResult<&str, Piece<'_>> {
    consumed(delimited(
        tag(PASTE_OPEN),
        take_until(PASTE_CLOSE),
        tag(PASTE_CLOSE),
    ))
    .map(
        |(block, json): (&str, &str)| match serde_json::from_str::<Paste>(json) {
            Ok(paste) => Piece::Paste(paste.content),
            Err(_) => Piece::AsWritten(block),
        },
    )
    .parse(input)
}

#[cfg(test)]
mod test;
