//! The import orchestrator: staging (with team-wide dedup), Slack discovery,
//! and import jobs.
//!
//! Slack discovery uses the typed workspace source port to stage every
//! visible public channel for the user to pick from; it never uses an agent
//! or imports on its own. Linear and Notion rows are staged by chat tools.
//! Import jobs copy accepted rows in: Linear tasks and Slack channels are
//! composed deterministically from staged metadata; Notion pages are fetched
//! directly through the connector's fetch tool (no model in the content
//! path), falling back to a bounded single-page Haiku session that lands
//! content through `FinalizeImport` when the direct path can't cope.

use super::models::*;
use super::ports::{
    CanonicalImportRepo, EntityCreator, ImportError, ImportRepo, ImportedDocumentProperties,
    ImportedDocumentProperty, ImportedDocumentPropertyValue, ImportedTaskProperties, NotionLinks,
    Result, SlackSourceError, SlackWorkspaceSource,
};
use crate::inbound::toolset::{ImportToolContext, notion_import_toolset};
use agent::types::{ChatMessage, ChatMessageContent, Role};
use agent::{AgentLoop, PredefinedModel};
use ai_toolset::{RequestContext, ToolResult, ToolSet, ToolSetError};
use futures::StreamExt;
use import_notion::domain::ports::NotionConnections;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_select::{ConnectorSelect, UserMcpTools};
use std::collections::HashSet;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::LazyLock;
use std::time::Duration;
use uuid::Uuid;

mod admission;
mod notion_workspace;
mod tracker_workspace;
mod workspace;
pub use workspace::WorkspaceImporter;
mod prompts;
mod slack;
mod slack_discovery;

pub use notion_workspace::NoNotionConnections;
pub use slack_discovery::NoSlackSource;
use slack_discovery::SlackBatch;

#[cfg(test)]
mod test;

/// Model for Notion import sessions (normal ai_usage attribution).
const NOTION_IMPORT_MODEL: PredefinedModel = PredefinedModel::Fast;
/// Hard cap on importing ONE Notion page (fetch + convert + finalize).
/// Pages run as independent single-page sessions.
const NOTION_PAGE_IMPORT_TIMEOUT: Duration = Duration::from_secs(120);

/// How many Notion page sessions run at once for one accepted batch —
/// enough to collapse the batch latency toward the slowest page, low
/// enough to stay polite to Notion's MCP.
const NOTION_IMPORT_CONCURRENCY: usize = 4;

/// Hard cap on one manual Slack discovery: a full channel listing plus
/// membership reads for every channel.
const SLACK_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(360);

/// How long a discovery run may stay `running` before the read path declares
/// its process dead. Twice the discovery timeout, so a live run is never reaped.
const STALE_RUN_AFTER: Duration = Duration::from_secs(SLACK_DISCOVERY_TIMEOUT.as_secs() * 2);

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

/// Turn cap for a Notion import session: fetch + finalize per page, plus
/// slack for retries.
fn notion_import_max_turns(pages: usize) -> usize {
    (2 * pages + 6).min(40)
}

fn notion_import_failure_reason(outcome: &anyhow::Result<()>) -> String {
    outcome
        .as_ref()
        .err()
        .map(admission::failure_reason)
        .unwrap_or_else(|| "the import job did not finish this item".to_string())
}

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

