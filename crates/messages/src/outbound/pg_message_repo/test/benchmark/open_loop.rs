//! Mixed writes under fixed arrivals, plus explicit synthetic pre-commit holds.

use super::*;
use tokio::sync::Semaphore;

const CONNECTIONS: usize = 16;

#[derive(Clone, Copy)]
struct Request {
    id: Uuid,
    channel_id: Uuid,
    operation: Operation,
}

#[derive(Clone, Copy)]
struct Case {
    run: usize,
    channels: usize,
    arrivals_per_second: Option<u32>,
    previous: bool,
    commit_delay: Option<Duration>,
}

struct Sample {
    end_to_end: Duration,
    service: Duration,
    actual_hold: Duration,
}

struct MixedMeasurements {
    end_to_end: Vec<Duration>,
    service: Vec<Duration>,
    actual_hold: Vec<Duration>,
    wall: Duration,
}

impl MixedMeasurements {
    fn from_samples(samples: Vec<Sample>, wall: Duration) -> Self {
        let mut end_to_end = Vec::with_capacity(samples.len());
        let mut service = Vec::with_capacity(samples.len());
        let mut actual_hold = Vec::with_capacity(samples.len());
        for sample in samples {
            end_to_end.push(sample.end_to_end);
            service.push(sample.service);
            actual_hold.push(sample.actual_hold);
        }
        end_to_end.sort_unstable();
        service.sort_unstable();
        actual_hold.sort_unstable();
        Self {
            end_to_end,
            service,
            actual_hold,
            wall,
        }
    }
}

async fn mixed_requests(
    repo: &PgMessageRepository,
    channels: &[Uuid],
    count: usize,
) -> Vec<Request> {
    let requests: Vec<_> = (0..count)
        .map(|index| Request {
            id: macro_uuid::generate_uuid_v7(),
            // Rotate each operation through all channels independently. A
            // channel never gets permanently assigned only one operation.
            channel_id: channels
                [(index / OPERATIONS.len() + 7 * (index % OPERATIONS.len())) % channels.len()],
            operation: OPERATIONS[index % OPERATIONS.len()],
        })
        .collect();
    for channel in channels {
        let ids: Vec<_> = requests
            .iter()
            .filter(|request| {
                request.channel_id == *channel && !matches!(request.operation, Operation::Create)
            })
            .map(|request| request.id)
            .collect();
        sqlx::query!(
            r#"INSERT INTO comms_messages(id, parent_entity_type, parent_entity_id, sender_id, content)
               SELECT id, 'channel', $2, $3, 'before benchmark'
               FROM unnest($1::uuid[]) AS ids(id)"#,
            &ids,
            channel.to_string(),
            USER,
        )
        .execute(&repo.pool).await.unwrap();
    }
    requests
}

