//! Channel by-ID reads at chat scale: the Chat sidebar's 500-ID batches
//! (`apps/web/src/lib/queries/channel/by-ids.ts`) as maintained live views,
//! and what one write costs them. Needs a `cache-bench generate --tier chat`
//! dataset; seeds `<data>/native-channels/cache.turso` once and reuses it.
//!
//! ```sh
//! CACHE_BENCH_DATA=<dataset dir> nix develop .#tauri-linux --command cargo test --release \
//!   --manifest-path apps/web/tauri/Cargo.toml -p graphql_cache_plugin --lib -- --ignored \
//!   --nocapture --exact engine::test::channels::native_channel_batches_bench
//! ```
use super::bench::{Mark, Op, Samples, apply, memory_kb, open, ops, stamped};
use super::*;
use std::collections::BTreeMap;
use std::path::PathBuf;

const BATCH_SIZE: usize = 500;
const NIL: &str = "00000000-0000-0000-0000-000000000000";
const CHANNEL_LIST: &str = "fragment:ChannelListItemFields";

// glibc only: the test binary must still link on macOS and Windows.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
unsafe extern "C" {
    fn malloc_trim(pad: usize) -> i32;
}

/// Resident memory once glibc has returned its free pages: what is still held.
fn live_kb() -> u64 {
    // SAFETY: glibc's malloc_trim only releases free memory.
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    unsafe {
        malloc_trim(0)
    };
    memory_kb("VmRSS")
}

/// `joinBalanced` in `apps/web/src/lib/queries/soup/graphql/ast.ts`: an ID
/// list too deep as a chain is sent as a balanced tree of `or` nodes.
fn balanced(ids: &[(String, String)]) -> serde_json::Value {
    if let [(id, _)] = ids {
        return serde_json::json!({ "literal": { "channelId": id } });
    }
    let (left, right) = ids.split_at(ids.len().div_ceil(2));
    serde_json::json!({ "or": { "left": balanced(left), "right": balanced(right) } })
}

/// The filters `channelsByIdsQueryArgs` compiles: every other entity type
/// excluded, and the IDs `or`ed together.
fn by_ids_filters(ids: &[(String, String)]) -> serde_json::Value {
    let chain = balanced(ids);
    serde_json::json!({
        "calendarEventFilter": { "literal": { "id": NIL } },
        "documentFilter": { "literal": { "id": NIL } },
        "projectFilter": { "literal": { "projectId": NIL } },
        "chatFilter": { "literal": { "chatId": NIL } },
        "emailFilter": { "tree": { "literal": { "threadId": NIL } } },
        "channelFilter": chain,
        "channelThreadFilter": { "literal": { "threadId": NIL } },
        "callFilter": { "literal": { "callId": NIL } },
        "crmCompanyFilter": { "literal": { "id": NIL } },
        "foreignEntityFilter": { "literal": { "id": NIL } },
    })
}

fn request(
    batch: usize,
    ids: &[(String, String)],
    docs: &BTreeMap<String, String>,
    live: Option<Option<&str>>,
) -> EntityFilterRequest {
    serde_json::from_value(request_json(batch, ids, docs, live)).unwrap()
}

fn request_json(
    batch: usize,
    ids: &[(String, String)],
    docs: &BTreeMap<String, String>,
    live: Option<Option<&str>>,
) -> serde_json::Value {
    let mut request = serde_json::json!({
        "filters": by_ids_filters(ids),
        "sortMethod": "CREATED_AT",
        "sortDirection": "DESC",
        "limit": ids.len(),
    });
    if let Some(since) = live {
        request["baseline"] = ids
            .iter()
            .map(|(id, created)| {
                serde_json::json!({ "key": format!("GraphqlSoupChannel:{id}"), "sortTimestamp": created })
            })
            .collect();
        request["liveQuery"] = serde_json::json!({
            "id": format!("channels-by-ids-{batch}"),
            "document": docs[CHANNEL_LIST],
            "fragmentName": "ChannelListItemFields",
            "since": since,
        });
    }
    request
}

