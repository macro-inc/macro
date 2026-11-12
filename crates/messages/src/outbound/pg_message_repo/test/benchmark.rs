//! Run against a dedicated local MacroDB, with SQLX_OFFLINE unset:
//! cargo test -p messages --all-features repository_write_latency -- --ignored --nocapture
//! Repeat with --release after compilation and all other checks are idle.
//! Default tests run on an explicit sixteen-worker Tokio runtime. The
//! repository_current_thread_* tests preserve the SQLx test runtime for comparison.
//! The baseline retains the previous repository SQL, hydration and transaction
//! boundaries. Main measurements disable query logging; the separate ignored
//! commit-phase diagnostic explicitly enables it and is not a baseline result.

mod delayed;
mod open_loop;

use super::*;
use sqlx::ConnectOptions;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{sync::Barrier, task::JoinSet};

const MEASURED: usize = 2_000;
const WARMUP: usize = 128;
const OPERATIONS: [Operation; 4] = [
    Operation::Create,
    Operation::Edit,
    Operation::React,
    Operation::Delete,
];

#[derive(Clone, Copy, Debug)]
enum Operation {
    Create,
    Edit,
    React,
    Delete,
}

struct Measurements {
    latencies: Vec<Duration>,
    wall: Duration,
}

fn profile() -> &'static str {
    if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    }
}

fn percentile_ms(sorted: &[Duration], percentile: usize) -> f64 {
    sorted[(sorted.len() * percentile / 100).saturating_sub(1)].as_secs_f64() * 1000.0
}

async fn targets(
    repo: &PgMessageRepository,
    channels: &[Uuid],
    operation: Operation,
    count: usize,
) -> Vec<Uuid> {
    let ids: Vec<_> = (0..count).map(|_| macro_uuid::generate_uuid_v7()).collect();
    if !matches!(operation, Operation::Create) {
        // Only fixture creation bypasses the measured repository path. The
        // message trigger creates thread rows identically for both variants.
        for (index, channel) in channels.iter().enumerate() {
            let targets: Vec<_> = ids
                .iter()
                .copied()
                .enumerate()
                .filter_map(|(offset, id)| (offset % channels.len() == index).then_some(id))
                .collect();
            sqlx::query!(
                r#"INSERT INTO comms_messages(id, parent_entity_type, parent_entity_id, sender_id, content)
                   SELECT id, 'channel', $2, $3, 'before benchmark'
                   FROM unnest($1::uuid[]) AS ids(id)"#,
                &targets,
                channel.to_string(),
                USER,
            )
            .execute(&repo.pool).await.unwrap();
        }
    }
    ids
}

async fn write_one(
    repo: &PgMessageRepository,
    parent: &MessageParent,
    id: Uuid,
    operation: Operation,
    previous: bool,
) {
    match operation {
        Operation::Create => {
            let mut input = command("message-doc-a", None, "benchmark");
            input.parent = parent.clone();
            input.input.id = Some(id);
            if previous {
                repo.create_before_sequences(input).await.unwrap();
            } else {
                repo.create(input).await.unwrap();
            }
        }
        Operation::Edit => {
            let edit = EditMessage {
                notification_policy: Default::default(),
                content: "after benchmark".into(),
                mentions: vec![],
                attachments: None,
                nonce: None,
            };
            if previous {
                repo.edit_before_sequences(parent, id, edit).await.unwrap();
            } else {
                repo.edit(parent, id, edit).await.unwrap();
            }
        }
        Operation::React => {
            if previous {
                repo.react_before_sequences(parent, id, USER, "👍", true)
                    .await
                    .unwrap();
            } else {
                repo.react(parent, id, USER, "👍", true).await.unwrap();
            }
        }
        Operation::Delete => {
            if previous {
                repo.delete_before_sequences(parent, id).await.unwrap();
            } else {
                repo.delete(parent, id).await.unwrap();
            }
        }
    }
}

async fn run_writes(
    repo: PgMessageRepository,
    channels: &[Uuid],
    operation: Operation,
    previous: bool,
    writers: usize,
    count: usize,
) -> Measurements {
    let ids = targets(&repo, channels, operation, count).await;
    let ready = Arc::new(Barrier::new(writers + 1));
    let start = Arc::new(Barrier::new(writers + 1));
    let mut tasks = JoinSet::new();
    for writer in 0..writers {
        let repo = repo.clone();
        let channel = channels[writer % channels.len()];
        let targets: Vec<_> = ids
            .iter()
            .copied()
            .enumerate()
            .filter_map(|(index, id)| (index % writers == writer).then_some(id))
            .collect();
        let ready = ready.clone();
        let start = start.clone();
        tasks.spawn(async move {
            let parent = MessageParent::Channel(channel);
            let mut timings = Vec::with_capacity(targets.len());
            ready.wait().await;
            start.wait().await;
            for id in targets {
                let started = Instant::now();
                write_one(&repo, &parent, id, operation, previous).await;
                timings.push(started.elapsed());
            }
            timings
        });
    }
    ready.wait().await;
    let started = Instant::now();
    start.wait().await;
    let mut latencies = Vec::with_capacity(count);
    while let Some(completed) = tasks.join_next().await {
        latencies.extend(completed.unwrap());
    }
    let wall = started.elapsed();
    assert_eq!(latencies.len(), count);
    latencies.sort_unstable();
    Measurements { latencies, wall }
}

