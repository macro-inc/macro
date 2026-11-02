//! Pure data model for the import pipeline: sources, statuses, per-source
//! metadata shapes, and foreign-id normalization. Everything here is
//! side-effect free.

use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

mod notion_run;
mod notion_sharing;
pub use notion_run::{
    AdoptedRun, NotionJob, ReviewedRun, RunReview, TEAMMATE_STOPPED, TeamClaim, WrittenKind,
    WrittenObject,
};

pub use notion_sharing::{
    NotionAlreadyImported, NotionImporter, NotionSharing, NotionWriteChoices,
};

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
    /// Jira Cloud issues and projects.
    Jira,
    /// Notion pages, imported as Macro markdown documents.
    Notion,
    /// Slack channels, recreated as Macro channels.
    Slack,
}

impl ImportSource {
    /// Display name of the connected provider.
    pub fn label(self) -> &'static str {
        match self {
            Self::Linear => "Linear",
            Self::Jira => "Jira",
            Self::Notion => "Notion",
            Self::Slack => "Slack",
        }
    }

    /// All import sources.
    pub fn all() -> [ImportSource; 4] {
        [
            ImportSource::Linear,
            ImportSource::Jira,
            ImportSource::Notion,
            ImportSource::Slack,
        ]
    }

    /// The Pipedream app slugs backing this source's connector, in preference order.
    pub fn pipedream_app_slugs(self) -> &'static [&'static str] {
        match self {
            ImportSource::Linear => &["linear"],
            ImportSource::Jira => &["jira"],
            ImportSource::Notion => &["notion"],
            // Keep the canonical fallback from docs/runbooks/slack-live-channel-import.md
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
            ImportSource::Jira => "https://mcp.atlassian.com/v1/mcp",
            ImportSource::Notion => "https://mcp.notion.com/mcp",
            ImportSource::Slack => "https://mcp.slack.com/mcp",
        }
    }

    /// The kind of item this source's current import paths stage: Linear
    /// issues, Notion pages, and Slack channels.
    pub fn default_kind(self) -> ImportKind {
        match self {
            ImportSource::Linear => ImportKind::Issue,
            ImportSource::Jira => ImportKind::JiraIssue,
            ImportSource::Notion => ImportKind::Page,
            ImportSource::Slack => ImportKind::Channel,
        }
    }

    /// The Macro entity type items from this source become. The mapping is
    /// fixed — importers have latitude on content, never on shape.
    pub fn entity_type(self) -> &'static str {
        match self {
            ImportSource::Linear | ImportSource::Jira => "task",
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
            ImportSource::Linear | ImportSource::Jira => raw.to_string(),
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

/// What an imported item is in its source system. Each source has its own
/// kinds; a Notion database and a Notion page, or a Linear project and a
/// Linear issue, are tracked and deduplicated separately.
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
pub enum ImportKind {
    /// A Linear issue.
    Issue,
    /// A Linear project.
    Project,
    /// A Linear document.
    Document,
    /// A Notion page.
    Page,
    /// A Notion database.
    Database,
    /// One data source (table) of a Notion database.
    DataSource,
    /// One row of a Notion data source.
    Row,
    /// A Jira issue.
    JiraIssue,
    /// A Jira project.
    JiraProject,
    /// A Jira epic grouping.
    JiraEpic,
    /// A Slack channel.
    Channel,
}

impl ImportKind {
    /// The source this kind of item comes from.
    pub fn source(self) -> ImportSource {
        match self {
            ImportKind::Issue | ImportKind::Project | ImportKind::Document => ImportSource::Linear,
            ImportKind::Page | ImportKind::Database | ImportKind::DataSource | ImportKind::Row => {
                ImportSource::Notion
            }
            ImportKind::JiraIssue | ImportKind::JiraProject | ImportKind::JiraEpic => {
                ImportSource::Jira
            }
            ImportKind::Channel => ImportSource::Slack,
        }
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
    /// The user declined it. Remembered so later discovery doesn't re-stage it.
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
    /// Legacy: staged by the removed onboarding gather. No longer written.
    Onboarding,
    /// Staged by an AI chat session.
    Chat,
    /// Imported from an administrator-uploaded archive.
    Archive,
    /// Staged by the user from Settings (the pick-channels flow).
    Manual,
}

/// Lifecycle of a discovery run (one per user × source).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    JsonSchema,
    strum::EnumString,
    strum::AsRefStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum RunStatus {
    /// Slack discovery is staging candidates, or a Notion workspace import is
    /// being planned.
    Running,
    /// Discovery or planning finished; staged rows (if any) are ready.
    Ready,
    /// An approved Notion workspace import plan is being written.
    Importing,
    /// A Notion workspace import finished writing; `error` notes objects
    /// that could not be imported.
    Completed,
    /// Discovery, planning or writing failed; `error` has details. Retryable.
    Failed,
    /// A Notion workspace import was cancelled. Older rows may hold it from
    /// the removed onboarding import, where it meant a dismissed section.
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
/// Cap for long-form text (issue descriptions).
const MAX_LONG_TEXT: usize = 4_000;
/// Cap for summaries and purposes.
const MAX_SUMMARY: usize = 600;
/// Cap on matched Slack participants, bounded by Macro team size, not channel size.
const MAX_PARTICIPANTS: usize = 100;

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
    /// Where this object sits in a workspace import plan; absent for pages
    /// staged one at a time. Written by the workspace import, never by a
    /// model, so it is left out of the tool schema.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(skip)]
    pub plan: Option<NotionPlanItem>,
}

impl NotionDocMeta {
    /// Metadata for one object of a workspace import plan, capped like
    /// everything else the ledger stores.
    pub fn for_plan(title: String, url: String, plan: NotionPlanItem) -> Self {
        Self {
            title,
            url: Some(url),
            summary: None,
            plan: Some(plan),
        }
        .capped()
    }

    fn capped(self) -> Self {
        Self {
            title: truncated(self.title, MAX_TEXT),
            url: truncate_opt(self.url, MAX_TEXT),
            summary: truncate_opt(self.summary, MAX_SUMMARY),
            plan: self.plan.map(NotionPlanItem::capped),
        }
    }
}

/// What a workspace import does with one Notion object.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema, strum::Display,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum NotionDecision {
    /// Bring it over as it is: a page becomes a document, a data source a
    /// database.
    Copy,
    /// A data source that is really a task list: its rows become Macro tasks.
    Tasks,
    /// Leave it in Notion.
    Skip,
    /// Needs judgment the import cannot make; the agent handles it by hand.
    Hand,
}

/// Which Notion columns hold a task list's task fields, by property name.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotionTaskFields {
    /// The status column.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// The priority column.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    /// The due date column.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due: Option<String>,
    /// The assignee column.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
}

