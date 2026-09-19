//! The import orchestrator: staging (with team-wide dedup), gather jobs,
//! and import jobs.
//!
//! Gather jobs are short agent sessions over the user's connector MCP server
//! whose toolset includes an in-process `CreateImportEntity` locked to
//! `(user, source, initiator)` — the model stages candidates by calling the
//! tool, so there is no structured output to parse. Import jobs copy
//! accepted rows in: Linear tasks and Slack channels are composed
//! deterministically from staged metadata; Notion pages are fetched
//! directly through the connector's fetch tool (no model in the content
//! path), falling back to a bounded single-page Haiku session that lands
//! content through `FinalizeImport` when the direct path can't cope.

use super::models::*;
use super::ports::{
    EntityCreator, ImportError, ImportRepo, ImportedDocumentProperties, ImportedDocumentProperty,
    ImportedDocumentPropertyValue, ImportedTaskProperties, Result,
};
use crate::inbound::toolset::{
    ImportToolContext, ToolPolicy, gather_toolset, notion_import_toolset,
};
use agent::types::{ChatMessage, ChatMessageContent, Role};
use agent::{AgentLoop, PredefinedModel};
use ai_toolset::{RequestContext, ToolResult, ToolSet, ToolSetError};
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_select::{ConnectorSelect, UserMcpTools};
use std::collections::HashSet;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::LazyLock;
use std::time::Duration;
use uuid::Uuid;

mod prompts;

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

/// Model for Notion import sessions (normal ai_usage attribution).
const NOTION_IMPORT_MODEL: PredefinedModel = PredefinedModel::Fast;
/// Hard cap on importing ONE Notion page (fetch + convert + finalize).
/// Pages run as independent single-page sessions.
const NOTION_PAGE_IMPORT_TIMEOUT: Duration = Duration::from_secs(120);

/// How many Notion page sessions run at once for one accepted batch —
/// enough to collapse the batch latency toward the slowest page, low
/// enough to stay polite to Notion's MCP.
const NOTION_IMPORT_CONCURRENCY: usize = 4;

/// How many channels the deterministic Slack gather stages, mirroring the
/// "8-15 strong candidates" the agent prompt asks for.
const SLACK_GATHER_MAX_CHANNELS: usize = 15;
/// How many channel-search pages the deterministic Slack gather follows
/// before staging what it has.
const SLACK_GATHER_MAX_PAGES: usize = 5;

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
        .map(ToString::to_string)
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
/// ledger transitions, connector fetch, content normalization, document
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
pub struct ImportServiceImpl<R, S, C> {
    repo: R,
    mcp_tools: Arc<S>,
    creator: Arc<C>,
    recorder: Arc<dyn ai_usage::UsageRecorder>,
    notifier: Option<ImportNotify>,
}

