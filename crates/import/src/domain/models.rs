//! Pure data model for the import pipeline: sources, statuses, per-source
//! metadata shapes, and foreign-id normalization. Everything here is
//! side-effect free.

use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

mod linear;
mod notion;
pub use linear::*;
pub use notion::*;

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

    /// The Pipedream app slugs backing this source's connector, in preference order.
    pub fn pipedream_app_slugs(self) -> &'static [&'static str] {
        match self {
            ImportSource::Linear => &["linear"],
            ImportSource::Notion => &["notion"],
            // Keep the canonical fallback from docs/SLACK_LIVE_CHANNEL_IMPORT.md
            // until live verification supports switching to `slack_v2`.
            ImportSource::Slack => &["slack", "slack_v2"],
        }
    }

    /// This source's connector on both MCP stacks.
    pub fn connector_ref(self) -> mcp_select::ConnectorRef<'static> {
        mcp_select::ConnectorRef {
            pipedream_app_slugs: self.pipedream_app_slugs(),
            native_server_url: self.mcp_server_url(),
        }
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
    /// Imported from an administrator-uploaded archive.
    Archive,
    /// Staged by the user from Settings (the pick-channels flow).
    Manual,
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

/// A stable Slack conversation ID, never a legacy channel name.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SlackConversationId(String);

impl SlackConversationId {
    /// Validate the source ID without trimming or name normalization.
    pub fn new(value: &str) -> Option<Self> {
        valid_slack_id(value, b"CGD").then(|| Self(value.to_owned()))
    }

    /// The exact source identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A stable Slack user ID.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SlackUserId(String);

impl SlackUserId {
    /// Validate the source ID without trimming or name normalization.
    pub fn new(value: &str) -> Option<Self> {
        valid_slack_id(value, b"UW").then(|| Self(value.to_owned()))
    }

    /// The exact source identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// The kind of conversation reported by Slack.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlackConversationKind {
    /// A public workspace channel.
    PublicChannel,
    /// An invite-only workspace channel.
    PrivateChannel,
    /// A one-to-one direct message.
    DirectMessage,
    /// A multi-person direct message.
    GroupDirectMessage,
}

/// A conversation read from a live Slack workspace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackConversation {
    /// Stable source identity.
    pub id: SlackConversationId,
    /// Conversation name.
    pub name: String,
    /// Source conversation kind, independent of the Macro target kind.
    pub kind: SlackConversationKind,
    /// Whether Slack has archived this conversation.
    pub archived: bool,
    /// Member count reported by Slack, when available.
    pub member_count: Option<u64>,
    /// Conversation purpose, when set.
    pub purpose: Option<String>,
}

/// One page of live Slack conversations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackConversationPage {
    /// Conversations on this page.
    pub conversations: Vec<SlackConversation>,
    /// Opaque continuation cursor; `None` means the final page.
    pub next_cursor: Option<String>,
}

/// One page of a live Slack conversation's members.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackMemberPage {
    /// Slack user IDs on this page.
    pub members: Vec<SlackUserId>,
    /// Opaque continuation cursor; `None` means the final page.
    pub next_cursor: Option<String>,
}

/// A user read from a live Slack workspace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackUser {
    /// Stable source identity.
    pub id: SlackUserId,
    /// Display name reported by Slack.
    pub display_name: String,
    /// Email, when the workspace exposes it.
    pub email: Option<String>,
    /// Whether this user is a bot.
    pub is_bot: bool,
    /// Whether this user has been deactivated.
    pub deleted: bool,
}

/// One page of live Slack users.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackUserPage {
    /// Users on this page.
    pub users: Vec<SlackUser>,
    /// Opaque continuation cursor; `None` means the final page.
    pub next_cursor: Option<String>,
}

/// A stable Slack workspace ID.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackWorkspaceId(String);

impl SlackWorkspaceId {
    /// Validate a Slack workspace ID.
    pub fn new(value: &str) -> Option<Self> {
        valid_slack_id(value, b"T").then(|| Self(value.to_owned()))
    }

    /// The exact source identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

fn valid_slack_id(value: &str, prefixes: &[u8]) -> bool {
    (2..=64).contains(&value.len())
        && prefixes.contains(&value.as_bytes()[0])
        && value
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
}

/// Durable single-workspace binding for a Macro team. Absence of this row means unbound.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportSourceBinding {
    /// Known workspace, if the source supplied identity.
    pub workspace_id: Option<SlackWorkspaceId>,
    /// First explicit administrator confirmation of an unidentified archive.
    pub confirmed_unknown_at: Option<DateTime<Utc>>,
}

