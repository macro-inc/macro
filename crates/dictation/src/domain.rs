//! Dictation policy and the provider port; no subscription or credit gates.

use std::future::Future;
use tokio::sync::Semaphore;

/// Maximum in-memory recording accepted by the service.
pub const MAX_AUDIO_BYTES: usize = 8 * 1024 * 1024;
const MAX_CONCURRENT_TRANSCRIPTIONS: usize = 16;

/// A supported browser recording container.
#[derive(Clone, Copy, Debug)]
pub enum AudioFormat {
    /// WebM/Opus, typically produced by Chromium.
    Webm,
    /// MP4/AAC, typically produced by Safari.
    Mp4,
    /// Ogg/Opus, produced by Firefox.
    Ogg,
    /// PCM WAV.
    Wav,
}

impl AudioFormat {
    /// Parse the media type, ignoring codec parameters.
    pub fn from_content_type(value: &str) -> Result<Self, DictationError> {
        match value.split(';').next().unwrap_or_default().trim() {
            "audio/webm" | "video/webm" => Ok(Self::Webm),
            "audio/mp4" | "video/mp4" | "audio/x-m4a" => Ok(Self::Mp4),
            "audio/ogg" => Ok(Self::Ogg),
            "audio/wav" | "audio/x-wav" => Ok(Self::Wav),
            _ => Err(DictationError::UnsupportedAudio),
        }
    }

    /// MIME type sent to the provider.
    pub fn mime(self) -> &'static str {
        match self {
            Self::Webm => "audio/webm",
            Self::Mp4 => "audio/mp4",
            Self::Ogg => "audio/ogg",
            Self::Wav => "audio/wav",
        }
    }

    /// Fixed filename, independent of user input.
    pub fn filename(self) -> &'static str {
        match self {
            Self::Webm => "dictation.webm",
            Self::Mp4 => "dictation.mp4",
            Self::Ogg => "dictation.ogg",
            Self::Wav => "dictation.wav",
        }
    }
}

/// Transient recording; never stored as a document or attachment.
pub struct Recording {
    /// Encoded audio bytes.
    pub bytes: Vec<u8>,
    /// Browser recording container.
    pub format: AudioFormat,
    /// Optional ISO-639-1 recognition hint.
    pub language: Option<String>,
}

/// Provider result, including billable duration for operational metering.
pub struct Transcript {
    /// Recognized text in the original language.
    pub text: String,
    /// Audio duration reported by the provider.
    pub duration_seconds: f64,
}

/// Errors exposed by the dictation use case.
#[derive(Debug, thiserror::Error)]
pub enum DictationError {
    /// Empty or oversized audio.
    #[error("Recording must contain between 1 byte and 8 MB")]
    InvalidSize,
    /// Unsupported media container.
    #[error("Unsupported audio format")]
    UnsupportedAudio,
    /// Malformed language hint.
    #[error("Language must be a two-letter ISO language code")]
    InvalidLanguage,
    /// Capacity protection, independent of plan or billing.
    #[error("Dictation is busy. Please try again")]
    Busy,
    /// Provider failed; adapter logs only status, never content or credentials.
    #[error("Transcription failed. Please try again")]
    Provider,
}

/// External speech-to-text capability.
pub trait TranscriptionProvider: Send + Sync {
    /// Transcribe an in-memory recording.
    fn transcribe(
        &self,
        recording: Recording,
    ) -> impl Future<Output = Result<Transcript, DictationError>> + Send;
}

/// Shared policy for authenticated users on every plan.
pub struct DictationService<P> {
    provider: P,
    capacity: Semaphore,
}

impl<P: TranscriptionProvider> DictationService<P> {
    /// Build a service with a bounded number of concurrent provider requests.
    pub fn new(provider: P) -> Self {
        Self {
            provider,
            capacity: Semaphore::new(MAX_CONCURRENT_TRANSCRIPTIONS),
        }
    }

    /// Validate and transcribe. Authentication is required by the inbound adapter;
    /// dictation deliberately never consumes chat credits or checks subscriptions.
    pub async fn transcribe(&self, recording: Recording) -> Result<String, DictationError> {
        if recording.bytes.is_empty() || recording.bytes.len() > MAX_AUDIO_BYTES {
            return Err(DictationError::InvalidSize);
        }
        if recording.language.as_ref().is_some_and(|lang| {
            lang.len() != 2 || !lang.bytes().all(|byte| byte.is_ascii_lowercase())
        }) {
            return Err(DictationError::InvalidLanguage);
        }
        let _permit = self
            .capacity
            .try_acquire()
            .map_err(|_| DictationError::Busy)?;
        let result = self.provider.transcribe(recording).await?;
        // Meter all successful provider calls without charging user credits or
        // recording audio/transcript content. Whisper bills $0.006 per minute.
        tracing::info!(
            model = "whisper-1",
            audio_seconds = result.duration_seconds,
            estimated_cost_usd = result.duration_seconds / 60.0 * 0.006,
            "dictation usage"
        );
        Ok(result.text.trim().to_owned())
    }
}

#[cfg(test)]
mod test;
