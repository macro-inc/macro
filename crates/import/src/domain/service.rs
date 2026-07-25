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
use super::ports::{EntityCreator, ImportError, ImportRepo, ImportedTaskProperties, Result};
use crate::inbound::toolset::{
    ImportToolContext, ToolPolicy, gather_toolset, notion_import_toolset,
};
use agent::types::{ChatMessage, ChatMessageContent, Role};
use agent::{AgentLoop, PredefinedModel};
use ai_toolset::{RequestContext, ToolResult, ToolSet, ToolSetError};
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::domain::models::McpServerRecord;
use mcp_client::domain::ports::McpServerStore;
use mcp_client::domain::service::McpToolSet;
use std::collections::HashSet;
use std::pin::Pin;
use std::sync::Arc;
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
    ) -> impl Future<Output = Result<ImportEntity>> + Send;
}

/// Concrete orchestrator wiring the repo, the user's MCP servers, the
/// entity creator, and usage recording together.
pub struct ImportServiceImpl<R, S, C> {
    repo: R,
    mcp_store: Arc<S>,
    creator: Arc<C>,
    recorder: Arc<dyn ai_usage::UsageRecorder>,
    notifier: Option<ImportNotify>,
}

impl<R: Clone, S, C> Clone for ImportServiceImpl<R, S, C> {
    fn clone(&self) -> Self {
        Self {
            repo: self.repo.clone(),
            mcp_store: self.mcp_store.clone(),
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
        mcp_store: Arc<S>,
        creator: Arc<C>,
        recorder: Arc<dyn ai_usage::UsageRecorder>,
    ) -> Self {
        Self {
            repo,
            mcp_store,
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
    S: McpServerStore,
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
        let native = gather_toolset::<Self>();
        let toolset = NativePlusMcp::new(native, mcp_tools);
        let context = ImportToolContext {
            service: Some(Arc::new(self.clone())),
            policy: ToolPolicy::gather(source),
        };

        self.drive_session(
            user,
            GATHER_MODEL,
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
        mcp_tools: &McpToolSet,
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

        let text = match result {
            serde_json::Value::String(text) => text,
            other => other.to_string(),
        };
        let (fetched_title, body) = parse_notion_fetch_text(&text);
        anyhow::ensure!(!body.trim().is_empty(), "fetched page has no content");

        let name = row
            .metadata
            .get("title")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .or(fetched_title)
            .unwrap_or_else(|| "Untitled".to_string());
        let url = row.metadata.get("url").and_then(|v| v.as_str());
        let markdown = match url {
            Some(url) => format!("{}\n\n[Original in Notion]({url})", body.trim_end()),
            None => body,
        };

        self.finalize_document(user, row.id, &name, &markdown)
            .await
            .map_err(|e| anyhow::anyhow!("finalize failed: {e}"))?;
        Ok(())
    }

    /// Fallback: run a single-page Haiku session over the shared connector
    /// tools. Rows the agent fails to finalize are handled by the caller.
    #[tracing::instrument(skip(self, user, mcp_tools, rows), fields(pages = rows.len()), err)]
    async fn run_notion_import_session(
        &self,
        user: &MacroUserIdStr<'static>,
        rows: &[ImportEntity],
        mcp_tools: Arc<McpToolSet>,
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
    ) -> anyhow::Result<Arc<McpToolSet>> {
        let url = source.mcp_server_url();
        let records: Vec<McpServerRecord> = self
            .mcp_store
            .list(user)
            .await
            .map_err(|e| anyhow::anyhow!("mcp store: {e:?}"))?
            .into_iter()
            .filter(|r| r.url == url)
            .collect();
        anyhow::ensure!(!records.is_empty(), "no {} connection", source.as_ref());

        let mcp_tools = McpToolSet::new(&records, self.mcp_store.clone()).await;
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
                            let outcome =
                                tokio::time::timeout(NOTION_PAGE_IMPORT_TIMEOUT, async {
                                    match service
                                        .import_notion_page_direct(&user, &mcp_tools, &row)
                                        .await
                                    {
                                        Ok(()) => Ok(()),
                                        Err(direct_error) => {
                                            tracing::info!(id = %row.id, error = ?direct_error, "direct notion import failed; trying the agent");
                                            service
                                                .run_notion_import_session(
                                                    &user,
                                                    std::slice::from_ref(&row),
                                                    mcp_tools.clone(),
                                                )
                                                .await
                                        }
                                    }
                                })
                                .await
                                .unwrap_or_else(|_| {
                                    Err(anyhow::anyhow!("notion import timed out"))
                                });
                            let _ = outcome.inspect_err(|e| {
                                tracing::warn!(id = %row.id, error = ?e, "notion page import failed");
                            });
                            service
                                .fail_unfinished(
                                    &user,
                                    &[row.id],
                                    "the import job did not finish this item",
                                )
                                .await;
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
    S: McpServerStore,
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
    S: McpServerStore,
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

impl<R, S, C> ImportFinalizer for ImportServiceImpl<R, S, C>
where
    R: ImportRepo + Clone,
    S: McpServerStore,
    C: EntityCreator,
{
    #[tracing::instrument(skip(self, user, content_markdown), err)]
    async fn finalize_document(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        name: &str,
        content_markdown: &str,
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
                self.creator
                    .create_markdown_doc(user, name, content_markdown)
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

/// The mangled name of the connector's `notion-fetch` tool, whatever the
/// user named their server when connecting it (`mcp__<server>__notion-fetch`).
fn notion_fetch_tool_name(mcp_tools: &McpToolSet) -> Option<String> {
    ToolSet::<()>::request_schemas(mcp_tools)?
        .into_iter()
        .map(|schema| schema.name)
        .find(|name| name.ends_with("__notion-fetch"))
}

/// Split a `notion-fetch` result into `(title, body)`. The tool returns a
/// JSON document (`{id, title, text, url, …}`) as text; a result that isn't
/// that shape is treated as the body itself.
fn parse_notion_fetch_text(text: &str) -> (Option<String>, String) {
    if let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(text)
        && let Some(body) = map.get("text").and_then(|v| v.as_str())
    {
        let title = map
            .get("title")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        return (title, body.to_string());
    }
    (None, text.to_string())
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
    mcp: Arc<McpToolSet>,
}

impl<Context: Send + Sync + 'static> NativePlusMcp<Context> {
    fn new(native: ai_toolset::AsyncToolCollection<Context>, mcp: Arc<McpToolSet>) -> Self {
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
