//! Nemotron-backed activity summaries: the live status line over a running
//! session's tool calls.
//!
//! A failed or rate-limited call degrades to no line: viewers keep the label
//! their client derives from the fold itself, and the next call retries.

use crate::domain::activity_summary::{ActivityDigest, ActivitySummarizer};
use agent::{Message, complete_with_history_and_params};
use ai_usage::{UsageContext, UsageRecorder};
use std::sync::Arc;

/// Fast and cheap; already serving Command K's extraction.
const ACTIVITY_SUMMARY_MODEL: &str = "fireworks/nemotron-lightning-3p5-30b-a3b";
const ACTIVITY_SUMMARY_SYSTEM_PROMPT: &str = include_str!("activity_summarizer_prompt.md");
/// Longest line kept, in characters; the prompt asks for far less.
const MAX_SUMMARY_CHARS: usize = 60;

/// Summarizes with [`ACTIVITY_SUMMARY_MODEL`], recording usage through `recorder`.
#[derive(Clone)]
pub struct NemotronActivitySummarizer {
    recorder: Arc<dyn UsageRecorder>,
}

impl NemotronActivitySummarizer {
    /// Build a summarizer that records model usage through `recorder`.
    #[must_use]
    pub fn new(recorder: Arc<dyn UsageRecorder>) -> Self {
        Self { recorder }
    }
}

impl ActivitySummarizer for NemotronActivitySummarizer {
    #[tracing::instrument(
        name = "agent.session.activity_summary.complete",
        skip_all,
        err,
        fields(gen_ai.request.model = ACTIVITY_SUMMARY_MODEL)
    )]
    async fn summarize(
        &self,
        usage: UsageContext,
        previous: Option<&str>,
        digest: &ActivityDigest,
    ) -> Result<Option<String>, rootcause::Report> {
        let input = serde_json::json!({
            "previous": previous,
            "total_steps": digest.total_steps,
            "steps": digest.steps,
        });
        let response = complete_with_history_and_params(
            ACTIVITY_SUMMARY_MODEL,
            ACTIVITY_SUMMARY_SYSTEM_PROMPT,
            vec![Message::user(input.to_string())],
            Some(serde_json::json!({
                "reasoning_effort": "none",
                "temperature": 0,
                "max_tokens": 24,
            })),
            self.recorder.as_ref(),
            usage,
        )
        .await
        .map_err(|error| rootcause::report!("{error:#}"))?;
        Ok(clean_summary(&response))
    }
}

fn clean_summary(raw: &str) -> Option<String> {
    let line = raw.lines().find(|line| !line.trim().is_empty())?;
    let line = line.trim().trim_matches(['"', '\'']).trim();
    if line.is_empty() {
        return None;
    }

    Some(line.chars().take(MAX_SUMMARY_CHARS).collect())
}
