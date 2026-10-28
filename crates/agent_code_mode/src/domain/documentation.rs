//! Bounded SDK documentation selection through the shared cognition service.
use cognition::domain::{Cognition, DecisionRequest};
use macro_user_id::user_id::MacroUserIdStr;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;

/// Public Markdown documentation generated from the real SDK by TypeDoc.
#[derive(Clone, Deserialize, Serialize, JsonSchema)]
pub struct SdkDocumentation {
    /// SDK namespace.
    pub name: String,
    /// Compact capability summary.
    pub description: String,
    /// API reference Markdown; omitted in a compact catalog.
    pub documentation: Option<String>,
    /// TypeDoc namespace reference used when the full section exceeds the turn budget.
    #[serde(default, skip_serializing)]
    #[schemars(skip)]
    pub overview: Option<String>,
}

/// Immutable SDK documentation supplied at build time.
pub fn sdk_documentation() -> Vec<SdkDocumentation> {
    serde_json::from_str(include_str!("documentation.json"))
        .expect("generated SDK documentation is valid")
}

/// How the Jev relevance pass ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SelectionStatus {
    /// Jev ranked the catalog.
    Selected,
    /// No cognition service is configured.
    Unconfigured,
    /// The caller cancelled before Jev answered.
    Cancelled,
    /// Jev returned an error.
    ProviderError,
    /// Jev did not answer before the deadline.
    Timeout,
}

impl SelectionStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Selected => "selected",
            Self::Unconfigured => "unconfigured",
            Self::Cancelled => "cancelled",
            Self::ProviderError => "provider_error",
            Self::Timeout => "timeout",
        }
    }
}

/// Ask Jev once which entities help with `text`; most relevant first.
async fn rank_entities<'a>(
    user: &MacroUserIdStr<'static>,
    text: &str,
    docs: &'a [SdkDocumentation],
    cognition: Option<&Arc<dyn Cognition>>,
    deadline: Duration,
    cancel: &CancellationToken,
) -> (Vec<&'a SdkDocumentation>, SelectionStatus) {
    let Some(cognition) = cognition else {
        return (Vec::new(), SelectionStatus::Unconfigured);
    };
    let request = DecisionRequest {
        input: serde_json::json!({"userRequest": text.chars().take(8000).collect::<String>()}),
        questions: docs
            .iter()
            .map(|doc| {
                (
                    doc.name.clone(),
                    format!(
                        "Would documentation for SDK entity {} help fulfill this request? {}",
                        doc.name, doc.description
                    ),
                )
            })
            .collect(),
    };
    let answer = tokio::select! {
        biased;
        _ = cancel.cancelled() => return (Vec::new(), SelectionStatus::Cancelled),
        result = tokio::time::timeout(deadline, cognition.decide(user, request)) => match result {
            Ok(Ok(answer)) => answer,
            Ok(Err(_)) => return (Vec::new(), SelectionStatus::ProviderError),
            Err(_) => return (Vec::new(), SelectionStatus::Timeout),
        },
    };
    let mut ranked: Vec<_> = docs
        .iter()
        .filter_map(|doc| {
            let score = answer.probabilities.get(&doc.name).copied()?;
            (score.is_finite() && score >= 0.5).then_some((score, doc))
        })
        .collect();
    ranked.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.name.cmp(&b.1.name)));
    (
        ranked.into_iter().map(|(_, doc)| doc).collect(),
        SelectionStatus::Selected,
    )
}

/// The full reference when it fits `remaining` bytes, else the namespace overview.
fn fitting_reference(doc: &SdkDocumentation, remaining: usize) -> Option<&String> {
    [doc.documentation.as_ref(), doc.overview.as_ref()]
        .into_iter()
        .flatten()
        .find(|text| text.len() <= remaining)
}

