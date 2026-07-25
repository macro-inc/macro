//! Pure data model for the import pipeline: sources, statuses, per-source
//! metadata shapes, and foreign-id normalization. Everything here is
//! side-effect free.

use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// External systems items can be imported from.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    JsonSchema,
    ToSchema,
    strum::EnumString,
    strum::AsRefStr,
    strum::EnumIter,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ImportSource {
    /// Linear issues, imported as Macro tasks.
    Linear,
    /// Notion pages, imported as Macro markdown documents.
    Notion,
    /// Slack channels, recreated as Macro channels.
    Slack,
}

impl ImportSource {
    /// All import sources.
    pub fn all() -> [ImportSource; 3] {
        [
            ImportSource::Linear,
            ImportSource::Notion,
            ImportSource::Slack,
        ]
    }

    /// The MCP server URL backing this source's connector.
    pub fn mcp_server_url(self) -> &'static str {
        match self {
            ImportSource::Linear => "https://mcp.linear.app/mcp",
            ImportSource::Notion => "https://mcp.notion.com/mcp",
            ImportSource::Slack => "https://mcp.slack.com/mcp",
        }
    }

    /// The Macro entity type items from this source become. The mapping is
    /// fixed — importers have latitude on content, never on shape.
    pub fn entity_type(self) -> &'static str {
        match self {
            ImportSource::Linear => "task",
            ImportSource::Notion => "md",
            ImportSource::Slack => "channel",
        }
    }

    /// Normalize a raw foreign id for this source: trimmed, with
    /// source-specific canonicalization (Notion URLs collapse to the 32-hex
    /// page id, Slack names keep a single leading `#`). `None` when the raw
    /// id is empty.
    pub fn normalize_foreign_id(self, raw: &str) -> Option<String> {
        let raw = raw.trim();
        if raw.is_empty() {
            return None;
        }
        Some(match self {
            ImportSource::Linear => raw.to_string(),
            // Page ids survive renames; URLs don't. Accept either and store
            // the id whenever one is present.
            ImportSource::Notion => notion_page_id(raw).unwrap_or_else(|| raw.to_string()),
            ImportSource::Slack => {
                // Slack channel ids (`C0123ABCD…`) pass through; a bare or
                // `#`-prefixed name normalizes to `#name`.
                if raw.starts_with('C')
                    && raw.len() >= 9
                    && raw.chars().all(|c| c.is_ascii_alphanumeric())
                {
                    raw.to_string()
                } else {
                    format!("#{}", raw.trim_start_matches('#'))
                }
            }
        })
    }
}

/// Lifecycle of one import entity.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    JsonSchema,
    ToSchema,
    strum::EnumString,
    strum::AsRefStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ImportStatus {
    /// Discovered and offered, not yet accepted.
    Staged,
    /// Accepted; an import job is copying it in.
    Importing,
    /// A Macro entity exists for it (`entity_id`/`entity_type` are set).
    Imported,
    /// The user declined it. Remembered so re-gathers don't re-stage it.
    Discarded,
}

/// Where an import entity was first staged from. Provenance only — never a
/// visibility filter.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    JsonSchema,
    ToSchema,
    strum::EnumString,
    strum::AsRefStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Initiator {
    /// Staged by the onboarding gather job (`/setup`).
    Onboarding,
    /// Staged by an AI chat session.
    Chat,
}

/// Lifecycle of a gather run (one per user × source).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    strum::EnumString,
    strum::AsRefStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum RunStatus {
    /// A gather job is discovering candidates.
    Running,
    /// The gather finished; staged rows (if any) are ready.
    Ready,
    /// The gather finished and its configured automatic import is running.
    Importing,
    /// The configured automatic import finished successfully.
    Completed,
    /// Gathering or automatic importing failed; `error` has details.
    /// Retryable.
    Failed,
    /// The user dismissed this source's import section.
    Dismissed,
}

// ---------------------------------------------------------------------------
// Per-source metadata
// ---------------------------------------------------------------------------

/// Caps applied to metadata text at the tool write boundary, so a chatty
/// agent can't bloat rows.
const MAX_TEXT: usize = 300;
/// Cap for long-form text (issue descriptions).
const MAX_LONG_TEXT: usize = 4_000;
/// Cap for summaries and purposes.
const MAX_SUMMARY: usize = 600;
/// Cap on Slack participant lists.
const MAX_PARTICIPANTS: usize = 25;

