//! Background sync against a person's writes, on a runtime the size of a
//! Mac's. Runs over a database `native_cache_bench` seeded:
//!
//! ```sh
//! CACHE_BENCH_DATA=<dataset dir> nix develop .#tauri-linux --command cargo test --release \
//!   --manifest-path apps/web/tauri/Cargo.toml -p graphql_cache_plugin --lib -- --ignored \
//!   --nocapture --exact engine::test::contention::native_contention_bench
//! ```
//!
//! Run it alone: it installs its own runtime as Tauri's, which can be set
//! only once per process.
//!
//! Two phases of `CACHE_BENCH_PHASE_SECS` (20) each: `quiet`, where only the
//! person acts (a rename's enqueue and commit, list and search reads), then
//! `loaded`, where background lanes run too, back to back as the app's sync
//! loops do: contact pages hydrated and verified, Soup pages warmed, and
//! Soup pages written as refetched responses. Every command runs on a task of
//! its own, as Tauri runs one, on a runtime of `CACHE_BENCH_WORKERS` (8)
//! workers. For each command it records the time from spawn to answer, its
//! longest single poll, and the wait and hold of each engine guard it took
//! (`access::probe`); a hydrate superseded while it still waited took none,
//! so hydrate waits count only those that got the engine, and `superseded`
//! counts the rest. Two probes measure the runtime itself: how late a 1 ms
//! sleep wakes, and how long a spawned task waits for its first poll.
use super::bench::{Op, mail_args, open, ops, search, stamped};
use super::*;
use crate::engine::access::probe;
use std::collections::BTreeMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

/// A future's longest single poll: work that holds its worker thread.
struct Measured<F> {
    inner: Pin<Box<F>>,
    longest: Duration,
}

impl<F: Future> Future for Measured<F> {
    type Output = (F::Output, Duration);

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let started = Instant::now();
        let poll = self.inner.as_mut().poll(cx);
        let elapsed = started.elapsed();
        self.longest = self.longest.max(elapsed);
        poll.map(|value| (value, self.longest))
    }
}

/// Each run of a command: (ms from spawn to answer, longest poll ms).
type Runs = BTreeMap<&'static str, Vec<(f64, f64)>>;

/// Every command's runs, and how many of each a write superseded.
#[derive(Clone, Default)]
struct Commands(Arc<Mutex<Runs>>, Arc<Mutex<BTreeMap<&'static str, usize>>>);

impl Commands {
    /// Runs one command the way Tauri does, on a task of its own.
    async fn run<T: Send + 'static>(
        &self,
        label: &'static str,
        command: impl Future<Output = T> + Send + 'static,
    ) -> T {
        let issued = Instant::now();
        let measured = Measured {
            inner: Box::pin(command),
            longest: Duration::ZERO,
        };
        let (value, longest) = tauri::async_runtime::spawn(probe::COMMAND.scope(label, measured))
            .await
            .unwrap();
        self.0.lock().unwrap().entry(label).or_default().push((
            issued.elapsed().as_secs_f64() * 1000.0,
            longest.as_secs_f64() * 1000.0,
        ));
        value
    }

    /// Counts a warming hydrate a write overtook, or a contact window whose
    /// fence another write changed; the app fetches either again.
    fn superseded<T>(&self, label: &'static str, result: Result<T, String>) {
        if result.is_err() {
            *self.1.lock().unwrap().entry(label).or_default() += 1;
        }
    }
}

fn ms_env(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

/// A new value for every name, so a replayed page changes rows, the search
/// index and projections each time, as a sync that brings changes does.
fn vary(value: &mut serde_json::Value, round: usize) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, value) in map.iter_mut() {
                match value {
                    serde_json::Value::String(text)
                        if matches!(key.as_str(), "name" | "displayName") =>
                    {
                        let base = text.split(" ~").next().unwrap_or_default().to_owned();
                        *text = format!("{base} ~{round}");
                    }
                    _ => vary(value, round),
                }
            }
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(|item| vary(item, round)),
        _ => {}
    }
}

fn stop_after(stop: &Arc<AtomicBool>) -> bool {
    stop.load(Ordering::SeqCst)
}