/// Expand relevant SDK docs in one Jev call; failures retain the compact index.
/// The byte cap bounds prompt growth; it is not an exact tokenizer count.
#[tracing::instrument(skip_all, fields(selected = tracing::field::Empty, bytes = tracing::field::Empty, selection_status = tracing::field::Empty, selected_entities = tracing::field::Empty))]
pub async fn select_documentation(
    user: &MacroUserIdStr<'static>,
    prompt: &str,
    cognition: Option<&Arc<dyn Cognition>>,
    cancel: &CancellationToken,
) -> String {
    let docs = sdk_documentation();
    let mut output = String::from(
        "\n<macro_sdk>\nUse the real Macro SDK in ExecuteCode. API reference sections below are already loaded documentation: execute directly when they cover the task. Use DescribeCodeTools only for missing methods, options, enum values or workflow guidance; do not request a section again merely to confirm it. The entity index alone does not contain method signatures.\nAvailable entities:\n",
    );
    for doc in &docs {
        output.push_str(&format!("{}: {}\n", doc.name, doc.description));
    }
    let started = tokio::time::Instant::now();
    let (ranked, status) = rank_entities(
        user,
        prompt,
        &docs,
        cognition,
        Duration::from_millis(1000),
        cancel,
    )
    .await;
    let mut selected_entities = Vec::new();
    for doc in ranked.into_iter().take(4) {
        let remaining = (48 * 1024_usize).saturating_sub(output.len() + doc.name.len() + 32);
        if let Some(text) = fitting_reference(doc, remaining) {
            output.push_str(&format!("\n### {}\n{}\n", doc.name, text));
            selected_entities.push(doc.name.as_str());
        }
    }
    let span = tracing::Span::current();
    span.record("selected", selected_entities.len());
    span.record("selected_entities", selected_entities.join(","));
    span.record("bytes", output.len());
    span.record("selection_status", status.as_str());
    tracing::debug!(
        elapsed_ms = started.elapsed().as_millis() as u64,
        selected = selected_entities.len(),
        bytes = output.len(),
        "selected SDK documentation"
    );
    output.push_str("</macro_sdk>\n");
    output
}

/// Budget for one task-documentation tool result. Claude Code moved an 87K
/// character response out of context into a file; reference Markdown tokenizes
/// densely, so stay well below that.
const TASK_DOCUMENTATION_BYTES: usize = 32 * 1024;

/// Every SDK reference Jev considers relevant to a described task.
#[derive(Clone, Serialize, JsonSchema)]
pub struct TaskDocumentation {
    /// How selection ended; anything but selected means no entity was expanded.
    pub status: SelectionStatus,
    /// Relevant entities, most relevant first, each with its full reference or,
    /// when that does not fit, its namespace overview.
    pub entities: Vec<SdkDocumentation>,
    /// Relevant entities left out for size; request them by name.
    pub omitted: Vec<String>,
}

/// Select references for a task the agent describes, for clients that never
/// show the server the user's request.
#[tracing::instrument(name = "code_mode.task_documentation", skip_all, fields(selected = tracing::field::Empty, omitted = tracing::field::Empty, bytes = tracing::field::Empty, selection_status = tracing::field::Empty, selected_entities = tracing::field::Empty))]
pub async fn documentation_for_task(
    user: &MacroUserIdStr<'static>,
    task: &str,
    cognition: Option<&Arc<dyn Cognition>>,
    cancel: &CancellationToken,
) -> TaskDocumentation {
    let docs = sdk_documentation();
    // The agent is waiting on this call, unlike the per-turn prompt path.
    let (ranked, status) =
        rank_entities(user, task, &docs, cognition, Duration::from_secs(5), cancel).await;
    let mut bytes = 0;
    let mut entities = Vec::new();
    let mut omitted = Vec::new();
    for doc in ranked {
        match fitting_reference(doc, TASK_DOCUMENTATION_BYTES.saturating_sub(bytes)) {
            Some(text) => {
                bytes += text.len();
                entities.push(SdkDocumentation {
                    documentation: Some(text.clone()),
                    overview: None,
                    ..doc.clone()
                });
            }
            None => omitted.push(doc.name.clone()),
        }
    }
    let span = tracing::Span::current();
    span.record("selected", entities.len());
    span.record("omitted", omitted.len());
    span.record("bytes", bytes);
    span.record("selection_status", status.as_str());
    span.record(
        "selected_entities",
        entities
            .iter()
            .map(|doc| doc.name.as_str())
            .collect::<Vec<_>>()
            .join(","),
    );
    TaskDocumentation {
        status,
        entities,
        omitted,
    }
}

#[cfg(test)]
mod test;