/// Truncate to a character boundary at most `max` bytes in.
fn truncated(s: String, max: usize) -> String {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    let mut s = s;
    s.truncate(end);
    s
}

fn truncate_opt(s: Option<String>, max: usize) -> Option<String> {
    s.map(|s| truncated(s, max))
        .filter(|s| !s.trim().is_empty())
}

/// Metadata for one staged Linear issue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
pub struct LinearIssueMeta {
    /// Linear's human identifier (e.g. `ENG-142`).
    pub identifier: Option<String>,
    /// Issue title.
    pub title: String,
    /// Short markdown description.
    pub description: Option<String>,
    /// Workflow status name (e.g. `In Progress`).
    pub status: Option<String>,
    /// Priority label (e.g. `Urgent`).
    pub priority: Option<String>,
    /// Assignee display name as Linear reports it.
    pub assignee: Option<String>,
    /// Assignee email, when Linear exposes it.
    pub assignee_email: Option<String>,
    /// Due date as an ISO date (`YYYY-MM-DD`), when set.
    #[serde(default)]
    pub due_date: Option<String>,
    /// Deep link back to the issue in Linear.
    pub url: Option<String>,
}

impl LinearIssueMeta {
    fn capped(self) -> Self {
        Self {
            identifier: truncate_opt(self.identifier, MAX_TEXT),
            title: truncated(self.title, MAX_TEXT),
            description: truncate_opt(self.description, MAX_LONG_TEXT),
            status: truncate_opt(self.status, MAX_TEXT),
            priority: truncate_opt(self.priority, MAX_TEXT),
            assignee: truncate_opt(self.assignee, MAX_TEXT),
            assignee_email: truncate_opt(self.assignee_email, MAX_TEXT),
            due_date: truncate_opt(self.due_date, MAX_TEXT),
            url: truncate_opt(self.url, MAX_TEXT),
        }
    }
}

/// Metadata for one staged Notion page. Deliberately has NO content field:
/// page bodies are fetched at import time, for accepted pages only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
pub struct NotionDocMeta {
    /// Page title.
    pub title: String,
    /// Deep link back to the page in Notion.
    pub url: Option<String>,
    /// One-line summary of what the page contains.
    pub summary: Option<String>,
}

impl NotionDocMeta {
    fn capped(self) -> Self {
        Self {
            title: truncated(self.title, MAX_TEXT),
            url: truncate_opt(self.url, MAX_TEXT),
            summary: truncate_opt(self.summary, MAX_SUMMARY),
        }
    }
}

/// A person active in a staged Slack channel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
pub struct SlackParticipant {
    /// Display name or Slack handle.
    pub name: String,
    /// Email, when the workspace exposes it.
    pub email: Option<String>,
}

/// Metadata for one staged Slack channel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
pub struct SlackChannelMeta {
    /// Channel name without the leading `#`.
    pub name: String,
    /// Slack's channel id (e.g. `C0123456789`), stable across renames.
    pub channel_id: Option<String>,
    /// The channel's purpose/topic, when set.
    pub purpose: Option<String>,
    /// The channel's most relevant members, when discoverable.
    #[serde(default)]
    pub participants: Vec<SlackParticipant>,
}

impl SlackChannelMeta {
    fn capped(self) -> Self {
        Self {
            name: truncated(self.name, MAX_TEXT),
            channel_id: truncate_opt(self.channel_id, MAX_TEXT),
            purpose: truncate_opt(self.purpose, MAX_SUMMARY),
            participants: self
                .participants
                .into_iter()
                .take(MAX_PARTICIPANTS)
                .map(|p| SlackParticipant {
                    name: truncated(p.name, MAX_TEXT),
                    email: truncate_opt(p.email, MAX_TEXT),
                })
                .collect(),
        }
    }
}

