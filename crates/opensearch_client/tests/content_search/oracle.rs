//! The expected answer, computed without the query under test: `_analyze`
//! tokens of every visible part and name, and of every term, with the rules
//! the search builders define applied to them.

use std::collections::{BTreeSet, HashMap, HashSet};

use anyhow::{Context, bail};
use opensearch::{OpenSearch, indices::IndicesAnalyzeParts};
use opensearch_client::search::documents::DocumentTermMatching;
use uuid::Uuid;

use crate::{
    Seeded,
    fixtures::{Case, KINDS, Kind, Mode},
};

/// Lucene's English stop set, which `DocumentTermMatching::Dynamic` leaves
/// out of its count.
const STOPWORDS: [&str; 33] = [
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "if", "in", "into", "is", "it",
    "no", "not", "of", "on", "or", "such", "that", "the", "their", "then", "there", "these",
    "they", "this", "to", "was", "will", "with",
];

/// The field every part's text is indexed in.
const CONTENT_FIELD: &str = "content";

/// The tokens `_analyze` gives each visible part and each visible name, in
/// position order.
pub(crate) struct Oracle {
    parts: HashMap<(Kind, Uuid, String), Vec<String>>,
    names: HashMap<(Kind, Uuid), Vec<String>>,
}

/// What a case should find: the matching entities, and the parts of them a
/// match may point to.
pub(crate) struct Expected {
    pub(crate) entities: BTreeSet<(Kind, Uuid)>,
    pub(crate) parts: HashSet<(Kind, Uuid, String)>,
}

/// One search term as one rule applies it.
struct Term {
    tokens: Vec<String>,
    prefix: bool,
}

impl Oracle {
    pub(crate) async fn new(raw: &OpenSearch, entities: &[Seeded]) -> anyhow::Result<Self> {
        let mut parts = HashMap::new();
        let mut names = HashMap::new();
        for entity in entities.iter().filter(|entity| entity.visible()) {
            for (_, (part_id, content)) in entity.live_parts() {
                let tokens = analyze(raw, entity.kind, CONTENT_FIELD, content).await?;
                parts.insert((entity.kind, entity.id, part_id.clone()), tokens);
            }
            if let Some(field) = entity.kind.title_field() {
                let tokens = analyze(raw, entity.kind, field, &entity.name).await?;
                names.insert((entity.kind, entity.id), tokens);
            }
        }
        Ok(Self { parts, names })
    }

    pub(crate) async fn expected(&self, raw: &OpenSearch, case: &Case) -> anyhow::Result<Expected> {
        let mut expected = Expected {
            entities: BTreeSet::new(),
            parts: HashSet::new(),
        };
        for kind in KINDS {
            match case.mode {
                Mode::Content => self.expect_content(raw, case, kind, &mut expected).await?,
                Mode::Name => self.expect_names(raw, case, kind, &mut expected).await?,
            }
        }
        Ok(expected)
    }

    /// A name search matches an entity whose name every term matches: a
    /// phrase prefix unless the search is exact, whatever the term's length.
    async fn expect_names(
        &self,
        raw: &OpenSearch,
        case: &Case,
        kind: Kind,
        expected: &mut Expected,
    ) -> anyhow::Result<()> {
        let Some(field) = kind.title_field() else {
            return Ok(());
        };
        let mut terms = Vec::new();
        for term in case.terms {
            terms.push(Term {
                tokens: analyze(raw, kind, field, term).await?,
                prefix: case.match_type != "exact",
            });
        }
        for ((name_kind, entity), tokens) in &self.names {
            if *name_kind == kind && terms.iter().all(|term| term.matches(tokens)) {
                expected.entities.insert((kind, *entity));
            }
        }
        Ok(())
    }

    async fn expect_content(
        &self,
        raw: &OpenSearch,
        case: &Case,
        kind: Kind,
        expected: &mut Expected,
    ) -> anyhow::Result<()> {
        let mut all_terms = Vec::new();
        for term in case.terms {
            all_terms.push(content_term(raw, kind, term, case.match_type).await?);
        }
        let passage = match (kind, case.matching) {
            (Kind::Document, DocumentTermMatching::Dynamic) => {
                passage_terms(raw, kind, case).await?
            }
            _ => None,
        };

        let mut parts_by_entity: HashMap<Uuid, Vec<(&String, &Vec<String>)>> = HashMap::new();
        for ((part_kind, entity, part), tokens) in &self.parts {
            if *part_kind == kind {
                parts_by_entity
                    .entry(*entity)
                    .or_default()
                    .push((part, tokens));
            }
        }

        for (entity, parts) in parts_by_entity {
            let matching_parts: Vec<&String> = match &passage {
                // `Dynamic`: one part holds enough of the counted terms.
                Some((terms, required)) => parts
                    .iter()
                    .filter(|(_, tokens)| {
                        let held = terms.iter().filter(|term| term.matches(tokens)).count();
                        held >= *required
                    })
                    .map(|(part, _)| *part)
                    .collect(),
                // `All`: every term matches some part; a match points to a
                // part that holds one of them.
                None => {
                    let every_term_matches = all_terms
                        .iter()
                        .all(|term| parts.iter().any(|(_, tokens)| term.matches(tokens)));
                    if !every_term_matches {
                        continue;
                    }
                    parts
                        .iter()
                        .filter(|(_, tokens)| all_terms.iter().any(|term| term.matches(tokens)))
                        .map(|(part, _)| *part)
                        .collect()
                }
            };
            if matching_parts.is_empty() {
                continue;
            }
            expected.entities.insert((kind, entity));
            for part in matching_parts {
                expected.parts.insert((kind, entity, part.clone()));
            }
        }
        Ok(())
    }
}

