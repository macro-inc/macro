//! The import orchestrator: staging (with team-wide dedup), gather jobs,
//! and import jobs.
//!
//! Discovery reads each source through a typed port; no model chooses or
//! writes imported content. Slack discovery stages public channels and
//! enriches their membership (onboarding may still fall back to an agent
//! when workspace reads fail). Linear discovery stages the user's open
//! assigned issues; Notion discovery stages the user's most recently edited
//! pages. Import jobs copy accepted rows in: Linear tasks and Slack channels
//! are composed from staged metadata; Notion pages are read block by block,
//! converted to Macro Markdown, and filed into folders that mirror their
//! Notion structure.

use super::models::*;
use super::ports::{
    ApiSourceError, CanonicalImportRepo, EntityCreator, ImportApis, ImportError, ImportRepo,
    NotionSession, Result, SlackSourceError, SlackWorkspaceSource,
};
use crate::inbound::toolset::{ImportToolContext, ToolPolicy, gather_toolset};
use agent::AgentLoop;
use agent::types::{ChatMessage, ChatMessageContent, Role};
use ai_toolset::{RequestContext, ToolResult, ToolSet, ToolSetError};
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_select::{ConnectorSelect, UserMcpTools};
use std::collections::HashSet;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

mod admission;
mod apis;
mod linear;
pub(crate) mod notion;
mod prompts;
mod rate_limit;
mod slack;
mod slack_discovery;

pub use apis::{ApiSources, NoApiSources};
#[cfg(test)]
pub(crate) use linear::{MAX_LINEAR_ISSUES, linear_issue_meta, select_linear_issues};
pub use linear::{
    NoLinearSource, linear_task_content, linear_task_properties, linear_task_status,
    map_linear_priority, map_linear_status,
};
pub use notion::{NoImageRehoster, NoNotionSession, NoNotionSource};
pub use slack_discovery::NoSlackSource;
use slack_discovery::SlackBatch;

#[cfg(test)]
mod test;

/// Model for gather sessions: fast beats maximal while the user watches the
/// section shimmer, and Cerebras serves gpt-oss-120b at interactive latency.
/// A raw provider-prefixed id (not [`PredefinedModel`]) because the registry
/// has no Cerebras tier — the model router resolves the `cerebras/` prefix.
const GATHER_MODEL: &str = "cerebras/gpt-oss-120b";
/// Fallback when the primary gather session fails: Cerebras enforces tight
/// org-wide rate limits, so a burst of concurrent onboardings can 429 every
/// gather at once. gpt-5.4-nano is slower per token but rides OpenAI's much
/// higher limits, and a slower gather beats a failed section.
const GATHER_FALLBACK_MODEL: &str = "openai/gpt-5.4-nano";
/// Turn cap for gather sessions: a couple of searches plus one staging tool
/// call per candidate (providers may batch several per turn).
const GATHER_MAX_TURNS: usize = 24;
/// Hard cap on a gather session. Staged rows land incrementally, so the
/// section fills while this runs; the cap only bounds the shimmer tail.
const GATHER_TIMEOUT: Duration = Duration::from_secs(90);

/// Push a client refresh after this many rows staged by discovery, so the
/// setup section fills while it runs.
const DISCOVERY_NOTIFY_EVERY: usize = 10;

/// How many Notion pages import at once for one accepted batch — Notion's
/// API allows about three requests per second per connection.
const NOTION_IMPORT_CONCURRENCY: usize = 3;

/// How one row of an import batch ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RowOutcome {
    /// A Macro entity now exists for the row.
    Imported,
    /// The item was excluded by rule (its row is removed); not an error.
    Skipped,
    /// The row failed; its `last_error` says why.
    Failed,
}

/// One structured summary per source of a finished batch, for Datadog.
fn log_batch(outcomes: &[(Uuid, ImportSource, RowOutcome)], automatic: bool, elapsed: Duration) {
    for source in [
        ImportSource::Slack,
        ImportSource::Linear,
        ImportSource::Notion,
    ] {
        let count = |want: RowOutcome| {
            outcomes
                .iter()
                .filter(|(_, from, outcome)| *from == source && *outcome == want)
                .count()
        };
        let (imported, skipped, failed) = (
            count(RowOutcome::Imported),
            count(RowOutcome::Skipped),
            count(RowOutcome::Failed),
        );
        if imported + skipped + failed > 0 {
            tracing::info!(
                source = source.as_ref(),
                imported,
                skipped,
                failed,
                automatic,
                duration_ms = elapsed.as_millis() as u64,
                "import batch finished"
            );
        }
    }
}

/// Order rows by their source item's last edit, newest first. Rows without
/// a recorded edit time (staged by chat) keep their relative order, last.
fn sort_freshest_first(rows: &mut [ImportEntity]) {
    let edited = |row: &ImportEntity| {
        row.metadata
            .get("updated_at")
            .or_else(|| row.metadata.get("last_edited_time"))
            .and_then(serde_json::Value::as_str)
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
    };
    rows.sort_by_key(|row| std::cmp::Reverse(edited(row)));
}

/// Discovery policy: bounded onboarding suggestions or a user-driven listing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GatherMode {
    /// Suggest the strongest active channels for onboarding.
    Onboarding,
    /// Stage all visible public channels for explicit selection.
    Manual,
}

fn gather_timeout(source: ImportSource, mode: GatherMode) -> Duration {
    match (source, mode) {
        (ImportSource::Slack, GatherMode::Onboarding) => Duration::from_secs(180),
        (ImportSource::Slack, GatherMode::Manual) => Duration::from_secs(360),
        _ => GATHER_TIMEOUT,
    }
}

/// How often a running import batch touches its rows' `updated_at`. The
/// heartbeat covers every row the batch owns — queued AND in-flight — so a
/// fresh `updated_at` means "a live process is still responsible for this
/// row", independent of how long the row waits behind the concurrency cap.
const IMPORT_HEARTBEAT: Duration = Duration::from_secs(30);

/// How long an `importing` row may go without a heartbeat before the read
/// path declares its job dead (process crashed or restarted) and sends it
/// back to `staged`. Several missed beats, so a slow DB or a paused runtime
/// never reaps a live batch.
const STALE_IMPORT_AFTER: Duration = Duration::from_secs(IMPORT_HEARTBEAT.as_secs() * 6);

