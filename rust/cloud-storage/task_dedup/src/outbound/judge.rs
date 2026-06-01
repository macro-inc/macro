//! Duplicate judge adapters.

use agent::structured_output::{DynamicSchema, dynamic_structured_completion};
use agent::{AgentModel, Message};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::domain::models::JudgeResult;
use crate::domain::ports::TaskDuplicateJudge;

/// Judge that uses the agent structured completion path and falls back to
/// deterministic rerank thresholds otherwise.
pub struct AgentDuplicateJudge {
    fallback_threshold: f64,
    model: AgentModel,
}

#[derive(Debug, Deserialize, Serialize)]
struct DuplicateJudgeOutput {
    is_duplicate: bool,
    reason: String,
}

impl AgentDuplicateJudge {
    /// Creates a new judge.
    pub fn new(fallback_threshold: f64) -> Self {
        Self {
            fallback_threshold,
            model: AgentModel::Fast,
        }
    }

    /// Creates a new judge with an explicit agent model.
    pub fn with_model(fallback_threshold: f64, model: AgentModel) -> Self {
        Self {
            fallback_threshold,
            model,
        }
    }

    fn fallback(&self, rerank_score: f64, model: Option<String>, reason: &str) -> JudgeResult {
        JudgeResult {
            is_duplicate: rerank_score >= self.fallback_threshold,
            model,
            reason: Some(reason.to_string()),
        }
    }
}

#[async_trait]
impl TaskDuplicateJudge for AgentDuplicateJudge {
    async fn judge(&self, left: &str, right: &str, rerank_score: f64) -> JudgeResult {
        let model_name = self.model.to_string();
        let prompt =
            format!("Task A:\n{left}\n\nTask B:\n{right}\n\nRerank score: {rerank_score:.3}");
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
            return self.fallback(
                rerank_score,
                Some(model_name),
                "judge request failed; local rerank fallback",
            );
        };

        match serde_json::from_value::<DuplicateJudgeOutput>(value) {
            Ok(parsed) => JudgeResult {
                is_duplicate: parsed.is_duplicate,
                model: Some(model_name),
                reason: Some(parsed.reason),
            },
            Err(_) => self.fallback(
                rerank_score,
                Some(model_name),
                "judge JSON parse failed; local rerank fallback",
            ),
        }
    }
}

/// Local judge for tests.
pub struct LocalDuplicateJudge {
    threshold: f64,
}

impl LocalDuplicateJudge {
    /// Creates a local threshold judge.
    pub fn new(threshold: f64) -> Self {
        Self { threshold }
    }
}

#[async_trait]
impl TaskDuplicateJudge for LocalDuplicateJudge {
    async fn judge(&self, _left: &str, _right: &str, rerank_score: f64) -> JudgeResult {
        JudgeResult {
            is_duplicate: rerank_score >= self.threshold,
            model: None,
            reason: Some("local rerank fallback".to_string()),
        }
    }
}