/// Explicit canonical namespace. This API supports only the Slack source in v1;
/// it never derives the team from the requesting user's current membership.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportTargetKey {
    /// Team that owns the source namespace, including private/DM provenance.
    pub team_id: Uuid,
    /// Stable source identity, not a name-only onboarding identifier.
    pub foreign_id: SlackConversationId,
}

/// Allowed target shapes. Slack public channels become Team, never Public.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum ImportTargetKind {
    /// Shared with exactly the explicitly supplied team.
    Team,
    /// Private channel or group DM; team provenance lives only in the reservation.
    Private,
    /// Two-person DM; pair validation/authorization belongs to the channel service.
    DirectMessage,
}

/// A committed reservation survives crashes before channel creation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportTargetReservation {
    /// Canonical source namespace.
    pub key: ImportTargetKey,
    /// Stable UUID to pass to idempotent channel creation, or an existing claimed target.
    pub channel_id: Uuid,
    /// Whether channel creation has been durably completed.
    pub ready: bool,
}

/// Maximum exact source IDs per canonical read; validated IDs bound input bytes
/// to 32 KiB, below the archive database batch byte ceiling.
pub const MAX_TARGET_LOOKUP: usize = 500;

/// Read-only canonical mapping state. Pending candidates are deliberately hidden.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportTargetLookup {
    /// No unambiguous, compatible target exists.
    Missing,
    /// Creation has not durably completed.
    Pending,
    /// Existing compatible channel; provenance is not a read-access grant.
    Ready {
        /// Canonical channel identity.
        channel_id: Uuid,
        /// Persisted channel kind.
        kind: ImportTargetKind,
        /// Persisted name, disclose only after authorization.
        name: String,
    },
}

// ---------------------------------------------------------------------------
// Per-source metadata
// ---------------------------------------------------------------------------

/// Caps applied to metadata text at the tool write boundary, so a chatty
/// agent can't bloat rows.
const MAX_TEXT: usize = 300;
/// Cap for long-form text (issue descriptions, imported verbatim). Generous:
/// Linear descriptions are Markdown documents in their own right.
const MAX_LONG_TEXT: usize = 200_000;
/// Cap for summaries and purposes.
const MAX_SUMMARY: usize = 600;
/// Cap on matched Slack participants, bounded by Macro team size, not channel size.
const MAX_PARTICIPANTS: usize = 100;
/// Cap on imported document properties.
const MAX_PROPERTIES: usize = 50;
/// Cap on values of one imported property (and on tags).
const MAX_PROPERTY_VALUES: usize = 25;

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
///
/// Discovery fills every field from Linear's API; chat agents staging an
/// issue by hand may fill only the original label fields, so everything
/// beyond `title` is optional and older rows keep deserializing.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
pub struct LinearIssueMeta {
    /// Linear's human identifier (e.g. `ENG-142`).
    pub identifier: Option<String>,
    /// Issue title.
    pub title: String,
    /// The issue's Markdown description, verbatim.
    pub description: Option<String>,
    /// Workflow state name (e.g. `In Progress`).
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
    /// Linear's stable issue id (a UUID), when read from the API.
    #[serde(default)]
    #[schema(ignore)]
    pub linear_id: Option<String>,
    /// The workflow state's type, which status mapping keys on.
    #[serde(default)]
    #[schema(ignore)]
    pub state_type: Option<LinearStateType>,
    /// When the issue last changed in Linear (RFC 3339). Kept so a future
    /// re-import can update instead of duplicating.
    #[serde(default)]
    #[schema(ignore)]
    pub updated_at: Option<String>,
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
            linear_id: truncate_opt(self.linear_id, MAX_TEXT),
            state_type: self.state_type,
            updated_at: truncate_opt(self.updated_at, MAX_TEXT),
        }
    }
}

/// Metadata for one staged Notion page. Deliberately has NO content field:
/// page bodies are fetched at import time, for accepted pages only.
///
/// Discovery records the page facts the import needs (so it never re-reads
/// the page object); chat staging may record only `title`/`url`, so every
/// field beyond `title` is optional and older rows keep deserializing.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema, ToSchema)]
pub struct NotionDocMeta {
    /// Page title.
    pub title: String,
    /// Deep link back to the page in Notion.
    pub url: Option<String>,
    /// One-line summary of what the page contains.
    pub summary: Option<String>,
    /// The page's emoji icon, when it has one.
    #[serde(default)]
    #[schema(ignore)]
    pub icon_emoji: Option<String>,
    /// When the page was last edited in Notion (RFC 3339). Kept so a future
    /// re-import can update instead of duplicating.
    #[serde(default)]
    #[schema(ignore)]
    pub last_edited_time: Option<String>,
    /// Whether the connected user made the last edit; `None` when the
    /// connection's owner is not a person.
    #[serde(default)]
    #[schema(ignore)]
    pub edited_by_user: Option<bool>,
    /// Where the page lives in Notion.
    #[serde(default)]
    #[schema(ignore)]
    pub parent: Option<NotionParent>,
    /// Database-row properties, mapped to Macro property values.
    #[serde(default)]
    #[schema(ignore)]
    pub properties: Option<ImportedDocumentProperties>,
}