impl<R: Clone, S, C> Clone for ImportServiceImpl<R, S, C> {
    fn clone(&self) -> Self {
        Self {
            repo: self.repo.clone(),
            mcp_tools: self.mcp_tools.clone(),
            creator: self.creator.clone(),
            recorder: self.recorder.clone(),
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
            mcp_tools,
            creator,
            recorder,
            notifier: None,
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

impl<R, S, C> ImportServiceImpl<R, S, C>
where
    R: ImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
{
    /// Spawn the gather session for one source; finishes the run row either
    /// way and nudges the client.
    fn spawn_gather(&self, user: MacroUserIdStr<'static>, source: ImportSource) {
        let service = self.clone();
        tokio::spawn(async move {
            let outcome =
                tokio::time::timeout(GATHER_TIMEOUT, service.run_gather_session(&user, source))
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
                        .finish_run(&user, source, RunStatus::Failed, Some(&e.to_string()))
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

    /// Run one gather session: connector MCP tools plus the locked
    /// `CreateImportEntity`. Staged rows land as the session runs; the final
    /// text is ignored.
    #[tracing::instrument(skip(self, user), err)]
    async fn run_gather_session(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> anyhow::Result<()> {
        let mcp_tools = self.connector_tools(user, source).await?;

        // Slack discovery is a listing problem, not a language problem:
        // enumerate channels through the connector directly and stage the
        // strongest. The agent session only runs as a fallback, when the
        // connector's tool surface changed under us.
        if source == ImportSource::Slack {
            match self.gather_slack_direct(user, &mcp_tools).await {
                Ok(_) => return Ok(()),
                Err(e) => {
                    tracing::warn!(error = ?e, "direct slack gather failed; trying the agent");
                }
            }
        }

        // Staging is idempotent (the ledger dedups already-staged rows), so
        // rerunning the whole session on the fallback model is safe even
        // when the primary died mid-way through staging.
        match self
            .gather_agent_session(user, source, GATHER_MODEL, mcp_tools.clone())
            .await
        {
            Ok(()) => Ok(()),
            Err(e) => {
                tracing::warn!(model = GATHER_MODEL, error = ?e, "gather session failed; retrying on the fallback model");
                self.gather_agent_session(user, source, GATHER_FALLBACK_MODEL, mcp_tools)
                    .await
            }
        }
    }

    /// One agent gather session on a specific model.
    #[tracing::instrument(skip(self, user, mcp_tools), err)]
    async fn gather_agent_session(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        model: &str,
        mcp_tools: Arc<UserMcpTools>,
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
            &prompts::gather_system(source),
            prompts::gather_prompt(source),
        )
        .await
    }

    /// Copy one accepted Notion page in WITHOUT a model: call the
    /// connector's fetch tool directly, take the markdown it returns, and
    /// finalize. The fallback Haiku session exists for pages this can't
    /// handle — routing page content through a model means re-emitting the
    /// whole page as output tokens, which is an order of magnitude slower.
    #[tracing::instrument(skip(self, user, mcp_tools, row), fields(id = %row.id), err)]
    async fn import_notion_page_direct(
        &self,
        user: &MacroUserIdStr<'static>,
        mcp_tools: &UserMcpTools,
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
        let markdown = prepare_notion_markdown(&fetched.body)?;

        self.finalize_document(user, row.id, &name, &markdown, &fetched.properties)
            .await
            .map_err(|e| anyhow::anyhow!("finalize failed: {e}"))?;
        Ok(())
    }

    /// Call one connector tool and surface both dispatch and tool errors as
    /// plain errors.
    async fn connector_tool_call(
        &self,
        user: &MacroUserIdStr<'static>,
        mcp_tools: &UserMcpTools,
        tool_name: &str,
        arguments: &serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        ToolSet::<()>::try_tool_call(
            mcp_tools,
            (),
            RequestContext::new(user.clone()),
            tool_name,
            arguments,
        )
        .await
        .map_err(|e| anyhow::anyhow!("{tool_name} dispatch failed: {e}"))?
        .map_err(|e| anyhow::anyhow!("{tool_name} failed: {}", e.description))
    }

    /// Stage the user's Slack channels WITHOUT a model: call the connector's
    /// channel-search tool directly (an empty query lists every channel the
    /// connected user can see), follow pagination, and stage the strongest
    /// candidates. The agent-driven gather routinely finished "successfully"
    /// having staged nothing; a direct call either produces channels or a
    /// real error. Staged rows carry no participants — inviting teammates
    /// stays best-effort and must never block discovery.
    #[tracing::instrument(skip(self, user, mcp_tools), err)]
    async fn gather_slack_direct(
        &self,
        user: &MacroUserIdStr<'static>,
        mcp_tools: &UserMcpTools,
    ) -> anyhow::Result<usize> {
        let search_tool = slack_channel_search_tool_name(mcp_tools)
            .ok_or_else(|| anyhow::anyhow!("connector exposes no channel-search tool"))?;

        let mut channels: Vec<SlackChannelCandidate> = Vec::new();
        let mut cursor: Option<String> = None;
        for page in 0..SLACK_GATHER_MAX_PAGES {
            let mut arguments = serde_json::json!({ "query": "" });
            if let Some(cursor) = &cursor {
                arguments["cursor"] = serde_json::Value::String(cursor.clone());
            }
            let result = match self
                .connector_tool_call(user, mcp_tools, &search_tool, &arguments)
                .await
            {
                Ok(result) => Ok(result),
                // Some servers reject an explicit empty query; try the first
                // page again without one before giving up on the direct path.
                Err(empty_query_error) if page == 0 => self
                    .connector_tool_call(user, mcp_tools, &search_tool, &serde_json::json!({}))
                    .await
                    .map_err(|no_query_error| {
                        anyhow::anyhow!(
                            "channel search failed with an empty query ({empty_query_error}) \
                             and without one ({no_query_error})"
                        )
                    }),
                Err(e) => {
                    // Later pages are best-effort: keep what earlier pages
                    // already produced.
                    tracing::warn!(page, error = ?e, "channel search page failed");
                    break;
                }
            }?;

            let parsed = parse_slack_channel_page(result);
            channels.extend(parsed.channels);
            cursor = parsed.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        anyhow::ensure!(!channels.is_empty(), "channel search returned no channels");

        let enumerated = channels.len();
        let mut staged = 0usize;
        for channel in select_slack_candidates(channels, SLACK_GATHER_MAX_CHANNELS) {
            let foreign_id = channel.id.clone().unwrap_or_else(|| channel.name.clone());
            let metadata = serde_json::json!({
                "name": channel.name,
                "channel_id": channel.id,
                "purpose": channel.purpose,
                "participants": [],
            });
            match self
                .stage(
                    user,
                    Initiator::Onboarding,
                    ImportSource::Slack,
                    &foreign_id,
                    metadata,
                )
                .await
            {
                Ok(StageOutcome::Staged(_)) => staged += 1,
                // Already imported (by the user or a teammate), declined, or
                // mid-import — the ledger already covers it.
                Ok(_) => {}
                Err(e) => {
                    tracing::warn!(channel = %channel.name, error = ?e, "failed to stage slack channel");
                }
            }
        }
        tracing::info!(enumerated, staged, "direct slack gather finished");
        Ok(staged)
    }

    /// Fallback: run a single-page Haiku session over the shared connector
    /// tools. Rows the agent fails to finalize are handled by the caller.
    #[tracing::instrument(skip(self, user, mcp_tools, rows), fields(pages = rows.len()), err)]
    async fn run_notion_import_session(
        &self,
        user: &MacroUserIdStr<'static>,
        rows: &[ImportEntity],
        mcp_tools: Arc<UserMcpTools>,
    ) -> anyhow::Result<()> {
        let native = notion_import_toolset::<Self>();
        let toolset = NativePlusMcp::new(native, mcp_tools);
        let context = ImportToolContext {
            service: Some(Arc::new(self.clone())),
            policy: ToolPolicy::import_job(),
        };

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
    #[allow(clippy::too_many_arguments)]
    async fn drive_session(
        &self,
        user: &MacroUserIdStr<'static>,
        model: impl ToString,
        max_turns: usize,
        toolset: NativePlusMcp<ImportToolContext<Self>>,
        context: ImportToolContext<Self>,
        system_prompt: &str,
        user_prompt: &str,
    ) -> anyhow::Result<()> {
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

    /// Copy one accepted Linear/Slack row in, deterministically from its
    /// staged metadata.
    async fn import_deterministic(&self, user: &MacroUserIdStr<'static>, row: &ImportEntity) {
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
                match serde_json::from_value::<SlackChannelMeta>(row.metadata.clone()) {
                    Ok(meta) => {
                        // Channels always associate with the user's team when
                        // they have one — that is what makes team dedup work.
                        match self.repo.user_team_id(user).await {
                            Ok(team_id) => {
                                // Teammates who were in the Slack channel join
                                // the Macro one (matched by email downstream).
                                let emails: Vec<String> = meta
                                    .participants
                                    .iter()
                                    .filter_map(|p| p.email.clone())
                                    .collect();
                                self.creator
                                    .create_channel(user, &meta.name, team_id, &emails)
                                    .await
                                    .map(|id| (id, team_id))
                            }
                            Err(e) => Err(anyhow::anyhow!("team lookup failed: {e}")),
                        }
                    }
                    Err(e) => Err(anyhow::anyhow!("invalid slack metadata: {e}")),
                }
            }
            // Notion rows go through the agent session, never here.
            ImportSource::Notion => return,
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
    async fn process_notion_page(
        &self,
        user: &MacroUserIdStr<'static>,
        mcp_tools: Arc<UserMcpTools>,
        row: &ImportEntity,
    ) -> anyhow::Result<()> {
        let outcome = tokio::time::timeout(NOTION_PAGE_IMPORT_TIMEOUT, async {
            match self
                .import_notion_page_direct(user, &mcp_tools, row)
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

    /// Run a claimed import batch in the background. Manual batches only
    /// update their entity rows; automatic batches also settle their owning
    /// run after every row reaches a terminal state.
    fn spawn_import_batch(
        &self,
        user: MacroUserIdStr<'static>,
        rows: Vec<ImportEntity>,
        auto_run: Option<ImportSource>,
    ) {
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

            for row in &direct_rows {
                service.import_deterministic(&user, row).await;
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
                        if let Some(source) = auto_run {
                            service
                                .finish_auto_import_batch(&user, source, &batch_ids)
                                .await;
                        }
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

            if let Some(source) = auto_run {
                service
                    .finish_auto_import_batch(&user, source, &batch_ids)
                    .await;
            }
        });
    }
}

impl<R, S, C> ImportService for ImportServiceImpl<R, S, C>
where
    R: ImportRepo + Clone,
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
        // Wins only when no run row exists — gathers run once per
        // connection; explicit retry is the only re-entry.
        let won = self.repo.start_run(&user, source, &[], auto_import).await?;
        if won {
            self.spawn_gather(user.clone(), source);
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
            self.spawn_gather(user.clone(), source);
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

impl<R, S, C> ImportStager for ImportServiceImpl<R, S, C>
where
    R: ImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
{
    #[tracing::instrument(skip(self, user, metadata), err)]
    async fn stage(
        &self,
        user: &MacroUserIdStr<'static>,
        initiator: Initiator,
        source: ImportSource,
        foreign_id: &str,
        metadata: serde_json::Value,
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
                self.notify(user).await;
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

impl<R, S, C> NotionPageImporter for ImportServiceImpl<R, S, C>
where
    R: ImportRepo + Clone,
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

impl<R, S, C> ImportFinalizer for ImportServiceImpl<R, S, C>
where
    R: ImportRepo + Clone,
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
                let content_markdown =
                    prepare_notion_markdown(content_markdown).map_err(ImportError::Other)?;
                self.creator
                    .create_markdown_doc(user, name, &content_markdown, properties)
                    .await
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
fn notion_fetch_tool_name(mcp_tools: &UserMcpTools) -> Option<String> {
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

/// The mangled name of the connector's channel-search tool. Slack's hosted
/// MCP has shipped several tool-name spellings, so this matches the shape —
/// a search/list over channels — rather than one literal name.
fn slack_channel_search_tool_name(mcp_tools: &UserMcpTools) -> Option<String> {
    ToolSet::<()>::request_schemas(mcp_tools)?
        .into_iter()
        .map(|schema| schema.name)
        .find(|name| is_slack_channel_search_tool_name(name))
}

fn is_slack_channel_search_tool_name(name: &str) -> bool {
    let Some((_, tool)) = name.rsplit_once("__") else {
        return false;
    };
    let tool = tool.to_ascii_lowercase().replace('-', "_");
    let channel_noun = tool.contains("channel") || tool.contains("conversation");
    let listing_verb = tool.contains("search") || tool.contains("list");
    let other_surface = [
        "member", "history", "message", "canvas", "create", "user", "emoji", "file",
    ]
    .iter()
    .any(|word| tool.contains(word));
    channel_noun && listing_verb && !other_surface
}

/// One channel parsed out of a Slack channel-search result.
#[derive(Debug, Clone, PartialEq)]
struct SlackChannelCandidate {
    id: Option<String>,
    name: String,
    purpose: Option<String>,
    member_count: Option<u64>,
    archived: bool,
}

/// One page of channel-search results.
#[derive(Debug, Default, PartialEq)]
struct SlackChannelPage {
    channels: Vec<SlackChannelCandidate>,
    next_cursor: Option<String>,
}

/// Split a channel-search result into channels plus a pagination cursor.
/// Handles structured MCP output, JSON re-encoded as text, a bare array of
/// channels, and the channel list hiding under common wrapper keys.
fn parse_slack_channel_page(result: serde_json::Value) -> SlackChannelPage {
    match result {
        serde_json::Value::String(text) => match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(structured @ (serde_json::Value::Object(_) | serde_json::Value::Array(_))) => {
                parse_slack_channel_page(structured)
            }
            _ => SlackChannelPage::default(),
        },
        serde_json::Value::Array(items) => SlackChannelPage {
            channels: items.iter().filter_map(parse_slack_channel).collect(),
            next_cursor: None,
        },
        serde_json::Value::Object(map) => {
            let next_cursor = slack_next_cursor(&map);
            for key in ["channels", "results", "items", "matches", "data"] {
                if let Some(value) = map.get(key) {
                    let inner = parse_slack_channel_page(value.clone());
                    if !inner.channels.is_empty() {
                        return SlackChannelPage {
                            channels: inner.channels,
                            next_cursor: inner.next_cursor.or(next_cursor),
                        };
                    }
                }
            }
            // A single channel object at the top level.
            let channels = parse_slack_channel(&serde_json::Value::Object(map))
                .into_iter()
                .collect();
            SlackChannelPage {
                channels,
                next_cursor,
            }
        }
        _ => SlackChannelPage::default(),
    }
}

fn slack_next_cursor(map: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    map.get("next_cursor")
        .or_else(|| map.get("nextCursor"))
        .or_else(|| map.get("cursor"))
        .or_else(|| {
            map.get("response_metadata")
                .and_then(|value| value.as_object())
                .and_then(|metadata| metadata.get("next_cursor"))
        })
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|cursor| !cursor.is_empty())
        .map(str::to_string)
}

fn parse_slack_channel(value: &serde_json::Value) -> Option<SlackChannelCandidate> {
    let map = value.as_object()?;
    // DMs and group DMs are not importable channels.
    if ["is_im", "is_mpim"]
        .iter()
        .any(|key| map.get(*key).and_then(serde_json::Value::as_bool) == Some(true))
    {
        return None;
    }
    let name = map
        .get("name")
        .or_else(|| map.get("channel_name"))
        .and_then(|value| value.as_str())
        .map(|name| name.trim().trim_start_matches('#'))
        .filter(|name| !name.is_empty())?
        .to_string();
    let id = map
        .get("id")
        .or_else(|| map.get("channel_id"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string);
    let purpose = slack_channel_text(map, "purpose")
        .or_else(|| slack_channel_text(map, "topic"))
        .or_else(|| slack_channel_text(map, "description"));
    let member_count = map
        .get("member_count")
        .or_else(|| map.get("num_members"))
        .and_then(serde_json::Value::as_u64);
    let archived = map.get("is_archived").and_then(serde_json::Value::as_bool) == Some(true);
    Some(SlackChannelCandidate {
        id,
        name,
        purpose,
        member_count,
        archived,
    })
}

/// Slack renders purpose/topic either as a plain string or as the classic
/// API's `{ "value": "…" }` wrapper.
fn slack_channel_text(
    map: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<String> {
    let value = map.get(key)?;
    value
        .as_str()
        .or_else(|| value.get("value").and_then(|nested| nested.as_str()))
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// Rank enumerated channels and keep the strongest `cap`: drop archived
/// channels, dedupe by id (falling back to the name), prefer larger channels
/// (member count is the best activity proxy a listing offers), and keep the
/// listing order among ties.
fn select_slack_candidates(
    channels: Vec<SlackChannelCandidate>,
    cap: usize,
) -> Vec<SlackChannelCandidate> {
    let mut seen = HashSet::new();
    let mut candidates: Vec<SlackChannelCandidate> = channels
        .into_iter()
        .filter(|channel| !channel.archived)
        .filter(|channel| {
            seen.insert(
                channel
                    .id
                    .clone()
                    .unwrap_or_else(|| format!("#{}", channel.name.to_ascii_lowercase())),
            )
        })
        .collect();
    candidates.sort_by_key(|channel| std::cmp::Reverse(channel.member_count.unwrap_or(0)));
    candidates.truncate(cap);
    candidates
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

static PAIRED_NOTION_PAGE_REFS: LazyLock<Vec<regex::Regex>> = LazyLock::new(|| {
    ["page", "mention-page"]
        .into_iter()
        .map(|tag| {
            regex::Regex::new(&format!(
                r#"(?s)<{tag}\b(?P<attrs>[^>]*)>(?P<label>.*?)</{tag}>"#
            ))
            .expect("valid notion page reference regex")
        })
        .collect()
});
static SELF_CLOSING_NOTION_PAGE_REF: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"<(?:ancestor-\d+-)?page\b(?P<attrs>[^>]*)/?>"#)
        .expect("valid self-closing notion page reference regex")
});
static PAIRED_NOTION_TEXT_MENTIONS: LazyLock<Vec<regex::Regex>> = LazyLock::new(|| {
    ["mention-user", "mention-agent"]
        .into_iter()
        .map(|tag| {
            regex::Regex::new(&format!(r#"(?s)<{tag}\b[^>]*>(?P<label>.*?)</{tag}>"#))
                .expect("valid notion text mention regex")
        })
        .collect()
});
static NOTION_DATE_MENTION: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"<mention-date\b(?P<attrs>[^>]*)/?>"#)
        .expect("valid notion date mention regex")
});
static PAIRED_NOTION_MEDIA: LazyLock<Vec<regex::Regex>> = LazyLock::new(|| {
    ["audio", "video", "file", "pdf"]
        .into_iter()
        .map(|tag| {
            regex::Regex::new(&format!(
                r#"(?s)<{tag}\b(?P<attrs>[^>]*)>(?P<label>.*?)</{tag}>"#
            ))
            .expect("valid notion media regex")
        })
        .collect()
});
static NOTION_UNKNOWN_BLOCK: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"<unknown\b(?P<attrs>[^>]*)/?>"#).expect("valid notion unknown-block regex")
});
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
static NOTION_TOGGLE_MARKER: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"[ \t]*\{toggle\s*=\s*"true"\}"#).expect("valid notion toggle marker regex")
});
static NOTION_BLOCK_ATTRIBUTES: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"[ \t]*\{(?:(?:toggle|color)\s*=\s*"[^"]*"[ \t]*)+\}[ \t]*$"#)
        .expect("valid notion block-attribute regex")
});
static PAIRED_NOTION_SPAN: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"(?s)<span\b[^>]*>(?P<label>.*?)</span>"#).expect("valid notion span regex")
});
static NOTION_SUMMARY: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"(?s)<summary>(?P<label>.*?)</summary>"#)
        .expect("valid notion summary regex")
});
static NOTION_EMPTY_BLOCK: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"(?m)^[\t ]*<(?:empty-block|table_of_contents)\b[^>]*/?>[\t ]*$"#)
        .expect("valid empty Notion block regex")
});
static ESCAPED_NOTION_TODO: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"^(?P<indent>[\t ]*)(?:-\s+)?\\\[(?P<state>[ xX])\\\](?P<rest>.*)$"#)
        .expect("valid escaped Notion todo regex")
});
static NOTION_TOOL_RESULT_PREAMBLE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"(?im)^\s*Here is the result of "(?:view|fetch)"(?:\s|:)"#)
        .expect("valid notion tool-result preamble regex")
});
static NOTION_SERIALIZED_TITLE_WRAPPER: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"(?m)^\s*(?:\[\s*)?\{\s*"[^"]+"\s*:"#)
        .expect("valid notion serialized title wrapper regex")
});
static UNHANDLED_NOTION_MARKUP: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(
        r#"(?i)</?(?:page|database|mention-[\w-]+|ancestor-\d+-page|details|summary|callout|columns?|synced_block(?:_reference)?|table|tr|td|th|colgroup|col|properties|content)\b"#,
    )
    .expect("valid unsupported Notion markup regex")
});
static NOTION_ATTR_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"(?P<name>[\w-]+)="(?P<value>[^"]*)""#)
        .expect("valid notion attribute regex")
});
static INLINE_TAG_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"(?s)<[^>]+>").expect("valid inline tag regex"));
static BREAK_TAG_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"(?i)<br\s*/?>").expect("valid HTML break regex"));
static TABLE_ROW_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"(?s)<tr\b[^>]*>(?P<body>.*?)</tr>").expect("valid notion table row regex")
});
static TABLE_CELL_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"(?s)<t[dh]\b[^>]*>(?P<body>.*?)</t[dh]>")
        .expect("valid notion table cell regex")
});

