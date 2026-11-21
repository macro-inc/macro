//! Fixed arrivals test whether per-parent admission protects a shared pool.

use super::*;
use std::sync::OnceLock;

const SECONDS: u64 = 10;
const NEIGHBOR_RATE: u32 = 20;
const FIELDS: &[&str] = &[
    "proof",
    "label",
    "runtime",
    "profile",
    "run",
    "variant",
    "lane",
    "flood_rate",
    "offered_rate",
    "requested_hold_ms",
    "scheduled_seconds",
    "pool_min",
    "pool_max",
    "acquire_timeout_ms",
    "pool_size_at_start",
    "attempts",
    "admission_accepted",
    "admission_rejected",
    "successes",
    "errors",
    "pool_acquire_timeouts",
    "sqlstate_55P03",
    "sqlstate_57014",
    "sqlstate_40P01",
    "other_errors",
    "arrival_p50_ms",
    "arrival_p95_ms",
    "arrival_p99_ms",
    "success_p50_ms",
    "success_p95_ms",
    "success_p99_ms",
    "rejection_arrival_p50_ms",
    "rejection_arrival_p95_ms",
    "rejection_arrival_p99_ms",
    "rejection_service_p50_ms",
    "rejection_service_p95_ms",
    "rejection_service_p99_ms",
    "actual_hold_p50_ms",
    "actual_hold_p95_ms",
    "actual_hold_p99_ms",
    "lane_wall_ms",
    "successful_ops_s",
    "attempt_ops_s",
];

#[derive(Clone, Copy)]
struct Case {
    run: usize,
    flood_rate: u32,
    hold: Option<Duration>,
    previous: bool,
}

struct PoolFacts {
    minimum: u32,
    maximum: u32,
    acquire_timeout: Duration,
    size: u32,
}

#[derive(Default)]
struct Results {
    attempts: Vec<Duration>,
    successes: Vec<Duration>,
    rejection_arrival: Vec<Duration>,
    rejection_service: Vec<Duration>,
    actual_hold: Vec<Duration>,
    failures: FailureCounts,
    wall: Duration,
}

impl Results {
    fn record(&mut self, sample: Sample) {
        self.attempts.push(sample.arrival);
        match sample.result {
            Ok(hold) => {
                self.successes.push(sample.arrival);
                self.actual_hold.push(hold);
            }
            Err(error) => {
                let admission = match &error {
                    MessageError::Repository(report) | MessageError::Contended(report) => report
                        .downcast_current_context::<message_write_gate::AdmissionTimeout>()
                        .is_some(),
                    _ => false,
                };
                if admission {
                    self.rejection_arrival.push(sample.arrival);
                    self.rejection_service.push(sample.service);
                } else {
                    self.failures.record(&error);
                }
            }
        }
    }

    fn sort(&mut self) {
        self.attempts.sort_unstable();
        self.successes.sort_unstable();
        self.rejection_arrival.sort_unstable();
        self.rejection_service.sort_unstable();
        self.actual_hold.sort_unstable();
    }
}

struct Sample {
    arrival: Duration,
    service: Duration,
    result: Result<Duration, MessageError>,
}

async fn edit(
    repo: &PgMessageRepository,
    parent: &MessageParent,
    id: Uuid,
    case: Case,
) -> Result<Duration, MessageError> {
    let command = EditMessage {
        notification_policy: Default::default(),
        content: "edited by fixed-arrival benchmark".into(),
        mentions: vec![],
        attachments: None,
        nonce: None,
    };
    match (case.previous, case.hold) {
        (true, None) => repo
            .edit_before_sequences(parent, id, command)
            .await
            .map(|_| Duration::ZERO),
        (false, None) => repo.edit(parent, id, command).await.map(|_| Duration::ZERO),
        (true, Some(hold)) => repo
            .edit_before_commit_delay(parent, id, command, hold)
            .await
            .map(|(_, actual)| actual),
        (false, Some(hold)) => repo
            .edit_after_commit_delay(parent, id, command, hold)
            .await
            .map(|(_, actual)| actual),
    }
}

struct Lane {
    parent: MessageParent,
    ids: Vec<Uuid>,
    rate: u32,
}