async fn perform_write(repo: &PgMessageRepository, request: Request, case: Case) -> Duration {
    let parent = MessageParent::Channel(request.channel_id);
    let Some(delay) = case.commit_delay else {
        write_one(repo, &parent, request.id, request.operation, case.previous).await;
        return Duration::ZERO;
    };
    match request.operation {
        Operation::Create => {
            let mut input = command("message-doc-a", None, "benchmark");
            input.parent = parent;
            input.input.id = Some(request.id);
            if case.previous {
                repo.create_before_commit_delay(input, delay)
                    .await
                    .unwrap()
                    .1
            } else {
                repo.create_after_commit_delay(input, delay)
                    .await
                    .unwrap()
                    .1
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
            if case.previous {
                repo.edit_before_commit_delay(&parent, request.id, input, delay)
                    .await
                    .unwrap()
                    .1
            } else {
                repo.edit_after_commit_delay(&parent, request.id, input, delay)
                    .await
                    .unwrap()
                    .1
            }
        }
        Operation::React => {
            if case.previous {
                repo.react_before_commit_delay(&parent, request.id, USER, "👍", true, delay)
                    .await
                    .unwrap()
                    .1
            } else {
                repo.react_after_commit_delay(&parent, request.id, USER, "👍", true, delay)
                    .await
                    .unwrap()
                    .1
            }
        }
        Operation::Delete => {
            if case.previous {
                repo.delete_before_commit_delay(&parent, request.id, delay)
                    .await
                    .unwrap()
                    .1
            } else {
                repo.delete_after_commit_delay(&parent, request.id, delay)
                    .await
                    .unwrap()
                    .1
            }
        }
    }
}

async fn sample_write(
    repo: &PgMessageRepository,
    request: Request,
    case: Case,
    scheduled: Instant,
) -> Sample {
    let service_started = Instant::now();
    let actual_hold = perform_write(repo, request, case).await;
    let completed = Instant::now();
    Sample {
        end_to_end: completed.duration_since(scheduled),
        service: completed.duration_since(service_started),
        actual_hold,
    }
}

async fn closed_loop(
    repo: PgMessageRepository,
    channels: &[Uuid],
    case: Case,
    count: usize,
) -> MixedMeasurements {
    let requests = mixed_requests(&repo, channels, count).await;
    let ready = Arc::new(Barrier::new(CONNECTIONS + 1));
    let start = Arc::new(Barrier::new(CONNECTIONS + 1));
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
        let start = start.clone();
        tasks.spawn(async move {
            ready.wait().await;
            start.wait().await;
            let mut samples = Vec::with_capacity(requests.len());
            for request in requests {
                samples.push(sample_write(&repo, request, case, Instant::now()).await);
            }
            samples
        });
    }
    ready.wait().await;
    let started = Instant::now();
    start.wait().await;
    let mut samples = Vec::with_capacity(count);
    while let Some(completed) = tasks.join_next().await {
        samples.extend(completed.unwrap());
    }
    assert_eq!(samples.len(), count);
    MixedMeasurements::from_samples(samples, started.elapsed())
}

async fn open_loop(repo: PgMessageRepository, channels: &[Uuid], case: Case) -> MixedMeasurements {
    let requests = mixed_requests(&repo, channels, MEASURED).await;
    let rate = case
        .arrivals_per_second
        .expect("open-loop case needs an arrival rate");
    let first_arrival = tokio::time::Instant::now();
    let mut arrivals = tokio::time::interval_at(
        first_arrival,
        Duration::from_secs_f64(1.0 / f64::from(rate)),
    );
    // A delayed scheduler must emit every original arrival, never skip or move
    // its timestamp forward. Completion and worker capacity do not gate it.
    arrivals.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Burst);
    let workers = Arc::new(Semaphore::new(CONNECTIONS));
    let mut tasks = JoinSet::new();
    for request in requests {
        let scheduled = arrivals.tick().await.into_std();
        let workers = workers.clone();
        let repo = repo.clone();
        tasks.spawn(async move {
            let _worker = workers.acquire().await.unwrap();
            sample_write(&repo, request, case, scheduled).await
        });
    }
    let mut samples = Vec::with_capacity(MEASURED);
    while let Some(completed) = tasks.join_next().await {
        samples.push(completed.unwrap());
    }
    assert_eq!(
        samples.len(),
        MEASURED,
        "every scheduled arrival must complete"
    );
    MixedMeasurements::from_samples(samples, first_arrival.elapsed())
}

