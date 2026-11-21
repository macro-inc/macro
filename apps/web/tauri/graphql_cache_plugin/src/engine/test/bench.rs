//! Native half of the cache engine benchmark (`crates/client/cache-bench`).
//! Replays a generated dataset through the same `EngineHandle` the desktop
//! app uses, on a file-backed Turso database, and prints per-step timings as
//! JSON. The browser half is `graphql-cache/worker/browser-test/bench-runner.ts`;
//! both run the same steps over the same dataset.
//!
//! ```sh
//! CACHE_BENCH_DATA=<dataset dir> nix develop .#tauri-linux --command cargo test --release \
//!   --manifest-path apps/web/tauri/Cargo.toml -p graphql_cache_plugin -- --ignored \
//!   --nocapture native_cache_bench
//! ```
use super::*;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

const SCOPE: &str = "cache-bench";
const NIL: &str = "00000000-0000-0000-0000-000000000000";

#[derive(Clone)]
struct Op {
    lane: String,
    write: bool,
    doc: String,
    operation_name: String,
    variables: Variables,
    data: serde_json::Value,
    bytes: usize,
    /// Foreground ops come in variants; run `n` writes variant `n % count`.
    variant: u64,
}

fn ops(path: &Path) -> Vec<Op> {
    std::fs::read_to_string(path)
        .unwrap()
        .lines()
        .map(|line| {
            let mut op: serde_json::Value = serde_json::from_str(line).unwrap();
            Op {
                lane: op["lane"].as_str().unwrap().to_owned(),
                write: op["op"] == "write",
                doc: op["doc"].as_str().unwrap().to_owned(),
                operation_name: op["operationName"].as_str().unwrap().to_owned(),
                variables: serde_json::from_value(op["variables"].take()).unwrap(),
                data: op["data"].take(),
                bytes: line.len(),
                variant: op["variant"].as_u64().unwrap_or(0),
            }
        })
        .collect()
}

/// This process's IO counters (`/proc/self/io`): bytes and syscalls through
/// read/write, and bytes the kernel sent to storage. Zero where `/proc` is absent.
#[derive(Clone, Copy, Default)]
struct Io {
    rchar: u64,
    wchar: u64,
    syscr: u64,
    syscw: u64,
    write_bytes: u64,
}

impl Io {
    fn now() -> Self {
        let text = std::fs::read_to_string("/proc/self/io").unwrap_or_default();
        let field = |name: &str| {
            text.lines()
                .find_map(|line| line.strip_prefix(name)?.strip_prefix(": "))
                .and_then(|value| value.trim().parse().ok())
                .unwrap_or(0)
        };
        Self {
            rchar: field("rchar"),
            wchar: field("wchar"),
            syscr: field("syscr"),
            syscw: field("syscw"),
            write_bytes: field("write_bytes"),
        }
    }

    fn since(self, before: Self) -> Self {
        Self {
            rchar: self.rchar.saturating_sub(before.rchar),
            wchar: self.wchar.saturating_sub(before.wchar),
            syscr: self.syscr.saturating_sub(before.syscr),
            syscw: self.syscw.saturating_sub(before.syscw),
            write_bytes: self.write_bytes.saturating_sub(before.write_bytes),
        }
    }

    fn add(&mut self, other: Self) {
        self.rchar += other.rchar;
        self.wchar += other.wchar;
        self.syscr += other.syscr;
        self.syscw += other.syscw;
        self.write_bytes += other.write_bytes;
    }
}

/// A `/proc/self/status` memory field in kB (`VmRSS`, `VmHWM`).
fn memory_kb(field: &str) -> u64 {
    std::fs::read_to_string("/proc/self/status")
        .unwrap_or_default()
        .lines()
        .find_map(|line| line.strip_prefix(field)?.strip_prefix(':'))
        .and_then(|value| value.trim().trim_end_matches("kB").trim().parse().ok())
        .unwrap_or(0)
}

/// When a step started, and the IO counters then.
#[derive(Clone, Copy)]
struct Mark {
    at: Instant,
    io: Io,
}

impl Mark {
    fn now() -> Self {
        // Read the counters first, so the timed span leaves their read out.
        let io = Io::now();
        Self {
            at: Instant::now(),
            io,
        }
    }
}

#[derive(Default)]
struct Samples {
    ms: BTreeMap<String, Vec<f64>>,
    io: BTreeMap<String, (u64, Io)>,
}

impl Samples {
    fn record(&mut self, name: &str, started: Mark) -> f64 {
        let ms = started.at.elapsed().as_secs_f64() * 1000.0;
        let io = Io::now().since(started.io);
        self.ms.entry(name.to_owned()).or_default().push(ms);
        let entry = self.io.entry(name.to_owned()).or_default();
        entry.0 += 1;
        entry.1.add(io);
        ms
    }

