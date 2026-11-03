//! Relevance ("Jev"): decide whether a message deserves waking the agent.
//!
//! The agent owns a JSON file of yes/no questions, a threshold, and a wake
//! rule, and tunes it over time:
//!
//! ```json
//! {
//!   "threshold": 0.6,
//!   "questions": {
//!     "addressed_to_me": "Is this addressed to Ada by name or @mention, and does it want something from her?",
//!     "about_my_job": "Is this about invoices, payments, or vendor bills?",
//!     "needs_response": "Does this ask a question or make a request someone should answer?"
//!   },
//!   "wakeIf": [["addressed_to_me"], ["about_my_job", "needs_response"]]
//! }
//! ```
//!
//! A message is relevant when ANY `wakeIf` group has ALL its questions at or
//! above the threshold. The file is re-read on every call, so edits apply to
//! the next message without a restart. Direct @mentions and direct messages
//! skip the model call (see [`FastPaths`]).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::client::{DecideRequest, MacroClient};
use crate::error::{Error, Result};
use crate::memory::{MessageRecord, append_jsonl, write_atomic};

#[cfg(test)]
mod test;

/// Most questions one decision may ask.
pub const MAX_QUESTIONS: usize = 32;
/// Longest question, in characters.
pub const MAX_QUESTION_CHARS: usize = 500;
/// Longest question key, in bytes.
pub const MAX_KEY_BYTES: usize = 80;
/// Largest decision request body, in bytes.
pub const MAX_BODY_BYTES: usize = 64 * 1024;

/// The agent-owned relevance file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelevanceConfig {
    /// Probability at or above which a question counts as "yes".
    pub threshold: f64,
    /// Question key to yes/no question.
    pub questions: BTreeMap<String, String>,
    /// Wake if any group has all its questions at or above the threshold.
    pub wake_if: Vec<Vec<String>>,
}

impl RelevanceConfig {
    /// A reasonable first file for an agent with this name and job.
    pub fn starter(name: &str, job: &str) -> Self {
        let questions = [
            (
                "addressed_to_me",
                format!(
                    "Is this addressed to {name} by name, @mention, or a reply in a thread {name} is in, \
                     AND does it want something from {name} (a question, request, or point to answer)? \
                     Score low for bare thanks, acknowledgements, or sign-offs."
                ),
            ),
            ("about_my_job", format!("Is this message about {name}'s job: {job}?")),
            (
                "needs_response",
                "Does this message ask a question, report a problem, or make a request that someone should answer or act on?"
                    .to_owned(),
            ),
        ];
        Self {
            threshold: 0.6,
            questions: questions
                .into_iter()
                .map(|(k, q)| (k.to_owned(), q.chars().take(MAX_QUESTION_CHARS).collect()))
                .collect(),
            wake_if: vec![
                vec!["addressed_to_me".to_owned()],
                vec!["about_my_job".to_owned(), "needs_response".to_owned()],
            ],
        }
    }

    /// Check the limits Macro's decide endpoint enforces, and that the wake
    /// rule only names known questions.
    pub fn validate(&self) -> Result<()> {
        let fail = |msg: String| Err(Error::Relevance(msg));
        if !(0.0..=1.0).contains(&self.threshold) {
            return fail(format!("threshold {} is not within 0..=1", self.threshold));
        }
        if self.questions.is_empty() || self.questions.len() > MAX_QUESTIONS {
            return fail(format!(
                "needs 1 to {MAX_QUESTIONS} questions, has {}",
                self.questions.len()
            ));
        }
        for (key, question) in &self.questions {
            if key.is_empty() || key.len() > MAX_KEY_BYTES {
                return fail(format!(
                    "question key {key:?} must be 1 to {MAX_KEY_BYTES} bytes"
                ));
            }
            let chars = question.chars().count();
            if question.trim().is_empty() || chars > MAX_QUESTION_CHARS {
                return fail(format!(
                    "question {key:?} must be 1 to {MAX_QUESTION_CHARS} characters, has {chars}"
                ));
            }
        }
        if self.wake_if.is_empty() {
            return fail("wakeIf needs at least one group".to_owned());
        }
        for group in &self.wake_if {
            if group.is_empty() {
                return fail("wakeIf has an empty group".to_owned());
            }
            if let Some(unknown) = group.iter().find(|k| !self.questions.contains_key(*k)) {
                return fail(format!("wakeIf names unknown question {unknown:?}"));
            }
        }
        Ok(())
    }

    /// Whether these probabilities satisfy the wake rule. Missing keys
    /// count as 0.
    pub fn is_relevant(&self, probabilities: &BTreeMap<String, f64>) -> bool {
        self.wake_if.iter().any(|group| {
            group
                .iter()
                .all(|key| probabilities.get(key).copied().unwrap_or(0.0) >= self.threshold)
        })
    }

    /// Read and validate the file.
    pub async fn load(path: &Path) -> Result<Self> {
        let text = tokio::fs::read_to_string(path)
            .await
            .map_err(|e| Error::io("read", path, e))?;
        let config: Self =
            serde_json::from_str(&text).map_err(|e| Error::json(path.display().to_string(), e))?;
        config.validate()?;
        Ok(config)
    }

