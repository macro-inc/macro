//! Keep every write, so tests catch exporters that retain the first span value.
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::registry::LookupSpan;

pub(super) type Fields = HashMap<&'static str, Vec<String>>;

#[derive(Clone, Default)]
struct Writes(Fields);

impl Visit for Writes {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0
            .entry(field.name())
            .or_default()
            .push(format!("{value:?}"));
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        self.0
            .entry(field.name())
            .or_default()
            .push(value.to_owned());
    }
}

#[derive(Clone, Default)]
pub(super) struct FieldWrites {
    spans: Arc<Mutex<Vec<Fields>>>,
    deadlines: Arc<Mutex<Vec<Fields>>>,
    probe_errors: Arc<Mutex<Vec<tracing::Level>>>,
}

impl FieldWrites {
    pub(super) fn install(&self) -> tracing::subscriber::DefaultGuard {
        // Parallel tests may register a callsite under a no-op dispatcher first.
        // Two dispatchers keep tracing from caching that callsite as disabled.
        static NOOP: OnceLock<tracing::Dispatch> = OnceLock::new();
        NOOP.get_or_init(|| tracing::Dispatch::new(tracing::subscriber::NoSubscriber::new()));
        let dispatch = tracing::Dispatch::new(tracing_subscriber::registry().with(self.clone()));
        tracing::dispatcher::set_default(&dispatch)
    }

    pub(super) fn spans(&self) -> Vec<Fields> {
        self.spans.lock().unwrap().clone()
    }

    pub(super) fn deadlines(&self) -> Vec<Fields> {
        self.deadlines.lock().unwrap().clone()
    }

    pub(super) fn probe_errors(&self) -> Vec<tracing::Level> {
        self.probe_errors.lock().unwrap().clone()
    }
}

impl<S: tracing::Subscriber + for<'a> LookupSpan<'a>> tracing_subscriber::Layer<S> for FieldWrites {
    fn on_new_span(&self, attrs: &Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
        if matches!(
            attrs.metadata().name(),
            "smtp.submit" | "imap.protocol.submit"
        ) {
            let mut writes = Writes::default();
            attrs.record(&mut writes);
            ctx.span(id).unwrap().extensions_mut().insert(writes);
        }
    }

    fn on_record(&self, id: &Id, record: &Record<'_>, ctx: Context<'_, S>) {
        if let Some(span) = ctx.span(id)
            && let Some(writes) = span.extensions_mut().get_mut::<Writes>()
        {
            record.record(writes);
        }
    }

    fn on_close(&self, id: Id, ctx: Context<'_, S>) {
        let span = ctx.span(&id).unwrap();
        if span.name() == "imap.protocol.submit" {
            self.deadlines
                .lock()
                .unwrap()
                .push(span.extensions().get::<Writes>().unwrap().0.clone());
        }
        if span.name() == "smtp.submit" {
            self.spans
                .lock()
                .unwrap()
                .push(span.extensions().get::<Writes>().unwrap().0.clone());
        }
    }

    fn on_event(&self, event: &tracing::Event<'_>, ctx: Context<'_, S>) {
        if ctx
            .lookup_current()
            .is_some_and(|span| span.name() == "smtp.connection.reuse")
        {
            self.probe_errors
                .lock()
                .unwrap()
                .push(*event.metadata().level());
        }
    }
}