    /// Mean IO per call of each step.
    fn io_summary(&self) -> serde_json::Value {
        self.io
            .iter()
            .map(|(name, (calls, io))| {
                let per = |value: u64| value / (*calls).max(1);
                (
                    name.clone(),
                    serde_json::json!({
                        "rchar": per(io.rchar),
                        "syscr": per(io.syscr),
                        "wchar": per(io.wchar),
                        "syscw": per(io.syscw),
                        "writeBytes": per(io.write_bytes),
                    }),
                )
            })
            .collect::<serde_json::Map<_, _>>()
            .into()
    }

    fn summary(&self) -> serde_json::Value {
        let quantile = |sorted: &[f64], q: f64| {
            let position = (sorted.len() - 1) as f64 * q;
            let (low, high) = (position.floor() as usize, position.ceil() as usize);
            sorted[low] + (sorted[high] - sorted[low]) * (position - low as f64)
        };
        let round = |value: f64| (value * 10.0).round() / 10.0;
        self.ms
            .iter()
            .map(|(name, values)| {
                let mut sorted = values.clone();
                sorted.sort_by(f64::total_cmp);
                (
                    name.clone(),
                    serde_json::json!({
                        "n": sorted.len(),
                        "p50": round(quantile(&sorted, 0.5)),
                        "p90": round(quantile(&sorted, 0.9)),
                        "max": round(sorted[sorted.len() - 1]),
                        "total": round(sorted.iter().sum()),
                    }),
                )
            })
            .collect::<serde_json::Map<_, _>>()
            .into()
    }
}

/// `CACHE_BENCH_IDLE_CHECKPOINT` leaves the engine quiet between steps, as a
/// person using the app does, so its idle task copies the WAL once it is due.
fn idle_checkpoints() -> bool {
    std::env::var_os("CACHE_BENCH_IDLE_CHECKPOINT").is_some()
}

/// `CACHE_BENCH_SKIP_CONTENDED` leaves out the contended pass.
fn contended_reads() -> bool {
    std::env::var_os("CACHE_BENCH_SKIP_CONTENDED").is_none()
}

/// Reads while background hydration of seed pages keeps the engine busy, as
/// the browser half's contended pass does. Returns each hydrate's time.
async fn contended_pass(
    handle: &EngineHandle,
    docs: &Arc<BTreeMap<String, String>>,
    background: &Arc<Vec<Op>>,
    identity: &str,
    threads: &[String],
    home: &Variables,
    samples: &mut Samples,
) -> Vec<f64> {
    let stop = Arc::new(AtomicBool::new(false));
    let task = {
        let handle = handle.clone();
        let docs = Arc::clone(docs);
        let ops = Arc::clone(background);
        let identity = identity.to_owned();
        let stop = Arc::clone(&stop);
        tauri::async_runtime::spawn(async move {
            let mut ms = Vec::new();
            for op in ops.iter().cycle() {
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                let started = Instant::now();
                apply(&handle, &docs, op, &identity).await;
                ms.push(started.elapsed().as_secs_f64() * 1000.0);
            }
            ms
        })
    };
    read_pass(handle, docs, threads, home, samples).await;
    stop.store(true, Ordering::SeqCst);
    task.await.unwrap()
}

/// Opens without resetting: a database a reused run cannot open (another
/// build's format) fails the run instead of measuring an empty cache.
fn open(path: &Path) -> EngineHandle {
    let storage = cache_turso::TursoFileDatabase::new(path)
        .unwrap()
        .open(SCOPE)
        .unwrap();
    EngineHandle::with_schema(storage, None, cache_core::meta::bundled_schema())
}

/// A quiet moment outside every timed step, long enough for the engine's idle
/// task to run; the lock waits out a copy still going. Records each copy that
/// ran: how long it took and how many frames it copied.
async fn idle(handle: &EngineHandle, samples: &mut Samples) {
    if !idle_checkpoints() {
        return;
    }
    std::thread::sleep(std::time::Duration::from_millis(150));
    drop(handle.inner.lock().await);
    for (ms, checkpoint) in crate::engine::idle::take_copies() {
        samples
            .ms
            .entry("idle.checkpoint".to_owned())
            .or_default()
            .push(ms);
        samples
            .ms
            .entry("idle.checkpoint.frames".to_owned())
            .or_default()
            .push(checkpoint.backfilled_frames as f64);
    }
}

/// A handle stamped with the owner's current generation, as the app's
/// requests are.
async fn stamped(handle: &EngineHandle, identity: &str) -> EngineHandle {
    let authority = handle.current_authority(identity).await.unwrap();
    handle.clone().with_generation(Some(authority.generation))
}

