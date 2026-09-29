//! Value objects for a transient dictation recording.

use bytes::Bytes;
use std::time::Duration;
use std::{fmt, str::FromStr};

/// Maximum encoded recording accepted by the service.
pub const MAX_AUDIO_BYTES: usize = 8 * 1024 * 1024;

/// Maximum audio duration accepted before invoking the paid provider.
pub const MAX_AUDIO_DURATION: Duration = Duration::from_secs(5 * 60);

/// Browser recording containers accepted for transcription.
///
/// The container is detected from the encoded bytes with [`infer`] rather than
/// trusted from a caller-supplied content type, so the provider always receives
/// a filename whose extension matches the audio it is given.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AudioFormat {
    /// WebM/Opus, produced by Chromium-based browsers.
    Webm,
    /// MP4/AAC (including M4A), produced by Safari.
    Mp4,
    /// Ogg/Opus, produced by Firefox.
    Ogg,
    /// PCM WAV.
    Wav,
}

impl AudioFormat {
    /// Detect the container from the leading bytes of a recording.
    pub fn detect(bytes: &[u8]) -> Result<Self, DictationError> {
        let kind = infer::get(bytes).ok_or(DictationError::UnsupportedAudio)?;
        match kind.mime_type() {
            "video/webm" => Ok(Self::Webm),
            "video/mp4" | "audio/m4a" => Ok(Self::Mp4),
            // Providers accept `.ogg` but not `.opus`, so Ogg Opus maps to Ogg.
            "audio/ogg" | "audio/opus" => Ok(Self::Ogg),
            "audio/x-wav" => Ok(Self::Wav),
            _ => Err(DictationError::UnsupportedAudio),
        }
    }

    /// File extension the provider uses to pick a decoder.
    pub fn extension(self) -> &'static str {
        match self {
            Self::Webm => "webm",
            Self::Mp4 => "mp4",
            Self::Ogg => "ogg",
            Self::Wav => "wav",
        }
    }

    /// Fixed upload filename, independent of user input.
    pub fn filename(self) -> String {
        format!("dictation.{}", self.extension())
    }
}

/// An ISO 639-1 language hint: exactly two lowercase ASCII letters.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LanguageHint(String);

impl LanguageHint {
    /// The validated two-letter code.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl FromStr for LanguageHint {
    type Err = DictationError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let valid = value.len() == 2 && value.bytes().all(|byte| byte.is_ascii_lowercase());
        valid
            .then(|| Self(value.to_owned()))
            .ok_or(DictationError::InvalidLanguage)
    }
}

impl fmt::Display for LanguageHint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A validated, in-memory recording. Never persisted as a document or attachment.
#[derive(Clone, Debug)]
pub struct Recording {
    bytes: Bytes,
    format: AudioFormat,
    language: Option<LanguageHint>,
}

impl Recording {
    /// Validate the size and detect the container of encoded audio.
    pub fn new(bytes: Bytes, language: Option<LanguageHint>) -> Result<Self, DictationError> {
        if bytes.is_empty() || bytes.len() > MAX_AUDIO_BYTES {
            return Err(DictationError::InvalidSize);
        }
        let format = AudioFormat::detect(&bytes)?;
        Ok(Self {
            bytes,
            format,
            language,
        })
    }

    /// Encoded audio.
    pub fn bytes(&self) -> &Bytes {
        &self.bytes
    }

    /// Detected container.
    pub fn format(&self) -> AudioFormat {
        self.format
    }

    /// Optional recognition hint.
    pub fn language(&self) -> Option<&LanguageHint> {
        self.language.as_ref()
    }

    /// Decompose into the provider request parts.
    pub fn into_parts(self) -> (Bytes, AudioFormat, Option<LanguageHint>) {
        (self.bytes, self.format, self.language)
    }
}

/// Provider result, including billable duration for operational metering.
#[derive(Clone, Debug, PartialEq)]
pub struct Transcript {
    /// Recognized text in the original language.
    pub text: String,
    /// Audio duration reported by the provider, in seconds.
    pub duration_seconds: f32,
}

/// Errors exposed by the dictation use case.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DictationError {
    /// Empty or oversized audio.
    #[error("Recording must contain between 1 byte and 8 MB of audio")]
    InvalidSize,
    /// The bytes are not a supported audio container.
    #[error("Unsupported audio format")]
    UnsupportedAudio,
    /// A recognized container contains no usable audio packets.
    #[error("Recording is incomplete or contains no audio")]
    InvalidAudio,
    /// The encoded audio timeline exceeds the dictation duration limit.
    #[error("Recording must be no longer than five minutes")]
    TooLong,
    /// Malformed language hint.
    #[error("Language must be a two-letter ISO 639-1 code")]
    InvalidLanguage,
    /// Provider concurrency guard, independent of per-user rate limits.
    #[error("Dictation is busy. Please try again")]
    Busy,
    /// The provider failed; the adapter logs status only, never audio or text.
    #[error("Transcription failed. Please try again")]
    Provider,
}
