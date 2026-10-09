//! TypeSafe adapter for the [`JevProvider`] port.
//!
//! Every question goes out as a `noul` (yes/no) question in one
//! `POST /v1/systemone` request whose `state` is the caller's JSON input.
//! The adapter never logs the input, the questions, or response bodies.

use std::{collections::HashMap, time::Duration};

use macro_env_var::maybe_env_var;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::domain::{Evaluation, JevError, JevProvider, Probability, YesNoQuestion};

#[cfg(test)]
mod test;

maybe_env_var! {
    /// TypeSafe API credential, injected as `TYPESAFE_API_KEY`. Hosts turn
    /// Jev-backed features off when it is unset.
    pub struct TypesafeApiKey;
}

const DEFAULT_BASE_URL: &str = "https://api.typesafe.ai";
const MODEL: &str = "jev-latest";
/// Per-attempt deadline. Jev answers in well under a second when healthy.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
/// Waits before each retry of a timed-out, rate-limited, overloaded or
/// failed request. Rejections and malformed responses are not retried.
const RETRY_DELAYS: [Duration; 2] = [Duration::from_millis(250), Duration::from_secs(1)];
/// TypeSafe's "overloaded" status.
const OVERLOADED: u16 = 529;

/// Yes/no evaluation through TypeSafe's hosted Jev model.
pub struct TypesafeJev {
    client: Client,
    endpoint: String,
    api_key: String,
}

impl TypesafeJev {
    /// Construct once at startup against the public TypeSafe API.
    pub fn new(api_key: &str) -> Result<Self, TypesafeConfigError> {
        Self::with_base_url(api_key, DEFAULT_BASE_URL)
    }

    /// Construct against another API base, e.g. a test server.
    pub fn with_base_url(api_key: &str, base_url: &str) -> Result<Self, TypesafeConfigError> {
        let api_key = api_key.trim();
        if api_key.is_empty() {
            return Err(TypesafeConfigError::EmptyApiKey);
        }
        Ok(Self {
            client: Client::builder().timeout(REQUEST_TIMEOUT).build()?,
            endpoint: format!("{}/v1/systemone", base_url.trim_end_matches('/')),
            api_key: api_key.to_owned(),
        })
    }

    async fn send(&self, request: &EvaluateRequest<'_>) -> Result<EvaluateResponse, JevError> {
        let span = tracing::Span::current();
        let response = self
            .client
            .post(&self.endpoint)
            .bearer_auth(&self.api_key)
            .json(request)
            .send()
            .await
            .map_err(|error| {
                let kind = if error.is_timeout() {
                    "timeout"
                } else if error.is_connect() {
                    "connection"
                } else {
                    "http"
                };
                span.record("error.type", kind);
                tracing::warn!(kind, "Jev request failed");
                JevError::Unavailable
            })?;
        let status = response.status();
        span.record("http.response.status_code", status.as_u16());
        if !status.is_success() {
            let error = status_error(status);
            span.record("error.type", status.as_str());
            tracing::warn!(status = status.as_u16(), "Jev request failed");
            return Err(error);
        }
        response.json().await.map_err(|error| {
            let kind = if error.is_timeout() {
                "timeout"
            } else {
                "invalid_response"
            };
            span.record("error.type", kind);
            tracing::warn!(kind, "Jev response unusable");
            if error.is_timeout() {
                JevError::Unavailable
            } else {
                JevError::InvalidResponse
            }
        })
    }
}

/// Startup failures for [`TypesafeJev::new`].
#[derive(Debug, thiserror::Error)]
pub enum TypesafeConfigError {
    /// The credential contains no usable key.
    #[error("TYPESAFE_API_KEY must not be empty")]
    EmptyApiKey,
    /// The HTTP client could not be constructed.
    #[error(transparent)]
    HttpClient(#[from] reqwest::Error),
}

impl JevProvider for TypesafeJev {
    fn model_id(&self) -> &'static str {
        MODEL
    }

