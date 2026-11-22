//! Tokenize raw pasted text using Lexical's CRLF, LF and tab boundaries.
use crate::*;
use nom::{
    IResult, Parser,
    branch::alt,
    bytes::complete::{tag, take_while1},
    combinator::{not, peek, recognize, value},
    multi::many1,
};
/// One detached-node token from raw text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RawTextToken<'text> {
    /// A CRLF or LF boundary.
    LineBreak,
    /// A tab character.
    Tab,
    /// A nonempty text fragment.
    Text(&'text str),
}
fn token(input: &str) -> IResult<&str, RawTextToken<'_>> {
    alt((
        value(RawTextToken::LineBreak, alt((tag("\r\n"), tag("\n")))),
        value(RawTextToken::Tab, tag("\t")),
        recognize(many1(alt((
            take_while1(|c| !matches!(c, '\r' | '\n' | '\t')),
            recognize((tag("\r"), not(peek(tag("\n"))))),
        ))))
        .map(RawTextToken::Text),
    ))
    .parse(input)
}
/// Split CRLF/LF/tab tokens without allocating or emitting empty text fragments.
pub fn tokenize_raw_text(mut text: &str) -> impl Iterator<Item = RawTextToken<'_>> {
    std::iter::from_fn(move || {
        if text.is_empty() {
            return None;
        }
        let (remaining, token) = token(text).ok()?;
        text = remaining;
        Some(token)
    })
}
impl Transaction<'_> {
    /// Create detached Text, LineBreak and Tab nodes from raw text.
    pub fn nodes_from_raw_text(&mut self, text: &str) -> Result<Vec<NodeKey>, Error> {
        tokenize_raw_text(text)
            .map(|token| match token {
                RawTextToken::Text(text) => Ok(self.create_text(text)?.key()),
                RawTextToken::LineBreak => Ok(self.create(LineBreak::default())?.key()),
                RawTextToken::Tab => Ok(self.create(Tab::default())?.key()),
            })
            .collect()
    }
}