async fn run_lane(
    repo: PgMessageRepository,
    lane: Lane,
    case: Case,
    ready: Arc<Barrier>,
    begin: Arc<Barrier>,
    start: Arc<OnceLock<Instant>>,
) -> Results {
    ready.wait().await;
    begin.wait().await;
    let started = *start.get().unwrap();
    let mut arrivals = tokio::time::interval_at(
        tokio::time::Instant::from_std(started),
        Duration::from_secs_f64(1.0 / f64::from(lane.rate)),
    );
    arrivals.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Burst);
    let expected = lane.ids.len();
    let mut writes = JoinSet::new();
    for id in lane.ids {
        let scheduled = arrivals.tick().await.into_std();
        let repo = repo.clone();
        let parent = lane.parent.clone();
        // Admission belongs entirely to the repository. In particular, there
        // is no benchmark semaphore before its gate or the shared pool.
        writes.spawn(async move {
            let service_started = Instant::now();
            let result = edit(&repo, &parent, id, case).await;
            let completed = Instant::now();
            Sample {
                arrival: completed.duration_since(scheduled),
                service: completed.duration_since(service_started),
                result,
            }
        });
    }
    let mut results = Results::default();
    while let Some(completed) = writes.join_next().await {
        results.record(completed.expect("request task failed outside its repository result"));
    }
    results.wall = started.elapsed();
    assert_eq!(results.attempts.len(), expected);
    assert_eq!(
        results.attempts.len(),
        results.successes.len() + results.rejection_arrival.len() + results.failures.total()
    );
    results
}

async fn run_case(repo: &PgMessageRepository, case: Case) -> (Results, Results, [Uuid; 2]) {
    let flood_channel = super::super::sequences::channel_fixture(&repo.pool).await;
    let neighbor_channel = super::super::sequences::channel_fixture(&repo.pool).await;
    // Each request edits its own row, isolating parent-wide serialization from
    // message-row lock contention. All rows exist before either timer starts.
    let flood = Lane {
        parent: MessageParent::Channel(flood_channel),
        ids: targets(
            repo,
            &[flood_channel],
            Operation::Edit,
            case.flood_rate as usize * SECONDS as usize,
        )
        .await,
        rate: case.flood_rate,
    };
    let neighbor = Lane {
        parent: MessageParent::Channel(neighbor_channel),
        ids: targets(
            repo,
            &[neighbor_channel],
            Operation::Edit,
            NEIGHBOR_RATE as usize * SECONDS as usize,
        )
        .await,
        rate: NEIGHBOR_RATE,
    };
    let ready = Arc::new(Barrier::new(3));
    let begin = Arc::new(Barrier::new(3));
    let start = Arc::new(OnceLock::new());
    let flood_task = tokio::spawn(run_lane(
        repo.clone(),
        flood,
        case,
        ready.clone(),
        begin.clone(),
        start.clone(),
    ));
    let neighbor_task = tokio::spawn(run_lane(
        repo.clone(),
        neighbor,
        case,
        ready.clone(),
        begin.clone(),
        start.clone(),
    ));
    ready.wait().await;
    start.set(Instant::now()).unwrap();
    begin.wait().await;
    let (flood, neighbor) = tokio::join!(flood_task, neighbor_task);
    (
        flood.expect("flood scheduler failed"),
        neighbor.expect("neighbor scheduler failed"),
        [flood_channel, neighbor_channel],
    )
}

fn quantile(samples: &[Duration], percentile: usize) -> String {
    if samples.is_empty() {
        "NA".into()
    } else {
        format!("{:.3}", percentile_ms(samples, percentile))
    }
}

fn report(label: &str, facts: &PoolFacts, case: Case, lane: &str, mut results: Results) {
    results.sort();
    let errors = results.rejection_arrival.len() + results.failures.total();
    let mut values = vec![
        "admission_pool".into(),
        label.into(),
        "multi_thread_16".into(),
        profile().into(),
        case.run.to_string(),
        if case.previous { "before" } else { "after" }.into(),
        lane.into(),
        case.flood_rate.to_string(),
        if lane == "flood" {
            case.flood_rate
        } else {
            NEIGHBOR_RATE
        }
        .to_string(),
        format!(
            "{:.3}",
            case.hold.unwrap_or_default().as_secs_f64() * 1000.0
        ),
        SECONDS.to_string(),
        facts.minimum.to_string(),
        facts.maximum.to_string(),
        facts.acquire_timeout.as_millis().to_string(),
        facts.size.to_string(),
        results.attempts.len().to_string(),
        (results.attempts.len() - results.rejection_arrival.len()).to_string(),
        results.rejection_arrival.len().to_string(),
        results.successes.len().to_string(),
        errors.to_string(),
        results.failures.acquire_timeout.to_string(),
        results.failures.lock_unavailable.to_string(),
        results.failures.query_cancelled.to_string(),
        results.failures.deadlock.to_string(),
        results.failures.other.to_string(),
    ];
    for samples in [
        &results.attempts,
        &results.successes,
        &results.rejection_arrival,
        &results.rejection_service,
        &results.actual_hold,
    ] {
        for percentile in [50, 95, 99] {
            values.push(quantile(samples, percentile));
        }
    }
    values.extend([
        format!("{:.3}", results.wall.as_secs_f64() * 1000.0),
        format!(
            "{:.1}",
            results.successes.len() as f64 / results.wall.as_secs_f64()
        ),
        format!(
            "{:.1}",
            results.attempts.len() as f64 / results.wall.as_secs_f64()
        ),
    ]);
    assert_eq!(values.len(), FIELDS.len());
    println!("{}", values.join(","));
}

