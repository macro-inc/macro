use super::*;
use chrono::DateTime;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use opentelemetry::trace::{SpanId, TracerProvider as _};
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider, SpanData};
use rootcause::Report;
use tracing_subscriber::{Layer as _, filter::LevelFilter, layer::SubscriberExt as _};

/// Ends the scheduler loop once its round has scheduled and reaped.
struct Syncs(tokio_util::sync::CancellationToken);

impl GoogleCalendarSyncRepository for Syncs {
    async fn schedule_due_google_syncs(&self, _due_before: DateTime<Utc>) -> Result<usize, Report> {
        Ok(3)
    }

    async fn reap_wedged_google_syncs(
        &self,
        _stalled_before: DateTime<Utc>,
    ) -> Result<usize, Report> {
        self.0.cancel();
        Ok(1)
    }
}

struct Pruner;

impl CalendarChangeLogPruner for Pruner {
    async fn prune_change_log(
        &self,
        _cutoff: DateTime<Utc>,
        _batch: usize,
    ) -> Result<usize, Report> {
        Ok(7)
    }
}

/// The drain never reaches SQS with an empty outbox.
fn unused_queue() -> CalendarBackfillQueueClient {
    let config = aws_sdk_sqs::Config::builder()
        .behavior_version(aws_sdk_sqs::config::BehaviorVersion::latest())
        .region(aws_sdk_sqs::config::Region::new("us-east-1"))
        .build();
    CalendarBackfillQueueClient::new(aws_sdk_sqs::Client::from_conf(config), "unused")
}

fn attribute(span: &SpanData, key: &str) -> Option<String> {
    span.attributes
        .iter()
        .find(|attribute| attribute.key.as_str() == key)
        .map(|attribute| attribute.value.to_string())
}

/// A span wrapping the whole loop never closes, so its rounds never formed a
/// finished trace; each round must be its own root span.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn each_scheduler_round_is_its_own_finished_root_span(db: PgPool) {
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry().with(
        tracing_opentelemetry::layer()
            .with_tracer(provider.tracer("calendar-outbox-test"))
            .with_filter(LevelFilter::INFO),
    );
    let _guard = tracing::subscriber::set_default(subscriber);
    let token = tokio_util::sync::CancellationToken::new();
    let scheduler = GoogleCalendarSyncScheduler::new(Syncs(token.clone()));
    let retention = CalendarChangeLogRetention::new(Pruner);
    let queue = unused_queue();

    // The first round registers the callsites. Another test thread may have
    // cached a "never" interest for them, so recompute it and measure again.
    run_round(&db, &queue, &scheduler, &retention, true).await;
    tracing::callsite::rebuild_interest_cache();
    exporter.reset();

    // The loop's first round prunes, then the cancelled token ends the loop.
    let token = tokio_util::sync::CancellationToken::new();
    run(
        db.clone(),
        queue.clone(),
        GoogleCalendarSyncScheduler::new(Syncs(token.clone())),
        CalendarChangeLogRetention::new(Pruner),
        true,
        token,
    )
    .await;
    run_round(&db, &queue, &scheduler, &retention, false).await;

    let spans = exporter.get_finished_spans().unwrap();
    let rounds: Vec<_> = spans
        .iter()
        .filter(|span| span.name == "calendar.sync_scheduler")
        .collect();
    let [pruning, plain] = rounds.as_slice() else {
        panic!("expected two scheduler rounds, got {spans:?}");
    };
    assert_eq!(pruning.parent_span_id, SpanId::INVALID);
    assert_eq!(plain.parent_span_id, SpanId::INVALID);
    assert_ne!(
        pruning.span_context.trace_id(),
        plain.span_context.trace_id()
    );

    assert_eq!(attribute(pruning, "scheduled").as_deref(), Some("3"));
    assert_eq!(attribute(pruning, "reaped").as_deref(), Some("1"));
    assert_eq!(attribute(pruning, "published").as_deref(), Some("0"));
    assert_eq!(attribute(pruning, "pruned").as_deref(), Some("7"));
    assert_eq!(attribute(plain, "pruned"), None);

    let drains: Vec<_> = spans
        .iter()
        .filter(|span| span.name == "drain_calendar")
        .collect();
    assert_eq!(drains.len(), 2);
    assert_eq!(
        drains[0].span_context.trace_id(),
        pruning.span_context.trace_id()
    );
    assert_eq!(drains[0].parent_span_id, pruning.span_context.span_id());
}
