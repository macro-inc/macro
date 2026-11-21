//! Current-repository latency below the synthetic commit-delay ceiling.

use super::open_loop::{CONNECTIONS, Request, mixed_requests};
use super::*;
use tokio::sync::Semaphore;

#[derive(Clone, Copy)]
struct Case {
    run: usize,
    rate: Option<u32>,
    hold: Option<Duration>,
}

#[derive(Default)]
struct Results {
    arrival: Vec<Duration>,
    successful_arrival: Vec<Duration>,
    failed_arrival: Vec<Duration>,
    service: Vec<Duration>,
    actual_hold: Vec<Duration>,
    failures: FailureCounts,
    wall: Duration,
}

struct Sample {
    arrival: Duration,
    service: Duration,
    result: Result<Duration, MessageError>,
}

impl Results {
    fn record(&mut self, sample: Sample) {
        self.arrival.push(sample.arrival);
        self.service.push(sample.service);
        match sample.result {
            Ok(hold) => {
                self.successful_arrival.push(sample.arrival);
                self.actual_hold.push(hold);
            }
            Err(error) => {
                self.failed_arrival.push(sample.arrival);
                self.failures.record(&error);
            }
        }
    }

    fn sort(&mut self) {
        self.arrival.sort_unstable();
        self.successful_arrival.sort_unstable();
        self.failed_arrival.sort_unstable();
        self.service.sort_unstable();
        self.actual_hold.sort_unstable();
    }
}

async fn write(
    repo: &PgMessageRepository,
    request: Request,
    hold: Option<Duration>,
) -> Result<Duration, MessageError> {
    let parent = MessageParent::Channel(request.channel_id);
    match request.operation {
        Operation::Create => {
            let mut input = command("message-doc-a", None, "benchmark");
            input.parent = parent;
            input.input.id = Some(request.id);
            match hold {
                Some(hold) => repo
                    .create_after_commit_delay(input, hold)
                    .await
                    .map(|(_, actual)| actual),
                None => repo.create(input).await.map(|_| Duration::ZERO),
            }
        }
        Operation::Edit => {
            let input = EditMessage {
                notification_policy: Default::default(),
                content: "after benchmark".into(),
                mentions: vec![],
                attachments: None,
                nonce: None,
            };
            match hold {
                Some(hold) => repo
                    .edit_after_commit_delay(&parent, request.id, input, hold)
                    .await
                    .map(|(_, actual)| actual),
                None => repo
                    .edit(&parent, request.id, input)
                    .await
                    .map(|_| Duration::ZERO),
            }
        }
        Operation::React => match hold {
            Some(hold) => repo
                .react_after_commit_delay(&parent, request.id, USER, "👍", true, hold)
                .await
                .map(|(_, actual)| actual),
            None => repo
                .react(&parent, request.id, USER, "👍", true)
                .await
                .map(|_| Duration::ZERO),
        },
        Operation::Delete => match hold {
            Some(hold) => repo
                .delete_after_commit_delay(&parent, request.id, hold)
                .await
                .map(|(_, actual)| actual),
            None => repo
                .delete(&parent, request.id)
                .await
                .map(|_| Duration::ZERO),
        },
    }
}

async fn sample(
    repo: &PgMessageRepository,
    request: Request,
    case: Case,
    scheduled: Instant,
) -> Sample {
    let started = Instant::now();
    let result = write(repo, request, case.hold).await;
    let completed = Instant::now();
    Sample {
        arrival: completed.duration_since(scheduled),
        service: completed.duration_since(started),
        result,
    }
}

async fn warmup(repo: &PgMessageRepository, channel: Uuid, case: Case) -> Results {
    // Warm every connection before this function. Sequential writes prime each
    // operation without introducing a saturated 16-writer synthetic-hold case.
    let requests = mixed_requests(repo, &[channel], WARMUP).await;
    let started = Instant::now();
    let mut results = Results::default();
    for request in requests {
        results.record(sample(repo, request, case, Instant::now()).await);
    }
    results.wall = started.elapsed();
    results
}

async fn closed_loop(repo: PgMessageRepository, channel: Uuid, case: Case) -> Results {
    let requests = mixed_requests(&repo, &[channel], MEASURED).await;
    let ready = Arc::new(Barrier::new(CONNECTIONS + 1));
    let begin = Arc::new(Barrier::new(CONNECTIONS + 1));
    let mut tasks = JoinSet::new();
    for writer in 0..CONNECTIONS {
        let requests: Vec<_> = requests
            .iter()
            .copied()
            .enumerate()
            .filter_map(|(index, request)| (index % CONNECTIONS == writer).then_some(request))
            .collect();
        let repo = repo.clone();
        let ready = ready.clone();
        let begin = begin.clone();
        tasks.spawn(async move {
            ready.wait().await;
            begin.wait().await;
            let mut samples = Vec::with_capacity(requests.len());
            for request in requests {
                samples.push(sample(&repo, request, case, Instant::now()).await);
            }
            samples
        });
    }
    ready.wait().await;
    let started = Instant::now();
    begin.wait().await;
    let mut results = Results::default();
    while let Some(completed) = tasks.join_next().await {
        for sample in completed.expect("writer task failed outside its repository result") {
            results.record(sample);
        }
    }
    results.wall = started.elapsed();
    assert_eq!(results.arrival.len(), MEASURED);
    results
}

