//! Turns one metrics upload into what gets stored: the repository filter,
//! the redaction pass, and the records each event kind produces. Pure; the
//! service writes the plan through the ports.
//!
//! Session ids: the id the service exposes and keys sessions by is git-ai's
//! own session id (attribute 24, `s_` + 14 hex of SHA-256(`tool:external
//! id`)). It is what authorship notes name (`sessions` keys and the
//! `s_…::t_…` line attestations), so commits join to sessions directly. The
//! agent's own id (attribute 23: Claude Code's session UUID, Codex's rollout
//! id) is kept on the session as `external_session_id`; an event that lacks
//! attribute 24 gets it derived from attributes 20 and 23.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest as _, Sha256};

use super::layout;
use super::metrics::EventResult;
use super::models::{ClientHeaders, CredentialId, DeviceIdentity, Email, Hostname};
use super::note::{NoteSession, note_sessions};
use super::redaction::{RedactionHits, redact_json};
use super::repository::RepositoryScope;
use super::wire::{EventKind, MetricEvent, MetricsBatch, attr, committed, token_usage};

#[cfg(test)]
mod test;

/// Tool directory for events that name no agent.
pub const UNKNOWN_TOOL: &str = "unknown";

/// Longest session id accepted as a storage key.
const MAX_SESSION_ID_LEN: usize = 128;

/// Hex characters of the content hash that names a transcript chunk.
const CHUNK_ID_LEN: usize = 32;

/// Who sent the batch and when, stamped on every stored line.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Envelope {
    /// Server receive time.
    pub received_at: DateTime<Utc>,
    /// Device credential.
    pub credential_id: CredentialId,
    /// Credential email.
    pub email: Email,
    /// Credential hostname.
    pub hostname: Hostname,
    /// `X-Distinct-ID`.
    pub distinct_id: Option<String>,
    /// From `User-Agent`.
    pub client_version: Option<String>,
}

impl Envelope {
    /// The envelope for a batch from `identity`.
    pub fn new(
        identity: &DeviceIdentity,
        headers: &ClientHeaders,
        received_at: DateTime<Utc>,
    ) -> Self {
        Self {
            received_at,
            credential_id: identity.credential_id,
            email: identity.email.clone(),
            hostname: identity.hostname.clone(),
            distinct_id: headers.distinct_id.clone(),
            client_version: headers.client_version.clone(),
        }
    }
}

/// One stored line: the envelope and the redacted event as received.
#[derive(Serialize)]
pub struct StoredLine<'a> {
    /// Who and when.
    pub envelope: &'a Envelope,
    /// The event.
    pub event: &'a Map<String, Value>,
}

/// An event the client should stop sending: it can never be stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EventError {
    /// Position in the batch.
    pub index: usize,
    /// Why.
    pub error: &'static str,
}

/// Events per kind and outcome.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EventTally(BTreeMap<(EventKind, EventResult), u64>);

impl EventTally {
    fn add(&mut self, kind: EventKind, result: EventResult) {
        *self.0.entry((kind, result)).or_default() += 1;
    }

    /// Events of one kind with one outcome.
    pub fn get(&self, kind: EventKind, result: EventResult) -> u64 {
        self.0.get(&(kind, result)).copied().unwrap_or_default()
    }

    /// Events with one outcome, of any kind.
    pub fn with_result(&self, result: EventResult) -> u64 {
        self.0
            .iter()
            .filter(|((_, r), _)| *r == result)
            .map(|(_, count)| count)
            .sum()
    }

    /// Every (kind, outcome) with its count.
    pub fn iter(&self) -> impl Iterator<Item = (EventKind, EventResult, u64)> + '_ {
        self.0
            .iter()
            .map(|((kind, result), count)| (*kind, *result, *count))
    }
}

/// Committed (1) or RewriteCommitted (7).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, strum::IntoStaticStr)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum CommitKind {
    /// A new commit.
    Committed,
    /// A rebased or amended commit.
    RewriteCommitted,
}

