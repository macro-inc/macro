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
use std::time::Instant;

const SCOPE: &str = "cache-bench";
const NIL: &str = "00000000-0000-0000-0000-000000000000";

struct Op {
    lane: String,
    write: bool,
    doc: String,
    operation_name: String,
    variables: Variables,
    data: serde_json::Value,
    bytes: usize,
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
            }
        })
        .collect()
}

#[derive(Default)]
struct Samples(BTreeMap<String, Vec<f64>>);

impl Samples {
    fn record(&mut self, name: &str, started: Instant) -> f64 {
        let ms = started.elapsed().as_secs_f64() * 1000.0;
        self.0.entry(name.to_owned()).or_default().push(ms);
        ms
    }

    fn summary(&self) -> serde_json::Value {
        let quantile = |sorted: &[f64], q: f64| {
            let position = (sorted.len() - 1) as f64 * q;
            let (low, high) = (position.floor() as usize, position.ceil() as usize);
            sorted[low] + (sorted[high] - sorted[low]) * (position - low as f64)
        };
        let round = |value: f64| (value * 10.0).round() / 10.0;
        self.0
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

/// Opens without resetting: a database a reused run cannot open (another
/// build's format) fails the run instead of measuring an empty cache.
fn open(path: &Path) -> EngineHandle {
    let storage = cache_turso::TursoFileDatabase::new(path)
        .unwrap()
        .open(SCOPE)
        .unwrap();
    EngineHandle::with_schema(storage, None, cache_core::meta::bundled_schema())
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
    serde_json::from_value(serde_json::json!({
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
    }))
    .unwrap()
}

fn search(query: &str) -> SearchRequest {
    serde_json::from_value(serde_json::json!({
        "profile": "quick-access-v1",
        "query": query,
        "limit": 20,
        "nowMs": 1_795_000_000_000_i64,
    }))
    .unwrap()
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

async fn read_pass(
    handle: &EngineHandle,
    docs: &BTreeMap<String, String>,
    threads: &[String],
    home: &Variables,
    samples: &mut Samples,
) -> serde_json::Value {
    for (tab, request) in mail_tabs() {
        let started = Instant::now();
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
    let started = Instant::now();
    let inbox = serde_json::to_value(
        handle
            .entity_filter(mail_args(50, "INBOX", None))
            .await
            .unwrap(),
    )
    .unwrap();
    samples.record("mail.inbox.filter", started);
    let started = Instant::now();
    handle
        .read_records_by_keys(mail_rows.clone(), "MailItemFields".into(), keys(&inbox))
        .await
        .unwrap();
    samples.record("mail.inbox.rows", started);
    if let Some(cursor) = inbox.get("nextCursor").filter(|cursor| !cursor.is_null()) {
        let started = Instant::now();
        let next = serde_json::to_value(
            handle
                .entity_filter(mail_args(50, "INBOX", Some(cursor)))
                .await
                .unwrap(),
        )
        .unwrap();
        samples.record("mail.inbox.page2.filter", started);
        let started = Instant::now();
        handle
            .read_records_by_keys(mail_rows.clone(), "MailItemFields".into(), keys(&next))
            .await
            .unwrap();
        samples.record("mail.inbox.page2.rows", started);
    }
    let started = Instant::now();
    let all = serde_json::to_value(
        handle
            .entity_filter(mail_args(50, "ALL", None))
            .await
            .unwrap(),
    )
    .unwrap();
    samples.record("mail.all.filter", started);
    let started = Instant::now();
    handle
        .read_records_by_keys(mail_rows.clone(), "MailItemFields".into(), keys(&all))
        .await
        .unwrap();
    samples.record("mail.all.rows", started);
    let started = Instant::now();
    let core = serde_json::to_value(handle.entity_filter(core_args(50)).await.unwrap()).unwrap();
    samples.record("soup.core.filter", started);
    if matches!(core["kind"].as_str(), Some("complete" | "reconciled")) {
        let started = Instant::now();
        handle
            .read_records_by_keys(soup_rows.clone(), "SoupItemFields".into(), keys(&core))
            .await
            .unwrap();
        samples.record("soup.core.rows", started);
    }
    let started = Instant::now();
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
        let started = Instant::now();
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
    let started = Instant::now();
    handle.search(search("")).await.unwrap();
    samples.record("search.empty", started);
    for query in ["pro", "project update", "zzqx"] {
        let started = Instant::now();
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
    let docs: BTreeMap<String, String> =
        serde_json::from_slice(&std::fs::read(data.join("docs.json")).unwrap()).unwrap();
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
        let started = Instant::now();
        let handle = open(&path);
        if !reuse {
            samples.record("open.fresh", started);
        }
        let seeding = Instant::now();
        for op in seed.iter().filter(|_| !reuse) {
            let started = Instant::now();
            apply(&handle, &docs, op, &identity).await;
            let ms = samples.record(&format!("seed.{}", op.lane), started);
            let lane = lanes.entry(op.lane.clone()).or_default();
            lane.0 += 1;
            lane.1 += op.bytes;
            lane.2 += ms;
        }
        if !reuse {
            samples.record("seed.total", seeding);
        }
        handle.shutdown().unwrap();

        let mut counts = serde_json::Value::Null;
        for _ in 0..runs {
            let started = Instant::now();
            let handle = open(&path);
            samples.record("open.cold", started);
            let started = Instant::now();
            handle
                .entity_filter(mail_args(50, "INBOX", None))
                .await
                .unwrap();
            samples.record("open.first_read", started);
            counts = read_pass(&handle, &docs, &threads, &home, &mut samples).await;
            for op in &foreground {
                let started = Instant::now();
                apply(&handle, &docs, op, &identity).await;
                samples.record(&format!("write.{}", op.lane), started);
            }
            handle.shutdown().unwrap();
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
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "runtime": "native",
                "runs": runs,
                "dbBytes": bytes,
                "counts": counts,
                "lanes": lanes,
                "steps": samples.summary(),
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
        let core =
            serde_json::to_value(handle.entity_filter(core_args(100)).await.unwrap()).unwrap();
        dump.insert("soup.core limit=100".into(), serde_json::json!(keys(&core)));
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
