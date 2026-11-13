//! A busy channel and an independently scheduled channel sharing the DSS pool.

use super::*;
use std::sync::OnceLock;

const FLOOD_WRITERS: usize = 100;
const PROBES_PER_SECOND: u64 = 5;
const HOLD: Duration = Duration::from_millis(5);

#[derive(Default)]
struct Results {
    attempts: Vec<Duration>,
    successes: Vec<Duration>,
    failed_attempts: Vec<Duration>,
    successful_holds: Vec<Duration>,
    failures: FailureCounts,
}

impl Results {
    fn record(&mut self, elapsed: Duration, result: Result<Duration, MessageError>) {
        self.attempts.push(elapsed);
        match result {
            Ok(hold) => {
                self.successes.push(elapsed);
                self.successful_holds.push(hold);
            }
            Err(error) => {
                self.failed_attempts.push(elapsed);
                self.failures.record(&error);
            }
        }
    }

    fn merge(&mut self, other: Self) {
        self.attempts.extend(other.attempts);
        self.successes.extend(other.successes);
        self.failed_attempts.extend(other.failed_attempts);
        self.successful_holds.extend(other.successful_holds);
        self.failures.acquire_timeout += other.failures.acquire_timeout;
        self.failures.lock_unavailable += other.failures.lock_unavailable;
        self.failures.query_cancelled += other.failures.query_cancelled;
        self.failures.deadlock += other.failures.deadlock;
        self.failures.other += other.failures.other;
    }
}

struct PoolFacts {
    minimum: u32,
    maximum: u32,
    acquire_timeout: Duration,
    size_at_start: u32,
}

async fn edit(
    repo: &PgMessageRepository,
    parent: &MessageParent,
    id: Uuid,
    content: &str,
    previous: bool,
) -> Result<Duration, MessageError> {
    let command = EditMessage {
        notification_policy: Default::default(),
        content: content.to_owned(),
        mentions: vec![],
        attachments: None,
        nonce: None,
    };
    if previous {
        repo.edit_before_commit_delay(parent, id, command, HOLD)
            .await
            .map(|(_, hold)| hold)
    } else {
        repo.edit_after_commit_delay(parent, id, command, HOLD)
            .await
            .map(|(_, hold)| hold)
    }
}

fn quantile(samples: &[Duration], percentile: usize) -> String {
    if samples.is_empty() {
        "NA".into()
    } else {
        format!("{:.3}", percentile_ms(samples, percentile))
    }
}

struct CaseReport<'a> {
    label: &'a str,
    run: usize,
    previous: bool,
    facts: &'a PoolFacts,
    measured: Duration,
    wall: Duration,
}

fn report(context: &CaseReport<'_>, lane: &str, mut results: Results) {
    let CaseReport {
        label,
        run,
        previous,
        facts,
        measured,
        wall,
    } = context;
    results.attempts.sort_unstable();
    results.successes.sort_unstable();
    results.failed_attempts.sort_unstable();
    results.successful_holds.sort_unstable();
    let variant = if *previous { "before" } else { "after" };
    let offered = if lane == "probe" { "5" } else { "closed_loop" };
    println!(
        "pool_isolation,{label},multi_thread_16,{},{run},{variant},{lane},{FLOOD_WRITERS},{offered},{},{},{},{},{:.3},{:.3},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{:.1},{},{},{}",
        profile(),
        facts.minimum,
        facts.maximum,
        facts.acquire_timeout.as_millis(),
        facts.size_at_start,
        measured.as_secs_f64(),
        wall.as_secs_f64(),
        results.attempts.len(),
        results.successes.len(),
        results.failures.total(),
        results.failures.acquire_timeout,
        results.failures.lock_unavailable,
        results.failures.query_cancelled,
        results.failures.deadlock,
        results.failures.other,
        quantile(&results.attempts, 50),
        quantile(&results.attempts, 95),
        quantile(&results.attempts, 99),
        quantile(&results.successes, 50),
        quantile(&results.successes, 95),
        quantile(&results.successes, 99),
        HOLD.as_millis(),
        quantile(&results.successful_holds, 50),
        quantile(&results.successful_holds, 95),
        quantile(&results.successful_holds, 99),
        results.successes.len() as f64 / wall.as_secs_f64(),
        quantile(&results.failed_attempts, 50),
        quantile(&results.failed_attempts, 95),
        quantile(&results.failed_attempts, 99),
    );
}