    /// Validate and write the file (pretty-printed, atomically).
    pub async fn save(&self, path: &Path) -> Result<()> {
        self.validate()?;
        let mut text = serde_json::to_string_pretty(self)
            .map_err(|e| Error::json("the relevance config", e))?;
        text.push('\n');
        if let Some(dir) = path.parent() {
            tokio::fs::create_dir_all(dir)
                .await
                .map_err(|e| Error::io("create", dir, e))?;
        }
        write_atomic(path, text.as_bytes()).await
    }
}

/// Cases decided without asking the model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FastPaths {
    /// An explicit @mention of the agent is relevant.
    pub mention: bool,
    /// Every message in a direct message is relevant.
    pub direct_message: bool,
}

impl Default for FastPaths {
    fn default() -> Self {
        Self {
            mention: true,
            direct_message: true,
        }
    }
}

/// Why a [`Decision`] came out the way it did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    /// The message @mentions the agent.
    Mentioned,
    /// The message is in a direct message.
    DirectMessage,
    /// The model answered the questions.
    Decided,
}

/// The outcome of [`Relevance::judge`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Decision {
    /// Whether to wake the agent.
    pub relevant: bool,
    /// Why.
    pub reason: Reason,
    /// The model's probabilities (empty on a fast path).
    pub probabilities: BTreeMap<String, f64>,
}

/// What to judge: a message plus the context the model sees.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    /// The message id, for the decision log.
    pub message_id: String,
    /// Whether it @mentions the agent.
    pub mentions_me: bool,
    /// Whether it is in a direct message.
    pub direct_message: bool,
    /// The decide input: `{channel, recent_messages, new_message}` or
    /// anything else useful to the questions.
    pub input: Value,
}

impl Candidate {
    /// Judge `message` with `recent` messages of its conversation as context.
    pub fn from_record(message: &MessageRecord, recent: &[MessageRecord]) -> Self {
        let strip = |m: &MessageRecord| json!({ "id": m.id, "from": m.sender_id, "at": m.at, "text": m.text, "thread": m.thread });
        Self {
            message_id: message.id.clone(),
            mentions_me: message.mentions_me,
            direct_message: message.dm,
            input: json!({
                "channel": message.channel,
                "direct_message": message.dm,
                "recent_messages": recent.iter().map(strip).collect::<Vec<_>>(),
                "new_message": strip(message),
            }),
        }
    }
}

/// Judges messages against the agent's relevance file.
#[derive(Debug, Clone)]
pub struct Relevance {
    client: MacroClient,
    config_path: PathBuf,
    decisions_log: Option<PathBuf>,
    fast_paths: FastPaths,
}

impl Relevance {
    /// Judge with the relevance file at `config_path`.
    pub fn new(client: MacroClient, config_path: impl Into<PathBuf>) -> Self {
        Self {
            client,
            config_path: config_path.into(),
            decisions_log: None,
            fast_paths: FastPaths::default(),
        }
    }

    /// Append every decision to this JSONL file (ids and scores, no content).
    pub fn log_to(mut self, path: impl Into<PathBuf>) -> Self {
        self.decisions_log = Some(path.into());
        self
    }

    /// Change which cases skip the model.
    pub fn fast_paths(mut self, fast_paths: FastPaths) -> Self {
        self.fast_paths = fast_paths;
        self
    }

    /// Decide whether `candidate` should wake the agent.
    #[tracing::instrument(skip_all, fields(message_id = %candidate.message_id, relevant), err)]
    pub async fn judge(&self, candidate: &Candidate) -> Result<Decision> {
        let decision = if self.fast_paths.mention && candidate.mentions_me {
            fast(Reason::Mentioned)
        } else if self.fast_paths.direct_message && candidate.direct_message {
            fast(Reason::DirectMessage)
        } else {
            let config = RelevanceConfig::load(&self.config_path).await?;
            let request = fit_body(DecideRequest {
                input: candidate.input.clone(),
                questions: config.questions.clone(),
            })?;
            let probabilities = self.client.decide(&request).await?.probabilities;
            Decision {
                relevant: config.is_relevant(&probabilities),
                reason: Reason::Decided,
                probabilities,
            }
        };
        tracing::Span::current().record("relevant", decision.relevant);
        if let Some(log) = &self.decisions_log {
            let line = json!({
                "at": Utc::now(),
                "message_id": candidate.message_id,
                "relevant": decision.relevant,
                "reason": decision.reason,
                "p": decision.probabilities,
            });
            append_jsonl(log, &line)
                .await
                .inspect_err(|e| tracing::warn!(error = %e, "could not log the decision"))
                .ok();
        }
        Ok(decision)
    }
}

fn fast(reason: Reason) -> Decision {
    Decision {
        relevant: true,
        reason,
        probabilities: BTreeMap::new(),
    }
}

/// Drop the oldest `recent_messages` until the body fits the size limit.
pub(crate) fn fit_body(mut request: DecideRequest) -> Result<DecideRequest> {
    loop {
        let size = serde_json::to_vec(&request)
            .map_err(|e| Error::json("the decision request", e))?
            .len();
        if size <= MAX_BODY_BYTES {
            return Ok(request);
        }
        let dropped = request
            .input
            .get_mut("recent_messages")
            .and_then(Value::as_array_mut)
            .filter(|recent| !recent.is_empty())
            .map(|recent| recent.remove(0))
            .is_some();
        if !dropped {
            return Err(Error::Relevance(format!(
                "the decision request is {size} bytes, over the {MAX_BODY_BYTES} byte limit"
            )));
        }
    }
}
