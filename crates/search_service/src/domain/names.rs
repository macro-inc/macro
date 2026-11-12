//! Name lookup: the items of every kind the viewer can access whose name is a
//! given name. Each kind is a [`NameSource`]; the lookup asks every source the
//! names concern at once, then ranks each name's matches, exact ones first.

use std::{collections::HashSet, sync::Arc, time::Duration};

use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use macro_user_id::user_id::MacroUserIdStr;
use models_search::names::{
    MAX_EXACT_MATCHES, MAX_NAME_CHARS, MAX_NAMES, MAX_NEAR_MATCHES, NameKind, NameMatch,
    NameResult, NameSearchRequest, NameSearchResponse, NamedItem,
};
use tracing::Instrument;

#[cfg(test)]
mod test;

/// How long one source may take before its kinds are reported unavailable.
pub const SOURCE_TIMEOUT: Duration = Duration::from_secs(3);

/// Who is looking names up.
#[derive(Clone, Debug)]
pub struct NameViewer {
    /// The user whose access bounds the lookup.
    pub user: MacroUserIdStr<'static>,
    /// Their team membership, when they are on a team; team tags and channel
    /// labels need it.
    pub team: Option<EntityAccessReceipt<MemberTeamRole>>,
}

/// A name as compared: trimmed, without one leading `#` or `@`, with runs of
/// space as one space, and lowercase.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Needle(String);

impl Needle {
    /// The needle for `name`, or `None` when nothing is left of it.
    pub fn parse(name: &str) -> Option<Self> {
        let normalized = normalize(name);
        (!normalized.is_empty()).then_some(Self(normalized))
    }

    /// The normalized name.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// How `candidate` matches: exact when its name or an alias is this name,
    /// near when its name or an alias contains it.
    fn compare(&self, candidate: &Candidate) -> Option<Closeness> {
        let names = std::iter::once(&candidate.name).chain(&candidate.aliases);
        let mut closeness = None;
        for name in names {
            let name = normalize(name);
            if name == self.0 {
                return Some(Closeness::Exact);
            }
            if name.starts_with(&self.0) {
                closeness = Some(Closeness::Prefix);
            } else if closeness.is_none() && name.contains(&self.0) {
                closeness = Some(Closeness::Contains);
            }
        }
        closeness
    }
}

fn normalize(name: &str) -> String {
    let trimmed = name.trim();
    let unprefixed = trimmed.strip_prefix(['#', '@']).unwrap_or(trimmed);
    unprefixed
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// How well a candidate matches a needle, best first.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Closeness {
    Exact,
    Prefix,
    Contains,
}

/// An item a source found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    /// The item.
    pub item: NamedItem,
    /// Its name as stored.
    pub name: String,
    /// Other names it answers to, such as a person's first name and email
    /// address.
    pub aliases: Vec<String>,
}

/// Why a source couldn't look.
#[derive(Debug, thiserror::Error)]
pub enum NameSourceError {
    /// The source's store failed.
    #[error("the name source failed")]
    Internal(rootcause::Report),
}

/// Where the items of some kinds are found by name.
///
/// Object-safe, hence `async_trait`: the lookup holds sources of different
/// types side by side.
#[async_trait::async_trait]
pub trait NameSource: Send + Sync {
    /// The kinds of item this source finds.
    fn kinds(&self) -> &'static [NameKind];

    /// The items the viewer can access whose name contains one of `needles`,
    /// ignoring case, of the given kinds (a subset of [`Self::kinds`]). It may
    /// return items that match none; the lookup drops them.
    async fn find(
        &self,
        viewer: &NameViewer,
        kinds: &[NameKind],
        needles: &[Needle],
    ) -> Result<Vec<Candidate>, NameSourceError>;
}

/// Why a lookup was refused.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum NameLookupError {
    /// No names were asked for.
    #[error("no names to look up")]
    NoNames,
    /// More than [`MAX_NAMES`] names were asked for.
    #[error("at most {MAX_NAMES} names can be looked up at once")]
    TooManyNames,
    /// A name is empty once its leading `#` or `@` is dropped.
    #[error("name {0} is empty")]
    EmptyName(usize),
    /// A name is longer than [`MAX_NAME_CHARS`].
    #[error("name {0} is longer than {MAX_NAME_CHARS} characters")]
    NameTooLong(usize),
}

/// Looks names up across every source at once.
#[derive(Clone)]
pub struct NameLookup {
    sources: Vec<Arc<dyn NameSource>>,
    timeout: Duration,
}

/// One name to look up, parsed.
struct Query {
    name: String,
    needle: Needle,
    kinds: HashSet<NameKind>,
}

impl NameLookup {
    /// A lookup over `sources`, giving each [`SOURCE_TIMEOUT`].
    pub fn new(sources: Vec<Arc<dyn NameSource>>) -> Self {
        Self {
            sources,
            timeout: SOURCE_TIMEOUT,
        }
    }

    /// The same lookup, giving each source `timeout`.
    pub fn with_timeout(self, timeout: Duration) -> Self {
        Self { timeout, ..self }
    }

