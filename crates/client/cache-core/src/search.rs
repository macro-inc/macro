//! Compact materialized search projection for normalized cache records.
//!
//! Search documents are disposable derivatives of fully merged records. They
//! deliberately contain no GraphQL payloads, so text search never needs to
//! decode the normalized-record postcard blobs.

use crate::codec::encode_record;
use crate::value::{CacheNumber, CacheValue, EntityKey, Record};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::BTreeSet;
use subsequence_match::{normalize_text as normalize_search_text, subsequence_score};
use thiserror::Error;

mod changes;
mod ranking;
pub(crate) use changes::{collect_search_changes, snapshot_search_fields};
pub(crate) use ranking::SearchRanker;

/// Current compact projection profile used by Quick Access, Cmd-K and entity
/// mention pickers. Profile names are persisted and therefore versioned.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SearchProfile {
    /// First Quick Access projection profile.
    QuickAccessV1,
}

impl SearchProfile {
    /// Stable value persisted in local cache storage.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::QuickAccessV1 => "quick-access-v1",
        }
    }

    /// Finite bucket set used to fan out indexed empty-query browsing.
    pub const fn buckets(self) -> &'static [&'static str] {
        match self {
            Self::QuickAccessV1 => &[
                "channel",
                "dm",
                "person",
                "document",
                "task",
                "snippet",
                "skill",
                "note",
                "chat",
                "project",
                "email",
                "crm_company",
                "crm_contact",
                "initiative",
            ],
        }
    }
}

/// Exclusive browse cursor ordered by recency and then entity key.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCursor {
    /// Timestamp of the last returned document.
    pub timestamp_ms: i64,
    /// Entity key of the last returned document.
    pub record_key: EntityKey<'static>,
}

/// One compact, transport-neutral search document.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchDocument {
    /// Projection profile which produced this row.
    pub profile: SearchProfile,
    /// Key used to fetch/project the full normalized record only after search.
    pub record_key: EntityKey<'static>,
    /// Quick Access bucket (document, note, task, channel, person, ...).
    pub bucket: String,
    /// Lower-cased, whitespace-normalized text used by fuzzy matching.
    pub search_text: String,
    /// Viewed-first recency for Soup entities; activity recency for other rows.
    pub timestamp_ms: i64,
    /// Compact hash of the fully merged source record.
    pub source_hash: String,
}

/// A row borrowed from storage or an optimistic projection. Only ranked winners
/// need an owned document; the storage visitor may reuse its buffers immediately.
#[derive(Clone, Copy)]
pub struct SearchDocumentRef<'a> {
    /// Projection profile.
    pub profile: SearchProfile,
    /// Canonical normalized-record key.
    pub record_key: &'a EntityKey<'a>,
    /// Quick Access bucket.
    pub bucket: &'a str,
    /// Normalized matching text.
    pub search_text: &'a str,
    /// Recency timestamp.
    pub timestamp_ms: i64,
    /// Hash of the source record.
    pub source_hash: &'a str,
}

impl SearchDocumentRef<'_> {
    /// Retains a winning row independently of the next storage step.
    pub fn into_owned(self) -> SearchDocument {
        SearchDocument {
            profile: self.profile,
            record_key: self.record_key.clone().into_owned(),
            bucket: self.bucket.to_owned(),
            search_text: self.search_text.to_owned(),
            timestamp_ms: self.timestamp_ms,
            source_hash: self.source_hash.to_owned(),
        }
    }
}

impl SearchDocument {
    /// Borrows an already-materialized projection for ranking.
    pub fn as_borrowed(&self) -> SearchDocumentRef<'_> {
        SearchDocumentRef {
            profile: self.profile,
            record_key: &self.record_key,
            bucket: &self.bucket,
            search_text: &self.search_text,
            timestamp_ms: self.timestamp_ms,
            source_hash: &self.source_hash,
        }
    }
}

/// Bounded search request over cached contents.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    /// Versioned projection profile.
    pub profile: SearchProfile,
    /// Allowed Quick Access buckets. Empty means every bucket in the profile.
    #[serde(default)]
    pub buckets: Vec<String>,
    /// Fuzzy query. Empty queries use the indexed recent browse path.
    #[serde(default)]
    pub query: String,
    /// Exclusive continuation cursor for empty-query browsing.
    pub cursor: Option<SearchCursor>,
    /// Maximum result count.
    pub limit: usize,
    /// Wall-clock time used for deterministic freshness scoring.
    pub now_ms: i64,
}

