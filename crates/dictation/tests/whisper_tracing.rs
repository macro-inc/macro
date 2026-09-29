//! Exercise SDK logging with an isolated subscriber; unrelated parallel tests
//! must not alter callsite registration while the capture is active.
#![cfg(feature = "outbound")]

use bytes::Bytes;
use dictation::{
    domain::{DictationError, Recording, TranscriptionProvider},
    outbound::{OpenaiApiKey, WhisperTranscriber},
};
use serde_json::json;
use tracing::instrument::WithSubscriber;
use wiremock::{Mock, MockServer, ResponseTemplate, matchers::method};

#[derive(Clone, Default)]
struct CapturedLogs(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

impl std::io::Write for CapturedLogs {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for CapturedLogs {
    type Writer = Self;
    fn make_writer(&'a self) -> Self {
        self.clone()
    }
}

#[tokio::test]
async fn malformed_provider_responses_never_log_transcript_content() {
    for status in [200, 400] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(status).set_body_json(
                json!({"text": "PRIVATE_TRANSCRIPT_SENTINEL", "duration": "invalid"}),
            ))
            .expect(1)
            .mount(&server)
            .await;
        let logs = CapturedLogs::default();
        let subscriber = tracing_subscriber::fmt()
            .without_time()
            .with_ansi(false)
            .with_span_events(tracing_subscriber::fmt::format::FmtSpan::CLOSE)
            .with_max_level(tracing::Level::TRACE)
            .with_writer(logs.clone())
            .finish();
        let transcriber = WhisperTranscriber::with_api_base(
            &OpenaiApiKey::Comptime("test-server-key"),
            Some(&format!("{}/v1", server.uri())),
        )
        .unwrap();
        let recording = Recording::new(
            Bytes::from_static(include_bytes!("fixtures/tone.ogg")),
            None,
        )
        .unwrap();
        let result = transcriber
            .transcribe(recording)
            .with_subscriber(subscriber)
            .await;
        assert_eq!(result, Err(DictationError::Provider));
        let output = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();
        assert!(
            output.contains("Whisper request failed") && output.contains("invalid_response"),
            "sanitized diagnostics must remain visible: {output}"
        );
        assert!(!output.contains("PRIVATE_TRANSCRIPT_SENTINEL"));
        assert!(!output.contains("test-server-key"));
        assert!(output.contains("gen_ai.request.model=\"whisper-1\""));
    }
}