async fn apply(handle: &EngineHandle, docs: &BTreeMap<String, String>, op: &Op, identity: &str) {
    let handle = stamped(handle, identity).await;
    let query = docs[&op.doc].clone();
    let result = if op.write {
        handle
            .write(WriteRequest {
                origin_op_id: None,
                registration: None,
                query,
                operation_name: Some(op.operation_name.clone()),
                variables: op.variables.clone(),
                data: op.data.clone(),
                identity: Some(identity.to_owned()),
            })
            .await
            .map(|_| ())
    } else {
        // Contact pages carry the fenced scope the app captures before fetching.
        let scope = if op.operation_name == "ContactDirectoryBackfill" {
            let mut scope = HydrationScope {
                contact_fence: None,
                storage_generation: handle
                    .current_storage_generation()
                    .await
                    .unwrap()
                    .parse()
                    .unwrap(),
                identity: identity.into(),
            };
            scope.contact_fence = Some(
                handle
                    .contact_snapshot(cache_core::people::sync::ContactSnapshotRequest {
                        scope: scope.clone(),
                        scan: None,
                    })
                    .await
                    .unwrap()
                    .fence,
            );
            Some(scope)
        } else {
            None
        };
        handle
            .hydrate_query(
                query,
                Some(op.operation_name.clone()),
                op.variables.clone(),
                op.data.clone(),
                Some(identity.to_owned()),
                scope,
            )
            .await
            .map(|_| ())
    };
    if let Err(error) = result {
        panic!("{} [{}]: {error}", op.operation_name, op.lane);
    }
}

fn mail_args(limit: u16, view: &str, cursor: Option<&serde_json::Value>) -> EntityFilterRequest {
    serde_json::from_value(mail_json(limit, view, cursor)).unwrap()
}

fn mail_json(limit: u16, view: &str, cursor: Option<&serde_json::Value>) -> serde_json::Value {
    let mut mail = serde_json::json!({ "view": view });
    if let Some(cursor) = cursor {
        mail["cursor"] = cursor.clone();
    }
    serde_json::json!({
        "filters": {
            "documentFilter": { "literal": { "id": NIL } },
            "projectFilter": { "literal": { "projectIdSelf": NIL } },
            "chatFilter": { "literal": { "chatId": NIL } },
            "calendarEventFilter": { "literal": { "id": NIL } },
            "channelFilter": { "literal": { "channelId": NIL } },
            "channelThreadFilter": { "literal": { "threadId": NIL } },
            "callFilter": { "literal": { "callId": NIL } },
            "crmCompanyFilter": { "literal": { "id": NIL } },
            "foreignEntityFilter": { "literal": { "id": NIL } },
        },
        "sortMethod": "UPDATED_AT",
        "sortDirection": "DESC",
        "limit": limit,
        "mail": mail,
    })
}

fn core_args(limit: u16) -> EntityFilterRequest {
    serde_json::from_value(core_request(limit)).unwrap()
}

fn core_request(limit: u16) -> serde_json::Value {
    serde_json::json!({
        "filters": {
            "emailFilter": { "tree": { "literal": { "threadId": NIL } } },
            "calendarEventFilter": { "literal": { "id": NIL } },
            "channelThreadFilter": { "literal": { "threadId": NIL } },
            "callFilter": { "literal": { "callId": NIL } },
            "crmCompanyFilter": { "literal": { "id": NIL } },
            "foreignEntityFilter": { "literal": { "id": NIL } },
        },
        "sortMethod": "UPDATED_AT",
        "sortDirection": "DESC",
        "limit": limit,
    })
}

const SEARCH_PARITY_QUERIES: &[&str] = &[
    "a",
    "e",
    "q",
    "pro",
    "Pro",
    "project update",
    "re, fw",
    "a b c d",
    "inv  2024",
    "m t",
    "the",
    "é",
    "zzqx",
    "x y z q",
];

fn search(query: &str) -> SearchRequest {
    serde_json::from_value(search_request(query, 20)).unwrap()
}

fn search_request(query: &str, limit: u16) -> serde_json::Value {
    serde_json::json!({
        "profile": "quick-access-v1",
        "query": query,
        "limit": limit,
        "nowMs": 1_795_000_000_000_i64,
    })
}

/// The Mail tabs' list requests, as the app builds them: the fixture that
/// `features/email-view/queries/cache-bench-mail-tabs.test.ts` keeps equal to
/// `buildEmailQuery` and `makeGraphqlSoupInput`.
fn mail_tabs() -> Vec<(String, serde_json::Value)> {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../src/lib/graphql-cache/worker/browser-test/bench-mail-tabs.json");
    let tabs: serde_json::Map<String, serde_json::Value> =
        serde_json::from_slice(&std::fs::read(fixture).unwrap()).unwrap();
    tabs.into_iter()
        .map(|(tab, input)| {
            let request = serde_json::json!({
                "filters": input["filters"],
                "sortMethod": input["sortMethod"],
                "sortDirection": input["sortDirection"],
                "limit": input["limit"],
                "mail": { "view": input["emailView"] },
            });
            (tab, request)
        })
        .collect()
}

