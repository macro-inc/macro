//! Dictation domain: recording value objects, the provider port, and the
//! transcription use case. No transport or infrastructure lives here.

pub mod models;
pub mod ports;
pub mod service;

pub use models::{
    AudioFormat, DictationError, LanguageHint, MAX_AUDIO_BYTES, Recording, Transcript,
};
pub use ports::{DictationService, TranscriptionProvider};
pub use service::DictationServiceImpl;
