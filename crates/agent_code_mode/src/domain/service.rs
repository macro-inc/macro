use std::sync::Arc;

use agent_session::domain::model::{AgentSession, AgentSessionId};
use async_trait::async_trait;
use code_execution::domain::{ExecuteRequest, Limits, Outcome, ProgramExecutor};
use entity_access::domain::models::{EntityAccessReceipt, EntityType, ViewAccessLevel};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;
use tracing::Instrument;

use super::*;

/// Session-bound execution and reads. Inbound adapters supply authenticated facts.
#[async_trait]
pub trait SessionCodeMode: Send + Sync + 'static {
    /// Execute as the authenticated session's owner, retaining source and final results.
    async fn execute(
        &self,
        session: &AgentSession,
        execution: ExecutionId,
        request: ExecuteRequest,
        cancel: CancellationToken,
    ) -> Result<ExecutionReceipt, CodeModeError>;
    /// Read a record under the session capability minted by entity access.
    async fn read(
        &self,
        access: &EntityAccessReceipt<ViewAccessLevel>,
        execution: ExecutionId,
    ) -> Result<ExecutionRecord, CodeModeError>;
}

struct Inner {
    executor: Option<Arc<dyn ProgramExecutor>>,
    credentials: Arc<dyn ExecutionCredentials>,
    store: Arc<dyn ExecutionStore>,
    turns: Arc<dyn ExecutionTurns>,
    admission: Arc<Semaphore>,
}

/// Code-mode policy over interchangeable execution, credential, and storage capabilities.
#[derive(Clone)]
pub struct CodeModeService(Arc<Inner>);

impl CodeModeService {
    /// Bind the authenticated runtime and a bounded admission budget once at startup.
    pub fn new(
        executor: Option<Arc<dyn ProgramExecutor>>,
        credentials: Arc<dyn ExecutionCredentials>,
        store: Arc<dyn ExecutionStore>,
        turns: Arc<dyn ExecutionTurns>,
    ) -> Self {
        let limits = Limits::default();
        Self(Arc::new(Inner {
            executor,
            credentials,
            store,
            turns,
            admission: Arc::new(Semaphore::new(limits.max_running + limits.max_queued)),
        }))
    }

