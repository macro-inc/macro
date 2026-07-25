//! Ports (traits) the import domain depends on.

use super::models::{ImportEntity, ImportRun, ImportSource, ImportStatus, Initiator, RunStatus};
use macro_user_id::user_id::MacroUserIdStr;
use thiserror::Error;
use uuid::Uuid;

/// Errors surfaced by the import service and repository.
#[derive(Debug, Error)]
pub enum ImportError {
    /// Database failure.
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    /// Metadata failed to (de)serialize.
    #[error("invalid import metadata: {0}")]
    Metadata(#[from] serde_json::Error),
    /// Anything else.
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

/// Result alias for import operations.
pub type Result<T> = std::result::Result<T, ImportError>;

/// Persistence for the import ledger and gather runs.
///
/// Status writes are compare-and-swaps that report whether they happened, so
/// concurrent gather jobs, import jobs, and user actions interleave without
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

    /// CAS one `importing` row to `imported` with the entity it became.
    fn mark_imported(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        entity_id: &str,
        entity_type: &str,
        team_id: Option<Uuid>,
    ) -> impl Future<Output = Result<Option<ImportEntity>>> + Send;

    /// CAS one `importing` row back to `staged`, recording the failure.
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
    /// can move them again. Returns how many were reaped.
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

    /// Discard all of the user's remaining `staged` rows with the given
    /// initiator (an explicit "no" — `stage()` refuses to re-stage them).
    /// Returns how many flipped.
    fn discard_staged_by_initiator(
        &self,
        user: &MacroUserIdStr<'static>,
        initiator: Initiator,
    ) -> impl Future<Output = Result<u64>> + Send;

    /// DELETE the user's remaining unreserved `staged` rows with the given
    /// initiator. Onboarding candidates reserved by an active or retryable
    /// configured auto-import run survive completion cleanup; other
    /// candidates the user never acted on vanish and stay re-stageable later.
    /// Returns how many were removed.
    fn delete_staged_by_initiator(
        &self,
        user: &MacroUserIdStr<'static>,
        initiator: Initiator,
    ) -> impl Future<Output = Result<u64>> + Send;

    /// The user's team, when they are on one.
    fn user_team_id(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<Uuid>>> + Send;

    /// All gather runs for the user.
    fn list_runs(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<ImportRun>>> + Send;

    /// CAS a gather run to `running`. New rows persist `auto_import`
    /// atomically; retries preserve the existing run's setting. Wins when no
    /// run row exists yet, or when the existing row's status is in `from`.
    /// Returns whether this call won.
    fn start_run(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        from: &[RunStatus],
        auto_import: bool,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// CAS the `running` run for `source` to `to` (ready/failed), recording
    /// `error` when there is one. Returns whether it happened.
    fn finish_run(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        to: RunStatus,
        error: Option<&str>,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// CAS a run from one of `from` to `to` without touching its error.
    fn transition_run(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        from: &[RunStatus],
        to: RunStatus,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Atomically claim a ready, auto-import-enabled run and all of its own
    /// onboarding-staged candidates. `None` means another caller won or the
    /// run is not ready/configured; `Some([])` is a valid empty run.
    fn begin_auto_import(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> impl Future<Output = Result<Option<Vec<ImportEntity>>>> + Send;

    /// Finish an auto-import run after every claimed row has settled. The run
    /// becomes `completed` only when all claimed rows are imported; otherwise
    /// it becomes `failed`. Returns the terminal status when this call won.
    fn finish_auto_import(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        ids: &[Uuid],
    ) -> impl Future<Output = Result<Option<RunStatus>>> + Send;

    /// Repair auto-import run rows after process interruption. An `importing`
    /// run with no importing onboarding rows is terminal: `failed` when a
    /// staged row carries an import error, otherwise `completed`.
    fn reconcile_auto_import_runs(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<u64>> + Send;
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

    /// Create a markdown document. Returns the new entity id.
    fn create_markdown_doc(
        &self,
        user: &MacroUserIdStr<'static>,
        name: &str,
        markdown: &str,
    ) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Create a channel, shared with `team_id` when given (public
    /// otherwise). `participant_emails` are matched against the team roster
    /// best-effort; matches join the channel alongside the creator. Returns
    /// the new entity id.
    fn create_channel(
        &self,
        user: &MacroUserIdStr<'static>,
        name: &str,
        team_id: Option<Uuid>,
        participant_emails: &[String],
    ) -> impl Future<Output = anyhow::Result<String>> + Send;
}
