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

env_vars! {
    /// Server-side OpenAI credential, injected as `OPENAI_API_KEY`. Never
    /// exposed to the browser.
    pub struct OpenaiApiKey;
}

const MODEL: &str = "whisper-1";
/// Per-attempt HTTP timeout; recordings are capped at five minutes.
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
    #[serde(default)]
    duration: f32,
}

impl WhisperTranscriber {
    /// Construct once at startup against the public OpenAI API.
    pub fn new(api_key: &OpenaiApiKey) -> Result<Self, reqwest::Error> {
        Self::with_api_base(api_key, None)
    }

    /// Read `OPENAI_API_KEY` and construct the client; fails fast when unset.
    pub fn try_from_env() -> Result<Self, WhisperConfigError> {
        let api_key = OpenaiApiKey::new()?;
        Ok(Self::new(&api_key)?)
    }

    /// Construct against a custom API base, e.g. a test server.
    pub fn with_api_base(
        api_key: &OpenaiApiKey,
        api_base: Option<&str>,
    ) -> Result<Self, reqwest::Error> {
        let mut config = OpenAIConfig::new().with_api_key(api_key.as_ref());
        if let Some(api_base) = api_base {
            config = config.with_api_base(api_base);
        }
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

/// Startup failures for [`WhisperTranscriber::try_from_env`].
#[derive(Debug, thiserror::Error)]
pub enum WhisperConfigError {
    /// `OPENAI_API_KEY` is missing.
    #[error(transparent)]
    MissingApiKey(#[from] macro_env_var::VarNameErr),
    /// The HTTP client could not be constructed.
    #[error(transparent)]
    HttpClient(#[from] reqwest::Error),
}

impl TranscriptionProvider for WhisperTranscriber {
    #[tracing::instrument(skip_all, err, fields(format = ?recording.format()))]
    async fn transcribe(&self, recording: Recording) -> Result<Transcript, DictationError> {
        let (bytes, format, language) = recording.into_parts();
        let request = CreateTranscriptionRequest {
            file: AudioInput::from_bytes(format.filename(), bytes),
            model: MODEL.to_owned(),
            language: language.map(|hint| hint.to_string()),
            response_format: Some(AudioResponseFormat::VerboseJson),
            ..Default::default()
        };
        let response: VerboseTranscription = self
            .client
            .audio()
            .transcription()
            .create_verbose_json_byot(request)
            .await
            .map_err(|error| {
                match &error {
                    OpenAIError::ApiError(api_error) => tracing::warn!(
                        code = ?api_error.code,
                        kind = ?api_error.r#type,
                        "Whisper rejected the request"
                    ),
                    OpenAIError::Reqwest(error) => tracing::warn!(
                        status = ?error.status(),
                        timeout = error.is_timeout(),
                        "Whisper request failed"
                    ),
                    other => tracing::warn!(error = %other, "Whisper response unusable"),
                }
                DictationError::Provider
            })?;
        Ok(Transcript {
            text: response.text,
            duration_seconds: response.duration,
        })
    }
}

#[cfg(test)]
mod test;
