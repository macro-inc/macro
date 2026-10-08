use std::collections::HashSet;
use std::sync::Arc;

use agent_session::domain::model::{AgentSession, AgentSessionId};
use async_trait::async_trait;
use code_execution::domain::{
    DispatchContext, ExecuteRequest, HostCall, HostDispatcher, HostResult, Limits, Outcome,
    ProgramExecutor,
};
use entity_access::domain::models::{EntityAccessReceipt, EntityType, ViewAccessLevel};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;
use tracing::Instrument;

use super::*;

const MAX_RECORD_BYTES: usize = 2 * 1024 * 1024;
const MAX_DISCOVERY_NAMES: usize = 5;
// Leave room for the runner's reply envelope inside its 256 KiB frame.
const MAX_TOOL_REPLY_BYTES: usize = 255 * 1024;
const MAX_RECORDED_ERROR_BYTES: usize = 1024;
// Reserve room for the final program result and bounded errors on all 128 calls.
const CALL_RECORD_BUDGET: usize =
    MAX_RECORD_BYTES - 256 * 1024 - 128 * (MAX_RECORDED_ERROR_BYTES + 256);

/// Session-bound execution and reads. Inbound adapters supply authenticated facts.
#[async_trait]
pub trait SessionCodeMode: Send + Sync + 'static {
    /// Discover SDK methods; an empty list returns the compact catalog.
    fn describe(&self, names: &[String]) -> Result<Vec<ToolDocumentation>, CodeModeError>;
    /// Execute as the authenticated session's owner, retaining real call records.
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
    tools: Arc<dyn CodeModeTools>,
    store: Arc<dyn ExecutionStore>,
    turns: Arc<dyn ExecutionTurns>,
    catalog: Vec<ToolDocumentation>,
    allowed: HashSet<String>,
    admission: Arc<Semaphore>,
}

/// Code-mode policy over interchangeable execution, tool, and storage capabilities.
#[derive(Clone)]
pub struct CodeModeService(Arc<Inner>);

impl CodeModeService {
    /// Bind the runtime catalog and a bounded admission budget once at startup.
    pub fn new(
        executor: Option<Arc<dyn ProgramExecutor>>,
        tools: Arc<dyn CodeModeTools>,
        store: Arc<dyn ExecutionStore>,
        turns: Arc<dyn ExecutionTurns>,
    ) -> Self {
        let catalog: Vec<_> = tools.catalog().into_iter().filter(allowed_tool).collect();
        let allowed = catalog.iter().map(|tool| tool.name.clone()).collect();
        Self(Arc::new(Inner {
            executor,
            tools,
            store,
            turns,
            catalog,
            allowed,
            admission: Arc::new(Semaphore::new(20)),
        }))
    }