/// A random exponential gap with this mean, from a small xorshift.
fn gap(state: &mut u64, mean_ms: u64) -> Duration {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    let uniform = (*state >> 11) as f64 / (1u64 << 53) as f64;
    Duration::from_secs_f64(-(1.0 - uniform).ln() * mean_ms as f64 / 1000.0)
}

#[derive(Clone)]
struct Lane {
    handle: EngineHandle,
    docs: Arc<BTreeMap<String, String>>,
    identity: String,
    commands: Commands,
    stop: Arc<AtomicBool>,
}

impl Lane {
    async fn stamped(&self, label: &'static str) -> EngineHandle {
        let (handle, identity) = (self.handle.clone(), self.identity.clone());
        self.commands
            .run(label, async move { stamped(&handle, &identity).await })
            .await
    }

    async fn scope(&self, handle: &EngineHandle, label: &'static str) -> HydrationScope {
        let reader = handle.clone();
        let generation = self
            .commands
            .run(label, async move {
                reader.current_storage_generation().await.unwrap()
            })
            .await;
        HydrationScope {
            contact_fence: None,
            storage_generation: generation.parse().unwrap(),
            identity: self.identity.clone(),
        }
    }

    async fn fence(
        &self,
        handle: &EngineHandle,
        scope: &HydrationScope,
        scan: Option<serde_json::Value>,
    ) -> cache_core::people::sync::ContactSnapshot {
        let request = serde_json::from_value(serde_json::json!({
            "scope": scope,
            "scan": scan,
        }))
        .unwrap();
        let reader = handle.clone();
        self.commands
            .run("background.contacts.snapshot", async move {
                reader.contact_snapshot(request).await.unwrap()
            })
            .await
    }

    /// Hydrates every contact page, then verifies the cached IDs in 500-record
    /// windows, as the contact backfill does.
    async fn contacts(self, pages: Vec<Op>) {
        for round in 1.. {
            for page in &pages {
                if stop_after(&self.stop) {
                    return;
                }
                let handle = self.stamped("background.authority").await;
                let mut scope = self.scope(&handle, "background.contacts.generation").await;
                scope.contact_fence = Some(self.fence(&handle, &scope, None).await.fence);
                let mut data = page.data.clone();
                vary(&mut data, round);
                let (query, op) = (self.docs[&page.doc].clone(), page.clone());
                let identity = self.identity.clone();
                let label = "background.contacts.hydrate_page";
                let hydrated = self
                    .commands
                    .run(label, async move {
                        handle
                            .hydrate_query(
                                query,
                                Some(op.operation_name),
                                op.variables,
                                data,
                                Some(identity),
                                Some(scope),
                            )
                            .await
                            .map(drop)
                    })
                    .await;
                self.commands.superseded(label, hydrated);
            }
            let handle = self.stamped("background.authority").await;
            let scope = self.scope(&handle, "background.contacts.generation").await;
            let mut after: Option<String> = None;
            loop {
                if stop_after(&self.stop) {
                    return;
                }
                let window = self
                    .fence(
                        &handle,
                        &scope,
                        Some(serde_json::json!({ "after": after, "limit": 500 })),
                    )
                    .await;
                let request = serde_json::from_value(serde_json::json!({
                    "scope": scope,
                    "fence": window.fence,
                    "viewer": self.identity,
                    "requested": window.ids,
                    "present": window.ids,
                }))
                .unwrap();
                let writer = handle.clone();
                let label = "background.contacts.reconcile_page";
                // Another copy's contact write changes the fence; the app
                // verifies that window again.
                let reconciled = self
                    .commands
                    .run(label, async move {
                        writer.contact_reconcile(request).await.map(drop)
                    })
                    .await;
                self.commands.superseded(label, reconciled);
                match window.next_cursor {
                    Some(cursor) => after = Some(cursor),
                    None => break,
                }
            }
        }
    }

