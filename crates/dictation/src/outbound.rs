//! Outbound adapters implementing the dictation ports.

pub mod whisper;

pub use whisper::{OpenaiApiKey, WhisperTranscriber};