/// Validate raw metadata against `source`'s shape and re-serialize it with
/// caps applied. Unknown fields are dropped; missing required fields error.
pub fn validate_metadata(
    source: ImportSource,
    metadata: serde_json::Value,
) -> Result<serde_json::Value, serde_json::Error> {
    match source {
        ImportSource::Linear => {
            serde_json::to_value(serde_json::from_value::<LinearIssueMeta>(metadata)?.capped())
        }
        ImportSource::Notion => {
            serde_json::to_value(serde_json::from_value::<NotionDocMeta>(metadata)?.capped())
        }
        ImportSource::Slack => {
            serde_json::to_value(serde_json::from_value::<SlackChannelMeta>(metadata)?.capped())
        }
    }
}

/// A human label for an entity, pulled from its metadata (for logs, agent
/// prompts, and tool responses).
pub fn metadata_label(source: ImportSource, metadata: &serde_json::Value) -> String {
    let field = match source {
        ImportSource::Linear | ImportSource::Notion => "title",
        ImportSource::Slack => "name",
    };
    metadata
        .get(field)
        .and_then(|v| v.as_str())
        .unwrap_or("(unnamed)")
        .to_string()
}

/// Extract the Notion page id from a page URL: the trailing 32-hex token
/// (with or without UUID dashes), normalized to undashed lowercase.
fn notion_page_id(url: &str) -> Option<String> {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let segment = path.trim_end_matches('/').rsplit('/').next()?;
    let is_hex = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_hexdigit());

    // Undashed form: the whole segment, or the slug's last `-` token
    // (`Page-Title-<32hex>`).
    let tail = segment.rsplit('-').next().unwrap_or(segment);
    if tail.len() == 32 && is_hex(tail) {
        return Some(tail.to_lowercase());
    }

    // Dashed UUID form at the end of the segment (`…-8-4-4-4-12`).
    let candidate = segment.get(segment.len().checked_sub(36)?..)?;
    let dashes_ok = [8, 13, 18, 23]
        .iter()
        .all(|&i| candidate.as_bytes().get(i) == Some(&b'-'));
    let undashed: String = candidate.chars().filter(|c| *c != '-').collect();
    (dashes_ok && undashed.len() == 32 && is_hex(&undashed)).then(|| undashed.to_lowercase())
}

// ---------------------------------------------------------------------------
// Rows and aggregates
// ---------------------------------------------------------------------------

/// One row of the import ledger.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ImportEntity {
    /// Ledger row id.
    pub id: Uuid,
    /// The user who staged/imported it. Team-imported rows from teammates
    /// are visible with their owner's id, so clients can say "created by a
    /// teammate".
    pub user_id: String,
    /// The team the created entity was shared with, when it was.
    pub team_id: Option<Uuid>,
    /// The external system the item comes from.
    pub source: ImportSource,
    /// Stable id in the source system (see
    /// [`ImportSource::normalize_foreign_id`]).
    pub foreign_id: String,
    /// Where the row is in its lifecycle.
    pub status: ImportStatus,
    /// Where it was first staged from.
    pub initiator: Initiator,
    /// Per-source metadata (shape depends on `source`; see
    /// [`LinearIssueMeta`], [`NotionDocMeta`], [`SlackChannelMeta`]).
    pub metadata: serde_json::Value,
    /// The Macro entity it became, once imported.
    pub entity_id: Option<String>,
    /// The Macro entity type (`task` | `md` | `channel`), once imported.
    pub entity_type: Option<String>,
    /// Failure detail from the last import attempt, when one failed.
    pub last_error: Option<String>,
    /// When the row was first staged.
    pub created_at: DateTime<Utc>,
    /// When the row last changed.
    pub updated_at: DateTime<Utc>,
}

/// Gather-run state for one user × source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ImportRun {
    /// The source this run gathered from.
    pub source: ImportSource,
    /// Where the run is in its lifecycle.
    pub status: RunStatus,
    /// Whether this run should import its onboarding-staged candidates as
    /// soon as gathering finishes.
    pub auto_import: bool,
    /// Gather or automatic-import failure detail, when the run failed.
    pub error: Option<String>,
    /// When the run state last changed.
    pub updated_at: DateTime<Utc>,
}

/// The full import aggregate for a user: gather runs plus visible ledger
/// rows (their own, and teammates' team-imported rows).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ImportState {
    /// Gather runs, one per source that ever gathered.
    pub runs: Vec<ImportRun>,
    /// Visible import entities, newest first.
    pub entities: Vec<ImportEntity>,
}