/// A commit with its attribution: the `commits/` row and the index entry.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CommitRecord {
    /// Commit SHA.
    pub sha: String,
    /// Which event produced it.
    pub kind: CommitKind,
    /// Repository (`host/owner/name`).
    pub repository: String,
    /// Branch.
    pub branch: Option<String>,
    /// Parent commit.
    pub base_commit_sha: Option<String>,
    /// Subject (redacted).
    pub subject: Option<String>,
    /// When the client recorded the event (unix s).
    pub event_ts: u64,
    /// Committer time (unix s), Committed only.
    pub commit_ts: Option<u64>,
    /// Lines the commit added.
    pub added_lines: u64,
    /// Lines the commit deleted.
    pub deleted_lines: u64,
    /// Lines a person added.
    pub human_lines: u64,
    /// Lines agents added.
    pub ai_lines: u64,
    /// Agent-added lines per `tool::model`.
    pub ai_lines_by_tool_model: BTreeMap<String, u64>,
    /// Sessions the note names.
    pub sessions: Vec<NoteSession>,
    /// The note text (redacted); stored as its own object, not in the row.
    #[serde(skip)]
    pub note: Option<String>,
    /// Where the note is stored.
    pub note_key: Option<String>,
    /// Commits a rewrite replaced.
    pub original_commit_shas: Vec<String>,
    /// Credential email.
    pub author: Email,
    /// Credential hostname.
    pub hostname: Hostname,
    /// Credential id.
    pub credential_id: CredentialId,
    /// Server receive time.
    pub received_at: DateTime<Utc>,
}

/// Token and cost totals of one bucket revision.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct TokenCounts {
    /// Input tokens.
    pub input: u64,
    /// Output tokens.
    pub output: u64,
    /// Cache read tokens.
    pub cache_read: u64,
    /// Cache write tokens.
    pub cache_write: u64,
    /// Estimated cost in millionths of a dollar.
    pub cost_micro_usd: u64,
}

impl TokenCounts {
    /// How much these counts differ from an earlier revision.
    pub fn delta_since(&self, previous: &TokenCounts) -> TokenDelta {
        let delta = |now: u64, before: u64| {
            if now >= before {
                i64::try_from(now - before).unwrap_or(i64::MAX)
            } else {
                -i64::try_from(before - now).unwrap_or(i64::MAX)
            }
        };
        TokenDelta {
            input: delta(self.input, previous.input),
            output: delta(self.output, previous.output),
            cache_read: delta(self.cache_read, previous.cache_read),
            cache_write: delta(self.cache_write, previous.cache_write),
            cost_micro_usd: delta(self.cost_micro_usd, previous.cost_micro_usd),
        }
    }
}

/// A change to token totals; negative when a bucket was corrected down.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TokenDelta {
    /// Input tokens.
    pub input: i64,
    /// Output tokens.
    pub output: i64,
    /// Cache read tokens.
    pub cache_read: i64,
    /// Cache write tokens.
    pub cache_write: i64,
    /// Cost in millionths of a dollar.
    pub cost_micro_usd: i64,
}

impl TokenDelta {
    /// Whether nothing changed.
    pub fn is_zero(&self) -> bool {
        *self == Self::default()
    }
}

/// One revision of a 5-minute token bucket. git-ai re-sends a bucket with a
/// higher `emitted_seq` whenever its totals change; only the highest
/// revision per (session, model, speed, bucket) counts.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TokenBucket {
    /// git-ai session id.
    pub session_id: String,
    /// The agent's own session id.
    pub external_session_id: Option<String>,
    /// Agent.
    pub tool: String,
    /// Model (`unknown` when not sent).
    pub model: String,
    /// Speed tier.
    pub speed: u64,
    /// Bucket start (unix s).
    pub bucket_ts: u64,
    /// Revision.
    pub emitted_seq: u64,
    /// Totals of this revision.
    #[serde(flatten)]
    pub counts: TokenCounts,
    /// Repository.
    pub repository: String,
    /// Credential email.
    pub author: Email,
    /// Credential hostname.
    pub hostname: Hostname,
    /// Credential id.
    pub credential_id: CredentialId,
    /// Server receive time.
    pub received_at: DateTime<Utc>,
}

/// The transcript lines of one session in one batch, oldest first.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionChunk {
    /// git-ai session id.
    pub session_id: String,
    /// The agent's own session id.
    pub external_session_id: Option<String>,
    /// Agent directory (`unknown` when not sent).
    pub tool: String,
    /// Repository.
    pub repository: String,
    /// The redacted SessionEvents.
    pub events: Vec<MetricEvent>,
    /// Earliest event time (unix s).
    pub first_ts: u64,
    /// Latest event time (unix s).
    pub last_ts: u64,
    /// Content hash of the events; a retried batch gets the same id.
    pub chunk_id: String,
}

