//! Whether a row's current text still matches a search, and the passage
//! shown for it.
//!
//! The index proposes rows from text that may be stale, so a row is shown
//! only when the text read from Postgres for this search matches every term,
//! and its snippet is cut from that text. Words are runs of letters and
//! digits compared case-insensitively, as the index's standard analyzer
//! splits them closely enough that a difference only ever costs a hit, never
//! shows text the row no longer holds.

use std::ops::Range;

#[cfg(test)]
mod test;

/// Characters of a cell shown around its first match.
const SNIPPET_CHARS: usize = 200;

/// Characters kept before the first match, so it is read in context.
const SNIPPET_LEAD_CHARS: usize = 60;

const OPEN_TAG: &str = "<macro_em>";
const CLOSE_TAG: &str = "</macro_em>";

/// How a search's terms match a row's words.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RowMatchType {
    /// Every word of a term in order, the last one as a prefix.
    Partial,
    /// Every word of a term in order, each whole.
    Exact,
}

/// The terms of one search, each split into lowercased words. A row matches
/// when every term matches inside one of its texts.
#[derive(Debug, Clone)]
pub(crate) struct RowQuery {
    terms: Vec<Vec<String>>,
    match_type: RowMatchType,
}

/// One word of a text: where it sits, in characters, and its lowercased form.
struct Word {
    chars: Range<usize>,
    lowercase: String,
}

fn words(text: &str) -> Vec<Word> {
    let mut words = Vec::new();
    let mut current: Option<(usize, String)> = None;
    for (index, c) in text.chars().enumerate() {
        if c.is_alphanumeric() {
            current
                .get_or_insert_with(|| (index, String::new()))
                .1
                .extend(c.to_lowercase());
        } else if let Some((start, lowercase)) = current.take() {
            words.push(Word {
                chars: start..index,
                lowercase,
            });
        }
    }
    if let Some((start, lowercase)) = current {
        words.push(Word {
            chars: start..text.chars().count(),
            lowercase,
        });
    }
    words
}

/// `text` with any highlight tags it holds broken by an invisible word
/// joiner, so a cell that says `<macro_em>` shows those characters rather
/// than a highlight.
fn literal_tags(text: &str) -> String {
    text.replace(OPEN_TAG, "<\u{2060}macro_em>")
        .replace(CLOSE_TAG, "<\u{2060}/macro_em>")
}

impl RowQuery {
    /// A query of `terms`, dropping terms with no word in them. `None` when
    /// none is left: such a query matches no row.
    pub(crate) fn new(terms: &[String], match_type: RowMatchType) -> Option<Self> {
        let terms: Vec<Vec<String>> = terms
            .iter()
            .map(|term| words(term).into_iter().map(|word| word.lowercase).collect())
            .filter(|words: &Vec<String>| !words.is_empty())
            .collect();
        (!terms.is_empty()).then_some(Self { terms, match_type })
    }

    /// How the query's terms match.
    pub(crate) fn match_type(&self) -> RowMatchType {
        self.match_type
    }

    /// The character ranges in `text_words` where `term` matches.
    fn term_matches(&self, term: &[String], text_words: &[Word]) -> Vec<Range<usize>> {
        let Some((last, leading)) = term.split_last() else {
            return Vec::new();
        };
        text_words
            .windows(term.len())
            .filter_map(|window| {
                let (last_word, leading_words) = window.split_last()?;
                let leading_match = leading
                    .iter()
                    .zip(leading_words)
                    .all(|(word, text_word)| *word == text_word.lowercase);
                let last_match = match self.match_type {
                    RowMatchType::Partial => last_word.lowercase.starts_with(last.as_str()),
                    RowMatchType::Exact => last_word.lowercase == *last,
                };
                let first_word = window.first()?;
                (leading_match && last_match).then_some(first_word.chars.start..last_word.chars.end)
            })
            .collect()
    }

    /// Whether every term matches inside one of `texts`.
    pub(crate) fn matches<'a>(&self, texts: impl IntoIterator<Item = &'a str>) -> bool {
        let texts: Vec<Vec<Word>> = texts.into_iter().map(words).collect();
        self.terms.iter().all(|term| {
            texts
                .iter()
                .any(|text_words| !self.term_matches(term, text_words).is_empty())
        })
    }

    /// The passage of `text` around its first match, every matched word in it
    /// wrapped in highlight tags. `None` when no term matches `text`.
    pub(crate) fn snippet(&self, text: &str) -> Option<String> {
        let text = &literal_tags(text);
        let text_words = words(text);
        let mut highlighted: Vec<Range<usize>> = self
            .terms
            .iter()
            .flat_map(|term| self.term_matches(term, &text_words))
            .collect();
        highlighted.sort_by_key(|range| range.start);
        let first = highlighted.first()?.clone();

        let chars: Vec<char> = text.chars().collect();
        let start = first.start.saturating_sub(SNIPPET_LEAD_CHARS);
        let end = (start + SNIPPET_CHARS).min(chars.len()).max(first.end);

        let mut snippet = String::new();
        if start > 0 {
            snippet.push('…');
        }
        let mut position = start;
        for range in highlighted {
            // Matches overlap when two terms match the same words; a match
            // that starts inside one already shown is skipped.
            if range.start < position || range.start >= end {
                continue;
            }
            let range_end = range.end.min(end);
            snippet.extend(chars.get(position..range.start).unwrap_or_default());
            snippet.push_str(OPEN_TAG);
            snippet.extend(chars.get(range.start..range_end).unwrap_or_default());
            snippet.push_str(CLOSE_TAG);
            position = range_end;
        }
        snippet.extend(chars.get(position..end).unwrap_or_default());
        if end < chars.len() {
            snippet.push('…');
        }
        Some(snippet)
    }
}
