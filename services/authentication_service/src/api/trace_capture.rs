//! Captures every span and event a test emits, as the formatted text a log
//! pipeline or trace exporter would receive, so tests can assert what reaches
//! telemetry.
use std::sync::{Arc, Mutex};
use tracing_subscriber::fmt::{MakeWriter, format::FmtSpan};

#[derive(Clone, Default)]
pub(crate) struct CapturedTraces(Arc<Mutex<Vec<u8>>>);

impl CapturedTraces {
    pub(crate) fn text(&self) -> String {
        String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
    }
}

impl std::io::Write for CapturedTraces {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> MakeWriter<'a> for CapturedTraces {
    type Writer = Self;

    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

/// Installs a TRACE-level subscriber for the current thread. Spans print
/// their fields when opened, recorded and closed; `#[instrument(ret)]` and
/// `err` events print too. Use with a current-thread runtime.
pub(crate) fn capture_traces() -> (CapturedTraces, tracing::subscriber::DefaultGuard) {
    let captured = CapturedTraces::default();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_span_events(FmtSpan::FULL)
        .with_ansi(false)
        .with_writer(captured.clone())
        .finish();
    let guard = tracing::subscriber::set_default(subscriber);
    // Callsites registered by another test's subscriber may have cached a
    // "never" interest; recompute it for this one.
    tracing::callsite::rebuild_interest_cache();
    (captured, guard)
}
