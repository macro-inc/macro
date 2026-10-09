//! Prints worker-side costs of keyed list splices and derived membership.
//! Ignored by default; run in release mode:
//! `cargo test --release -p cache-core --test membership_timing -- --ignored --nocapture`
//!
//! - Splices: a watched Soup page re-read after one insert, removal or move,
//!   published as list splices or as a replacement of the list.
//! - Derived favorites: a full read of a derived list, and the cost of one
//!   pushed favorite for N watched derived lists.

use cache_core::engine::watch_query::{QueryUpdate, WatchOptions};
use cache_core::engine::{Engine, ReadResult};
use cache_core::revision::CacheRevision;
use cache_core::store::InMemoryStorage;
use pollster::block_on;
use serde_json::{Map, Value as Json, json};
use std::time::{Duration, Instant};

const PAGE: &str = r#"
query Page($input: SoupInput!) {
  user { id soup(input: $input) { items {
    __typename id frecencyScore
    ... on GraphqlSoupDocument {
      documentName: name ownerId fileType projectId createdAt updatedAt viewedAt deletedAt
      subType { __typename ... on GraphqlTaskSubType { isCompleted } }
      properties { id propertyDefinitionId displayName dataType isMultiSelect value {
        __typename
        ... on GraphqlSelectOptionPropertyValue { optionIds }
        ... on GraphqlStringPropertyValue { value }
      } }
    }
  } nextCursor } }
}"#;
const FAVORITES: &str = "query Favorites($filter: FavoritesFilterInput) { user { id favorites(filter: $filter) { __typename id entityType entityId sortOrder createdAt fileType documentSubType channelType channelId } } }";
const PUSH: &str = "mutation Push { setFavorite { favorite { __typename id entityType entityId sortOrder createdAt fileType documentSubType channelType channelId } } }";
const SAMPLES: usize = 101;

fn micros(mut samples: Vec<Duration>) -> f64 {
    samples.sort();
    samples[samples.len() / 2].as_secs_f64() * 1e6
}

fn median(mut samples: Vec<usize>) -> usize {
    samples.sort();
    samples[samples.len() / 2]
}

fn revision(update: &QueryUpdate) -> CacheRevision {
    match update {
        QueryUpdate::Hit { revision, .. }
        | QueryUpdate::Patch { revision, .. }
        | QueryUpdate::Miss { revision } => revision.parse().unwrap(),
    }
}

fn row(id: usize) -> Json {
    json!({
        "__typename": "GraphqlSoupDocument", "id": format!("doc-{id}"), "frecencyScore": 0.5,
        "documentName": format!("Document {id}"), "ownerId": "macro|owner@example.com",
        "fileType": "md", "projectId": if id.is_multiple_of(3) { Json::Null } else { json!("project-1") },
        "createdAt": "2026-10-01T00:00:00Z", "updatedAt": "2026-10-02T00:00:00Z",
        "viewedAt": "2026-10-03T00:00:00Z", "deletedAt": null,
        "subType": {"__typename": "GraphqlTaskSubType", "isCompleted": false},
        "properties": [
            {"id": format!("status-{id}"), "propertyDefinitionId": "status", "displayName": "Status",
             "dataType": "SELECT_STRING", "isMultiSelect": false,
             "value": {"__typename": "GraphqlSelectOptionPropertyValue", "optionIds": ["todo"]}},
            {"id": format!("note-{id}"), "propertyDefinitionId": "note", "displayName": "Note",
             "dataType": "STRING", "isMultiSelect": false,
             "value": {"__typename": "GraphqlStringPropertyValue", "value": "note"}}
        ]
    })
}

fn page(ids: &[usize]) -> Json {
    let items: Vec<_> = ids.iter().map(|id| row(*id)).collect();
    json!({"user": {"id": "viewer", "soup": {"items": items, "nextCursor": null}}})
}

fn soup_variables(rows: usize) -> Map<String, Json> {
    json!({"input": {"initial": {"limit": rows + 1}}})
        .as_object()
        .unwrap()
        .clone()
}

