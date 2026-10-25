//! The decision model: what to do with each object in scope, decided in
//! batches so a large workspace costs a handful of calls.

use std::collections::HashMap;

use agent::Message;
use agent::structured_output::{DynamicSchema, dynamic_structured_completion};
use futures::{FutureExt, Stream, StreamExt, stream};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::domain::models::{ImportKind, NotionDecision, NotionSharing, NotionTaskFields};

#[cfg(test)]
mod test;

/// Objects per decision-model call.
pub(super) const TRIAGE_BATCH: usize = 40;
/// Decision-model calls in flight at once.
pub(super) const TRIAGE_CONCURRENCY: usize = 4;

/// One object, as the decision model sees it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TriageItem {
    /// The object's Notion id; the model answers by it.
    pub key: String,
    /// `page` or `data_source`.
    pub kind: ImportKind,
    /// The title.
    pub title: String,
    /// Titles of the pages above it, outermost first.
    pub path: Vec<String>,
    /// How many planned objects sit directly under it.
    pub children: usize,
    /// For a data source: its columns and rows.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table: Option<TriageTable>,
}

/// What the decision model sees of a data source.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TriageTable {
    /// Column names with their Notion types, such as `Status (status)`.
    pub columns: Vec<String>,
    /// Rows counted.
    pub rows: usize,
    /// The first few row titles.
    pub sample_titles: Vec<String>,
}

/// The decision model's answer for one object.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Verdict {
    /// The object's key, echoed back.
    pub key: String,
    /// What to do with it.
    pub decision: NotionDecision,
    /// Why, in a short sentence.
    #[serde(default)]
    pub reason: Option<String>,
    /// For a task list: which columns hold the task fields.
    #[serde(default)]
    pub task_fields: Option<NotionTaskFields>,
    /// Whether to share it with the user's team; asked only when the user
    /// left sharing to the model.
    #[serde(default)]
    pub shared: Option<bool>,
    /// Why, in a short sentence.
    #[serde(default)]
    pub shared_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TriageOutput {
    verdicts: Vec<Verdict>,
}

pub(super) const TRIAGE_SYSTEM: &str = include_str!("triage_system.md");
/// Added to [`TRIAGE_SYSTEM`] when the model also decides sharing.
pub(super) const TRIAGE_SHARING: &str = include_str!("triage_sharing.md");

/// The system prompt: sharing is the model's to decide only when the user
/// left it to the model.
pub(super) fn triage_system(sharing: NotionSharing) -> String {
    match sharing {
        NotionSharing::Ai => format!("{TRIAGE_SYSTEM}\n{TRIAGE_SHARING}"),
        NotionSharing::Team | NotionSharing::Personal => TRIAGE_SYSTEM.to_string(),
    }
}

/// The schema every decision-model answer is validated against; with
/// sharing left to the model, every verdict also says whether to share.
pub(super) fn triage_schema(sharing: NotionSharing) -> DynamicSchema {
    let mut schema = verdicts_schema();
    if sharing == NotionSharing::Ai {
        let verdict = &mut schema["properties"]["verdicts"]["items"];
        verdict["required"] = json!(["key", "decision", "shared", "sharedReason"]);
        verdict["properties"]["shared"] = json!({ "type": "boolean" });
        verdict["properties"]["sharedReason"] = json!({ "type": "string", "maxLength": 200 });
    }
    DynamicSchema {
        name: "NotionImportVerdicts".to_string(),
        description: Some("What to do with each Notion object in an import.".to_string()),
        schema,
    }
}

fn verdicts_schema() -> serde_json::Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["verdicts"],
        "properties": {
            "verdicts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["key", "decision"],
                    "properties": {
                        "key": { "type": "string" },
                        "decision": { "type": "string", "enum": ["copy", "tasks", "skip", "hand"] },
                        "reason": { "type": "string", "maxLength": 200 },
                        "taskFields": {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                                "status": { "type": "string" },
                                "priority": { "type": "string" },
                                "due": { "type": "string" },
                                "assignee": { "type": "string" }
                            }
                        }
                    }
                }
            }
        }
    })
}