/// The API the import router talks to.
pub trait ImportService: Send + Sync + 'static {
    /// The full import aggregate for the user.
    fn state(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<ImportState>> + Send;

    /// User-triggered discovery that stages everything visible. Only Slack is
    /// supported. Returns whether a run started.
    fn start_discovery(
        &self,
        user: MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Accept `import_ids` (flip to `importing` and start import jobs) and
    /// discard `discard_ids`.
    fn run_import(
        &self,
        user: MacroUserIdStr<'static>,
        import_ids: Vec<Uuid>,
        discard_ids: Vec<Uuid>,
    ) -> impl Future<Output = Result<RunImportOutcome>> + Send;
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

/// Finalization the Notion import session's `FinalizeImport` tool drives:
/// create the Macro entity for one `importing` row and flip it to
/// `imported`.
pub trait ImportFinalizer: Send + Sync + 'static {
    /// Create the document for `import_id` (fixed mapping: linear → task,
    /// notion → md) and mark the row imported.
    fn finalize_document(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        name: &str,
        content_markdown: &str,
        properties: &ImportedDocumentProperties,
    ) -> impl Future<Output = Result<ImportEntity>> + Send;
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
/// Unlike [`ImportFinalizer`], this owns the complete operation: deduplication,
/// ledger transitions, connector fetch, content checks, document
/// creation, and final ledger state.
pub trait NotionPageImporter: Send + Sync + 'static {
    /// Import a Notion page URL or page id for `user`.
    fn import_notion_page(
        &self,
        user: &MacroUserIdStr<'static>,
        page_url_or_id: &str,
    ) -> impl Future<Output = Result<ImportNotionPageOutcome>> + Send;
}

/// Importing a whole Notion workspace (or part of it) through a reviewed plan.
///
/// Planning reads the workspace and asks the decision model what to do with
/// each object; the plan is staged as ledger rows and presented for review.
/// Approving the review writes the plan; nothing is written before that.
pub trait NotionWorkspaceImporter: Send + Sync + 'static {
    /// Plan an import of `scope`, replacing any previous plan. Planning runs
    /// in the background; this waits up to `wait` for it and reports where it
    /// got. `sharing` is required of a user on a team
    /// ([`ImportError::NotionSharingRequired`]); without a team everything
    /// is personal.
    fn prepare_notion_import(
        &self,
        user: &MacroUserIdStr<'static>,
        scope: import_notion::domain::model::ImportScope,
        sharing: Option<NotionSharing>,
        wait: Duration,
    ) -> impl Future<Output = Result<NotionImportReport>> + Send;

    /// Where the user's Notion import stands.
    fn notion_import_report(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<NotionImportReport>> + Send;

    /// Tie the staged plan to the review presenting it in agent session
    /// `session_id`, which then hears when the plan is ready and when its
    /// write ends.
    fn attach_notion_review(
        &self,
        user: &MacroUserIdStr<'static>,
        review_id: Uuid,
        session_id: agent_session::domain::model::AgentSessionId,
    ) -> impl Future<Output = Result<u64>> + Send;

    /// Write the plan tied to `review_id` with the owner's `choices`.
    /// Writing runs in the background; this returns once it has started.
    fn start_notion_write(
        &self,
        user: &MacroUserIdStr<'static>,
        review_id: Uuid,
        choices: NotionWriteChoices,
    ) -> impl Future<Output = Result<NotionImportReport>> + Send;

    /// Stop planning or writing. Objects already written stay. Returns
    /// whether anything was running.
    fn cancel_notion_import(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<bool>> + Send;
}

/// Concrete orchestrator wiring the repo, the user's MCP servers, the
/// entity creator, and usage recording together.
pub struct ImportServiceImpl<R, S, C, W = NoSlackSource, N = NoNotionConnections> {
    repo: R,
    notion: Arc<N>,
    workspace_source: ImportSource,
    trackers: std::collections::HashMap<
        ImportSource,
        Arc<dyn import_tracker::domain::model::TrackerConnections>,
    >,
    slack_source: Arc<W>,
    mcp_tools: Arc<S>,
    creator: Arc<C>,
    recorder: Arc<dyn ai_usage::UsageRecorder>,
    admission: Arc<dyn ai_billing::AiAdmissionService>,
    notifier: Option<ImportNotify>,
    jobs: WorkspaceJobs,
}

/// Where this process runs Notion workspace imports: its identity on the
/// runs it holds, the shutdown that makes them hand over, and the tracker the
/// host waits on before exiting.
#[derive(Clone)]
struct WorkspaceJobs {
    instance: Uuid,
    shutdown: tokio_util::sync::CancellationToken,
    tracker: tokio_util::task::TaskTracker,
}

impl WorkspaceJobs {
    fn new() -> Self {
        Self {
            instance: Uuid::now_v7(),
            shutdown: tokio_util::sync::CancellationToken::new(),
            tracker: tokio_util::task::TaskTracker::new(),
        }
    }
}

impl<R: Clone, S, C, W: SlackWorkspaceSource, N> Clone for ImportServiceImpl<R, S, C, W, N> {
    fn clone(&self) -> Self {
        Self {
            repo: self.repo.clone(),
            notion: self.notion.clone(),
            workspace_source: self.workspace_source,
            trackers: self.trackers.clone(),
            slack_source: self.slack_source.clone(),
            mcp_tools: self.mcp_tools.clone(),
            creator: self.creator.clone(),
            recorder: self.recorder.clone(),
            admission: self.admission.clone(),
            notifier: self.notifier.clone(),
            jobs: self.jobs.clone(),
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
            notion: Arc::new(NoNotionConnections),
            workspace_source: ImportSource::Notion,
            trackers: Default::default(),
            slack_source: Arc::new(NoSlackSource),
            mcp_tools,
            creator,
            recorder,
            admission: Arc::new(ai_billing::DisabledAiAdmissionService),
            notifier: None,
            jobs: WorkspaceJobs::new(),
        }
    }
}

impl<R, S, C, W: SlackWorkspaceSource, N: Send + Sync + 'static> ImportServiceImpl<R, S, C, W, N> {
    /// Attach a live Slack workspace reader, preserving the service configuration.
    pub fn with_slack_source<W2: SlackWorkspaceSource>(
        self,
        source: Arc<W2>,
    ) -> ImportServiceImpl<R, S, C, W2, N> {
        ImportServiceImpl {
            repo: self.repo,
            notion: self.notion,
            workspace_source: self.workspace_source,
            trackers: self.trackers,
            mcp_tools: self.mcp_tools,
            creator: self.creator,
            recorder: self.recorder,
            admission: self.admission,
            notifier: self.notifier,
            jobs: self.jobs,
            slack_source: source,
        }
    }

    /// Register the read-only Linear and Jira adapters supplied by the host.
    pub fn with_tracker_connections(
        mut self,
        linear: Arc<dyn import_tracker::domain::model::TrackerConnections>,
        jira: Arc<dyn import_tracker::domain::model::TrackerConnections>,
    ) -> Self {
        self.trackers.insert(ImportSource::Linear, linear);
        self.trackers.insert(ImportSource::Jira, jira);
        self
    }

    /// Push state-change nudges through the given notifier.
    pub fn with_notifier(mut self, notifier: ImportNotify) -> Self {
        self.notifier = Some(notifier);
        self
    }

    /// Run Notion workspace imports on `tracker`, handing them over to
    /// another process once `shutdown` is cancelled: a job stops at its next
    /// checkpoint and gives up its run, which the next process adopts. The
    /// host waits on `tracker` before exiting.
    pub fn with_job_shutdown(
        mut self,
        shutdown: tokio_util::sync::CancellationToken,
        tracker: tokio_util::task::TaskTracker,
    ) -> Self {
        self.jobs.shutdown = shutdown;
        self.jobs.tracker = tracker;
        self
    }

    /// Read users' Notion workspaces through `connections` for workspace
    /// imports.
    pub fn with_notion_connections<N2: NotionConnections>(
        self,
        connections: Arc<N2>,
    ) -> ImportServiceImpl<R, S, C, W, N2> {
        ImportServiceImpl {
            repo: self.repo,
            notion: connections,
            workspace_source: self.workspace_source,
            trackers: self.trackers,
            mcp_tools: self.mcp_tools,
            creator: self.creator,
            recorder: self.recorder,
            admission: self.admission,
            notifier: self.notifier,
            jobs: self.jobs,
            slack_source: self.slack_source,
        }
    }

    async fn notify(&self, user: &MacroUserIdStr<'static>) {
        if let Some(notifier) = &self.notifier {
            notifier(user.clone()).await;
        }
    }
}

impl<R, S, C, W: SlackWorkspaceSource, N: Send + Sync + 'static> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
{
    /// Fail discovery runs that outlived their own timeout: their process died
    /// (crash or deploy) and the run would otherwise block a new discovery
    /// forever. Best-effort, so a read or a restart never fails because of it.
    async fn reap_stale_runs(&self, user: &MacroUserIdStr<'static>) {
        match self
            .repo
            .fail_stale_runs(user, STALE_RUN_AFTER.as_secs() as i64)
            .await
        {
            Ok(0) => {}
            Ok(reaped) => tracing::warn!(reaped, "reaped orphaned discovery runs"),
            Err(e) => tracing::warn!(error = ?e, "failed to reap stale discovery runs"),
        }
    }

    /// Spawn Slack discovery; finishes the run row either way and nudges the
    /// client.
    fn spawn_slack_discovery(&self, user: MacroUserIdStr<'static>) {
        let service = self.clone();
        tokio::spawn(async move {
            let outcome = tokio::time::timeout(
                SLACK_DISCOVERY_TIMEOUT,
                slack_discovery::discover_slack(&service, &user),
            )
            .await
            .unwrap_or_else(|_| Err(anyhow::anyhow!("Slack discovery timed out").into()));
            let finished = match outcome {
                Ok(_) => {
                    service
                        .repo
                        .finish_run(&user, ImportSource::Slack, RunStatus::Ready, None)
                        .await
                }
                Err(e) => {
                    tracing::warn!(error = ?e, "Slack discovery failed");
                    let reason = match e {
                        SlackSourceError::ToolsUnavailable(_) => {
                            "Your Slack connection does not expose channel tools".to_string()
                        }
                        e => e.to_string(),
                    };
                    service
                        .repo
                        .finish_run(&user, ImportSource::Slack, RunStatus::Failed, Some(&reason))
                        .await
                }
            };
            let _ = finished.inspect_err(|e| {
                tracing::error!(error = ?e, "failed to persist Slack discovery outcome");
            });
            service.notify(&user).await;
        });
    }

    /// Copy one accepted Notion page in WITHOUT a model: call the
    /// connector's fetch tool directly, take the markdown it returns, and
    /// finalize. The fallback Haiku session exists for pages this can't
    /// handle — routing page content through a model means re-emitting the
    /// whole page as output tokens, which is an order of magnitude slower.
    #[tracing::instrument(skip(self, user, mcp_tools, row), fields(id = %row.id), err(level = "debug"))]
    async fn import_notion_page_direct<M: ToolSet<()>>(
        &self,
        user: &MacroUserIdStr<'static>,
        mcp_tools: &M,
        row: &ImportEntity,
    ) -> anyhow::Result<()> {
        let fetch_tool = notion_fetch_tool_name(mcp_tools)
            .ok_or_else(|| anyhow::anyhow!("connector exposes no notion-fetch tool"))?;
        let target = row
            .metadata
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or(&row.foreign_id)
            .to_string();

        let result = ToolSet::<()>::try_tool_call(
            mcp_tools,
            (),
            RequestContext::new(user.clone()),
            &fetch_tool,
            &serde_json::json!({ "id": target }),
        )
        .await
        .map_err(|e| anyhow::anyhow!("fetch dispatch failed: {e}"))?
        .map_err(|e| anyhow::anyhow!("fetch failed: {}", e.description))?;

        let fetched = parse_notion_fetch_result(result);
        anyhow::ensure!(
            !fetched.is_database,
            "fetched object is a Notion database rather than a page"
        );
        anyhow::ensure!(
            !fetched.truncated,
            "fetched page was truncated and requires additional subtree fetches"
        );

        let name = fetched
            .title
            .or_else(|| {
                row.metadata
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|title| !title.is_empty())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "Untitled".to_string());
        self.finalize_document(user, row.id, &name, &fetched.body, &fetched.properties)
            .await
            .map_err(|e| anyhow::anyhow!("finalize failed: {e}"))?;
        Ok(())
    }

    /// Fallback: run a single-page Haiku session over the shared connector
    /// tools. Rows the agent fails to finalize are handled by the caller.
    #[tracing::instrument(skip(self, user, mcp_tools, rows), fields(pages = rows.len()), err)]
    async fn run_notion_import_session<M: ToolSet<ImportToolContext<Self>> + 'static>(
        &self,
        user: &MacroUserIdStr<'static>,
        rows: &[ImportEntity],
        mcp_tools: Arc<M>,
    ) -> anyhow::Result<()> {
        let native = notion_import_toolset::<Self>();
        let toolset = NativePlusMcp::new(native, mcp_tools);
        let context = ImportToolContext::wired(Arc::new(self.clone()));

        self.drive_session(
            user,
            NOTION_IMPORT_MODEL,
            notion_import_max_turns(rows.len()),
            toolset,
            context,
            prompts::NOTION_IMPORT_SYSTEM,
            &prompts::notion_import_prompt(rows),
        )
        .await
    }

    /// Load the user's MCP tools for `source`'s connector. Shared (behind an
    /// Arc) across the concurrent per-page work of one batch.
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
        // Covers Slack/Notion fallbacks and pages waiting behind the batch's
        // concurrency limit. Never gate their preceding deterministic work.
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

    /// Copy one accepted Linear/Slack row from staged metadata, refreshing Slack membership live.
    async fn import_deterministic(
        &self,
        user: &MacroUserIdStr<'static>,
        row: &ImportEntity,
        slack_batch: &mut SlackBatch<W::Session>,
    ) {
        let created: anyhow::Result<(String, Option<Uuid>)> = match row.source {
            ImportSource::Linear => {
                match serde_json::from_value::<LinearIssueMeta>(row.metadata.clone()) {
                    Ok(meta) => {
                        let (name, markdown) = linear_task_content(&meta);
                        let properties = linear_task_properties(&meta);
                        self.creator
                            .create_task(user, &name, &markdown, &properties)
                            .await
                            .map(|id| (id, None))
                    }
                    Err(e) => Err(anyhow::anyhow!("invalid linear metadata: {e}")),
                }
            }
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
            // Notion rows go through the agent session, never here.
            ImportSource::Notion | ImportSource::Jira => return,
        };

        let persisted = match created {
            Ok((entity_id, team_id)) => match self
                .repo
                .mark_imported(user, row.id, &entity_id, row.source.entity_type(), team_id)
                .await
            {
                Ok(Some(_)) => Ok(()),
                // The CAS missed: the entity exists but the row left
                // `importing` under us (reaped, or another mover). Surface
                // it loudly — re-accepting the row would duplicate the
                // entity — matching finalize_document's behavior.
                Ok(None) => Err(ImportError::Other(anyhow::anyhow!(
                    "created entity {entity_id} but row was no longer importing; possible orphan"
                ))),
                Err(e) => Err(e),
            },
            Err(e) => {
                tracing::warn!(id = %row.id, source = row.source.as_ref(), error = ?e, "deterministic import failed");
                self.repo
                    .mark_import_failed(user, row.id, &e.to_string())
                    .await
                    .map(|_| ())
            }
        };
        if let Err(e) = persisted {
            tracing::error!(id = %row.id, error = ?e, "failed to persist import outcome");
        }
        self.notify(user).await;
    }

    /// Fail every row of `ids` still `importing` (agent session ended
    /// without finalizing them).
    async fn fail_unfinished(&self, user: &MacroUserIdStr<'static>, ids: &[Uuid], reason: &str) {
        for id in ids {
            match self.repo.get(user, *id).await {
                Ok(Some(row)) if row.status == ImportStatus::Importing => {
                    if let Err(e) = self.repo.mark_import_failed(user, *id, reason).await {
                        tracing::error!(id = %id, error = ?e, "failed to mark unfinished import");
                    }
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::error!(id = %id, error = ?e, "failed to check unfinished import")
                }
            }
        }
    }

    /// Run the canonical single-page Notion pipeline for a row that is
    /// already `importing`.
    async fn process_notion_page<M>(
        &self,
        user: &MacroUserIdStr<'static>,
        mcp_tools: Arc<M>,
        row: &ImportEntity,
    ) -> anyhow::Result<()>
    where
        M: ToolSet<()> + ToolSet<ImportToolContext<Self>> + 'static,
    {
        let outcome = tokio::time::timeout(NOTION_PAGE_IMPORT_TIMEOUT, async {
            match self
                .import_notion_page_direct(user, &*mcp_tools, row)
                .await
            {
                Ok(()) => Ok(()),
                Err(direct_error) => {
                    tracing::info!(id = %row.id, error = ?direct_error, "direct notion import failed; trying the agent");
                    self.run_notion_import_session(
                        user,
                        std::slice::from_ref(row),
                        mcp_tools,
                    )
                    .await
                }
            }
        })
        .await
        .unwrap_or_else(|_| Err(anyhow::anyhow!("notion import timed out")));

        let _ = outcome.as_ref().inspect_err(|e| {
            tracing::warn!(id = %row.id, error = ?e, "notion page import failed");
        });
        let failure_reason = notion_import_failure_reason(&outcome);
        self.fail_unfinished(user, &[row.id], &failure_reason).await;
        outcome
    }

    /// Run a claimed import batch in the background.
    fn spawn_import_batch(&self, user: MacroUserIdStr<'static>, rows: Vec<ImportEntity>) {
        let service = self.clone();
        tokio::spawn(async move {
            let batch_ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
            let (notion_rows, direct_rows): (Vec<ImportEntity>, Vec<ImportEntity>) = rows
                .into_iter()
                .partition(|row| row.source == ImportSource::Notion);

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

            let mut slack_batch = SlackBatch::default();
            for row in &direct_rows {
                service
                    .import_deterministic(&user, row, &mut slack_batch)
                    .await;
            }

            if !notion_rows.is_empty() {
                // One connector connection per batch, pages a few at a time.
                // Each page first tries direct fetch → markdown → finalize;
                // the agent session is the fallback.
                let mcp_tools = match service.connector_tools(&user, ImportSource::Notion).await {
                    Ok(tools) => tools,
                    Err(e) => {
                        tracing::warn!(error = ?e, "notion connector unavailable");
                        let ids: Vec<Uuid> = notion_rows.iter().map(|row| row.id).collect();
                        service
                            .fail_unfinished(&user, &ids, &format!("notion unavailable: {e}"))
                            .await;
                        service.notify(&user).await;
                        return;
                    }
                };

                futures::stream::iter(notion_rows)
                    .for_each_concurrent(NOTION_IMPORT_CONCURRENCY, |row| {
                        let service = service.clone();
                        let user = user.clone();
                        let mcp_tools = mcp_tools.clone();
                        async move {
                            let _ = service.process_notion_page(&user, mcp_tools, &row).await;
                        }
                    })
                    .await;
                service.notify(&user).await;
            }
        });
    }
}