fn report(case: Case, measurements: MixedMeasurements) {
    let mode = if case.arrivals_per_second.is_some() {
        "open_loop"
    } else {
        "closed_loop"
    };
    let rate = case
        .arrivals_per_second
        .map(|rate| rate.to_string())
        .unwrap_or_else(|| "-".into());
    let variant = if case.previous { "before" } else { "after" };
    let requested_hold_ms = case.commit_delay.unwrap_or_default().as_secs_f64() * 1000.0;
    let count = measurements.end_to_end.len();
    let wall_ms = measurements.wall.as_secs_f64() * 1000.0;
    let achieved = count as f64 / measurements.wall.as_secs_f64();
    println!(
        "| multi_thread_16 | {} | {mode} | {} | {CONNECTIONS} | {} | {rate} | {variant} | {count} | {:.3} | {:.3} | {:.3} | {:.3} | {:.3} | {:.3} | {requested_hold_ms:.3} | {:.3} | {:.3} | {:.3} | {wall_ms:.3} | {achieved:.1} |",
        profile(),
        case.run,
        case.channels,
        percentile_ms(&measurements.end_to_end, 50),
        percentile_ms(&measurements.end_to_end, 95),
        percentile_ms(&measurements.end_to_end, 99),
        percentile_ms(&measurements.service, 50),
        percentile_ms(&measurements.service, 95),
        percentile_ms(&measurements.service, 99),
        percentile_ms(&measurements.actual_hold, 50),
        percentile_ms(&measurements.actual_hold, 95),
        percentile_ms(&measurements.actual_hold, 99),
    );
}

fn header() {
    println!(
        "| runtime | profile | mode | run | connections | channels | offered_ops_s | variant | n | arrival_p50_ms | arrival_p95_ms | arrival_p99_ms | service_p50_ms | service_p95_ms | service_p99_ms | requested_hold_ms | actual_hold_p50_ms | actual_hold_p95_ms | actual_hold_p99_ms | total_wall_ms | achieved_ops_s |"
    );
    println!(
        "| --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
    );
}

async fn measure_open_loop(options: sqlx::postgres::PgConnectOptions) {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(CONNECTIONS as u32)
        .connect_with(options.disable_statement_logging())
        .await
        .unwrap();
    setup(&pool).await;
    warm_pool(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    header();
    for run in 1..=3 {
        for channel_count in [1, 16] {
            for rate in [50, 200, 1_000, 3_000] {
                for previous in [true, false] {
                    let mut channels = Vec::with_capacity(channel_count);
                    for _ in 0..channel_count {
                        channels.push(super::super::sequences::channel_fixture(&pool).await);
                    }
                    let case = Case {
                        run,
                        channels: channel_count,
                        arrivals_per_second: Some(rate),
                        previous,
                        commit_delay: None,
                    };
                    closed_loop(repo.clone(), &channels, case, WARMUP).await;
                    let measurements = open_loop(repo.clone(), &channels, case).await;
                    report(case, measurements);
                    cleanup(&pool, &channels).await;
                }
            }
        }
    }
    pool.close().await;
}

async fn measure_commit_delay(options: sqlx::postgres::PgConnectOptions) {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(CONNECTIONS as u32)
        .connect_with(options.disable_statement_logging())
        .await
        .unwrap();
    setup(&pool).await;
    warm_pool(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    header();
    for run in 1..=3 {
        for hold_ms in [2, 5] {
            for rate in [None, Some(20), Some(50), Some(100), Some(200)] {
                for previous in [true, false] {
                    let channel = super::super::sequences::channel_fixture(&pool).await;
                    let case = Case {
                        run,
                        channels: 1,
                        arrivals_per_second: rate,
                        previous,
                        commit_delay: Some(Duration::from_millis(hold_ms)),
                    };
                    closed_loop(repo.clone(), &[channel], case, WARMUP).await;
                    let measurements = if rate.is_some() {
                        open_loop(repo.clone(), &[channel], case).await
                    } else {
                        closed_loop(repo.clone(), &[channel], case, MEASURED).await
                    };
                    report(case, measurements);
                    cleanup(&pool, &[channel]).await;
                }
            }
        }
    }
    pool.close().await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "fixed-arrival mixed writes; run alone in release mode on a dedicated database"]
async fn repository_open_loop_write_latency(pool: PgPool) {
    on_sixteen_worker_runtime(measure_open_loop(pool.connect_options().as_ref().clone())).await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "synthetic 2/5ms pre-commit holds; run alone in release mode on a dedicated database"]
async fn repository_commit_delay_write_latency(pool: PgPool) {
    on_sixteen_worker_runtime(measure_commit_delay(
        pool.connect_options().as_ref().clone(),
    ))
    .await;
}
