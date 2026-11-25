//! The web links a channel message shares, which search indexes apart from
//! its text: every `<m-link>` URL, including one behind a label the text
//! shows instead, and every URL written out as text (pasted bare, in a
//! Markdown link, or inside a paste).

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

/// Every web link in the message `markup`, in the order it shares them and
/// each once, as written.
pub(crate) fn message_links(markup: &str) -> Vec<String> {
    let text = with_pastes_as_content(markup, with_link_urls);
    let found = fold_many0(piece, Vec::<&str>::new, |mut links, piece| {
        if let Some(url) = piece.map(without_closing_punctuation)
            && is_url(url)
            && !links.contains(&url)
        {
            links.push(url);
        }
        links
    })
    .parse(&text);
    match found {
        Ok((_, links)) => links.into_iter().map(str::to_owned).collect(),
        Err(_) => Vec::new(),
    }
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

fn is_url_char(c: char) -> bool {
    !c.is_whitespace()
        && !c.is_control()
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
/// (`https://en.wikipedia.org/wiki/Rust_(language)`).
fn without_closing_punctuation(url: &str) -> &str {
    let mut url = url;
    loop {
        let trimmed = url.trim_end_matches(['.', ',', ';', ':', '!', '?', '\'', '*', '_', '~']);
        let trimmed = match trimmed.strip_suffix(')') {
            Some(inner) if trimmed.matches(')').count() > trimmed.matches('(').count() => inner,
            _ => trimmed,
        };
        if trimmed.len() == url.len() {
            return url;
        }
        url = trimmed;
    }
}

#[cfg(test)]
mod test;
