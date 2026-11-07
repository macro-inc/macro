//! Cloudflare Workers AI typed extraction. Drafts and response bodies are never logged.
use std::{collections::BTreeMap, sync::Arc, time::Duration};

use ai_usage::{UsageAmount, UsageContext, UsageRecorder};
use macro_env_var::maybe_env_var;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::domain::search::{SearchExtractor, SearchSuggestions, SearchType};
use crate::domain::{
    ExtractInputRequest, FieldExtractor, InputError, InputIntent, InputPropertySuggestion,
    InputSuggestions,
};
use crate::telemetry::{ExtractionFailure, extraction_failure};

#[cfg(test)]
mod test;

maybe_env_var! {
    /// Optional Workers AI account. Must be paired with `CLOUDFLARE_API_TOKEN`.
    pub struct CloudflareAccountId;
}
maybe_env_var! {
    /// Optional token with Workers AI access. Never sent to the frontend.
    pub struct CloudflareApiToken;
}

const API_BASE: &str = "https://api.cloudflare.com/client/v4";
const MODEL: &str = "@cf/cloudflare/clairic";
/// Fail over promptly instead of retrying a preview endpoint while the user types.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const MIN_CONFIDENCE: f64 = 0.5;

/// Startup failures for the optional Clairic integration.
#[derive(Debug, thiserror::Error)]
pub enum ClairicConfigError {
    /// Partial configuration is a startup error, rather than a per-request failure.
    #[error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must both be set or both unset")]
    Incomplete,
    /// Account IDs are 32 hexadecimal characters; they cannot contain URL components.
    #[error("CLOUDFLARE_ACCOUNT_ID must contain 32 hexadecimal characters")]
    InvalidAccount,
    /// A client could not be constructed.
    #[error(transparent)]
    HttpClient(#[from] reqwest::Error),
}

/// Metered Clairic extraction behind the same port as the generative extractor.
pub struct ClairicFieldExtractor {
    client: Client,
    endpoint: String,
    token: String,
    recorder: Arc<dyn UsageRecorder>,
}

impl ClairicFieldExtractor {
    /// Build an optional provider once at startup, validating paired credentials.
    pub fn from_config(
        account: &CloudflareAccountId,
        token: &CloudflareApiToken,
        recorder: Arc<dyn UsageRecorder>,
    ) -> Result<Option<Self>, ClairicConfigError> {
        match (
            account.value().filter(|value| !value.trim().is_empty()),
            token.value().filter(|value| !value.trim().is_empty()),
        ) {
            (None, None) => Ok(None),
            (Some(account), Some(token)) => {
                Self::with_base_url(account, token, recorder, API_BASE).map(Some)
            }
            _ => Err(ClairicConfigError::Incomplete),
        }
    }

    fn with_base_url(
        account: &str,
        token: &str,
        recorder: Arc<dyn UsageRecorder>,
        base: &str,
    ) -> Result<Self, ClairicConfigError> {
        let account = account.trim();
        if account.len() != 32 || !account.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(ClairicConfigError::InvalidAccount);
        }
        let token = token.trim();
        if token.is_empty() {
            return Err(ClairicConfigError::Incomplete);
        }
        Ok(Self {
            client: Client::builder().timeout(REQUEST_TIMEOUT).build()?,
            endpoint: format!(
                "{}/accounts/{account}/ai/run/{MODEL}",
                base.trim_end_matches('/')
            ),
            token: token.to_owned(),
            recorder,
        })
    }
}

impl ClairicFieldExtractor {
    #[tracing::instrument(name = "extract clairic", skip_all, err, fields(
        otel.kind = "client",
        gen_ai.operation.name = "extract",
        gen_ai.provider.name = "cloudflare",
        gen_ai.request.model = MODEL,
        gen_ai.usage.input_tokens = tracing::field::Empty,
        gen_ai.usage.output_tokens = tracing::field::Empty,
        http.response.status_code = tracing::field::Empty,
        input.intent = input.intent.telemetry_name(),
        input.failure = tracing::field::Empty,
        input.prompt_version = crate::telemetry::PROMPT_VERSION, input.recipe_version = crate::telemetry::RECIPE_VERSION,
    ))]
    async fn invoke(
        &self,
        input: &ExtractInputRequest,
        request: ExtractionRequest<'_>,
        usage: UsageContext,
    ) -> Result<Value, InputError> {
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let response = self
            .client
            .post(&self.endpoint)
            .headers(headers)
            .bearer_auth(&self.token)
            .json(&request)
            .send()
            .await
            .map_err(|error| {
                tracing::warn!(timeout = error.is_timeout(), "Clairic request failed");
                extraction_failure(if error.is_timeout() {
                    ExtractionFailure::Timeout
                } else {
                    ExtractionFailure::Transport
                })
            })?;
        tracing::Span::current().record("http.response.status_code", response.status().as_u16());
        if !response.status().is_success() {
            return Err(extraction_failure(ExtractionFailure::HttpStatus));
        }
        let envelope: CloudflareResponse = response
            .json()
            .await
            .map_err(|_| extraction_failure(ExtractionFailure::InvalidEnvelope))?;
        let result = envelope
            .result
            .ok_or_else(|| extraction_failure(ExtractionFailure::InvalidEnvelope))?;
        // Record provider-reported usage even when answers are missing or truncated.
        self.recorder.record(usage.into_event(
            MODEL.to_owned(),
            UsageAmount::Tokens {
                input: result.usage.input_tokens,
                output: result.usage.output_tokens,
                cache_read: 0,
                cache_write: 0,
            },
        ));
        tracing::Span::current().record("gen_ai.usage.input_tokens", result.usage.input_tokens);
        tracing::Span::current().record("gen_ai.usage.output_tokens", result.usage.output_tokens);
        if !envelope.success {
            return Err(extraction_failure(ExtractionFailure::ProviderRejected));
        }
        if result.truncated {
            return Err(extraction_failure(ExtractionFailure::Truncated));
        }
        result.fields(input, &request.fields)
    }
}