/// Membership edits of a list of `rows` items, as the edited id order.
fn edits(rows: usize) -> [(&'static str, Vec<usize>); 3] {
    let base: Vec<usize> = (0..rows).collect();
    let mut insert = base.clone();
    insert.insert(rows / 2, rows);
    let mut remove = base.clone();
    remove.remove(rows / 2);
    let mut moved = base.clone();
    let item = moved.remove(rows / 4);
    moved.insert(3 * rows / 4, item);
    [("insert", insert), ("remove", remove), ("move", moved)]
}

#[test]
#[ignore = "prints timings; run in release mode"]
fn splice_and_replacement_costs() {
    println!("| rows | edit | update | worker: watch_query | encode | payload |");
    println!("|---:|---|---|---:|---:|---:|");
    for rows in [100, 500] {
        for (edit, ids) in edits(rows) {
            for splices in [false, true] {
                block_on(async {
                    let mut engine = Engine::new(InMemoryStorage::new());
                    let variables = soup_variables(rows);
                    let base: Vec<usize> = (0..rows).collect();
                    let options = WatchOptions { splices };
                    let watch = async |engine: &mut Engine<InMemoryStorage>, since| {
                        engine
                            .watch_query_with_options(
                                1,
                                PAGE,
                                None,
                                &variables,
                                &[],
                                since,
                                options,
                            )
                            .await
                            .unwrap()
                    };
                    for initial in [&ids, &base] {
                        engine
                            .write_query(None, PAGE, None, &variables, &page(initial), None)
                            .await
                            .unwrap();
                    }
                    let mut cursor = revision(&watch(&mut engine, None).await);
                    let (mut reads, mut encodes, mut payloads, mut hits) =
                        (Vec::new(), Vec::new(), Vec::new(), 0);
                    for _ in 0..SAMPLES {
                        engine
                            .write_query(None, PAGE, None, &variables, &page(&ids), None)
                            .await
                            .unwrap();
                        let start = Instant::now();
                        let update = watch(&mut engine, Some(cursor)).await;
                        reads.push(start.elapsed());
                        let start = Instant::now();
                        let encoded = serde_json::to_string(&update).unwrap();
                        encodes.push(start.elapsed());
                        payloads.push(encoded.len());
                        // A replacement of most of the result is resent whole.
                        if matches!(update, QueryUpdate::Hit { .. }) {
                            hits += 1;
                        }
                        // Revert untimed.
                        engine
                            .write_query(None, PAGE, None, &variables, &page(&base), None)
                            .await
                            .unwrap();
                        cursor = revision(&watch(&mut engine, Some(revision(&update))).await);
                    }
                    let kind = match (splices, hits) {
                        (true, 0) => "splice",
                        (false, 0) => "replace list",
                        (_, SAMPLES) => "full result",
                        _ => "mixed",
                    };
                    println!(
                        "| {rows} | {edit} | {kind} | {:.1} µs | {:.1} µs | {} B |",
                        micros(reads),
                        micros(encodes),
                        median(payloads),
                    );
                });
            }
        }
    }
}

fn favorite(id: usize, sort: f64) -> Json {
    json!({
        "__typename": "GraphqlFavorite", "id": format!("document:fav-{id}"),
        "entityType": if id.is_multiple_of(5) { "CHANNEL" } else { "DOCUMENT" },
        "entityId": format!("fav-{id}"), "sortOrder": sort,
        "createdAt": "2026-10-01T00:00:00Z", "fileType": "md",
        "documentSubType": null, "channelType": null, "channelId": null
    })
}

async fn seed_favorites(engine: &mut Engine<InMemoryStorage>, count: usize, filter: &Json) {
    let favorites: Vec<_> = (0..count).map(|id| favorite(id, id as f64)).collect();
    engine
        .write_query(
            None,
            FAVORITES,
            None,
            json!({"filter": filter}).as_object().unwrap(),
            &json!({"user": {"id": "viewer", "favorites": favorites}}),
            None,
        )
        .await
        .unwrap();
}

async fn push(engine: &mut Engine<InMemoryStorage>, id: usize, sort: f64) {
    engine
        .write_query(
            None,
            PUSH,
            None,
            &Map::new(),
            &json!({"setFavorite": {"favorite": favorite(id, sort)}}),
            None,
        )
        .await
        .unwrap();
}

#[test]
#[ignore = "prints timings; run in release mode"]
fn derived_favorites_costs() {
    println!("| favorites | case | worker: read_query |");
    println!("|---:|---|---:|");
    for count in [50, 500] {
        block_on(async {
            let mut engine = Engine::new(InMemoryStorage::new());
            let all = json!(null);
            seed_favorites(&mut engine, count, &all).await;
            let variables = json!({"filter": null}).as_object().unwrap().clone();
            let read = async |engine: &mut Engine<InMemoryStorage>| {
                let start = Instant::now();
                let result = engine
                    .read_query(None, FAVORITES, None, &variables)
                    .await
                    .unwrap();
                let elapsed = start.elapsed();
                assert!(matches!(result, ReadResult::Hit { .. }));
                elapsed
            };
            // Nothing changed after the evidence: one pass, no derivation work.
            let mut samples = Vec::new();
            for _ in 0..SAMPLES {
                // A revision change discards the per-revision memo.
                push(&mut engine, 100_000, -1.0).await;
                seed_favorites(&mut engine, count, &all).await;
                samples.push(read(&mut engine).await);
            }
            println!(
                "| {count} | evidence only (no child changed since) | {:.1} µs |",
                micros(samples)
            );
            // One pushed favorite: derive, then a second pass with it inserted.
            let mut samples = Vec::new();
            for sample in 0..SAMPLES {
                seed_favorites(&mut engine, count, &all).await;
                push(&mut engine, count + sample, count as f64 / 2.0 + 0.5).await;
                samples.push(read(&mut engine).await);
            }
            println!(
                "| {count} | one favorite pushed after the evidence | {:.1} µs |",
                micros(samples)
            );
            // Another read at the same revision reuses the derived list.
            let mut samples = Vec::new();
            for _ in 0..SAMPLES {
                samples.push(read(&mut engine).await);
            }
            println!(
                "| {count} | same revision again (memoized) | {:.1} µs |",
                micros(samples)
            );
        });
    }

    println!();
    println!(
        "| watched lists | favorites | worker: push write | worker: all watch updates | per list |"
    );
    println!("|---:|---:|---:|---:|---:|");
    for lists in [1, 10, 50] {
        block_on(async {
            let count = 50;
            let mut engine = Engine::new(InMemoryStorage::new());
            // Distinct filters, like a sidebar list plus per-entity lists.
            let filters: Vec<Json> = (0..lists)
                .map(|index| match index {
                    0 => json!(null),
                    1 => json!({"entityTypes": ["DOCUMENT"]}),
                    _ => json!({"entityIds": [format!("fav-{index}"), "pushed"]}),
                })
                .collect();
            for filter in &filters {
                seed_favorites(&mut engine, count, filter).await;
            }
            let variables: Vec<_> = filters
                .iter()
                .map(|filter| json!({"filter": filter}).as_object().unwrap().clone())
                .collect();
            let mut cursors = Vec::new();
            for (op, variables) in variables.iter().enumerate() {
                let update = engine
                    .watch_query_with_options(
                        op as u64,
                        FAVORITES,
                        None,
                        variables,
                        &[],
                        None,
                        WatchOptions { splices: true },
                    )
                    .await
                    .unwrap();
                cursors.push(revision(&update));
            }
            let (mut writes, mut updates) = (Vec::new(), Vec::new());
            for sample in 0..SAMPLES {
                let start = Instant::now();
                push(&mut engine, count + sample, sample as f64 + 0.5).await;
                writes.push(start.elapsed());
                let start = Instant::now();
                for (op, variables) in variables.iter().enumerate() {
                    let update = engine
                        .watch_query_with_options(
                            op as u64,
                            FAVORITES,
                            None,
                            variables,
                            &[],
                            Some(cursors[op]),
                            WatchOptions { splices: true },
                        )
                        .await
                        .unwrap();
                    cursors[op] = revision(&update);
                }
                updates.push(start.elapsed());
            }
            let per_list = micros(updates.clone()) / lists as f64;
            println!(
                "| {lists} | {count} | {:.1} µs | {:.1} µs | {per_list:.1} µs |",
                micros(writes),
                micros(updates),
            );
        });
    }
}