impl NotionDocMeta {
    fn capped(self) -> Self {
        Self {
            title: truncated(self.title, MAX_TEXT),
            url: truncate_opt(self.url, MAX_TEXT),
            summary: truncate_opt(self.summary, MAX_SUMMARY),
            icon_emoji: truncate_opt(self.icon_emoji, 32),
            last_edited_time: truncate_opt(self.last_edited_time, MAX_TEXT),
            edited_by_user: self.edited_by_user,
            parent: self.parent,
            properties: self.properties.map(ImportedDocumentProperties::capped),
        }
    }
}

/// Properties recovered from a Notion page and attached to the imported
/// Macro document. The creator applies these best-effort after the document
/// exists, so unsupported or invalid values never prevent the body import.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportedDocumentProperties {
    /// Ordinary Notion database properties.
    #[serde(default)]
    pub values: Vec<ImportedDocumentProperty>,
    /// Notion tag/label values, mapped onto Macro's personal tag set.
    #[serde(default)]
    pub tags: Vec<String>,
}

impl ImportedDocumentProperties {
    /// Bound what ledger metadata carries.
    fn capped(self) -> Self {
        Self {
            values: self
                .values
                .into_iter()
                .take(MAX_PROPERTIES)
                .map(|property| ImportedDocumentProperty {
                    name: truncated(property.name, MAX_TEXT),
                    value: property.value.capped(),
                })
                .collect(),
            tags: self
                .tags
                .into_iter()
                .take(MAX_PROPERTY_VALUES)
                .map(|tag| truncated(tag, MAX_TEXT))
                .collect(),
        }
    }
}

impl ImportedDocumentPropertyValue {
    fn capped(self) -> Self {
        let cap = |values: Vec<String>| -> Vec<String> {
            values
                .into_iter()
                .take(MAX_PROPERTY_VALUES)
                .map(|value| truncated(value, MAX_TEXT))
                .collect()
        };
        match self {
            Self::String { value } => Self::String {
                value: truncated(value, MAX_TEXT),
            },
            Self::Date { value } => Self::Date {
                value: truncated(value, MAX_TEXT),
            },
            Self::Select { values, multi } => Self::Select {
                values: cap(values),
                multi,
            },
            Self::Link { urls, multi } => Self::Link {
                urls: cap(urls),
                multi,
            },
            other @ (Self::Boolean { .. } | Self::Number { .. }) => other,
        }
    }
}

/// One named property recovered from a Notion database page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportedDocumentProperty {
    /// Property display name.
    pub name: String,
    /// Typed property value.
    pub value: ImportedDocumentPropertyValue,
}

/// Portable property values that have direct Macro property equivalents.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum ImportedDocumentPropertyValue {
    /// Boolean value.
    Boolean {
        /// Imported value.
        value: bool,
    },
    /// Date or date-time value, encoded as ISO-8601.
    Date {
        /// Imported value.
        value: String,
    },
    /// Numeric value.
    Number {
        /// Imported value.
        value: f64,
    },
    /// Plain text value.
    String {
        /// Imported value.
        value: String,
    },
    /// One or more select labels.
    Select {
        /// Imported option labels.
        values: Vec<String>,
        /// Whether the source property accepts multiple options.
        multi: bool,
    },
    /// One or more URLs.
    Link {
        /// Imported URLs.
        urls: Vec<String>,
        /// Whether the source property accepts multiple links.
        multi: bool,
    },
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
    /// Slack members matched to the Macro team roster when discovery resolved membership.
    #[serde(default)]
    pub participants: Vec<SlackParticipant>,
    /// Total human members in the Slack channel.
    #[serde(default)]
    pub member_count: Option<u64>,
    /// Whether Slack has archived this channel.
    #[serde(default)]
    pub archived: bool,
    /// Whether `participants` reflects a live membership read.
    #[serde(default)]
    pub members_resolved: bool,
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
            member_count: self.member_count,
            archived: self.archived,
            members_resolved: self.members_resolved,
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
        .map(str::trim)
        .filter(|label| !label.is_empty())
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
