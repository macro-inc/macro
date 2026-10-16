//! Pooled, authenticated HTTP access to the existing cognition endpoints.

use crate::domain::{
    Cognition, CognitionError, DecisionRequest, DecisionResponse, GenerateObjectRequest,
    GenerateObjectResponse, ModelId,
};
use async_trait::async_trait;
use macro_authorization::{INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER};
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::{Client, Url, header::HeaderValue};
use rootcause::Report;
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::time::Duration;

#[cfg(test)]
mod test;

const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(28);

/// One reusable connection pool with server-owned credentials and destination.
#[derive(Clone)]
pub struct CognitionClient {
    client: Client,
    base: Url,
    key: HeaderValue,
    default_model: ModelId,
    timeout: Duration,
}

impl CognitionClient {
    /// Validate configuration and construct a client with a 28-second deadline.
    /// Redirects and automatic retries are disabled; requests can incur AI usage.
    pub fn new(base: &str, key: &str, default_model: &str) -> Result<Self, Report> {
        Self::with_timeout(base, key, default_model, REQUEST_TIMEOUT)
    }

    fn with_timeout(
        base: &str,
        key: &str,
        default_model: &str,
        timeout: Duration,
    ) -> Result<Self, Report> {
        let base = Url::parse(&format!("{}/", base.trim_end_matches('/')))
            .map_err(|_| rootcause::report!("Invalid cognition service URL"))?;
        if !matches!(base.scheme(), "http" | "https")
            || base.host_str().is_none()
            || !base.username().is_empty()
            || base.password().is_some()
            || base.query().is_some()
            || base.fragment().is_some()
        {
            return Err(rootcause::report!(
                "Cognition requires a trusted HTTP(S) base URL without credentials, query, or fragment"
            ));
        }
        if key.trim().is_empty() || key.trim() != key || timeout.is_zero() {
            return Err(rootcause::report!("Invalid cognition client configuration"));
        }
        let mut key = HeaderValue::from_str(key)
            .map_err(|_| rootcause::report!("Invalid cognition service credential"))?;
        key.set_sensitive(true);
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()
            .map_err(transport_error)?;
        Ok(Self {
            client,
            base,
            key,
            default_model: ModelId::try_from(default_model.to_owned())?,
            timeout,
        })
    }

    async fn request<T: DeserializeOwned>(
        &self,
        user: &MacroUserIdStr<'static>,
        path: &str,
        body: Value,
    ) -> Result<T, Report> {
        let request = async {
            let mut headers = reqwest::header::HeaderMap::new();
            macro_tower_layers::inject_trace_headers(&mut headers);
            let mut response = self
                .client
                .post(self.base.join(path)?)
                .headers(headers)
                .header(INTERNAL_API_KEY_HEADER, self.key.clone())
                .header(INTERNAL_MACRO_USER_ID_HEADER, user.as_ref())
                .json(&body)
                .send()
                .await
                .map_err(transport_error)?;
            let error = match response.status().as_u16() {
                200..=299 => None,
                400 | 422 => Some(CognitionError::Rejected),
                401 => Some(CognitionError::Unauthenticated),
                402 => Some(CognitionError::AllowanceExceeded),
                403 => Some(CognitionError::Forbidden),
                413 => Some(CognitionError::RequestTooLarge),
                429 | 503 => Some(CognitionError::Busy),
                408 | 504 => Some(CognitionError::Timeout),
                _ => Some(CognitionError::InvalidResponse),
            };
            if let Some(error) = error {
                // Provider error bodies can contain prompt text or credentials.
                return Err(error.into());
            }
            if response
                .content_length()
                .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
            {
                return Err(CognitionError::ResponseTooLarge.into());
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(transport_error)? {
                if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
                    return Err(CognitionError::ResponseTooLarge.into());
                }
                bytes.extend_from_slice(&chunk);
            }
            serde_json::from_slice(&bytes).map_err(|_| CognitionError::InvalidResponse.into())
        };
        tokio::time::timeout(self.timeout, request)
            .await
            .map_err(|_| CognitionError::Timeout)?
    }
}

#[async_trait]
impl Cognition for CognitionClient {
    #[tracing::instrument(skip_all, err)]
    async fn generate_object(
        &self,
        user: &MacroUserIdStr<'static>,
        request: GenerateObjectRequest,
    ) -> Result<GenerateObjectResponse, Report> {
        request.validate()?;
        let response: CompletionResponse = self
            .request(
                user,
                "structured-completion",
                json!({
                    "prompt": request.prompt,
                    "model": request.model.as_ref().unwrap_or(&self.default_model).as_str(),
                    "additional_instructions": request.system,
                    "output_schema": { "name": "result", "schema": request.schema },
                    "toolset": { "type": "none" },
                }),
            )
            .await?;
        match response.outcome {
            CompletionOutcome::Completed { result }
                if result.is_object() && response.tool_activity.is_empty() =>
            {
                Ok(GenerateObjectResponse { object: result })
            }
            _ => Err(CognitionError::InvalidResponse.into()),
        }
    }

    #[tracing::instrument(skip_all, err)]
    async fn decide(
        &self,
        user: &MacroUserIdStr<'static>,
        request: DecisionRequest,
    ) -> Result<DecisionResponse, Report> {
        request.validate()?;
        let response: DecisionResponse = self
            .request(user, "decisions", serde_json::to_value(&request)?)
            .await?;
        if response.probabilities.len() != request.questions.len()
            || response.probabilities.iter().any(|(name, probability)| {
                !request.questions.contains_key(name)
                    || !probability.is_finite()
                    || !(0.0..=1.0).contains(probability)
            })
        {
            return Err(CognitionError::InvalidResponse.into());
        }
        Ok(response)
    }
}

#[derive(Deserialize)]
struct CompletionResponse {
    outcome: CompletionOutcome,
    #[serde(rename = "toolActivity")]
    tool_activity: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum CompletionOutcome {
    Completed { result: Value },
    Interrupted,
}

#[derive(Debug, thiserror::Error)]
#[error("Cognition transport failed. The service may be unavailable; retry later.")]
struct TransportError(#[source] reqwest::Error);

fn transport_error(error: reqwest::Error) -> Report {
    if error.is_timeout() {
        CognitionError::Timeout.into()
    } else {
        TransportError(error.without_url()).into()
    }
}