fn keys(result: &serde_json::Value) -> Vec<String> {
    result["keys"]
        .as_array()
        .map(|keys| {
            keys.iter()
                .filter_map(|key| key.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// `CACHE_BENCH_READ_GAP_MS` waits a random time before each read
/// (exponential, with that mean), so reads arrive at moments independent of
/// the engine's work, as a person's do, instead of each right after the
/// last. Reads run on the bench's own thread, so the wait never holds up
/// the background hydrates on the async runtime.
fn read_gap() {
    static STATE: std::sync::atomic::AtomicU64 =
        std::sync::atomic::AtomicU64::new(0x9E37_79B9_7F4A_7C15);
    let Some(mean) = std::env::var("CACHE_BENCH_READ_GAP_MS")
        .ok()
        .and_then(|value| value.parse::<f64>().ok())
    else {
        return;
    };
    let mut x = STATE.load(Ordering::Relaxed);
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    STATE.store(x, Ordering::Relaxed);
    let uniform = ((x >> 11) as f64 + 0.5) / (1u64 << 53) as f64;
    std::thread::sleep(std::time::Duration::from_secs_f64(
        -uniform.ln() * mean / 1000.0,
    ));
}

async fn read_pass(
    handle: &EngineHandle,
    docs: &BTreeMap<String, String>,
    threads: &[String],
    home: &Variables,
    samples: &mut Samples,
) -> serde_json::Value {
    for (tab, request) in mail_tabs() {
        read_gap();
        let started = Mark::now();
        let result = handle
            .entity_filter(serde_json::from_value(request).unwrap())
            .await
            .unwrap();
        samples.record(&format!("mail.tab.{tab}.filter"), started);
        let result = serde_json::to_value(&result).unwrap();
        assert_eq!(result["kind"], "mail-page", "{tab}: {result}");
    }
    let mail_rows = &docs["fragment:MailItemFields"];
    let soup_rows = &docs["fragment:SoupItemFields"];
    read_gap();
    let started = Mark::now();
    let inbox = serde_json::to_value(
        handle
            .entity_filter(mail_args(50, "INBOX", None))
            .await
            .unwrap(),
    )
    .unwrap();
    samples.record("mail.inbox.filter", started);
    read_gap();
    let started = Mark::now();
    handle
        .read_records_by_keys(mail_rows.clone(), "MailItemFields".into(), keys(&inbox))
        .await
        .unwrap();
    samples.record("mail.inbox.rows", started);
    if let Some(cursor) = inbox.get("nextCursor").filter(|cursor| !cursor.is_null()) {
        read_gap();
        let started = Mark::now();
        let next = serde_json::to_value(
            handle
                .entity_filter(mail_args(50, "INBOX", Some(cursor)))
                .await
                .unwrap(),
        )
        .unwrap();
        samples.record("mail.inbox.page2.filter", started);
        read_gap();
        let started = Mark::now();
        handle
            .read_records_by_keys(mail_rows.clone(), "MailItemFields".into(), keys(&next))
            .await
            .unwrap();
        samples.record("mail.inbox.page2.rows", started);
    }
    read_gap();
    let started = Mark::now();
    let all = serde_json::to_value(
        handle
            .entity_filter(mail_args(50, "ALL", None))
            .await
            .unwrap(),
    )
    .unwrap();
    samples.record("mail.all.filter", started);
    read_gap();
    let started = Mark::now();
    handle
        .read_records_by_keys(mail_rows.clone(), "MailItemFields".into(), keys(&all))
        .await
        .unwrap();
    samples.record("mail.all.rows", started);
    read_gap();
    let started = Mark::now();
    let core = serde_json::to_value(handle.entity_filter(core_args(50)).await.unwrap()).unwrap();
    samples.record("soup.core.filter", started);
    if matches!(core["kind"].as_str(), Some("complete" | "reconciled")) {
        read_gap();
        let started = Mark::now();
        handle
            .read_records_by_keys(soup_rows.clone(), "SoupItemFields".into(), keys(&core))
            .await
            .unwrap();
        samples.record("soup.core.rows", started);
    }
    read_gap();
    let started = Mark::now();
    handle
        .read(
            None,
            docs["Soup"].clone(),
            Some("Soup".into()),
            home.clone(),
            vec![],
        )
        .await
        .unwrap();
    samples.record("soup.home.readQuery", started);
    for thread in threads {
        read_gap();
        let started = Mark::now();
        let variables = serde_json::from_value(
            serde_json::json!({ "threadId": thread, "offset": 0, "limit": 20 }),
        )
        .unwrap();
        handle
            .read(
                None,
                docs["EmailThreadPage"].clone(),
                Some("EmailThreadPage".into()),
                variables,
                vec![],
            )
            .await
            .unwrap();
        samples.record("thread.readQuery", started);
    }
    read_gap();
    let started = Mark::now();
    handle.search(search("")).await.unwrap();
    samples.record("search.empty", started);
    for query in ["pro", "project update", "zzqx"] {
        read_gap();
        let started = Mark::now();
        handle.search(search(query)).await.unwrap();
        samples.record("search.typed", started);
    }
    serde_json::json!({
        "inbox": keys(&inbox).len(),
        "all": keys(&all).len(),
        "core": if core.get("keys").is_some() { serde_json::json!(keys(&core).len()) } else { core["kind"].clone() },
    })
}

#[test]
#[ignore = "benchmark: needs CACHE_BENCH_DATA, a dataset from `cache-bench generate`"]
fn native_cache_bench() {
    let data = PathBuf::from(std::env::var_os("CACHE_BENCH_DATA").expect("CACHE_BENCH_DATA"));
    let runs: usize = std::env::var_os("CACHE_BENCH_RUNS")
        .map_or(5, |runs| runs.to_str().unwrap().parse().unwrap());
    let docs: Arc<BTreeMap<String, String>> =
        Arc::new(serde_json::from_slice(&std::fs::read(data.join("docs.json")).unwrap()).unwrap());
    let meta: serde_json::Value =
        serde_json::from_slice(&std::fs::read(data.join("meta.json")).unwrap()).unwrap();
    let threads: Vec<String> = meta["threadIds"]
        .as_array()
        .unwrap()
        .iter()
        .take(5)
        .map(|id| id.as_str().unwrap().to_owned())
        .collect();
    let seed = ops(&data.join("seed.ndjson"));
    let foreground = ops(&data.join("foreground.ndjson"));
    let identity = seed[0].data["user"]["id"].as_str().unwrap().to_owned();
    let home = foreground[0].variables.clone();
    let dir = data.join("native");
    let path = dir.join("cache.turso");
    // CACHE_BENCH_REUSE keeps a database an earlier run seeded from the same dataset.
    let reuse = std::env::var_os("CACHE_BENCH_REUSE").is_some() && path.exists();
    if !reuse {
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
    }

    block_on(async {
        let mut samples = Samples::default();
        let mut lanes: BTreeMap<String, (usize, usize, f64)> = BTreeMap::new();
        let started = Mark::now();
        let handle = open(&path);
        if !reuse {
            samples.record("open.fresh", started);
        }
        let seeding = Mark::now();
        for op in seed.iter().filter(|_| !reuse) {
            let started = Mark::now();
            apply(&handle, &docs, op, &identity).await;
            let ms = samples.record(&format!("seed.{}", op.lane), started);
            let lane = lanes.entry(op.lane.clone()).or_default();
            lane.0 += 1;
            lane.1 += op.bytes;
            lane.2 += ms;
            idle(&handle, &mut samples).await;
        }
        if !reuse {
            samples.record("seed.total", seeding);
        }
        handle.shutdown().unwrap();

        // Each run writes the next foreground variant, continuing across
        // invocations over a reused database, so every write changes rows the
        // last one wrote. A dataset without variants rewrites the same bytes.
        let variants = foreground.iter().map(|op| op.variant).max().unwrap_or(0) + 1;
        let rotation = dir.join("next-variant");
        let mut variant = std::fs::read_to_string(&rotation)
            .ok()
            .and_then(|text| text.trim().parse::<u64>().ok())
            .unwrap_or(1)
            % variants;
        let mut counts = serde_json::Value::Null;
        let mut rss_kb = Vec::new();
        let mut contended = Samples::default();
        let mut background_ms = Vec::new();
        // Background hydration during the contended pass replays seed pages.
        let background: Arc<Vec<Op>> = Arc::new(
            seed.iter()
                .take(40)
                .cloned()
                .map(|op| Op { write: false, ..op })
                .collect(),
        );
        for _ in 0..runs {
            let started = Mark::now();
            let handle = open(&path);
            samples.record("open.cold", started);
            let started = Mark::now();
            handle
                .entity_filter(mail_args(50, "INBOX", None))
                .await
                .unwrap();
            samples.record("open.first_read", started);
            counts = read_pass(&handle, &docs, &threads, &home, &mut samples).await;
            let writes = foreground.iter().filter(|op| op.variant == variant);
            for op in writes.clone() {
                let started = Mark::now();
                apply(&handle, &docs, op, &identity).await;
                samples.record(&format!("write.{}", op.lane), started);
                idle(&handle, &mut samples).await;
            }
            // The same responses again: what a refetch that changed nothing costs.
            for op in writes {
                let started = Mark::now();
                apply(&handle, &docs, op, &identity).await;
                samples.record(&format!("write.{}.same", op.lane), started);
                idle(&handle, &mut samples).await;
            }
            // Background refetches: a spread of seed pages, applied once to
            // settle them over the writes above, then again unchanged.
            let pages: Vec<&Op> = seed
                .iter()
                .filter(|op| !op.write && op.operation_name != "ContactDirectoryBackfill")
                .collect();
            let refetches = pages.iter().step_by(pages.len().div_ceil(40).max(1));
            for step in ["hydrate.replay", "hydrate.same"] {
                for op in refetches.clone() {
                    let started = Mark::now();
                    apply(&handle, &docs, op, &identity).await;
                    samples.record(step, started);
                    idle(&handle, &mut samples).await;
                }
            }
            if contended_reads() {
                background_ms.extend(
                    contended_pass(
                        &handle,
                        &docs,
                        &background,
                        &identity,
                        &threads,
                        &home,
                        &mut contended,
                    )
                    .await,
                );
                idle(&handle, &mut samples).await;
            }
            rss_kb.push(memory_kb("VmRSS"));
            handle.shutdown().unwrap();
            variant = (variant + 1) % variants;
            std::fs::write(&rotation, variant.to_string()).unwrap();
        }
        let bytes = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok()?.metadata().ok())
            .map(|metadata| metadata.len())
            .sum::<u64>();
        let lanes: serde_json::Map<_, _> = lanes
            .into_iter()
            .map(|(lane, (ops, bytes, ms))| {
                (lane, serde_json::json!({ "ops": ops, "bytes": bytes, "ms": (ms * 10.0).round() / 10.0 }))
            })
            .collect();
        // Every contended read, and the same reads uncontended, raw, so rounds
        // can be pooled.
        let raw = |from: &Samples| -> Vec<f64> {
            contended
                .ms
                .keys()
                .flat_map(|name| from.ms.get(name).into_iter().flatten().copied())
                .collect()
        };
        let (contended_ms, uncontended_ms) = (raw(&contended), raw(&samples));
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "runtime": "native",
                "runs": runs,
                "dbBytes": bytes,
                "counts": counts,
                "lanes": lanes,
                "steps": samples.summary(),
                "contended": contended.summary(),
                "contendedMs": contended_ms,
                "uncontendedMs": uncontended_ms,
                "background": { "hydrates": background_ms.len(), "meanMs": background_ms.iter().sum::<f64>() / background_ms.len().max(1) as f64 },
                "io": samples.io_summary(),
                "memory": { "rssKbPerRun": rss_kb, "peakRssKb": memory_kb("VmHWM") },
                "variants": variants,
            }))
            .unwrap()
        );
    });
}

