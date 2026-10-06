//! Stable review records. Source code bodies are stored separately from metadata.

use chrono::{DateTime, Utc};
use diffd_core::model::{FileDiff, Side, Snapshot, Symbol};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A stable identity shared by revision links, annotations, and conversations.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema, utoipa::ToSchema,
)]
#[serde(transparent)]
pub struct ReviewId(pub Uuid);

/// What content the runtime should compare. The base is pinned after capture.
#[derive(
    Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema,
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Comparison {
    /// Base commit or branch; defaults to HEAD for a new workspace review.
    pub base: Option<String>,
    /// Explicitly switch a fixed-head workspace comparison back to the live worktree.
    #[serde(default)]
    pub worktree: bool,
    /// Optional tip commit; absent keeps the previous workspace tip or follows the PR.
    pub head: Option<String>,
}

/// Source availability shown honestly by the reader.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    /// The runtime can read uncommitted workspace contents.
    Workspace,
    /// Only changes pushed to the linked PR are available.
    PullRequest,
}

/// A complete source capture, before storage assigns the durable revision.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    /// Actual base/head, resolved by the source.
    pub comparison: Comparison,
    /// Repository display name or URL.
    pub repository: String,
    /// Whether this capture includes uncommitted changes.
    pub source: SourceKind,
    /// diffd structural output, including full text and UTF-16 token ranges.
    pub snapshot: Snapshot,
}

/// One file in the manifest, fetched independently by content identity.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// Repository-relative path, including deletions.
    pub path: String,
    /// Original path of a rename.
    pub old_path: Option<String>,
    /// Session-scoped immutable body identifier.
    pub content: String,
    /// Engine file status.
    #[schemars(with = "String")]
    pub status: diffd_core::model::FileStatus,
    /// Language when recognized.
    pub language: Option<String>,
    /// Changed lines on the new side.
    pub added: u32,
    /// Changed lines on the old side.
    pub removed: u32,
    /// Explanation for a collapsed generated file.
    pub collapsed: Option<String>,
    /// Semantic labels from diffd or the agent.
    pub labels: Vec<String>,
    /// Why text is unavailable, when omitted by the source.
    #[schemars(with = "Option<String>")]
    pub omitted: Option<diffd_core::model::Omitted>,
}

/// One immutable revision; older links keep resolving after new captures.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    /// Monotonic, one-based revision number.
    pub number: u32,
    /// Time this revision was published.
    pub created_at: DateTime<Utc>,
    /// The comparison that produced the snapshot.
    pub comparison: Comparison,
    /// Lazy body references.
    pub files: Vec<FileEntry>,
    /// Tour as it was explained for this revision.
    #[serde(default)]
    pub tour: Vec<Chapter>,
    /// Inline explanations belonging to this revision.
    #[serde(default)]
    pub annotations: Vec<Annotation>,
    /// Agent-selected file groups for this revision.
    #[serde(default)]
    pub file_groups: Vec<FileGroup>,
    /// Definitions indexed by diffd across the snapshot.
    #[schemars(with = "Vec<serde_json::Value>")]
    pub symbols: Vec<Symbol>,
}

/// A code reference supplied by a user or agent; lines are one-based, inclusive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Location {
    /// Repository-relative path.
    pub path: String,
    /// Before or after side.
    pub side: Side,
    /// First selected line.
    pub line: u32,
    /// Last selected line; omitted for a single line.
    pub end_line: Option<u32>,
}

/// Reanchoring outcome; an ambiguous match never silently moves a comment.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum AnchorStatus {
    /// The original text still exists at this location.
    Current,
    /// The original text moved to a unique matching location.
    Moved,
    /// The original code changed or disappeared; original context is retained.
    Outdated,
}

/// A durable code link with preserved original context.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Anchor {
    /// Stable identity used in URLs.
    pub id: Uuid,
    /// Revision the author was viewing.
    pub revision: u32,
    /// Original selection.
    pub original: Location,
    /// Exact selected lines, never replaced by a later capture.
    pub excerpt: Vec<String>,
    /// Latest resolved selection.
    pub current: Location,
    /// How the current selection relates to the original.
    pub status: AnchorStatus,
}

/// A chapter authored by the agent. Keys allow idempotent replacement.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Chapter {
    /// Stable agent-supplied key.
    pub key: String,
    /// Short title describing intent.
    pub title: String,
    /// Markdown explanation of why these changes belong together.
    pub description: String,
    /// Reading order of repository-relative files.
    pub paths: Vec<String>,
    /// Initial code selection, validated against the published revision.
    pub focus: Location,
}

/// An explanation pinned next to code.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Annotation {
    /// Stable key, reused to update the explanation.
    pub key: String,
    /// Where this explanation belongs.
    pub location: Location,
    /// Markdown explanation.
    pub body: String,
}

/// A named set of files the reviewer can hide and reveal together.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileGroup {
    /// Stable agent-supplied key.
    pub key: String,
    /// Short label, such as Generated or Tests.
    pub title: String,
    /// Paths, directories, or globs when publishing (e.g. .sqlx/**, **/*.test.ts).
    /// Reads expand these to exact paths in the requested revision.
    pub files: Vec<String>,
    /// Whether these files start hidden. The reader can always reveal them.
    #[serde(default)]
    pub hidden: bool,
}

