//! Native capture contract and the shared live/load processing machine.
use super::event::{CursorEvent, InteractionUpdate};
use super::model::{CursorRunId, RunOutcome, RunStatus};
use super::translate::TranslateMachine;
use agent_client_protocol::schema::v1::{
    ContentBlock, ContentChunk, SessionId, SessionUpdate, TextContent,
};
use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A complete SSE message, before JSON decoding. IDs are observations, never
/// local sequence numbers or an assumed remote resume token.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NativeRecord {
    /// SSE event name.
    pub event: String,
    /// Original data lines joined by the SSE decoder.
    pub data: String,
    /// Provider's SSE last-event ID, when supplied.
    pub id: Option<String>,
    /// Scripted provider vocabulary; HTTP adapters always leave this absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scripted_event: Option<Box<CursorEvent>>,
}
impl NativeRecord {
    /// Whether this record participates in reconnect prefix matching. This
    /// examines framing only; native payload decoding happens after append.
    pub(crate) fn is_content(&self) -> bool {
        match self.scripted_event.as_deref() {
            Some(
                CursorEvent::Status { .. } | CursorEvent::Heartbeat | CursorEvent::Error { .. },
            ) => false,
            Some(_) => true,
            None => !matches!(self.event.as_str(), "status" | "heartbeat" | "error"),
        }
    }
    /// Decode only after this record is durably captured.
    pub fn decode(&self) -> CursorEvent {
        if let Some(event) = &self.scripted_event {
            return event.as_ref().clone();
        }
        CursorEvent::from_wire(
            &self.event,
            serde_json::from_str(&self.data).unwrap_or_default(),
        )
    }
    /// Bridge for scripted providers that only implement the decoded port.
    pub fn scripted(event: CursorEvent) -> Self {
        Self {
            event: "scripted".into(),
            data: String::new(),
            id: None,
            scripted_event: Some(Box::new(event)),
        }
    }
}

/// Inputs, not a second ACP transcript. Every synthetic update has an input.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum JournalInput {
    /// History is known from its beginning (fresh session or full hydration).
    HistoryComplete,
    /// Original ACP prompt blocks, associated with the run that accepted them.
    Prompt(Vec<ContentBlock>),
    /// Links a pre-execution prompt sequence to its accepted provider run.
    PromptAccepted(i64),
    /// A pre-execution prompt was cancelled/rejected without a run.
    PromptAborted(i64),
    /// Transport failure, retained without prematurely closing running tools.
    TransportError(String),
    /// Raw complete provider message, including unknown payloads.
    Sse(NativeRecord),
    /// Original successful polling response body.
    Poll(String),
    /// A local terminal decision (e.g. stop during a disconnected poll).
    Interrupted(String),
    /// Capture has reconciled this run; distinct from ACP delivery checkpoint.
    Reconciled,
}
/// One input in explicit session order; run membership uses provider IDs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JournalEntry {
    /// Monotonically increasing session sequence, starting at one.
    pub sequence: i64,
    /// Provider run; absent only for session-level facts.
    pub run: Option<CursorRunId>,
    /// The captured native input.
    pub input: JournalInput,
}
/// Session-scoped durable storage. Implementations must reject stale owners
/// and compare `expected` to the current high-water mark atomically with append.
/// Reads and writes are never exposed as a public provider-history endpoint.
pub trait CursorJournal: Send + Sync + std::fmt::Debug {
    /// A stable ordered snapshot under the caller's session turn gate.
    fn read<'a>(
        &'a self,
        session: &'a SessionId,
    ) -> BoxFuture<'a, Result<Vec<JournalEntry>, rootcause::Report>>;
    /// Append before processing; failure must leave both progress and output unchanged.
    fn append<'a>(
        &'a self,
        session: &'a SessionId,
        expected: i64,
        run: Option<&'a CursorRunId>,
        input: &'a JournalInput,
    ) -> BoxFuture<'a, Result<JournalEntry, rootcause::Report>>;
}