/// Every page of each list input, read to its end, as JSON `{input: [[keys]]}`.
/// Run on two builds over one seeded dataset and diff the files to show a
/// change to list selection returns the same pages.
#[test]
#[ignore = "parity dump: needs CACHE_BENCH_DATA with a seeded native database and CACHE_BENCH_DUMP"]
fn native_cache_parity_dump() {
    let data = PathBuf::from(std::env::var_os("CACHE_BENCH_DATA").expect("CACHE_BENCH_DATA"));
    let out = PathBuf::from(std::env::var_os("CACHE_BENCH_DUMP").expect("CACHE_BENCH_DUMP"));
    let path = data.join("native").join("cache.turso");
    assert!(
        path.exists(),
        "seed the dataset with native_cache_bench first"
    );
    let mut inputs: Vec<(String, serde_json::Value)> = Vec::new();
    for view in ["INBOX", "ALL"] {
        inputs.push((format!("mail.{view}"), mail_json(50, view, None)));
    }
    inputs.extend(
        mail_tabs()
            .into_iter()
            .map(|(tab, request)| (format!("tab.{tab}"), request)),
    );
    block_on(async {
        let handle = open(&path);
        let mut dump = serde_json::Map::new();
        for (name, input) in &inputs {
            for limit in [1u16, 7, 50, 100] {
                for direction in ["DESC", "ASC"] {
                    let mut request = input.clone();
                    request["limit"] = limit.into();
                    request["sortDirection"] = direction.into();
                    let mut pages = Vec::new();
                    // Short pages read the head of the list; full pages read all of it.
                    let max_pages = if limit < 50 { 40 } else { 2_000 };
                    while pages.len() < max_pages {
                        let result = serde_json::to_value(
                            handle
                                .entity_filter(serde_json::from_value(request.clone()).unwrap())
                                .await
                                .unwrap(),
                        )
                        .unwrap();
                        assert_eq!(result["kind"], "mail-page", "{name}: {result}");
                        pages.push(serde_json::json!(keys(&result)));
                        match result.get("nextCursor").filter(|cursor| !cursor.is_null()) {
                            Some(cursor) => request["mail"]["cursor"] = cursor.clone(),
                            None => break,
                        }
                    }
                    dump.insert(format!("{name} limit={limit} {direction}"), pages.into());
                }
            }
        }
        // Soup lists have no local continuation: each limit reads a first page.
        // Dropping exclusions changes which partitions the list reads.
        for (name, dropped) in [
            ("core", &[][..]),
            ("core+channel-threads", &["channelThreadFilter"][..]),
            ("core+email", &["emailFilter"][..]),
            ("unfiltered", &["*"][..]),
        ] {
            for sort in ["UPDATED_AT", "CREATED_AT"] {
                for direction in ["DESC", "ASC"] {
                    for limit in [1u16, 7, 50, 100, 500] {
                        let mut request = core_request(limit);
                        let filters = request["filters"].as_object_mut().unwrap();
                        if dropped == ["*"] {
                            filters.clear();
                        }
                        for filter in dropped {
                            filters.remove(*filter);
                        }
                        request["sortMethod"] = sort.into();
                        request["sortDirection"] = direction.into();
                        let result = handle
                            .entity_filter(serde_json::from_value(request).unwrap())
                            .await
                            .map(|result| serde_json::to_value(result).unwrap())
                            .unwrap_or_else(
                                |error| serde_json::json!({ "error": error.to_string() }),
                            );
                        let page = if result.get("keys").is_some() {
                            serde_json::json!(keys(&result))
                        } else {
                            result
                        };
                        dump.insert(
                            format!("soup.{name} {sort} {direction} limit={limit}"),
                            serde_json::json!([page]),
                        );
                    }
                }
            }
        }
        // Typed search: whole ranked pages (documents in order), over one-letter, multi-token,
        // comma, Unicode, case and unmatched queries.
        for query in SEARCH_PARITY_QUERIES {
            for limit in [20u16, 500] {
                let page = handle
                    .search(serde_json::from_value(search_request(query, limit)).unwrap())
                    .await
                    .map(|page| serde_json::to_value(page).unwrap())
                    .unwrap_or_else(|error| serde_json::json!({ "error": error }));
                dump.insert(
                    format!("search {query:?} limit={limit}"),
                    serde_json::json!([page]),
                );
            }
        }
        handle.shutdown().unwrap();
        std::fs::write(&out, serde_json::to_vec_pretty(&dump).unwrap()).unwrap();
        for (name, pages) in &dump {
            let rows: usize = pages
                .as_array()
                .map(|pages| {
                    pages
                        .iter()
                        .map(|page| page.as_array().map_or(1, Vec::len))
                        .sum()
                })
                .unwrap_or(0);
            println!(
                "PARITY {name}: {} pages, {rows} keys",
                pages.as_array().map_or(0, Vec::len)
            );
        }
    });
}

