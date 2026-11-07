use super::*;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use tracing::Instrument;
use tracing::field::{Field, Visit};
use tracing::instrument::WithSubscriber;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::registry::LookupSpan;

#[derive(Clone, Debug)]
struct Captured {
    level: tracing::Level,
    message: String,
    fields: BTreeMap<String, String>,
    spans: Vec<&'static str>,
}

#[derive(Clone, Default)]
pub(in crate::domain::mailbox::link_manager) struct Output(Arc<Mutex<Vec<Captured>>>);

#[derive(Default)]
struct Fields(BTreeMap<String, String>);

impl Visit for Fields {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.0.insert(field.name().into(), value.into());
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0.insert(field.name().into(), format!("{value:?}"));
    }
}

struct Capture(Output);

impl<S: tracing::Subscriber + for<'a> LookupSpan<'a>> tracing_subscriber::Layer<S> for Capture {
    fn on_event(&self, event: &tracing::Event<'_>, ctx: tracing_subscriber::layer::Context<'_, S>) {
        let mut fields = Fields::default();
        event.record(&mut fields);
        let message = fields.0.remove("message").unwrap_or_default();
        let spans = ctx
            .event_scope(event)
            .map(|scope| {
                scope
                    .from_root()
                    .map(|span| span.metadata().name())
                    .collect()
            })
            .unwrap_or_default();
        self.0.0.lock().unwrap().push(Captured {
            level: *event.metadata().level(),
            message,
            fields: fields.0,
            spans,
        });
    }
}

impl Output {
    pub(in crate::domain::mailbox::link_manager) fn count(&self, message: &str) -> usize {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|event| event.message == message)
            .count()
    }

    pub(in crate::domain::mailbox::link_manager) fn subscriber(
        &self,
    ) -> impl tracing::Subscriber + Send + Sync + 'static {
        tracing_subscriber::registry()
            .with(tracing_subscriber::filter::LevelFilter::TRACE)
            .with(Capture(self.clone()))
    }
}

pub(in crate::domain::mailbox::link_manager) fn assert_event(
    output: &Output,
    level: tracing::Level,
    message: &str,
    span: &str,
    fields: impl IntoIterator<Item = (&'static str, String)>,
) {
    let records = output.0.lock().unwrap();
    let matching: Vec<_> = records
        .iter()
        .filter(|event| event.message == message)
        .collect();
    assert_eq!(matching.len(), 1, "{records:?}");
    assert_eq!(matching[0].level, level);
    assert!(
        matching[0].spans.iter().any(|name| *name == span),
        "{:?}",
        matching[0]
    );
    assert_eq!(
        matching[0].fields,
        fields
            .into_iter()
            .map(|(name, value)| (name.into(), value))
            .collect()
    );
}

#[tokio::test]
async fn absent_link_emits_one_debug_event_with_the_id_inside_the_listener_span() {
    for message in [
        LinkManagerMessage::NotifyReauthRequired { link_id: LINK },
        LinkManagerMessage::DeleteLink {
            link_id: LINK,
            deletion_reason: DeletionReason::Unused,
        },
    ] {
        let (service, fake) = service();
        fake.0.lock().unwrap().link = None;
        let output = Output::default();
        async {
            service
                .process(Ok(message))
                .instrument(tracing::info_span!("process_message"))
                .await;
        }
        .with_subscriber(output.subscriber())
        .await;
        assert_event(
            &output,
            tracing::Level::DEBUG,
            "Link not found - skipping",
            "process_message",
            [("link_id", LINK.to_string())],
        );
        assert_eq!(output.0.lock().unwrap().len(), 1);
    }
}
