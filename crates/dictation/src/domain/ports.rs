//! Ports: the use case exposed to inbound adapters and the capability it needs.

use super::models::{DictationError, LanguageHint, Recording, Transcript};
use bytes::Bytes;
use macro_user_id::user_id::MacroUserIdStr;
use std::future::Future;

/// External speech-to-text capability, implemented by outbound adapters.
pub trait TranscriptionProvider: Send + Sync + 'static {
    /// Transcribe a validated in-memory recording.
    fn transcribe(
        &self,
        recording: Recording,
    ) -> impl Future<Output = Result<Transcript, DictationError>> + Send;
}

/// The dictation use case, called by inbound adapters on behalf of an
/// authenticated user.
pub trait DictationService: Send + Sync + 'static {
    /// Validate encoded audio and transcribe it for `user`.
    ///
    /// Authentication happens at the edge; the user is passed in only for
    /// usage metering. Dictation never consumes chat credits or checks plans.
    fn transcribe(
        &self,
        user: MacroUserIdStr<'static>,
        audio: Bytes,
        language: Option<LanguageHint>,
    ) -> impl Future<Output = Result<Transcript, DictationError>> + Send;
}