    async fn run(
        &self,
        identity: ExecutionIdentity,
        execution: ExecutionId,
        request: ExecuteRequest,
        cancel: CancellationToken,
    ) -> Result<ExecutionReceipt, CodeModeError> {
        let mut record = ExecutionRecord {
            execution_id: execution,
            source: request.source.clone(),
            status: ExecutionStatus::Running,
            result: None,
            error: None,
            calls: Vec::new(),
            activity: Vec::new(),
            activity_truncated: false,
        };
        if let Err(error) = self.0.store.create(identity.session, &record).await {
            if matches!(error, CodeModeError::Duplicate) {
                let existing = self
                    .0
                    .store
                    .get(identity.session, execution)
                    .await
                    .map_err(|error| match error {
                        // The ID may be unavailable outside this session. Do
                        // not look up or reveal another session's record.
                        CodeModeError::NotFound => CodeModeError::Invalid(
                            "execution ID unavailable; use a fresh UUID".into(),
                        ),
                        other => other,
                    })?;
                if existing.source == request.source {
                    return Ok(receipt(&existing));
                }
            }
            return Err(error);
        }
        let environment = match self
            .0
            .credentials
            .issue(&identity, &request.source, cancel.clone())
            .await
        {
            Ok(environment) => environment,
            Err(error) => {
                record.status = ExecutionStatus::Failed;
                record.error = Some(error.to_string());
                self.0.store.save(identity.session, &record).await?;
                return Err(error);
            }
        };
        if !active_turn(&self.0, &identity).await || cancel.is_cancelled() {
            record.status = ExecutionStatus::Cancelled;
            record.error = Some("Execution cancelled before starting.".into());
            self.0.store.save(identity.session, &record).await?;
            return Ok(receipt(&record));
        }
        let (progress, mut updates) = tokio::sync::mpsc::channel(512);
        let execution = self
            .0
            .executor
            .as_ref()
            .ok_or(CodeModeError::Unavailable)?
            .execute_program_with_progress(request, environment, cancel.clone(), progress);
        tokio::pin!(execution);
        // Stateless MCP requests can outlive their HTTP caller. Check shared
        // turn state so Stop also cancels work handled by another replica.
        let watch_turn = async {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                if !active_turn(&self.0, &identity).await {
                    cancel.cancel();
                    break;
                }
            }
        };
        tokio::pin!(watch_turn);
        let mut save_tick = tokio::time::interval(std::time::Duration::from_millis(250));
        let mut dirty = false;
        let mut progress_open = true;
        let outcome = 'running: loop {
            tokio::select! {
                outcome = &mut execution => break outcome,
                () = &mut watch_turn => break execution.await,
                update = updates.recv(), if progress_open => {
                    if let Some(value) = update {
                        super::activity::observe(&mut record, value);
                        dirty = true;
                    } else {
                        progress_open = false;
                    }
                }
                _ = save_tick.tick(), if dirty => {
                    // Keep polling execution and shared Stop while persisting advisory activity.
                    dirty = false;
                    let saved = tokio::select! {
                        outcome = &mut execution => break 'running outcome,
                        () = &mut watch_turn => break 'running execution.await,
                        saved = tokio::time::timeout(
                            std::time::Duration::from_millis(100),
                            self.0.store.save(identity.session, &record),
                        ) => saved,
                    };
                    if !matches!(saved, Ok(Ok(()))) {
                        tracing::warn!("could not save live code activity");
                    }
                }
            }
        };
        while let Ok(value) = updates.try_recv() {
            super::activity::observe(&mut record, value);
        }
        super::activity::finish(&mut record);
        let (status, result, error) = match outcome {
            Outcome::Succeeded { mut value } => {
                if let Some(object) = value.as_object_mut()
                    && object.len() == 1
                    && object.contains_key("data")
                {
                    object.insert("reviews".into(), serde_json::json!([]));
                }
                let valid = value.as_object().is_some_and(|object| {
                    object.len() == 2
                        && object.contains_key("data")
                        && object.get("reviews").is_some_and(|references| {
                            serde_json::from_value::<Vec<reviews::ReviewReference>>(
                                references.clone(),
                            )
                            .is_ok()
                        })
                });
                if valid {
                    (ExecutionStatus::Succeeded, Some(value), None)
                } else {
                    (ExecutionStatus::Failed, Some(value), Some("main must return {data: JSON}; optional reviews must be an array of {kind, id} references.".into()))
                }
            }
            Outcome::Failed { error } => (ExecutionStatus::Failed, None, Some(error.message)),
            Outcome::Cancelled => (
                ExecutionStatus::Cancelled,
                None,
                Some("Execution cancelled. Unfinished calls may have taken effect.".into()),
            ),
            Outcome::TimedOut => (
                ExecutionStatus::TimedOut,
                None,
                Some("Execution timed out. Unfinished calls may have taken effect.".into()),
            ),
        };
        record.status = status;
        record.result = result;
        record.error = error;
        self.0.store.save(identity.session, &record).await?;
        Ok(receipt(&record))
    }
}

/// Tools whose operations have an equivalent in the public Macro SDK.
/// Keep unsupported capabilities discoverable rather than assuming every native
/// tool can be called through a dynamic proxy (there is no such proxy anymore).
pub fn covered_by_code_sdk(name: &str, user_tool: bool) -> bool {
    !user_tool
        && matches!(
            name,
            "NameSearch"
                | "ListEntities"
                | "ReadContent"
                | "ReadMetadata"
                | "RenameDocument"
                | "MoveToProject"
                | "MoveToTrash"
                | "CommentOnDocument"
                | "DeleteDocumentComment"
                | "EditDocumentComment"
                | "ResolveDocumentComment"
                | "ReadProject"
                | "CreateProject"
                | "SetFavorite"
                | "GetEntityProperties"
                | "SetEntityProperty"
                | "BulkSetEntityPropertyOptions"
                | "ListInboxes"
                | "ListLabels"
                | "GetThread"
                | "ReadThread"
                | "UpdateThreadLabels"
                | "SetSenderPolicy"
                | "CreateChannel"
                | "SendChannelMessage"
                | "EditChannelMessage"
                | "DeleteChannelMessage"
                | "ReactToChannelMessage"
                | "ReadChannelMessages"
                | "ReadChannelThread"
                | "RenameChannel"
                | "ManageChannelParticipants"
                | "ReadChat"
                | "ReadCallRecord"
                | "UpdateCallRecord"
                | "DeleteCallRecord"
                | "ListCalendars"
                | "ListCalendarEvents"
                | "UpdateCalendarEvent"
                | "DeleteCalendarEvent"
                | "ListNotifications"
                | "MarkNotificationsDone"
                | "MarkNotificationsSeen"
                | "ListTeamMembers"
                | "CreateForm"
                | "EditForm"
                | "ReadForm"
                | "ListForms"
                | "SetFormAccess"
                | "CreateSkill"
                | "Decide"
                | "GenerateObject"
        )
}

