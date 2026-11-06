//! Records closed spans and events so tests can assert on telemetry fields.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::registry::LookupSpan;

pub(crate) type Fields = HashMap<&'static str, String>;

#[derive(Default)]
struct Values(Fields);

impl Visit for Values {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0.insert(field.name(), format!("{value:?}"));
    }
    fn record_str(&mut self, field: &Field, value: &str) {
        self.0.insert(field.name(), value.to_owned());
    }
}

#[derive(Default)]
struct Captured {
    spans: Vec<(&'static str, Fields)>,
    events: Vec<(tracing::Level, Fields)>,
}

/// Install with [`Telemetry::install`] for the current thread.
#[derive(Clone, Default)]
pub(crate) struct Telemetry(Arc<Mutex<Captured>>);

impl Telemetry {
    pub(crate) fn install(&self) -> tracing::subscriber::DefaultGuard {
        let guard =
            tracing::subscriber::set_default(tracing_subscriber::registry().with(self.clone()));
        // A callsite another test thread registered while this subscriber was
        // being installed can keep a cached "never" interest; recompute it.
        tracing::callsite::rebuild_interest_cache();
        guard
    }

    /// Closed spans with this name, oldest first.
    pub(crate) fn spans(&self, name: &str) -> Vec<Fields> {
        let captured = self.0.lock().unwrap();
        captured
            .spans
            .iter()
            .filter(|(span, _)| *span == name)
            .map(|(_, fields)| fields.clone())
            .collect()
    }

    /// Events whose message is `message`, with their level.
    pub(crate) fn events(&self, message: &str) -> Vec<(tracing::Level, Fields)> {
        let captured = self.0.lock().unwrap();
        captured
            .events
            .iter()
            .filter(|(_, fields)| fields.get("message").is_some_and(|text| text == message))
            .cloned()
            .collect()
    }
}

impl<S: tracing::Subscriber + for<'a> LookupSpan<'a>> tracing_subscriber::Layer<S> for Telemetry {
    fn on_new_span(&self, attrs: &Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
        let mut values = Values::default();
        attrs.record(&mut values);
        if let Some(span) = ctx.span(id) {
            span.extensions_mut().insert(values);
        }
    }
    fn on_record(&self, id: &Id, record: &Record<'_>, ctx: Context<'_, S>) {
        if let Some(span) = ctx.span(id)
            && let Some(values) = span.extensions_mut().get_mut::<Values>()
        {
            record.record(values);
        }
    }
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        let mut values = Values::default();
        event.record(&mut values);
        self.0
            .lock()
            .unwrap()
            .events
            .push((*event.metadata().level(), values.0));
    }
    fn on_close(&self, id: Id, ctx: Context<'_, S>) {
        if let Some(span) = ctx.span(&id) {
            let values = span.extensions_mut().remove::<Values>().unwrap_or_default();
            self.0.lock().unwrap().spans.push((span.name(), values.0));
        }
    }
}
