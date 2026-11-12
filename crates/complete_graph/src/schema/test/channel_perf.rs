//! Opt-in read-only comparison against the already-seeded channels stack.
use std::{hint::black_box, str::FromStr, time::Instant};

use activity::outbound::pg_activity_repo::PgActivityRepo;
use graphql_channel::ChannelGraphqlContext;
use messages::{
    domain::{
        ports::{MessageTimelineQuery, NoMessageEventPublisher},
        service::{MessageService, MessageView},
    },
    outbound::pg_message_repo::PgMessageRepository,
};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use tracing::{Subscriber, instrument::WithSubscriber, span};
use tracing_subscriber::{Layer, layer::Context, prelude::*, registry::LookupSpan};

use super::*;

const WARMUP_PAIRS: usize = 20;
const SAMPLE_PAIRS: usize = 200;
const PAGE_SIZE: u16 = 50;
const PHASE_NAMES: [&str; 4] = [
    "channel.timeline.authorize",
    "channel.timeline.sequence",
    "channel.timeline.read",
    "channel.timeline.map",
];

#[derive(Clone, Copy)]
struct PhaseStarted {
    index: usize,
    at: Instant,
}

struct TimelineTimings {
    phases: Arc<Mutex<[Option<std::time::Duration>; 4]>>,
    statements: Arc<Mutex<Vec<String>>>,
    capture_sql: Arc<AtomicBool>,
}

#[derive(Default)]
struct SqlStatement {
    statement: Option<String>,
    summary: Option<String>,
}

impl tracing::field::Visit for SqlStatement {
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        match field.name() {
            "db.statement" if !value.is_empty() => self.statement = Some(value.to_owned()),
            "summary" => self.summary = Some(value.to_owned()),
            _ => {}
        }
    }

    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        match field.name() {
            "db.statement" => self.statement = Some(format!("{value:?}")),
            "summary" => self.summary = Some(format!("{value:?}")),
            _ => {}
        }
    }
}

impl<S> Layer<S> for TimelineTimings
where
    S: Subscriber + for<'lookup> LookupSpan<'lookup>,
{
    fn on_new_span(&self, attributes: &span::Attributes<'_>, id: &span::Id, ctx: Context<'_, S>) {
        let Some(index) = PHASE_NAMES
            .iter()
            .position(|name| *name == attributes.metadata().name())
        else {
            return;
        };
        ctx.span(id)
            .expect("new span is registered")
            .extensions_mut()
            .insert(PhaseStarted {
                index,
                at: Instant::now(),
            });
    }

    fn on_close(&self, id: span::Id, ctx: Context<'_, S>) {
        let span = ctx.span(&id).expect("closing span is registered");
        let Some(phase) = span.extensions().get::<PhaseStarted>().copied() else {
            return;
        };
        let elapsed = phase.at.elapsed();
        let mut phases = self.phases.lock().expect("phase duration lock");
        assert!(phases[phase.index].replace(elapsed).is_none());
    }

    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        if event.metadata().target() != "sqlx::query" || !self.capture_sql.load(Ordering::Relaxed) {
            return;
        }
        let mut statement = SqlStatement::default();
        event.record(&mut statement);
        self.statements
            .lock()
            .expect("statement inventory lock")
            .push(
                statement
                    .statement
                    .or(statement.summary)
                    .expect("SQLx query event contains SQL without parameter values"),
            );
    }
}

fn percentile_ms(samples: &[std::time::Duration], percentile: usize) -> f64 {
    let mut sorted = samples.to_vec();
    sorted.sort_unstable();
    sorted[(sorted.len() - 1) * percentile / 100].as_secs_f64() * 1000.0
}