impl<R, S, C, W: SlackWorkspaceSource, N: Send + Sync + 'static> ImportService
    for ImportServiceImpl<R, S, C, W, N>
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

        self.reap_stale_runs(&user).await;
        let runs = self.repo.list_runs(&user).await?;
        let entities = self.repo.list(&user, None, None).await?;
        Ok(ImportState { runs, entities })
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
        self.reap_stale_runs(&user).await;
        let won = self.repo.start_run(&user, source, &from).await?;
        if won {
            self.spawn_slack_discovery(user.clone());
            self.notify(&user).await;
        }
        Ok(won)
    }

    #[tracing::instrument(skip(self, user, import_ids, discard_ids), fields(imports = import_ids.len(), discards = discard_ids.len()), err)]
    async fn run_import(
        &self,
        user: MacroUserIdStr<'static>,
        import_ids: Vec<Uuid>,
        discard_ids: Vec<Uuid>,
    ) -> Result<RunImportOutcome> {
        for id in &import_ids {
            if let Some(row) = self.repo.get(&user, *id).await?
                && (row.metadata.get("plan").is_some() || row.source == ImportSource::Jira)
            {
                return Err(ImportError::NotReady(
                    "Workspace plans must be approved through their review.",
                ));
            }
        }
        let mut discarded = 0u64;
        for id in discard_ids {
            if self.repo.discard(&user, id).await? {
                discarded += 1;
            }
        }

        // Claim deterministic work without quota checks. Even Notion tries a
        // direct fetch first; only its AI fallback needs admission, and any
        // refusal releases the row through the usual failure bookkeeping.
        let rows = self.repo.mark_importing(&user, &import_ids).await?;
        let importing = rows.len() as u64;
        self.notify(&user).await;

        if !rows.is_empty() {
            self.spawn_import_batch(user.clone(), rows);
        }

        Ok(RunImportOutcome {
            discarded,
            importing,
        })
    }
}

