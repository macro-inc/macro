//! A layer for tests that read the spans a flow opened: each span's name,
//! parent and fields (as created and as recorded later), and the order spans
//! opened and closed in. It sits on `tracing_subscriber`'s registry, which
//! tracks the current span and closes a span once nothing holds it.

use std::sync::{Arc, Mutex, OnceLock};

use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Dispatch, Subscriber};
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

/// Keeps a second dispatcher registered for the test binary's life. With
/// only one registered, tracing works out a newly reached callsite's
/// interest from the thread that reaches it, so a test thread with no
/// subscriber would cache that no one wants it, and a capture on another
/// thread would never see it. With two, every dispatcher alive is asked.
fn keep_interest_shared() {
    static SECOND: OnceLock<Dispatch> = OnceLock::new();
    SECOND.get_or_init(|| Dispatch::new(tracing::subscriber::NoSubscriber::default()));
}

impl Spans {
    /// Collects the spans this thread opens until the guard drops.
    pub(crate) fn capture() -> (Arc<Self>, tracing::dispatcher::DefaultGuard) {
        keep_interest_shared();
        let spans = Arc::new(Self::default());
        let subscriber = tracing_subscriber::registry().with(Recorder(Arc::clone(&spans)));
        // Registering the capture recomputes every registered callsite's
        // interest with it. A callsite another thread was registering at
        // that moment may have worked its interest out just before; it is
        // registered within microseconds, so recompute once more after.
        let guard = tracing::dispatcher::set_default(&Dispatch::new(subscriber));
        std::thread::sleep(std::time::Duration::from_millis(20));
        tracing::callsite::rebuild_interest_cache();
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
