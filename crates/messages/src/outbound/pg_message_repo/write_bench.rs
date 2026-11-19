//! Write latency and concurrent posting, run unchanged on the base commit and
//! on the branch. Not committed: copied next to pg_message_repo.rs for a run.
use std::time::{Duration, Instant};

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

use super::PgMessageRepository;
use crate::domain::{
    models::{MessageKind, MessageParent, PostMessage},
    ports::{CreateMessage, EditMessage, MessageRepository},
};

const USER: &str = "macro|write-bench@example.com";

async fn channel(pool: &PgPool) -> Uuid {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES ($1, 'Bench', 'private', $2)",
        id,
        USER,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

fn post(channel_id: Uuid, thread_id: Option<Uuid>, content: &str) -> CreateMessage {
    CreateMessage {
        kind: MessageKind::Message,
        guest_name: None,
        canonical_root_id: None,
        parent: MessageParent::Channel(channel_id),
        actor: USER.to_owned().try_into().unwrap(),
        triggered_via: None,
        triggered_by: None,
        input: PostMessage {
            id: None,
            attribution: Default::default(),
            notification_policy: Default::default(),
            content: content.into(),
            thread_id,
            anchor: None,
            mentions: vec![],
            attachments: vec![],
            nonce: None,
        },
    }
}

fn edit(content: &str) -> EditMessage {
    EditMessage {
        notification_policy: Default::default(),
        content: content.into(),
        mentions: vec![],
        attachments: None,
        nonce: None,
    }
}

fn stats(name: &str, mut samples: Vec<Duration>, wall: Duration) {
    samples.sort();
    let at = |q: f64| {
        let index = ((samples.len() as f64 * q) as usize).min(samples.len() - 1);
        samples[index].as_secs_f64() * 1000.0
    };
    println!(
        "BENCH {{\"case\":\"{name}\",\"n\":{},\"p50_ms\":{:.3},\"p95_ms\":{:.3},\"p99_ms\":{:.3},\"max_ms\":{:.3},\"per_sec\":{:.1}}}",
        samples.len(),
        at(0.50),
        at(0.95),
        at(0.99),
        at(1.0),
        samples.len() as f64 / wall.as_secs_f64(),
    );
}

async fn timed<T, F: Future<Output = T>>(samples: &mut Vec<Duration>, work: F) -> T {
    let started = Instant::now();
    let value = work.await;
    samples.push(started.elapsed());
    value
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "benchmark"]
async fn bench_channel_writes(pool: PgPool) {
    const SEQUENTIAL: usize = 1_500;
    const WRITERS: usize = 16;
    const EACH: usize = 150;
    let repo = PgMessageRepository::new(pool.clone());
    let channel_id = channel(&pool).await;
    let parent = MessageParent::Channel(channel_id);

    // Warm the pool and the plans.
    let mut roots = Vec::new();
    for index in 0..100 {
        roots.push(repo.create(post(channel_id, None, &format!("warm {index}"))).await.unwrap().id);
    }

    let (mut samples, started) = (Vec::new(), Instant::now());
    for index in 0..SEQUENTIAL {
        let message = timed(&mut samples, repo.create(post(channel_id, None, &format!("post {index}")))).await.unwrap();
        roots.push(message.id);
    }
    stats("post", samples, started.elapsed());

    let (mut samples, started) = (Vec::new(), Instant::now());
    let mut replies = Vec::new();
    for index in 0..SEQUENTIAL {
        let root = roots[index % 50];
        let reply = timed(&mut samples, repo.create(post(channel_id, Some(root), &format!("reply {index}")))).await.unwrap();
        replies.push(reply.id);
    }
    stats("reply", samples, started.elapsed());

    let (mut samples, started) = (Vec::new(), Instant::now());
    for index in 0..SEQUENTIAL {
        timed(&mut samples, repo.edit(&parent, roots[100 + index], edit("edited"))).await.unwrap();
    }
    stats("edit", samples, started.elapsed());

    let (mut samples, started) = (Vec::new(), Instant::now());
    for index in 0..SEQUENTIAL {
        timed(&mut samples, repo.react(&parent, roots[100 + index], USER, "👍", true)).await.unwrap();
    }
    stats("react", samples, started.elapsed());

    let (mut samples, started) = (Vec::new(), Instant::now());
    for reply in &replies {
        timed(&mut samples, repo.delete(&parent, *reply)).await.unwrap();
    }
    stats("delete", samples, started.elapsed());

    // Many people posting in one channel at once.
    let started = Instant::now();
    let tasks: Vec<_> = (0..WRITERS)
        .map(|writer| {
            let repo = repo.clone();
            tokio::spawn(async move {
                let mut samples = Vec::new();
                for index in 0..EACH {
                    timed(&mut samples, repo.create(post(channel_id, None, &format!("{writer} {index}")))).await.unwrap();
                }
                samples
            })
        })
        .collect();
    let mut samples = Vec::new();
    for task in tasks {
        samples.extend(task.await.unwrap());
    }
    stats("concurrent_post_one_channel", samples, started.elapsed());

    // Posts, replies to one busy thread and edits of its root, all at once.
    let busy_root = roots[0];
    let started = Instant::now();
    let tasks: Vec<_> = (0..WRITERS)
        .map(|writer| {
            let repo = repo.clone();
            tokio::spawn(async move {
                let parent = MessageParent::Channel(channel_id);
                let mut samples = Vec::new();
                for index in 0..EACH {
                    let body = format!("{writer} {index}");
                    match index % 3 {
                        0 => { timed(&mut samples, repo.create(post(channel_id, None, &body))).await.unwrap(); }
                        1 => { timed(&mut samples, repo.create(post(channel_id, Some(busy_root), &body))).await.unwrap(); }
                        _ => { timed(&mut samples, repo.edit(&parent, busy_root, edit(&body))).await.unwrap(); }
                    }
                }
                samples
            })
        })
        .collect();
    let mut samples = Vec::new();
    for task in tasks {
        samples.extend(task.await.unwrap());
    }
    stats("concurrent_mixed_one_thread", samples, started.elapsed());

    // The same load spread over as many channels as writers.
    let mut channels = Vec::new();
    for _ in 0..WRITERS {
        channels.push(channel(&pool).await);
    }
    let started = Instant::now();
    let tasks: Vec<_> = channels
        .into_iter()
        .map(|channel_id| {
            let repo = repo.clone();
            tokio::spawn(async move {
                let mut samples = Vec::new();
                for index in 0..EACH {
                    timed(&mut samples, repo.create(post(channel_id, None, &format!("{index}")))).await.unwrap();
                }
                samples
            })
        })
        .collect();
    let mut samples = Vec::new();
    for task in tasks {
        samples.extend(task.await.unwrap());
    }
    stats("concurrent_post_many_channels", samples, started.elapsed());
}

/// Open loop: writes to one channel are scheduled at a fixed rate whether or
/// not earlier ones finished, and latency counts from the scheduled time, so
/// a rate above the channel's ceiling shows as growing latency and a lower
/// achieved rate. `BENCH_COMMIT_DELAY_MS` adds that much time to every commit
/// (a deferred trigger that sleeps), standing in for a slower commit
/// acknowledgement than this machine's.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "benchmark"]
async fn bench_open_loop_one_channel(
    pool_options: sqlx::postgres::PgPoolOptions,
    options: sqlx::postgres::PgConnectOptions,
) {
    const SECONDS: u64 = 5;
    let delay_ms: f64 = std::env::var("BENCH_COMMIT_DELAY_MS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0.0);
    let rates: Vec<u64> = std::env::var("BENCH_RATES")
        .unwrap_or_else(|_| "50,100,200,500,1000,2000,3000".into())
        .split(',')
        .map(|rate| rate.parse().unwrap())
        .collect();
    drop(pool_options);
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(90)
        .connect_with(options)
        .await
        .unwrap();
    if delay_ms > 0.0 {
        sqlx::raw_sql(&format!(
            "CREATE FUNCTION bench_commit_delay() RETURNS trigger LANGUAGE plpgsql AS $$
             BEGIN PERFORM pg_sleep({}); RETURN NULL; END $$;
             CREATE CONSTRAINT TRIGGER bench_commit_delay AFTER INSERT ON comms_messages
             DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bench_commit_delay();",
            delay_ms / 1000.0
        ))
        .execute(&pool)
        .await
        .unwrap();
    }
    let repo = PgMessageRepository::new(pool.clone());
    for rate in rates {
        let channel_id = channel(&pool).await;
        // Open every connection and warm the plans before the clock starts.
        let warm: Vec<_> = (0..90)
            .map(|index| {
                let repo = repo.clone();
                tokio::spawn(async move {
                    repo.create(post(channel_id, None, &format!("warm {index}"))).await.unwrap();
                })
            })
            .collect();
        for task in warm {
            task.await.unwrap();
        }
        let total = rate * SECONDS;
        let started = tokio::time::Instant::now() + Duration::from_millis(50);
        let tasks: Vec<_> = (0..total)
            .map(|index| {
                let repo = repo.clone();
                let due = started + Duration::from_secs_f64(index as f64 / rate as f64);
                tokio::spawn(async move {
                    tokio::time::sleep_until(due).await;
                    let posted = repo.create(post(channel_id, None, "open loop")).await;
                    (due.elapsed(), posted.is_ok())
                })
            })
            .collect();
        let mut samples = Vec::new();
        let mut failed = 0;
        for task in tasks {
            let (elapsed, ok) = task.await.unwrap();
            if ok {
                samples.push(elapsed);
            } else {
                failed += 1;
            }
        }
        let wall = started.elapsed();
        stats(
            &format!("open_loop delay={delay_ms}ms rate={rate} failed={failed}"),
            samples,
            wall,
        );
    }
}

/// One channel flooded above its ceiling through a pool sized like the
/// service's, while a second channel writes at a normal rate.
#[ignore = "benchmark"]
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bench_flood_and_neighbour(
    pool_options: sqlx::postgres::PgPoolOptions,
    options: sqlx::postgres::PgConnectOptions,
) {
    const SECONDS: u64 = 10;
    let env = |name: &str, default: f64| -> f64 {
        std::env::var(name)
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(default)
    };
    let delay_ms = env("BENCH_COMMIT_DELAY_MS", 2.0);
    let flood_rate = env("BENCH_FLOOD_RATE", 1000.0) as u64;
    let neighbour_rate = env("BENCH_NEIGHBOUR_RATE", 20.0) as u64;
    drop(pool_options);
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(50)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::raw_sql(&format!(
        "CREATE FUNCTION bench_commit_delay() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN PERFORM pg_sleep({}); RETURN NULL; END $$;
         CREATE CONSTRAINT TRIGGER bench_commit_delay AFTER INSERT ON comms_messages
         DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bench_commit_delay();",
        delay_ms / 1000.0
    ))
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgMessageRepository::new(pool.clone());
    let flooded = channel(&pool).await;
    let neighbour = channel(&pool).await;
    for index in 0..50 {
        let target = if index % 2 == 0 { flooded } else { neighbour };
        repo.create(post(target, None, "warm")).await.unwrap();
    }
    let started = tokio::time::Instant::now() + Duration::from_millis(50);
    let spawn = |target: Uuid, rate: u64| -> Vec<_> {
        (0..rate * SECONDS)
            .map(|index| {
                let repo = repo.clone();
                let due = started + Duration::from_secs_f64(index as f64 / rate as f64);
                tokio::spawn(async move {
                    tokio::time::sleep_until(due).await;
                    let posted = repo.create(post(target, None, "flood")).await;
                    (due.elapsed(), posted.is_ok())
                })
            })
            .collect()
    };
    let flood = spawn(flooded, flood_rate);
    let normal = spawn(neighbour, neighbour_rate);
    let timeout = std::env::var("BENCH_LOCK_TIMEOUT").unwrap_or_else(|_| "default".into());
    for (name, tasks) in [("neighbour", normal), ("flooded", flood)] {
        let (mut ok, mut failed_after) = (Vec::new(), Vec::new());
        for task in tasks {
            let (elapsed, posted) = task.await.unwrap();
            if posted { ok.push(elapsed) } else { failed_after.push(elapsed) }
        }
        let wall = started.elapsed();
        let failed = failed_after.len();
        if !failed_after.is_empty() {
            stats(&format!("flood {name} FAILED-AFTER timeout={timeout} delay={delay_ms}ms flood={flood_rate}/s"), failed_after, wall);
        }
        if ok.is_empty() { ok.push(Duration::ZERO) }
        stats(&format!("flood {name} timeout={timeout} delay={delay_ms}ms flood={flood_rate}/s failed={failed}"), ok, wall);
    }
}

/// Twenty people post in one channel at the same instant; every post must
/// succeed. Repeated for a stable latency figure.
#[ignore = "benchmark"]
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bench_honest_burst(
    pool_options: sqlx::postgres::PgPoolOptions,
    options: sqlx::postgres::PgConnectOptions,
) {
    const PEOPLE: usize = 20;
    const ROUNDS: usize = 30;
    drop(pool_options);
    let delay_ms: f64 = std::env::var("BENCH_COMMIT_DELAY_MS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(2.0);
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(50)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::raw_sql(&format!(
        "CREATE FUNCTION bench_commit_delay() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN PERFORM pg_sleep({}); RETURN NULL; END $$;
         CREATE CONSTRAINT TRIGGER bench_commit_delay AFTER INSERT ON comms_messages
         DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bench_commit_delay();",
        delay_ms / 1000.0
    ))
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgMessageRepository::new(pool.clone());
    let channel_id = channel(&pool).await;
    let warm: Vec<_> = (0..50)
        .map(|_| {
            let repo = repo.clone();
            tokio::spawn(async move { repo.create(post(channel_id, None, "warm")).await.unwrap() })
        })
        .collect();
    for task in warm {
        task.await.unwrap();
    }
    let started = Instant::now();
    let (mut samples, mut slowest, mut failed) = (Vec::new(), Vec::new(), 0);
    for _ in 0..ROUNDS {
        let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(PEOPLE));
        let tasks: Vec<_> = (0..PEOPLE)
            .map(|_| {
                let (repo, barrier) = (repo.clone(), barrier.clone());
                tokio::spawn(async move {
                    barrier.wait().await;
                    let begun = Instant::now();
                    let posted = repo.create(post(channel_id, None, "burst")).await;
                    (begun.elapsed(), posted.is_ok())
                })
            })
            .collect();
        let mut worst = Duration::ZERO;
        for task in tasks {
            let (elapsed, ok) = task.await.unwrap();
            if ok {
                samples.push(elapsed);
                worst = worst.max(elapsed);
            } else {
                failed += 1;
            }
        }
        slowest.push(worst);
    }
    let wall = started.elapsed();
    stats(&format!("burst20 each-post delay={delay_ms}ms failed={failed}"), samples, wall);
    stats(&format!("burst20 last-post-of-burst delay={delay_ms}ms"), slowest, wall);
}
