use super::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tracing::field::{Field, Visit};
use tracing::instrument::WithSubscriber;
use tracing_subscriber::layer::{Context, SubscriberExt as _};
use tracing_subscriber::registry::LookupSpan;

/// The integer fields recorded on each span while installed, by span and field name.
#[derive(Clone, Default)]
struct RecordedFields(Arc<Mutex<HashMap<&'static str, HashMap<&'static str, u128>>>>);

impl RecordedFields {
    fn of(&self, span: &str) -> HashMap<&'static str, u128> {
        let spans = self.0.lock().expect("recorded fields lock poisoned");
        spans.get(span).cloned().unwrap_or_default()
    }
}

impl<S> tracing_subscriber::Layer<S> for RecordedFields
where
    S: tracing::Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_record(
        &self,
        id: &tracing::span::Id,
        values: &tracing::span::Record<'_>,
        ctx: Context<'_, S>,
    ) {
        let Some(span) = ctx.span(id) else {
            return;
        };
        let mut spans = self.0.lock().expect("recorded fields lock poisoned");
        values.record(&mut IntegerFields(spans.entry(span.name()).or_default()));
    }
}

struct IntegerFields<'a>(&'a mut HashMap<&'static str, u128>);

impl Visit for IntegerFields<'_> {
    fn record_u64(&mut self, field: &Field, value: u64) {
        self.0.insert(field.name(), value.into());
    }

    fn record_u128(&mut self, field: &Field, value: u128) {
        self.0.insert(field.name(), value);
    }

    fn record_debug(&mut self, _field: &Field, _value: &dyn std::fmt::Debug) {}
}

#[tokio::test(start_paused = true)]
async fn finished_phases_record_their_counts_and_full_batch_pauses() {
    let (service, fake) = service();
    {
        let mut state = fake.0.lock().unwrap();
        state
            .messages
            .push_back(vec![message(1, 10), message(2, 10)]);
        state.threads.push_back(vec![id(10), id(20)]);
        state
            .contacts
            .push_back(vec![contact(30, "a"), contact(40, "b")]);
    }
    let recorded = RecordedFields::default();
    let subscriber = tracing_subscriber::registry().with(recorded.clone());
    let summary = service
        .purge_link(LINK, pacing(Duration::from_millis(5)))
        .with_subscriber(subscriber)
        .await
        .unwrap();
    assert_eq!(
        recorded.of("email.purge_link.messages"),
        HashMap::from([
            ("batches", 2),
            ("paused_ms", 5),
            ("messages", 2),
            ("threads", 0),
        ])
    );
    assert_eq!(
        recorded.of("email.purge_link.threads"),
        HashMap::from([("batches", 2), ("paused_ms", 5), ("deleted", 2),])
    );
    assert_eq!(
        recorded.of("email.purge_link.contacts"),
        HashMap::from([("batches", 2), ("paused_ms", 5), ("deleted", 2),])
    );
    assert_eq!(
        summary,
        PurgeSummary {
            messages: 2,
            threads: 2,
            contacts: 2,
            link_deleted: true
        }
    );
}