/// Bounded search result. It describes cache contents, not corpus completeness.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    /// Revision of the projection maintained by this engine. Older native
    /// engines omit this field; callers must not mistake unsupported contact
    /// projection for an empty directory.
    pub projection_version: u32,
    /// Ranked compact documents.
    pub documents: Vec<SearchDocument>,
    /// Empty-query continuation cursor when more cached documents exist.
    pub next_cursor: Option<SearchCursor>,
}

/// Search request validation errors.
#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum SearchError {
    /// Search result limits are deliberately bounded at the core boundary.
    #[error("search limit must be between 1 and {MAX_SEARCH_LIMIT}")]
    InvalidLimit,
    /// Bucket names cross storage boundaries and must remain compact.
    #[error("invalid search bucket")]
    InvalidBucket,
    /// Query text is bounded before filtering and streaming storage matches.
    #[error("search query is too long")]
    QueryTooLong,
}

/// Revision of the derived Quick Access rows. Storage adapters rebuild existing
/// rows when this changes; normalized records and pending writes remain valid.
pub const QUICK_ACCESS_PROJECTION_VERSION: u32 = 5;

/// Normalized entity types used by the Quick Access projection. Storage rebuilds
/// restrict decoding to this set so unrelated payloads do not delay readiness.
pub const QUICK_ACCESS_TYPENAMES: &[&str] = &[
    "GraphqlSoupDocument",
    "GraphqlSoupChat",
    "GraphqlSoupProject",
    "GraphqlSoupEmailThread",
    "GraphqlSoupChannel",
    "GraphqlSoupCrmCompany",
    "GraphqlSoupCrmContact",
    "GraphqlSoupInitiative",
    "GraphqlContact",
];

/// Maximum number of compact documents returned by one RPC.
pub const MAX_SEARCH_LIMIT: usize = 500;
/// Maximum accepted query length in bytes.
pub const MAX_SEARCH_QUERY_BYTES: usize = subsequence_match::MAX_QUERY_BYTES;
/// Restores the Quick Access preference for matching direct messages.
const DM_SEARCH_BOOST: f64 = 1.8;

/// Validates and canonicalizes a request's buckets.
pub fn validate_search_request(request: &SearchRequest) -> Result<Vec<String>, SearchError> {
    if request.limit == 0 || request.limit > MAX_SEARCH_LIMIT {
        return Err(SearchError::InvalidLimit);
    }
    if request.query.len() > MAX_SEARCH_QUERY_BYTES {
        return Err(SearchError::QueryTooLong);
    }
    let mut buckets = BTreeSet::new();
    for bucket in &request.buckets {
        if bucket.is_empty()
            || bucket.len() > 64
            || !bucket
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
        {
            return Err(SearchError::InvalidBucket);
        }
        buckets.insert(bucket.clone());
    }
    Ok(buckets.into_iter().collect())
}

/// Builds every current search projection for a fully merged record.
///
/// A missing result means the record is internal, deleted, hidden, or not part
/// of a current profile. Storage backends delete any old derived row in that
/// case, in the same transaction as the base-record upsert.
pub fn project_search_documents(key: &EntityKey<'static>, record: &Record) -> Vec<SearchDocument> {
    project_quick_access(key, record).into_iter().collect()
}

fn quick_access_fields<'a>(
    key: &'a EntityKey<'_>,
    record: &'a Record,
) -> Option<(&'a str, &'static str, &'static [&'static str])> {
    if key.is_root() || key.as_ref().starts_with("__meta:") || !is_present(record) {
        return None;
    }
    let typename = record
        .typename()
        .or_else(|| key.as_ref().split_once(':').map(|(name, _)| name))?;

    let (bucket, text_fields): (&str, &[&str]) = match typename {
        "GraphqlSoupDocument" => (document_bucket(record), &["documentName", "name"]),
        "GraphqlSoupChat" => ("chat", &["chatName", "name"]),
        "GraphqlSoupProject" => ("project", &["projectName", "name"]),
        "GraphqlSoupEmailThread" => (
            "email",
            &["emailName", "name", "senderName", "senderEmail", "senders"],
        ),
        "GraphqlSoupChannel" => (channel_bucket(record), &["channelName", "name"]),
        "GraphqlSoupCrmCompany" => ("crm_company", &["crmCompanyName", "name", "domains"]),
        "GraphqlSoupCrmContact" => ("crm_contact", &["crmContactName", "name", "email"]),
        "GraphqlSoupInitiative" => ("initiative", &["displayName"]),
        // Only the viewer-scoped directory record proves membership. Public
        // profiles (including the authenticated viewer) are not contact rows.
        "GraphqlContact" => ("person", &["name", "email"]),
        _ => return None,
    };

    text_fields
        .iter()
        .any(|field| record.fields.contains_key(*field))
        .then_some((typename, bucket, text_fields))
}

