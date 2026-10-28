//! Ordered native inputs and the shared live/replay conversation reducer.
use super::cloud::{CloudEvent, NativeRecord, TaskSnapshot, TurnId};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// A durable input captured before decoding or projecting provider output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum JournalInput {
    /// Marks a complete history beginning, including an empty new conversation.
    HistoryComplete,
    /// Original supported user text, before attempting a provider write.
    Prompt(Vec<agent_client_protocol::schema::v1::ContentBlock>),
    /// Accepted submission identity, recorded before clearing uncertain-write state.
    PromptAccepted {
        /// The remote conversation.
        task: String,
        /// The accepted assistant turn, if the provider returned it.
        turn: Option<String>,
    },
    /// Original complete SSE frame, including unknown provider payloads.
    Native(NativeRecord),
    /// Provider observation used to reconcile final output and determine status.
    Poll {
        /// Snapshot interpreted by this adapter version.
        snapshot: TaskSnapshot,
        /// Exact provider response, including unknown fields.
        native: Option<String>,
    },
    /// Changed task metadata captured without adding conversation output.
    Metadata {
        /// Provider projection, used only when native data is absent in a fixture.
        snapshot: TaskSnapshot,
        /// Exact provider response preserved before metadata publication.
        native: Option<String>,
    },
    /// Stream failure or EOF, retained without inventing a terminal outcome.
    TransportError(String),
    /// An attachment began observing an already accepted turn.
    RecoveryStarted,
    /// User requested cancellation before the provider side effect.
    CancellationRequested,
    /// Submission returned an error; its remote outcome remains uncertain.
    SubmissionError(String),
    /// Verified provider terminal state after reconciliation.
    Terminal(String),
}
/// One append-only input with a fenced sequence number.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalEntry {
    /// One-based strictly increasing position within this session.
    pub sequence: i64,
    /// Provider assistant turn associated with the input, when known.
    pub turn: Option<TurnId>,
    /// Native input consumed by the reducer.
    pub input: JournalInput,
}
/// Deterministic reduction shared by live delivery and session/load replay.
#[derive(Default)]
pub struct ReplayMachine {
    sequence: i64,
    failed: bool,
    terminal: bool,
    pending_terminal: Option<String>,
    seen: HashSet<String>,
    events: Vec<CloudEvent>,
    unclaimed_fallback: String,
    poll: Option<TaskSnapshot>,
    accepted: Vec<(String, String)>,
    pull_requests: std::collections::HashMap<String, Vec<super::cloud::ExternalPullRequest>>,
}
impl ReplayMachine {
    pub(crate) fn accepted(&self, task: &str) -> Vec<String> {
        self.accepted
            .iter()
            .filter(|(id, _)| id == task)
            .map(|(_, turn)| turn.clone())
            .collect()
    }
    pub(crate) fn pull_requests(&self, task: &str) -> Vec<super::cloud::ExternalPullRequest> {
        self.pull_requests.get(task).cloned().unwrap_or_default()
    }
    fn remember_metadata(&mut self, snapshot: &TaskSnapshot) {
        let entries = self
            .pull_requests
            .entry(snapshot.task_id.as_str().into())
            .or_default();
        // Reverse each observation so a reverse search sees its first valid
        // provider entry, before any older observation of the same turn.
        entries.extend(snapshot.pull_requests.iter().rev().cloned());
    }
    /// Last successfully consumed journal sequence.
    pub fn sequence(&self) -> i64 {
        self.sequence
    }
    pub(crate) fn ensure_appendable(&self, input: &JournalInput) -> Result<(), rootcause::Report> {
        if self.failed && !matches!(input, JournalInput::CancellationRequested) {
            return Err(rootcause::report!(
                "native journal cannot be replayed; observation stopped"
            ));
        }
        Ok(())
    }
    /// Validate ordering and reduce exactly one persisted input.
    pub fn push(&mut self, entry: &JournalEntry) -> Result<Vec<CloudEvent>, rootcause::Report> {
        if self.failed
            && matches!(entry.input, JournalInput::CancellationRequested)
            && entry.sequence == self.sequence + 1
        {
            // A malformed provider record must never disable an explicit remote stop.
            self.sequence = entry.sequence;
            return Ok(Vec::new());
        }
        if self.failed {
            return Err(rootcause::report!(
                "native journal cannot be replayed; observation stopped"
            ));
        }
        let result = self.reduce(entry);
        if result.is_err() {
            self.failed = true;
        }
        result
    }
    /// Finish a replay boundary after all captured records for its last turn.
    /// Deferring lifecycle output allows late recovered records to remain in that turn.
    pub fn finish(&mut self) -> Vec<CloudEvent> {
        let Some(status) = self.pending_terminal.clone() else {
            return Vec::new();
        };
        let mut output = if status == "completed" {
            self.reconcile_final()
        } else {
            Vec::new()
        };
        if !self.terminal {
            self.terminal = true;
            output.push(CloudEvent {
                id: String::new(),
                method: "session/turn_complete".into(),
                params: serde_json::json!({"status":status}),
            });
        }
        output
    }
    fn reconcile_final(&mut self) -> Vec<CloudEvent> {
        let mut output = Vec::new();
        if let Some(snapshot) = &self.poll {
            // SSE delivery can omit earlier deltas and insert them on replay. Only
            // completed messages and final poll text are authoritative for display.
            let mut represented = String::new();
            for event in &self.events {
                if event.method == "item/completed"
                    && event.params["item"]["type"].as_str() == Some("agentMessage")
                    && let Some(text) = event.params["item"]["text"].as_str()
                {
                    represented.push_str(text);
                }
            }
            for (index, text) in snapshot
                .turns
                .iter()
                .filter(|turn| turn.source == "current_assistant_turn")
                .flat_map(|turn| &turn.messages)
                .enumerate()
            {
                if !text.is_empty()
                    && let Some(start) = represented.find(text)
                {
                    // A native completed item may contain several poll message
                    // fragments. Consume exact bytes so repeated messages still
                    // require a separate represented occurrence.
                    represented.replace_range(start..start + text.len(), "");
                    continue;
                }
                output.push(CloudEvent {
                    id: String::new(),
                    method: "item/completed".into(),
                    params: serde_json::json!({"item":{
                        "id":format!("poll-message:{index}"),
                        "type":"agentMessage",
                        "text":text,
                    }}),
                });
            }
            for event in &output {
                if let Some(text) = event.params["item"]["text"].as_str() {
                    self.unclaimed_fallback.push_str(text);
                }
            }
            self.events.extend(output.iter().cloned());
            self.poll = None;
        }
        output
    }
    fn reduce(&mut self, entry: &JournalEntry) -> Result<Vec<CloudEvent>, rootcause::Report> {
        if entry.sequence != self.sequence + 1 {
            return Err(rootcause::report!("native journal sequence is incomplete"));
        }
        if self.sequence == 0 && !matches!(entry.input, JournalInput::HistoryComplete) {
            return Err(rootcause::report!(
                "native journal has no complete history boundary"
            ));
        }
        self.sequence = entry.sequence;
        let mut output = Vec::new();
        match &entry.input {
            JournalInput::PromptAccepted {
                task,
                turn: Some(turn),
            } => {
                self.accepted.push((task.clone(), turn.clone()));
            }
            JournalInput::Metadata { snapshot, native } => {
                let snapshot = match native {
                    Some(native) => TaskSnapshot::from_native(&snapshot.task_id, native)?,
                    None => snapshot.clone(),
                };
                self.remember_metadata(&snapshot);
            }
            JournalInput::Prompt(blocks) => {
                output.extend(self.finish());
                self.pending_terminal = None;
                let text = blocks
                    .iter()
                    .filter_map(|block| match block {
                        agent_client_protocol::schema::v1::ContentBlock::Text(text) => {
                            Some(text.text.as_str())
                        }
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                self.events.clear();
                self.unclaimed_fallback.clear();
                self.terminal = false;
                self.poll = None;
                output.push(CloudEvent {
                    id: String::new(),
                    method: "user/message".into(),
                    params: serde_json::json!({"text":text}),
                });
            }
            JournalInput::Native(record) => {
                // Keep every raw record in storage; repeated provider IDs only suppress projection.
                if let Some(event) = record.decode()? {
                    let identity = if event.id.is_empty() {
                        record.id.as_deref()
                    } else {
                        Some(event.id.as_str())
                    };
                    let key = identity.map(|id| {
                        format!(
                            "{}:{id}",
                            entry.turn.as_ref().map(TurnId::as_str).unwrap_or_default()
                        )
                    });
                    if key.is_some_and(|key| !self.seen.insert(key)) {
                        return Ok(output);
                    }
                    if event.method == "item/agentMessage/delta" {
                        // Persisted fragments remain available for diagnosis, but their
                        // arrival order is not a reliable order for visible text.
                        return Ok(output);
                    }
                    if event.method == "item/completed"
                        && event.params["item"]["type"].as_str() == Some("agentMessage")
                        && let Some(text) = event.params["item"]["text"].as_str()
                        && !text.is_empty()
                        && let Some(start) = self.unclaimed_fallback.find(text)
                    {
                        // Claim each fallback occurrence only once: a distinct
                        // later message is allowed to repeat the same text.
                        self.unclaimed_fallback
                            .replace_range(start..start + text.len(), "");
                        return Ok(output);
                    }
                    self.events.push(event.clone());
                    output.push(event);
                }
            }
            JournalInput::Poll { snapshot, native } => {
                let snapshot = match native {
                    Some(native) => TaskSnapshot::from_native(&snapshot.task_id, native)?,
                    None => snapshot.clone(),
                };
                self.remember_metadata(&snapshot);
                // A preflight task read can discover a web-side continuation. Retain
                // that fact without attributing its output to our pinned assistant turn.
                if let Some(expected) = &entry.turn
                    && let Some(actual) = snapshot
                        .turns
                        .iter()
                        .find(|turn| turn.source == "current_assistant_turn")
                        .and_then(|turn| turn.id.as_deref())
                    && actual != expected.as_str()
                {
                    return Ok(output);
                }
                self.poll = Some(snapshot);
            }
            _ => {}
        }
        if let JournalInput::Terminal(status) = &entry.input {
            self.pending_terminal = Some(status.clone());
        }
        Ok(output)
    }
}

#[cfg(test)]
mod test;