#[async_trait]
impl SessionCodeMode for CodeModeService {
    async fn execute(
        &self,
        session: &AgentSession,
        execution: ExecutionId,
        request: ExecuteRequest,
        cancel: CancellationToken,
    ) -> Result<ExecutionReceipt, CodeModeError> {
        if self.0.executor.is_none() {
            return Err(CodeModeError::Unavailable);
        }
        if session.is_archived {
            return Err(CodeModeError::Forbidden);
        }
        let owner = session
            .owner_user()
            .map_err(|_| CodeModeError::Forbidden)?
            .clone();
        let limits = Limits::default();
        if request.source.trim().is_empty()
            || request.source.len() > limits.max_source_bytes
            || request.timeout_ms == 0
            || request.timeout_ms > 30_000
        {
            return Err(CodeModeError::Invalid("Provide a nonempty JavaScript module exporting main() of at most 64 KiB and timeout_ms between 1 and 30000.".into()));
        }
        let permit = Arc::clone(&self.0.admission)
            .try_acquire_owned()
            .map_err(|_| CodeModeError::Busy)?;
        let identity = ExecutionIdentity {
            execution,
            session: session.id,
            owner,
            turn: self
                .0
                .turns
                .active(session.id)
                .await?
                .ok_or(CodeModeError::Forbidden)?,
        };
        let cancel = cancel.child_token();
        let _cancel_on_drop = cancel.clone().drop_guard();
        let service = self.clone();
        // Finish the journal even when the MCP request future is dropped. The drop
        // guard cancels the runner; its final cleanup then persists the outcome.
        tokio::spawn(
            async move {
                let _permit = permit;
                let result = service.run(identity, execution, request, cancel).await;
                if let Err(error) = &result {
                    tracing::error!(?error, "could not finish code execution journal");
                }
                result
            }
            .in_current_span(),
        )
        .await
        .map_err(CodeModeError::Task)?
    }

    async fn read(
        &self,
        access: &EntityAccessReceipt<ViewAccessLevel>,
        execution: ExecutionId,
    ) -> Result<ExecutionRecord, CodeModeError> {
        if access.entity().entity_type != EntityType::AgentSession {
            return Err(CodeModeError::Forbidden);
        }
        let session = access
            .entity()
            .entity_id
            .parse()
            .map(AgentSessionId::new_from_uuid)
            .map_err(|_| CodeModeError::Forbidden)?;
        let mut record = self.0.store.get(session, execution).await?;
        // A persisted nonterminal record cannot establish whether its process
        // survived. Expose the same uncertainty on journal reads and retries.
        record.error = execution_error(&record);
        Ok(record)
    }
}

fn receipt(record: &ExecutionRecord) -> ExecutionReceipt {
    ExecutionReceipt {
        execution_id: record.execution_id,
        status: record.status,
        result: record.result.clone(),
        error: execution_error(record),
    }
}

fn execution_error(record: &ExecutionRecord) -> Option<String> {
    if record.status == ExecutionStatus::Running {
        Some("Execution outcome is unconfirmed: it may still be running or may have been interrupted. This request did not replay the code. Check current state before retrying writes.".into())
    } else {
        record.error.clone()
    }
}

async fn active_turn(inner: &Inner, identity: &ExecutionIdentity) -> bool {
    // Retry transient pool contention without admitting a tool until shared
    // state confirms the original turn. A confirmed Stop never needs a retry.
    for attempt in 0..3 {
        match tokio::time::timeout(
            std::time::Duration::from_secs(1),
            inner.turns.active(identity.session),
        )
        .await
        {
            Ok(Ok(turn)) => return turn == Some(identity.turn),
            Ok(Err(error)) => tracing::warn!(?error, attempt, "could not read active session turn"),
            Err(_) => tracing::warn!(attempt, "active session turn lookup timed out"),
        }
        if attempt < 2 {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
    }
    false
}

#[cfg(test)]
mod test;
