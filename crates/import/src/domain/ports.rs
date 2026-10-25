//! Ports (traits) the import domain depends on.

use super::models::{
    AdoptedRun, ImportEntity, ImportKind, ImportRun, ImportSource, ImportSourceBinding,
    ImportStatus, ImportTargetKey, ImportTargetKind, ImportTargetReservation, Initiator, NotionJob,
    ReviewedRun, RunStatus, ScanCounts, SlackConversationId, SlackConversationPage,
    SlackMemberPage, SlackUserPage, SlackWorkspaceId, TeamClaim, WrittenObject,
};
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::notifications::PendingNotification;
use import_notion::domain::model::NotionId;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashMap;
use std::time::Duration;
use thiserror::Error;
use uuid::Uuid;

/// Errors surfaced by the import service and repository.
#[derive(Debug, Error)]
pub enum ImportError {
    /// AI work was refused or usage validation is temporarily unavailable.
    #[error(transparent)]
    Admission(#[from] ai_billing::AiAdmissionError),
    /// This source does not support user-triggered discovery.
    #[error("manual discovery is not supported for {source}", source = .0.as_ref())]
    UnsupportedDiscovery(ImportSource),
    /// Database failure.
    #[error("database error: {0}")]
    Db(rootcause::Report),
    /// Metadata failed to (de)serialize.
    #[error("invalid import metadata: {0}")]
    Metadata(#[from] serde_json::Error),
    /// An unidentified archive requires explicit administrator confirmation.
    #[error("source identity requires administrator confirmation")]
    SourceConfirmationRequired,
    /// The team is already bound to a different Slack workspace.
    #[error("source workspace does not match the team's binding")]
    SourceMismatch,
    /// Historical mappings or target shape/provenance are incompatible. No target IDs are exposed.
    #[error("conflicting import target mapping")]
    TargetConflict,
    /// Completion must follow a committed reservation for exactly this UUID.
    #[error("import target is not reserved")]
    TargetNotReserved,
    /// Notion could not be read.
    #[error(transparent)]
    Notion(#[from] import_notion::domain::ports::NotionError),
    /// The user has not connected Notion, or turned it off.
    #[error("Notion is not connected")]
    NotionNotConnected,
    /// The user is on a team and has not said who should see what a Notion
    /// import writes.
    #[error("who should see the Notion import was not chosen")]
    NotionSharingRequired,
    /// The import is not in a state that allows this; the message says why.
    #[error("{0}")]
    NotReady(&'static str),
    /// Anything else.
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

/// Result alias for import operations.
pub type Result<T> = std::result::Result<T, ImportError>;

/// Errors reading a live Slack workspace.
#[derive(Debug, Error)]
pub enum SlackSourceError {
    /// The user has no Slack connector.
    #[error("Slack is not connected")]
    NotConnected,
    /// The connector lacks a required capability.
    #[error("Slack connector capability unavailable: {0}")]
    ToolsUnavailable(&'static str),
    /// Slack temporarily refused reads due to rate limiting.
    #[error("Slack rate limit exceeded")]
    RateLimited {
        /// Provider-supplied delay before retrying, when available.
        retry_after: Option<Duration>,
    },
    /// The connection lacks a required Slack permission scope.
    #[error("missing Slack scope: {0}")]
    MissingScope(String),
    /// Any other source failure.
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

/// Opens live Slack workspace sessions for import discovery and membership reads.
pub trait SlackWorkspaceSource: Send + Sync + 'static {
    /// Workspace reader scoped to one discovery or one import batch.
    type Session: SlackWorkspaceSession;

    /// Open a session scoped to one discovery or one import batch.
    /// Returns [`SlackSourceError::NotConnected`] when the user has no Slack
    /// connector, or [`SlackSourceError::ToolsUnavailable`] when the connector
    /// lacks a needed capability.
    fn open(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = std::result::Result<Self::Session, SlackSourceError>> + Send;
}

/// Paginated workspace reads scoped to one discovery or one import batch.
/// Pass `None` to read the first page, then the returned continuation cursor.
pub trait SlackWorkspaceSession: Send + Sync {
    /// List conversations visible to the connected user.
    fn list_conversations(
        &self,
        cursor: Option<&str>,
    ) -> impl Future<Output = std::result::Result<SlackConversationPage, SlackSourceError>> + Send;

    /// List the members of one Slack conversation.
    fn conversation_members(
        &self,
        conversation: &SlackConversationId,
        cursor: Option<&str>,
    ) -> impl Future<Output = std::result::Result<SlackMemberPage, SlackSourceError>> + Send;

    /// List the workspace user directory.
    fn list_users(
        &self,
        cursor: Option<&str>,
    ) -> impl Future<Output = std::result::Result<SlackUserPage, SlackSourceError>> + Send;
}

/// Persistence for the import ledger and discovery runs.
///
/// Status writes are compare-and-swaps that report whether they happened, so
/// concurrent discovery jobs, import jobs, and user actions interleave without
/// clobbering each other.
pub trait ImportRepo: Send + Sync + 'static {
    /// The user's own row for `(source, foreign_id)`, regardless of status.
    fn get_own_by_foreign_id(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        foreign_id: &str,
    ) -> impl Future<Output = Result<Option<ImportEntity>>> + Send;

    /// A teammate's `imported` row for `(source, foreign_id)` shared with the
    /// user's team, if any.
    fn find_team_imported(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        foreign_id: &str,
    ) -> impl Future<Output = Result<Option<ImportEntity>>> + Send;

    /// Upsert a `staged` row. Inserts, or refreshes the metadata of an
    /// existing `staged` row. Returns `None` when the user's row exists in a
    /// non-staged status (imported / importing / discarded) — the caller
    /// decides what that means.
    fn upsert_staged(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        kind: ImportKind,
        initiator: Initiator,
        foreign_id: &str,
        metadata: &serde_json::Value,
    ) -> impl Future<Output = Result<Option<ImportEntity>>> + Send;

    /// Upsert an `imported` row (used when an agent already created the
    /// entity, e.g. from chat). Overwrites any non-imported own row; an
    /// already-imported row is left untouched (first mapping wins). Returns
    /// the row as stored.
    #[allow(clippy::too_many_arguments)]
    fn upsert_imported(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        kind: ImportKind,
        initiator: Initiator,
        foreign_id: &str,
        metadata: &serde_json::Value,
        entity_id: &str,
        entity_type: &str,
        team_id: Option<Uuid>,
    ) -> impl Future<Output = Result<ImportEntity>> + Send;

    /// The user's own row by ledger id.
    fn get(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<ImportEntity>>> + Send;

    /// Visible rows for the user: their own, plus teammates' team-imported
    /// rows (deduplicated against the user's own rows by `(source,
    /// foreign_id)`, own row winning). Newest first.
    fn list(
        &self,
        user: &MacroUserIdStr<'static>,
        source: Option<ImportSource>,
        status: Option<ImportStatus>,
    ) -> impl Future<Output = Result<Vec<ImportEntity>>> + Send;

    /// CAS the user's own `staged` rows in `ids` to `importing`. Returns the
    /// rows that flipped (missing / non-staged ids are skipped, not errors).
    fn mark_importing(
        &self,
        user: &MacroUserIdStr<'static>,
        ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<ImportEntity>>> + Send;

    /// CAS one `importing` row to `imported` with the entity it became,
    /// recording `team_id` when given (a row's team claim is kept
    /// otherwise). Rows waiting on it ([`NotionPlanRepo::wait_on`]) link to
    /// the same entity.
    fn mark_imported(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        entity_id: &str,
        entity_type: &str,
        team_id: Option<Uuid>,
    ) -> impl Future<Output = Result<Option<ImportEntity>>> + Send;

    /// CAS one `importing` row back to `staged`, recording the failure and
    /// dropping its team claim. Rows waiting on it go back to `staged` too.
    fn mark_import_failed(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        error: &str,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Bump `updated_at` on the user's still-`importing` rows in `ids` — the
    /// running batch's heartbeat, proving a live process still owns them.
    fn touch_importing(
        &self,
        user: &MacroUserIdStr<'static>,
        ids: &[Uuid],
    ) -> impl Future<Output = Result<u64>> + Send;

    /// CAS the user's `importing` rows whose heartbeat stopped more than
    /// `older_than_secs` ago back to `staged`. Import jobs are in-process
    /// tasks: a crash or restart mid-job orphans its rows, and nothing else
    /// can move them again. Notion workspace plan rows are left to the
    /// adopting process ([`NotionRunRepo`]). Returns how many were reaped.
    fn fail_stale_importing(
        &self,
        user: &MacroUserIdStr<'static>,
        older_than_secs: i64,
    ) -> impl Future<Output = Result<u64>> + Send;

    /// CAS one of the user's own `staged` rows to `discarded`. Returns
    /// whether it happened.
    fn discard(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// The user's team, when they are on one.
    fn user_team_id(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<Uuid>>> + Send;

    /// IDs of the team's members. Macro user IDs encode emails, so this is
    /// the roster the import domain matches Slack emails against.
    fn team_members(
        &self,
        team_id: Uuid,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>>> + Send;

    /// All discovery runs for the user.
    fn list_runs(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<ImportRun>>> + Send;

    /// CAS a discovery run to `running`. Wins when no run exists or the
    /// existing status is in `from`. Returns whether this call won.
    fn start_run(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        from: &[RunStatus],
    ) -> impl Future<Output = Result<bool>> + Send;

    /// CAS the user's runs stuck in `running` (or the legacy `importing`) for
    /// more than `older_than_secs` to `failed`. Discovery is an in-process
    /// task: a crash or deploy mid-run leaves the row behind, and the UI
    /// cannot start a new run while one looks active. Notion runs are adopted
    /// instead ([`NotionRunRepo`]). Returns how many were reaped.
    fn fail_stale_runs(
        &self,
        user: &MacroUserIdStr<'static>,
        older_than_secs: i64,
    ) -> impl Future<Output = Result<u64>> + Send;

    /// CAS the `running` run for `source` to `to` (ready/failed), recording
    /// `error` when there is one. Returns whether it happened.
    fn finish_run(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        to: RunStatus,
        error: Option<&str>,
    ) -> impl Future<Output = Result<bool>> + Send;
}

/// Narrow canonical Slack ledger persistence shared by archive and onboarding.
///
/// Callers authorize the explicit team before invoking this port. Target access,
/// exact DM membership, and administrator authorization remain domain-service
/// responsibilities: a reservation is provenance, not an access grant.
/// Each operation commits and releases its connection before returning.
pub trait CanonicalImportRepo: Send + Sync + 'static {
    /// Read the durable binding; `None` means the team is not yet bound.
    fn source_binding(
        &self,
        team_id: Uuid,
    ) -> impl Future<Output = Result<Option<ImportSourceBinding>>> + Send;

    /// Bind once, reject known mismatches, and retain the first unknown-source
    /// confirmation timestamp. Every unidentified archive requires confirmation,
    /// even when a known binding exists. A later known identity may resolve a
    /// previously confirmed-unknown binding but never replace a known identity.
    fn bind_source(
        &self,
        team_id: Uuid,
        workspace_id: Option<&SlackWorkspaceId>,
        confirmed_unknown: bool,
    ) -> impl Future<Output = Result<ImportSourceBinding>> + Send;

    /// Reserve one stable UUID, considering BOTH own imported rows (even after a
    /// team change) and rows explicitly shared with this team. Reject ambiguous,
    /// cross-team, non-channel or incompatible mappings rather than choosing one.
    /// `existing_channel_id` is an optional already-authorized target to claim
    /// (e.g. an exact-pair DM); it must agree with every historical mapping and
    /// cannot replace a committed pending UUID. Without it, allocate UUIDv7.
    /// Private/DM historical targets require either this explicit authorization
    /// or an earlier ready reservation in this namespace.
    fn reserve_target(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ImportTargetKey,
        kind: ImportTargetKind,
        existing_channel_id: Option<Uuid>,
    ) -> impl Future<Output = Result<ImportTargetReservation>> + Send;

    /// Complete exactly the reserved UUID after idempotent channel creation.
    /// Revalidate target type/team and preserve the first mapping. Private/DM
    /// provenance is stored ONLY in the reservation, never a team-visible ledger
    /// row. Team ledger rows may be published separately through `ImportRepo`.
    fn complete_target(
        &self,
        key: &ImportTargetKey,
        channel_id: Uuid,
        kind: ImportTargetKind,
    ) -> impl Future<Output = Result<ImportTargetReservation>> + Send;
}

/// Side-effect-free canonical reads, separate from reservation and legacy listings.
pub trait ImportTargetReader: Send + Sync + 'static {
    /// Exact IDs in an explicit bound namespace. At most 500 IDs per call; returns
    /// one outcome per input, in order. Unknown-source confirmation is not domain
    /// evidence. Never creates reservations, locks rows, or grants read access.
    fn lookup_targets(
        &self,
        team: Uuid,
        binding: &ImportSourceBinding,
        channels: &[super::models::SlackConversationId],
    ) -> impl Future<Output = Result<Vec<super::models::ImportTargetLookup>>> + Send;
}

/// System properties to set on an imported task, already normalized to
/// Macro's vocabulary by the import service (the creator applies them
/// best-effort — a property that fails to apply never fails the import).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ImportedTaskProperties {
    /// Macro status display label (`Not Started` … `Canceled`).
    pub status: Option<String>,
    /// Macro priority display label (`Low` … `Urgent`).
    pub priority: Option<String>,
    /// Due date as an ISO date (`YYYY-MM-DD`).
    pub due_date: Option<String>,
    /// Assignee email, resolved against the user's team roster.
    pub assignee_email: Option<String>,
}

/// Properties recovered from a Notion page and attached to the imported
/// Macro document. The creator applies these best-effort after the document
/// exists, so unsupported or invalid values never prevent the body import.
#[derive(
    Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct ImportedDocumentProperties {
    /// Ordinary Notion database properties.
    #[serde(default)]
    pub values: Vec<ImportedDocumentProperty>,
    /// Notion tag/label values, mapped onto Macro's personal tag set.
    #[serde(default)]
    pub tags: Vec<String>,
}

/// One named property recovered from a Notion database page.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportedDocumentProperty {
    /// Property display name.
    pub name: String,
    /// Typed property value.
    pub value: ImportedDocumentPropertyValue,
}

/// Portable property values that have direct Macro property equivalents.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
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

/// What a Notion page's references point to in Macro, so the page converts
/// with live mentions instead of links back to Notion.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NotionLinks {
    /// Notion page → the Macro document it becomes.
    pub pages: HashMap<NotionId, NotionPageLink>,
    /// Notion person → the Macro user they are.
    pub users: HashMap<NotionId, NotionUserLink>,
}

/// The Macro document a Notion page becomes.
#[derive(Debug, Clone, PartialEq)]
pub struct NotionPageLink {
    /// The document id, minted before the document exists.
    pub document_id: Uuid,
    /// Its name.
    pub name: String,
}

/// The Macro user a Notion person is.
#[derive(Debug, Clone, PartialEq)]
pub struct NotionUserLink {
    /// The Macro user id.
    pub user_id: MacroUserIdStr<'static>,
    /// Their email, lowercase.
    pub email: String,
}

/// Creates the Macro entities imports become. Implemented by the host
/// service against its real document/channel services; the fixed
/// source → entity-type mapping is enforced by the import service, which
/// only ever calls the creator matching the row's source.
pub trait EntityCreator: Send + Sync + 'static {
    /// Create a task document, applying `properties` best-effort once the
    /// task exists. Returns the new entity id.
    fn create_task(
        &self,
        user: &MacroUserIdStr<'static>,
        name: &str,
        markdown: &str,
        properties: &ImportedTaskProperties,
    ) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Create a document from a Notion page in Notion's enhanced markdown,
    /// its references resolved through `links`. Returns the new entity id.
    fn create_notion_document(
        &self,
        user: &MacroUserIdStr<'static>,
        name: &str,
        notion_markdown: &str,
        links: &NotionLinks,
        properties: &ImportedDocumentProperties,
    ) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Ensure the reserved Slack Team channel, using its canonical UUID and
    /// normalized source identity. Reuse must preserve existing settings and
    /// memberships and must not replay first-creation effects. Participant emails
    /// are matched against the team roster best-effort on initial creation only.
    /// Returns the persisted channel ID, never a discarded creation candidate.
    fn create_channel(
        &self,
        user: &MacroUserIdStr<'static>,
        name: &str,
        target: &ImportTargetReservation,
        participant_emails: &[String],
    ) -> impl Future<Output = anyhow::Result<Uuid>> + Send;
}

/// A database a workspace import just created, with the starter table and its
/// title column, which the import reuses for the first data source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewDatabase {
    /// The new database.
    pub database_id: Uuid,
    /// The table every new database starts with.
    pub table: models_databases::TableId,
    /// That table's title column.
    pub title_column: models_databases::ColumnId,
}

/// Something a workspace import shares with the user's team.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SharedEntity {
    /// A folder, and everything in it.
    Folder(Uuid),
    /// A document.
    Document(Uuid),
    /// A database, with its rows.
    Database(Uuid),
}

/// A team member a Notion person can be matched to, by email.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeamMember {
    /// The member's Macro user id.
    pub user_id: MacroUserIdStr<'static>,
    /// Their email, lowercase.
    pub email: String,
}

/// Creates the Macro side of a workspace import: folders mirroring the
/// source's tree, documents and tasks inside them, and databases.
///
/// Every entity is created as `user`, through the same services the app
/// uses, so permissions, search and sync behave as for anything the user
/// made by hand.
pub trait WorkspaceWriter: Send + Sync + 'static {
    /// Create a folder, inside `parent` when given. Returns the folder id.
    fn create_folder(
        &self,
        user: &MacroUserIdStr<'static>,
        name: &str,
        parent: Option<Uuid>,
    ) -> impl Future<Output = anyhow::Result<Uuid>> + Send;

    /// Whether `folder` still exists and `user` can create inside it.
    fn folder_exists(
        &self,
        user: &MacroUserIdStr<'static>,
        folder: Uuid,
    ) -> impl Future<Output = anyhow::Result<bool>> + Send;

    /// Create document `id` from a Notion page (Notion's enhanced markdown,
    /// references resolved through `links`) inside `folder` when given,
    /// applying `properties` best-effort. Returns the document id. Safe to
    /// repeat: when document `id` exists already (an interrupted earlier
    /// attempt), it is left as it is and its id returned.
    #[allow(clippy::too_many_arguments)]
    fn create_document(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        name: &str,
        notion_markdown: &str,
        links: &NotionLinks,
        properties: &ImportedDocumentProperties,
        folder: Option<Uuid>,
    ) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Create task `id` from a Notion page (as for [`Self::create_document`],
    /// and as safe to repeat) inside `folder` when given, applying
    /// `properties` best-effort. Returns the task id.
    #[expect(
        clippy::too_many_arguments,
        reason = "a task carries its id, content, links, properties and folder"
    )]
    fn create_task(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        name: &str,
        notion_markdown: &str,
        links: &NotionLinks,
        properties: &ImportedTaskProperties,
        folder: Option<Uuid>,
    ) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Create an empty database named `name`.
    fn create_database(
        &self,
        user: &MacroUserIdStr<'static>,
        name: &str,
    ) -> impl Future<Output = anyhow::Result<NewDatabase>> + Send;

    /// Apply `ops` to a database `user` created, in one transaction. Ops may
    /// refer to ids minted earlier in the same batch.
    fn apply_database_ops(
        &self,
        user: &MacroUserIdStr<'static>,
        database_id: Uuid,
        ops: Vec<models_databases::DatabaseOp>,
    ) -> impl Future<Output = anyhow::Result<Vec<models_databases::OpResult>>> + Send;

    /// Share `entity`, which `user` owns, with `user`'s team at edit level.
    /// Sharing a folder reaches everything inside it, folders included.
    /// Safe to repeat.
    fn share_with_team(
        &self,
        user: &MacroUserIdStr<'static>,
        entity: SharedEntity,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// The members of `user`'s team (including `user`), for matching Notion
    /// people by email. Empty when the user has no team.
    fn team_members(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = anyhow::Result<Vec<TeamMember>>> + Send;
}

/// One object of a workspace import plan, ready to stage.
#[derive(Debug, Clone, PartialEq)]
pub struct PlanRow {
    /// What the object is.
    pub kind: ImportKind,
    /// The object's id in the source.
    pub foreign_id: String,
    /// The `foreign_id` of the plan row it sits under, if any.
    pub parent_foreign_id: Option<String>,
    /// The row's metadata, already capped.
    pub metadata: serde_json::Value,
}

/// Ledger operations a workspace import needs beyond single-row staging.
pub trait NotionPlanRepo: Send + Sync + 'static {
    /// Replace `user`'s current plan for `source`: drop the staged rows of the
    /// previous plan, then stage `rows` in order (parents before children),
    /// linking each to its parent row and to the review the `running` run
    /// records, if one presents it already. Objects already importing or
    /// imported keep their rows. Returns the rows now staged.
    fn replace_plan(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        rows: &[PlanRow],
    ) -> impl Future<Output = Result<Vec<ImportEntity>>> + Send;

    /// Rewrite the metadata of the user's staged plan rows for `rows`'
    /// objects (by `foreign_id`), as the decision model answers for them.
    /// Rows no longer staged are left alone. Returns how many changed.
    fn update_plan_rows(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        rows: &[PlanRow],
    ) -> impl Future<Output = Result<u64>> + Send;

    /// Teammates' rows for the Notion objects `foreign_ids` that hold the
    /// user's team's claim (`importing` or `imported`, shared with the team).
    fn team_copies(
        &self,
        user: &MacroUserIdStr<'static>,
        foreign_ids: &[String],
    ) -> impl Future<Output = Result<Vec<ImportEntity>>> + Send;

    /// Record the sharing the user chose on their staged plan rows: `shared`
    /// become shared with the team, `personal` not. Returns how many changed.
    fn set_plan_sharing(
        &self,
        user: &MacroUserIdStr<'static>,
        shared: &[Uuid],
        personal: &[Uuid],
    ) -> impl Future<Output = Result<u64>> + Send;

    /// CAS the user's own `staged` rows in `ids` to `importing`, claiming
    /// each of `shared` for `team_id` unless a teammate holds the team's
    /// claim on the same object. The team's partial unique index makes the
    /// claim exclusive, so two teammates writing the same object at once
    /// cannot both hold it. Returns the rows that moved, with the claims
    /// taken.
    fn claim_importing(
        &self,
        user: &MacroUserIdStr<'static>,
        ids: &[Uuid],
        shared: &[Uuid],
        team_id: Option<Uuid>,
    ) -> impl Future<Output = Result<Vec<ImportEntity>>> + Send;

    /// Who writes the object of the user's `importing` row `import_id` for
    /// `team_id`. With `claim` set the row takes the claim when nobody holds
    /// it, or when its holder's import stopped (no live lease on a writing
    /// run); otherwise it writes a copy of its own.
    fn claim_team_object(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        team_id: Uuid,
        claim: bool,
    ) -> impl Future<Output = Result<TeamClaim>> + Send;

    /// Make the user's `importing` row `import_id` wait on the teammate's row
    /// `holder`, which links it once `holder` is imported. Returns `false`
    /// (and changes nothing) when `holder` is no longer being written.
    fn wait_on(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        holder: Uuid,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Tie the current plan to `review_id`, presented in `session_id`: its
    /// staged rows, and the run while it is still planning (`running`), so
    /// rows staged later are tied too. The first review presenting a plan
    /// keeps its session, which hears when the plan is ready and when its
    /// write ends. Returns how many rows it tied.
    fn attach_review(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        review_id: Uuid,
        session_id: AgentSessionId,
    ) -> impl Future<Output = Result<u64>> + Send;

    /// Move `user`'s run for `source` to `to` when it is in one of `from`,
    /// dropping any lease on it. Returns whether the run moved.
    fn transition_run(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        from: &[RunStatus],
        to: RunStatus,
        error: Option<&str>,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Record what `user`'s `running` run for `source` has found so far.
    /// Returns whether the run was still running.
    fn record_scan(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        scanned: ScanCounts,
    ) -> impl Future<Output = Result<bool>> + Send;
}

/// Who holds the user's Notion run, so an import outlives the process running
/// it.
///
/// The process planning or writing holds a lease on the run and renews it
/// while it works. Once a lease lapses (a crash or a deploy) any process may
/// adopt the run and resume the job recorded on it.
pub trait NotionRunRepo: Send + Sync + 'static {
    /// Take the user's Notion run for `owner` until `lease` from now and
    /// record `job` on it. Only a run that just started (`running` or
    /// `importing`, held by nobody) can be taken. Returns whether it was.
    fn take_run(
        &self,
        user: &MacroUserIdStr<'static>,
        owner: Uuid,
        lease: Duration,
        job: &NotionJob,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Extend `owner`'s lease on the user's Notion run to `lease` from now.
    /// Returns `false` once the run stopped or another process holds it.
    fn renew_lease(
        &self,
        user: &MacroUserIdStr<'static>,
        owner: Uuid,
        lease: Duration,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Give up `owner`'s lease, so another process adopts the run at once.
    /// Returns whether `owner` held it.
    fn release_lease(
        &self,
        user: &MacroUserIdStr<'static>,
        owner: Uuid,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Adopt up to `limit` Notion runs (only `user`'s, when given) still
    /// planning or writing whose lease lapsed, or which nobody leased and
    /// nobody touched for `stale_after` (runs started by code that predates
    /// leases). Each is held for `owner` until `lease` from now. Runs another
    /// process is adopting at the same moment are skipped.
    fn adopt_stalled_runs(
        &self,
        user: Option<&MacroUserIdStr<'static>>,
        owner: Uuid,
        lease: Duration,
        stale_after: Duration,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<AdoptedRun>>> + Send;

    /// Move the user's Notion run to `to` with `error` when it is in one of
    /// `from`, dropping any lease on it; a run cancelled meanwhile stays
    /// `dismissed` with its own error. In the same transaction, produce the
    /// system event `event` makes of the moved run, so the session presenting
    /// its review hears of the change exactly when it happens. Returns the
    /// moved run, or `None` when it was in none of `from`.
    fn transition_reviewed_run<Event>(
        &self,
        user: &MacroUserIdStr<'static>,
        from: &[RunStatus],
        to: RunStatus,
        error: Option<&str>,
        event: Event,
    ) -> impl Future<Output = Result<Option<ReviewedRun>>> + Send
    where
        Event: FnOnce(&ReviewedRun) -> Option<PendingNotification> + Send;

    /// The user's "Notion" folder, once an import has made one.
    fn root_folder(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<Uuid>>> + Send;

    /// Record `folder` as the user's "Notion" folder.
    fn set_root_folder(
        &self,
        user: &MacroUserIdStr<'static>,
        folder: Uuid,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Send the user's workspace plan rows still `importing` back to staged
    /// with `reason`, unless a write is running for them or they wait on a
    /// teammate's row still being written. Rows waiting on a teammate's row
    /// that stopped go back too. Returns how many moved.
    fn settle_importing(
        &self,
        user: &MacroUserIdStr<'static>,
        reason: &str,
    ) -> impl Future<Output = Result<u64>> + Send;
}

/// What workspace writes created for each ledger row, recorded as they go so
/// a resumed write reuses it instead of creating it again.
pub trait WrittenObjects: Send + Sync + 'static {
    /// Everything recorded for the user's ledger rows `import_ids`.
    fn written(
        &self,
        user: &MacroUserIdStr<'static>,
        import_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<WrittenObject>>> + Send;

    /// Record `objects` for the user's ledger rows. An object already
    /// recorded under the same row, kind and Notion object keeps its earlier
    /// id. Returns what is recorded for each of `objects` afterwards.
    fn record_written(
        &self,
        user: &MacroUserIdStr<'static>,
        objects: &[WrittenObject],
    ) -> impl Future<Output = Result<Vec<WrittenObject>>> + Send;
}