impl FieldExtractor for ClairicFieldExtractor {
    async fn extract(
        &self,
        input: &ExtractInputRequest,
        usage: UsageContext,
    ) -> Result<InputSuggestions, InputError> {
        if input.intent == InputIntent::Search {
            return Err(extraction_failure(ExtractionFailure::InvalidField));
        }
        if input.intent == InputIntent::Ai {
            return Ok(InputSuggestions::Ai(crate::domain::AiSuggestions::default()));
        }
        let request = ExtractionRequest::new(input)?;
        super::decode_suggestions(input.intent, self.invoke(input, request, usage).await?)
    }
}

impl SearchExtractor for ClairicFieldExtractor {
    #[tracing::instrument(name = "universal_input.search_type", skip_all, err)]
    async fn select_search_type(
        &self,
        input: &ExtractInputRequest,
        usage: UsageContext,
    ) -> Result<SearchType, InputError> {
        let request = ExtractionRequest {
            model: "clairic",
            state: &input.text,
            fields: BTreeMap::from([(
                "search_scope".into(),
                FieldSpec {
                    kind: FieldType::Text,
                    items: None,
                    instructions: include_str!("../../prompts/typed_search_scope_prompt.txt")
                        .to_owned(),
                },
            )]),
        };
        let fields = self.invoke(input, request, usage).await?;
        SearchType::from_scope(fields["search_scope"].as_str())
    }