impl SessionChunk {
    /// Where the chunk is stored in the sessions bucket.
    pub fn key(&self) -> String {
        layout::transcript_key(&self.tool, &self.session_id, self.first_ts, &self.chunk_id)
    }
}

/// Everything one metrics upload stores, after filtering and redaction.
#[derive(Debug, Clone)]
pub struct IngestPlan {
    /// Stamped on every line.
    pub envelope: Envelope,
    /// Outcome per event.
    pub tally: EventTally,
    /// Malformed events, reported back to the client.
    pub errors: Vec<EventError>,
    /// Secrets masked.
    pub redaction: RedactionHits,
    /// Kept events other than transcript lines, for `raw/`.
    pub raw_events: Vec<MetricEvent>,
    /// From Committed and RewriteCommitted.
    pub commits: Vec<CommitRecord>,
    /// From TokenUsage.
    pub token_buckets: Vec<TokenBucket>,
    /// From SessionEvents, one per session.
    pub sessions: Vec<SessionChunk>,
}

/// Filters, redacts and sorts a batch into what it stores.
pub fn plan_batch(batch: MetricsBatch, envelope: Envelope) -> IngestPlan {
    let mut plan = IngestPlan {
        envelope,
        tally: EventTally::default(),
        errors: Vec::new(),
        redaction: RedactionHits::default(),
        raw_events: Vec::new(),
        commits: Vec::new(),
        token_buckets: Vec::new(),
        sessions: Vec::new(),
    };
    let mut transcripts: BTreeMap<String, SessionChunk> = BTreeMap::new();

    for (index, raw) in batch.events.into_iter().enumerate() {
        let wire_kind = raw
            .get("e")
            .and_then(Value::as_u64)
            .map_or(EventKind::Unknown, EventKind::from_id);
        let mut event = match MetricEvent::parse(raw) {
            Ok(event) => event,
            Err(error) => {
                plan.tally.add(wire_kind, EventResult::Invalid);
                plan.errors.push(EventError { index, error });
                continue;
            }
        };
        let kind = event.kind();

        let repository = match RepositoryScope::of(event.attr_str(attr::REPO_URL)) {
            RepositoryScope::Allowed(repository) => repository,
            RepositoryScope::Other => {
                plan.tally.add(kind, EventResult::DroppedRepo);
                continue;
            }
            RepositoryScope::Missing => {
                plan.tally.add(kind, EventResult::DroppedNoRepo);
                continue;
            }
        };

        // Nothing below sees the event before its secrets are masked.
        let mut event_hits = RedactionHits::default();
        let mut redacted = Value::Object(std::mem::take(event.raw_mut()));
        redact_json(&mut redacted, &mut event_hits);
        if let Value::Object(map) = redacted {
            *event.raw_mut() = map;
        }
        plan.redaction.merge(&event_hits);

        if kind == EventKind::SessionEvent {
            let Some(session_id) = session_id_of(&event) else {
                plan.tally.add(kind, EventResult::Invalid);
                plan.errors.push(EventError {
                    index,
                    error: "session event has no session id",
                });
                continue;
            };
            plan.tally.add(kind, EventResult::Accepted);
            add_to_transcript(&mut transcripts, session_id, &repository, event);
            continue;
        }

        plan.tally.add(kind, EventResult::Accepted);
        match kind {
            EventKind::Committed | EventKind::RewriteCommitted => {
                if let Some(commit) = commit_record(&event, kind, &repository, &plan.envelope) {
                    plan.commits.push(commit);
                }
            }
            EventKind::TokenUsage => {
                if let Some(bucket) = token_bucket(&event, &repository, &plan.envelope) {
                    plan.token_buckets.push(bucket);
                }
            }
            _ => {}
        }
        plan.raw_events.push(event);
    }

    plan.sessions = transcripts
        .into_values()
        .map(|mut chunk| {
            // git-ai sends a transcript newest first; store it oldest first.
            chunk.events.sort_by_key(|event| event.timestamp);
            chunk.chunk_id = chunk_id(&chunk.session_id, &chunk.events);
            chunk
        })
        .collect();
    plan
}