async fn warm_pool(pool: &PgPool) {
    // Hold all acquisitions together to establish 16 connections before timing.
    let connections = futures::future::try_join_all((0..16).map(|_| pool.acquire()))
        .await
        .unwrap();
    drop(connections);
}

async fn cleanup(pool: &PgPool, channels: &[Uuid]) {
    // Each variant starts at the same table size with fresh channel counters.
    sqlx::query!("DELETE FROM comms_channels WHERE id = ANY($1)", channels)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query!(
        "DELETE FROM channel_change_log WHERE channel_id = ANY($1)",
        channels
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "DELETE FROM channel_change_counters WHERE channel_id = ANY($1)",
        channels
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn measure_write_latency(options: sqlx::postgres::PgConnectOptions, runtime: &'static str) {
    let benchmark_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(32)
        .connect_with(options.disable_statement_logging())
        .await
        .unwrap();
    setup(&benchmark_pool).await;
    warm_pool(&benchmark_pool).await;
    let repo = PgMessageRepository::new(benchmark_pool.clone());
    println!(
        "| runtime | profile | run | writers | channels | operation | variant | n | median_ms | p95_ms | p99_ms | total_wall_ms | throughput_ops_s |"
    );
    println!(
        "| --- | --- | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |"
    );
    for run in 1..=3 {
        for (writers, channel_count) in [(1, 1), (4, 1), (16, 1), (16, 16)] {
            for operation in OPERATIONS {
                for previous in [true, false] {
                    let mut channels = Vec::with_capacity(channel_count);
                    for _ in 0..channel_count {
                        channels.push(super::sequences::channel_fixture(&benchmark_pool).await);
                    }
                    run_writes(
                        repo.clone(),
                        &channels,
                        operation,
                        previous,
                        writers,
                        WARMUP,
                    )
                    .await;
                    let measurements = run_writes(
                        repo.clone(),
                        &channels,
                        operation,
                        previous,
                        writers,
                        MEASURED,
                    )
                    .await;
                    let median = percentile_ms(&measurements.latencies, 50);
                    let p95 = percentile_ms(&measurements.latencies, 95);
                    let p99 = percentile_ms(&measurements.latencies, 99);
                    let wall_ms = measurements.wall.as_secs_f64() * 1000.0;
                    let throughput = MEASURED as f64 / measurements.wall.as_secs_f64();
                    let variant = if previous { "before" } else { "after" };
                    println!(
                        "| {runtime} | {} | {run} | {writers} | {channel_count} | {operation:?} | {variant} | {MEASURED} | {median:.3} | {p95:.3} | {p99:.3} | {wall_ms:.3} | {throughput:.1} |",
                        profile()
                    );
                    cleanup(&benchmark_pool, &channels).await;
                }
            }
        }
    }
    benchmark_pool.close().await;
}

async fn measure_commit_phase_latency(
    options: sqlx::postgres::PgConnectOptions,
    runtime: &'static str,
) {
    let diagnostic_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(32)
        .connect_with(options.log_statements("trace".parse().unwrap()))
        .await
        .unwrap();
    setup(&diagnostic_pool).await;
    warm_pool(&diagnostic_pool).await;
    let repo = PgMessageRepository::new(diagnostic_pool.clone());
    println!(
        "| runtime | profile | writers | operation | n | commit_median_ms | commit_p95_ms | commit_p99_ms | post_append_observed_median_ms | post_append_observed_p95_ms | post_append_observed_p99_ms | append_to_commit_upper_median_ms | append_to_commit_upper_p95_ms | append_to_commit_upper_p99_ms |"
    );
    println!(
        "| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
    );
    for writers in [1, 16] {
        for operation in OPERATIONS {
            let channel = super::sequences::channel_fixture(&diagnostic_pool).await;
            run_writes(repo.clone(), &[channel], operation, false, writers, WARMUP).await;
            let ids = targets(&repo, &[channel], operation, MEASURED).await;
            let ready = Arc::new(Barrier::new(writers + 1));
            let start = Arc::new(Barrier::new(writers + 1));
            let mut tasks = JoinSet::new();
            for writer in 0..writers {
                let repo = repo.clone();
                let targets: Vec<_> = ids
                    .iter()
                    .copied()
                    .enumerate()
                    .filter_map(|(index, id)| (index % writers == writer).then_some(id))
                    .collect();
                let ready = ready.clone();
                let start = start.clone();
                tasks.spawn(async move {
                    let parent = MessageParent::Channel(channel);
                    ready.wait().await;
                    start.wait().await;
                    let mut samples = Vec::with_capacity(targets.len());
                    for id in targets {
                        let (_, queries) = super::sql_trace::capture_queries(write_one(
                            &repo, &parent, id, operation, false,
                        ))
                        .await;
                        let append = queries
                            .iter()
                            .find(|query| query.sql.contains("INSERT INTO channel_change_log"))
                            .expect("diagnostic must capture the final counter/log append");
                        let commit = queries
                            .iter()
                            .find(|query| query.sql.trim() == "COMMIT")
                            .expect("diagnostic must capture COMMIT");
                        let commit_roundtrip = Duration::from_secs_f64(commit.elapsed_seconds);
                        // Query timing starts before counter acquisition. Ending
                        // at COMMIT acknowledgement also includes network and
                        // client processing, so this bounds lock hold from above;
                        // it is explicitly not the server's exact lock duration.
                        let append_started =
                            append.finished_at - Duration::from_secs_f64(append.elapsed_seconds);
                        let append_to_commit = commit.finished_at.duration_since(append_started);
                        // Observe only the interval after the append's client
                        // completion event. This excludes server append time
                        // and includes client work plus the commit acknowledgement;
                        // it is not the exact server counter-lock hold time.
                        let post_append = commit.finished_at.duration_since(append.finished_at);
                        samples.push((commit_roundtrip, post_append, append_to_commit));
                    }
                    samples
                });
            }
            ready.wait().await;
            start.wait().await;
            let mut commits = Vec::with_capacity(MEASURED);
            let mut post_append = Vec::with_capacity(MEASURED);
            let mut windows = Vec::with_capacity(MEASURED);
            while let Some(completed) = tasks.join_next().await {
                for (commit, observed, window) in completed.unwrap() {
                    commits.push(commit);
                    post_append.push(observed);
                    windows.push(window);
                }
            }
            assert_eq!(commits.len(), MEASURED);
            commits.sort_unstable();
            post_append.sort_unstable();
            windows.sort_unstable();
            println!(
                "| {runtime} | {} | {writers} | {operation:?} | {MEASURED} | {:.3} | {:.3} | {:.3} | {:.3} | {:.3} | {:.3} | {:.3} | {:.3} | {:.3} |",
                profile(),
                percentile_ms(&commits, 50),
                percentile_ms(&commits, 95),
                percentile_ms(&commits, 99),
                percentile_ms(&post_append, 50),
                percentile_ms(&post_append, 95),
                percentile_ms(&post_append, 99),
                percentile_ms(&windows, 50),
                percentile_ms(&windows, 95),
                percentile_ms(&windows, 99)
            );
            cleanup(&diagnostic_pool, &[channel]).await;
        }
    }
    diagnostic_pool.close().await;
}

async fn on_sixteen_worker_runtime(task: impl std::future::Future<Output = ()> + Send + 'static) {
    // SQLx's test runtime uses one current thread. Keep it alive to own the
    // scratch database, but build all benchmark pools on the measured runtime.
    tokio::task::spawn_blocking(move || {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(16)
            .enable_all()
            .build()
            .unwrap()
            .block_on(task);
    })
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "3 runs of 2000 writes per case on 16 Tokio workers; run with an idle database"]
async fn repository_write_latency(pool: PgPool) {
    let options = pool.connect_options().as_ref().clone();
    on_sixteen_worker_runtime(measure_write_latency(options, "multi_thread_16")).await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "SQL tracing diagnostic on 16 Tokio workers; run separately from write latency"]
async fn repository_commit_phase_latency(pool: PgPool) {
    let options = pool.connect_options().as_ref().clone();
    on_sixteen_worker_runtime(measure_commit_phase_latency(options, "multi_thread_16")).await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "3 runs of 2000 writes per case on the SQLx current-thread test runtime"]
async fn repository_current_thread_write_latency(pool: PgPool) {
    let options = pool.connect_options().as_ref().clone();
    measure_write_latency(options, "current_thread").await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "SQL tracing diagnostic on the SQLx current-thread test runtime"]
async fn repository_current_thread_commit_phase_latency(pool: PgPool) {
    let options = pool.connect_options().as_ref().clone();
    measure_commit_phase_latency(options, "current_thread").await;
}