/// Convert Notion's enhanced-markdown extensions into the markdown dialect
/// consumed by Macro's Lexical service. In particular, pipe tables become
/// native Lexical tables and Notion page references remain clickable external
/// links even when the referenced page was not part of the import.
fn normalize_notion_markdown(input: &str) -> String {
    transform_outside_fenced_code(input, normalize_notion_markdown_fragment)
}

fn normalize_notion_markdown_fragment(input: &str) -> String {
    let mut markdown = remove_notion_databases_fragment(input);
    for regex in PAIRED_NOTION_PAGE_REFS.iter() {
        markdown = regex
            .replace_all(&markdown, |captures: &regex::Captures<'_>| {
                notion_page_link(
                    &captures["attrs"],
                    Some(INLINE_TAG_RE.replace_all(&captures["label"], "")),
                )
            })
            .into_owned();
    }
    markdown = SELF_CLOSING_NOTION_PAGE_REF
        .replace_all(&markdown, |captures: &regex::Captures<'_>| {
            notion_page_link(&captures["attrs"], None)
        })
        .into_owned();
    for regex in PAIRED_NOTION_TEXT_MENTIONS.iter() {
        markdown = regex
            .replace_all(&markdown, |captures: &regex::Captures<'_>| {
                let label = INLINE_TAG_RE.replace_all(&captures["label"], "");
                let label = label.trim();
                if label.is_empty() {
                    String::new()
                } else {
                    format!("@{label}")
                }
            })
            .into_owned();
    }
    markdown = NOTION_DATE_MENTION
        .replace_all(&markdown, |captures: &regex::Captures<'_>| {
            notion_date_mention(&captures["attrs"])
        })
        .into_owned();
    for regex in PAIRED_NOTION_MEDIA.iter() {
        markdown = regex
            .replace_all(&markdown, |captures: &regex::Captures<'_>| {
                notion_media_link(&captures["attrs"], &captures["label"])
            })
            .into_owned();
    }
    markdown = NOTION_UNKNOWN_BLOCK
        .replace_all(&markdown, |captures: &regex::Captures<'_>| {
            notion_unknown_block(&captures["attrs"])
        })
        .into_owned();
    markdown = PAIRED_NOTION_SPAN
        .replace_all(&markdown, |captures: &regex::Captures<'_>| {
            captures["label"].to_string()
        })
        .into_owned();
    markdown = NOTION_SUMMARY
        .replace_all(&markdown, |captures: &regex::Captures<'_>| {
            captures["label"].to_string()
        })
        .into_owned();
    markdown = markdown
        .replace("<ancestor-path>\n", "")
        .replace("\n</ancestor-path>", "")
        .replace("<ancestor-path>", "")
        .replace("</ancestor-path>", "");
    markdown = NOTION_TOGGLE_MARKER.replace_all(&markdown, "").into_owned();
    markdown = NOTION_BLOCK_ATTRIBUTES
        .replace_all(&markdown, "")
        .into_owned();
    markdown = NOTION_EMPTY_BLOCK.replace_all(&markdown, "").into_owned();
    markdown = convert_notion_tables(&markdown);
    markdown = flatten_notion_containers(&markdown);
    markdown = normalize_escaped_notion_todos(&markdown);
    let input_trailing_newlines = input
        .chars()
        .rev()
        .take_while(|value| *value == '\n')
        .count();
    let output_trailing_newlines = markdown
        .chars()
        .rev()
        .take_while(|value| *value == '\n')
        .count();
    for _ in output_trailing_newlines..input_trailing_newlines {
        markdown.push('\n');
    }
    markdown
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