async fn open_loop(repo: PgMessageRepository, channel: Uuid, case: Case) -> Results {
    let requests = mixed_requests(&repo, &[channel], MEASURED).await;
    let rate = case.rate.expect("open-loop case needs an arrival rate");
    let first = tokio::time::Instant::now();
    let mut arrivals =
        tokio::time::interval_at(first, Duration::from_secs_f64(1.0 / f64::from(rate)));
    arrivals.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Burst);
    let workers = Arc::new(Semaphore::new(CONNECTIONS));
    let mut tasks = JoinSet::new();
    for request in requests {
        let scheduled = arrivals.tick().await.into_std();
        let workers = workers.clone();
        let repo = repo.clone();
        tasks.spawn(async move {
            let _worker = workers
                .acquire()
                .await
                .expect("worker semaphore stays open");
            sample(&repo, request, case, scheduled).await
        });
    }
    let mut results = Results::default();
    while let Some(completed) = tasks.join_next().await {
        results.record(completed.expect("writer task failed outside its repository result"));
    }
    results.wall = first.elapsed();
    assert_eq!(results.arrival.len(), MEASURED);
    results
}

fn quantile(samples: &[Duration], percentile: usize) -> String {
    if samples.is_empty() {
        "NA".into()
    } else {
        format!("{:.3}", percentile_ms(samples, percentile))
    }
}

fn report(label: &str, phase: &str, case: Case, mut results: Results) {
    results.sort();
    let mode = if phase == "warmup" {
        "sequential"
    } else if case.rate.is_some() {
        "open_loop"
    } else {
        "closed_loop"
    };
    let rate = case
        .rate
        .map(|rate| rate.to_string())
        .unwrap_or_else(|| "-".into());
    let writers = if phase == "warmup" { 1 } else { CONNECTIONS };
    println!(
        "bounded_latency,{label},multi_thread_16,{},{},{phase},{mode},after,{writers},1,{rate},{:.3},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{:.3},{:.1},{:.1}",
        profile(),
        case.run,
        case.hold.unwrap_or_default().as_secs_f64() * 1000.0,
        results.arrival.len(),
        results.successful_arrival.len(),
        results.failures.total(),
        results.failures.acquire_timeout,
        results.failures.lock_unavailable,
        results.failures.query_cancelled,
        results.failures.deadlock,
        results.failures.other,
        quantile(&results.arrival, 50),
        quantile(&results.arrival, 95),
        quantile(&results.arrival, 99),
        quantile(&results.successful_arrival, 50),
        quantile(&results.successful_arrival, 95),
        quantile(&results.successful_arrival, 99),
        quantile(&results.failed_arrival, 50),
        quantile(&results.failed_arrival, 95),
        quantile(&results.failed_arrival, 99),
        quantile(&results.service, 50),
        quantile(&results.service, 95),
        quantile(&results.service, 99),
        quantile(&results.actual_hold, 50),
        quantile(&results.actual_hold, 95),
        quantile(&results.actual_hold, 99),
        results.wall.as_secs_f64() * 1000.0,
        results.arrival.len() as f64 / results.wall.as_secs_f64(),
        results.successful_arrival.len() as f64 / results.wall.as_secs_f64(),
    );
}

async fn measure(options: sqlx::postgres::PgConnectOptions) {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(CONNECTIONS as u32)
        .connect_with(options.disable_statement_logging())
        .await
        .unwrap();
    setup(&pool).await;
    warm_pool(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let label =
        std::env::var("CHANNEL_SEQUENCE_BOUNDED_LABEL").unwrap_or_else(|_| "deadline50ms".into());
    assert!(
        !label.is_empty()
            && label
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'),
        "use an ASCII alphanumeric, underscore or hyphen label"
    );
    println!(
        "proof,label,runtime,profile,run,phase,mode,variant,writers,channels,offered_ops_s,requested_hold_ms,attempts,successes,errors,pool_acquire_timeouts,sqlstate_55P03,sqlstate_57014,sqlstate_40P01,other_errors,arrival_p50_ms,arrival_p95_ms,arrival_p99_ms,success_arrival_p50_ms,success_arrival_p95_ms,success_arrival_p99_ms,failed_arrival_p50_ms,failed_arrival_p95_ms,failed_arrival_p99_ms,service_p50_ms,service_p95_ms,service_p99_ms,actual_hold_p50_ms,actual_hold_p95_ms,actual_hold_p99_ms,total_wall_ms,attempt_ops_s,success_ops_s"
    );
    let mut errors = 0;
    for run in 1..=3 {
        for (rate, hold_ms) in [
            (None, None),
            (Some(1_000), None),
            (Some(3_000), None),
            (Some(20), Some(5)),
            (Some(50), Some(5)),
            (Some(100), Some(5)),
            (Some(200), Some(2)),
        ] {
            let channel = super::super::sequences::channel_fixture(&pool).await;
            let case = Case {
                run,
                rate,
                hold: hold_ms.map(Duration::from_millis),
            };
            let priming = warmup(&repo, channel, case).await;
            errors += priming.failures.total();
            report(&label, "warmup", case, priming);
            let results = if rate.is_some() {
                open_loop(repo.clone(), channel, case).await
            } else {
                closed_loop(repo.clone(), channel, case).await
            };
            errors += results.failures.total();
            report(&label, "measured", case, results);
            cleanup(&pool, &[channel]).await;
        }
    }
    pool.close().await;
    // Print every case and drain every request before failing this proof.
    assert_eq!(
        errors, 0,
        "below-ceiling requests must not fail; see complete CSV above"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "below-ceiling current writes; run alone in release mode on a dedicated database"]
async fn repository_bounded_write_latency(pool: PgPool) {
    on_sixteen_worker_runtime(measure(pool.connect_options().as_ref().clone())).await;
}
