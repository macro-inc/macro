use super::*;
use opentelemetry::{
    Value,
    trace::{Status, TracerProvider as _},
};
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider, SpanData};
use std::sync::Mutex;
use tracing_subscriber::layer::SubscriberExt as _;

const KNOWN: &[&str] = &["channel_mention", "document_mention", "reminder"];

#[derive(Default)]
struct FakeRepository {
    reads: Mutex<Vec<(String, Vec<String>, u32)>>,
    times_out: bool,
}

impl ActiveNotificationIdRepository for FakeRepository {
    async fn active_notification_ids(
        &self,
        user: MacroUserIdStr<'_>,
        event_types: &[String],
        limit: u32,
    ) -> Result<Vec<Uuid>, ActiveNotificationIdStorageError> {
        self.reads
            .lock()
            .unwrap()
            .push((user.to_string(), event_types.to_vec(), limit));
        if self.times_out {
            return Err(ActiveNotificationIdStorageError::TimedOut);
        }
        Ok(vec![Uuid::nil()])
    }
}

/// Keeps finished spans in memory while the returned guard is alive.
fn span_pipeline() -> (
    InMemorySpanExporter,
    SdkTracerProvider,
    tracing::subscriber::DefaultGuard,
) {
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let layer = tracing_opentelemetry::layer().with_tracer(provider.tracer("test"));
    let guard = tracing::subscriber::set_default(tracing_subscriber::registry().with(layer));
    // Tests on other threads may have cached this callsite as uninteresting.
    tracing::callsite::rebuild_interest_cache();
    (exporter, provider, guard)
}

fn attribute(span: &SpanData, key: &str) -> Option<Value> {
    span.attributes
        .iter()
        .find(|attribute| attribute.key.as_str() == key)
        .map(|attribute| attribute.value.clone())
}

fn event_levels(span: &SpanData) -> Vec<String> {
    span.events
        .iter()
        .filter_map(|event| {
            event
                .attributes
                .iter()
                .find(|attribute| attribute.key.as_str() == "level")
                .map(|attribute| attribute.value.to_string())
        })
        .collect()
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap()
}

#[tokio::test]
async fn reads_the_requested_known_types_for_the_user_with_a_default_limit() {
    let service = ActiveNotificationIdService::new(FakeRepository::default(), KNOWN);

    let ids = service
        .list(
            owner(),
            vec![
                "document_mention".into(),
                "channel_mention".into(),
                "document_mention".into(),
            ],
            None,
        )
        .await
        .unwrap();
    service
        .list(owner(), vec!["reminder".into()], Some(500))
        .await
        .unwrap();

    assert_eq!(ids, vec![Uuid::nil()]);
    assert_eq!(
        *service.repository.reads.lock().unwrap(),
        vec![
            (
                "macro|owner@example.com".to_owned(),
                vec!["channel_mention".to_owned(), "document_mention".to_owned()],
                100,
            ),
            (
                "macro|owner@example.com".to_owned(),
                vec!["reminder".to_owned()],
                500,
            ),
        ]
    );
}

#[tokio::test]
async fn rejects_empty_unknown_and_out_of_range_reads_before_storage() {
    let service = ActiveNotificationIdService::new(FakeRepository::default(), KNOWN);

    assert!(matches!(
        service.list(owner(), Vec::new(), None).await,
        Err(ActiveNotificationIdsError::NoEventTypes)
    ));
    assert!(matches!(
        service
            .list(
                owner(),
                vec!["document_mention".into(), "made_up".into()],
                None
            )
            .await,
        Err(ActiveNotificationIdsError::UnknownEventType(event_type)) if event_type == "made_up"
    ));
    for limit in [0, 501] {
        assert!(matches!(
            service
                .list(owner(), vec!["document_mention".into()], Some(limit))
                .await,
            Err(ActiveNotificationIdsError::InvalidLimit)
        ));
    }
    assert!(service.repository.reads.lock().unwrap().is_empty());
}

#[tokio::test]
async fn records_the_count_and_a_timeout_on_the_span_and_warns_once() {
    let (exporter, provider, _guard) = span_pipeline();
    let service = ActiveNotificationIdService::new(FakeRepository::default(), KNOWN);
    let timing_out = ActiveNotificationIdService::new(
        FakeRepository {
            times_out: true,
            ..FakeRepository::default()
        },
        KNOWN,
    );

    service
        .list(owner(), vec!["document_mention".into()], None)
        .await
        .unwrap();
    let error = timing_out
        .list(owner(), vec!["document_mention".into()], None)
        .await
        .unwrap_err();

    assert!(matches!(
        error,
        ActiveNotificationIdsError::Storage(ActiveNotificationIdStorageError::TimedOut)
    ));
    provider.force_flush().unwrap();
    let spans = exporter.get_finished_spans().unwrap();
    assert_eq!(spans.len(), 2);
    assert!(
        spans
            .iter()
            .all(|span| span.name == "notification.active_ids")
    );
    let (read, timed_out) = (&spans[0], &spans[1]);
    assert_eq!(
        attribute(read, "notification.id_count").map(|count| count.to_string()),
        Some("1".to_owned())
    );
    assert_eq!(
        attribute(read, "db.statement_timed_out"),
        Some(Value::Bool(false))
    );
    assert_eq!(read.status, Status::Unset);
    assert!(event_levels(read).is_empty());
    assert_eq!(attribute(timed_out, "notification.id_count"), None);
    assert_eq!(
        attribute(timed_out, "db.statement_timed_out"),
        Some(Value::Bool(true))
    );
    assert!(matches!(timed_out.status, Status::Error { .. }));
    assert_eq!(event_levels(timed_out), vec!["WARN".to_owned()]);
}