/// Pushes an "import state changed" nudge to the user's connected clients.
/// A closure so this crate stays free of gateway dependencies; hosts without
/// a gateway just don't set it.
pub type ImportNotify =
    Arc<dyn Fn(MacroUserIdStr<'static>) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>;

/// Outcome of accepting/declining staged rows via `POST /import/run`.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct RunImportOutcome {
    /// How many rows were discarded.
    pub discarded: u64,
    /// How many rows flipped to `importing` (jobs are now copying them in).
    pub importing: u64,
}

/// Outcome of staging one candidate.
#[derive(Debug, Clone, PartialEq)]
pub enum StageOutcome {
    /// A staged row now exists (fresh, or metadata-refreshed).
    Staged(ImportEntity),
    /// The item was already imported. `by_teammate` distinguishes "you did
    /// this" from "someone on your team did".
    AlreadyImported {
        /// The imported row (carries the Macro entity it became).
        entity: ImportEntity,
        /// Whether a teammate (not the user) imported it.
        by_teammate: bool,
    },
    /// The user previously declined this item; it is not re-staged.
    PreviouslyDiscarded(ImportEntity),
    /// An import job is currently copying this item in.
    ImportInProgress(ImportEntity),
}

/// Outcome of discarding one staged row.
#[derive(Debug, Clone, PartialEq)]
pub enum DiscardOutcome {
    /// The row is now discarded.
    Discarded,
    /// No such row belongs to the user.
    NotFound,
    /// The row exists but is not `staged` (only staged rows can be
    /// discarded).
    NotDiscardable(ImportStatus),
}