/// One object's place in a workspace import plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotionPlanItem {
    /// What the import does with it; absent while planning has staged the
    /// object but the decision model has not answered for it yet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decision: Option<NotionDecision>,
    /// Why, in a short sentence, when the decision model gave one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Titles of the pages above it, outermost first.
    #[serde(default)]
    pub path: Vec<String>,
    /// For a data source: rows counted while planning.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<u32>,
    /// For a data source: the titles of a few of its rows.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sample_titles: Vec<String>,
    /// For a task list: which columns hold the task fields.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_fields: Option<NotionTaskFields>,
    /// Whether what it becomes is shared with the user's team.
    #[serde(default)]
    pub shared: bool,
    /// Why it is (or is not) shared, when the decision model chose or the
    /// import could not share it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shared_reason: Option<String>,
    /// Whether the user may change `shared`: false for users without a team.
    #[serde(default)]
    pub shareable: bool,
    /// A teammate's copy shared with the team, which this object links to
    /// instead of being imported again.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub already_imported: Option<NotionAlreadyImported>,
}

impl NotionPlanItem {
    fn capped(self) -> Self {
        Self {
            reason: truncate_opt(self.reason, MAX_SUMMARY),
            shared_reason: truncate_opt(self.shared_reason, MAX_SUMMARY),
            already_imported: self.already_imported.map(|copy| NotionAlreadyImported {
                by: truncated(copy.by, MAX_TEXT),
                ..copy
            }),
            path: self
                .path
                .into_iter()
                .take(MAX_PLAN_DEPTH)
                .map(|title| truncated(title, MAX_TEXT))
                .collect(),
            sample_titles: self
                .sample_titles
                .into_iter()
                .take(MAX_SAMPLE_TITLES)
                .map(|title| truncated(title, MAX_TEXT))
                .collect(),
            ..self
        }
    }
}

/// Row titles a plan item keeps for a data source.
const MAX_SAMPLE_TITLES: usize = 5;

