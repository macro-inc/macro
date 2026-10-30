//! Nemotron extracts source facts; calendar arithmetic remains in the domain.
use crate::domain::temporal::{TemporalExpressions, TemporalExtractor};
use crate::domain::{ExtractInputRequest, InputError, InputIntent};
mod wire;
use agent::structured_output::{DynamicSchema, validate_schema};
use agent::{Message, complete_with_history_and_params};
use ai_usage::{UsageContext, UsageRecorder};
use schemars::generate::SchemaSettings;
use serde_json::{Value, json};
use std::sync::Arc;
use wire::Facts;

/// Nemotron temporal expressions through the shared model router and usage recorder.
pub struct AgentTemporalExtractor {
    recorder: Arc<dyn UsageRecorder>,
}
impl AgentTemporalExtractor {
    /// Retain the authenticated user's shared usage attribution.
    pub fn new(recorder: Arc<dyn UsageRecorder>) -> Self {
        Self { recorder }
    }

    /// Actual provider schema, exposed for reproducible synthetic model evaluation.
    pub fn schema() -> Value {
        let settings = SchemaSettings::draft2020_12().with(|s| {
            s.meta_schema = None;
            s.inline_subschemas = true;
        });
        let mut schema = settings
            .into_generator()
            .into_root_schema_for::<Facts>()
            .to_value();
        require_explicit_fields(&mut schema);
        schema
    }

    /// Exact production instructions, including the schema read by the model.
    pub fn prompt(intent: InputIntent, schema: &Value) -> String {
        let task = if intent == InputIntent::Task {
            concat!("\n", include_str!("../../prompts/temporal_task_prompt.txt")).trim_end()
        } else {
            ""
        };
        let output = include_str!("../../prompts/temporal_output_prompt.txt").trim_end();
        format!(
            "{}{task}\n{output}\n{schema}",
            include_str!("../../prompts/temporal_prompt.txt").trim_end()
        )
    }
}

// Native strict output requires all fields. Missing expressions are omitted from the list.
fn require_explicit_fields(value: &mut Value) {
    match value {
        Value::Object(object) => {
            for value in object.values_mut() {
                require_explicit_fields(value);
            }
            object.remove("title");
            object.remove("format");
            if let Some(Value::Array(variants)) = object.get("oneOf")
                && !variants.is_empty()
                && variants.iter().all(|v| {
                    v.get("type") == Some(&Value::String("string".into()))
                        && v.get("const").is_some()
                })
            {
                let values = variants
                    .iter()
                    .filter_map(|v| v.get("const").cloned())
                    .collect();
                object.remove("oneOf");
                object.insert("type".into(), json!("string"));
                object.insert("enum".into(), Value::Array(values));
            }
            if let Some(Value::Array(options)) = object.get("anyOf")
                && options.len() == 2
                && options
                    .iter()
                    .any(|v| v.get("type") == Some(&json!("null")))
                && let Some(variant) = options
                    .iter()
                    .find(|v| v.get("type") == Some(&json!("string")) && v.get("enum").is_some())
            {
                let mut variants = variant["enum"].as_array().cloned().unwrap_or_default();
                variants.push(Value::Null);
                object.remove("anyOf");
                object.insert("type".into(), json!(["string", "null"]));
                object.insert("enum".into(), Value::Array(variants));
            }
            if let Some(Value::Object(properties)) = object.get_mut("properties")
                && let Some(kind) = properties.shift_remove("kind")
            {
                properties.shift_insert(0, "kind".into(), kind);
            }
            if let Some(properties) = object.get("properties").and_then(Value::as_object) {
                let keys = properties
                    .keys()
                    .map(|key| Value::String(key.clone()))
                    .collect::<Vec<_>>();
                object.insert("required".into(), Value::Array(keys));
                object.insert("additionalProperties".into(), Value::Bool(false));
            }
        }
        Value::Array(values) => {
            for value in values {
                require_explicit_fields(value);
            }
        }
        _ => {}
    }
}

impl TemporalExtractor for AgentTemporalExtractor {
    #[tracing::instrument(name = "universal_input.temporal", skip_all, err, fields(intent = ?input.intent, model = super::EXTRACTION_MODEL, input.prompt_version = crate::telemetry::PROMPT_VERSION, input.recipe_version = crate::telemetry::RECIPE_VERSION))]
    async fn extract_temporal(
        &self,
        input: &ExtractInputRequest,
        usage: UsageContext,
    ) -> Result<TemporalExpressions, InputError> {
        if !matches!(input.intent, InputIntent::Task | InputIntent::Calendar) {
            return Err(InputError::Extraction);
        }
        let schema = Self::schema();
        let system = Self::prompt(input.intent, &schema);
        let validator = validate_schema(&DynamicSchema {
            schema: schema.clone(),
            name: "TemporalExpression".into(),
            description: None,
        })
        .map_err(|_| InputError::Extraction)?;
        let result = complete_with_history_and_params(super::EXTRACTION_MODEL, &system,
            vec![Message::user(json!({"draft":input.text}).to_string())],
            Some(json!({ "reasoning_effort":"none", "temperature":0, "max_tokens":1500,
                "response_format":{"type":"json_schema","json_schema":{"name":"TemporalExpression","strict":true,"schema":schema}}
            })), self.recorder.as_ref(), usage,
        ).await.map_err(|_| InputError::Extraction)?;
        let value: Value = serde_json::from_str(&result).map_err(|_| InputError::Extraction)?;
        validator
            .validate(&value)
            .map_err(|_| InputError::Extraction)?;
        serde_json::from_value::<Facts>(value)
            .map_err(|_| InputError::Extraction)?
            .into_expressions(input.intent)
    }
}