    async fn run(
        &self,
        identity: ExecutionIdentity,
        execution: ExecutionId,
        request: ExecuteRequest,
        cancel: CancellationToken,
    ) -> Result<ExecutionReceipt, CodeModeError> {
        let record = ExecutionRecord {
            execution_id: execution,
            source: request.source.clone(),
            status: ExecutionStatus::Running,
            result: None,
            error: None,
            calls: Vec::new(),
        };
        if let Err(error) = self.0.store.create(identity.session, &record).await {
            if matches!(error, CodeModeError::Duplicate) {
                let existing = self.0.store.get(identity.session, execution).await?;
                if existing.source == request.source {
                    return Ok(receipt(&existing));
                }
            }
            return Err(error);
        }
        let dispatcher = Arc::new(RecordingDispatcher {
            inner: Arc::clone(&self.0),
            identity: identity.clone(),
            record: tokio::sync::Mutex::new(record),
            cancel: cancel.clone(),
        });
        let execution = self
            .0
            .executor
            .as_ref()
            .ok_or(CodeModeError::Unavailable)?
            .execute_program(request, dispatcher.clone(), cancel.clone());
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
        let outcome = tokio::select! {
            outcome = &mut execution => outcome,
            () = watch_turn => execution.await,
        };
        let mut record = dispatcher.record.lock().await;
        for call in &mut record.calls {
            if call.status == RecordedCallStatus::Running {
                call.status = RecordedCallStatus::Unknown;
            }
        }
        let (status, result, error) = match outcome {
            Outcome::Succeeded { value } => (ExecutionStatus::Succeeded, Some(value), None),
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

// Human-finished tools retain their existing host lifecycle. Discovery, delegation,
// and execution itself stay outside the SDK to prevent recursive execution trees.
fn allowed_tool(tool: &ToolDocumentation) -> bool {
    !tool.user_tool
        && !matches!(
            tool.name.as_str(),
            "ExecuteCode"
                | "DescribeCodeTools"
                | "Subagent"
                | "DispatchCodingAgent"
                | "SearchTools"
                | "LoadTools"
                | "SendEmail"
                | "SendConfirmedEmail"
                | "CreateCalendarEvent"
                | "CreateConfirmedCalendarEvent"
                | "AskUser"
        )
}

#[async_trait]
impl SessionCodeMode for CodeModeService {
    fn describe(&self, names: &[String]) -> Result<Vec<ToolDocumentation>, CodeModeError> {
        if names.len() > MAX_DISCOVERY_NAMES {
            return Err(CodeModeError::Invalid(
                "Request schemas for at most five SDK methods at a time.".into(),
            ));
        }
        if names.is_empty() {
            return Ok(self
                .0
                .catalog
                .iter()
                .cloned()
                .map(|mut tool| {
                    tool.input_schema = serde_json::Value::Null;
                    tool.output_schema = serde_json::Value::Null;
                    tool
                })
                .collect());
        }
        names.iter().map(|name| self.0.catalog.iter().find(|tool| tool.name == *name).cloned()
            .ok_or_else(|| CodeModeError::Invalid(format!("Unknown SDK method {name}. Call DescribeCodeTools with no names for the catalog.")))).collect()
    }

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
            return Err(CodeModeError::Invalid("Provide a nonempty TypeScript function body of at most 64 KiB and timeout_ms between 1 and 30000.".into()));
        }
        let permit = Arc::clone(&self.0.admission)
            .try_acquire_owned()
            .map_err(|_| CodeModeError::Busy)?;
        let identity = ExecutionIdentity {
            session: session.id,
            owner,
            bot: session.bot_id,
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
        self.0.store.get(session, execution).await
    }
}

struct RecordingDispatcher {
    inner: Arc<Inner>,
    identity: ExecutionIdentity,
    record: tokio::sync::Mutex<ExecutionRecord>,
    cancel: CancellationToken,
}

fn receipt(record: &ExecutionRecord) -> ExecutionReceipt {
    ExecutionReceipt {
        execution_id: record.execution_id,
        status: record.status,
        result: record.result.clone(),
        error: record.error.clone(),
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

fn record_size(record: &ExecutionRecord) -> Result<usize, CodeModeError> {
    serde_json::to_vec(record)
        .map(|bytes| bytes.len())
        .map_err(|error| CodeModeError::Storage(rootcause::report!(error).into()))
}

fn bounded_error(message: &str) -> String {
    let mut end = message.len().min(MAX_RECORDED_ERROR_BYTES);
    while !message.is_char_boundary(end) {
        end -= 1;
    }
    message[..end].to_owned()
}

impl RecordingDispatcher {
    async fn begin(&self, call: &HostCall) -> Result<String, CodeModeError> {
        let mut record = self.record.lock().await;
        let id = format!("{}:{}", record.execution_id, call.id.0);
        record.calls.push(RecordedToolCall {
            id: id.clone(),
            name: call.method.clone(),
            input: call.args.clone(),
            output: None,
            output_omitted: false,
            error: None,
            status: RecordedCallStatus::Running,
        });
        if record_size(&record)? > CALL_RECORD_BUDGET {
            record.calls.pop();
            return Err(CodeModeError::Invalid("Tool-record budget exhausted; this call did not run. Return a result and use another execution.".into()));
        }
        // Never dispatch before the durable record says the call started.
        self.inner
            .store
            .save(self.identity.session, &record)
            .await?;
        Ok(id)
    }

    async fn finish(&self, id: &str, result: &HostResult) -> Result<(), CodeModeError> {
        let mut record = self.record.lock().await;
        let index = record
            .calls
            .iter()
            .position(|call| call.id == id)
            .expect("call was recorded");
        let call = &mut record.calls[index];
        match result {
            HostResult::Ok { value } => {
                call.output = Some(value.clone());
                call.status = RecordedCallStatus::Completed;
            }
            HostResult::Error { message } => {
                call.error = Some(bounded_error(message));
                call.status = RecordedCallStatus::Failed;
            }
        }
        if record_size(&record)? > CALL_RECORD_BUDGET {
            // Preserve the observed outcome of a write even when its full output
            // no longer fits. The UI explicitly reports an omitted response.
            let call = &mut record.calls[index];
            call.output = None;
            call.output_omitted = matches!(result, HostResult::Ok { .. });
        }
        self.inner.store.save(self.identity.session, &record).await
    }
}

#[async_trait]
impl HostDispatcher for RecordingDispatcher {
    async fn dispatch(&self, call: HostCall, context: DispatchContext) -> HostResult {
        let rejected = |message: String| HostResult::Error { message };
        if !self.inner.allowed.contains(&call.method) {
            return rejected("This SDK method is unavailable. Use DescribeCodeTools to discover methods; interactive tools must be called directly.".into());
        }
        if context.cancellation.is_cancelled() || !active_turn(&self.inner, &self.identity).await {
            self.cancel.cancel();
            return rejected("Execution cancelled.".into());
        }
        let id = match self.begin(&call).await {
            Ok(id) => id,
            Err(error) => {
                if !matches!(error, CodeModeError::Invalid(_)) {
                    self.cancel.cancel();
                }
                return rejected(error.to_string());
            }
        };
        if context.cancellation.is_cancelled() {
            return rejected("Execution cancelled.".into());
        }
        let result = self
            .inner
            .tools
            .call(
                &self.identity,
                &call.method,
                &call.args,
                context.cancellation,
            )
            .await;
        if let Err(error) = self.finish(&id, &result).await {
            self.cancel.cancel();
            return rejected(error.to_string());
        }
        if serde_json::to_vec(&result).map_or(true, |bytes| bytes.len() > MAX_TOOL_REPLY_BYTES) {
            return rejected("Tool result exceeds the reply limit. Narrow the request before retrying; the tool already ran and a completed write is not undone.".into());
        }
        result
    }
}

#[cfg(test)]
mod test;
