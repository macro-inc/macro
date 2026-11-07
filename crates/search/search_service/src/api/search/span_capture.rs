//! Test support: reads back what the search spans carry.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use tracing::field::{Field, Visit};
use tracing_subscriber::layer::{Context, SubscriberExt as _};
use tracing_subscriber::registry::LookupSpan;

/// Every field recorded on each span while installed, by span and field name.
#[derive(Clone, Default)]
pub(in crate::api::search) struct SpanFields(
    Arc<Mutex<HashMap<&'static str, BTreeMap<&'static str, String>>>>,
);

impl SpanFields {
    /// Captures the spans of the current thread until the guard drops.
    pub(in crate::api::search) fn install() -> (Self, tracing::subscriber::DefaultGuard) {
        let fields = Self::default();
        let guard =
            tracing::subscriber::set_default(tracing_subscriber::registry().with(fields.clone()));
        tracing::callsite::rebuild_interest_cache();
        (fields, guard)
    }

    pub(in crate::api::search) fn of(&self, span: &str) -> BTreeMap<&'static str, String> {
        let spans = self.0.lock().expect("span fields lock poisoned");
        spans
            .get(span)
            .unwrap_or_else(|| panic!("no span named {span} was opened"))
            .clone()
    }

    fn record(&self, span: &'static str, record: impl FnOnce(&mut FieldValues<'_>)) {
        let mut spans = self.0.lock().expect("span fields lock poisoned");
        record(&mut FieldValues(spans.entry(span).or_default()));
    }
}

impl<S> tracing_subscriber::Layer<S> for SpanFields
where
    S: tracing::Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_new_span(
        &self,
        attrs: &tracing::span::Attributes<'_>,
        _id: &tracing::span::Id,
        _ctx: Context<'_, S>,
    ) {
        self.record(attrs.metadata().name(), |fields| attrs.record(fields));
    }

    fn on_record(
        &self,
        id: &tracing::span::Id,
        values: &tracing::span::Record<'_>,
        ctx: Context<'_, S>,
    ) {
        if let Some(span) = ctx.span(id) {
            self.record(span.name(), |fields| values.record(fields));
        }
    }
}

struct FieldValues<'a>(&'a mut BTreeMap<&'static str, String>);

impl Visit for FieldValues<'_> {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.0.insert(field.name(), value.to_string());
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0.insert(field.name(), format!("{value:?}"));
    }
}
