//! Nemotron reads a thread's deadline and event facts; the domain resolves their dates.
use super::temporal::require_explicit_fields;
use crate::domain::InputError;
use crate::domain::temporal::thread_due_date::{
    DueDateUsage, ExtractedFacts, ThreadDueDateRequest, ThreadFactExtractor, ThreadFacts,
};
use agent::structured_output::{DynamicSchema, validate_schema};
use agent::{Message, complete_with_history_and_params};
use ai_usage::{UsageAmount, UsageContext, UsageEvent, UsageRecorder, UsageTracking};
use schemars::generate::SchemaSettings;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};

#[cfg(test)]
mod test;

const SCHEMA_NAME: &str = "ThreadDeadlineFacts";

/// Records through `inner` and keeps the tokens of what it records, so one
/// read can report its own cost back to its caller.
struct Captured<'a> {
    inner: &'a dyn UsageRecorder,
    usage: Mutex<Option<DueDateUsage>>,
}

impl UsageRecorder for Captured<'_> {
    fn tracking(&self) -> Option<Arc<dyn UsageTracking>> {
        self.inner.tracking()
    }

    fn record(&self, event: UsageEvent) {
        if let UsageAmount::Tokens {
            input,
            output,
            cache_read,
            cache_write,
        } = event.amount
            && let Ok(mut usage) = self.usage.lock()
        {
            let usage = usage.get_or_insert_with(|| DueDateUsage {
                model: event.model.clone(),
                input_tokens: 0,
                output_tokens: 0,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
            });
            usage.input_tokens += input;
            usage.output_tokens += output;
            usage.cache_read_tokens += cache_read;
            usage.cache_write_tokens += cache_write;
        }
        self.inner.record(event);
    }
}

/// Deadline facts through the shared model router and usage recorder.
pub struct AgentThreadFactExtractor {
    recorder: Arc<dyn UsageRecorder>,
}

impl AgentThreadFactExtractor {
    /// Attribute completed requests to the supplied recorder.
    pub fn new(recorder: Arc<dyn UsageRecorder>) -> Self {
        Self { recorder }
    }

    /// Actual provider schema.
    pub fn schema() -> Value {
        let settings = SchemaSettings::draft2020_12().with(|s| {
            s.meta_schema = None;
            s.inline_subschemas = true;
        });
        let mut schema = settings
            .into_generator()
            .into_root_schema_for::<ThreadFacts>()
            .to_value();
        require_explicit_fields(&mut schema);
        schema
    }

    /// Exact production instructions, including the schema read by the model. Mail
    /// never reaches them: it travels in the user message, as data.
    pub fn prompt(schema: &Value) -> String {
        format!(
            "{}\n{}\n{schema}",
            include_str!("../../prompts/temporal_thread_prompt.txt").trim_end(),
            include_str!("../../prompts/temporal_output_prompt.txt").trim_end(),
        )
    }

    fn model_input(request: &ThreadDueDateRequest) -> String {
        let messages = request
            .messages
            .iter()
            .enumerate()
            .map(|(number, message)| {
                json!({
                    "message": number,
                    "written_on": message.written_on,
                    "from_owner": message.from_owner,
                    "text": message.text,
                })
            })
            .collect::<Vec<_>>();
        json!({"subject": request.subject, "messages": messages}).to_string()
    }
}

impl ThreadFactExtractor for AgentThreadFactExtractor {
    #[tracing::instrument(
        name = "universal_input.thread_facts",
        skip_all,
        err,
        fields(gen_ai.request.model = super::EXTRACTION_MODEL)
    )]
    async fn extract_thread_facts(
        &self,
        request: &ThreadDueDateRequest,
        usage: UsageContext,
    ) -> Result<ExtractedFacts, InputError> {
        let schema = Self::schema();
        let system = Self::prompt(&schema);
        let validator = validate_schema(&DynamicSchema {
            schema: schema.clone(),
            name: SCHEMA_NAME.into(),
            description: None,
        })
        .map_err(|_| InputError::Extraction)?;
        let recorder = Captured {
            inner: self.recorder.as_ref(),
            usage: Mutex::new(None),
        };
        let result = complete_with_history_and_params(
            super::EXTRACTION_MODEL,
            &system,
            vec![Message::user(Self::model_input(request))],
            Some(json!({
                "reasoning_effort": "none",
                "temperature": 0,
                "max_tokens": 1000,
                "response_format": {"type": "json_schema", "json_schema": {
                    "name": SCHEMA_NAME, "strict": true, "schema": schema
                }}
            })),
            &recorder,
            usage,
        )
        .await
        .map_err(|_| InputError::Extraction)?;
        let value: Value = serde_json::from_str(&result).map_err(|_| InputError::Extraction)?;
        validator
            .validate(&value)
            .map_err(|_| InputError::Extraction)?;
        let facts: ThreadFacts =
            serde_json::from_value(value).map_err(|_| InputError::Extraction)?;
        let usage = recorder.usage.into_inner().ok().flatten();
        Ok(ExtractedFacts { facts, usage })
    }
}