/// One read of the stall pass's mix.
#[derive(Clone)]
enum StallRead {
    Thread(String),
    Inbox,
    Search(&'static str),
}

/// Runs one read the way Tauri runs a command: on a task of its own that
/// nobody can cancel, so a caller that stops waiting leaves it running.
fn spawn_read(
    handle: &EngineHandle,
    docs: &BTreeMap<String, String>,
    read: &StallRead,
    request_id: String,
) -> tauri::async_runtime::JoinHandle<()> {
    let handle = reading(handle, request_id);
    let (document, read) = (docs["EmailThreadPage"].clone(), read.clone());
    tauri::async_runtime::spawn(async move {
        // An abandoned read answers with an error; the caller is gone either way.
        let _ = match read {
            StallRead::Thread(thread) => handle
                .read(
                    None,
                    document,
                    Some("EmailThreadPage".into()),
                    serde_json::from_value(
                        serde_json::json!({ "threadId": thread, "offset": 0, "limit": 20 }),
                    )
                    .unwrap(),
                    vec![],
                )
                .await
                .map(drop),
            StallRead::Inbox => handle
                .entity_filter(mail_args(50, "INBOX", None))
                .await
                .map(drop),
            StallRead::Search(query) => handle.search(search(query)).await.map(drop),
        };
    })
}

/// The handle a read with this request id runs on.
fn reading(handle: &EngineHandle, _request_id: String) -> EngineHandle {
    handle.clone()
}

/// What a caller does with a read it stopped waiting for.
fn abandon(_handle: &EngineHandle, _request_id: &str) {}

/// Readers that each wait up to `CACHE_BENCH_STALL_DEADLINE_MS` (100) for a
/// read, then give up and send the next, while the engine is held for
/// `CACHE_BENCH_STALL_MS` (1000), as a slow command holds it. Measures how
/// the reads issued after the stall fare: a read left running after its
/// caller gave up still takes its turn on the engine.
#[test]
#[ignore = "benchmark: needs CACHE_BENCH_DATA with a database native_cache_bench seeded"]
fn native_stall_bench() {
    let env_ms = |name: &str, default: u64| {
        std::env::var(name)
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(default)
    };
    let deadline = std::time::Duration::from_millis(env_ms("CACHE_BENCH_STALL_DEADLINE_MS", 100));
    let stall = std::time::Duration::from_millis(env_ms("CACHE_BENCH_STALL_MS", 1000));
    let after = std::time::Duration::from_millis(env_ms("CACHE_BENCH_STALL_AFTER_MS", 4000));
    let readers = env_ms("CACHE_BENCH_STALL_READERS", 8) as usize;
    let rounds = env_ms("CACHE_BENCH_RUNS", 3) as usize;
    let data = PathBuf::from(std::env::var_os("CACHE_BENCH_DATA").expect("CACHE_BENCH_DATA"));
    let docs: Arc<BTreeMap<String, String>> =
        Arc::new(serde_json::from_slice(&std::fs::read(data.join("docs.json")).unwrap()).unwrap());
    let meta: serde_json::Value =
        serde_json::from_slice(&std::fs::read(data.join("meta.json")).unwrap()).unwrap();
    let mut mix: Vec<StallRead> = meta["threadIds"]
        .as_array()
        .unwrap()
        .iter()
        .take(5)
        .map(|id| StallRead::Thread(id.as_str().unwrap().to_owned()))
        .collect();
    mix.extend([
        StallRead::Inbox,
        StallRead::Search("pro"),
        StallRead::Search("project update"),
    ]);
    let mix = Arc::new(mix);
    // A copy, so the stall pass never changes the database the main bench reuses.
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

    tauri::async_runtime::block_on(async move {
        let handle = open(&path);
        handle
            .entity_filter(mail_args(50, "INBOX", None))
            .await
            .unwrap();
        // (ms after the stall ended at issue, answered within the deadline, ms)
        let mut reads: Vec<(f64, bool, f64)> = Vec::new();
        let mut timed_out_during = 0usize;
        for round in 0..rounds {
            let stop = Arc::new(AtomicBool::new(false));
            let stall_end: Arc<std::sync::OnceLock<Instant>> = Arc::default();
            let tasks: Vec<_> = (0..readers)
                .map(|reader| {
                    let (handle, docs, mix, stop, stall_end) = (
                        handle.clone(),
                        Arc::clone(&docs),
                        Arc::clone(&mix),
                        Arc::clone(&stop),
                        Arc::clone(&stall_end),
                    );
                    tauri::async_runtime::spawn(async move {
                        let mut out = Vec::new();
                        let mut during = 0usize;
                        let mut n = reader;
                        while !stop.load(Ordering::SeqCst) {
                            let id = format!("bench:{round}:{reader}:{n}");
                            let read = &mix[n % mix.len()];
                            n += readers;
                            let issued = Instant::now();
                            let task = spawn_read(&handle, &docs, read, id.clone());
                            let answered = tokio::time::timeout(deadline, task).await.is_ok();
                            if !answered {
                                abandon(&handle, &id);
                            }
                            let ms = issued.elapsed().as_secs_f64() * 1000.0;
                            match stall_end.get() {
                                Some(end) if issued >= *end => out.push((
                                    issued.duration_since(*end).as_secs_f64() * 1000.0,
                                    answered,
                                    ms,
                                )),
                                _ => during += usize::from(!answered),
                            }
                        }
                        (out, during)
                    })
                })
                .collect();
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            {
                let _held = handle.inner.write().await;
                tokio::time::sleep(stall).await;
                let _ = stall_end.set(Instant::now());
            }
            tokio::time::sleep(after).await;
            stop.store(true, Ordering::SeqCst);
            for task in tasks {
                let (out, during) = task.await.unwrap();
                reads.extend(out);
                timed_out_during += during;
            }
            // Let reads still running drain before the next round.
            let _ = handle.inner.write().await;
        }
        let answered: Vec<f64> = {
            let mut ms: Vec<f64> = reads.iter().filter(|r| r.1).map(|r| r.2).collect();
            ms.sort_by(f64::total_cmp);
            ms
        };
        let quantile = |q: f64| -> f64 {
            answered
                .get(((q * answered.len() as f64).ceil() as usize).saturating_sub(1))
                .map_or(f64::NAN, |ms| (ms * 10.0).round() / 10.0)
        };
        // Per round, the issue time of the last read after the stall that
        // timed out: until then the engine still served reads nobody waited for.
        let last_timeout = reads
            .iter()
            .filter(|r| !r.1)
            .map(|r| r.0)
            .fold(0.0_f64, f64::max);
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "readers": readers,
                "deadlineMs": deadline.as_millis() as u64,
                "stallMs": stall.as_millis() as u64,
                "afterMs": after.as_millis() as u64,
                "rounds": rounds,
                "timedOutDuringStall": timed_out_during,
                "afterStall": {
                    "issued": reads.len(),
                    "answered": answered.len(),
                    "timedOut": reads.len() - answered.len(),
                    "lastTimeoutIssuedMs": (last_timeout * 10.0).round() / 10.0,
                    "answeredMs": { "p50": quantile(0.5), "p90": quantile(0.9), "p99": quantile(0.99) },
                },
                "answeredAfterStallMs": answered,
                "timedOutIssuedAtMs": reads.iter().filter(|r| !r.1).map(|r| (r.0 * 10.0).round() / 10.0).collect::<Vec<_>>(),
            }))
            .unwrap()
        );
        // Reads given up on may still hold clones; the copy goes with the temp dir.
        drop(handle);
    });
}
