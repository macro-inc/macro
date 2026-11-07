//! Opt-in measurements against disposable Postgres and raft OpenBao only.
use super::*;
use chrono::Utc;
use opentelemetry::trace::{TraceContextExt, TracerProvider};
use opentelemetry_otlp::WithExportConfig;
use sqlx::postgres::PgPoolOptions;
use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Instant,
};
use tracing::{Id, Instrument, Subscriber, field::Visit};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use tracing_subscriber::{Layer, layer::Context, prelude::*};

const POOL_CONNECTIONS: u32 = 20;

#[derive(Default)]
struct Measurements {
    pool_raw_max: usize,
    pool_histogram: [u32; POOL_CONNECTIONS as usize + 1],
    acquire_ms: Vec<f64>,
    leases_ms: Vec<f64>,
    logins: u32,
    retries: u32,
    started: HashMap<Id, Instant>,
}

struct Metrics {
    pool: PgPool,
    values: Arc<Mutex<Measurements>>,
    checked_out: Arc<AtomicUsize>,
}

struct Fields<'a>(&'a mut Measurements);
impl Visit for Fields<'_> {
    fn record_debug(&mut self, _: &tracing::field::Field, _: &dyn std::fmt::Debug) {}
    fn record_f64(&mut self, field: &tracing::field::Field, value: f64) {
        if field.name() == "aquired_after_secs" {
            self.0.acquire_ms.push(value * 1000.0);
        }
    }
    fn record_bool(&mut self, field: &tracing::field::Field, value: bool) {
        if field.name() == "token_retry" && value {
            self.0.retries += 1;
        }
    }
}