#[derive(Debug, Default)]
struct RunState {
    prompt: bool,
    text: String,
    terminal: Option<RunStatus>,
}
/// Complete live/replay state, including user prompts and terminal tool cleanup.
#[derive(Debug, Default)]
pub struct ReplayMachine {
    translator: TranslateMachine,
    runs: HashMap<CursorRunId, RunState>,
}
impl ReplayMachine {
    /// Whether the run's original prompt is reconstructable.
    pub fn has_prompt(&self, run: &CursorRunId) -> bool {
        self.runs.get(run).is_some_and(|s| s.prompt)
    }
    /// Whether native history contains a prompt and a terminal fact for a run.
    pub fn complete(&self, run: &CursorRunId) -> bool {
        self.runs
            .get(run)
            .is_some_and(|s| s.prompt && s.terminal.is_some())
    }
    /// Durable provider terminal status, independent of the reconciliation marker.
    pub fn terminal_status(&self, run: &CursorRunId) -> Option<RunStatus> {
        self.runs.get(run).and_then(|s| s.terminal.clone())
    }
    /// Process one journal input, identically during capture and replay.
    pub fn push(
        &mut self,
        run: Option<&CursorRunId>,
        input: &JournalInput,
    ) -> Result<Vec<SessionUpdate>, rootcause::Report> {
        let Some(run) = run else {
            // Original requests also belong to history when they were stopped
            // before a remote run existed. Acceptance later only binds state.
            return Ok(match input {
                JournalInput::Prompt(blocks) => blocks
                    .iter()
                    .cloned()
                    .map(|b| SessionUpdate::UserMessageChunk(ContentChunk::new(b)))
                    .collect(),
                _ => Vec::new(),
            });
        };
        let state = self.runs.entry(run.clone()).or_default();
        match input {
            JournalInput::Prompt(blocks) => {
                if state.prompt {
                    return Ok(Vec::new());
                }
                state.prompt = true;
                Ok(blocks
                    .iter()
                    .cloned()
                    .map(|b| SessionUpdate::UserMessageChunk(ContentChunk::new(b)))
                    .collect())
            }
            JournalInput::Sse(record) => self.event(run, record.decode()),
            JournalInput::Poll(raw) => {
                let value: serde_json::Value =
                    serde_json::from_str(raw).map_err(|e| rootcause::report!(e))?;
                let status: RunStatus = serde_json::from_value(value["status"].clone())
                    .map_err(|e| rootcause::report!(e))?;
                let text = value
                    .get("result")
                    .or_else(|| value.get("text"))
                    .and_then(|s| s.as_str())
                    .map(str::to_owned);
                let outcome = RunOutcome {
                    status: status.clone(),
                    text: text.clone(),
                };
                if !outcome.is_terminal() {
                    return Ok(Vec::new());
                }
                self.event(
                    run,
                    CursorEvent::Result {
                        run_id: run.clone(),
                        status,
                        text,
                        duration_ms: None,
                    },
                )
            }
            JournalInput::Interrupted(_) => {
                // This closes local work, but does not claim remote capture is complete.
                Ok(self.translator.close_open_calls())
            }
            JournalInput::HistoryComplete
            | JournalInput::Reconciled
            | JournalInput::PromptAccepted(_)
            | JournalInput::PromptAborted(_)
            | JournalInput::TransportError(_) => Ok(Vec::new()),
        }
    }
    fn event(
        &mut self,
        run: &CursorRunId,
        event: CursorEvent,
    ) -> Result<Vec<SessionUpdate>, rootcause::Report> {
        let state = self.runs.entry(run.clone()).or_default();
        match event {
            CursorEvent::Interaction(InteractionUpdate::Other { kind })
                if kind == "step-started" =>
            {
                // Cursor's final result contains the final step, not earlier
                // commentary emitted before tool execution in the same run.
                state.text.clear();
                Ok(Vec::new())
            }
            CursorEvent::Interaction(InteractionUpdate::UserMessage { text }) => {
                if state.prompt {
                    return Ok(Vec::new());
                }
                state.prompt = true;
                Ok(vec![SessionUpdate::UserMessageChunk(ContentChunk::new(
                    ContentBlock::Text(TextContent::new(text)),
                ))])
            }
            CursorEvent::Assistant { text } => {
                state.text.push_str(&text);
                Ok(self.translator.push(CursorEvent::Assistant { text }))
            }
            CursorEvent::Result { status, text, .. } => {
                if !matches!(
                    status,
                    RunStatus::Finished | RunStatus::Cancelled | RunStatus::Error
                ) {
                    return Err(rootcause::report!("nonterminal Cursor result for {run}"));
                }
                let mut updates = Vec::new();
                if let Some(text) = text {
                    // Polling can overlap an interrupted stream. Only append the
                    // missing suffix; divergent answers cannot safely be guessed.
                    if let Some(suffix) = text.strip_prefix(&state.text) {
                        if !suffix.is_empty() {
                            updates.extend(self.translator.push(CursorEvent::Assistant {
                                text: suffix.to_owned(),
                            }));
                        }
                        state.text = text;
                    } else if !state.text.is_empty() {
                        return Err(rootcause::report!(
                            "Cursor final text diverged from the captured stream for {run}"
                        ));
                    }
                }
                state.terminal = Some(status);
                updates.extend(self.translator.close_open_calls());
                Ok(updates)
            }
            event => Ok(self.translator.push(event)),
        }
    }
}

#[cfg(test)]
mod test;
