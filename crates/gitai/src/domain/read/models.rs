//! What the read API answers with, and what it reads from the index and from
//! GitHub. Response field names follow the read API contract (snake_case).

use std::ops::AddAssign;

use chrono::{DateTime, Utc};
use lazy_regex::regex_is_match;
use serde::{Deserialize, Serialize};

use crate::domain::models::GitaiError;

/// The one repository the read API answers for, as `host/owner/name`.
pub const REPOSITORY: &str = "github.com/macro-inc/macro";

/// The same repository as GitHub's API names it.
pub const GITHUB_REPOSITORY: &str = "macro-inc/macro";

/// Where a session's index entry is served, under the gateway prefix.
const SESSION_URL_PREFIX: &str = "/gitai/v1/sessions/";

/// Longest session id accepted.
const MAX_SESSION_ID_LEN: usize = 128;

/// A full or abbreviated commit SHA, lowercase hex.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CommitSha(String);

/// Length of a full SHA-1 commit id.
const FULL_SHA_LEN: usize = 40;

impl CommitSha {
    /// 7 to 40 hex characters, lowercased.
    pub fn parse(raw: &str) -> Result<Self, GitaiError> {
        let sha = raw.trim().to_ascii_lowercase();
        if !regex_is_match!("^[0-9a-f]{7,40}$", &sha) {
            return Err(GitaiError::BadRequest("sha is not a commit id".to_owned()));
        }
        Ok(Self(sha))
    }

    /// Whether it is a full 40-character SHA, the form commits are stored by.
    pub fn is_full(&self) -> bool {
        self.0.len() == FULL_SHA_LEN
    }

    /// The hex text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A git-ai session id (`s_…`, or a legacy prompt hash).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SessionId(String);

impl SessionId {
    /// Letters, digits, `_` and `-`, at most 128 characters.
    pub fn parse(raw: &str) -> Result<Self, GitaiError> {
        let valid = raw.len() <= MAX_SESSION_ID_LEN && regex_is_match!("^[A-Za-z0-9_-]+$", raw);
        if !valid {
            return Err(GitaiError::BadRequest("session id is malformed".to_owned()));
        }
        Ok(Self(raw.to_owned()))
    }

    /// The id.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Token totals.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct Tokens {
    /// Input tokens.
    pub input: u64,
    /// Output tokens.
    pub output: u64,
    /// Cache read tokens.
    pub cache_read: u64,
    /// Cache write tokens.
    pub cache_write: u64,
}

impl AddAssign for Tokens {
    fn add_assign(&mut self, other: Self) {
        self.input += other.input;
        self.output += other.output;
        self.cache_read += other.cache_read;
        self.cache_write += other.cache_write;
    }
}

/// Millionths of a dollar as dollars.
pub fn micro_usd_to_usd(micro_usd: u64) -> f64 {
    // Exact for any cost below 2^53 micro-dollars ($9 billion).
    micro_usd as f64 / 1_000_000.0
}

/// Unix seconds as a time; `None` when out of range.
pub fn from_unix_seconds(seconds: u64) -> Option<DateTime<Utc>> {
    DateTime::from_timestamp(i64::try_from(seconds).ok()?, 0)
}

/// A session a commit's note names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitSession {
    /// git-ai session id.
    pub session_id: String,
    /// Agent, from the note.
    pub tool: Option<String>,
    /// Model, from the note.
    pub model: Option<String>,
}

/// A commit's index entry, as the read side needs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredCommit {
    /// Full SHA.
    pub sha: String,
    /// Lines agents added.
    pub ai_lines: u64,
    /// Lines a person added.
    pub human_lines: u64,
    /// Sessions the note names.
    pub sessions: Vec<CommitSession>,
    /// The note's key in the events bucket.
    pub note_key: Option<String>,
    /// Credential email of whoever committed it.
    pub author: Option<String>,
}

