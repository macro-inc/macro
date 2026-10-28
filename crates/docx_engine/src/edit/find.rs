//! Searching the body's text, for the find bar and its replace commands.
//!
//! A search runs over each paragraph's visible text: field codes, deleted
//! and hidden text are left out, and objects (pictures, field markers,
//! breaks) are barriers no match crosses. Straight and typographic quotes
//! match each other, as do ordinary and non-breaking spaces, so a search
//! typed on a keyboard finds the text a word processor wrote.

use super::revise;
use super::{PageRect, Pos};
use crate::model::block::{BlockId, Story};
use crate::model::content::Attrs;
use serde::{Deserialize, Serialize};

/// How a search compares text.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FindOptions {
    /// Upper and lower case must match.
    pub match_case: bool,
    /// Matches must be whole words.
    pub whole_word: bool,
}

/// One match: its ends and highlight rectangles.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct FindMatch {
    /// The start.
    pub from: Pos,
    /// The end.
    pub to: Pos,
    /// Where it is on the pages.
    pub rects: Vec<PageRect>,
}

/// The matches of a search, in document order.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct FindResult {
    /// The matches.
    pub matches: Vec<FindMatch>,
    /// The match at the selection, or the first one after it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<usize>,
    /// Whether the search stopped at [`LIMIT`] matches.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
}

/// The most matches a search returns.
pub const LIMIT: usize = 10_000;

/// Stands in for an object: never matches and is not part of a word.
const BARRIER: char = '\u{FFFC}';

/// A character as searches compare it.
fn fold(c: char, match_case: bool) -> char {
    let c = match c {
        '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}' | '\u{2032}' => '\'',
        '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}' | '\u{2033}' => '"',
        '\u{00A0}' | '\u{2007}' | '\u{202F}' => ' ',
        c => c,
    };
    if match_case {
        return c;
    }
    let mut lower = c.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(l), None) => l,
        _ => c,
    }
}

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Text left out of searches: hidden runs and deleted text.
fn skipped(attrs: &Attrs) -> bool {
    if attrs.is_instr() {
        return true;
    }
    let hidden = attrs
        .run_props()
        .any(|(q, v)| q.ends_with("vanish") && !v.contains("\"0\"") && !v.contains("\"false\""));
    hidden || attrs.wrappers().iter().any(revise::is_deleted)
}

/// A paragraph's searchable characters with the UTF-16 range each covers.
struct Searchable {
    chars: Vec<char>,
    starts: Vec<usize>,
    ends: Vec<usize>,
}

fn searchable(story: &Story, id: &BlockId, match_case: bool) -> Option<Searchable> {
    let block = story.get(id)?;
    let mut out = Searchable {
        chars: Vec::new(),
        starts: Vec::new(),
        ends: Vec::new(),
    };
    for (at, span) in block.content.spans_at() {
        let object = span.attrs.is_object();
        if !object && skipped(&span.attrs) {
            continue;
        }
        let mut offset = at;
        for c in span.text.chars() {
            let len = c.len_utf16();
            out.chars
                .push(if object { BARRIER } else { fold(c, match_case) });
            out.starts.push(offset);
            out.ends.push(offset + len);
            offset += len;
        }
    }
    Some(out)
}

/// The matches of `query` in the paragraphs, in order, up to `limit`
/// (the second value says whether the limit cut the search short).
pub(crate) fn find(
    story: &Story,
    paragraphs: &[BlockId],
    query: &str,
    options: &FindOptions,
    limit: usize,
) -> (Vec<(Pos, Pos)>, bool) {
    let query: Vec<char> = query.chars().map(|c| fold(c, options.match_case)).collect();
    let mut out = Vec::new();
    if query.is_empty() {
        return (out, false);
    }
    let first = query[0];
    for id in paragraphs {
        let Some(text) = searchable(story, id, options.match_case) else {
            continue;
        };
        let chars = &text.chars;
        let mut i = 0;
        while i + query.len() <= chars.len() {
            let end = i + query.len();
            let found = chars[i] == first
                && chars[i..end] == query[..]
                && (!options.whole_word
                    || (i.checked_sub(1).is_none_or(|b| !is_word(chars[b]))
                        && chars.get(end).is_none_or(|&c| !is_word(c))));
            if !found {
                i += 1;
                continue;
            }
            if out.len() == limit {
                return (out, true);
            }
            out.push((
                Pos::new(id.clone(), text.starts[i]),
                Pos::new(id.clone(), text.ends[end - 1]),
            ));
            i = end;
        }
    }
    (out, false)
}

#[cfg(test)]
mod test;