impl<R, S, C, W: SlackWorkspaceSource, N: Send + Sync + 'static> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
{
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
            .upsert_staged(
                user,
                source,
                source.default_kind(),
                initiator,
                &foreign_id,
                &metadata,
            )
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

impl<R, S, C, W: SlackWorkspaceSource, N: Send + Sync + 'static> ImportStager
    for ImportServiceImpl<R, S, C, W, N>
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
                source.default_kind(),
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

impl<R, S, C, W: SlackWorkspaceSource, N: Send + Sync + 'static> NotionPageImporter
    for ImportServiceImpl<R, S, C, W, N>
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

        let staged = self
            .stage(
                user,
                Initiator::Chat,
                ImportSource::Notion,
                page_url_or_id,
                serde_json::json!({
                    "title": "",
                    "url": page_url_or_id,
                }),
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

        let Some(importing_row) = self
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

        let mcp_tools = match self.connector_tools(user, ImportSource::Notion).await {
            Ok(tools) => tools,
            Err(error) => {
                self.fail_unfinished(
                    user,
                    &[importing_row.id],
                    &format!("notion unavailable: {error}"),
                )
                .await;
                self.notify(user).await;
                return Err(ImportError::Other(error));
            }
        };
        let pipeline_result = self
            .process_notion_page(user, mcp_tools, &importing_row)
            .await;
        self.notify(user).await;
        if let Err(error) = &pipeline_result
            && let Some(error) = error.downcast_ref::<ai_billing::AiAdmissionError>()
        {
            return Err(ImportError::Admission(*error));
        }

        let row = self
            .repo
            .get(user, importing_row.id)
            .await?
            .ok_or_else(|| {
                ImportError::Other(anyhow::anyhow!(
                    "Notion import row {} disappeared after import",
                    importing_row.id
                ))
            })?;
        match row.status {
            ImportStatus::Imported => Ok(ImportNotionPageOutcome::Imported {
                entity: row,
                already_existed: false,
                by_teammate: false,
            }),
            ImportStatus::Discarded => Ok(ImportNotionPageOutcome::PreviouslyDiscarded(row)),
            ImportStatus::Importing => Ok(ImportNotionPageOutcome::ImportInProgress(row)),
            ImportStatus::Staged => {
                let detail = pipeline_result
                    .err()
                    .map(|error| error.to_string())
                    .or(row.last_error)
                    .unwrap_or_else(|| "the import did not create a document".to_string());
                Err(ImportError::Other(anyhow::anyhow!(
                    "Notion page import failed: {detail}"
                )))
            }
        }
    }
}