fn project_quick_access(key: &EntityKey<'static>, record: &Record) -> Option<SearchDocument> {
    let (typename, bucket, text_fields) = quick_access_fields(key, record)?;
    let search_text = normalize_search_text(
        text_fields
            .iter()
            .filter_map(|field| record.fields.get(*field))
            .flat_map(search_value_text)
            .collect::<Vec<_>>()
            .join(" | ")
            .as_str(),
    );
    Some(SearchDocument {
        profile: SearchProfile::QuickAccessV1,
        record_key: key.clone(),
        bucket: bucket.to_owned(),
        search_text,
        timestamp_ms: quick_access_timestamp(typename, record),
        source_hash: source_hash(record),
    })
}

fn is_present(record: &Record) -> bool {
    !matches!(record.fields.get("deletedAt"), Some(value) if !matches!(value, CacheValue::Null))
        && !matches!(record.fields.get("hidden"), Some(CacheValue::Bool(true)))
}

fn document_bucket(record: &Record) -> &'static str {
    let subtype = record.fields.get("subType").and_then(value_typename);
    match subtype {
        Some(name) if name.contains("Task") => "task",
        Some(name) if name.contains("Snippet") => "snippet",
        Some(name) if name.contains("Skill") => "skill",
        _ if string_field(record, "fileType")
            .is_some_and(|value| value.eq_ignore_ascii_case("md")) =>
        {
            "note"
        }
        _ => "document",
    }
}

fn channel_bucket(record: &Record) -> &'static str {
    if string_field(record, "channelType").is_some_and(|value| {
        value.eq_ignore_ascii_case("direct_message") || value.eq_ignore_ascii_case("directmessage")
    }) {
        "dm"
    } else {
        "channel"
    }
}

fn value_typename(value: &CacheValue) -> Option<&str> {
    match value {
        CacheValue::Ref(key) => key.as_ref().split_once(':').map(|(name, _)| name),
        CacheValue::Object(fields) => match fields.get("__typename") {
            Some(CacheValue::String(value)) => Some(value),
            _ => None,
        },
        _ => None,
    }
}

fn string_field<'a>(record: &'a Record, field: &str) -> Option<&'a str> {
    match record.fields.get(field) {
        Some(CacheValue::String(value)) => Some(value),
        _ => None,
    }
}

fn search_value_text(value: &CacheValue) -> Vec<&str> {
    match value {
        CacheValue::String(value) => vec![value],
        CacheValue::List(values) => values.iter().flat_map(search_value_text).collect(),
        CacheValue::Object(fields) => fields
            .iter()
            .filter(|(key, _)| matches!(key.as_str(), "name" | "email" | "domain"))
            .flat_map(|(_, value)| search_value_text(value))
            .collect(),
        _ => Vec::new(),
    }
}

/// Normalized text-search input shared by storage filtering and ranking.
/// Storage may return a superset of matches; the ranker always checks each row.
pub struct SearchQuery(String);

impl SearchQuery {
    /// Applies the same Unicode lowercase and whitespace normalization as the projection.
    pub fn new(query: &str) -> Self {
        Self(normalize_search_text(query))
    }

    /// Whitespace/comma-separated tokens, each matching an ordered subsequence.
    pub fn tokens(&self) -> impl Iterator<Item = &str> {
        self.0
            .split(|c: char| c.is_whitespace() || c == ',')
            .filter(|token| !token.is_empty())
    }

    /// Whether every token matches, independent of freshness and ranking.
    pub fn matches(&self, text: &str) -> bool {
        self.tokens()
            .all(|token| subsequence_score(text, token).is_some())
    }
}

