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
    let Some(cognition) = cognition else {
        tracing::Span::current().record("selection_status", "unconfigured");
        output.push_str("</macro_sdk>\n");
        return output;
    };
    let request = DecisionRequest {
        input: serde_json::json!({"userRequest": prompt.chars().take(8000).collect::<String>()}),
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
    let started = tokio::time::Instant::now();
    let (answer, selection_status) = tokio::select! {
        biased;
        _ = cancel.cancelled() => (None, "cancelled"),
        result = tokio::time::timeout(Duration::from_millis(1000), cognition.decide(user, request)) => match result {
            Ok(Ok(answer)) => (Some(answer), "selected"),
            Ok(Err(_)) => (None, "provider_error"),
            Err(_) => (None, "timeout"),
        },
    };
    let mut selected = 0;
    let mut selected_entities = Vec::new();
    if let Some(answer) = answer {
        let mut ranked: Vec<_> = docs
            .iter()
            .filter_map(|doc| {
                let score = answer.probabilities.get(&doc.name).copied()?;
                (score.is_finite() && score >= 0.5).then_some((score, doc))
            })
            .collect();
        ranked.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.name.cmp(&b.1.name)));
        for (_, doc) in ranked.into_iter().take(4) {
            let remaining = (48 * 1024_usize).saturating_sub(output.len() + doc.name.len() + 32);
            if let Some(text) = [doc.documentation.as_ref(), doc.overview.as_ref()]
                .into_iter()
                .flatten()
                .find(|text| text.len() <= remaining)
            {
                output.push_str(&format!("\n### {}\n{}\n", doc.name, text));
                selected += 1;
                selected_entities.push(doc.name.as_str());
            }
        }
    }
    tracing::Span::current().record("selected", selected);
    tracing::Span::current().record("selected_entities", selected_entities.join(","));
    tracing::Span::current().record("bytes", output.len());
    tracing::Span::current().record("selection_status", selection_status);
    tracing::debug!(
        elapsed_ms = started.elapsed().as_millis() as u64,
        selected,
        bytes = output.len(),
        "selected SDK documentation"
    );
    output.push_str("</macro_sdk>\n");
    output
}

#[cfg(test)]
mod test;
