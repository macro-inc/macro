//! Outbound adapters implementing the dictation ports.

pub mod media;
pub mod whisper;

pub use media::SymphoniaRecordingInspector;
pub use whisper::{OpenaiApiKey, WhisperTranscriber};