/// git-ai's session id for an agent session: `s_` + the first 14 hex
/// characters of SHA-256(`<tool>:<external session id>`).
pub fn git_ai_session_id(tool: &str, external_session_id: &str) -> String {
    let digest = hex::encode(Sha256::digest(format!("{tool}:{external_session_id}")));
    format!("s_{}", digest.get(..14).unwrap_or(&digest))
}

/// Attribute 24 when it is a usable key, else derived from 20 and 23.
fn session_id_of(event: &MetricEvent) -> Option<String> {
    if let Some(session_id) = event
        .attr_str(attr::SESSION_ID)
        .filter(|id| is_safe_key(id))
    {
        return Some(session_id.to_owned());
    }
    let tool = event.attr_str(attr::TOOL)?;
    let external = event.attr_str(attr::EXTERNAL_SESSION_ID)?;
    Some(git_ai_session_id(tool, external))
}

/// Safe inside an S3 key and a table key.
fn is_safe_key(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_SESSION_ID_LEN
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
}

/// The agent name as a path segment.
fn tool_of(event: &MetricEvent) -> String {
    event
        .attr_str(attr::TOOL)
        .map(str::to_lowercase)
        .filter(|tool| is_safe_key(tool))
        .unwrap_or_else(|| UNKNOWN_TOOL.to_owned())
}

fn add_to_transcript(
    transcripts: &mut BTreeMap<String, SessionChunk>,
    session_id: String,
    repository: &str,
    event: MetricEvent,
) {
    let chunk = transcripts
        .entry(session_id.clone())
        .or_insert_with(|| SessionChunk {
            session_id,
            external_session_id: None,
            tool: tool_of(&event),
            repository: repository.to_owned(),
            events: Vec::new(),
            first_ts: event.timestamp,
            last_ts: event.timestamp,
            chunk_id: String::new(),
        });
    if chunk.external_session_id.is_none() {
        chunk.external_session_id = event.attr_str(attr::EXTERNAL_SESSION_ID).map(str::to_owned);
    }
    chunk.first_ts = chunk.first_ts.min(event.timestamp);
    chunk.last_ts = chunk.last_ts.max(event.timestamp);
    chunk.events.push(event);
}

/// Hash of the session id and its events, as hex.
fn chunk_id(session_id: &str, events: &[MetricEvent]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(session_id.as_bytes());
    for event in events {
        hasher.update(b"\n");
        hasher.update(Value::Object(event.raw().clone()).to_string().as_bytes());
    }
    let digest = hex::encode(hasher.finalize());
    digest.get(..CHUNK_ID_LEN).unwrap_or(&digest).to_owned()
}

/// A 40- or 64-character hex commit id, lowercased.
fn commit_sha(raw: Option<&str>) -> Option<String> {
    let sha = raw?.to_lowercase();
    let valid = matches!(sha.len(), 40 | 64) && sha.bytes().all(|byte| byte.is_ascii_hexdigit());
    valid.then_some(sha)
}

