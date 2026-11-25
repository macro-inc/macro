//! The web links a channel message shares, which search indexes apart from
//! its text: every `<m-link>` URL, including one behind a label the text
//! shows instead, and every URL written out as text (pasted bare, in a
//! Markdown link, or inside a paste).

use std::collections::HashSet;

use mention_utils::parse::{ParsedXmlText, TextSegment, XmlTag};
use nom::{
    IResult, Parser,
    branch::alt,
    bytes::complete::{tag_no_case, take_while1},
    character::complete::anychar,
    combinator::recognize,
    multi::fold_many0,
};

use super::message_text::with_pastes_as_content;

/// The longest link indexed whole, in bytes; a longer one keeps its start.
/// The `pattern` analyzer, unlike `standard`, never splits a long run of
/// letters and digits, and a token over 32,766 bytes fails the document.
const MAX_LINK_BYTES: usize = 2048;

/// Every web link in the message `markup`, in the order it shares them and
/// each once ([`indexed_link`]).
pub(crate) fn message_links(markup: &str) -> Vec<String> {
    let text = with_pastes_as_content(markup, with_link_urls);
    let found = fold_many0(
        piece,
        || (Vec::new(), HashSet::new()),
        |(mut links, mut seen), piece| {
            if let Some(link) = piece.and_then(indexed_link)
                && seen.insert(link)
            {
                links.push(link);
            }
            (links, seen)
        },
    )
    .parse(&text);
    match found {
        Ok((_, (links, _))) => links.into_iter().map(str::to_owned).collect(),
        Err(_) => Vec::new(),
    }
}

/// The part of a URL found in text that search indexes: as written, up to its
/// query or fragment, which hold parameters and tokens (`?usp=sharing`)
/// rather than words a person remembers, without the punctuation that closes
/// around it, and at most [`MAX_LINK_BYTES`]. `None` when nothing is left
/// after its scheme.
fn indexed_link(url: &str) -> Option<&str> {
    let url = url.split(['?', '#']).next().unwrap_or(url);
    let url = without_closing_punctuation(url);
    let url = url
        .get(..floor_char_boundary(url, MAX_LINK_BYTES))
        .unwrap_or(url);
    is_url(url).then_some(url)
}

/// The largest index at most `index` that starts a character of `text`.
fn floor_char_boundary(text: &str, index: usize) -> usize {
    (0..=index.min(text.len()))
        .rev()
        .find(|&boundary| text.is_char_boundary(boundary))
        .unwrap_or(0)
}

/// `markup` with each `<m-link>` written as its URL and every other tag left
/// out, so its links are found the way URLs in its text are. Markup that does
/// not parse is read as written, where a link tag's URL is still found
/// between its quotes.
fn with_link_urls(markup: &str) -> String {
    let Ok(parsed) = ParsedXmlText::parse(markup) else {
        return markup.to_owned();
    };
    parsed
        .0
        .iter()
        .fold(String::with_capacity(markup.len()), |mut text, segment| {
            match segment {
                TextSegment::Plain(plain) => text.push_str(plain),
                TextSegment::Xml(XmlTag::Link(link)) => {
                    text.push(' ');
                    text.push_str(&link.url);
                    text.push(' ');
                }
                TextSegment::Xml(_) => text.push(' '),
            }
            text
        })
}

/// A URL, or a word or character of text around URLs. A word is read whole,
/// so a URL starts only where a word does (`awww.` is no link).
fn piece(input: &str) -> IResult<&str, Option<&str>> {
    alt((
        url.map(Some),
        take_while1(char::is_alphanumeric).map(|_| None),
        anychar.map(|_| None),
    ))
    .parse(input)
}

/// `http://`, `https://` or `www.` and the characters after it up to the
/// first that text puts around a URL rather than in one.
fn url(input: &str) -> IResult<&str, &str> {
    recognize((
        alt((
            tag_no_case("https://"),
            tag_no_case("http://"),
            tag_no_case("www."),
        )),
        take_while1(is_url_char),
    ))
    .parse(input)
}

/// A URL holds printable ASCII but for the characters text puts around one,
/// and letters and digits of any script; other punctuation (`）`, `”`, `。`)
/// ends it.
fn is_url_char(c: char) -> bool {
    if !c.is_ascii() {
        return c.is_alphanumeric();
    }
    c.is_ascii_graphic()
        && !matches!(
            c,
            '<' | '>' | '"' | '`' | '[' | ']' | '{' | '}' | '|' | '\\' | '^'
        )
}

/// Whether `candidate` is a whole URL with something after its scheme.
fn is_url(candidate: &str) -> bool {
    matches!(url(candidate), Ok((rest, _)) if rest.is_empty())
}

/// A URL without the punctuation of the sentence it ends, or the bracket that
/// closes around it: `(see https://example.com/a).` is
/// `https://example.com/a`, while a bracket the URL opened stays
/// (`https://en.wikipedia.org/wiki/Rust_(language)`). One pass from the end,
/// so a run of closing brackets costs its length.
fn without_closing_punctuation(url: &str) -> &str {
    let mut unopened = url
        .matches(')')
        .count()
        .saturating_sub(url.matches('(').count());
    let mut end = url.len();
    for (index, c) in url.char_indices().rev() {
        match c {
            '.' | ',' | ';' | ':' | '!' | '?' | '\'' | '*' | '_' | '~' => end = index,
            ')' if unopened > 0 => {
                unopened -= 1;
                end = index;
            }
            _ => break,
        }
    }
    url.get(..end).unwrap_or(url)
}

#[cfg(test)]
mod test;
