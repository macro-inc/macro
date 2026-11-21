//! Compiling a request in words into a filter: one fast-model call through
//! the model router, then a second that checks the filter's reading against
//! the request before anything is delivered. Both are admitted and metered
//! as the subscriber's automation usage.

use super::describe::describe;
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

/// The checker's answer: whether a filter's reading says what the request
/// asked.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(tag = "outcome", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum CheckOutcome {
    /// The reading delivers what was asked and nothing else.
    Matches,
    /// The reading delivers more or less than was asked.
    Differs { difference: String },
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

const CHECKER_PROMPT: &str = include_str!("checker_prompt.md");

/// The fast model on the router, billed as the subscriber's automation
/// usage.
pub(crate) struct ModelFilterCompiler {
    pub(crate) admission: Arc<dyn AiAdmissionService>,
    pub(crate) recorder: Arc<dyn UsageRecorder>,
}

impl ModelFilterCompiler {
    /// One structured fast-model call, metered as the user's automation.
    async fn ask<T: schemars::JsonSchema>(
        &self,
        user: &MacroUserIdStr<'static>,
        system: &str,
        input: String,
        name: &str,
        description: &str,
    ) -> Result<serde_json::Value, CompileError> {
        let schema = DynamicSchema {
            schema: serde_json::to_value(schemars::schema_for!(T)).map_err(|error| {
                CompileError::Internal(rootcause::Report::new(error).into_dynamic())
            })?,
            name: name.to_owned(),
            description: Some(description.to_owned()),
        };
        dynamic_structured_completion(
            PredefinedModel::Fast,
            system,
            vec![Message::user(input)],
            schema,
            self.recorder.as_ref(),
            UsageContext::new(AiFeature::Automation, user.clone()),
        )
        .await
        .map_err(|error| CompileError::Internal(error.into_rootcause()))
    }
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
        let outcome = async {
            let filter = parse_outcome(
                self.ask::<CompileOutcome>(
                    user,
                    SYSTEM_PROMPT.as_str(),
                    query.to_owned(),
                    "event_filter",
                    "The request as a Macro event filter, or why it cannot be one.",
                )
                .await?,
            )?;
            // A second, independent reading: the filter in words, derived
            // from the filter alone, against the request. A restriction the
            // compiler dropped is refused here instead of delivered.
            parse_check(
                self.ask::<CheckOutcome>(
                    user,
                    CHECKER_PROMPT,
                    format!(
                        "Request: {query}\n\nReading of the filter: {}",
                        describe(&filter)
                    ),
                    "filter_check",
                    "Whether the filter's reading delivers exactly what the request asks.",
                )
                .await?,
            )?;
            Ok(filter)
        }
        .await;
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

/// The checker's answer: nothing when the filter says what was asked, a
/// refusal naming the difference otherwise.
pub(crate) fn parse_check(value: serde_json::Value) -> Result<(), CompileError> {
    match serde_json::from_value::<CheckOutcome>(value)
        .map_err(|error| CompileError::Internal(rootcause::Report::new(error).into_dynamic()))?
    {
        CheckOutcome::Matches => Ok(()),
        CheckOutcome::Differs { difference } => Err(CompileError::Refused(format!(
            "The closest filter would not say exactly what was asked: {difference} \
             Rephrase the request, or subscribe to a named event type."
        ))),
    }
}
