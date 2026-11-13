//! The git-ai metrics upload format (`POST /worker/metrics/upload`):
//! `{"v":1,"events":[{"t":<unix s>,"e":<event id>,"v":{"<pos>":…},"a":{"<pos>":…}}]}`.
//! `v` (values) and `a` (attributes) are sparse maps keyed by position.
//! Positions come from git-ai's `src/metrics/attrs.rs` and `events.rs`.
//! Each event keeps its whole JSON, so unknown ids and positions are stored
//! untouched.

use serde::Deserialize;
use serde_json::{Map, Value};

#[cfg(test)]
mod test;

/// Attribute positions shared by every event.
pub mod attr {
    /// Client version.
    pub const GIT_AI_VERSION: &str = "0";
    /// Remote URL of the repository the event belongs to; absent outside a repo.
    pub const REPO_URL: &str = "1";
    /// Self-asserted git identity (ignored; the credential is the author).
    pub const AUTHOR: &str = "2";
    /// Commit SHA.
    pub const COMMIT_SHA: &str = "3";
    /// Parent commit SHA.
    pub const BASE_COMMIT_SHA: &str = "4";
    /// Branch.
    pub const BRANCH: &str = "5";
    /// Agent: `claude`, `codex`, ….
    pub const TOOL: &str = "20";
    /// Model id.
    pub const MODEL: &str = "21";
    /// The agent's own session id (Claude Code session UUID, Codex rollout id).
    pub const EXTERNAL_SESSION_ID: &str = "23";
    /// git-ai's session id: `s_` + 14 hex of SHA-256(`tool:external id`).
    pub const SESSION_ID: &str = "24";
    /// git-ai's id of one transcript line or edit (`t_…`).
    pub const TRACE_ID: &str = "25";
}

/// Value positions of Committed (1) and RewriteCommitted (7).
pub mod committed {
    /// Human-added lines.
    pub const HUMAN_ADDITIONS: &str = "0";
    /// Lines deleted by the commit.
    pub const GIT_DIFF_DELETED_LINES: &str = "1";
    /// Lines added by the commit.
    pub const GIT_DIFF_ADDED_LINES: &str = "2";
    /// `["all", "tool::model", …]`, parallel to the arrays below.
    pub const TOOL_MODEL_PAIRS: &str = "3";
    /// AI-added lines per entry of [`TOOL_MODEL_PAIRS`].
    pub const AI_ADDITIONS: &str = "5";
    /// Commit subject.
    pub const COMMIT_SUBJECT: &str = "11";
    /// Full authorship note text.
    pub const AUTHORSHIP_NOTE: &str = "13";
    /// Committer timestamp (Committed only).
    pub const COMMIT_TS: &str = "16";
    /// Commits a rewrite replaced (RewriteCommitted only).
    pub const ORIGINAL_COMMIT_SHAS: &str = "16";
}

/// Value positions of TokenUsage (9).
pub mod token_usage {
    /// Start of the 5-minute UTC bucket.
    pub const BUCKET_TS: &str = "0";
    /// Input tokens.
    pub const INPUT_TOKENS: &str = "1";
    /// Output tokens.
    pub const OUTPUT_TOKENS: &str = "2";
    /// Cache read tokens.
    pub const CACHE_READ_TOKENS: &str = "3";
    /// Cache write tokens.
    pub const CACHE_WRITE_TOKENS: &str = "4";
    /// Estimated cost in millionths of a dollar.
    pub const EST_COST_MICRO_USD: &str = "7";
    /// Revision of the bucket; only the highest counts.
    pub const EMITTED_SEQ: &str = "10";
    /// Speed tier, part of the bucket key.
    pub const SPEED: &str = "11";
}

