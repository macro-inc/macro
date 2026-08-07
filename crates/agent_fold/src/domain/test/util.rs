//! What the domain tests share: the recorded fixtures, and the capture that
//! lets a test assert on what the fold logged.

pub use crate::testing::{
    InMemoryLog, LONG_MULTI_RESUME, REAL_MULTI_TURN, REAL_SINGLE_TURN, RESUMED_AND_CONTINUED,
    RESUMED_NO_PROMPT, TURN, parse_log, parse_log_as, test_session,
};

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::OnceLock;
use tracing::Level;
use tracing::field::{Field, Visit};

/// Everything a captured `WARN` event carried, by field name.
pub type CapturedFields = HashMap<String, String>;

thread_local! {
    /// Warnings logged on this thread since the last [`capturing_warnings`]
    /// call started. Thread-local rather than shared, so tests running in
    /// parallel cannot see each other's warnings.
    static CAPTURED: RefCell<Vec<CapturedFields>> = const { RefCell::new(Vec::new()) };
}

struct FieldCapture<'a>(&'a mut CapturedFields);

impl Visit for FieldCapture<'_> {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0.insert(field.name().to_owned(), format!("{value:?}"));
    }
}

/// A [`tracing::Subscriber`] that records every `WARN`-level event's fields
/// into the logging thread's [`CAPTURED`] buffer, so a test can assert on what
/// the fold logged without threading it through its return value.
///
/// Installed once as the process-wide default - see [`capturing_warnings`].
struct TracingCapture;

impl tracing::Subscriber for TracingCapture {
    fn enabled(&self, _metadata: &tracing::Metadata<'_>) -> bool {
        true
    }

    fn new_span(&self, _attrs: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }

    fn record(&self, _span: &tracing::span::Id, _values: &tracing::span::Record<'_>) {}

    fn record_follows_from(&self, _span: &tracing::span::Id, _follows: &tracing::span::Id) {}

    fn event(&self, event: &tracing::Event<'_>) {
        if *event.metadata().level() != Level::WARN {
            return;
        }
        let mut fields = CapturedFields::default();
        event.record(&mut FieldCapture(&mut fields));
        CAPTURED.with(|captured| captured.borrow_mut().push(fields));
    }

    fn enter(&self, _span: &tracing::span::Id) {}
    fn exit(&self, _span: &tracing::span::Id) {}
}

/// Run `body`, returning its value and every `WARN` it logged on this thread.
///
/// The capture is a *global* subscriber installed once, writing into a
/// thread-local buffer, rather than the obvious
/// [`with_default`](tracing::subscriber::with_default) scoped subscriber.
/// Scoped subscribers do not survive this test binary: they flip global
/// dispatch state on entry and back on exit, so with the suite running
/// tests in parallel one test leaving its scope intermittently swallows the
/// warnings another test is still inside its scope to collect. That failure
/// shows up as a warning assertion seeing zero events - it looks exactly like
/// a fold that stopped reporting, and it reproduces in roughly one run in
/// five. A subscriber that is installed once and never removed has no such
/// window.
///
/// Buffers are per-thread and cleared on entry, so parallel tests cannot see
/// each other's warnings and a bare fold elsewhere cannot leak into one.
pub fn capturing_warnings<T>(body: impl FnOnce() -> T) -> (T, Vec<CapturedFields>) {
    static INSTALLED: OnceLock<()> = OnceLock::new();
    INSTALLED.get_or_init(|| {
        tracing::subscriber::set_global_default(TracingCapture)
            .expect("nothing else installs a subscriber in this test binary");
    });

    CAPTURED.with(|captured| captured.borrow_mut().clear());
    let value = body();
    let events = CAPTURED.with(|captured| std::mem::take(&mut *captured.borrow_mut()));
    (value, events)
}