/// A session's index entry.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StoredSession {
    /// git-ai session id.
    pub id: String,
    /// Agent.
    pub tool: Option<String>,
    /// Latest known model.
    pub model: Option<String>,
    /// Credential email of whoever uploaded it.
    pub author: Option<String>,
    /// Repository (`host/owner/name`).
    pub repository: Option<String>,
    /// Earliest transcript line (unix s).
    pub first_seen: Option<u64>,
    /// Latest transcript line (unix s).
    pub last_seen: Option<u64>,
    /// Transcript lines stored.
    pub event_count: u64,
    /// Token totals.
    pub tokens: Tokens,
    /// Cost in millionths of a dollar.
    pub cost_micro_usd: u64,
    /// Commits it wrote lines of.
    pub commit_shas: Vec<String>,
}

/// One stored transcript chunk of a session, in time order by `sort_key`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscriptChunk {
    /// The chunk's sort key in the index (`CHUNK#<ts>#<id>`).
    pub sort_key: String,
    /// The object in the sessions bucket.
    pub s3_key: String,
}

/// A pull request's commits as GitHub listed them, cached until
/// `expires_at`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedPullRequest {
    /// Pull request number.
    pub number: u64,
    /// Its commits, oldest first.
    pub commits: Vec<String>,
    /// Whether it was open when fetched.
    pub open: bool,
    /// When to ask GitHub again.
    pub expires_at: DateTime<Utc>,
}

/// Which pull request a commit's subject names, cached until `expires_at`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitPullRequestLink {
    /// Full SHA.
    pub sha: String,
    /// The `(#N)` at the end of the subject, if any.
    pub pr_number: Option<u64>,
    /// When to ask GitHub again.
    pub expires_at: DateTime<Utc>,
}

/// A commit as GitHub reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubCommit {
    /// Full SHA.
    pub sha: String,
    /// First line of the message.
    pub subject: String,
}

/// A pull request as GitHub reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GithubPullRequest {
    /// Number.
    pub number: u64,
    /// Open, so its commits can still change.
    pub open: bool,
}

/// Consecutive lines that one commit last changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlameHunk {
    /// First line, 1-based.
    pub start: u32,
    /// Last line, inclusive.
    pub end: u32,
    /// Full SHA.
    pub commit: String,
}

/// GitHub's blame of one file at one revision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubBlame {
    /// The commit the revision resolved to.
    pub commit: String,
    /// Hunks covering the whole file, in line order.
    pub hunks: Vec<BlameHunk>,
}

/// How a commit's attribution was found.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolvedVia {
    /// From the commit's own note.
    Note,
    /// Through the pull request its subject names (a squash merge).
    Pr,
}

/// A pull request reference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PullRequestRef {
    /// Number.
    pub number: u64,
    /// Its GitHub page.
    pub url: String,
}

impl PullRequestRef {
    /// The reference to pull request `number` of [`GITHUB_REPOSITORY`].
    pub fn new(number: u64) -> Self {
        Self {
            number,
            url: format!("https://github.com/{GITHUB_REPOSITORY}/pull/{number}"),
        }
    }
}

/// One session's part in a commit or pull request.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SessionSummary {
    /// git-ai session id.
    pub id: String,
    /// Agent.
    pub tool: Option<String>,
    /// Model.
    pub model: Option<String>,
    /// Credential email of whoever ran it.
    pub author: Option<String>,
    /// Earliest transcript line.
    pub first_seen: Option<DateTime<Utc>>,
    /// Latest transcript line.
    pub last_seen: Option<DateTime<Utc>>,
    /// Lines its notes attribute to it in these commits.
    pub ai_lines: u64,
    /// The whole session's tokens, not only this commit's share.
    pub tokens: Tokens,
    /// The whole session's cost, not only this commit's share.
    pub cost_usd: f64,
    /// Its index entry.
    pub url: String,
    /// Its transcript.
    pub events_url: String,
}

impl SessionSummary {
    /// `url` and `events_url` of a session.
    pub fn urls(id: &str) -> (String, String) {
        let url = format!("{SESSION_URL_PREFIX}{id}");
        let events_url = format!("{url}/events");
        (url, events_url)
    }
}

