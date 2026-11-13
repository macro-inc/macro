//! The service's counters, named and labelled as the shared METRICS contract
//! says (Grafana dashboards and the tooling depend on these names).

use super::redaction::RedactionRule;
use super::wire::EventKind;

/// The client endpoint a batch came to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum Endpoint {
    /// `POST /worker/metrics/upload`.
    MetricsUpload,
    /// `POST /worker/logs/upload`.
    LogsUpload,
    /// `POST /worker/notes/upload`.
    NotesUpload,
    /// `GET /worker/notes/`.
    NotesRead,
    /// `POST /worker/cas/upload`.
    CasUpload,
    /// `GET /worker/cas/`.
    CasRead,
    /// `GET /worker/releases`.
    Releases,
}

/// Outcome of one request to a client endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum BatchResult {
    /// Accepted.
    Ok,
    /// Bad, unknown or revoked credential.
    Unauthorized,
    /// Malformed body.
    Invalid,
    /// Storage failed.
    Error,
}

/// What happened to one metric event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum EventResult {
    /// Stored.
    Accepted,
    /// Dropped: another repository.
    DroppedRepo,
    /// Dropped: no repository.
    DroppedNoRepo,
    /// Malformed; reported back in `errors`.
    Invalid,
}

/// AI or human lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum LineKind {
    /// Added by an agent.
    Ai,
    /// Added by a person.
    Human,
}

/// Token counter kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum TokenKind {
    /// Input.
    Input,
    /// Output.
    Output,
    /// Cache read.
    CacheRead,
    /// Cache write.
    CacheWrite,
}

/// One increment of one counter. `author` is the credential's email.
#[derive(Debug, Clone, PartialEq)]
pub enum Metric {
    /// `gitai.ingest.batches`.
    Batch {
        /// Endpoint.
        endpoint: Endpoint,
        /// Outcome.
        result: BatchResult,
        /// From `User-Agent`, or `unknown`.
        client_version: String,
    },
    /// `gitai.ingest.events`.
    Events {
        /// Event kind.
        event: EventKind,
        /// Outcome.
        result: EventResult,
        /// How many.
        count: u64,
    },
    /// `gitai.redaction.hits`.
    RedactionHits {
        /// Rule.
        rule: RedactionRule,
        /// How many.
        count: u64,
    },
    /// `gitai.commits`, once per new commit.
    Commit {
        /// Repository.
        repo: String,
        /// Credential email.
        author: String,
    },
    /// `gitai.lines`: added lines of a new commit.
    Lines {
        /// Repository.
        repo: String,
        /// Credential email.
        author: String,
        /// Agent (`human` for human lines).
        tool: String,
        /// Model (`human` for human lines).
        model: String,
        /// AI or human.
        kind: LineKind,
        /// How many.
        count: u64,
    },
    /// `gitai.tokens`: growth of a token bucket.
    Tokens {
        /// Credential email.
        author: String,
        /// Agent.
        tool: String,
        /// Model.
        model: String,
        /// Token kind.
        kind: TokenKind,
        /// How many.
        count: u64,
    },
    /// `gitai.cost` in USD: growth of a token bucket's cost.
    Cost {
        /// Credential email.
        author: String,
        /// Agent.
        tool: String,
        /// Model.
        model: String,
        /// Dollars.
        usd: f64,
    },
    /// `gitai.sessions`, when a session is first seen.
    SessionStarted {
        /// Credential email.
        author: String,
        /// Agent.
        tool: String,
    },
}