/// The API the import router (and host services like onboarding) talk to.
pub trait ImportService: Send + Sync + 'static {
    /// The full import aggregate for the user.
    fn state(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<ImportState>> + Send;

    /// Start a gather run for `source` if none has ever run (the
    /// connector-just-authenticated hook). `auto_import` is persisted with
    /// the new run before its background gather starts. Returns whether a
    /// run started.
    fn start_gather(
        &self,
        user: MacroUserIdStr<'static>,
        source: ImportSource,
        auto_import: bool,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// User-triggered, non-auto-import gather that stages everything visible.
    /// Only Slack is supported in this slice. Returns whether a run started.
    fn start_discovery(
        &self,
        user: MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Restart a failed (or dismissed) gather run. Returns whether a run
    /// started.
    fn retry_gather(
        &self,
        user: MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Dismiss a source's import section.
    fn dismiss_run(
        &self,
        user: MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Accept `import_ids` (flip to `importing` and start import jobs) and
    /// discard `discard_ids`.
    fn run_import(
        &self,
        user: MacroUserIdStr<'static>,
        import_ids: Vec<Uuid>,
        discard_ids: Vec<Uuid>,
    ) -> impl Future<Output = Result<RunImportOutcome>> + Send;

    /// Discard all remaining staged rows with `initiator` — an explicit
    /// decline; `stage()` refuses to re-stage discarded items. Returns how
    /// many were discarded.
    fn discard_staged_by_initiator(
        &self,
        user: MacroUserIdStr<'static>,
        initiator: Initiator,
    ) -> impl Future<Output = Result<u64>> + Send;

    /// Delete remaining unreserved staged rows with `initiator` (onboarding
    /// completion cleanup). Candidates reserved by active or retryable
    /// configured auto-import runs survive. Unlike discarding, deleted
    /// candidates were never reviewed and stay re-stageable by later gathers
    /// or chat. Returns how many were removed.
    fn delete_staged_by_initiator(
        &self,
        user: MacroUserIdStr<'static>,
        initiator: Initiator,
    ) -> impl Future<Output = Result<u64>> + Send;
}

/// Staging operations the AI tools drive. Split from [`ImportService`] so
/// tool contexts depend on exactly what tools can do.
pub trait ImportStager: Send + Sync + 'static {
    /// Stage one candidate, deduplicating against the user's own rows and
    /// the team's imported rows.
    fn stage(
        &self,
        user: &MacroUserIdStr<'static>,
        initiator: Initiator,
        source: ImportSource,
        foreign_id: &str,
        metadata: serde_json::Value,
    ) -> impl Future<Output = Result<StageOutcome>> + Send;

    /// Record an entity an agent already created (chat flow) as imported.
    fn record_imported(
        &self,
        user: &MacroUserIdStr<'static>,
        initiator: Initiator,
        source: ImportSource,
        foreign_id: &str,
        metadata: serde_json::Value,
        entity_id: &str,
    ) -> impl Future<Output = Result<ImportEntity>> + Send;

    /// Discard one of the user's own staged rows.
    fn discard_entity(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<DiscardOutcome>> + Send;

    /// Visible rows for the user (own + team-imported).
    fn list_entities(
        &self,
        user: &MacroUserIdStr<'static>,
        source: Option<ImportSource>,
        status: Option<ImportStatus>,
    ) -> impl Future<Output = Result<Vec<ImportEntity>>> + Send;
}

/// Outcome of explicitly importing one Notion page from an interactive chat.
#[derive(Debug, Clone, PartialEq)]
pub enum ImportNotionPageOutcome {
    /// The page now exists as a Macro document.
    Imported {
        /// The ledger row carrying the Macro document id.
        entity: ImportEntity,
        /// Whether the document existed before this request.
        already_existed: bool,
        /// Whether a teammate imported the existing document.
        by_teammate: bool,
    },
    /// The user previously declined this page, so the explicit import did not
    /// override that remembered decision.
    PreviouslyDiscarded(ImportEntity),
    /// Another request is already importing this page.
    ImportInProgress(ImportEntity),
}

/// Workflow used by the interactive agent to import one specific Notion page.
///
/// Owns the complete operation: deduplication, ledger transitions, reading
/// the page through Notion's API, conversion, folder placement, document
/// creation, and final ledger state.
pub trait NotionPageImporter: Send + Sync + 'static {
    /// Import a Notion page URL or page id for `user`.
    fn import_notion_page(
        &self,
        user: &MacroUserIdStr<'static>,
        page_url_or_id: &str,
    ) -> impl Future<Output = Result<ImportNotionPageOutcome>> + Send;
}

/// Concrete orchestrator wiring the repo, the user's MCP servers, the
/// entity creator, and usage recording together.
pub struct ImportServiceImpl<R, S, C, W = NoSlackSource, A = NoApiSources> {
    repo: R,
    slack_source: Arc<W>,
    apis: Arc<A>,
    folder_locks: Arc<notion::folders::FolderLocks>,
    notion_pacers: Arc<rate_limit::UserPacers>,
    mcp_tools: Arc<S>,
    creator: Arc<C>,
    recorder: Arc<dyn ai_usage::UsageRecorder>,
    admission: Arc<dyn ai_billing::AiAdmissionService>,
    notifier: Option<ImportNotify>,
}

impl<R: Clone, S, C, W: SlackWorkspaceSource, A> Clone for ImportServiceImpl<R, S, C, W, A> {
    fn clone(&self) -> Self {
        Self {
            repo: self.repo.clone(),
            slack_source: self.slack_source.clone(),
            apis: self.apis.clone(),
            folder_locks: self.folder_locks.clone(),
            notion_pacers: self.notion_pacers.clone(),
            mcp_tools: self.mcp_tools.clone(),
            creator: self.creator.clone(),
            recorder: self.recorder.clone(),
            admission: self.admission.clone(),
            notifier: self.notifier.clone(),
        }
    }
}

impl<R, S, C> ImportServiceImpl<R, S, C> {
    /// Build the orchestrator.
    pub fn new(
        repo: R,
        mcp_tools: Arc<S>,
        creator: Arc<C>,
        recorder: Arc<dyn ai_usage::UsageRecorder>,
    ) -> Self {
        Self {
            repo,
            slack_source: Arc::new(NoSlackSource),
            apis: Arc::default(),
            folder_locks: Arc::default(),
            notion_pacers: Arc::new(rate_limit::UserPacers::new(notion::READ_INTERVAL)),
            mcp_tools,
            creator,
            recorder,
            admission: Arc::new(ai_billing::DisabledAiAdmissionService),
            notifier: None,
        }
    }
}

impl<R, S, C, W: SlackWorkspaceSource, A> ImportServiceImpl<R, S, C, W, A> {
    /// Attach a live Slack workspace reader, preserving the service configuration.
    pub fn with_slack_source<W2: SlackWorkspaceSource>(
        self,
        source: Arc<W2>,
    ) -> ImportServiceImpl<R, S, C, W2, A> {
        ImportServiceImpl {
            repo: self.repo,
            mcp_tools: self.mcp_tools,
            creator: self.creator,
            recorder: self.recorder,
            admission: self.admission,
            notifier: self.notifier,
            slack_source: source,
            apis: self.apis,
            folder_locks: self.folder_locks,
            notion_pacers: self.notion_pacers,
        }
    }

    /// Attach the typed readers for sources imported through their own APIs
    /// (Linear and Notion), preserving the service configuration.
    pub fn with_api_sources<A2: ImportApis>(
        self,
        apis: Arc<A2>,
    ) -> ImportServiceImpl<R, S, C, W, A2> {
        ImportServiceImpl {
            repo: self.repo,
            mcp_tools: self.mcp_tools,
            creator: self.creator,
            recorder: self.recorder,
            admission: self.admission,
            notifier: self.notifier,
            slack_source: self.slack_source,
            apis,
            folder_locks: self.folder_locks,
            notion_pacers: self.notion_pacers,
        }
    }

    /// Push state-change nudges through the given notifier.
    pub fn with_notifier(mut self, notifier: ImportNotify) -> Self {
        self.notifier = Some(notifier);
        self
    }

    async fn notify(&self, user: &MacroUserIdStr<'static>) {
        if let Some(notifier) = &self.notifier {
            notifier(user.clone()).await;
        }
    }
}

impl<R, S, C, W: SlackWorkspaceSource, A: ImportApis> ImportServiceImpl<R, S, C, W, A>
where
    R: ImportRepo + CanonicalImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
{
    /// Spawn the gather session for one source; finishes the run row either
    /// way and nudges the client.
    fn spawn_gather(&self, user: MacroUserIdStr<'static>, source: ImportSource, mode: GatherMode) {
        let service = self.clone();
        tokio::spawn(async move {
            let outcome = tokio::time::timeout(
                gather_timeout(source, mode),
                service.run_gather_session(&user, source, mode),
            )
            .await
            .unwrap_or_else(|_| Err(anyhow::anyhow!("gather session timed out")));
            let gather_succeeded = outcome.is_ok();

            let finished = match outcome {
                Ok(()) => {
                    service
                        .repo
                        .finish_run(&user, source, RunStatus::Ready, None)
                        .await
                }
                Err(e) => {
                    tracing::warn!(source = source.as_ref(), error = ?e, "gather session failed");
                    service
                        .repo
                        .finish_run(
                            &user,
                            source,
                            RunStatus::Failed,
                            Some(&admission::failure_reason(&e)),
                        )
                        .await
                }
            };
            match finished {
                Ok(true) if gather_succeeded => {
                    let _ = service
                        .maybe_start_auto_import(&user, source)
                        .await
                        .inspect_err(|e| {
                            tracing::error!(source = source.as_ref(), error = ?e, "failed to start automatic import");
                        });
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::error!(source = source.as_ref(), error = ?e, "failed to persist gather outcome");
                }
            }
            service.notify(&user).await;
        });
    }

    /// Claim and spawn a configured automatic import once gathering is ready.
    /// The repository CAS makes this safe when completion, configuration, and
    /// read-path reconciliation race across service replicas.
    async fn maybe_start_auto_import(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<bool> {
        let Some(rows) = self.repo.begin_auto_import(user, source).await? else {
            return Ok(false);
        };
        let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
        self.notify(user).await;
        if rows.is_empty() {
            self.finish_auto_import_batch(user, source, &ids).await;
        } else {
            self.spawn_import_batch(user.clone(), rows, Some(source));
        }
        Ok(true)
    }

    async fn finish_auto_import_batch(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        ids: &[Uuid],
    ) {
        match self.repo.finish_auto_import(user, source, ids).await {
            Ok(Some(status)) => {
                tracing::info!(
                    source = source.as_ref(),
                    status = status.as_ref(),
                    "automatic import finished"
                );
                self.notify(user).await;
            }
            Ok(None) => {}
            Err(e) => {
                tracing::error!(source = source.as_ref(), error = ?e, "failed to persist automatic import outcome");
            }
        }
    }

    /// Run typed Slack discovery or an agent gather with locked staging tools.
    /// Candidates land incrementally; any final agent text is ignored.
    #[tracing::instrument(skip(self, user), err)]
    async fn run_gather_session(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        mode: GatherMode,
    ) -> anyhow::Result<()> {
        // Linear and Notion read their own APIs; only Slack may need an
        // agent, which admits its AI work itself.
        match source {
            ImportSource::Linear => linear::gather_linear(self, user, mode).await.map(|_| ()),
            ImportSource::Notion => notion::gather_notion(self, user, mode).await.map(|_| ()),
            ImportSource::Slack => self.gather_with_tools(user, source, mode).await,
        }
    }

    async fn gather_with_tools(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        mode: GatherMode,
    ) -> anyhow::Result<()> {
        // Typed Slack discovery runs before loading agent tools. Only
        // onboarding may fall back to an agent when workspace reads fail.
        if source == ImportSource::Slack {
            match slack_discovery::gather_slack(self, user, mode).await {
                Ok(_) => return Ok(()),
                Err(SlackSourceError::ToolsUnavailable(_)) if mode == GatherMode::Manual => {
                    anyhow::bail!("Your Slack connection does not expose channel tools");
                }
                Err(e) if mode == GatherMode::Manual => return Err(e.into()),
                Err(e) => {
                    tracing::warn!(error = ?e, "direct slack gather failed; trying the agent");
                }
            }
        }

        let mcp_tools = self.connector_tools(user, source).await?;

        // Staging is idempotent (the ledger dedups already-staged rows), so
        // rerunning the whole session on the fallback model is safe even
        // when the primary died mid-way through staging.
        match self
            .gather_agent_session(user, source, GATHER_MODEL, mcp_tools.clone())
            .await
        {
            Ok(()) => Ok(()),
            Err(e) if e.is::<ai_billing::AiAdmissionError>() => Err(e),
            Err(e) => {
                tracing::warn!(model = GATHER_MODEL, error = ?e, "gather session failed; retrying on the fallback model");
                self.gather_agent_session(user, source, GATHER_FALLBACK_MODEL, mcp_tools)
                    .await
            }
        }
    }

    /// One agent gather session on a specific model.
    #[tracing::instrument(skip(self, user, mcp_tools), err)]
    async fn gather_agent_session<M: ToolSet<ImportToolContext<Self>> + 'static>(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        model: &str,
        mcp_tools: Arc<M>,
    ) -> anyhow::Result<()> {
        let native = gather_toolset::<Self>();
        let toolset = NativePlusMcp::new(native, mcp_tools);
        let context = ImportToolContext {
            service: Some(Arc::new(self.clone())),
            policy: ToolPolicy::gather(source),
        };

        self.drive_session(
            user,
            model,
            GATHER_MAX_TURNS,
            toolset,
            context,
            &prompts::gather_system(),
            prompts::gather_prompt(),
        )
        .await
    }

    /// Load the user's MCP tools for `source`'s connector.
    async fn connector_tools(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> anyhow::Result<Arc<UserMcpTools>> {
        let mcp_tools = self
            .mcp_tools
            .connector_toolset(user, source.connector_ref())
            .await?
            .ok_or_else(|| anyhow::anyhow!("no {} connection", source.as_ref()))?;
        anyhow::ensure!(
            !mcp_tools.is_empty(),
            "could not load tools from {}",
            source.as_ref()
        );
        Ok(Arc::new(mcp_tools))
    }

    /// Run one bounded agent session to completion, discarding the text.
    #[expect(clippy::too_many_arguments, reason = "bounded session configuration")]
    async fn drive_session<M: ToolSet<ImportToolContext<Self>> + 'static>(
        &self,
        user: &MacroUserIdStr<'static>,
        model: impl ToString,
        max_turns: usize,
        toolset: NativePlusMcp<ImportToolContext<Self>, M>,
        context: ImportToolContext<Self>,
        system_prompt: &str,
        user_prompt: &str,
    ) -> anyhow::Result<()> {
        // Covers the Slack gather fallback. Never gate its preceding
        // deterministic work.
        self.admit_ai(user).await?;
        let usage_ctx = ai_usage::UsageContext::new(ai_usage::AiFeature::Import, user.clone());
        let agent_loop = AgentLoop::new(self.recorder.clone())
            .with_model(model)
            .with_max_turns(max_turns);
        let toolset: Arc<dyn ToolSet<ImportToolContext<Self>> + Send + Sync> = Arc::new(toolset);
        let mut session = agent_loop
            .session(toolset, Arc::new(context), system_prompt, usage_ctx)
            .await;

        let opening = ChatMessage {
            role: Role::User,
            content: ChatMessageContent::Text(user_prompt.to_string()),
            attachments: None,
        };
        let mut stream = session
            .send_message(agent::to_rig_messages(&[opening]))
            .await?;
        while let Some(part) = stream.next().await {
            // Only tool effects matter; text chunks are discarded.
            part?;
        }
        Ok(())
    }

    /// Create the task for one accepted Linear row from its staged metadata.
    /// The ledger row carries the user's team so a teammate who imports the
    /// same issue later finds it instead of creating a duplicate.
    async fn create_linear_task(
        &self,
        user: &MacroUserIdStr<'static>,
        row: &ImportEntity,
    ) -> anyhow::Result<(String, Option<Uuid>)> {
        let meta = serde_json::from_value::<LinearIssueMeta>(row.metadata.clone())
            .map_err(|e| anyhow::anyhow!("invalid linear metadata: {e}"))?;
        let (name, markdown) = linear_task_content(&meta);
        let properties = linear_task_properties(&meta, user);
        let team_id = self.repo.user_team_id(user).await?;
        let id = self
            .creator
            .create_task(user, &name, &markdown, &properties)
            .await?;
        Ok((id, team_id))
    }

    /// Copy one accepted Linear/Slack row from staged metadata, refreshing Slack membership live.
    async fn import_deterministic(
        &self,
        user: &MacroUserIdStr<'static>,
        row: &ImportEntity,
        slack_batch: &mut SlackBatch<W::Session>,
    ) -> RowOutcome {
        let created: anyhow::Result<(String, Option<Uuid>)> = match row.source {
            ImportSource::Linear => self.create_linear_task(user, row).await,
            ImportSource::Slack => {
                async {
                    let team_id = self
                        .repo
                        .user_team_id(user)
                        .await?
                        .ok_or_else(|| anyhow::anyhow!("Slack import requires a team"))?;
                    let meta = serde_json::from_value(row.metadata.clone())?;
                    let emails = slack_batch.resolve_emails(self, user, team_id, &meta).await;
                    let id = slack::ensure_channel(
                        &self.repo,
                        self.creator.as_ref(),
                        user,
                        row,
                        team_id,
                        &emails,
                    )
                    .await?;
                    Ok((id.to_string(), Some(team_id)))
                }
                .await
            }
            // Notion rows import through their own pipeline, never here.
            ImportSource::Notion => return RowOutcome::Failed,
        };
        self.settle_row(user, row, created).await
    }

    /// Persist the outcome of creating one row's entity and nudge clients.
    async fn settle_row(
        &self,
        user: &MacroUserIdStr<'static>,
        row: &ImportEntity,
        created: anyhow::Result<(String, Option<Uuid>)>,
    ) -> RowOutcome {
        let (outcome, persisted) = match created {
            Ok((entity_id, team_id)) => match self
                .repo
                .mark_imported(user, row.id, &entity_id, row.source.entity_type(), team_id)
                .await
            {
                Ok(Some(_)) => (RowOutcome::Imported, Ok(())),
                // The CAS missed: the entity exists but the row left
                // `importing` under us (reaped, or another mover). Surface
                // it loudly — re-accepting the row would duplicate the
                // entity.
                Ok(None) => (
                    RowOutcome::Failed,
                    Err(ImportError::Other(anyhow::anyhow!(
                        "created entity {entity_id} but row was no longer importing; possible orphan"
                    ))),
                ),
                Err(e) => (RowOutcome::Failed, Err(e)),
            },
            Err(e) => {
                tracing::warn!(id = %row.id, source = row.source.as_ref(), error = ?e, "deterministic import failed");
                (
                    RowOutcome::Failed,
                    self.repo
                        .mark_import_failed(user, row.id, &e.to_string())
                        .await
                        .map(|_| ()),
                )
            }
        };
        if let Err(e) = persisted {
            tracing::error!(id = %row.id, error = ?e, "failed to persist import outcome");
        }
        self.notify(user).await;
        outcome
    }

    /// Run a claimed import batch in the background. Manual batches only
    /// update their entity rows; automatic batches also settle their owning
    /// run after every row reaches a terminal state. Each row fails on its
    /// own; one bad item never stops the batch.
    fn spawn_import_batch(
        &self,
        user: MacroUserIdStr<'static>,
        rows: Vec<ImportEntity>,
        auto_run: Option<ImportSource>,
    ) {
        let service = self.clone();
        tokio::spawn(async move {
            let started = std::time::Instant::now();
            let batch_ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
            let (mut notion_rows, mut direct_rows): (Vec<ImportEntity>, Vec<ImportEntity>) = rows
                .into_iter()
                .partition(|row| row.source == ImportSource::Notion);
            // The freshest items land first.
            sort_freshest_first(&mut direct_rows);
            sort_freshest_first(&mut notion_rows);

            // Heartbeat every row this batch owns (queued and in-flight) for
            // as long as the batch runs, so the read path's stale reaper only
            // fires on rows whose process actually died.
            let _heartbeat = AbortOnDrop(tokio::spawn({
                let service = service.clone();
                let user = user.clone();
                let ids = batch_ids.clone();
                async move {
                    loop {
                        tokio::time::sleep(IMPORT_HEARTBEAT).await;
                        let _ = service
                            .repo
                            .touch_importing(&user, &ids)
                            .await
                            .inspect_err(|e| {
                                tracing::warn!(error = ?e, "import heartbeat failed");
                            });
                    }
                }
            }));

            let mut outcomes = Vec::new();
            let mut slack_batch = SlackBatch::default();
            for row in &direct_rows {
                let outcome = service
                    .import_deterministic(&user, row, &mut slack_batch)
                    .await;
                outcomes.push((row.id, row.source, outcome));
            }

            if !notion_rows.is_empty() {
                let notion = notion::import_notion_rows(
                    &service,
                    &user,
                    notion_rows,
                    NOTION_IMPORT_CONCURRENCY,
                )
                .await;
                outcomes.extend(
                    notion
                        .into_iter()
                        .map(|(id, outcome)| (id, ImportSource::Notion, outcome)),
                );
                service.notify(&user).await;
            }
            // Rows removed as empty no longer exist to settle.
            let batch_ids: Vec<Uuid> = batch_ids
                .into_iter()
                .filter(|id| {
                    !outcomes
                        .iter()
                        .any(|(row, _, outcome)| row == id && *outcome == RowOutcome::Skipped)
                })
                .collect();

            log_batch(&outcomes, auto_run.is_some(), started.elapsed());
            if let Some(source) = auto_run {
                service
                    .finish_auto_import_batch(&user, source, &batch_ids)
                    .await;
            }
        });
    }
}

impl<R, S, C, W: SlackWorkspaceSource, A: ImportApis> ImportService
    for ImportServiceImpl<R, S, C, W, A>
where
    R: ImportRepo + CanonicalImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
{
    #[tracing::instrument(skip(self, user), err)]
    async fn state(&self, user: MacroUserIdStr<'static>) -> Result<ImportState> {
        // Self-heal on read: import jobs are in-process tasks, so a service
        // restart mid-job orphans its `importing` rows — nothing else would
        // ever move them again. Any row importing longer than the longest
        // legitimate job is dead; send it back to staged so the user can
        // retry instead of watching a spinner forever.
        match self
            .repo
            .fail_stale_importing(&user, STALE_IMPORT_AFTER.as_secs() as i64)
            .await
        {
            Ok(0) => {}
            Ok(reaped) => {
                tracing::warn!(reaped, "reaped orphaned importing rows")
            }
            // A read must never fail because the reap did.
            Err(e) => tracing::warn!(error = ?e, "failed to reap stale imports"),
        }

        match self.repo.reconcile_auto_import_runs(&user).await {
            Ok(0) => {}
            Ok(reconciled) => {
                tracing::warn!(reconciled, "reconciled interrupted automatic import runs");
                self.notify(&user).await;
            }
            // A read must never fail because recovery did.
            Err(e) => tracing::warn!(error = ?e, "failed to reconcile automatic import runs"),
        }

        // Self-heal the small window between persisting gather completion and
        // spawning its configured follow-on batch. The begin CAS makes this
        // safe across concurrent readers and replicas.
        let mut runs = self.repo.list_runs(&user).await?;
        let auto_ready: Vec<ImportSource> = runs
            .iter()
            .filter(|run| run.auto_import && run.status == RunStatus::Ready)
            .map(|run| run.source)
            .collect();
        let mut started = false;
        for source in auto_ready {
            match self.maybe_start_auto_import(&user, source).await {
                Ok(did_start) => started |= did_start,
                Err(e) => {
                    tracing::warn!(source = source.as_ref(), error = ?e, "failed to self-heal automatic import start");
                }
            }
        }
        if started {
            runs = self.repo.list_runs(&user).await?;
        }
        let entities = self.repo.list(&user, None, None).await?;
        Ok(ImportState { runs, entities })
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn start_gather(
        &self,
        user: MacroUserIdStr<'static>,
        source: ImportSource,
        auto_import: bool,
    ) -> Result<bool> {
        if !self.prepare_gather(&user, source, &[]).await? {
            return Ok(false);
        }
        // The CAS decides the winner if another request raced this one.
        let won = self.repo.start_run(&user, source, &[], auto_import).await?;
        if won {
            self.spawn_gather(user.clone(), source, GatherMode::Onboarding);
            self.notify(&user).await;
        }
        Ok(won)
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn start_discovery(
        &self,
        user: MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<bool> {
        if source != ImportSource::Slack {
            return Err(ImportError::UnsupportedDiscovery(source));
        }
        let from = [
            RunStatus::Ready,
            RunStatus::Completed,
            RunStatus::Failed,
            RunStatus::Dismissed,
        ];
        if !self.prepare_gather(&user, source, &from).await? {
            return Ok(false);
        }
        let won = self.repo.start_manual_run(&user, source, &from).await?;
        if won {
            self.spawn_gather(user.clone(), source, GatherMode::Manual);
            self.notify(&user).await;
        }
        Ok(won)
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn retry_gather(
        &self,
        user: MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<bool> {
        if !self
            .prepare_gather(&user, source, &[RunStatus::Failed, RunStatus::Dismissed])
            .await?
        {
            return Ok(false);
        }
        let won = self
            .repo
            .start_run(
                &user,
                source,
                &[RunStatus::Failed, RunStatus::Dismissed],
                false,
            )
            .await?;
        if won {
            self.spawn_gather(user.clone(), source, GatherMode::Onboarding);
            self.notify(&user).await;
        }
        Ok(won)
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn dismiss_run(&self, user: MacroUserIdStr<'static>, source: ImportSource) -> Result<()> {
        let dismissed = self
            .repo
            .transition_run(
                &user,
                source,
                &[RunStatus::Ready, RunStatus::Failed],
                RunStatus::Dismissed,
            )
            .await?;
        if dismissed {
            self.notify(&user).await;
        }
        Ok(())
    }

    #[tracing::instrument(skip(self, user, import_ids, discard_ids), fields(imports = import_ids.len(), discards = discard_ids.len()), err)]
    async fn run_import(
        &self,
        user: MacroUserIdStr<'static>,
        import_ids: Vec<Uuid>,
        discard_ids: Vec<Uuid>,
    ) -> Result<RunImportOutcome> {
        let mut discarded = 0u64;
        for id in discard_ids {
            if self.repo.discard(&user, id).await? {
                discarded += 1;
            }
        }

        // Claim the rows. Imports spend no AI, so nothing checks quota.
        let rows = self.repo.mark_importing(&user, &import_ids).await?;
        let importing = rows.len() as u64;
        self.notify(&user).await;

        if !rows.is_empty() {
            self.spawn_import_batch(user.clone(), rows, None);
        }

        Ok(RunImportOutcome {
            discarded,
            importing,
        })
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn discard_staged_by_initiator(
        &self,
        user: MacroUserIdStr<'static>,
        initiator: Initiator,
    ) -> Result<u64> {
        let discarded = self
            .repo
            .discard_staged_by_initiator(&user, initiator)
            .await?;
        if discarded > 0 {
            self.notify(&user).await;
        }
        Ok(discarded)
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn delete_staged_by_initiator(
        &self,
        user: MacroUserIdStr<'static>,
        initiator: Initiator,
    ) -> Result<u64> {
        let removed = self
            .repo
            .delete_staged_by_initiator(&user, initiator)
            .await?;
        if removed > 0 {
            self.notify(&user).await;
        }
        Ok(removed)
    }
}

impl<R, S, C, W: SlackWorkspaceSource, A: ImportApis> ImportServiceImpl<R, S, C, W, A>
where
    R: ImportRepo + CanonicalImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
{
    /// Stage what discovery found, in order, nudging clients as the section
    /// fills. Items already imported (by the user or a teammate), declined,
    /// or in flight are left alone: the ledger is the dedupe.
    async fn stage_discovered(
        &self,
        user: &MacroUserIdStr<'static>,
        mode: GatherMode,
        source: ImportSource,
        items: Vec<(String, serde_json::Value)>,
    ) -> usize {
        let initiator = match mode {
            GatherMode::Onboarding => Initiator::Onboarding,
            GatherMode::Manual => Initiator::Manual,
        };
        let mut staged = 0;
        for (foreign_id, metadata) in items {
            match self
                .stage_inner(user, initiator, source, &foreign_id, metadata, false)
                .await
            {
                Ok(StageOutcome::Staged(_)) => {
                    staged += 1;
                    if staged % DISCOVERY_NOTIFY_EVERY == 0 {
                        self.notify(user).await;
                    }
                }
                Ok(_) => {}
                Err(error) => {
                    tracing::warn!(source = source.as_ref(), item = %foreign_id, error = ?error, "failed to stage a discovered item");
                }
            }
        }
        self.notify(user).await;
        staged
    }

    #[tracing::instrument(skip(self, user, metadata), err)]
    async fn stage_inner(
        &self,
        user: &MacroUserIdStr<'static>,
        initiator: Initiator,
        source: ImportSource,
        foreign_id: &str,
        metadata: serde_json::Value,
        notify: bool,
    ) -> Result<StageOutcome> {
        let foreign_id = source
            .normalize_foreign_id(foreign_id)
            .ok_or_else(|| ImportError::Other(anyhow::anyhow!("foreign_id must not be empty")))?;
        let metadata = validate_metadata(source, metadata)?;

        // The user's own row wins over any teammate row.
        if let Some(own) = self
            .repo
            .get_own_by_foreign_id(user, source, &foreign_id)
            .await?
        {
            match own.status {
                ImportStatus::Imported => {
                    return Ok(StageOutcome::AlreadyImported {
                        entity: own,
                        by_teammate: false,
                    });
                }
                ImportStatus::Discarded => return Ok(StageOutcome::PreviouslyDiscarded(own)),
                ImportStatus::Importing => return Ok(StageOutcome::ImportInProgress(own)),
                ImportStatus::Staged => {}
            }
        } else if let Some(teammate) = self
            .repo
            .find_team_imported(user, source, &foreign_id)
            .await?
        {
            return Ok(StageOutcome::AlreadyImported {
                entity: teammate,
                by_teammate: true,
            });
        }

        match self
            .repo
            .upsert_staged(user, source, initiator, &foreign_id, &metadata)
            .await?
        {
            Some(row) => {
                if notify {
                    self.notify(user).await;
                }
                Ok(StageOutcome::Staged(row))
            }
            // Raced into a non-staged status between the check and the
            // upsert; re-read and classify.
            None => {
                let row = self
                    .repo
                    .get_own_by_foreign_id(user, source, &foreign_id)
                    .await?
                    .ok_or_else(|| {
                        ImportError::Other(anyhow::anyhow!("staging upsert vanished"))
                    })?;
                match row.status {
                    ImportStatus::Discarded => Ok(StageOutcome::PreviouslyDiscarded(row)),
                    ImportStatus::Imported => Ok(StageOutcome::AlreadyImported {
                        entity: row,
                        by_teammate: false,
                    }),
                    _ => Ok(StageOutcome::ImportInProgress(row)),
                }
            }
        }
    }
}

impl<R, S, C, W: SlackWorkspaceSource, A: ImportApis> ImportStager
    for ImportServiceImpl<R, S, C, W, A>
where
    R: ImportRepo + CanonicalImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
{
    async fn stage(
        &self,
        user: &MacroUserIdStr<'static>,
        initiator: Initiator,
        source: ImportSource,
        foreign_id: &str,
        metadata: serde_json::Value,
    ) -> Result<StageOutcome> {
        self.stage_inner(user, initiator, source, foreign_id, metadata, true)
            .await
    }

    #[tracing::instrument(skip(self, user, metadata), err)]
    async fn record_imported(
        &self,
        user: &MacroUserIdStr<'static>,
        initiator: Initiator,
        source: ImportSource,
        foreign_id: &str,
        metadata: serde_json::Value,
        entity_id: &str,
    ) -> Result<ImportEntity> {
        let foreign_id = source
            .normalize_foreign_id(foreign_id)
            .ok_or_else(|| ImportError::Other(anyhow::anyhow!("foreign_id must not be empty")))?;
        let metadata = validate_metadata(source, metadata)?;

        // Channels always associate with the user's team when they have one.
        let team_id = match source {
            ImportSource::Slack => self.repo.user_team_id(user).await?,
            _ => None,
        };

        let row = self
            .repo
            .upsert_imported(
                user,
                source,
                initiator,
                &foreign_id,
                &metadata,
                entity_id,
                source.entity_type(),
                team_id,
            )
            .await?;
        self.notify(user).await;
        Ok(row)
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn discard_entity(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<DiscardOutcome> {
        if self.repo.discard(user, id).await? {
            self.notify(user).await;
            return Ok(DiscardOutcome::Discarded);
        }
        Ok(match self.repo.get(user, id).await? {
            None => DiscardOutcome::NotFound,
            Some(row) => DiscardOutcome::NotDiscardable(row.status),
        })
    }

    async fn list_entities(
        &self,
        user: &MacroUserIdStr<'static>,
        source: Option<ImportSource>,
        status: Option<ImportStatus>,
    ) -> Result<Vec<ImportEntity>> {
        self.repo.list(user, source, status).await
    }
}

impl<R, S, C, W: SlackWorkspaceSource, A: ImportApis> NotionPageImporter
    for ImportServiceImpl<R, S, C, W, A>
where
    R: ImportRepo + CanonicalImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
{
    #[tracing::instrument(skip(self, user), fields(page = page_url_or_id), err)]
    async fn import_notion_page(
        &self,
        user: &MacroUserIdStr<'static>,
        page_url_or_id: &str,
    ) -> Result<ImportNotionPageOutcome> {
        let page_url_or_id = page_url_or_id.trim();
        if page_url_or_id.is_empty() {
            return Err(ImportError::Other(anyhow::anyhow!(
                "Notion page URL or id must not be empty"
            )));
        }
        let session = self.notion_session(user);
        match session.owner().await {
            Err(ApiSourceError::NotConnected(_)) => Err(ImportError::Other(anyhow::anyhow!(
                "Notion import needs Notion connected through Macro's connections (Pipedream)"
            ))),
            Err(error) => Err(ImportError::Other(error.into())),
            Ok(owner) => {
                self.import_notion_page_via_api(user, &session, &owner, page_url_or_id)
                    .await
            }
        }
    }
}

impl<R, S, C, W: SlackWorkspaceSource, A: ImportApis> ImportServiceImpl<R, S, C, W, A>
where
    R: ImportRepo + CanonicalImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
{
    /// Import one page through Notion's API: read the page, stage it with
    /// its facts, then convert and create it like a discovered page.
    async fn import_notion_page_via_api(
        &self,
        user: &MacroUserIdStr<'static>,
        session: &impl NotionSession,
        owner: &NotionOwner,
        page_url_or_id: &str,
    ) -> Result<ImportNotionPageOutcome> {
        let id = ImportSource::Notion
            .normalize_foreign_id(page_url_or_id)
            .and_then(|id| NotionId::parse(&id))
            .ok_or_else(|| {
                ImportError::Other(anyhow::anyhow!(
                    "not a Notion page URL or id: {page_url_or_id}"
                ))
            })?;
        let page = session.page(&id).await.map_err(|error| match error {
            ApiSourceError::NotFound => ImportError::Other(anyhow::anyhow!(
                "the Notion page does not exist or is not shared with the Notion connection"
            )),
            other => ImportError::Other(other.into()),
        })?;
        if page.archived {
            return Err(ImportError::Other(anyhow::anyhow!(
                "the Notion page is archived"
            )));
        }
        let metadata = serde_json::to_value(notion::notion_doc_meta(&page, owner))?;
        let staged = self
            .stage(
                user,
                Initiator::Chat,
                ImportSource::Notion,
                id.as_str(),
                metadata,
            )
            .await?;
        let staged_row = match staged {
            StageOutcome::Staged(row) => row,
            StageOutcome::AlreadyImported {
                entity,
                by_teammate,
            } => {
                return Ok(ImportNotionPageOutcome::Imported {
                    entity,
                    already_existed: true,
                    by_teammate,
                });
            }
            StageOutcome::PreviouslyDiscarded(row) => {
                return Ok(ImportNotionPageOutcome::PreviouslyDiscarded(row));
            }
            StageOutcome::ImportInProgress(row) => {
                return Ok(ImportNotionPageOutcome::ImportInProgress(row));
            }
        };
        let Some(row) = self
            .repo
            .mark_importing(user, &[staged_row.id])
            .await?
            .into_iter()
            .next()
        else {
            let row = self.repo.get(user, staged_row.id).await?.ok_or_else(|| {
                ImportError::Other(anyhow::anyhow!(
                    "Notion import row {} disappeared before it could start",
                    staged_row.id
                ))
            })?;
            return match row.status {
                ImportStatus::Imported => Ok(ImportNotionPageOutcome::Imported {
                    entity: row,
                    already_existed: true,
                    by_teammate: false,
                }),
                ImportStatus::Importing => Ok(ImportNotionPageOutcome::ImportInProgress(row)),
                ImportStatus::Discarded => Ok(ImportNotionPageOutcome::PreviouslyDiscarded(row)),
                ImportStatus::Staged => Err(ImportError::Other(anyhow::anyhow!(
                    "Notion page could not be claimed for import"
                ))),
            };
        };
        self.notify(user).await;

        let (facts, plan) = notion::plan_batch(session, std::slice::from_ref(&row)).await;
        let outcome = notion::import_notion_row(self, session, user, &row, &facts[0], &plan).await;
        let row = self.repo.get(user, row.id).await?;
        match (outcome, row) {
            (RowOutcome::Imported, Some(row)) => Ok(ImportNotionPageOutcome::Imported {
                entity: row,
                already_existed: false,
                by_teammate: false,
            }),
            (RowOutcome::Skipped, _) => Err(ImportError::Other(anyhow::anyhow!(
                "the Notion page has no content to import"
            ))),
            (_, row) => Err(ImportError::Other(anyhow::anyhow!(
                "Notion page import failed: {}",
                row.and_then(|row| row.last_error)
                    .unwrap_or_else(|| "the import did not create a document".to_string())
            ))),
        }
    }
}

/// Aborts the wrapped task when dropped — ties a background task (e.g. the
/// import heartbeat) to the lifetime of the scope that spawned it, whatever
/// path that scope exits through.
struct AbortOnDrop(tokio::task::JoinHandle<()>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// A toolset combining an in-process collection with the user's connector
/// MCP tools: native tools win by name, everything else routes to MCP.
struct NativePlusMcp<Context, M> {
    native: ai_toolset::AsyncToolCollection<Context>,
    native_names: HashSet<String>,
    mcp: Arc<M>,
}

impl<Context: Send + Sync + 'static, M> NativePlusMcp<Context, M> {
    fn new(native: ai_toolset::AsyncToolCollection<Context>, mcp: Arc<M>) -> Self {
        let native_names = native
            .request_schemas()
            .unwrap_or_default()
            .into_iter()
            .map(|schema| schema.name)
            .collect();
        Self {
            native,
            native_names,
            mcp,
        }
    }
}

impl<Context, M> ToolSet<Context> for NativePlusMcp<Context, M>
where
    Context: Clone + Send + Sync + 'static,
    M: ToolSet<Context>,
{
    fn dispatch_tool_call<'a>(
        &'a self,
        context: Context,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> Pin<
        Box<
            dyn Future<Output = std::result::Result<ToolResult<serde_json::Value>, ToolSetError>>
                + 'a
                + Send,
        >,
    > {
        if self.native_names.contains(tool_name) {
            self.native
                .dispatch_tool_call(context, request_context, tool_name, json)
        } else {
            self.mcp
                .dispatch_tool_call(context, request_context, tool_name, json)
        }
    }

    fn request_schemas(&self) -> Option<Vec<ai_toolset::RequestSchema>> {
        let mut schemas = self.native.request_schemas().unwrap_or_default();
        schemas.extend(ToolSet::<Context>::request_schemas(&*self.mcp).unwrap_or_default());
        (!schemas.is_empty()).then_some(schemas)
    }
}