/// Every channel the seed writes, as (id, createdAt), in seed order.
fn channels(seed: &[Op]) -> Vec<(String, String)> {
    seed.iter()
        .filter(|op| op.lane == "channels")
        .flat_map(|op| op.data["user"]["soup"]["items"].as_array().unwrap().iter())
        .map(|item| {
            (
                item["id"].as_str().unwrap().to_owned(),
                item["createdAt"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

/// `ChannelListSoup`, the query each by-ID batch sends.
fn channel_list_document(docs: &BTreeMap<String, String>) -> String {
    format!(
        "query ChannelListSoup($input: SoupInput!) {{ user {{ id emailLinks @cacheOnly {{ id emailAddress photoUrl }} soup(input: $input) {{ items {{ ...ChannelListItemFields }} nextCursor }} }} }}\n{}",
        docs[CHANNEL_LIST]
    )
}

/// A by-ID batch's network answer, which the app writes: the channel list
/// fragment's unread fields, which no backfill lane selects, so a live view
/// over channels has no complete rows before it.
fn by_ids_response(seed: &[Op], batch: usize, ids: &[(String, String)]) -> Op {
    let page = seed.iter().find(|op| op.lane == "channels").unwrap();
    let items: BTreeMap<&str, &serde_json::Value> = seed
        .iter()
        .filter(|op| op.lane == "channels")
        .flat_map(|op| op.data["user"]["soup"]["items"].as_array().unwrap())
        .map(|item| (item["id"].as_str().unwrap(), item))
        .collect();
    let items: Vec<_> = ids
        .iter()
        .map(|(id, _)| {
            let mut item = items[id.as_str()].clone();
            item["unreadNotifications"] = serde_json::json!([]);
            item["unreadMentions"] = serde_json::json!([]);
            item
        })
        .collect();
    let user = &seed[0].data["user"];
    let links: Vec<_> = user["emailLinks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|link| serde_json::json!({ "id": link["id"], "emailAddress": link["emailAddress"], "photoUrl": link["photoUrl"] }))
        .collect();
    Op {
        lane: format!("channels-by-ids-{batch}"),
        write: true,
        doc: "ChannelListSoup".to_owned(),
        operation_name: "ChannelListSoup".to_owned(),
        variables: serde_json::from_value(serde_json::json!({ "input": { "initial": {
            "filters": by_ids_filters(ids),
            "sortMethod": "CREATED_AT",
            "limit": ids.len(),
        } } }))
        .unwrap(),
        data: serde_json::json!({ "user": { "id": user["id"], "emailLinks": links, "soup": { "items": items, "nextCursor": null } } }),
        ..page.clone()
    }
}

/// One write as the app sends it, with what it replies.
async fn write(
    handle: &EngineHandle,
    docs: &BTreeMap<String, String>,
    op: &Op,
    identity: &str,
) -> WriteResultWire {
    stamped(handle, identity)
        .await
        .write(WriteRequest {
            origin_op_id: None,
            registration: None,
            query: docs[&op.doc].clone(),
            operation_name: Some(op.operation_name.clone()),
            variables: op.variables.clone(),
            data: op.data.clone(),
            identity: Some(identity.to_owned()),
        })
        .await
        .unwrap()
}

/// One channel page written again with one channel renamed: a channel list
/// refetch that changed one row.
fn one_channel_changed(seed: &[Op], round: usize) -> Op {
    let page = seed.iter().find(|op| op.lane == "channels").unwrap();
    let mut data = page.data.clone();
    data["user"]["soup"]["items"][round % 100]["displayName"] =
        serde_json::json!(format!("renamed {round}"));
    Op {
        write: true,
        data,
        ..page.clone()
    }
}

/// An op as the dataset files spell it, for the browser bench.
fn op_json(op: &Op) -> serde_json::Value {
    serde_json::json!({
        "lane": op.lane,
        "op": if op.write { "write" } else { "hydrate" },
        "doc": op.doc,
        "operationName": op.operation_name,
        "variables": op.variables,
        "data": op.data,
    })
}

/// Writes what the browser bench replays (`bench-harness.ts` `channelPass`)
/// into `<out>`: the views' requests, the by-ID answers, and per round the
/// unrelated and one-channel writes, so both engines measure the same bytes.
fn dump(
    out: &std::path::Path,
    seed: &[Op],
    foreground: &[Op],
    batches: &[&[(String, String)]],
    docs: &BTreeMap<String, String>,
    rounds: usize,
) {
    std::fs::create_dir_all(out).unwrap();
    let requests: Vec<_> = batches
        .iter()
        .enumerate()
        .map(|(batch, ids)| request_json(batch, ids, docs, Some(None)))
        .collect();
    std::fs::write(
        out.join("requests.json"),
        serde_json::to_vec(&requests).unwrap(),
    )
    .unwrap();
    let lines = |ops: Vec<Op>| {
        ops.iter()
            .map(|op| serde_json::to_string(&op_json(op)).unwrap() + "\n")
            .collect::<String>()
    };
    let by_ids = batches
        .iter()
        .enumerate()
        .map(|(batch, ids)| by_ids_response(seed, batch, ids))
        .collect();
    std::fs::write(out.join("by-ids.ndjson"), lines(by_ids)).unwrap();
    let unrelated: Vec<&Op> = foreground
        .iter()
        .filter(|op| op.lane == "home-refresh")
        .collect();
    let writes = (0..rounds)
        .flat_map(|round| {
            [
                Op {
                    lane: "unrelated".to_owned(),
                    ..unrelated[round % unrelated.len()].clone()
                },
                Op {
                    lane: "one_channel".to_owned(),
                    ..one_channel_changed(seed, round)
                },
            ]
        })
        .collect();
    std::fs::write(out.join("writes.ndjson"), lines(writes)).unwrap();
}

#[test]
#[ignore = "benchmark: needs CACHE_BENCH_DATA, a `cache-bench generate --tier chat` dataset"]
fn native_channel_batches_bench() {
    let data = PathBuf::from(std::env::var_os("CACHE_BENCH_DATA").expect("CACHE_BENCH_DATA"));
    let rounds: usize = std::env::var_os("CACHE_BENCH_RUNS")
        .map_or(5, |runs| runs.to_str().unwrap().parse().unwrap());
    let mut docs: BTreeMap<String, String> =
        serde_json::from_slice(&std::fs::read(data.join("docs.json")).unwrap()).unwrap();
    docs.insert("ChannelListSoup".to_owned(), channel_list_document(&docs));
    let seed = ops(&data.join("seed.ndjson"));
    let foreground = ops(&data.join("foreground.ndjson"));
    let identity = seed[0].data["user"]["id"].as_str().unwrap().to_owned();
    let all = channels(&seed);
    let batches: Vec<&[(String, String)]> = all.chunks(BATCH_SIZE).collect();
    if let Some(out) = std::env::var_os("CACHE_BENCH_CHANNEL_DUMP") {
        dump(
            std::path::Path::new(&out),
            &seed,
            &foreground,
            &batches,
            &docs,
            rounds,
        );
        return;
    }
    let dir = data.join("native-channels");
    let path = dir.join("cache.turso");
    let seeded = path.exists();
    if !seeded {
        std::fs::create_dir_all(&dir).unwrap();
    }

    block_on(async {
        let mut samples = Samples::default();
        // `CACHE_BENCH_HOT=<records>` caps the hot tier (the browser keeps 2,500).
        let handle = match std::env::var_os("CACHE_BENCH_HOT") {
            Some(hot) => {
                let storage = cache_turso::TursoFileDatabase::new(&path)
                    .unwrap()
                    .open(super::bench::SCOPE)
                    .unwrap();
                EngineHandle::with_schema(
                    storage,
                    Some(hot.to_str().unwrap().parse().unwrap()),
                    cache_core::meta::bundled_schema(),
                )
            }
            None => open(&path),
        };
        if !seeded {
            let started = Mark::now();
            for op in &seed {
                apply(&handle, &docs, op, &identity).await;
            }
            samples.record("seed.total", started);
            for (batch, ids) in batches.iter().enumerate() {
                apply(
                    &handle,
                    &docs,
                    &by_ids_response(&seed, batch, ids),
                    &identity,
                )
                .await;
            }
        }
        let unrelated: Vec<&Op> = foreground
            .iter()
            .filter(|op| op.lane == "home-refresh")
            .collect();
        let rss_open = live_kb();
        // Tauri parses an invoke body with serde_json's default recursion limit.
        let ipc_parse = serde_json::from_str::<serde_json::Value>(
            &serde_json::to_string(&by_ids_filters(batches[0])).unwrap(),
        )
        .map(|_| "ok".to_owned())
        .unwrap_or_else(|error| error.to_string());

        for (batch, ids) in batches.iter().enumerate() {
            let started = Mark::now();
            let result = handle
                .entity_filter(request(batch, ids, &docs, None))
                .await
                .unwrap();
            samples.record("channels.exact", started);
            let result = serde_json::to_value(result).unwrap();
            assert_eq!(result["kind"], "complete", "batch {batch}: {result}");
            assert_eq!(result["keys"].as_array().unwrap().len(), ids.len());
        }
        // Writes before any view is retained: the floor the views add to.
        for round in 0..rounds {
            let started = Mark::now();
            apply(
                &handle,
                &docs,
                unrelated[round % unrelated.len()],
                &identity,
            )
            .await;
            samples.record("write.unrelated.no_views", started);
        }

        let rss_before_views = live_kb();
        let mut revisions = Vec::new();
        // The rows a first read sends, as JSON: what each view retains to diff.
        let mut view_row_bytes = 0;
        let mut observations = Vec::new();
        for (batch, ids) in batches.iter().enumerate() {
            let started = Mark::now();
            let result = handle
                .entity_filter(request(batch, ids, &docs, Some(None)))
                .await
                .unwrap();
            samples.record("channels.live.first", started);
            let result = serde_json::to_value(result).unwrap();
            assert_eq!(result["kind"], "live-query", "batch {batch}: {result}");
            assert_eq!(result["keys"].as_array().unwrap().len(), ids.len());
            revisions.push(result["revision"].as_str().unwrap().to_owned());
            view_row_bytes += serde_json::to_string(&result["upserts"]).unwrap().len();
            observations.push(result["observationId"].as_str().unwrap().to_owned());
        }
        let rss_views = live_kb();

        let mut proven = BTreeMap::<&str, Vec<usize>>::new();
        let mut reread_rows = BTreeMap::<&str, Vec<usize>>::new();
        let mut views_read = BTreeMap::<&str, Vec<usize>>::new();
        // `CACHE_BENCH_IGNORE_PROOF=1` reads every view after a changing write, as
        // a bundle older than the proof-reading page reader does on a newer engine.
        let ignore_proof = std::env::var_os("CACHE_BENCH_IGNORE_PROOF").is_some();
        for round in 0..rounds {
            for step in ["unrelated", "one_channel"] {
                let op = match step {
                    "unrelated" => unrelated[round % unrelated.len()].clone(),
                    _ => one_channel_changed(&seed, round),
                };
                // As the page does on the push that follows: the write says which
                // views it left as they were, and every other view reads again.
                // A write that changed nothing sends no push.
                let push_started = Mark::now();
                let started = Mark::now();
                let written = write(&handle, &docs, &op, &identity).await;
                samples.record(&format!("write.{step}"), started);
                let unchanged = written.unchanged_views.unwrap_or_default();
                proven.entry(step).or_default().push(
                    observations
                        .iter()
                        .filter(|id| unchanged.contains(id))
                        .count(),
                );
                let all_started = Mark::now();
                let mut rows = 0;
                let mut reads = 0;
                for (batch, ids) in batches.iter().enumerate() {
                    if !written.revision_advanced
                        || (!ignore_proof && unchanged.contains(&observations[batch]))
                    {
                        continue;
                    }
                    reads += 1;
                    let started = Mark::now();
                    let result = handle
                        .entity_filter(request(batch, ids, &docs, Some(Some(&revisions[batch]))))
                        .await
                        .unwrap();
                    samples.record(&format!("channels.live.reread.{step}"), started);
                    let result = serde_json::to_value(result).unwrap();
                    assert_eq!(result["kind"], "live-query", "batch {batch}: {result}");
                    rows += result["upserts"].as_array().unwrap().len()
                        + result["patches"].as_array().unwrap().len();
                    revisions[batch] = result["revision"].as_str().unwrap().to_owned();
                    observations[batch] = result["observationId"].as_str().unwrap().to_owned();
                }
                samples.record(&format!("push.reads.{step}"), all_started);
                samples.record(&format!("push.total.{step}"), push_started);
                reread_rows.entry(step).or_default().push(rows);
                views_read.entry(step).or_default().push(reads);
            }
        }
        // A second set of views under other ids: what each retained view holds.
        let rss_before_second = live_kb();
        for (batch, ids) in batches.iter().enumerate() {
            let mut second = request(batch, ids, &docs, Some(None));
            if let Some(live) = second.live_query.as_mut() {
                live.id = format!("second-{batch}");
            }
            handle.entity_filter(second).await.unwrap();
        }
        let rss_second = live_kb();
        let hot = handle.inner.lock().await.engine.hot_tier_size();
        handle.shutdown().unwrap();
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "runtime": "native",
                "channels": all.len(),
                "batches": batches.len(),
                "rounds": rounds,
                "ipcParse": ipc_parse,
                "steps": samples.summary(),
                "io": samples.io_summary(),
                "viewsProvenUnchanged": proven,
                "rowsChangedOnReread": reread_rows,
                "viewsRead": views_read,
                "memory": {
                    "rssOpenKb": rss_open,
                    "rssBeforeViewsKb": rss_before_views,
                    "rssWithViewsKb": rss_views,
                    "viewRowJsonKb": view_row_bytes / 1024,
                    "rssBeforeSecondViewsKb": rss_before_second,
                    "rssWithSecondViewsKb": rss_second,
                    "hotRecords": hot.records,
                    "hotKb": hot.bytes / 1024,
                    "peakRssKb": memory_kb("VmHWM"),
                },
            }))
            .unwrap()
        );
    });
}