fn prepare_notion_markdown(input: &str) -> anyhow::Result<String> {
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

    let markdown = normalize_notion_markdown(input);
    anyhow::ensure!(
        !markdown.trim().is_empty(),
        "fetched page has no supported body content"
    );
    anyhow::ensure!(
        !contains_outside_fenced_code(&markdown, &UNHANDLED_NOTION_MARKUP),
        "fetched page contained unsupported Notion markup after normalization"
    );
    Ok(markdown)
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

fn notion_page_link(attrs: &str, body_label: Option<std::borrow::Cow<'_, str>>) -> String {
    let mut url = None;
    let mut title = None;
    for captures in NOTION_ATTR_RE.captures_iter(attrs) {
        match &captures["name"] {
            "url" => url = Some(captures["value"].to_string()),
            "title" => title = Some(captures["value"].to_string()),
            _ => {}
        }
    }
    let Some(url) = url else {
        return body_label.unwrap_or_default().into_owned();
    };
    let label = body_label
        .as_deref()
        .map(str::trim)
        .filter(|label| !label.is_empty())
        .or_else(|| {
            title
                .as_deref()
                .map(str::trim)
                .filter(|label| !label.is_empty())
        })
        .unwrap_or("Notion page");
    format!("[{}]({url})", escape_markdown_link_label(label))
}

fn notion_media_link(attrs: &str, body_label: &str) -> String {
    let attributes = notion_attributes(attrs);
    let Some(url) = attributes
        .get("src")
        .or_else(|| attributes.get("url"))
        .filter(|url| is_web_url(url))
    else {
        return INLINE_TAG_RE.replace_all(body_label, "").trim().to_string();
    };
    let label = INLINE_TAG_RE.replace_all(body_label, "");
    let label = label.trim();
    let label = if label.is_empty() {
        "Notion file"
    } else {
        label
    };
    format!("[{}]({url})", escape_markdown_link_label(label))
}

fn notion_unknown_block(attrs: &str) -> String {
    let attributes = notion_attributes(attrs);
    let Some(url) = attributes.get("url").filter(|url| is_web_url(url)) else {
        return String::new();
    };
    let label = attributes
        .get("alt")
        .map(String::as_str)
        .map(str::trim)
        .filter(|label| !label.is_empty())
        .unwrap_or("Unsupported Notion content");
    format!("[{}]({url})", escape_markdown_link_label(label))
}

fn notion_date_mention(attrs: &str) -> String {
    let attributes = notion_attributes(attrs);
    let Some(start) = attributes.get("start") else {
        return String::new();
    };
    let mut label = humanize_notion_date(start);
    if let Some(time) = attributes.get("startTime").filter(|time| !time.is_empty()) {
        label.push(' ');
        label.push_str(time);
    }
    if let Some(end) = attributes
        .get("end")
        .filter(|end| !end.is_empty() && *end != start)
    {
        label.push_str(" – ");
        label.push_str(&humanize_notion_date(end));
    }
    label
}

fn humanize_notion_date(value: &str) -> String {
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map(|date| date.format("%B %-d, %Y").to_string())
        .unwrap_or_else(|_| value.to_string())
}

fn notion_attributes(attrs: &str) -> std::collections::HashMap<String, String> {
    NOTION_ATTR_RE
        .captures_iter(attrs)
        .map(|captures| (captures["name"].to_string(), captures["value"].to_string()))
        .collect()
}

fn escape_markdown_link_label(label: &str) -> String {
    label
        .replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]")
}

