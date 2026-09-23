//! Dictation domain: recording value objects, the provider port, and the
//! transcription use case. No transport or infrastructure lives here.

pub mod models;
pub mod ports;
pub mod service;

pub use models::{
    AudioFormat, DictationError, LanguageHint, MAX_AUDIO_BYTES, MAX_AUDIO_DURATION, Recording,
    Transcript,
};
pub use ports::{DictationService, RecordingInspector, TranscriptionProvider};
pub use service::DictationServiceImpl;