    /// Replays Soup pages, warming (`hydrate`) or as refetched responses
    /// (`write`, persisted in the background as the webview persists them).
    async fn soup(self, pages: Vec<Op>, label: &'static str, write: bool) {
        for round in 1.. {
            for page in &pages {
                if stop_after(&self.stop) {
                    return;
                }
                let handle = self.stamped("background.authority").await;
                let mut data = page.data.clone();
                vary(&mut data, round);
                let (query, op, identity) = (
                    self.docs[&page.doc].clone(),
                    page.clone(),
                    self.identity.clone(),
                );
                let answered = self
                    .commands
                    .run(label, async move {
                        if write {
                            handle
                                .write_in_background(WriteRequest {
                                    origin_op_id: None,
                                    registration: None,
                                    query,
                                    operation_name: Some(op.operation_name),
                                    variables: op.variables,
                                    data,
                                    identity: Some(identity),
                                })
                                .await
                                .map(drop)
                        } else {
                            handle
                                .hydrate_query(
                                    query,
                                    Some(op.operation_name),
                                    op.variables,
                                    data,
                                    Some(identity),
                                    None,
                                )
                                .await
                                .map(drop)
                        }
                    })
                    .await;
                self.commands.superseded(label, answered);
            }
        }
    }

    /// A person renaming one item now and then: the optimistic enqueue, then
    /// the commit of the server's answer.
    async fn renames(self, item: Op, mean_gap_ms: u64) {
        let mut rng = 0x9e37_79b9_7f4a_7c15_u64;
        for n in 0u64.. {
            tokio::time::sleep(gap(&mut rng, mean_gap_ms)).await;
            if stop_after(&self.stop) {
                return;
            }
            let handle = self.stamped("user.authority").await;
            let mut data = item.data.clone();
            data["user"]["soup"]["items"][0]["displayName"] = format!("Renamed {n}").into();
            let (query, op) = (self.docs[&item.doc].clone(), item.clone());
            let enqueuer = handle.clone();
            let (enqueue_query, enqueue_op, enqueue_data) =
                (query.clone(), op.clone(), data.clone());
            let enqueued = self
                .commands
                .run("user.rename.enqueue", async move {
                    enqueuer
                        .enqueue_optimistic_mutation(
                            None,
                            format!("00000000-0000-4000-8000-{n:012}"),
                            enqueue_query,
                            Some(enqueue_op.operation_name),
                            enqueue_op.variables,
                            enqueue_data,
                            vec![],
                            vec![],
                            vec![],
                            0,
                            "bench".into(),
                            0,
                            i64::MAX,
                            None,
                            vec![],
                        )
                        .await
                        .unwrap()
                })
                .await;
            let InitialMutationClaimWire::Claimed { mutation } = enqueued.initial_claim else {
                panic!("the rename is the only queued mutation");
            };
            let transaction = enqueued.transaction_id;
            self.commands
                .run("user.rename.commit", async move {
                    handle
                        .commit_optimistic_write(
                            transaction,
                            "bench".into(),
                            mutation.lease_generation,
                            query,
                            Some(op.operation_name),
                            op.variables,
                            data,
                        )
                        .await
                        .unwrap()
                })
                .await;
        }
    }

    /// A person reading: the inbox list and a search, alternately.
    async fn reads(self, mean_gap_ms: u64) {
        let mut rng = 0x2545_f491_4f6c_dd1d_u64;
        for n in 0u64.. {
            tokio::time::sleep(gap(&mut rng, mean_gap_ms)).await;
            if stop_after(&self.stop) {
                return;
            }
            let reader = self.handle.clone();
            if n % 2 == 0 {
                self.commands
                    .run("user.read.inbox", async move {
                        reader
                            .entity_filter(mail_args(50, "INBOX", None))
                            .await
                            .unwrap()
                    })
                    .await;
            } else {
                self.commands
                    .run("user.read.search", async move {
                        reader.search(search("project update")).await.unwrap()
                    })
                    .await;
            }
        }
    }
}

