//! This module contains the logic for generating queries using terms

use std::borrow::Cow;

use crate::{Result, error::OpensearchClientError};

use opensearch_query_builder::*;
use unicode_segmentation::UnicodeSegmentation;

/// Containing keys for the title and content fields
pub struct Keys<'a> {
    /// The title field key
    pub title_key: &'a str,
    /// The content field key
    pub content_key: &'a str,
}

/// The different types of ways we can match terms
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum QueryKey {
    /// Match phrase
    MatchPhrase,
    /// Match phrase prefix
    MatchPhrasePrefix,
    /// Regexp
    Regexp,
}

const MATCH_PHRASE_PREFIX_MAX_EXPANSIONS: u32 = 256;

pub(crate) struct CreateQueryParams<'a> {
    /// The query key to use
    pub query_key: QueryKey,
    /// The field to search on
    pub field: &'a str,
    /// The term to search for
    pub term: &'a str,
}

/// Creates a query for a given term. A partial term that is one word of at
/// least [`MIN_PREFIX_LEN`] characters matches as an uncapped prefix
/// ([`single_word_prefix`]); any other partial term, a shorter word or several
/// words, stays a `match_phrase_prefix` that expands to only the first
/// `max_expansions` terms of a shard.
pub(crate) fn create_query<'a>(params: CreateQueryParams<'a>) -> QueryType<'a> {
    let CreateQueryParams {
        query_key,
        field,
        term,
    } = params;

    match query_key {
        QueryKey::MatchPhrase => {
            QueryType::MatchPhrase(MatchPhraseQuery::new(field.to_string(), term.to_string()))
        }
        QueryKey::MatchPhrasePrefix => single_word_prefix(field, term).unwrap_or_else(|| {
            QueryType::MatchPhrasePrefix(
                MatchPhrasePrefixQuery::new(field.to_string(), term.to_string())
                    .max_expansions(MATCH_PHRASE_PREFIX_MAX_EXPANSIONS),
            )
        }),
        QueryKey::Regexp => {
            QueryType::Regexp(RegexpQuery::new(field.to_string(), term.to_string()))
        }
    }
}

/// Fewest characters a word needs before it matches as an uncapped prefix,
/// and a content term before it matches as a prefix at all. Shorter prefixes
/// expand to too many tokens.
const MIN_PREFIX_LEN: usize = 3;

/// The standard tokenizer's longest token, in UTF-16 units; it splits a
/// longer word into several tokens.
const MAX_TOKEN_LEN: usize = 255;

/// The one word of a term the analyzer reads as a single token. The standard
/// tokenizer, which every field these queries search uses, splits words at
/// the Unicode (UAX #29) boundaries `unicode_words` finds: `con.`, `naïve`,
/// `o'brien` and `node.js` are one word, `c++` is the word `c`, and `e-mail`,
/// `東京` and `gab@macro.com` are several. They disagree on what surrounds a
/// word (the tokenizer keeps an emoji as a token, `unicode_words` drops it) and
/// on scripts written without spaces (a Thai run is one token and many
/// words), and UAX #29 keeps an emoji joined to a word by a zero-width joiner
/// in it. So a word counts only when it holds nothing but letters, digits,
/// combining marks (a decomposed `é`), ASCII punctuation and `’`, has nothing
/// but ASCII punctuation around it, and fits in one token.
pub(crate) fn single_word(term: &str) -> Option<&str> {
    let mut words = term.unicode_word_indices();
    let (start, word) = words.next()?;
    if words.next().is_some() {
        return None;
    }

    let letters_and_digits = word.chars().all(|c| {
        c.is_alphanumeric()
            || c.is_ascii_punctuation()
            || c == '’'
            || matches!(c, '\u{0300}'..='\u{036F}' | '\u{1AB0}'..='\u{1AFF}' | '\u{1DC0}'..='\u{1DFF}' | '\u{20D0}'..='\u{20FF}' | '\u{FE20}'..='\u{FE2F}')
    });
    let mut around = term[..start]
        .chars()
        .chain(term[start + word.len()..].chars());
    let only_punctuation = around.all(|c| c.is_ascii_punctuation());
    let one_token = word.encode_utf16().count() <= MAX_TOKEN_LEN;
    (letters_and_digits && only_punctuation && one_token).then_some(word)
}