async fn pool(options: sqlx::postgres::PgConnectOptions) -> PgPool {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .min_connections(10)
        .max_connections(50)
        .connect_with(options.disable_statement_logging())
        .await
        .unwrap();
    setup(&pool).await;
    let connections = futures::future::try_join_all((0..50).map(|_| pool.acquire()))
        .await
        .unwrap();
    drop(connections);
    pool
}

async fn measure(options: sqlx::postgres::PgConnectOptions) {
    let pool = pool(options).await;
    let facts = PoolFacts {
        minimum: pool.options().get_min_connections(),
        maximum: pool.options().get_max_connections(),
        acquire_timeout: pool.options().get_acquire_timeout(),
        size: pool.size(),
    };
    let repo = PgMessageRepository::new(pool.clone());
    let label =
        std::env::var("CHANNEL_SEQUENCE_ADMISSION_LABEL").unwrap_or_else(|_| "admission4".into());
    assert!(
        !label.is_empty()
            && label
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    );
    println!("{}", FIELDS.join(","));
    for run in 1..=3 {
        for flood_rate in [1_000, 3_000] {
            for hold in [
                None,
                Some(Duration::from_millis(2)),
                Some(Duration::from_millis(5)),
            ] {
                for previous in [true, false] {
                    let case = Case {
                        run,
                        flood_rate,
                        hold,
                        previous,
                    };
                    let (flood, neighbor, channels) = run_case(&repo, case).await;
                    report(&label, &facts, case, "flood", flood);
                    report(&label, &facts, case, "neighbor", neighbor);
                    cleanup(&pool, &channels).await;
                }
            }
        }
    }
    pool.close().await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "fixed 1000/3000 per second flood and 20/s neighbor; run alone in release"]
async fn repository_admission_pool_isolation(pool: PgPool) {
    on_sixteen_worker_runtime(measure(pool.connect_options().as_ref().clone())).await;
}

async fn simultaneous_posts(options: sqlx::postgres::PgConnectOptions) {
    // Admission lets four writes per channel reach the database at once, so a
    // small pool is enough; this test runs beside the whole suite and must not
    // take the server's connections from it.
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(8)
        .connect_with(options.disable_statement_logging())
        .await
        .unwrap();
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    for hold in [None, Some(Duration::from_millis(5))] {
        let channel = super::super::sequences::channel_fixture(&pool).await;
        let parent = MessageParent::Channel(channel);
        let start = Arc::new(Barrier::new(21));
        let mut posts = JoinSet::new();
        for index in 0..20 {
            let repo = repo.clone();
            let parent = parent.clone();
            let start = start.clone();
            posts.spawn(async move {
                let mut input = command("message-doc-a", None, &format!("concurrent post {index}"));
                input.parent = parent;
                start.wait().await;
                match hold {
                    None => repo.create(input).await,
                    Some(hold) => repo
                        .create_after_commit_delay(input, hold)
                        .await
                        .map(|(value, _)| value),
                }
            });
        }
        start.wait().await;
        let mut messages = Vec::new();
        let mut sequences = Vec::new();
        while let Some(result) = posts.join_next().await {
            let (message, seq) = result
                .unwrap()
                .expect("all twenty simultaneous posts must succeed");
            messages.push(message);
            sequences.push(seq.expect("channel writes return their committed sequence"));
        }
        sequences.sort_unstable();
        assert_eq!(sequences, (1..=20).collect::<Vec<i64>>());
        assert_eq!(repo.channel_seq(channel).await.unwrap(), 20);
        for message in messages {
            assert_eq!(
                repo.get(&parent, message.id)
                    .await
                    .unwrap()
                    .unwrap()
                    .content,
                message.content
            );
        }
        cleanup(&pool, &[channel]).await;
    }
    pool.close().await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn twenty_simultaneous_channel_posts_succeed_with_commit_holds(pool: PgPool) {
    on_sixteen_worker_runtime(simultaneous_posts(pool.connect_options().as_ref().clone())).await;
}