/// Deepest ancestor path a plan item records.
const MAX_PLAN_DEPTH: usize = 12;

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
        ImportSource::Linear | ImportSource::Jira => {
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
        ImportSource::Linear | ImportSource::Jira | ImportSource::Notion => "title",
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
    /// What the item is in its source system.
    pub kind: ImportKind,
    /// Stable id in the source system (see
    /// [`ImportSource::normalize_foreign_id`]).
    pub foreign_id: String,
    /// The import row this item was imported under (a subpage's parent page,
    /// a row's database), when it was imported as part of a tree.
    pub parent_id: Option<Uuid>,
    /// The agent session review that approved importing this item, when it
    /// came from one.
    pub review_id: Option<Uuid>,
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
    /// The teammate's row this one waits on: that teammate is writing the
    /// same object for the team, and this row links to their copy once it
    /// is imported.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub waiting_on: Option<Uuid>,
    /// When the row was first staged.
    pub created_at: DateTime<Utc>,
    /// When the row last changed.
    pub updated_at: DateTime<Utc>,
}

/// Discovery-run state for one user × source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ImportRun {
    /// The source this run discovered from.
    pub source: ImportSource,
    /// Where the run is in its lifecycle.
    pub status: RunStatus,
    /// Discovery failure detail, when the run failed.
    pub error: Option<String>,
    /// When the run state last changed.
    pub updated_at: DateTime<Utc>,
    /// What the run has found in the source so far, while it is `running`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scanned: Option<ScanCounts>,
    /// The review presenting the run's plan, once one does. A Notion plan is
    /// presented while it is still `running`; rows staged after that take it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_id: Option<Uuid>,
}

/// What a planning run has found in the source so far.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct ScanCounts {
    /// Pages found.
    pub pages: u32,
    /// Data sources (database tables) found.
    pub data_sources: u32,
}

/// The full import aggregate for a user: discovery runs plus visible ledger
/// rows (their own, and teammates' team-imported rows).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ImportState {
    /// Discovery runs, one per source that ever ran discovery.
    pub runs: Vec<ImportRun>,
    /// Visible import entities, newest first.
    pub entities: Vec<ImportEntity>,
}

/// One object a workspace import report calls out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotionReportItem {
    /// The ledger row.
    pub import_id: Uuid,
    /// The object's title.
    pub title: String,
    /// What the object is.
    pub kind: ImportKind,
    /// Its Notion URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Why it is called out: the decision model's reason, or the failure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Where a Notion workspace import stands.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotionImportReport {
    /// Provider items skipped because they were unreadable, or optional features unavailable.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    /// Tracker issues in the plan.
    #[serde(default)]
    pub issues: u32,
    /// Tracker groups written as Macro projects.
    #[serde(default)]
    pub projects: u32,
    /// The run's state: `running` while planning, `ready` once a plan is
    /// staged, `importing` while writing, `completed`, `failed`, or
    /// `dismissed` when cancelled. Absent before the first run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<RunStatus>,
    /// Why the run failed, when it did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// What planning has found in Notion so far, while it is `running`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scanned: Option<ScanCounts>,
    /// Pages in the plan.
    pub pages: u32,
    /// Data sources (database tables) in the plan.
    pub data_sources: u32,
    /// Plan objects the decision model has not answered for yet, while
    /// planning is still `running`.
    #[serde(default)]
    pub deciding: u32,
    /// Whether the user is on a team. Without one, everything the import
    /// writes stays visible only to them.
    #[serde(default)]
    pub on_team: bool,
    /// Objects to copy as they are.
    pub copy: u32,
    /// Data sources whose rows become tasks.
    pub tasks: u32,
    /// Objects left in Notion.
    pub skip: u32,
    /// Objects that need handling by hand.
    pub hand: u32,
    /// Pages written as documents.
    pub documents: u32,
    /// Data sources written as databases.
    pub databases: u32,
    /// Rows those databases hold, every one counted while planning.
    pub database_rows: u32,
    /// Tasks the task lists become, one per row.
    pub task_rows: u32,
    /// Plan objects already imported.
    pub imported: u32,
    /// Plan objects still waiting to be written.
    pub waiting: u32,
    /// Plan objects being written now.
    pub writing: u32,
    /// Plan objects waiting for a teammate who is writing the same object
    /// for the team; they link to the teammate's copy once it is written.
    #[serde(default)]
    pub waiting_on_teammates: u32,
    /// Written plan objects shared with the user's team.
    #[serde(default)]
    pub shared_with_team: u32,
    /// Plan objects a teammate already imported and shared with the team;
    /// they link to that copy and are not counted as copies.
    #[serde(default)]
    pub already_in_macro: u32,
    /// Who imported the objects already in Macro, most first.
    #[serde(default)]
    pub already_imported_by: Vec<NotionImporter>,
    /// The review the plan is tied to, once presented.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_id: Option<Uuid>,
    /// Objects that need handling by hand, with reasons.
    #[serde(default)]
    pub hand_items: Vec<NotionReportItem>,
    /// Objects that failed to import, with the failure.
    #[serde(default)]
    pub failures: Vec<NotionReportItem>,
}