impl<R, S, C, W: SlackWorkspaceSource, N: Send + Sync + 'static> ImportFinalizer
    for ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
{
    #[tracing::instrument(skip(self, user, content_markdown), err)]
    async fn finalize_document(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        name: &str,
        content_markdown: &str,
        properties: &ImportedDocumentProperties,
    ) -> Result<ImportEntity> {
        let row = self
            .repo
            .get(user, import_id)
            .await?
            .ok_or_else(|| ImportError::Other(anyhow::anyhow!("no import row {import_id}")))?;
        if row.status != ImportStatus::Importing {
            return Err(ImportError::Other(anyhow::anyhow!(
                "import row {import_id} is {}, not importing",
                row.status.as_ref()
            )));
        }

        if row.metadata.get("plan").is_some() {
            return Err(ImportError::NotReady(
                "Reviewed workspace rows are written only by the workspace importer.",
            ));
        }
        let entity_id = match row.source {
            ImportSource::Linear => {
                // Agent-finalized Linear rows still carry staged metadata —
                // apply the same property mapping as the deterministic path.
                let properties = serde_json::from_value::<LinearIssueMeta>(row.metadata.clone())
                    .map(|meta| linear_task_properties(&meta))
                    .unwrap_or_default();
                self.creator
                    .create_task(user, name, content_markdown, &properties)
                    .await
            }
            ImportSource::Notion => {
                check_notion_markdown(content_markdown).map_err(ImportError::Other)?;
                // A single page knows nothing else of the import, so its
                // references link back to Notion.
                self.creator
                    .create_notion_document(
                        user,
                        name,
                        content_markdown,
                        &NotionLinks::default(),
                        properties,
                    )
                    .await
            }
            ImportSource::Jira => {
                return Err(ImportError::NotReady(
                    "Jira imports require an approved workspace review.",
                ));
            }
            ImportSource::Slack => {
                return Err(ImportError::Other(anyhow::anyhow!(
                    "slack channels are not finalized as documents"
                )));
            }
        }
        .map_err(ImportError::Other)?;

        let updated = self
            .repo
            .mark_imported(user, import_id, &entity_id, row.source.entity_type(), None)
            .await?
            .ok_or_else(|| {
                ImportError::Other(anyhow::anyhow!(
                    "import row {import_id} changed status mid-finalize"
                ))
            })?;
        self.notify(user).await;
        Ok(updated)
    }
}