/// `GET /v1/commits/{sha}` and `GET /v1/prs/macro-inc/macro/{n}`. A commit
/// or pull request GitHub knows but with no stored notes is answered with
/// every commit unattributed and no sessions (the contract says 404; 404 here
/// means nothing is known at all).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Attribution {
    /// Always [`REPOSITORY`].
    pub repo: &'static str,
    /// The commit asked about (commit lookups only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,
    /// The pull request it resolved through.
    pub pr: Option<PullRequestRef>,
    /// How it was resolved.
    pub resolved_via: ResolvedVia,
    /// The commits counted: the commit, or the pull request's commits.
    pub commits: Vec<String>,
    /// Commits in `commits` with no stored note. Their lines are unknown and
    /// not in the totals.
    pub unattributed_commits: Vec<String>,
    /// Lines agents added, over the attributed commits.
    pub ai_lines: u64,
    /// Lines people added, over the attributed commits.
    pub human_lines: u64,
    /// `ai_lines / (ai_lines + human_lines)`; `None` when both are zero.
    pub ai_share: Option<f64>,
    /// Tokens of the sessions: each session's whole-life total, so a
    /// session that also wrote other commits counts in full here too.
    pub tokens: Tokens,
    /// Cost of the sessions, whole-life totals like `tokens`.
    pub cost_usd: f64,
    /// The sessions, most lines first.
    pub sessions: Vec<SessionSummary>,
}

/// `GET /v1/sessions/{id}`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SessionEntry {
    /// git-ai session id.
    pub id: String,
    /// Agent.
    pub tool: Option<String>,
    /// Latest known model.
    pub model: Option<String>,
    /// Credential email of whoever uploaded it.
    pub author: Option<String>,
    /// Repository (`host/owner/name`).
    pub repo: Option<String>,
    /// Earliest transcript line.
    pub first_seen: Option<DateTime<Utc>>,
    /// Latest transcript line.
    pub last_seen: Option<DateTime<Utc>>,
    /// Transcript lines stored.
    pub event_count: u64,
    /// Token totals.
    pub tokens: Tokens,
    /// Cost.
    pub cost_usd: f64,
    /// Commits it wrote lines of.
    pub commits: Vec<String>,
}

impl From<StoredSession> for SessionEntry {
    fn from(session: StoredSession) -> Self {
        Self {
            id: session.id,
            tool: session.tool,
            model: session.model,
            author: session.author,
            repo: session.repository,
            first_seen: session.first_seen.and_then(from_unix_seconds),
            last_seen: session.last_seen.and_then(from_unix_seconds),
            event_count: session.event_count,
            tokens: session.tokens,
            cost_usd: micro_usd_to_usd(session.cost_micro_usd),
            commits: session.commit_shas,
        }
    }
}

/// `GET /v1/sessions/{id}/events`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EventsPage {
    /// Redacted transcript lines, oldest first.
    pub events: Vec<serde_json::Value>,
    /// Cursor of the next page; `None` on the last.
    pub next: Option<String>,
}

/// Where a transcript page starts: a chunk and a line within it. Sent to
/// clients base64url-encoded, so they treat it as opaque.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventsCursor {
    /// Sort key of the chunk.
    pub chunk: String,
    /// Lines of that chunk already returned.
    pub offset: usize,
}

/// `GET /v1/blame` parameters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlameQuery {
    /// File path in the repository.
    pub path: String,
    /// First line, 1-based.
    pub start: u32,
    /// Last line, inclusive.
    pub end: u32,
    /// Branch, tag or SHA; `main` when absent.
    pub rev: Option<String>,
}

/// One line range of a blame answer.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BlameRange {
    /// First line.
    pub start: u32,
    /// Last line, inclusive.
    pub end: u32,
    /// The commit that last changed these lines.
    pub commit: String,
    /// The session that wrote them, when it is known.
    pub session_id: Option<String>,
    /// Its agent.
    pub tool: Option<String>,
    /// Its model.
    pub model: Option<String>,
    /// Who ran it.
    pub author: Option<String>,
    /// When `session_id` is unknown because several sessions wrote lines of
    /// this file in that commit: those sessions, most lines first.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub session_ids: Vec<String>,
}

/// `GET /v1/blame`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Blame {
    /// File path.
    pub path: String,
    /// The revision asked for.
    pub rev: String,
    /// Ranges in line order.
    pub ranges: Vec<BlameRange>,
}