impl<S: Subscriber> Layer<S> for Metrics {
    fn on_new_span(&self, attrs: &tracing::span::Attributes<'_>, id: &Id, _: Context<'_, S>) {
        let mut values = self.values.lock().expect("metrics");
        match attrs.metadata().name() {
            "passwords.lease.hold" => {
                values.started.insert(id.clone(), Instant::now());
            }
            "passwords.openbao.authenticate" => values.logins += 1,
            _ => {}
        }
    }
    fn on_close(&self, id: Id, _: Context<'_, S>) {
        let mut values = self.values.lock().expect("metrics");
        if let Some(started) = values.started.remove(&id) {
            values
                .leases_ms
                .push(started.elapsed().as_secs_f64() * 1000.0);
        }
    }
    fn on_record(&self, _: &Id, record: &tracing::span::Record<'_>, _: Context<'_, S>) {
        record.record(&mut Fields(&mut self.values.lock().expect("metrics")));
    }
    fn on_event(&self, event: &tracing::Event<'_>, _: Context<'_, S>) {
        if event.metadata().target() == "sqlx::pool::acquire" {
            let mut values = self.values.lock().expect("metrics");
            let raw = self.pool.size() as usize - self.pool.num_idle();
            let used = self.checked_out.load(Ordering::SeqCst);
            assert!(
                used <= POOL_CONNECTIONS as usize,
                "pool accounting must remain bounded"
            );
            values.pool_raw_max = values.pool_raw_max.max(raw);
            values.pool_histogram[used] += 1;
            event.record(&mut Fields(&mut values));
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires explicit disposable raft OpenBao and macrodb_pwconc"]
#[expect(
    clippy::disallowed_methods,
    reason = "explicit disposable benchmark configuration"
)]
async fn import_performance() {
    let Ok(mode) = std::env::var("PWCONC_MODE") else {
        eprintln!("Import benchmark requires explicit PWCONC_MODE=after; skipped.");
        return;
    };
    assert_eq!(mode, "after");
    let database = std::env::var("DATABASE_URL").expect("scratch database");
    assert_eq!(
        database,
        "postgres://user:password@localhost:5432/macrodb_pwconc"
    );
    let checked_out = Arc::new(AtomicUsize::new(0));
    let checked_out_max = Arc::new(AtomicUsize::new(0));
    let track_acquisitions = Arc::new(AtomicBool::new(false));
    let pool = PgPoolOptions::new()
        .max_connections(POOL_CONNECTIONS)
        .min_connections(POOL_CONNECTIONS)
        .max_lifetime(None)
        .idle_timeout(None)
        .before_acquire({
            let active = checked_out.clone();
            let peak = checked_out_max.clone();
            let track = track_acquisitions.clone();
            move |_, _| {
                let active = active.clone();
                let peak = peak.clone();
                let track = track.clone();
                Box::pin(async move {
                    if track.load(Ordering::SeqCst) {
                        let used = active.fetch_add(1, Ordering::SeqCst) + 1;
                        peak.fetch_max(used, Ordering::SeqCst);
                    }
                    Ok(true)
                })
            }
        })
        .after_release({
            let active = checked_out.clone();
            let track = track_acquisitions.clone();
            move |_, _| {
                let active = active.clone();
                let track = track.clone();
                Box::pin(async move {
                    if track.load(Ordering::SeqCst) {
                        assert!(
                            active.fetch_sub(1, Ordering::SeqCst) > 0,
                            "balanced pool returns"
                        );
                    }
                    Ok(true)
                })
            }
        })
        .acquire_time_level(log::LevelFilter::Debug)
        .connect(&database)
        .await
        .expect("scratch pool");
    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint("http://127.0.0.1:4317")
        .build()
        .expect("collector exporter");
    let telemetry = opentelemetry_sdk::trace::SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(
            opentelemetry_sdk::Resource::builder()
                .with_service_name("password-import-benchmark")
                .build(),
        )
        .build();
    let measurements = Arc::new(Mutex::new(Measurements::default()));
    tracing_subscriber::registry()
        .with(Metrics {
            pool: pool.clone(),
            values: measurements.clone(),
            checked_out: checked_out.clone(),
        })
        .with(
            tracing_opentelemetry::layer()
                .with_tracer(telemetry.tracer("password-import-benchmark")),
        )
        .with(tracing_subscriber::filter::filter_fn(|metadata| {
            metadata.target().starts_with("passwords") || metadata.target() == "sqlx::pool::acquire"
        }))
        .init();
    let (repository, actor, team) = if let Ok(team) = std::env::var("PWCONC_TEAM") {
        use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
        (
            PgRepository::new(pool.clone()).expect("repository"),
            Actor {
                user_id: MacroUserIdStr::parse_from_str("macro|folder@example.test")
                    .expect("synthetic actor")
                    .into_owned(),
            },
            TeamId(Uuid::parse_str(&team).expect("fixture team")),
        )
    } else {
        let (repository, actor, record) = folder_fixture(pool.clone()).await;
        (repository, actor, record.metadata.team_id)
    };
    println!("PWCONC_TEAM {}", team.0);
    let repository = Arc::new(repository);
    let address = std::env::var("PASSWORDS_TEST_OPENBAO_ADDRESS").expect("disposable provider");
    let key_path = std::env::var("PASSWORDS_TEST_OPENBAO_SIGNING_KEY").expect("synthetic key");
    let public_path = std::env::var("PASSWORDS_TEST_OPENBAO_PUBLIC_KEY").expect("public key");
    assert!(
        Command::new("python3")
            .args([
                "../../infra/local/openbao/bootstrap.py",
                "--address",
                &address,
                "--team-id",
                &team.0.to_string(),
                "--jwt-public-key",
                &public_path,
                "--jwt-issuer",
                "macro-local-passwords",
            ])
            .status()
            .expect("bootstrap")
            .success()
    );
    // One logical import keeps the destination-folder population constant.
    let import_id = Uuid::now_v7();
    for size in [25, 300] {
        for (repetition, order) in [[1, 2, 4, 8, 16], [16, 8, 4, 2, 1], [4, 1, 8, 16, 2]]
            .into_iter()
            .enumerate()
        {
            for concurrency in order {
                // Quiesce the previous configuration, including SQLx's spawned
                // return tasks, before resetting metrics or starting its clock.
                track_acquisitions.store(false, Ordering::SeqCst);
                let mut connections = Vec::new();
                for _ in 0..POOL_CONNECTIONS {
                    connections.push(pool.acquire().await.expect("drain fixture pool"));
                }
                for connection in &mut connections {
                    connection.return_to_pool().await;
                }
                checked_out.store(0, Ordering::SeqCst);
                checked_out_max.store(0, Ordering::SeqCst);
                track_acquisitions.store(true, Ordering::SeqCst);
                let provider = Arc::new(
                    OpenBaoProvider::new(
                        address.clone(),
                        "macro-local-passwords".into(),
                        &std::fs::read_to_string(&key_path).expect("synthetic key"),
                    )
                    .expect("provider"),
                );
                let service = PasswordService {
                    repository: repository.clone(),
                    provider,
                    availability: Arc::new(FakeAvailability),
                };
                let root = tracing::info_span!(
                    "passwords.import.benchmark",
                    concurrency = i64::from(concurrency),
                    items = i64::from(size),
                    repetition = repetition as i64
                );
                let trace_id = root.context().span().span_context().trace_id().to_string();
                *measurements.lock().expect("metrics") = Measurements::default();
                let started_at = Utc::now();
                let start = Instant::now();
                let mut batches_ms = vec![];
                for offset in (0..size).step_by(25) {
                    let items: Vec<_> = (offset..offset+25).map(|index| serde_json::json!({
                    "sourceKey": format!("n{concurrency}-s{size}-r{repetition}-item{index}"), "name":"Synthetic benchmark", "kind":"login", "favorite":false,
                    "values":{"username":"synthetic-user", "password":"synthetic-value", "notes":"", "fields":[]},
                    "totp": if index % 5 == 0 { Some("JBSWY3DPEHPK3PXP") } else { None }
                })).collect();
                    let batch = serde_json::from_value(serde_json::json!({
                    "format":"bitwarden_json", "target":{"kind":"new", "name":"Synthetic benchmark"}, "private":false, "folders":[], "items":items
                })).expect("bounded fixture");
                    let batch_start = Instant::now();
                    let result = service
                        .import_batch_at_concurrency(
                            &actor,
                            team,
                            import_id,
                            batch,
                            std::num::NonZeroUsize::new(concurrency as usize)
                                .expect("nonzero benchmark concurrency"),
                        )
                        .instrument(root.clone())
                        .await
                        .expect("batch");
                    batches_ms.push(batch_start.elapsed().as_secs_f64() * 1000.0);
                    assert!(
                        result
                            .items
                            .iter()
                            .all(|item| item.outcome == ImportOutcome::Created),
                        "every fixture item must import"
                    );
                }
                let wall_ms = start.elapsed().as_secs_f64() * 1000.0;
                let finished_at = Utc::now();
                drop(root);
                let values = measurements.lock().expect("metrics");
                println!(
                    "PWCONC {}",
                    serde_json::json!({
                        "mode":mode, "concurrency":concurrency, "items":size, "repetition":repetition,
                        "wall_ms":wall_ms, "ms_per_item":wall_ms/f64::from(size), "batches_ms":batches_ms,
                    "pool_size":POOL_CONNECTIONS, "pool_max":checked_out_max.load(Ordering::SeqCst), "pool_raw_max":values.pool_raw_max,
                    "pool_histogram":values.pool_histogram, "acquire_ms":values.acquire_ms,
                        "leases_ms":values.leases_ms, "logins":values.logins, "token_retries":values.retries,
                        "errors":0, "started_at":started_at.to_rfc3339(), "finished_at":finished_at.to_rfc3339(), "trace_id":trace_id
                    })
                );
            }
        }
    }
    telemetry.force_flush().expect("export benchmark traces");
    telemetry.shutdown().expect("close exporter");
    pool.close().await;
}