#[derive(Debug)]
enum DroppedNotionContainer {
    Plain,
    Callout {
        icon: Option<String>,
        emitted_icon: bool,
    },
}

fn flatten_notion_containers(input: &str) -> String {
    let mut output = Vec::new();
    let mut containers: Vec<DroppedNotionContainer> = Vec::new();

    for line in input.lines() {
        let trimmed = line.trim();
        if is_notion_container_close(trimmed) {
            containers.pop();
            continue;
        }
        if let Some(container) = notion_container_open(trimmed) {
            containers.push(container);
            continue;
        }

        let mut flattened = drop_notion_container_indentation(line, containers.len()).to_string();
        if containers
            .iter()
            .any(|container| matches!(container, DroppedNotionContainer::Callout { .. }))
        {
            let icon = containers
                .iter_mut()
                .rev()
                .find_map(|container| match container {
                    DroppedNotionContainer::Callout { icon, emitted_icon } if !*emitted_icon => {
                        *emitted_icon = true;
                        icon.take()
                    }
                    _ => None,
                });
            flattened = match (icon, flattened.trim().is_empty()) {
                (Some(icon), false) => format!("> {icon} {flattened}"),
                (Some(icon), true) => format!("> {icon}"),
                (None, false) => format!("> {flattened}"),
                (None, true) => ">".to_string(),
            };
        }
        output.push(flattened);
    }

    output.join("\n")
}

