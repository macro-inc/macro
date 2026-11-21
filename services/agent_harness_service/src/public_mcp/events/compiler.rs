//! Compiling a request in words into a filter: one fast-model call through
//! the model router, admitted and metered as the subscriber's automation
//! usage.

use agent::structured_output::{DynamicSchema, dynamic_structured_completion};
use agent::{Message, PredefinedModel};
use ai_billing::{AiAdmissionError, AiAdmissionService};
use ai_usage::{AiFeature, UsageContext, UsageRecorder};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::compat::IntoRootcause as _;
use serde::Deserialize;
use std::fmt::Write as _;
use std::sync::{Arc, LazyLock};
use webhook::domain::mcp::catalog::event_description;
use webhook::domain::mcp::filter::McpEventFilter;
use webhook::domain::models::WEBHOOK_EVENT_NAMES;

/// Why a request was not compiled.
#[derive(Debug, thiserror::Error)]
pub(crate) enum CompileError {
    /// The request does not fit the filter language, saying why. The reason
    /// is the model's words about the request, so it is shown to the caller
    /// but kept out of this error's display, which spans record.
    #[error("the request does not fit the filter language")]
    Refused(String),
    /// The subscriber's AI usage refuses new work.
    #[error("{0}")]
    NotAdmitted(AiAdmissionError),
    #[error("filter compilation failed")]
    Internal(rootcause::Report),
}

/// Compiles requests in words into filters.
// Object-safe (`async_trait`): `McpEvents` holds it as
// `Arc<dyn FilterCompiler>` so tests can stand in for the model.
#[async_trait::async_trait]
pub(crate) trait FilterCompiler: Send + Sync {
    async fn compile(
        &self,
        user: &MacroUserIdStr<'static>,
        query: &str,
    ) -> Result<McpEventFilter, CompileError>;
}

/// The model's answer.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(tag = "outcome", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum CompileOutcome {
    /// The request as an exact filter.
    Filter { filter: McpEventFilter },
    /// The request cannot be expressed exactly.
    Refuse { reason: String },
}

static SYSTEM_PROMPT: LazyLock<String> = LazyLock::new(|| {
    let mut prompt = include_str!("compiler_prompt.md").to_owned();
    for name in WEBHOOK_EVENT_NAMES {
        let _ = writeln!(
            prompt,
            "- `{name}`: {}",
            event_description(name).unwrap_or_default()
        );
    }
    prompt
});

/// The fast model on the router, billed as the subscriber's automation
/// usage.
pub(crate) struct ModelFilterCompiler {
    pub(crate) admission: Arc<dyn AiAdmissionService>,
    pub(crate) recorder: Arc<dyn UsageRecorder>,
}

#[async_trait::async_trait]
impl FilterCompiler for ModelFilterCompiler {
    #[tracing::instrument(name = "mcp_events.compile", skip_all, fields(outcome = tracing::field::Empty), err)]
    async fn compile(
        &self,
        user: &MacroUserIdStr<'static>,
        query: &str,
    ) -> Result<McpEventFilter, CompileError> {
        self.admission
            .admit(user, AiFeature::Automation)
            .await
            .map_err(CompileError::NotAdmitted)?;
        let schema = DynamicSchema {
            schema: serde_json::to_value(schemars::schema_for!(CompileOutcome)).map_err(
                |error| CompileError::Internal(rootcause::Report::new(error).into_dynamic()),
            )?,
            name: "event_filter".to_owned(),
            description: Some(
                "The request as a Macro event filter, or why it cannot be one.".to_owned(),
            ),
        };
        let value = dynamic_structured_completion(
            PredefinedModel::Fast,
            SYSTEM_PROMPT.as_str(),
            vec![Message::user(query.to_owned())],
            schema,
            self.recorder.as_ref(),
            UsageContext::new(AiFeature::Automation, user.clone()),
        )
        .await
        .map_err(|error| CompileError::Internal(error.into_rootcause()))?;
        let outcome = parse_outcome(value);
        tracing::Span::current().record(
            "outcome",
            match &outcome {
                Ok(_) => "filter",
                Err(CompileError::Refused(_)) => "refused",
                Err(_) => "error",
            },
        );
        outcome
    }
}

/// The model's answer as a filter delivery can evaluate, or a refusal.
pub(crate) fn parse_outcome(value: serde_json::Value) -> Result<McpEventFilter, CompileError> {
    match serde_json::from_value::<CompileOutcome>(value)
        .map_err(|error| CompileError::Internal(rootcause::Report::new(error).into_dynamic()))?
    {
        CompileOutcome::Filter { filter } => {
            filter
                .validate()
                .map_err(|error| CompileError::Refused(error.to_string()))?;
            Ok(filter)
        }
        CompileOutcome::Refuse { reason } => Err(CompileError::Refused(reason)),
    }
}
