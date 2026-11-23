use super::*;
use std::io::Write;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
struct Output(Arc<Mutex<Vec<u8>>>);

impl Write for Output {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[test]
fn extraction_logs_before_rejecting_a_missing_or_malformed_body() {
    for (body, error) in [
        (None, "message body not found"),
        (
            Some("{"),
            "Failed to deserialize message body to SFSUploaderMessage",
        ),
    ] {
        let message = Message::builder().set_body(body.map(str::to_owned)).build();
        let output = Output::default();
        let writer = output.clone();
        let subscriber = tracing_subscriber::fmt()
            .with_max_level(tracing::Level::TRACE)
            .without_time()
            .with_ansi(false)
            .with_target(false)
            .with_writer(move || writer.clone())
            .finish();
        let result = tracing::subscriber::with_default(subscriber, || {
            extract_sfs_upload_notification(&message)
        });
        assert_eq!(result.unwrap_err().to_string(), error);
        assert_eq!(
            String::from_utf8(output.0.lock().unwrap().clone()).unwrap(),
            "DEBUG extract_sfs_upload_notification: Extracting sfs upload notification from message\n"
        );
    }
}