/// A prefix query over every token of `field` that starts with `term`'s one
/// word, when the term is one word of at least [`MIN_PREFIX_LEN`] characters.
/// `match_phrase_prefix` keeps only the first `max_expansions` terms of a
/// shard that start with the prefix, before any filter, and silently drops
/// the matches past them; OpenSearch also expands it again for every inner hit
/// of every returned parent. `match_bool_prefix` of one token is a prefix
/// query, which expands lazily, keeps every match and scores as a constant.
///
/// It is given the word, not the term: `match_bool_prefix` reads a last token
/// followed by other characters as finished, so `con.` would match only the
/// word `con`.
fn single_word_prefix<'a>(field: &str, term: &str) -> Option<QueryType<'a>> {
    let word = single_word(term)?;
    if word.chars().count() < MIN_PREFIX_LEN {
        return None;
    }
    Some(QueryType::MatchBoolPrefix(MatchBoolPrefixQuery::new(
        field.to_string(),
        word.to_string(),
    )))
}

/// Builds the per-term query a `has_child` clause runs against children's
/// `content`.
///
/// - `exact` match type or a quoted phrase (term with whitespace) →
///   `match_phrase`.
/// - One word → an uncapped prefix ([`single_word_prefix`]), or
///   `match_phrase` when the word is shorter than [`MIN_PREFIX_LEN`]: `c++`
///   is the one-character word `c`, so it matches `C++` and not every word
///   starting with `c`.
/// - Several words (`e-mail`, CJK text) → `match_phrase` when the term is
///   shorter than [`MIN_PREFIX_LEN`], else `match_phrase_prefix`, which keeps
///   the words adjacent but expands the last one to only the first
///   `max_expansions` terms of a shard. OpenSearch has no phrase prefix that
///   expands every match.
///
/// Children matched by a prefix score as a constant, so inner hits come back
/// in index order.
pub(crate) fn child_content_query<'a>(term: &str, match_type: &str) -> QueryType<'a> {
    let phrase = || QueryType::MatchPhrase(MatchPhraseQuery::new("content", term.to_string()));
    if match_type == "exact" || term.chars().any(char::is_whitespace) {
        return phrase();
    }

    if single_word(term).is_some() {
        return single_word_prefix("content", term).unwrap_or_else(phrase);
    }

    if term.chars().count() < MIN_PREFIX_LEN {
        return phrase();
    }
    QueryType::MatchPhrasePrefix(
        MatchPhrasePrefixQuery::new("content", term.to_string())
            .max_expansions(MATCH_PHRASE_PREFIX_MAX_EXPANSIONS),
    )
}

impl QueryKey {
    /// Creates a query key given a match type
    pub fn from_match_type(match_type: &str) -> Result<Self> {
        match match_type {
            "exact" => Ok(Self::MatchPhrase),
            "partial" => Ok(Self::MatchPhrasePrefix),
            "regexp" => Ok(Self::Regexp),
            _ => Err(OpensearchClientError::InvalidMatchType {
                match_type: match_type.to_string(),
            }),
        }
    }
}

/// How multi-term content queries combine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TermCombine {
    #[default]
    And,
}

/// Generate the terms for the "must" query — each term becomes its own
/// `match_*` clause and the clauses are combined per `combine`.
pub(crate) fn generate_terms_must_query<'a>(
    query_key: QueryKey,
    field: &'a str,
    terms: impl Into<Cow<'a, [&'a str]>>,
    combine: TermCombine,
) -> QueryType<'a> {
    generate_terms_must_query_for_fields(query_key, &[field], terms, combine)
}

/// Each term must match at least one field on the same document.
pub(crate) fn generate_terms_must_query_for_fields<'a>(
    query_key: QueryKey,
    fields: &[&'a str],
    terms: impl Into<Cow<'a, [&'a str]>>,
    combine: TermCombine,
) -> QueryType<'a> {
    let terms = terms.into();

    let queries: Vec<_> = terms
        .iter()
        .map(|term| {
            let mut alternatives = BoolQueryBuilder::new();
            alternatives.minimum_should_match(1);
            for field in fields {
                let query = create_query(CreateQueryParams {
                    query_key,
                    field,
                    term,
                });
                if fields.len() == 1 {
                    return query;
                }
                alternatives.should(query);
            }
            alternatives.build().into()
        })
        .collect();

    if queries.len() == 1 {
        return queries[0].clone();
    }

    let mut bool_query = BoolQueryBuilder::new();
    match combine {
        TermCombine::And => {
            for query in queries {
                bool_query.must(query);
            }
        }
    }

    bool_query.build().into()
}

#[cfg(test)]
mod test;