/// Metric event ids (`src/metrics/types.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum EventKind {
    /// 1: a commit with its attribution and note.
    Committed,
    /// 2: an agent was used.
    AgentUsage,
    /// 3: hooks were installed.
    InstallHooks,
    /// 4: one agent edit.
    Checkpoint,
    /// 5: one raw transcript line.
    SessionEvent,
    /// 6: a Copilot span.
    OtelTrace,
    /// 7: a rebased or amended commit.
    RewriteCommitted,
    /// 8: daemon queue drops.
    DaemonIngestAnomaly,
    /// 9: tokens and cost of a 5-minute bucket.
    TokenUsage,
    /// An id this server does not know; stored untouched.
    Unknown,
}

impl EventKind {
    /// The kind for a wire id.
    pub fn from_id(id: u64) -> Self {
        match id {
            1 => Self::Committed,
            2 => Self::AgentUsage,
            3 => Self::InstallHooks,
            4 => Self::Checkpoint,
            5 => Self::SessionEvent,
            6 => Self::OtelTrace,
            7 => Self::RewriteCommitted,
            8 => Self::DaemonIngestAnomaly,
            9 => Self::TokenUsage,
            _ => Self::Unknown,
        }
    }

    /// The `event` attribute of `gitai.ingest.events`.
    pub fn as_str(self) -> &'static str {
        self.into()
    }
}

/// A metrics upload body. Events stay raw until each is checked on its own,
/// so one malformed event does not fail the batch.
#[derive(Debug, Deserialize)]
pub struct MetricsBatch {
    /// Format version (1).
    #[serde(rename = "v")]
    pub version: u64,
    /// The events, in the client's order.
    pub events: Vec<Value>,
}

/// One well-formed event: an object with numeric `t` and `e`; `a` and `v`,
/// when present, are objects.
#[derive(Debug, Clone, PartialEq)]
pub struct MetricEvent {
    raw: Map<String, Value>,
    /// Unix seconds when the client recorded it.
    pub timestamp: u64,
    /// Wire id.
    pub id: u64,
}

const TIMESTAMP_KEY: &str = "t";
const ID_KEY: &str = "e";
const VALUES_KEY: &str = "v";
const ATTRIBUTES_KEY: &str = "a";

impl MetricEvent {
    /// Checks the envelope of one event. `Err` names what is wrong.
    pub fn parse(raw: Value) -> Result<Self, &'static str> {
        let Value::Object(raw) = raw else {
            return Err("event is not an object");
        };
        let timestamp = raw
            .get(TIMESTAMP_KEY)
            .and_then(Value::as_u64)
            .ok_or("event has no numeric t")?;
        let id = raw
            .get(ID_KEY)
            .and_then(Value::as_u64)
            .ok_or("event has no numeric e")?;
        for key in [VALUES_KEY, ATTRIBUTES_KEY] {
            if raw.get(key).is_some_and(|map| !map.is_object()) {
                return Err("event a or v is not an object");
            }
        }
        Ok(Self { raw, timestamp, id })
    }

    /// The event's kind.
    pub fn kind(&self) -> EventKind {
        EventKind::from_id(self.id)
    }

    /// The whole event as received (after redaction, once redacted).
    pub fn raw(&self) -> &Map<String, Value> {
        &self.raw
    }

    /// Mutable access, for the redaction pass.
    pub fn raw_mut(&mut self) -> &mut Map<String, Value> {
        &mut self.raw
    }

    fn sparse(&self, key: &str, pos: &str) -> Option<&Value> {
        self.raw.get(key)?.as_object()?.get(pos)
    }

    /// A string attribute; empty strings count as absent.
    pub fn attr_str(&self, pos: &str) -> Option<&str> {
        self.sparse(ATTRIBUTES_KEY, pos)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
    }

    /// A value at `pos`, as sent.
    pub fn value(&self, pos: &str) -> Option<&Value> {
        self.sparse(VALUES_KEY, pos)
    }

    /// A string value; empty strings count as absent.
    pub fn value_str(&self, pos: &str) -> Option<&str> {
        self.value(pos)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
    }

    /// An unsigned integer value.
    pub fn value_u64(&self, pos: &str) -> Option<u64> {
        self.value(pos).and_then(Value::as_u64)
    }
}
