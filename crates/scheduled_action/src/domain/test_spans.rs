//! A layer for tests that read the spans a flow opened: each span's name,
//! parent and fields (as created and as recorded later), and the order spans
//! opened and closed in. It sits on `tracing_subscriber`'s registry, which
//! tracks the current span and closes a span once nothing holds it. Test
//! doubles open `test.*` spans where the code under test calls them, so a
//! test can see which span that call ran in.

use std::sync::{Arc, Mutex, OnceLock};

use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::subscriber::Interest;
use tracing::{Dispatch, Event, Metadata, Subscriber};
use tracing_subscriber::layer::{Context, Layer, SubscriberExt};
use tracing_subscriber::registry::LookupSpan;

#[derive(Default)]
pub(crate) struct Spans {
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    /// Every span opened, in order; a span's place is its number.
    spans: Vec<Span>,
    /// `open <name>` and `close <name>`, in the order they happened.
    log: Vec<String>,
}

struct Span {
    name: &'static str,
    parent: Option<usize>,
    /// Every value given a field, at creation and after, in order.
    fields: Vec<(&'static str, String)>,
}

/// A span's number among those opened, kept in the registry's extensions:
/// the registry reuses ids once spans close.
struct Number(usize);

/// The test binary's global subscriber: it records nothing, but says every
/// callsite may be wanted. tracing caches each callsite's interest the
/// first time any thread reaches it, and while at most one dispatcher is
/// registered it asks only the reaching thread's: a test thread with no
/// subscriber would cache that no one wants the callsite, and a capture on
/// another thread would never see its spans. With this answering
/// "sometimes" for threads with no capture, the cache never says never, and
/// tracing asks each thread's own subscriber.
struct Interested;

impl Subscriber for Interested {
    fn register_callsite(&self, _: &'static Metadata<'static>) -> Interest {
        Interest::sometimes()
    }

    fn enabled(&self, _: &Metadata<'_>) -> bool {
        false
    }

    fn new_span(&self, _: &Attributes<'_>) -> Id {
        Id::from_u64(1)
    }

    fn record(&self, _: &Id, _: &Record<'_>) {}

    fn record_follows_from(&self, _: &Id, _: &Id) {}

    fn event(&self, _: &Event<'_>) {}

    fn enter(&self, _: &Id) {}

    fn exit(&self, _: &Id) {}
}

/// Installs `Interested` once, as the test binary's global subscriber, so
/// tests in this crate must not set a global subscriber of their own (if
/// one wins, it answers for threads with no capture instead).
///
/// One race remains: a thread that began working out a callsite's interest
/// without a subscriber before this was published can store "never" after
/// the rebuilds that publishing and later captures run. tracing gives no
/// way to wait for that thread. The next capture's rebuild repairs it, so
/// it can only fail a capture that overlaps that store.
fn install() {
    static INSTALLED: OnceLock<()> = OnceLock::new();
    INSTALLED.get_or_init(|| {
        let _ = tracing::subscriber::set_global_default(Interested);
    });
}

impl Spans {
    /// Collects the spans this thread opens until the guard drops.
    pub(crate) fn capture() -> (Arc<Self>, tracing::dispatcher::DefaultGuard) {
        install();
        let spans = Arc::new(Self::default());
        let subscriber = tracing_subscriber::registry().with(Recorder(Arc::clone(&spans)));
        // Registering the capture recomputes every callsite's interest with
        // it, under the lock tracing takes once two dispatchers exist.
        let guard = tracing::dispatcher::set_default(&Dispatch::new(subscriber));
        (spans, guard)
    }

    /// Every value spans named `name` gave `field`, in order.
    pub(crate) fn values(&self, name: &str, field: &str) -> Vec<String> {
        let state = self.state.lock().unwrap();
        state
            .spans
            .iter()
            .filter(|span| span.name == name)
            .flat_map(|span| {
                span.fields
                    .iter()
                    .filter(|(key, _)| *key == field)
                    .map(|(_, value)| value.clone())
            })
            .collect()
    }

    /// Every outcome spans named `name` recorded, in order.
    pub(crate) fn outcomes(&self, name: &str) -> Vec<String> {
        self.values(name, "outcome")
    }

    /// The name of the parent of each span named `name`, in the order they
    /// were opened; `None` for a root.
    pub(crate) fn parents(&self, name: &str) -> Vec<Option<&'static str>> {
        let state = self.state.lock().unwrap();
        state
            .spans
            .iter()
            .filter(|span| span.name == name)
            .map(|span| span.parent.map(|parent| state.spans[parent].name))
            .collect()
    }

    /// `open <name>` and `close <name>` for every span, in the order they
    /// happened.
    pub(crate) fn log(&self) -> Vec<String> {
        self.state.lock().unwrap().log.clone()
    }
}

struct Recorder(Arc<Spans>);

struct Values<'a>(&'a mut Vec<(&'static str, String)>);

impl Visit for Values<'_> {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.0.push((field.name(), value.to_owned()));
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0.push((field.name(), format!("{value:?}")));
    }
}

fn number<S>(id: &Id, context: &Context<'_, S>) -> Option<usize>
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    let span = context.span(id)?;
    let extensions = span.extensions();
    extensions.get::<Number>().map(|number| number.0)
}

impl<S> Layer<S> for Recorder
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_new_span(&self, attributes: &Attributes<'_>, id: &Id, context: Context<'_, S>) {
        let Some(span) = context.span(id) else {
            return;
        };
        let parent = span
            .parent()
            .and_then(|parent| parent.extensions().get::<Number>().map(|number| number.0));
        let mut fields = Vec::new();
        attributes.record(&mut Values(&mut fields));
        let mut state = self.0.state.lock().unwrap();
        let name = attributes.metadata().name();
        state.log.push(format!("open {name}"));
        state.spans.push(Span {
            name,
            parent,
            fields,
        });
        span.extensions_mut().insert(Number(state.spans.len() - 1));
    }

    fn on_record(&self, id: &Id, values: &Record<'_>, context: Context<'_, S>) {
        let Some(number) = number(id, &context) else {
            return;
        };
        let mut fields = Vec::new();
        values.record(&mut Values(&mut fields));
        self.0.state.lock().unwrap().spans[number]
            .fields
            .extend(fields);
    }

    fn on_close(&self, id: Id, context: Context<'_, S>) {
        let Some(number) = number(&id, &context) else {
            return;
        };
        let mut state = self.0.state.lock().unwrap();
        let name = state.spans[number].name;
        state.log.push(format!("close {name}"));
    }
}