fn notion_container_open(line: &str) -> Option<DroppedNotionContainer> {
    for tag in [
        "details",
        "columns",
        "column",
        "synced_block",
        "synced_block_reference",
    ] {
        if line.starts_with(&format!("<{tag}")) && line.ends_with('>') {
            return Some(DroppedNotionContainer::Plain);
        }
    }
    if line.starts_with("<callout") && line.ends_with('>') {
        let attrs = line
            .strip_prefix("<callout")
            .and_then(|line| line.strip_suffix('>'))
            .unwrap_or_default();
        return Some(DroppedNotionContainer::Callout {
            icon: notion_attributes(attrs).remove("icon"),
            emitted_icon: false,
        });
    }
    None
}

fn is_notion_container_close(line: &str) -> bool {
    [
        "</details>",
        "</callout>",
        "</columns>",
        "</column>",
        "</synced_block>",
        "</synced_block_reference>",
    ]
    .contains(&line)
}

fn drop_notion_container_indentation(mut line: &str, levels: usize) -> &str {
    for _ in 0..levels {
        if let Some(rest) = line.strip_prefix('\t') {
            line = rest;
        } else if let Some(rest) = line.strip_prefix("    ") {
            line = rest;
        } else {
            break;
        }
    }
    line
}

fn normalize_escaped_notion_todos(input: &str) -> String {
    input
        .lines()
        .map(|line| {
            ESCAPED_NOTION_TODO
                .captures(line)
                .map(|captures| {
                    format!(
                        "{}- [{}]{}",
                        &captures["indent"],
                        captures["state"].to_ascii_lowercase(),
                        &captures["rest"]
                    )
                })
                .unwrap_or_else(|| line.to_string())
        })
        .collect::<Vec<_>>()
        .join("\n")
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

fn contains_outside_fenced_code(input: &str, pattern: &regex::Regex) -> bool {
    let mut found = false;
    let _ = transform_outside_fenced_code(input, |fragment| {
        found |= pattern.is_match(fragment);
        fragment.to_string()
    });
    found
}

fn convert_notion_tables(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut remaining = input;
    while let Some(start) = remaining.find("<table") {
        output.push_str(&remaining[..start]);
        let table = &remaining[start..];
        let Some(close_start) = table.find("</table>") else {
            output.push_str(table);
            return output;
        };
        let close_end = close_start + "</table>".len();
        let fragment = &table[..close_end];
        match notion_table_to_markdown(fragment) {
            Some(converted) => output.push_str(&converted),
            None => output.push_str(fragment),
        }
        remaining = &table[close_end..];
    }
    output.push_str(remaining);
    output
}

fn notion_table_to_markdown(table: &str) -> Option<String> {
    let mut rows: Vec<Vec<String>> = TABLE_ROW_RE
        .captures_iter(table)
        .filter_map(|row| {
            let cells: Vec<String> = TABLE_CELL_RE
                .captures_iter(&row["body"])
                .map(|cell| normalize_notion_table_cell(&cell["body"]))
                .collect();
            (!cells.is_empty()).then_some(cells)
        })
        .collect();
    let column_count = rows.iter().map(Vec::len).max()?;
    if column_count == 0 {
        return None;
    }
    for row in &mut rows {
        row.resize(column_count, String::new());
    }

    let mut lines = Vec::with_capacity(rows.len() + 1);
    for (index, row) in rows.into_iter().enumerate() {
        lines.push(format!("| {} |", row.join(" | ")));
        if index == 0 {
            lines.push(format!(
                "| {} |",
                std::iter::repeat_n("---", column_count)
                    .collect::<Vec<_>>()
                    .join(" | ")
            ));
        }
    }
    Some(lines.join("\n"))
}

fn normalize_notion_table_cell(cell: &str) -> String {
    let with_breaks = BREAK_TAG_RE.replace_all(cell, "\n");
    let without_tags = INLINE_TAG_RE.replace_all(&with_breaks, "");
    without_tags
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\\n")
        .replace('|', "&#124;")
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
struct NativePlusMcp<Context> {
    native: ai_toolset::AsyncToolCollection<Context>,
    native_names: HashSet<String>,
    mcp: Arc<UserMcpTools>,
}

impl<Context: Send + Sync + 'static> NativePlusMcp<Context> {
    fn new(native: ai_toolset::AsyncToolCollection<Context>, mcp: Arc<UserMcpTools>) -> Self {
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

impl<Context> ToolSet<Context> for NativePlusMcp<Context>
where
    Context: Clone + Send + Sync + 'static,
{
    fn try_tool_call<'a>(
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
                .try_tool_call(context, request_context, tool_name, json)
        } else {
            self.mcp
                .try_tool_call(context, request_context, tool_name, json)
        }
    }

    fn request_schemas(&self) -> Option<Vec<ai_toolset::RequestSchema>> {
        let mut schemas = self.native.request_schemas().unwrap_or_default();
        schemas.extend(ToolSet::<Context>::request_schemas(&*self.mcp).unwrap_or_default());
        (!schemas.is_empty()).then_some(schemas)
    }
}