fn commit_record(
    event: &MetricEvent,
    kind: EventKind,
    repository: &str,
    envelope: &Envelope,
) -> Option<CommitRecord> {
    let sha = commit_sha(event.attr_str(attr::COMMIT_SHA))?;
    let kind = if kind == EventKind::RewriteCommitted {
        CommitKind::RewriteCommitted
    } else {
        CommitKind::Committed
    };

    // Positions 3 and 5 are parallel arrays: index 0 is "all", then one entry
    // per `tool::model`.
    let pairs: Vec<&str> = event
        .value(committed::TOOL_MODEL_PAIRS)
        .and_then(Value::as_array)
        .map(|pairs| {
            pairs
                .iter()
                .map(|pair| pair.as_str().unwrap_or(""))
                .collect()
        })
        .unwrap_or_default();
    let ai_additions: Vec<u64> = event
        .value(committed::AI_ADDITIONS)
        .and_then(Value::as_array)
        .map(|counts| {
            counts
                .iter()
                .map(|count| count.as_u64().unwrap_or(0))
                .collect()
        })
        .unwrap_or_default();
    let ai_lines_by_tool_model = pairs
        .iter()
        .zip(&ai_additions)
        .skip(1)
        .filter(|(pair, _)| !pair.is_empty())
        .map(|(pair, count)| ((*pair).to_owned(), *count))
        .collect();

    let note = event
        .value_str(committed::AUTHORSHIP_NOTE)
        .map(str::to_owned);
    let original_commit_shas = if kind == CommitKind::RewriteCommitted {
        event
            .value(committed::ORIGINAL_COMMIT_SHAS)
            .and_then(Value::as_array)
            .map(|shas| {
                shas.iter()
                    .filter_map(|sha| commit_sha(sha.as_str()))
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let commit_ts = if kind == CommitKind::Committed {
        event.value_u64(committed::COMMIT_TS)
    } else {
        None
    };

    Some(CommitRecord {
        kind,
        repository: repository.to_owned(),
        branch: event.attr_str(attr::BRANCH).map(str::to_owned),
        base_commit_sha: event.attr_str(attr::BASE_COMMIT_SHA).map(str::to_owned),
        subject: event
            .value_str(committed::COMMIT_SUBJECT)
            .map(str::to_owned),
        event_ts: event.timestamp,
        commit_ts,
        added_lines: event
            .value_u64(committed::GIT_DIFF_ADDED_LINES)
            .unwrap_or(0),
        deleted_lines: event
            .value_u64(committed::GIT_DIFF_DELETED_LINES)
            .unwrap_or(0),
        human_lines: event.value_u64(committed::HUMAN_ADDITIONS).unwrap_or(0),
        ai_lines: ai_additions.first().copied().unwrap_or(0),
        ai_lines_by_tool_model,
        sessions: note.as_deref().map(note_sessions).unwrap_or_default(),
        note_key: note.as_ref().map(|_| layout::note_key(&sha)),
        note,
        original_commit_shas,
        author: envelope.email.clone(),
        hostname: envelope.hostname.clone(),
        credential_id: envelope.credential_id,
        received_at: envelope.received_at,
        sha,
    })
}

fn token_bucket(event: &MetricEvent, repository: &str, envelope: &Envelope) -> Option<TokenBucket> {
    let session_id = session_id_of(event)?;
    let bucket_ts = event.value_u64(token_usage::BUCKET_TS)?;
    let count = |pos: &str| event.value_u64(pos).unwrap_or(0);

    Some(TokenBucket {
        session_id,
        external_session_id: event.attr_str(attr::EXTERNAL_SESSION_ID).map(str::to_owned),
        tool: tool_of(event),
        model: event
            .attr_str(attr::MODEL)
            .unwrap_or(UNKNOWN_TOOL)
            .to_owned(),
        speed: count(token_usage::SPEED),
        bucket_ts,
        emitted_seq: count(token_usage::EMITTED_SEQ),
        counts: TokenCounts {
            input: count(token_usage::INPUT_TOKENS),
            output: count(token_usage::OUTPUT_TOKENS),
            cache_read: count(token_usage::CACHE_READ_TOKENS),
            cache_write: count(token_usage::CACHE_WRITE_TOKENS),
            cost_micro_usd: count(token_usage::EST_COST_MICRO_USD),
        },
        repository: repository.to_owned(),
        author: envelope.email.clone(),
        hostname: envelope.hostname.clone(),
        credential_id: envelope.credential_id,
        received_at: envelope.received_at,
    })
}

/// Lines as JSON, one per line, zstd-compressed (the `.jsonl.zst` objects).
pub fn jsonl_zst<T: Serialize>(
    lines: impl IntoIterator<Item = T>,
) -> Result<Vec<u8>, serde_json::Error> {
    let jsonl = jsonl(lines)?;
    Ok(ruzstd::encoding::compress_to_vec(
        jsonl.as_slice(),
        ruzstd::encoding::CompressionLevel::Fastest,
    ))
}

/// Lines as JSON, one per line.
pub fn jsonl<T: Serialize>(
    lines: impl IntoIterator<Item = T>,
) -> Result<Vec<u8>, serde_json::Error> {
    let mut body = Vec::new();
    for line in lines {
        serde_json::to_writer(&mut body, &line)?;
        body.push(b'\n');
    }
    Ok(body)
}
