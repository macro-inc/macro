//! What the domain tests share: the recorded fixtures, and the capture that
//! lets a test assert on what the fold logged.

pub use crate::testing::{InMemoryLog, TURN, parse_log, parse_log_as, test_session};

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use agent_client_protocol::schema::v1::{Meta, ToolCallContent, ToolKind};
use serde_json::{Value, json};
use tracing::Level;
use tracing::field::{Field, Visit};

use crate::domain::harness::ToolFrame;
use crate::domain::model::ToolStatus;

/// An owned tool frame for tests to build a [`ToolFrame`] over: the fields
/// a reader might look at, each set by a builder method, nothing else.
#[derive(Debug, Default)]
pub struct Frame {
    meta: Option<Meta>,
    title: Option<String>,
    kind: Option<ToolKind>,
    status: Option<ToolStatus>,
    raw_input: Option<Value>,
    raw_output: Option<Value>,
    content: Option<Vec<ToolCallContent>>,
}

impl Frame {
    pub fn new() -> Self {
        Self::default()
    }

    /// `_meta`, from a JSON object.
    pub fn meta(mut self, meta: Value) -> Self {
        self.meta = Some(match meta {
            Value::Object(map) => map,
            other => panic!("meta must be an object, got {other}"),
        });
        self
    }

    pub fn title(mut self, title: &str) -> Self {
        self.title = Some(title.to_owned());
        self
    }

    pub fn kind(mut self, kind: ToolKind) -> Self {
        self.kind = Some(kind);
        self
    }

    pub fn status(mut self, status: ToolStatus) -> Self {
        self.status = Some(status);
        self
    }

    pub fn raw_input(mut self, raw_input: Value) -> Self {
        self.raw_input = Some(raw_input);
        self
    }

    pub fn raw_output(mut self, raw_output: Value) -> Self {
        self.raw_output = Some(raw_output);
        self
    }

    /// One text content block - what a harness's completion prose arrives
    /// as. Marks the frame completed too, since that is when readers take
    /// content text as an answer.
    pub fn text(mut self, text: &str) -> Self {
        let block = json!({"type": "content", "content": {"type": "text", "text": text}});
        self.content
            .get_or_insert_with(Vec::new)
            .push(serde_json::from_value(block).expect("a text content block"));
        if self.status.is_none() {
            self.status = Some(ToolStatus::Completed);
        }
        self
    }

    /// The borrowed view a reader takes.
    pub fn view(&self) -> ToolFrame<'_> {
        ToolFrame {
            meta: self.meta.as_ref(),
            title: self.title.as_deref(),
            kind: self.kind,
            status: self.status,
            raw_input: self.raw_input.as_ref(),
            raw_output: self.raw_output.as_ref(),
            content: self.content.as_deref(),
            locations: None,
        }
    }
}

/// Everything a captured `WARN` event carried, by field name.
pub type CapturedFields = HashMap<String, String>;

struct FieldCapture<'a>(&'a mut CapturedFields);

impl Visit for FieldCapture<'_> {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0.insert(field.name().to_owned(), format!("{value:?}"));
    }
}

/// A [`tracing::Subscriber`] that records every `WARN`-level event's fields
/// into `captured`. One per [`capturing_warnings`] call - see there for why.
struct TracingCapture {
    captured: Arc<Mutex<Vec<CapturedFields>>>,
}

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
        self.captured.lock().unwrap().push(fields);
    }

    fn enter(&self, _span: &tracing::span::Id) {}
    fn exit(&self, _span: &tracing::span::Id) {}
}

/// Registers every `tracing::warn!` call site this crate's tests can reach as
/// "always interesting", once, before any test runs.
///
/// Without this, [`capturing_warnings`]'s per-call
/// [`with_default`](tracing::subscriber::with_default) is not quite enough:
/// `warn()`'s call site is one line shared by every `FoldError` variant, hit
/// by dozens of tests across many threads, and `tracing` caches a call
/// site's interest globally the first time anything asks - not per thread.
/// If that first ask happens to land between two tests' `with_default`
/// scopes, with no subscriber active, it caches "nobody's listening" for the
/// rest of the process, and every later test's `with_default` scope is too
/// late to undo it: the fast-path check that cache backs runs before a
/// scoped subscriber is even consulted. `set_global_default` is documented
/// to rebuild that cache against whatever it installs, so installing one
/// unconditionally-interested subscriber before anything else runs closes
/// the window for good. It does nothing with what it receives - actual
/// capture is still each call's own thread-local subscriber below.
fn ensure_warn_call_sites_are_registered() {
    struct AlwaysInterested;

    impl tracing::Subscriber for AlwaysInterested {
        fn enabled(&self, _metadata: &tracing::Metadata<'_>) -> bool {
            true
        }
        fn new_span(&self, _attrs: &tracing::span::Attributes<'_>) -> tracing::span::Id {
            tracing::span::Id::from_u64(1)
        }
        fn record(&self, _span: &tracing::span::Id, _values: &tracing::span::Record<'_>) {}
        fn record_follows_from(&self, _span: &tracing::span::Id, _follows: &tracing::span::Id) {}
        fn event(&self, _event: &tracing::Event<'_>) {}
        fn enter(&self, _span: &tracing::span::Id) {}
        fn exit(&self, _span: &tracing::span::Id) {}
    }

    static INSTALLED: OnceLock<()> = OnceLock::new();
    INSTALLED.get_or_init(|| {
        // Another test binary in the workspace may have already claimed the
        // global default; either way, one always-interested subscriber has
        // now rebuilt the cache and that is all this needs.
        let _ = tracing::subscriber::set_global_default(AlwaysInterested);
    });
}

/// Run `body`, returning its value and every `WARN` it logged.
///
/// A fresh subscriber per call, scoped to `body` with
/// [`tracing::subscriber::with_default`] - the same pattern
/// `macro_tower_layers`'s tests use. Each call gets its own capture, so
/// nothing needs clearing between tests and parallel tests cannot see each
/// other's warnings: there is no shared or global state for them to collide
/// on in the first place.
pub fn capturing_warnings<T>(body: impl FnOnce() -> T) -> (T, Vec<CapturedFields>) {
    ensure_warn_call_sites_are_registered();

    let captured = Arc::new(Mutex::new(Vec::new()));
    let subscriber = TracingCapture {
        captured: captured.clone(),
    };
    let value = tracing::subscriber::with_default(subscriber, body);
    let events = std::mem::take(&mut *captured.lock().unwrap());
    (value, events)
}
