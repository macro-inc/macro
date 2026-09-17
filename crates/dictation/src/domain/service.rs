//! The transcription use case.

use super::{
    models::{DictationError, LanguageHint, Recording, Transcript},
    ports::{DictationService, TranscriptionProvider},
};
use bytes::Bytes;
use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::Semaphore;

/// Upper bound on in-flight provider requests across all users.
const MAX_CONCURRENT_TRANSCRIPTIONS: usize = 16;
/// Whisper list price, used only for an operational cost estimate in logs.
const WHISPER_USD_PER_MINUTE: f32 = 0.006;

/// Dictation for authenticated users on every plan.
pub struct DictationServiceImpl<P> {
    provider: P,
    capacity: Semaphore,
}

impl<P: TranscriptionProvider> DictationServiceImpl<P> {
    /// Build a service with a bounded number of concurrent provider requests.
    pub fn new(provider: P) -> Self {
        Self {
            provider,
            capacity: Semaphore::new(MAX_CONCURRENT_TRANSCRIPTIONS),
        }
    }

    #[cfg(test)]
    pub(super) fn capacity(&self) -> &Semaphore {
        &self.capacity
    }
}

impl<P: TranscriptionProvider> DictationService for DictationServiceImpl<P> {
    #[tracing::instrument(skip_all, err, fields(user = %user))]
    async fn transcribe(
        &self,
        user: MacroUserIdStr<'static>,
        audio: Bytes,
        language: Option<LanguageHint>,
    ) -> Result<Transcript, DictationError> {
        let recording = Recording::new(audio, language)?;
        let _permit = self
            .capacity
            .try_acquire()
            .map_err(|_| DictationError::Busy)?;
        let transcript = self.provider.transcribe(recording).await?;
        // Meter every successful provider call without charging user credits and
        // without recording audio or transcript content.
        tracing::info!(
            audio_seconds = transcript.duration_seconds,
            estimated_cost_usd = transcript.duration_seconds / 60.0 * WHISPER_USD_PER_MINUTE,
            "dictation usage"
        );
        Ok(Transcript {
            text: transcript.text.trim().to_owned(),
            duration_seconds: transcript.duration_seconds,
        })
    }
}

#[cfg(test)]
mod test;