    #[tracing::instrument(name = "classify jev-latest", skip_all, err, fields(
        otel.kind = "client",
        gen_ai.operation.name = "classify",
        gen_ai.provider.name = "typesafe",
        gen_ai.request.model = MODEL,
        gen_ai.response.model = tracing::field::Empty,
        gen_ai.usage.input_tokens = tracing::field::Empty,
        gen_ai.usage.output_tokens = tracing::field::Empty,
        jev.questions = questions.len(),
        jev.attempts = tracing::field::Empty,
        http.response.status_code = tracing::field::Empty,
        error.type = tracing::field::Empty,
    ))]
    async fn evaluate(
        &self,
        input: &Value,
        questions: &[YesNoQuestion],
    ) -> Result<Evaluation, JevError> {
        let span = tracing::Span::current();
        let request = EvaluateRequest::new(input, questions);
        let mut retries = RETRY_DELAYS.iter();
        let mut attempts = 1_u8;
        let response = loop {
            match self.send(&request).await {
                Err(JevError::Unavailable) => match retries.next() {
                    Some(delay) => {
                        tokio::time::sleep(*delay).await;
                        attempts += 1;
                    }
                    None => {
                        span.record("jev.attempts", attempts);
                        return Err(JevError::Unavailable);
                    }
                },
                result => {
                    span.record("jev.attempts", attempts);
                    break result?;
                }
            }
        };
        if let Some(model) = &response.model {
            span.record("gen_ai.response.model", model.as_str());
        }
        span.record("gen_ai.usage.input_tokens", response.usage.input_tokens);
        span.record("gen_ai.usage.output_tokens", response.usage.output_tokens);
        response.into_evaluation(questions.len()).inspect_err(|_| {
            span.record("error.type", "invalid_response");
            tracing::warn!(kind = "invalid_response", "Jev answers unusable");
        })
    }
}

fn status_error(status: StatusCode) -> JevError {
    if status == StatusCode::TOO_MANY_REQUESTS
        || status == StatusCode::REQUEST_TIMEOUT
        || status.as_u16() == OVERLOADED
        || status.is_server_error()
    {
        JevError::Unavailable
    } else {
        JevError::Rejected
    }
}

fn question_id(index: usize) -> String {
    format!("q{index}")
}

#[derive(Debug, Serialize)]
struct EvaluateRequest<'a> {
    model: &'static str,
    state: &'a Value,
    questions: HashMap<String, NoulQuestion<'a>>,
}

impl<'a> EvaluateRequest<'a> {
    fn new(input: &'a Value, questions: &'a [YesNoQuestion]) -> Self {
        Self {
            model: MODEL,
            state: input,
            questions: questions
                .iter()
                .enumerate()
                .map(|(index, question)| {
                    (
                        question_id(index),
                        NoulQuestion {
                            kind: "noul",
                            instructions: question.as_str(),
                        },
                    )
                })
                .collect(),
        }
    }
}

#[derive(Debug, Serialize)]
struct NoulQuestion<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    instructions: &'a str,
}

#[derive(Debug, Deserialize)]
struct EvaluateResponse {
    model: Option<String>,
    answers: HashMap<String, Answer>,
    usage: Usage,
}

impl EvaluateResponse {
    fn into_evaluation(mut self, questions: usize) -> Result<Evaluation, JevError> {
        let probabilities = (0..questions)
            .map(|index| match self.answers.remove(&question_id(index)) {
                Some(Answer::Noul { noul }) => Probability::new(noul),
                Some(Answer::Other) | None => None,
            })
            .collect::<Option<Vec<_>>>()
            .ok_or(JevError::InvalidResponse)?;
        Ok(Evaluation {
            probabilities,
            input_tokens: self.usage.input_tokens,
            output_tokens: self.usage.output_tokens,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Answer {
    Noul {
        noul: f32,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct Usage {
    input_tokens: u64,
    output_tokens: u64,
}
