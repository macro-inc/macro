use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

struct Provider(AtomicUsize);
impl TranscriptionProvider for Provider {
    async fn transcribe(&self, _recording: Recording) -> Result<Transcript, DictationError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(Transcript {
            text: "  hello world  ".into(),
            duration_seconds: 2.0,
        })
    }
}
fn recording() -> Recording {
    Recording {
        bytes: vec![1],
        format: AudioFormat::Webm,
        language: Some("en".into()),
    }
}
#[tokio::test]
async fn transcribes_without_subscription_or_credit_requirements() {
    let service = DictationService::new(Provider(AtomicUsize::new(0)));
    assert_eq!(
        service.transcribe(recording()).await.unwrap(),
        "hello world"
    );
    assert_eq!(service.provider.0.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn rejects_invalid_input_before_calling_provider() {
    let service = DictationService::new(Provider(AtomicUsize::new(0)));
    for bytes in [vec![], vec![0; MAX_AUDIO_BYTES + 1]] {
        assert!(matches!(
            service
                .transcribe(Recording {
                    bytes,
                    ..recording()
                })
                .await,
            Err(DictationError::InvalidSize)
        ));
    }
    assert!(matches!(
        service
            .transcribe(Recording {
                language: Some("en-US".into()),
                ..recording()
            })
            .await,
        Err(DictationError::InvalidLanguage)
    ));
    assert_eq!(service.provider.0.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn capacity_limit_is_released_without_consuming_credits() {
    let service = DictationService::new(Provider(AtomicUsize::new(0)));
    let permits = service
        .capacity
        .acquire_many(MAX_CONCURRENT_TRANSCRIPTIONS as u32)
        .await
        .unwrap();
    assert!(matches!(
        service.transcribe(recording()).await,
        Err(DictationError::Busy)
    ));
    drop(permits);
    assert!(service.transcribe(recording()).await.is_ok());
}
#[test]
fn accepts_browser_formats_but_rejects_other_content() {
    for mime in [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "audio/wav",
    ] {
        assert!(AudioFormat::from_content_type(mime).is_ok());
    }
    assert!(AudioFormat::from_content_type("text/html").is_err());
}