/// The verdict an object gets when the decision model gave none: bring it
/// over as it is, which loses nothing.
pub(super) fn default_verdict(item: &TriageItem, reason: &str) -> Verdict {
    Verdict {
        key: item.key.clone(),
        decision: NotionDecision::Copy,
        reason: Some(reason.to_string()),
        task_fields: None,
        shared: None,
        shared_reason: None,
    }
}

/// Decide every item, `TRIAGE_BATCH` at a time, yielding each batch's
/// verdicts as it is answered so planning can stage them straight away. A
/// batch the model fails on (or answers badly) falls back to
/// [`default_verdict`] for its items, so planning never fails because the
/// model did.
pub(super) fn decide<'a, Admit, AdmitFuture>(
    items: &'a [TriageItem],
    sharing: NotionSharing,
    admit: Admit,
    recorder: &'a dyn ai_usage::UsageRecorder,
    usage: ai_usage::UsageContext,
    model: agent::PredefinedModel,
) -> impl Stream<Item = HashMap<String, Verdict>> + Send + 'a
where
    Admit: Fn() -> AdmitFuture + Send + Sync + 'a,
    AdmitFuture: Future<Output = anyhow::Result<()>> + Send + 'a,
{
    stream::iter(items.chunks(TRIAGE_BATCH))
        .map(move |batch| {
            let admitted = admit();
            let usage = usage.clone();
            async move {
                let outcome = match admitted.await {
                    Ok(()) => decide_batch(batch, sharing, recorder, usage, model).await,
                    Err(error) => Err(error),
                };
                match outcome {
                    Ok(verdicts) => fill_missing(batch, verdicts),
                    Err(error) => {
                        tracing::warn!(error = ?error, items = batch.len(), "notion triage batch failed; copying its objects as they are");
                        batch
                            .iter()
                            .map(|item| {
                                (item.key.clone(), default_verdict(item, "Planned without the decision model"))
                            })
                            .collect()
                    }
                }
            }
            .boxed()
        })
        .buffer_unordered(TRIAGE_CONCURRENCY)
}

async fn decide_batch(
    batch: &[TriageItem],
    sharing: NotionSharing,
    recorder: &dyn ai_usage::UsageRecorder,
    usage: ai_usage::UsageContext,
    model: agent::PredefinedModel,
) -> anyhow::Result<Vec<Verdict>> {
    let prompt = format!(
        "Decide what to do with each of these {} Notion objects.\n\n```json\n{}\n```",
        batch.len(),
        serde_json::to_string_pretty(batch)?
    );
    let value = dynamic_structured_completion(
        model,
        &triage_system(sharing),
        vec![Message::user(prompt)],
        triage_schema(sharing),
        recorder,
        usage,
    )
    .await?;
    let output: TriageOutput = serde_json::from_value(value)
        .map_err(|error| anyhow::anyhow!("notion triage returned malformed output: {error}"))?;
    Ok(output.verdicts)
}

/// Keep verdicts for keys in the batch, apply rules the model cannot
/// override, and give anything the model skipped the default.
pub(super) fn fill_missing(
    batch: &[TriageItem],
    verdicts: Vec<Verdict>,
) -> HashMap<String, Verdict> {
    let mut by_key: HashMap<String, Verdict> = verdicts
        .into_iter()
        .filter(|verdict| batch.iter().any(|item| item.key == verdict.key))
        .map(|verdict| (verdict.key.clone(), verdict))
        .collect();
    for item in batch {
        let verdict = by_key
            .entry(item.key.clone())
            .or_insert_with(|| default_verdict(item, "The decision model gave no answer"));
        // Only a data source can become tasks.
        if verdict.decision == NotionDecision::Tasks && item.table.is_none() {
            verdict.decision = NotionDecision::Copy;
            verdict.task_fields = None;
        }
        if verdict.decision != NotionDecision::Tasks {
            verdict.task_fields = None;
        }
    }
    by_key
}