/// The per-term rule of every content search. An exact search, or a term
/// holding whitespace (a quoted phrase), matches as a phrase. A term the
/// analyzer reads as one token with nothing but ASCII punctuation around it is
/// a prefix when that token has three or more characters (`c++` is the token
/// `c`, so it is exact). Any other term (several tokens, none, or one inside
/// other characters, such as `「q3」`) is a prefix when the term as typed has
/// three or more characters.
async fn content_term(
    raw: &OpenSearch,
    kind: Kind,
    term: &str,
    match_type: &str,
) -> anyhow::Result<Term> {
    let analyzed = analyze_with_offsets(raw, kind, CONTENT_FIELD, term).await?;
    let one_word = match analyzed.as_slice() {
        [(token, start, end)] if only_ascii_punctuation_around(term, *start, *end) => Some(token),
        _ => None,
    };
    let long_enough = match one_word {
        Some(token) => token.chars().count() >= 3,
        None => term.chars().count() >= 3,
    };
    let prefix = match_type != "exact" && !term.chars().any(char::is_whitespace) && long_enough;
    let tokens = analyzed.into_iter().map(|(token, _, _)| token).collect();
    Ok(Term { tokens, prefix })
}

/// Whether `text` holds nothing but ASCII punctuation outside the token at
/// `start..end`, offsets in UTF-16 units as the analyzer gives them.
fn only_ascii_punctuation_around(text: &str, start: usize, end: usize) -> bool {
    let units: Vec<u16> = text.encode_utf16().collect();
    let (Some(before), Some(after)) = (units.get(..start), units.get(end..)) else {
        return false;
    };
    String::from_utf16_lossy(before)
        .chars()
        .chain(String::from_utf16_lossy(after).chars())
        .all(|c| c.is_ascii_punctuation())
}

/// The terms `DocumentTermMatching::Dynamic` counts and how many of them one
/// part must hold, or `None` when the search keeps `All`: fewer than three
/// terms, or none left to count. Every term but the last is exact; a repeated
/// term counts once; a stopword is not counted unless it is the last term and
/// matches as a prefix. A part must hold all counted terms up to two, three
/// quarters of them (rounded down) beyond that.
async fn passage_terms(
    raw: &OpenSearch,
    kind: Kind,
    case: &Case,
) -> anyhow::Result<Option<(Vec<Term>, usize)>> {
    if case.terms.len() < 3 {
        return Ok(None);
    }
    let mut counted: Vec<String> = Vec::new();
    let mut terms = Vec::new();
    for (position, term) in case.terms.iter().enumerate() {
        let last = position + 1 == case.terms.len();
        let match_type = if last { case.match_type } else { "exact" };
        let term_rule = content_term(raw, kind, term, match_type).await?;
        let lowercase = term.to_lowercase();
        if counted.contains(&lowercase)
            || (STOPWORDS.contains(&lowercase.as_str()) && !term_rule.prefix)
        {
            continue;
        }
        counted.push(lowercase);
        terms.push(term_rule);
    }
    if terms.is_empty() {
        return Ok(None);
    }
    let required = if terms.len() <= 2 {
        terms.len()
    } else {
        terms.len() * 3 / 4
    };
    Ok(Some((terms, required)))
}

impl Term {
    /// A phrase matches tokens holding the term's tokens in order at
    /// consecutive positions. As a prefix, its last token may be the start of
    /// a longer one. A term with no tokens matches nothing.
    fn matches(&self, tokens: &[String]) -> bool {
        let Some((last, leading)) = self.tokens.split_last() else {
            return false;
        };
        tokens.windows(self.tokens.len()).any(|window| {
            let (window_last, window_leading) = (&window[leading.len()], &window[..leading.len()]);
            let last_matches = if self.prefix {
                window_last.starts_with(last.as_str())
            } else {
                window_last == last
            };
            window_leading == leading && last_matches
        })
    }
}

/// The tokens of `text` under the analyzer of `field` in `kind`'s index.
async fn analyze(
    raw: &OpenSearch,
    kind: Kind,
    field: &str,
    text: &str,
) -> anyhow::Result<Vec<String>> {
    let analyzed = analyze_with_offsets(raw, kind, field, text).await?;
    Ok(analyzed.into_iter().map(|(token, _, _)| token).collect())
}

/// [`analyze`], with each token's start and end offset in `text`.
async fn analyze_with_offsets(
    raw: &OpenSearch,
    kind: Kind,
    field: &str,
    text: &str,
) -> anyhow::Result<Vec<(String, usize, usize)>> {
    let body: serde_json::Value = raw
        .indices()
        .analyze(IndicesAnalyzeParts::Index(kind.index().index_name()))
        .body(serde_json::json!({ "field": field, "text": text }))
        .send()
        .await?
        .error_for_status_code()?
        .json()
        .await?;
    let tokens = body["tokens"]
        .as_array()
        .with_context(|| format!("no tokens in {body}"))?;
    let mut ordered = Vec::new();
    for (expected_position, token) in tokens.iter().enumerate() {
        // Phrases compare tokens at consecutive positions; an analyzer that
        // leaves gaps (a stop filter) or stacks tokens needs positions here.
        if token["position"].as_u64() != Some(u64::try_from(expected_position)?) {
            bail!("`{text}` analyzed to tokens at other than consecutive positions: {body}");
        }
        let offsets = (token["start_offset"].as_u64(), token["end_offset"].as_u64());
        let (Some(start), Some(end)) = offsets else {
            bail!("a token without offsets in {body}");
        };
        let token = token["token"]
            .as_str()
            .with_context(|| format!("a token without text in {body}"))?;
        ordered.push((
            token.to_string(),
            usize::try_from(start)?,
            usize::try_from(end)?,
        ));
    }
    Ok(ordered)
}
