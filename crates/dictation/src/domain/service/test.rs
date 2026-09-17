use super::*;
use crate::domain::models::{AudioFormat, MAX_AUDIO_BYTES};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

/// Minimal Ogg page header, as Firefox's MediaRecorder emits.
const OGG_HEADER: &[u8] = b"OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00";

#[derive(Default)]
struct FakeProvider {
    calls: AtomicUsize,
    seen: Mutex<Vec<(AudioFormat, Option<String>)>>,
}

impl TranscriptionProvider for Arc<FakeProvider> {
    async fn transcribe(&self, recording: Recording) -> Result<Transcript, DictationError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let (_, format, language) = recording.into_parts();
        self.seen
            .lock()
            .unwrap()
            .push((format, language.map(|hint| hint.to_string())));
        Ok(Transcript {
            text: "  hello world  ".into(),
            duration_seconds: 2.0,
        })
    }
}

fn service() -> (DictationServiceImpl<Arc<FakeProvider>>, Arc<FakeProvider>) {
    let provider = Arc::new(FakeProvider::default());
    (DictationServiceImpl::new(provider.clone()), provider)
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|dictation-test@example.com".to_owned()).unwrap()
}

fn language() -> Option<LanguageHint> {
    Some("en".parse().unwrap())
}

#[tokio::test]
async fn transcribes_detected_audio_and_trims_text() {
    let (service, provider) = service();
    let transcript = service
        .transcribe(user(), Bytes::from_static(OGG_HEADER), language())
        .await
        .unwrap();
    assert_eq!(transcript.text, "hello world");
    assert_eq!(transcript.duration_seconds, 2.0);
    assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        provider.seen.lock().unwrap().as_slice(),
        [(AudioFormat::Ogg, Some("en".to_owned()))]
    );
}

#[tokio::test]
async fn rejects_empty_or_oversized_audio_before_calling_provider() {
    let (service, provider) = service();
    for bytes in [Bytes::new(), Bytes::from(vec![0; MAX_AUDIO_BYTES + 1])] {
        assert_eq!(
            service.transcribe(user(), bytes, language()).await,
            Err(DictationError::InvalidSize)
        );
    }
    assert_eq!(provider.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn rejects_bytes_that_are_not_a_supported_audio_container() {
    let (service, provider) = service();
    for bytes in [
        Bytes::from_static(b"<!doctype html><html></html>"),
        Bytes::from_static(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"),
    ] {
        assert_eq!(
            service.transcribe(user(), bytes, None).await,
            Err(DictationError::UnsupportedAudio)
        );
    }
    assert_eq!(provider.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn capacity_guard_rejects_when_saturated_and_recovers() {
    let (service, provider) = service();
    let permits = service
        .capacity()
        .acquire_many(MAX_CONCURRENT_TRANSCRIPTIONS as u32)
        .await
        .unwrap();
    assert_eq!(
        service
            .transcribe(user(), Bytes::from_static(OGG_HEADER), None)
            .await,
        Err(DictationError::Busy)
    );
    assert_eq!(provider.calls.load(Ordering::SeqCst), 0);
    drop(permits);
    assert!(
        service
            .transcribe(user(), Bytes::from_static(OGG_HEADER), None)
            .await
            .is_ok()
    );
}

#[test]
fn language_hint_accepts_only_two_lowercase_letters() {
    assert_eq!("en".parse::<LanguageHint>().unwrap().as_str(), "en");
    for invalid in ["EN", "en-US", "e", "", "1a"] {
        assert_eq!(
            invalid.parse::<LanguageHint>(),
            Err(DictationError::InvalidLanguage)
        );
    }
}

#[test]
fn detects_browser_containers_and_names_upload_by_extension() {
    let webm = [
        0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81, 0x01, 0x42, 0xF7, 0x81,
    ];
    let mp4 = b"\x00\x00\x00\x1cftypiso5\x00\x00\x02\x00isomiso5";
    let wav = b"RIFF\x24\x00\x00\x00WAVEfmt ";
    let mut ogg_opus = OGG_HEADER.to_vec();
    ogg_opus.resize(28, 0);
    ogg_opus.extend_from_slice(b"OpusHead\x01\x02");
    for (bytes, format) in [
        (&webm[..], AudioFormat::Webm),
        (&mp4[..], AudioFormat::Mp4),
        (&wav[..], AudioFormat::Wav),
        (OGG_HEADER, AudioFormat::Ogg),
        (&ogg_opus[..], AudioFormat::Ogg),
    ] {
        assert_eq!(AudioFormat::detect(bytes), Ok(format), "{format:?}");
    }
    assert_eq!(AudioFormat::Ogg.filename(), "dictation.ogg");
    assert_eq!(
        AudioFormat::detect(b"ID3\x03\x00\x00\x00"),
        Err(DictationError::UnsupportedAudio),
        "mp3 uploads are not produced by browser recorders"
    );
}
