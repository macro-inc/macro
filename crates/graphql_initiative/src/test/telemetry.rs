//! Initiative reads stay in the trace of the request that asked for them.

use super::*;
use std::fmt::Debug;
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id};
use tracing::{Instrument, Subscriber};
use tracing_subscriber::layer::{Context as LayerContext, Layer, SubscriberExt};
use tracing_subscriber::registry::LookupSpan;

/// The span the test runs each GraphQL request in.
const REQUEST_SPAN: &str = "request";

/// A started span: its name, its parent's name, and its fields.
#[derive(Clone, Debug)]
struct StartedSpan {
    name: &'static str,
    parent: Option<&'static str>,
    fields: Vec<String>,
}

impl Visit for StartedSpan {
    fn record_i64(&mut self, field: &Field, value: i64) {
        self.fields.push(format!("{}=i64:{value}", field.name()));
    }
    fn record_debug(&mut self, field: &Field, value: &dyn Debug) {
        self.fields.push(format!("{}={value:?}", field.name()));
    }
}

/// Every span started while installed, in start order.
#[derive(Clone, Default)]
struct StartedSpans(Arc<Mutex<Vec<StartedSpan>>>);

impl StartedSpans {
    fn named(&self, name: &str) -> Vec<StartedSpan> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|span| span.name == name)
            .cloned()
            .collect()
    }
}

impl<S: Subscriber + for<'a> LookupSpan<'a>> Layer<S> for StartedSpans {
    fn on_new_span(&self, attrs: &Attributes<'_>, id: &Id, ctx: LayerContext<'_, S>) {
        let mut span = StartedSpan {
            name: attrs.metadata().name(),
            parent: ctx
                .span(id)
                .and_then(|span| span.parent())
                .map(|parent| parent.name()),
            fields: Vec::new(),
        };
        attrs.record(&mut span);
        self.0.lock().unwrap().push(span);
    }
}

async fn read_member_ids(
    schema: &Schema<Query, InitiativeMutationRoot<TestSoupEdges>, EmptySubscription>,
) {
    let response = schema
        .execute(
            Request::new(format!(
                "{{ user {{ initiative(initiativeId: \"{PROJECT_ID}\") {{ memberIds }} }} }}"
            ))
            .data(user()),
        )
        .instrument(tracing::info_span!(REQUEST_SPAN))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
}

#[tokio::test]
async fn initiative_reads_run_in_a_batch_span_under_the_request() {
    let spans = StartedSpans::default();
    let _guard =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(spans.clone()));
    // Register the callsites, then recompute interest on this thread: a test on
    // another thread can have cached "never" for them meanwhile.
    read_member_ids(&schema(Arc::new(RecordingApi::default()))).await;
    tracing::callsite::rebuild_interest_cache();
    spans.0.lock().unwrap().clear();

    let api = Arc::new(RecordingApi::default());
    read_member_ids(&schema(api.clone())).await;

    let batches = spans.named("graphql_initiative.load");
    assert_eq!(batches.len(), 1, "one batch: {batches:?}");
    assert_eq!(
        batches[0].parent,
        Some(REQUEST_SPAN),
        "the batch is spawned in the request's span"
    );
    assert_eq!(batches[0].fields, ["initiative_count=i64:1"]);
    assert_eq!(
        *api.read_spans.lock().unwrap(),
        [Some("graphql_initiative.load")],
        "the domain read runs inside the batch span"
    );
}