/// The mangled name of the connector's Notion fetch tool. Notion exposes this
/// as `notion-fetch` generally and as `fetch` on OpenAI-compatible surfaces.
fn notion_fetch_tool_name(mcp_tools: &impl ToolSet<()>) -> Option<String> {
    ToolSet::<()>::request_schemas(mcp_tools)?
        .into_iter()
        .map(|schema| schema.name)
        .find(|name| is_notion_fetch_tool_name(name))
}

fn is_notion_fetch_tool_name(name: &str) -> bool {
    matches!(
        name.rsplit_once("__").map(|(_, tool)| tool),
        Some("notion-fetch" | "fetch")
    )
}

/// Split a Notion fetch result into its title, Markdown body, and properties.
/// Structured MCP output and JSON text may use either Notion's `markdown`
/// field or the generic MCP fetch `text` field.
#[derive(Debug, Default, PartialEq)]
struct ParsedNotionPage {
    title: Option<String>,
    body: String,
    properties: ImportedDocumentProperties,
    is_database: bool,
    truncated: bool,
}

fn parse_notion_fetch_result(result: serde_json::Value) -> ParsedNotionPage {
    match result {
        serde_json::Value::String(text) => {
            if let Ok(structured @ (serde_json::Value::Object(_) | serde_json::Value::Array(_))) =
                serde_json::from_str::<serde_json::Value>(&text)
            {
                return parse_notion_fetch_result(structured);
            }
            parse_notion_tool_text(&text)
        }
        serde_json::Value::Object(map) => parse_notion_fetch_object(map),
        serde_json::Value::Array(items) => {
            let mut combined = ParsedNotionPage::default();
            let mut bodies = Vec::new();
            for item in items {
                let parsed = parse_notion_fetch_result(item);
                if combined.title.is_none() {
                    combined.title = parsed.title;
                }
                if combined.properties == ImportedDocumentProperties::default()
                    && parsed.properties != ImportedDocumentProperties::default()
                {
                    combined.properties = parsed.properties;
                }
                combined.is_database |= parsed.is_database;
                combined.truncated |= parsed.truncated;
                if !parsed.body.trim().is_empty() {
                    bodies.push(parsed.body);
                }
            }
            combined.body = bodies.join("\n\n");
            combined
        }
        _ => ParsedNotionPage::default(),
    }
}

fn parse_notion_fetch_object(map: serde_json::Map<String, serde_json::Value>) -> ParsedNotionPage {
    let title = notion_title_from_map(&map).or_else(|| {
        map.get("metadata")
            .and_then(|value| value.as_object())
            .and_then(notion_title_from_map)
    });
    let properties = map
        .get("properties")
        .and_then(|value| value.as_object())
        .map(imported_notion_properties)
        .unwrap_or_default();
    let is_database = notion_object_is_database(&map);
    let truncated = map
        .get("truncated")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);

    if let Some(body) = map
        .get("markdown")
        .or_else(|| map.get("text"))
        .and_then(|value| value.as_str())
    {
        let mut parsed = parse_notion_tool_text(body);
        parsed.title = title.or(parsed.title);
        if parsed.properties == ImportedDocumentProperties::default() {
            parsed.properties = properties;
        }
        parsed.is_database |= is_database;
        parsed.truncated |= truncated;
        return parsed;
    }

    for nested_key in ["data", "result", "resource"] {
        if let Some(nested) = map.get(nested_key) {
            let mut parsed = parse_notion_fetch_result(nested.clone());
            if parsed.title.is_none() {
                parsed.title = title.clone();
            }
            if parsed.properties == ImportedDocumentProperties::default() {
                parsed.properties = properties.clone();
            }
            parsed.is_database |= is_database;
            parsed.truncated |= truncated;
            if !parsed.body.trim().is_empty() {
                return parsed;
            }
        }
    }

    ParsedNotionPage {
        title,
        properties,
        is_database,
        truncated,
        ..Default::default()
    }
}

/// The hosted Notion MCP wraps fetched pages in narration plus
/// `<page><properties>…</properties><content>…</content></page>`. Isolate the
/// two source-backed sections here so neither the narration nor the metadata
/// can ever reach the document body.
fn parse_notion_tool_text(text: &str) -> ParsedNotionPage {
    if !NOTION_TOOL_RESULT_PREAMBLE.is_match(text) || !text.contains("<page") {
        return ParsedNotionPage {
            body: text.to_string(),
            ..Default::default()
        };
    }
    let Some(content) = notion_xml_section(text, "content") else {
        return ParsedNotionPage {
            body: text.to_string(),
            ..Default::default()
        };
    };

    let mut parsed = ParsedNotionPage {
        body: content.trim_matches('\n').to_string(),
        ..Default::default()
    };
    if let Some(raw_properties) = notion_xml_section(text, "properties")
        && let Some(map) = parse_notion_property_map(raw_properties.trim())
    {
        parsed.title = notion_title_from_map(&map);
        parsed.properties = imported_notion_properties(&map);
    }
    parsed
}

fn notion_xml_section<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
    let opening = format!("<{tag}>");
    let closing = format!("</{tag}>");
    let start = text.find(&opening)? + opening.len();
    let end = text[start..].find(&closing)? + start;
    Some(&text[start..end])
}