fn quick_access_timestamp(typename: &str, record: &Record) -> i64 {
    // Initiatives keep their timestamps in an embedded metadata object.
    if typename == "GraphqlSoupInitiative" {
        let Some(CacheValue::Object(metadata)) = record.fields.get("metadata") else {
            return 0;
        };
        return ["viewedAt", "updatedAt", "createdAt"]
            .into_iter()
            .find_map(|field| metadata.get(field).and_then(value_timestamp))
            .unwrap_or(0);
    }
    if typename == "GraphqlSoupCrmContact" {
        return ["lastInteraction", "updatedAt", "createdAt"]
            .into_iter()
            .find_map(|field| record.fields.get(field).and_then(value_timestamp))
            .unwrap_or(0);
    }
    // Match VIEWED_UPDATED and the menu before applying a browse limit. Using
    // max(viewedAt, updatedAt) would let newly updated, long-unopened records
    // displace recently viewed records into later pages.
    if matches!(
        typename,
        "GraphqlSoupDocument"
            | "GraphqlSoupChat"
            | "GraphqlSoupProject"
            | "GraphqlSoupChannel"
            | "GraphqlSoupCrmCompany"
    ) {
        return ["viewedAt", "updatedAt", "createdAt"]
            .into_iter()
            .find_map(|field| record.fields.get(field).and_then(value_timestamp))
            .unwrap_or(0);
    }

    [
        "viewedAt",
        "interactedAt",
        "sortTs",
        "lastInteraction",
        "updatedAt",
        "createdAt",
    ]
    .into_iter()
    .filter_map(|field| record.fields.get(field).and_then(value_timestamp))
    .max()
    .unwrap_or(0)
}

fn value_timestamp(value: &CacheValue) -> Option<i64> {
    match value {
        CacheValue::String(value) => parse_rfc3339_millis(value),
        CacheValue::Number(CacheNumber::PosInt(value)) => i64::try_from(*value).ok(),
        CacheValue::Number(CacheNumber::NegInt(value)) => Some(*value),
        CacheValue::Number(CacheNumber::Float(value)) if value.is_finite() => Some(*value as i64),
        _ => None,
    }
}

fn source_hash(record: &Record) -> String {
    let digest = Sha256::digest(encode_record(record));
    digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(crate) fn compare_record_keys(left: &EntityKey<'_>, right: &EntityKey<'_>) -> Ordering {
    let left = left.as_ref().split_once(':').unwrap_or((left.as_ref(), ""));
    let right = right
        .as_ref()
        .split_once(':')
        .unwrap_or((right.as_ref(), ""));
    left.0.cmp(right.0).then_with(|| left.1.cmp(right.1))
}

/// Sorts recent browse results deterministically.
pub fn compare_recent(left: &SearchDocument, right: &SearchDocument) -> Ordering {
    compare_recent_rows(left.as_borrowed(), right.as_borrowed())
}

fn compare_recent_rows(left: SearchDocumentRef<'_>, right: SearchDocumentRef<'_>) -> Ordering {
    right
        .timestamp_ms
        .cmp(&left.timestamp_ms)
        .then_with(|| compare_record_keys(left.record_key, right.record_key))
}

/// Returns a fuzzy+freshness score, or `None` when every query token fails to
/// match as an ordered subsequence. Fuzzy relevance contributes 70%, freshness
/// contributes 30%, and matching direct messages receive the legacy 1.8x boost.
pub fn fuzzy_freshness_score(document: &SearchDocument, query: &str, now_ms: i64) -> Option<f64> {
    score_normalized_query(
        document.as_borrowed(),
        &normalize_search_text(query),
        now_ms,
    )
}

fn score_normalized_query(
    document: SearchDocumentRef<'_>,
    normalized: &str,
    now_ms: i64,
) -> Option<f64> {
    if normalized.is_empty() {
        return Some(1.0);
    }
    let mut score = 0.0;
    let mut tokens = 0usize;
    // Commas separate tokens as in the server's channel name search. Left on a
    // token, a comma would only match a name with one after it.
    for token in normalized
        .split([' ', ','])
        .filter(|token| !token.is_empty())
    {
        tokens += 1;
        score += subsequence_score(document.search_text, token)?;
    }
    if tokens == 0 {
        return None;
    }
    let fuzzy = score / tokens as f64;
    let age = now_ms.saturating_sub(document.timestamp_ms).max(0) as f64;
    let max_age = 30.0 * 24.0 * 60.0 * 60.0 * 1000.0;
    let freshness = if document.timestamp_ms <= 0 || age >= max_age {
        0.0
    } else {
        (-0.5 * age / max_age).exp()
    };
    let score = 0.7 * fuzzy + 0.3 * freshness;
    Some(if document.bucket == "dm" {
        score * DM_SEARCH_BOOST
    } else {
        score
    })
}

fn parse_rfc3339_millis(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.timestamp_millis())
}

#[cfg(test)]
mod test;
