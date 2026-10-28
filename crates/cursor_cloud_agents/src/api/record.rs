//! Capturing a run's raw SSE bytes, for turning real traffic into fixtures.
//!
//! The recording is the *bytes as they arrived*, before any decoding: a
//! fixture written here is byte-identical to what `api.cursor.com` sent, so
//! replaying it through the decoder
//! exercises the decoder as well as the translation. Fixtures of decoded
//! events cannot do that — they start downstream of the part most likely to
//! break on real traffic.
//!
//! Read chunk boundaries are deliberately *not* preserved. They are an
//! artifact of one TCP session rather than a property of the stream, and a
//! test that replays a fixture at several synthetic chunkings proves more
//! than one that replays the single split history happened to produce — see
//! `fixtures/real/README.md`.
//!
//! Recording is off unless `CURSOR_ACP_RECORD_DIR` is set. A run is worth
//! more than its recording, so a sink that cannot write reports once and
//! goes quiet rather than failing the stream.

use std::io::Write as _;
use std::path::{Path, PathBuf};

/// An append-only sink for one run's raw SSE bytes.
///
/// [`SseRecording::disabled`] is the no-op form, so the streaming path holds
/// one of these unconditionally instead of branching on an `Option`.
#[derive(Debug)]
pub struct SseRecording {
    /// `None` once recording is off — never configured, or given up after a
    /// write failed.
    file: Option<std::fs::File>,
    path: PathBuf,
}

impl SseRecording {
    /// A sink that records nothing.
    #[must_use]
    pub fn disabled() -> Self {
        Self {
            file: None,
            path: PathBuf::new(),
        }
    }

    /// Open `<dir>/<agent>-<run>.sse`, or a disabled sink if that is not
    /// possible.
    ///
    /// One file per run, named after the run: an editor can have several
    /// agents streaming at once, and bytes from two runs interleaved in one
    /// file are not a fixture, they are a puzzle.
    #[must_use]
    pub fn create(dir: &Path, agent: &str, run: &str) -> Self {
        let path = dir.join(format!("{agent}-{run}.sse"));
        if let Err(error) = std::fs::create_dir_all(dir) {
            tracing::error!(error = ?error, dir = %dir.display(), "cannot create sse record dir");
            return Self::disabled();
        }
        match std::fs::File::create(&path) {
            Ok(file) => {
                tracing::info!(path = %path.display(), "recording raw sse");
                Self {
                    file: Some(file),
                    path,
                }
            }
            Err(error) => {
                tracing::error!(error = ?error, path = %path.display(), "cannot open sse recording");
                Self::disabled()
            }
        }
    }

    /// Append one read's bytes verbatim.
    pub fn write(&mut self, bytes: &[u8]) {
        let Some(file) = self.file.as_mut() else {
            return;
        };
        // Give up on first failure rather than logging per chunk: a full disk
        // would otherwise turn one problem into thousands of log lines.
        if let Err(error) = file.write_all(bytes) {
            tracing::error!(
                error = ?error,
                path = %self.path.display(),
                "sse recording write failed; stopping recording for this run"
            );
            self.file = None;
        }
    }
}
