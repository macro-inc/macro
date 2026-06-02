//! Duplicate judge adapters.

use agent::structured_output::{DynamicSchema, dynamic_structured_completion};
use agent::{AgentModel, Message};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::domain::models::JudgeResult;
use crate::domain::ports::TaskDuplicateJudge;

/// Judge that decides duplicates via the agent structured completion path.
///
/// When the model call fails it defaults to *not* a duplicate, so an outage
/// can't fabricate matches.
pub struct AgentDuplicateJudge {
    model: AgentModel,
}

#[derive(Debug, Deserialize, Serialize)]
struct DuplicateJudgeOutput {
    is_duplicate: bool,
    reason: String,
}

impl AgentDuplicateJudge {
    /// Creates a new judge using the fast agent model.
    pub fn new() -> Self {
        Self {
            model: AgentModel::Fast,
        }
    }

    /// Creates a new judge with an explicit agent model.
    pub fn with_model(model: AgentModel) -> Self {
        Self { model }
    }

    fn unavailable(&self, reason: &str) -> JudgeResult {
        JudgeResult {
            is_duplicate: false,
            model: Some(self.model.to_string()),
            reason: Some(reason.to_string()),
        }
    }
}

impl Default for AgentDuplicateJudge {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl TaskDuplicateJudge for AgentDuplicateJudge {
    async fn judge(&self, left: &str, right: &str) -> JudgeResult {
        let model_name = self.model.to_string();
        let prompt = format!("Task A:\n{left}\n\nTask B:\n{right}");
        let schema = DynamicSchema {
            name: "TaskDuplicateJudgeOutput".to_string(),
            description: Some(
                "Judgement for whether two task descriptions represent the same work.".to_string(),
            ),
            schema: json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["is_duplicate", "reason"],
                "properties": {
                    "is_duplicate": {
                        "type": "boolean",
                        "description": "True only if completing one task would substantially complete the other."
                    },
                    "reason": {
                        "type": "string",
                        "description": "A concise reason for the judgement."
                    }
                }
            }),
        };

        let value = dynamic_structured_completion(
            self.model,
            "You judge duplicate software/product tasks. Two tasks are duplicates only when completing one would substantially complete the other. Return false for merely related work, shared projects, or same feature area with different deliverables.",
            vec![Message::user(prompt)],
            schema,
        )
        .await;

        let Ok(value) = value else {
            return self.unavailable("judge request failed; treated as not duplicate");
        };

        match serde_json::from_value::<DuplicateJudgeOutput>(value) {
            Ok(parsed) => JudgeResult {
                is_duplicate: parsed.is_duplicate,
                model: Some(model_name),
                reason: Some(parsed.reason),
            },
            Err(_) => self.unavailable("judge JSON parse failed; treated as not duplicate"),
        }
    }
}

/// Deterministic judge for tests: treats two tasks as duplicates when their
/// texts contain the same set of word tokens, ignoring order and case. Order
/// independence matters because a candidate's text is reconstructed by joining
/// its embedded fields, whose order is not guaranteed.
pub struct LocalDuplicateJudge;

/// Lowercased word tokens of `text`, sorted, for order-insensitive comparison.
fn token_bag(text: &str) -> Vec<String> {
    let mut tokens = text
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(str::to_lowercase)
        .collect::<Vec<_>>();
    tokens.sort();
    tokens
}

impl LocalDuplicateJudge {
    /// Creates a local judge.
    pub fn new() -> Self {
        Self
    }
}

impl Default for LocalDuplicateJudge {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl TaskDuplicateJudge for LocalDuplicateJudge {
    async fn judge(&self, left: &str, right: &str) -> JudgeResult {
        JudgeResult {
            is_duplicate: token_bag(left) == token_bag(right),
            model: None,
            reason: Some("local token-bag judge".to_string()),
        }
    }
}