    /// Each name's matches, in the order asked.
    #[tracing::instrument(
        name = "search.names",
        skip_all,
        fields(
            names = request.names.len(),
            sources = tracing::field::Empty,
            exact_matches = tracing::field::Empty,
            near_matches = tracing::field::Empty,
            unavailable = tracing::field::Empty,
        ),
        err
    )]
    pub async fn lookup(
        &self,
        viewer: &NameViewer,
        request: NameSearchRequest,
    ) -> Result<NameSearchResponse, NameLookupError> {
        let queries = parse(request)?;

        let asks: Vec<_> = self
            .sources
            .iter()
            .filter_map(|source| {
                let kinds: Vec<NameKind> = source
                    .kinds()
                    .iter()
                    .copied()
                    .filter(|kind| queries.iter().any(|query| query.kinds.contains(kind)))
                    .collect();
                if kinds.is_empty() {
                    return None;
                }
                let mut needles: Vec<Needle> = Vec::new();
                for query in &queries {
                    if kinds.iter().any(|kind| query.kinds.contains(kind))
                        && !needles.contains(&query.needle)
                    {
                        needles.push(query.needle.clone());
                    }
                }
                Some((source.clone(), kinds, needles))
            })
            .collect();
        let span = tracing::Span::current();
        span.record("sources", asks.len());

        let found = futures::future::join_all(asks.into_iter().map(
            |(source, kinds, needles)| async move {
                let span = tracing::info_span!(
                    "search.names.source",
                    kinds = ?kinds,
                    needles = needles.len(),
                    candidates = tracing::field::Empty,
                    outcome = tracing::field::Empty,
                );
                let result =
                    tokio::time::timeout(self.timeout, source.find(viewer, &kinds, &needles))
                        .instrument(span.clone())
                        .await;
                let candidates = match result {
                    Ok(Ok(candidates)) => {
                        span.record("candidates", candidates.len());
                        span.record("outcome", "ok");
                        Some(candidates)
                    }
                    Ok(Err(error)) => {
                        span.record("outcome", "error");
                        tracing::warn!(parent: &span, error = ?error, kinds = ?kinds, "name source failed");
                        None
                    }
                    Err(_) => {
                        span.record("outcome", "timeout");
                        tracing::warn!(parent: &span, kinds = ?kinds, "name source timed out");
                        None
                    }
                };
                (kinds, candidates)
            },
        ))
        .await;

        let mut candidates = Vec::new();
        let mut unavailable = Vec::new();
        for (kinds, found) in found {
            match found {
                Some(found) => candidates.extend(found),
                None => unavailable.extend(kinds),
            }
        }
        unavailable.sort();
        unavailable.dedup();

        let results: Vec<NameResult> = queries
            .iter()
            .map(|query| rank(query, &candidates))
            .collect();
        let exact: usize = results
            .iter()
            .map(|result| result.matches.iter().filter(|m| m.exact).count())
            .sum();
        let near: usize = results
            .iter()
            .map(|result| result.matches.iter().filter(|m| !m.exact).count())
            .sum();
        span.record("exact_matches", exact);
        span.record("near_matches", near);
        span.record("unavailable", unavailable.len());

        Ok(NameSearchResponse {
            results,
            unavailable,
        })
    }
}

fn parse(request: NameSearchRequest) -> Result<Vec<Query>, NameLookupError> {
    if request.names.is_empty() {
        return Err(NameLookupError::NoNames);
    }
    if request.names.len() > MAX_NAMES {
        return Err(NameLookupError::TooManyNames);
    }
    request
        .names
        .into_iter()
        .enumerate()
        .map(|(index, query)| {
            if query.name.chars().count() > MAX_NAME_CHARS {
                return Err(NameLookupError::NameTooLong(index));
            }
            let needle = Needle::parse(&query.name).ok_or(NameLookupError::EmptyName(index))?;
            let kinds = if query.kinds.is_empty() {
                <NameKind as strum::IntoEnumIterator>::iter().collect()
            } else {
                query.kinds.into_iter().collect()
            };
            Ok(Query {
                name: query.name,
                needle,
                kinds,
            })
        })
        .collect()
}

/// One name's matches: exact ones first, then the closest near ones, each
/// item once.
fn rank(query: &Query, candidates: &[Candidate]) -> NameResult {
    let mut seen = HashSet::new();
    let mut ranked: Vec<(Closeness, &Candidate)> = candidates
        .iter()
        .filter(|candidate| query.kinds.contains(&candidate.item.kind()))
        .filter_map(|candidate| Some((query.needle.compare(candidate)?, candidate)))
        .collect();
    ranked.sort_by(|(a, left), (b, right)| {
        a.cmp(b)
            .then_with(|| left.name.chars().count().cmp(&right.name.chars().count()))
            .then_with(|| left.item.kind().cmp(&right.item.kind()))
            .then_with(|| left.name.cmp(&right.name))
    });
    let mut exact = 0;
    let mut near = 0;
    let mut matches = Vec::new();
    for (closeness, candidate) in ranked {
        if !seen.insert(&candidate.item) {
            continue;
        }
        let is_exact = closeness == Closeness::Exact;
        let count = if is_exact { &mut exact } else { &mut near };
        let limit = if is_exact {
            MAX_EXACT_MATCHES
        } else {
            MAX_NEAR_MATCHES
        };
        if *count == limit {
            continue;
        }
        *count += 1;
        matches.push(NameMatch {
            name: candidate.name.clone(),
            exact: is_exact,
            item: candidate.item.clone(),
        });
    }
    NameResult {
        name: query.name.clone(),
        matches,
    }
}
