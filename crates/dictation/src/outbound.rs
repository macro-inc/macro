//! OpenAI Whisper HTTP adapter.
use crate::domain::{DictationError, Recording, Transcript, TranscriptionProvider};
use reqwest::{Client, multipart};
use serde::Deserialize;
use std::time::Duration;

/// Uses the application's existing server-side OpenAI credential.
pub struct WhisperClient {
    client: Client,
    api_key: String,
    endpoint: String,
}

impl WhisperClient {
    /// Construct once at startup; never expose this credential to the browser.
    pub fn new(api_key: String) -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: Client::builder().timeout(Duration::from_secs(90)).build()?,
            api_key,
            endpoint: "https://api.openai.com/v1/audio/transcriptions".into(),
        })
    }
}

#[derive(Deserialize)]
struct WhisperResponse {
    text: String,
    duration: f64,
}

impl TranscriptionProvider for WhisperClient {
    async fn transcribe(&self, recording: Recording) -> Result<Transcript, DictationError> {
        let file = multipart::Part::bytes(recording.bytes)
            .file_name(recording.format.filename())
            .mime_str(recording.format.mime())
            .map_err(|_| DictationError::UnsupportedAudio)?;
        let mut form = multipart::Form::new()
            .text("model", "whisper-1")
            .text("response_format", "verbose_json")
            .part("file", file);
        if let Some(language) = recording.language {
            form = form.text("language", language);
        }
        let response = self
            .client
            .post(&self.endpoint)
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|_| DictationError::Provider)?;
        if !response.status().is_success() {
            tracing::warn!(
                status = response.status().as_u16(),
                "Whisper request failed"
            );
            return Err(DictationError::Provider);
        }
        let response: WhisperResponse = response
            .json()
            .await
            .map_err(|_| DictationError::Provider)?;
        Ok(Transcript {
            text: response.text,
            duration_seconds: response.duration,
        })
    }
}

#[cfg(test)]
mod test;