/// How late a 1 ms sleep wakes, and how long a spawned task waits to start.
async fn probes(stop: Arc<AtomicBool>) -> (Vec<f64>, Vec<f64>) {
    let sleeping = {
        let stop = Arc::clone(&stop);
        tauri::async_runtime::spawn(async move {
            let mut late = Vec::new();
            while !stop_after(&stop) {
                let started = Instant::now();
                tokio::time::sleep(Duration::from_millis(1)).await;
                late.push((started.elapsed().as_secs_f64() - 0.001).max(0.0) * 1000.0);
            }
            late
        })
    };
    let mut waits = Vec::new();
    while !stop_after(&stop) {
        let spawned = Instant::now();
        let started = tauri::async_runtime::spawn(async move { spawned.elapsed() })
            .await
            .unwrap();
        waits.push(started.as_secs_f64() * 1000.0);
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    (sleeping.await.unwrap(), waits)
}

fn stats(mut values: Vec<f64>) -> serde_json::Value {
    if values.is_empty() {
        return serde_json::Value::Null;
    }
    values.sort_by(f64::total_cmp);
    let at = |q: f64| {
        let ms = values[((q * values.len() as f64).ceil() as usize).saturating_sub(1)];
        (ms * 10.0).round() / 10.0
    };
    serde_json::json!({
        "n": values.len(),
        "p50": at(0.5),
        "p90": at(0.9),
        "p99": at(0.99),
        "max": at(1.0),
    })
}

#[test]
#[ignore = "benchmark: needs CACHE_BENCH_DATA with a database native_cache_bench seeded"]
fn native_contention_bench() {
    let workers = ms_env("CACHE_BENCH_WORKERS", 8) as usize;
    let phase = Duration::from_secs(ms_env("CACHE_BENCH_PHASE_SECS", 20));
    let rename_gap = ms_env("CACHE_BENCH_RENAME_GAP_MS", 1000);
    let read_gap = ms_env("CACHE_BENCH_READ_GAP_MS", 500);
    // Producers per background lane: the app has many sync loops and views
    // queueing on the one engine at once.
    let copies = ms_env("CACHE_BENCH_BACKGROUND_COPIES", 1) as usize;
    let data = PathBuf::from(std::env::var_os("CACHE_BENCH_DATA").expect("CACHE_BENCH_DATA"));
    let docs: Arc<BTreeMap<String, String>> =
        Arc::new(serde_json::from_slice(&std::fs::read(data.join("docs.json")).unwrap()).unwrap());
    let seed = ops(&data.join("seed.ndjson"));
    let identity = seed[0].data["user"]["id"].as_str().unwrap().to_owned();
    let contacts: Vec<Op> = seed
        .iter()
        .filter(|op| op.operation_name == "ContactDirectoryBackfill")
        .cloned()
        .collect();
    let soup: Vec<Op> = seed
        .iter()
        .filter(|op| op.operation_name != "ContactDirectoryBackfill")
        .cloned()
        .collect();
    let spread = |lanes: &[&str], count: usize| -> Vec<Op> {
        let pages: Vec<&Op> = soup
            .iter()
            .filter(|op| lanes.contains(&op.lane.as_str()))
            .collect();
        pages
            .iter()
            .step_by(pages.len().div_ceil(count).max(1))
            .map(|op| (*op).clone())
            .collect()
    };
    let warming = spread(
        &[
            "core-entities",
            "email-filter-metadata",
            "email-thread-pages",
        ],
        60,
    );
    let refetches = spread(&["channels", "core-entities"], 20);
    // One item of a core page, under its own variables, renamed.
    let mut rename = refetches
        .iter()
        .find(|op| op.lane == "core-entities")
        .unwrap()
        .clone();
    rename.data["user"]["soup"]["items"] =
        serde_json::Value::Array(vec![rename.data["user"]["soup"]["items"][0].clone()]);
    rename.variables = serde_json::from_value({
        let mut variables = serde_json::to_value(&rename.variables).unwrap();
        variables["input"]["initial"]["limit"] = 1.into();
        variables
    })
    .unwrap();

    // A copy, so the bench never changes the database the main bench reuses.
    let dir = tempfile::tempdir().unwrap();
    for entry in std::fs::read_dir(data.join("native")).unwrap() {
        let entry = entry.unwrap();
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with("cache.turso")
        {
            std::fs::copy(entry.path(), dir.path().join(entry.file_name())).unwrap();
        }
    }
    let path = dir.path().join("cache.turso");

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(workers)
        .enable_all()
        .build()
        .unwrap();
    tauri::async_runtime::set(runtime.handle().clone());
    let report = runtime.block_on(async move {
        let handle = open(&path);
        handle
            .entity_filter(mail_args(50, "INBOX", None))
            .await
            .unwrap();
        let mut phases = serde_json::Map::new();
        for (name, loaded) in [("quiet", false), ("loaded", true)] {
            probe::take();
            let _ = crate::engine::idle::take_copies();
            let stop = Arc::new(AtomicBool::new(false));
            let lane = Lane {
                handle: handle.clone(),
                docs: Arc::clone(&docs),
                identity: identity.clone(),
                commands: Commands::default(),
                stop: Arc::clone(&stop),
            };
            let mut tasks = vec![
                tauri::async_runtime::spawn(lane.clone().renames(rename.clone(), rename_gap)),
                tauri::async_runtime::spawn(lane.clone().reads(read_gap)),
            ];
            for copy in (0..copies).filter(|_| loaded) {
                // Each copy starts at its own page, so copies write different rows.
                let rotated = |pages: &[Op]| {
                    let mut pages = pages.to_vec();
                    let start = copy * pages.len() / copies;
                    pages.rotate_left(start);
                    pages
                };
                tasks.push(tauri::async_runtime::spawn(
                    lane.clone().contacts(rotated(&contacts)),
                ));
                tasks.push(tauri::async_runtime::spawn(lane.clone().soup(
                    rotated(&warming),
                    "background.soup.hydrate_page",
                    false,
                )));
                tasks.push(tauri::async_runtime::spawn(lane.clone().soup(
                    rotated(&refetches),
                    "background.soup.write_page",
                    true,
                )));
            }
            let probing = tauri::async_runtime::spawn(probes(Arc::clone(&stop)));
            tokio::time::sleep(phase).await;
            stop.store(true, Ordering::SeqCst);
            for task in tasks {
                task.await.unwrap();
            }
            let (sleep_late, spawn_wait) = probing.await.unwrap();

            let mut guards: BTreeMap<&str, (Vec<f64>, Vec<f64>)> = BTreeMap::new();
            for (command, timing) in probe::take() {
                let entry = guards.entry(command).or_default();
                entry.0.push(timing.lock_wait_ms);
                entry.1.push(timing.lock_hold_ms);
            }
            let commands = std::mem::take(&mut *lane.commands.0.lock().unwrap());
            let superseded = std::mem::take(&mut *lane.commands.1.lock().unwrap());
            let mut longest: Vec<(f64, &str)> = commands
                .iter()
                .flat_map(|(label, runs)| runs.iter().map(move |run| (run.1, *label)))
                .collect();
            longest.sort_by(|a, b| b.0.total_cmp(&a.0));
            let by_command: serde_json::Map<_, _> = commands
                .into_iter()
                .map(|(label, runs)| {
                    let (wait, hold) = guards.remove(label).unwrap_or_default();
                    (
                        label.to_owned(),
                        serde_json::json!({
                            "answerMs": stats(runs.iter().map(|run| run.0).collect()),
                            "longestPollMs": stats(runs.iter().map(|run| run.1).collect()),
                            "lockWaitMs": stats(wait),
                            "lockHoldMs": stats(hold),
                        }),
                    )
                })
                .collect();
            let checkpoints: Vec<f64> = crate::engine::idle::take_copies()
                .into_iter()
                .map(|(ms, _)| ms)
                .collect();
            phases.insert(
                name.to_owned(),
                serde_json::json!({
                    "commands": by_command,
                    "superseded": superseded,
                    "longestPolls": longest
                        .iter()
                        .take(10)
                        .map(|(ms, label)| serde_json::json!([label, (ms * 10.0).round() / 10.0]))
                        .collect::<Vec<_>>(),
                    "probe": {
                        "sleepLateMs": stats(sleep_late),
                        "spawnWaitMs": stats(spawn_wait),
                    },
                    "idleCheckpointMs": stats(checkpoints),
                }),
            );
            // Let commands still running drain before the next phase.
            drop(handle.inner.write().await);
        }
        handle.shutdown().unwrap();
        serde_json::json!({
            "workers": workers,
            "backgroundCopies": copies,
            "phaseSecs": phase.as_secs(),
            "renameGapMs": rename_gap,
            "readGapMs": read_gap,
            "contactPages": contacts.len(),
            "warmingPages": warming.len(),
            "refetchPages": refetches.len(),
            "phases": phases,
        })
    });
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
}