/// Review metadata the agent can publish or replace.
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Presentation {
    /// Optional short review title.
    pub title: Option<String>,
    /// Optional overall explanation.
    pub summary: Option<String>,
    /// Replace the tour when present; omitted preserves it.
    pub tour: Option<Vec<Chapter>>,
    /// Replace keyed explanations when present; omitted preserves them.
    pub annotations: Option<Vec<Annotation>>,
    /// Replace file groups; omitted preserves them, [] clears them.
    pub file_groups: Option<Vec<FileGroup>>,
}

/// Message author, assigned by authentication rather than client JSON.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Author {
    /// A collaborator with session edit access.
    User {
        /// Authenticated Macro user identifier.
        id: String,
    },
    /// The agent belonging to this review's session.
    Agent,
}

/// Feedback delivery state backed by a durable outbox.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum Delivery {
    /// Saved and waiting for dispatch.
    Pending,
    /// Accepted by the existing session prompt queue.
    Queued,
    /// Permission was revoked or dispatch needs a retry.
    Failed,
}

/// An immutable thread message. Its ID is also its retry key.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    /// Caller-minted UUID reused for network retries.
    pub id: Uuid,
    /// Server-assigned author.
    pub author: Author,
    /// Markdown body.
    pub body: String,
    /// Time accepted by the review store.
    pub created_at: DateTime<Utc>,
    /// Present for human feedback only.
    pub delivery: Option<Delivery>,
}

/// A discussion whose identity survives revisions.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    /// Stable thread identity.
    pub id: Uuid,
    /// Anchor in `Review.anchors`.
    pub anchor: Uuid,
    /// Human-controlled resolution.
    pub resolved: bool,
    /// Ordered, idempotent messages.
    pub messages: Vec<Message>,
}

/// Durable aggregate protected by a compare-and-swap version.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    /// Stable review ID.
    pub id: ReviewId,
    /// Owning session; never supplied by an MCP tool argument.
    pub session_id: Uuid,
    /// Metadata/activity version, independent of code revisions.
    pub version: i64,
    /// Display title.
    pub title: String,
    /// Agent summary.
    pub summary: String,
    /// Repository name or URL.
    pub repository: String,
    /// Availability of uncommitted changes.
    pub source: SourceKind,
    /// Immutable revision history.
    pub revisions: Vec<Revision>,
    /// Current reading tour.
    pub tour: Vec<Chapter>,
    /// Current inline explanations.
    pub annotations: Vec<Annotation>,
    /// Current agent-selected file groups.
    #[serde(default)]
    pub file_groups: Vec<FileGroup>,
    /// Durable selections.
    pub anchors: Vec<Anchor>,
    /// Durable discussion.
    pub threads: Vec<Thread>,
}

/// A validated link returned to the agent.
#[derive(Debug, Clone, Serialize, JsonSchema, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewLink {
    /// Review identity.
    pub review_id: ReviewId,
    /// Code revision, pinned in the URL.
    pub revision: u32,
    /// Canonical Macro URL.
    pub url: String,
}

/// A user comment or reply request.
#[derive(Debug, Clone, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Comment {
    /// UUID reused for retries.
    pub id: Uuid,
    /// Existing thread for a reply; absent creates a new thread.
    pub thread: Option<Uuid>,
    /// Revision the user saw.
    pub revision: u32,
    /// Required for a new thread.
    pub location: Option<Location>,
    /// Markdown comment text.
    pub body: String,
}

/// Review failures safe for inbound adapters to map.
#[derive(Debug, thiserror::Error)]
pub enum ReviewError {
    /// The session or nested review belongs to another principal.
    #[error("You do not have access to this review")]
    Forbidden,
    /// No matching review, revision, thread, or file.
    #[error("Review content was not found")]
    NotFound,
    /// A stale writer must retry against the current state.
    #[error("The review changed; refresh and retry")]
    Conflict,
    /// The request cannot be applied.
    #[error("{0}")]
    Invalid(String),
    /// The source is disconnected or does not expose a workspace or PR.
    #[error("{0}")]
    Unavailable(String),
    /// Storage or another port failed.
    #[error("Review operation failed")]
    Infrastructure(rootcause::Report),
}

impl From<rootcause::Report> for ReviewError {
    fn from(error: rootcause::Report) -> Self {
        Self::Infrastructure(error)
    }
}

/// Review use-case result.
pub type Result<T> = std::result::Result<T, ReviewError>;

/// File contents as produced by the pinned diffd engine.
pub type ReviewFile = FileDiff;

/// The authority established by an inbound session access extractor or MCP grant.
pub enum ReviewAccess {
    /// A human reader, whose minimum permission is view.
    View(
        entity_access::domain::models::EntityAccessReceipt<
            entity_access::domain::models::ViewAccessLevel,
        >,
    ),
    /// A human collaborator, whose minimum permission is edit.
    Edit(
        entity_access::domain::models::EntityAccessReceipt<
            entity_access::domain::models::EditAccessLevel,
        >,
    ),
    /// An authenticated Internal MCP session. Ownership is rechecked by the domain.
    Agent {
        /// Session resolved from its scoped credential.
        session: agent_session::domain::model::AgentSessionId,
        /// Owner resolved from that same credential.
        owner: macro_user_id::user_id::MacroUserIdStr<'static>,
    },
}