    #[tracing::instrument(name = "universal_input.search_fields", skip_all, err, fields(?search_type))]
    async fn extract_search(
        &self,
        input: &ExtractInputRequest,
        search_type: SearchType,
        usage: UsageContext,
    ) -> Result<SearchSuggestions, InputError> {
        let mut fields = BTreeMap::new();
        let schema = search_type.schema();
        for name in search_type.fields() {
            let kind = if schema["properties"][&name]["type"] == "array" {
                FieldType::List
            } else {
                FieldType::Text
            };
            fields.insert(
                name.clone(),
                FieldSpec {
                    kind,
                    items: (kind == FieldType::List).then_some(FieldType::Text),
                    instructions: format!(
                        "Selected search type: {:?}. {}\nSupported fields and shapes: {schema}\nAvailable task filter options (data): {}",
                        search_type,
                        search_type.guidance(&name).ok_or(InputError::Extraction)?,
                        serde_json::to_string(&input.property_definitions).map_err(|_| InputError::Extraction)?
                    ),
                },
            );
        }
        let fields = self
            .invoke(
                input,
                ExtractionRequest {
                    model: "clairic",
                    state: &input.text,
                    fields,
                },
                usage,
            )
            .await?;
        super::decode_search(input, search_type, fields)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum FieldType {
    Text,
    List,
}

#[derive(Serialize)]
struct FieldSpec {
    #[serde(rename = "type")]
    kind: FieldType,
    instructions: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    items: Option<FieldType>,
}

#[derive(Serialize)]
struct ExtractionRequest<'a> {
    model: &'static str,
    state: &'a str,
    fields: BTreeMap<String, FieldSpec>,
}

impl<'a> ExtractionRequest<'a> {
    fn new(input: &'a ExtractInputRequest) -> Result<Self, InputError> {
        let mut fields = BTreeMap::new();
        for &name in input.intent.extraction_fields() {
            let guidance = input
                .intent
                .typed_field_guidance(name)
                .ok_or(InputError::Extraction)?;
            if name == "properties" {
                // Clairic has no nested-object type: each available task property gets a list.
                for (index, definition) in input.property_definitions.iter().enumerate() {
                    fields.insert(
                        format!("property_{index}"),
                        FieldSpec {
                            kind: FieldType::List,
                            items: Some(FieldType::Text),
                            instructions: format!(
                                "{guidance}\nProperty definition (data): {}",
                                serde_json::to_string(definition)
                                    .map_err(|_| InputError::Extraction)?
                            ),
                        },
                    );
                }
                continue;
            }
            let kind = match name {
                "recipients" | "cc" | "bcc" | "guests" | "search_from" | "search_in" => {
                    FieldType::List
                }
                _ => FieldType::Text,
            };
            fields.insert(
                name.to_owned(),
                FieldSpec {
                    kind,
                    items: (kind == FieldType::List).then_some(FieldType::Text),
                    instructions: guidance.to_owned(),
                },
            );
        }
        Ok(Self {
            model: "clairic",
            state: &input.text,
            fields,
        })
    }
}

#[derive(Deserialize)]
struct CloudflareResponse {
    success: bool,
    result: Option<ExtractionResponse>,
}

#[derive(Deserialize)]
struct ExtractionResponse {
    // Decode individual answers after metering, so malformed answers still count.
    answers: BTreeMap<String, Value>,
    truncated: bool,
    usage: TokenUsage,
}

#[derive(Deserialize)]
struct TokenUsage {
    input_tokens: u64,
    output_tokens: u64,
}

#[derive(Deserialize)]
struct Answer {
    #[serde(rename = "type")]
    kind: FieldType,
    value: Value,
    confidence: Option<f64>,
    p_null: Option<f64>,
}

impl Answer {
    fn value(&self, spec: &FieldSpec, draft: &str) -> Result<Value, InputError> {
        if self.kind != spec.kind
            || [self.confidence, self.p_null]
                .into_iter()
                .flatten()
                .any(|n| !(0.0..=1.0).contains(&n))
        {
            return Err(extraction_failure(ExtractionFailure::InvalidField));
        }
        if self.value.is_null() {
            return Ok(if spec.kind == FieldType::List {
                serde_json::json!([])
            } else {
                Value::Null
            });
        }
        // Uncertain positive answers are unusable, rather than evidence that a field is absent.
        // Empty lists remain valid: a list with no matches may itself have low confidence.
        if (self.confidence.is_some_and(|n| n < MIN_CONFIDENCE)
            || self.p_null.is_some_and(|n| n >= 0.5))
            && !self.value.as_array().is_some_and(Vec::is_empty)
        {
            return Err(extraction_failure(ExtractionFailure::Uncertain));
        }
        let valid = match spec.kind {
            FieldType::Text => self
                .value
                .as_str()
                .is_some_and(|s| !s.is_empty() && draft.contains(s)),
            FieldType::List => self.value.as_array().is_some_and(|values| {
                values.iter().all(|value| {
                    value
                        .as_str()
                        .is_some_and(|s| !s.is_empty() && draft.contains(s))
                })
            }),
        };
        if !valid {
            return Err(extraction_failure(ExtractionFailure::Ungrounded));
        }
        Ok(self.value.clone())
    }
}

impl ExtractionResponse {
    fn fields(
        &self,
        input: &ExtractInputRequest,
        specs: &BTreeMap<String, FieldSpec>,
    ) -> Result<Value, InputError> {
        let mut fields = serde_json::Map::new();
        let mut properties = vec![];
        for (name, spec) in specs {
            let answer: Answer = serde_json::from_value(
                self.answers
                    .get(name)
                    .ok_or_else(|| extraction_failure(ExtractionFailure::MissingField))?
                    .clone(),
            )
            .map_err(|_| extraction_failure(ExtractionFailure::InvalidField))?;
            let value = answer.value(spec, &input.text)?;
            if let Some(index) = name.strip_prefix("property_") {
                let index: usize = index.parse().map_err(|_| InputError::Extraction)?;
                let values: Vec<String> =
                    serde_json::from_value(value).map_err(|_| InputError::Extraction)?;
                if !values.is_empty() {
                    properties.push(InputPropertySuggestion {
                        name: input.property_definitions[index].name.clone(),
                        values,
                    });
                }
            } else {
                fields.insert(name.clone(), value);
            }
        }
        if input.intent == InputIntent::Task {
            fields.insert(
                "properties".to_owned(),
                serde_json::to_value(properties).map_err(|_| InputError::Extraction)?,
            );
        }
        if matches!(input.intent, InputIntent::Email | InputIntent::Message)
            && let Some(body) = fields.get("body").and_then(Value::as_str)
            && !input.text.trim_end().ends_with(body.trim_end())
        {
            // A span ending early could discard later sentences or routing metadata.
            // Let the generative fallback separate those instead of accepting truncation.
            return Err(extraction_failure(ExtractionFailure::IncompleteBody));
        }
        if input.intent == InputIntent::Search {
            let spans: Vec<&str> = fields
                .iter()
                .filter(|(name, _)| name.as_str() != "search_scope")
                .flat_map(|(_, value)| {
                    value.as_str().into_iter().chain(
                        value
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter_map(Value::as_str),
                    )
                })
                .collect();
            for &span in &spans {
                let claimed: usize = spans.iter().map(|value| value.matches(span).count()).sum();
                // Repeated text may fill separate roles only when the draft
                // supplies enough independent occurrences for every claim.
                if input.text.matches(span).count() < claimed {
                    return Err(extraction_failure(ExtractionFailure::OverlappingFields));
                }
            }
        }
        Ok(Value::Object(fields))
    }
}