async fn run_case(
    repo: PgMessageRepository,
    duration: Duration,
    previous: bool,
) -> (Results, Results, Duration, [Uuid; 2]) {
    let flood_channel = super::super::sequences::channel_fixture(&repo.pool).await;
    let probe_channel = super::super::sequences::channel_fixture(&repo.pool).await;
    let flood_ids = targets(&repo, &[flood_channel], Operation::Edit, FLOOD_WRITERS).await;
    let probe_count =
        usize::try_from(duration.as_secs().checked_mul(PROBES_PER_SECOND).unwrap()).unwrap();
    let probe_ids = targets(&repo, &[probe_channel], Operation::Edit, probe_count).await;
    let ready = Arc::new(Barrier::new(FLOOD_WRITERS + 1));
    let begin = Arc::new(Barrier::new(FLOOD_WRITERS + 1));
    let start = Arc::new(OnceLock::<Instant>::new());
    let mut flood = JoinSet::new();
    for id in flood_ids {
        let repo = repo.clone();
        let ready = ready.clone();
        let begin = begin.clone();
        let start = start.clone();
        flood.spawn(async move {
            let parent = MessageParent::Channel(flood_channel);
            ready.wait().await;
            begin.wait().await;
            let deadline = *start.get().unwrap() + duration;
            let mut results = Results::default();
            let mut alternate = false;
            while Instant::now() < deadline {
                let content = if alternate { "flood-a" } else { "flood-b" };
                let started = Instant::now();
                let result = edit(&repo, &parent, id, content, previous).await;
                results.record(started.elapsed(), result);
                alternate = !alternate;
            }
            results
        });
    }
    ready.wait().await;
    let started = Instant::now();
    start.set(started).unwrap();
    begin.wait().await;
    let mut arrivals = tokio::time::interval_at(
        tokio::time::Instant::from_std(started),
        Duration::from_secs_f64(1.0 / PROBES_PER_SECOND as f64),
    );
    arrivals.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Burst);
    let mut probes = JoinSet::new();
    for id in probe_ids {
        let scheduled = arrivals.tick().await.into_std();
        let repo = repo.clone();
        probes.spawn(async move {
            let result = edit(
                &repo,
                &MessageParent::Channel(probe_channel),
                id,
                "probe",
                previous,
            )
            .await;
            (scheduled.elapsed(), result)
        });
    }
    let mut probe_results = Results::default();
    while let Some(completed) = probes.join_next().await {
        let (elapsed, result) =
            completed.expect("probe task failed independently of its repository result");
        probe_results.record(elapsed, result);
    }
    let mut flood_results = Results::default();
    while let Some(completed) = flood.join_next().await {
        flood_results
            .merge(completed.expect("flood task failed independently of its repository result"));
    }
    assert_eq!(probe_results.attempts.len(), probe_count);
    (
        flood_results,
        probe_results,
        started.elapsed(),
        [flood_channel, probe_channel],
    )
}

async fn measure(options: sqlx::postgres::PgConnectOptions) {
    let seconds = std::env::var("CHANNEL_SEQUENCE_POOL_SECONDS")
        .map(|value| {
            value
                .parse::<u64>()
                .expect("CHANNEL_SEQUENCE_POOL_SECONDS must be a positive integer")
        })
        .unwrap_or(30);
    assert!(seconds > 0, "the measured duration must be positive");
    let duration = Duration::from_secs(seconds);
    let label =
        std::env::var("CHANNEL_SEQUENCE_POOL_LABEL").unwrap_or_else(|_| "deadline50ms".into());
    assert!(
        !label.is_empty()
            && label
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'),
        "use an ASCII alphanumeric, underscore or hyphen label"
    );
    // These are DSS production settings. Leave acquire timeout at SQLx's
    // default, then report its actual value rather than shortening it for tests.
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
    let facts = PoolFacts {
        minimum: pool.options().get_min_connections(),
        maximum: pool.options().get_max_connections(),
        acquire_timeout: pool.options().get_acquire_timeout(),
        size_at_start: pool.size(),
    };
    let repo = PgMessageRepository::new(pool.clone());
    println!(
        "proof,label,runtime,profile,run,variant,lane,flood_writers,offered_ops_s,pool_min,pool_max,acquire_timeout_ms,pool_size_at_start,measured_seconds,wall_with_drain_seconds,attempts,successes,errors,pool_acquire_timeouts,sqlstate_55P03,sqlstate_57014,sqlstate_40P01,other_errors,attempt_p50_ms,attempt_p95_ms,attempt_p99_ms,success_p50_ms,success_p95_ms,success_p99_ms,requested_hold_ms,success_hold_p50_ms,success_hold_p95_ms,success_hold_p99_ms,success_ops_s,failed_p50_ms,failed_p95_ms,failed_p99_ms"
    );
    for run in 1..=3 {
        for previous in [true, false] {
            let (flood, probes, wall, channels) = run_case(repo.clone(), duration, previous).await;
            let context = CaseReport {
                label: &label,
                run,
                previous,
                facts: &facts,
                measured: duration,
                wall,
            };
            report(&context, "flood", flood);
            report(&context, "probe", probes);
            cleanup(&pool, &channels).await;
        }
    }
    pool.close().await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "100 flood writers and independent 5/s probes share the DSS production pool"]
async fn repository_shared_pool_isolation(pool: PgPool) {
    on_sixteen_worker_runtime(measure(pool.connect_options().as_ref().clone())).await;
}