fn parse_notion_property_map(text: &str) -> Option<serde_json::Map<String, serde_json::Value>> {
    match serde_json::from_str::<serde_json::Value>(text).ok()? {
        serde_json::Value::Object(map) => Some(map),
        serde_json::Value::Array(values) => values
            .into_iter()
            .find_map(|value| value.as_object().cloned()),
        _ => None,
    }
}

fn notion_title_from_map(map: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    ["title", "Name", "name"].into_iter().find_map(|key| {
        map.get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .map(str::to_string)
    })
}

fn notion_object_is_database(map: &serde_json::Map<String, serde_json::Value>) -> bool {
    let object_type = map
        .get("object")
        .and_then(serde_json::Value::as_str)
        .or_else(|| {
            map.get("metadata")
                .and_then(serde_json::Value::as_object)
                .and_then(|metadata| metadata.get("type"))
                .and_then(serde_json::Value::as_str)
        });
    matches!(object_type, Some("database" | "data_source"))
}

fn imported_notion_properties(
    raw: &serde_json::Map<String, serde_json::Value>,
) -> ImportedDocumentProperties {
    let mut imported = ImportedDocumentProperties::default();

    for (raw_name, value) in raw {
        let name = raw_name
            .strip_prefix("userDefined:")
            .unwrap_or(raw_name)
            .trim();
        if name.is_empty()
            || name.len() > 100
            || name.eq_ignore_ascii_case("title")
            || name.eq_ignore_ascii_case("name")
        {
            continue;
        }

        if let Some(date_name) = name
            .strip_prefix("date:")
            .and_then(|rest| rest.strip_suffix(":start"))
        {
            if let Some(value) = value.as_str().filter(|value| !value.trim().is_empty()) {
                imported.values.push(ImportedDocumentProperty {
                    name: date_name.to_string(),
                    value: ImportedDocumentPropertyValue::Date {
                        value: value.to_string(),
                    },
                });
            }
            continue;
        }
        if name.starts_with("date:") {
            continue;
        }

        if is_tag_property_name(name) {
            append_string_values(value, &mut imported.tags);
            continue;
        }

        let value = match value {
            serde_json::Value::Bool(value) => {
                Some(ImportedDocumentPropertyValue::Boolean { value: *value })
            }
            serde_json::Value::Number(value) => value
                .as_f64()
                .map(|value| ImportedDocumentPropertyValue::Number { value }),
            serde_json::Value::String(value) => {
                let value = value.trim();
                match value {
                    "" => None,
                    "__YES__" => Some(ImportedDocumentPropertyValue::Boolean { value: true }),
                    "__NO__" => Some(ImportedDocumentPropertyValue::Boolean { value: false }),
                    _ if is_web_url(value) => Some(ImportedDocumentPropertyValue::Link {
                        urls: vec![value.to_string()],
                        multi: false,
                    }),
                    _ => Some(ImportedDocumentPropertyValue::String {
                        value: value.to_string(),
                    }),
                }
            }
            serde_json::Value::Array(values) => {
                let strings: Vec<String> = values
                    .iter()
                    .filter_map(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .collect();
                if strings.is_empty() {
                    None
                } else if strings.iter().all(|value| is_web_url(value)) {
                    Some(ImportedDocumentPropertyValue::Link {
                        urls: strings,
                        multi: true,
                    })
                } else {
                    Some(ImportedDocumentPropertyValue::Select {
                        values: strings,
                        multi: true,
                    })
                }
            }
            serde_json::Value::Null | serde_json::Value::Object(_) => None,
        };
        if let Some(value) = value {
            imported.values.push(ImportedDocumentProperty {
                name: name.to_string(),
                value,
            });
        }
    }

    dedupe_strings(&mut imported.tags);
    // `raw` iterates in whatever order `serde_json::Map` happens to use, which
    // depends on the ambient `preserve_order` Cargo feature and can differ
    // between build invocations. Sort explicitly so property order is
    // deterministic regardless of that feature.
    imported.values.sort_by(|a, b| a.name.cmp(&b.name));
    imported
}

fn is_tag_property_name(name: &str) -> bool {
    matches!(
        name.trim().to_ascii_lowercase().as_str(),
        "tag" | "tags" | "label" | "labels"
    )
}

fn is_web_url(value: &str) -> bool {
    value.starts_with("https://") || value.starts_with("http://")
}

fn append_string_values(value: &serde_json::Value, output: &mut Vec<String>) {
    match value {
        serde_json::Value::String(value) => {
            let value = value.trim();
            if !value.is_empty() {
                output.push(value.to_string());
            }
        }
        serde_json::Value::Array(values) => {
            output.extend(
                values
                    .iter()
                    .filter_map(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
            );
        }
        _ => {}
    }
}

fn dedupe_strings(values: &mut Vec<String>) {
    let mut seen = HashSet::new();
    values.retain(|value| seen.insert(value.to_ascii_lowercase()));
}

static PAIRED_NOTION_DATABASES: LazyLock<Vec<regex::Regex>> = LazyLock::new(|| {
    ["database", "mention-database", "mention-data-source"]
        .into_iter()
        .map(|tag| {
            regex::Regex::new(&format!(r#"(?s)<{tag}\b[^>]*>.*?</{tag}>"#))
                .expect("valid notion database regex")
        })
        .collect()
});
static SELF_CLOSING_NOTION_DATABASE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"(?s)<(?:database|mention-database|mention-data-source)\b[^>]*/?>"#)
        .expect("valid self-closing notion database regex")
});
static NOTION_TOOL_RESULT_PREAMBLE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"(?im)^\s*Here is the result of "(?:view|fetch)"(?:\s|:)"#)
        .expect("valid notion tool-result preamble regex")
});
static NOTION_SERIALIZED_TITLE_WRAPPER: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"(?m)^\s*(?:\[\s*)?\{\s*"[^"]+"\s*:"#)
        .expect("valid notion serialized title wrapper regex")
});
static INLINE_TAG_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"(?s)<[^>]+>").expect("valid inline tag regex"));

