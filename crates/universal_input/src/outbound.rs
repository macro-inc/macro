//! Tool-free extraction adapters for Clairic and the shared model router.
pub mod clairic;
pub mod temporal;
#[cfg(test)]
mod test;
use crate::domain::{
    ExtractInputRequest, FIELD_EXTRACTION_GUIDANCE, FieldExtractor, InputError, InputIntent,
    InputSuggestions,
};
use agent::{Message, complete_with_history_and_params};
use ai_usage::{UsageContext, UsageRecorder};
use serde_json::{Value, json};
use std::sync::Arc;

const EXTRACTION_MODEL: &str = "fireworks/nemotron-lightning-3p5-30b-a3b";

/// Tool-free Nemotron extraction through the shared model router and usage recorder.
pub struct AgentFieldExtractor {
    recorder: Arc<dyn UsageRecorder>,
}

impl AgentFieldExtractor {
    /// Create an extractor that attributes completed requests to the supplied recorder.
    pub fn new(recorder: Arc<dyn UsageRecorder>) -> Self {
        Self { recorder }
    }
}

fn extraction_schema(fields: &[&str], lists: &[&str]) -> Value {
    let properties = fields
        .iter()
        .map(|field| {
            let schema = match *field {
                name if lists.contains(&name) => {
                    json!({"type": "array", "items": {"type": "string"}})
                }
                "properties" => json!({"type": "array", "items": {
                    "type": "object", "additionalProperties": false,
                    "required": ["name", "values"],
                    "properties": {
                        "name": {"type": "string"},
                        "values": {"type": "array", "items": {"type": "string"}}
                    }
                }}),
                _ => json!({"type": ["string", "null"]}),
            };
            ((*field).to_owned(), schema)
        })
        .collect::<serde_json::Map<_, _>>();
    json!({"type": "object", "additionalProperties": false, "required": fields, "properties": properties})
}

fn decode_suggestions(intent: InputIntent, fields: Value) -> Result<InputSuggestions, InputError> {
    serde_json::from_value(json!({"intent": intent, "suggestions": fields}))
        .map_err(|_| InputError::Extraction)
}

impl AgentFieldExtractor {
    #[tracing::instrument(name = "universal_input.content", skip_all, err, fields(
        intent = ?input.intent,
        gen_ai.request.model = EXTRACTION_MODEL,
        input.prompt_version = crate::telemetry::PROMPT_VERSION, input.recipe_version = crate::telemetry::RECIPE_VERSION,
    ))]
    async fn complete(
        &self,
        input: &ExtractInputRequest,
        schema: Value,
        guidance: &str,
        usage: UsageContext,
    ) -> Result<Value, InputError> {
        let system = format!(
            "{}\n{}\nJSON schema: {}",
            FIELD_EXTRACTION_GUIDANCE, guidance, schema
        );
        let prompt = json!({"draft": input.text, "intent": input.intent, "property_definitions": input.property_definitions}).to_string();
        let result = complete_with_history_and_params(
            EXTRACTION_MODEL,
            &system,
            vec![Message::user(prompt)],
            Some(json!({"reasoning_effort": "none", "temperature": 0,
                "response_format": {"type": "json_schema", "json_schema": {
                    "name": "UniversalInputFields", "strict": true, "schema": schema
                }}
            })),
            self.recorder.as_ref(),
            usage,
        )
        .await
        .map_err(|_| InputError::Extraction)?;
        serde_json::from_str(&result).map_err(|_| InputError::Extraction)
    }
}

impl FieldExtractor for AgentFieldExtractor {
    async fn extract(
        &self,
        input: &ExtractInputRequest,
        usage: UsageContext,
    ) -> Result<InputSuggestions, InputError> {
        if input.intent == InputIntent::Search {
            return Err(InputError::Extraction);
        }
        let schema = extraction_schema(
            input.intent.extraction_fields(),
            &["recipients", "cc", "bcc", "guests"],
        );
        decode_suggestions(
            input.intent,
            self.complete(input, schema, input.intent.extraction_guidance(), usage)
                .await?,
        )
    }
}

impl crate::domain::search::SearchExtractor for AgentFieldExtractor {
    #[tracing::instrument(name = "universal_input.search_type", skip_all, err)]
    async fn select_search_type(
        &self,
        input: &ExtractInputRequest,
        usage: UsageContext,
    ) -> Result<crate::domain::search::SearchType, InputError> {
        let schema = json!({"type":"object", "additionalProperties":false, "required":["search_scope"], "properties":{"search_scope":{"type":["string","null"]}}});
        let fields = self
            .complete(
                input,
                schema,
                include_str!("../prompts/typed_search_scope_prompt.txt"),
                usage,
            )
            .await?;
        let scope: Option<String> = serde_json::from_value(
            fields
                .get("search_scope")
                .ok_or(InputError::Extraction)?
                .clone(),
        )
        .map_err(|_| InputError::Extraction)?;
        crate::domain::search::SearchType::from_scope(scope.as_deref())
    }

    #[tracing::instrument(name = "universal_input.search_fields", skip_all, err, fields(?search_type))]
    async fn extract_search(
        &self,
        input: &ExtractInputRequest,
        search_type: crate::domain::search::SearchType,
        usage: UsageContext,
    ) -> Result<crate::domain::search::SearchSuggestions, InputError> {
        let schema = search_schema(input, search_type);
        let mut guidance = format!(
            "Selected search type: {:?}\n{}",
            search_type,
            include_str!("../prompts/extract_search_prompt.txt")
        );
        for field in search_type.fields() {
            guidance.push_str(&format!(
                "\n{field}: {}",
                search_type.guidance(&field).ok_or(InputError::Extraction)?
            ));
        }
        let fields = self.complete(input, schema, &guidance, usage).await?;
        decode_search(input, search_type, fields)
    }
}

fn search_schema(
    input: &ExtractInputRequest,
    search_type: crate::domain::search::SearchType,
) -> Value {
    let mut schema = search_type.schema();
    if search_type == crate::domain::search::SearchType::Task {
        for name in ["status", "priority"] {
            let options: Vec<_> = input
                .property_definitions
                .iter()
                .filter(|definition| definition.name.eq_ignore_ascii_case(name))
                .flat_map(|definition| definition.options.clone())
                .collect();
            if options.is_empty() {
                schema["properties"][name]["maxItems"] = json!(0);
            } else {
                schema["properties"][name]["items"]["enum"] = json!(options);
            }
        }
    }
    schema
}

fn decode_search(
    input: &ExtractInputRequest,
    search_type: crate::domain::search::SearchType,
    mut fields: Value,
) -> Result<crate::domain::search::SearchSuggestions, InputError> {
    if !fields.is_object() {
        return Err(InputError::Extraction);
    }
    if search_type == crate::domain::search::SearchType::Task {
        for name in ["status", "priority"] {
            for value in fields
                .get_mut(name)
                .and_then(Value::as_array_mut)
                .ok_or(InputError::Extraction)?
            {
                let text = value.as_str().ok_or(InputError::Extraction)?;
                let options: Vec<_> = input
                    .property_definitions
                    .iter()
                    .filter(|definition| definition.name.eq_ignore_ascii_case(name))
                    .flat_map(|definition| &definition.options)
                    .filter(|option| option.eq_ignore_ascii_case(text))
                    .collect();
                if options.len() != 1 {
                    return Err(InputError::Extraction);
                }
                *value = json!(options[0]);
            }
        }
    }
    fields["type"] = serde_json::to_value(search_type).map_err(|_| InputError::Extraction)?;
    serde_json::from_value(fields).map_err(|_| InputError::Extraction)
}
