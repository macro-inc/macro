//! Test doubles shared by this crate's tests.

use agent::{AgentError, StreamPart};
use tokio::sync::mpsc;

use crate::domain::engine::{TurnEngine, TurnRequest};

/// An engine that plays back a script of parts for every turn.
pub(crate) struct ScriptedEngine {
    script: Vec<StreamPart>,
    /// One entry per turn the engine has been asked to run.
    requests: std::sync::Mutex<Vec<RecordedTurn>>,
}

/// What one turn asked of the engine, as far as tests care.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RecordedTurn {
    /// Model the turn was to run on.
    pub(crate) model: String,
    /// The conversation, flattened to text per message.
    pub(crate) messages: Vec<String>,
    /// The session's instructions, as handed to the engine.
    pub(crate) instructions: Option<String>,
}

impl ScriptedEngine {
    pub(crate) fn new(script: Vec<StreamPart>) -> Self {
        Self {
            script,
            requests: std::sync::Mutex::new(Vec::new()),
        }
    }

    pub(crate) fn requests(&self) -> Vec<RecordedTurn> {
        self.requests.lock().expect("requests lock").clone()
    }
}

impl TurnEngine for ScriptedEngine {
    fn run_turn(&self, request: TurnRequest) -> mpsc::Receiver<Result<StreamPart, AgentError>> {
        self.requests
            .lock()
            .expect("requests lock")
            .push(RecordedTurn {
                model: request.model.clone(),
                messages: request
                    .messages
                    .iter()
                    .map(|message| message.content.message_text_with_tools())
                    .collect(),
                instructions: request.instructions.clone(),
            });
        let (parts, receiver) = mpsc::channel(64);
        let script = self.script.clone();
        tokio::spawn(async move {
            for part in script {
                if parts.send(Ok(part)).await.is_err() {
                    break;
                }
            }
        });
        receiver
    }
}

/// An engine that never produces anything until cancelled.
pub(crate) struct HangingEngine;

impl TurnEngine for HangingEngine {
    fn run_turn(&self, request: TurnRequest) -> mpsc::Receiver<Result<StreamPart, AgentError>> {
        let (parts, receiver) = mpsc::channel(1);
        tokio::spawn(async move {
            request.cancel.cancelled().await;
            drop(parts);
        });
        receiver
    }
}