/// Whether a fetched Notion page is worth importing as a document: real body
/// content, not a connector's tool-result wrapper or a page that is mostly a
/// database. Converting it is lexical-service's job.
fn check_notion_markdown(input: &str) -> anyhow::Result<()> {
    anyhow::ensure!(!input.trim().is_empty(), "fetched page has no content");
    anyhow::ensure!(
        !NOTION_TOOL_RESULT_PREAMBLE.is_match(input)
            && !NOTION_SERIALIZED_TITLE_WRAPPER.is_match(input),
        "fetched page contained tool-result metadata instead of body content"
    );
    anyhow::ensure!(
        !notion_page_is_mostly_database(input),
        "fetched page is primarily a Notion database"
    );
    Ok(())
}

fn remove_notion_databases(input: &str) -> String {
    transform_outside_fenced_code(input, remove_notion_databases_fragment)
}

fn remove_notion_databases_fragment(input: &str) -> String {
    let mut markdown = input.to_string();
    for regex in PAIRED_NOTION_DATABASES.iter() {
        markdown = regex.replace_all(&markdown, "").into_owned();
    }
    SELF_CLOSING_NOTION_DATABASE
        .replace_all(&markdown, "")
        .into_owned()
}

fn notion_page_is_mostly_database(input: &str) -> bool {
    let without_databases = remove_notion_databases(input);
    if without_databases == input {
        return false;
    }

    // Database blocks often contain only a title/reference rather than their
    // full row data. A page with fewer than roughly two paragraphs of
    // non-database text is therefore treated as database-first and left out.
    let remaining_text = INLINE_TAG_RE.replace_all(&without_databases, "");
    let substantive_chars = remaining_text
        .chars()
        .filter(|character| character.is_alphanumeric())
        .count();
    substantive_chars < 200
}

fn transform_outside_fenced_code(input: &str, mut transform: impl FnMut(&str) -> String) -> String {
    let mut output = String::with_capacity(input.len());
    let mut fragment = String::new();
    let mut fence: Option<char> = None;

    for line in input.split_inclusive('\n') {
        let trimmed = line.trim_start();
        let marker = trimmed
            .chars()
            .next()
            .filter(|marker| matches!(marker, '`' | '~'))
            .filter(|marker| trimmed.chars().take_while(|value| value == marker).count() >= 3);

        match (fence, marker) {
            (None, Some(marker)) => {
                output.push_str(&transform(&fragment));
                fragment.clear();
                output.push_str(line);
                fence = Some(marker);
            }
            (Some(open), Some(close)) if open == close => {
                output.push_str(line);
                fence = None;
            }
            (Some(_), _) => output.push_str(line),
            (None, None) => fragment.push_str(line),
        }
    }
    output.push_str(&transform(&fragment));
    output
}

/// Map a Linear workflow status name onto Macro's task status label.
/// Returns `None` for anything unrecognized (the raw label then stays in
/// the task body's footer instead).
pub fn map_linear_status(status: &str) -> Option<&'static str> {
    match status.trim().to_ascii_lowercase().as_str() {
        "backlog" | "todo" | "to do" | "triage" | "unstarted" | "not started" | "planned" => {
            Some("Not Started")
        }
        "in progress" | "started" | "doing" => Some("In Progress"),
        "in review" | "review" | "code review" => Some("In Review"),
        "done" | "completed" | "closed" | "merged" => Some("Completed"),
        "canceled" | "cancelled" | "duplicate" | "won't do" | "wont do" => Some("Canceled"),
        _ => None,
    }
}

/// Map a Linear priority label onto Macro's task priority label. `None` for
/// unrecognized labels and for Linear's explicit "No priority".
pub fn map_linear_priority(priority: &str) -> Option<&'static str> {
    match priority.trim().to_ascii_lowercase().as_str() {
        "urgent" => Some("Urgent"),
        "high" => Some("High"),
        "medium" | "normal" => Some("Medium"),
        "low" => Some("Low"),
        _ => None,
    }
}

/// The system properties an imported Linear issue should carry, normalized
/// to Macro's vocabulary. Unmappable status/priority labels are dropped
/// here and surface in the body footer instead.
pub fn linear_task_properties(meta: &LinearIssueMeta) -> ImportedTaskProperties {
    ImportedTaskProperties {
        status: meta
            .status
            .as_deref()
            .and_then(map_linear_status)
            .map(String::from),
        priority: meta
            .priority
            .as_deref()
            .and_then(map_linear_priority)
            .map(String::from),
        due_date: meta.due_date.clone(),
        assignee_email: meta.assignee_email.clone(),
    }
}

/// Compose the task-document name and body for one Linear issue, from its
/// staged metadata alone. Status/priority appear in the footer only when
/// they could NOT be mapped onto real task properties — mapped values live
/// on the task itself and would be noise here.
pub fn linear_task_content(meta: &LinearIssueMeta) -> (String, String) {
    let name = match meta.identifier.as_deref() {
        Some(identifier) => format!("{identifier} {}", meta.title),
        None => meta.title.clone(),
    };
    let unmapped_status = meta
        .status
        .as_deref()
        .filter(|s| map_linear_status(s).is_none());
    let unmapped_priority = meta
        .priority
        .as_deref()
        .filter(|p| map_linear_priority(p).is_none());
    let footer = [
        unmapped_status.map(|s| format!("Status: {s}")),
        unmapped_priority.map(|p| format!("Priority: {p}")),
        Some(match meta.url.as_deref() {
            Some(url) => format!("Imported from [Linear]({url})"),
            None => "Imported from Linear".to_string(),
        }),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" · ");
    let markdown = [
        meta.description
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
        Some(&*format!("---\n{footer}")),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join("\n\n");
    (name, markdown)
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