/// Includes GraphQL parsing, validation, dispatch, selected-field resolution and
/// response serialization. The REST comparison includes the same domain read
/// and serialization of the exact DTO returned by the REST timeline handler.
/// Both use the same warmed pool; authentication and access checks are stubbed,
/// and HTTP/network time is excluded. The extra sequence read is included as
/// soon as it is wired into the resolver.
#[tokio::test]
#[ignore = "requires read-only seeded channel database"]
async fn channel_latest_graphql_and_rest_server_timings() {
    let database_url = std::env::var("CHANNEL_PERF_DATABASE_URL")
        .expect("CHANNEL_PERF_DATABASE_URL must target the existing channels stack");
    let channel_id = Uuid::parse_str(
        &std::env::var("CHANNEL_PERF_CHANNEL_ID")
            .expect("CHANNEL_PERF_CHANNEL_ID must identify the seeded 50,000-message channel"),
    )
    .expect("valid channel UUID");
    let options =
        PgConnectOptions::from_str(&database_url).expect("valid performance database URL");
    assert!(matches!(options.get_host(), "localhost" | "127.0.0.1"));
    assert_eq!(
        options.get_port(),
        22900,
        "only the channels stack is allowed"
    );
    let options = options
        .application_name("channel_graphql_readonly_perf")
        .options([
            ("default_transaction_read_only", "on"),
            ("statement_timeout", "15000"),
        ]);
    let pool = PgPoolOptions::new()
        .min_connections(4)
        .max_connections(4)
        .connect_with(options)
        .await
        .expect("connect to existing channels stack without changing it");
    assert!(
        sqlx::query_scalar!(
            "SELECT current_setting('transaction_read_only') = 'on' AS \"read_only!\""
        )
        .fetch_one(&pool)
        .await
        .expect("check read-only session")
    );
    let viewer_id = sqlx::query_scalar!(
        "SELECT owner_id FROM comms_channels WHERE id = $1",
        channel_id,
    )
    .fetch_one(&pool)
    .await
    .expect("read the seeded channel owner");
    let viewer_id = MacroUserIdStr::try_from(viewer_id).expect("seeded channel owner is a user");
    let receipt = EntityAccessReceipt::<MessageView>::try_new_authenticated_user(
        viewer_id,
        entity_access::domain::models::Entity {
            entity_id: channel_id.to_string(),
            entity_type: EntityType::Channel,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .expect("channel view capability");
    let reads = Arc::new(
        MessageService::new(
            PgMessageRepository::new(pool.clone()),
            NoMessageEventPublisher,
        )
        .with_activity(PgActivityRepo::new(pool.clone())),
    );
    let harness = harness();
    harness
        .state
        .entity_access
        .viewable_channels
        .lock()
        .expect("channel access lock")
        .insert(channel_id);
    let context =
        ChannelGraphqlContext::new(Arc::clone(&reads), Arc::clone(&harness.state.entity_access));
    let document = format!(
        "{{ user {{ channelTimeline(input: {{ channelId: \"{channel_id}\", limit: {PAGE_SIZE} }}) {{
          entries {{ ... on GraphqlChannelMessage {{ {} }}
            ... on GraphqlChannelTimelineActivity {{ __typename id channelId sortKey actorId occurredAt action payload }} }}
          olderCursor newerCursor seq }} }} }}",
        super::channel::message_selection(),
    );
    let mut graphql_times = Vec::with_capacity(SAMPLE_PAIRS);
    let mut rest_times = Vec::with_capacity(SAMPLE_PAIRS);
    let mut rest_domain_times = Vec::with_capacity(SAMPLE_PAIRS);
    let mut rest_serialization_times = Vec::with_capacity(SAMPLE_PAIRS);
    let mut graphql_execution_times = Vec::with_capacity(SAMPLE_PAIRS);
    let mut graphql_serialization_times = Vec::with_capacity(SAMPLE_PAIRS);
    let mut graphql_residual_times = Vec::with_capacity(SAMPLE_PAIRS);
    let mut graphql_phase_times: [Vec<std::time::Duration>; 4] = Default::default();
    let phases = Arc::new(Mutex::new([None; 4]));
    let statements = Arc::new(Mutex::new(Vec::new()));
    let capture_sql = Arc::new(AtomicBool::new(false));
    let dispatch = tracing::Dispatch::new(tracing_subscriber::registry().with(TimelineTimings {
        phases: Arc::clone(&phases),
        statements: Arc::clone(&statements),
        capture_sql: Arc::clone(&capture_sql),
    }));
    for iteration in 0..(WARMUP_PAIRS + SAMPLE_PAIRS) {
        // Alternating order avoids consistently giving either path the hotter
        // buffers or the first opportunity after an unrelated machine task.
        for is_graphql in [iteration % 2 == 0, iteration % 2 != 0] {
            let request = is_graphql.then(|| {
                harness
                    .request(&document, authenticated_parts())
                    .data(context.clone())
            });
            let started = Instant::now();
            let mut rest_phases = None;
            let mut graphql_phases = None;
            if let Some(request) = request {
                // The subscriber follows the future across task polls, while
                // span creation/closure measures wall time including awaits.
                let response = harness
                    .schema
                    .execute(request)
                    .with_subscriber(dispatch.clone())
                    .await;
                let execution_elapsed = started.elapsed();
                assert!(response.errors.is_empty(), "{:?}", response.errors);
                let serialization_started = Instant::now();
                black_box(serde_json::to_vec(&response).expect("serialize GraphQL response"));
                graphql_phases = Some((execution_elapsed, serialization_started.elapsed()));
            } else {
                let page = reads
                    .timeline_entries(
                        receipt.clone(),
                        MessageTimelineQuery {
                            limit: Some(PAGE_SIZE),
                            ..Default::default()
                        },
                    )
                    .with_subscriber(dispatch.clone())
                    .await
                    .expect("REST shared timeline read");
                let domain_elapsed = started.elapsed();
                assert_eq!(page.entries.len(), usize::from(PAGE_SIZE));
                let serialization_started = Instant::now();
                black_box(serde_json::to_vec(&page).expect("serialize REST response"));
                rest_phases = Some((domain_elapsed, serialization_started.elapsed()));
            }
            let elapsed = started.elapsed();
            let recorded_phases = is_graphql.then(|| {
                std::mem::take(&mut *phases.lock().expect("phase duration lock"))
                    .map(|duration| duration.expect("every timeline phase was recorded"))
            });
            if iteration >= WARMUP_PAIRS {
                if is_graphql {
                    graphql_times.push(elapsed);
                    let (execution, serialization) = graphql_phases.expect("GraphQL phase timings");
                    graphql_execution_times.push(execution);
                    graphql_serialization_times.push(serialization);
                    let recorded = recorded_phases.expect("GraphQL span timings");
                    let measured = recorded.iter().sum();
                    graphql_residual_times.push(
                        execution
                            .checked_sub(measured)
                            .expect("phases are inside execution"),
                    );
                    for (samples, duration) in graphql_phase_times.iter_mut().zip(recorded) {
                        samples.push(duration);
                    }
                } else {
                    rest_times.push(elapsed);
                    let (domain, serialization) = rest_phases.expect("REST phase timings");
                    rest_domain_times.push(domain);
                    rest_serialization_times.push(serialization);
                }
            }
        }
    }
    let graphql_median = percentile_ms(&graphql_times, 50);
    let rest_median = percentile_ms(&rest_times, 50);
    let profile = if cfg!(debug_assertions) {
        "debug assertions enabled"
    } else {
        "debug assertions disabled"
    };
    eprintln!(
        "channel latest page ({profile}): size={PAGE_SIZE}, warmup_pairs={WARMUP_PAIRS}, sample_pairs={SAMPLE_PAIRS}, \
         GraphQL median={graphql_median:.3}ms p95={:.3}ms; REST median={rest_median:.3}ms p95={:.3}ms; \
         median_ratio={:.3}, median_delta={:.3}ms",
        percentile_ms(&graphql_times, 95),
        percentile_ms(&rest_times, 95),
        graphql_median / rest_median,
        graphql_median - rest_median,
    );
    let domain_median = percentile_ms(&rest_domain_times, 50);
    eprintln!(
        "REST phases: domain median={domain_median:.3}ms p95={:.3}ms; \
         DTO JSON median={:.3}ms p95={:.3}ms; \
         GraphQL p50 minus shared-domain p50={:.3}ms (inferred adapter and serialization cost)",
        percentile_ms(&rest_domain_times, 95),
        percentile_ms(&rest_serialization_times, 50),
        percentile_ms(&rest_serialization_times, 95),
        graphql_median - domain_median,
    );
    for (name, samples) in PHASE_NAMES.iter().zip(&graphql_phase_times) {
        eprintln!(
            "GraphQL {name}: median={:.3}ms p95={:.3}ms",
            percentile_ms(samples, 50),
            percentile_ms(samples, 95),
        );
    }
    eprintln!(
        "GraphQL execute median={:.3}ms p95={:.3}ms; \
         execute residual median={:.3}ms p95={:.3}ms; \
         response JSON median={:.3}ms p95={:.3}ms",
        percentile_ms(&graphql_execution_times, 50),
        percentile_ms(&graphql_execution_times, 95),
        percentile_ms(&graphql_residual_times, 50),
        percentile_ms(&graphql_residual_times, 95),
        percentile_ms(&graphql_serialization_times, 50),
        percentile_ms(&graphql_serialization_times, 95),
    );

    // Inventory probes are untimed so retaining SQL text does not affect the
    // samples. SQLx records statement templates, never bound parameter values.
    capture_sql.store(true, Ordering::Relaxed);
    let response = harness
        .schema
        .execute(
            harness
                .request(&document, authenticated_parts())
                .data(context),
        )
        .with_subscriber(dispatch.clone())
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let graphql_statements =
        std::mem::take(&mut *statements.lock().expect("statement inventory lock"));
    reads
        .timeline_entries(
            receipt,
            MessageTimelineQuery {
                limit: Some(PAGE_SIZE),
                ..Default::default()
            },
        )
        .with_subscriber(dispatch)
        .await
        .expect("REST SQL inventory read");
    capture_sql.store(false, Ordering::Relaxed);
    let rest_statements =
        std::mem::take(&mut *statements.lock().expect("statement inventory lock"));
    for (path, inventory) in [("GraphQL", graphql_statements), ("REST", rest_statements)] {
        eprintln!("{path} SQL statement count={}", inventory.len());
        for (index, statement) in inventory.iter().enumerate() {
            eprintln!(
                "{path} SQL {}: {}",
                index + 1,
                statement.split_whitespace().collect::<Vec<_>>().join(" ")
            );
        }
    }
    pool.close().await;
}
