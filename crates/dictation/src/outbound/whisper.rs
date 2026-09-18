//! OpenAI Whisper adapter for the [`TranscriptionProvider`] port.
//!
//! `/v1/audio/transcriptions` is eligible for OpenAI's Zero Data Retention and
//! has no abuse-monitoring retention by default, so an enterprise key with ZDR
//! can serve dictation without audio or transcripts being stored by the
//! provider. This adapter never logs either.

use crate::domain::{DictationError, Recording, Transcript, TranscriptionProvider};
use async_openai::{
    Client,
    config::OpenAIConfig,
    error::OpenAIError,
    types::audio::{AudioInput, AudioResponseFormat, CreateTranscriptionRequest},
};
use macro_env_var::env_vars;
use serde::Deserialize;
use std::time::Duration;
use tracing::instrument::WithSubscriber;

env_vars! {
    /// Server-side OpenAI credential, injected as `OPENAI_API_KEY`. Never
    /// exposed to the browser.
    pub struct OpenaiApiKey;
}

const MODEL: &str = "whisper-1";
/// Overall request deadline, including the SDK's retries.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(90);
/// Total budget for retrying provider 429/5xx responses before giving up.
const RETRY_BUDGET: Duration = Duration::from_secs(10);

/// Speech-to-text through OpenAI Whisper.
pub struct WhisperTranscriber {
    client: Client<OpenAIConfig>,
}

/// The subset of the `verbose_json` response this adapter relies on.
#[derive(Deserialize)]
struct VerboseTranscription {
    text: String,
    duration: f32,
}

impl WhisperTranscriber {
    /// Construct once at startup against the public OpenAI API.
    pub fn new(api_key: &OpenaiApiKey) -> Result<Self, WhisperConfigError> {
        Self::with_api_base(api_key, None)
    }

    /// Construct against a custom API base, e.g. a test server.
    pub fn with_api_base(
        api_key: &OpenaiApiKey,
        api_base: Option<&str>,
    ) -> Result<Self, WhisperConfigError> {
        if api_key.trim().is_empty() {
            return Err(WhisperConfigError::EmptyApiKey);
        }
        let config = OpenAIConfig::new()
            .with_api_key(api_key.as_ref())
            .with_api_base(api_base.unwrap_or("https://api.openai.com/v1"));
        let http_client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()?;
        let backoff = backoff::ExponentialBackoffBuilder::new()
            .with_max_elapsed_time(Some(RETRY_BUDGET))
            .build();
        Ok(Self {
            client: Client::build(http_client, config, backoff),
        })
    }
}

/// Startup failures for [`WhisperTranscriber::new`].
#[derive(Debug, thiserror::Error)]
pub enum WhisperConfigError {
    /// The required credential contains no usable key.
    #[error("OPENAI_API_KEY must not be empty")]
    EmptyApiKey,
    /// The HTTP client could not be constructed.
    #[error(transparent)]
    HttpClient(#[from] reqwest::Error),
}

impl TranscriptionProvider for WhisperTranscriber {
    fn model_id(&self) -> &'static str {
        MODEL
    }

    #[tracing::instrument(name = "transcribe whisper-1", skip_all, err, fields(
        otel.kind = "client",
        gen_ai.operation.name = "transcribe",
        gen_ai.provider.name = "openai",
        gen_ai.request.model = MODEL,
        audio.format = recording.format().extension(),
        audio.bytes = recording.bytes().len(),
        audio.duration_seconds = tracing::field::Empty,
        error.type = tracing::field::Empty,
    ))]
    async fn transcribe(&self, recording: Recording) -> Result<Transcript, DictationError> {
        let (bytes, format, language) = recording.into_parts();
        let request = CreateTranscriptionRequest {
            file: AudioInput::from_bytes(format.filename(), bytes),
            model: MODEL.to_owned(),
            language: language.map(|hint| hint.to_string()),
            response_format: Some(AudioResponseFormat::VerboseJson),
            ..Default::default()
        };
        let audio_api = self.client.audio();
        let transcriptions = audio_api.transcription();
        let transcription =
            transcriptions.create_verbose_json_byot::<_, VerboseTranscription>(request);
        // async-openai 0.36 logs raw response bodies on parse/HTTP failures.
        // Scope a silent subscriber to this future's polls only; our surrounding
        // span and sanitized diagnostics remain visible, including after await.
        let response = tokio::time::timeout(
            REQUEST_TIMEOUT,
            transcription.with_subscriber(tracing::Dispatch::none()),
        )
        .await
        .map_err(|_| {
            tracing::Span::current().record("error.type", "timeout");
            tracing::warn!(kind = "timeout", "Whisper request failed");
            DictationError::Provider
        })?
        .map_err(|error| {
            let kind = match &error {
                OpenAIError::Reqwest(error) if error.is_timeout() => "timeout",
                OpenAIError::Reqwest(error) if error.is_connect() => "connection",
                OpenAIError::Reqwest(_) => "http",
                OpenAIError::ApiError(_) => "provider_rejection",
                OpenAIError::JSONDeserialize(..) => "invalid_response",
                _ => "client_error",
            };
            tracing::Span::current().record("error.type", kind);
            // ApiError discards HTTP headers/status. Only Reqwest retains status;
            // never recover it by logging the SDK error or its raw body.
            let status = match &error {
                OpenAIError::Reqwest(error) => error.status().map(|status| status.as_u16()),
                _ => None,
            };
            tracing::warn!(kind, status, "Whisper request failed");
            DictationError::Provider
        })?;
        if !response.duration.is_finite() || response.duration <= 0.0 {
            tracing::Span::current().record("error.type", "invalid_duration");
            tracing::warn!(kind = "invalid_duration", "Whisper response unusable");
            return Err(DictationError::Provider);
        }
        tracing::Span::current().record("audio.duration_seconds", response.duration);
        Ok(Transcript {
            text: response.text,
            duration_seconds: response.duration,
        })
    }
}

#[cfg(test)]
mod test;
