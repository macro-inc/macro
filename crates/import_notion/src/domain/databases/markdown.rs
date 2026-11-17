//! Tokenizing enhanced markdown without treating code samples as placements.

use std::collections::HashMap;

use lazy_regex::regex;
use nom::branch::alt;
use nom::bytes::complete::{tag, take_until, take_while_m_n, take_while1};
use nom::character::complete::{
    anychar, char, line_ending, multispace0, multispace1, not_line_ending, space0,
};
use nom::combinator::{eof, map, rest, value};
use nom::multi::{many_till, many0};
use nom::sequence::{delimited, preceded, terminated};
use nom::{IResult, Parser};

use super::{DatabaseOccurrence, OccurrenceKey};
use crate::domain::model::NotionId;

#[derive(Clone)]
struct DatabaseTag<'a> {
    attributes: Vec<(&'a str, &'a str)>,
    title: &'a str,
}

pub(super) fn occurrences(markdown: &str) -> Vec<DatabaseOccurrence> {
    let mut input = markdown;
    let mut ordinals: HashMap<NotionId, usize> = HashMap::new();
    let mut occurrences = Vec::new();
    while !input.is_empty() {
        let start = markdown.len() - input.len();
        let Ok((remaining, parsed)) = token(input) else {
            break;
        };
        input = remaining;
        let Some(parsed) = parsed else { continue };
        let attributes: HashMap<_, _> = parsed.attributes.into_iter().collect();
        let url = attributes.get("url").map(|url| (*url).to_owned());
        let key = url
            .as_deref()
            .and_then(NotionId::parse)
            .map(|container_id| {
                let next = ordinals.entry(container_id.clone()).or_default();
                let key = OccurrenceKey {
                    container_id,
                    ordinal: *next,
                };
                *next += 1;
                key
            });
        let view_id = url.as_deref().and_then(|url| {
            // Notion's explicit view parameter is separate from the pathname
            // container id. Fragments are never selected-view evidence.
            let (_, before_fragment) = nom::bytes::complete::take_till::<_, _, nom::error::Error<_>>(|c| c == '#')
                .parse(url).ok()?;
            regex!(r"[?&]v=([0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12})(?:&|$)")
                .captures(before_fragment)
                .and_then(|captures| captures.get(1))
                .and_then(|id| NotionId::parse(id.as_str()))
        });
        let inline = match attributes.get("inline").copied() {
            Some("true") => Some(true),
            Some("false") => Some(false),
            _ => None,
        };
        let title = match parsed.title.trim() {
            "" => "Notion database",
            title => title,
        };
        occurrences.push(DatabaseOccurrence {
            key,
            range: start..markdown.len() - input.len(),
            title: title.to_owned(),
            url,
            view_id,
            inline,
            sources: Vec::new(),
            losses: Vec::new(),
        });
    }
    occurrences
}

fn token(input: &str) -> IResult<&str, Option<DatabaseTag<'_>>> {
    alt((
        value(None, comment),
        value(None, code),
        value(None, (char('\\'), anychar)),
        map(database, Some),
        value(None, anychar),
    ))
    .parse(input)
}

fn comment(input: &str) -> IResult<&str, ()> {
    let (input, _) = tag("<!--").parse(input)?;
    value((), alt((terminated(take_until("-->"), tag("-->")), rest))).parse(input)
}

fn code(input: &str) -> IResult<&str, ()> {
    let (input, marker) = alt((
        take_while1(|c| c == '`'),
        take_while_m_n(3, usize::MAX, |c| c == '~'),
    ))
    .parse(input)?;
    // An unfinished fenced block is code through EOF. An unmatched inline
    // backtick is literal text, so let the ordinary token parser handle it.
    if marker.len() >= 3 {
        let (input, _) = terminated(not_line_ending, alt((line_ending, eof))).parse(input)?;
        let fence_character = if marker.starts_with('`') { '`' } else { '~' };
        let closing = value(
            (),
            (
                space0,
                take_while_m_n(marker.len(), usize::MAX, |c| c == fence_character),
                space0,
                alt((line_ending, eof)),
            ),
        );
        // A closing fence occupies its own line, including in nested blocks.
        // Backticks in a code string cannot end the fenced block.
        value(
            (),
            alt((
                value(
                    (),
                    many_till(terminated(not_line_ending, line_ending), closing),
                ),
                value((), rest),
            )),
        )
        .parse(input)
    } else {
        value((), terminated(take_until(marker), tag(marker))).parse(input)
    }
}

fn database(input: &str) -> IResult<&str, DatabaseTag<'_>> {
    let (input, _) = tag("<database").parse(input)?;
    let (input, attributes) = many0(preceded(multispace1, attribute)).parse(input)?;
    let (input, _) = (multispace0, char('>')).parse(input)?;
    let (input, title) = terminated(take_until("</database>"), tag("</database>")).parse(input)?;
    Ok((input, DatabaseTag { attributes, title }))
}

fn attribute(input: &str) -> IResult<&str, (&str, &str)> {
    let (input, name) =
        take_while1(|c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_').parse(input)?;
    let (input, _) = (multispace0, char('='), multispace0).parse(input)?;
    let (input, value) = alt((
        delimited(char('"'), take_until("\""), char('"')),
        delimited(char('\''), take_until("'"), char('\'')),
    ))
    .parse(input)?;
    Ok((input, (name, value)))
}

#[cfg(test)]
mod test;
