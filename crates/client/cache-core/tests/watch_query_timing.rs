//! Prints the worker-side cost of watched document queries on Soup-like pages:
//! leaf edits, structural edits, journal barriers and retained memory. Ignored
//! by default; run in release mode:
//! `cargo test --release -p cache-core --test watch_query_timing -- --ignored --nocapture`

use cache_core::engine::watch_query::QueryUpdate;
use cache_core::engine::{Engine, ReadResult};
use cache_core::identity::DELETED_FIELD;
use cache_core::revision::CacheRevision;
use cache_core::store::InMemoryStorage;
use cache_core::value::{CacheValue, EntityKey, Record};
use pollster::block_on;
use serde_json::{Map, Value as Json, json};
use std::alloc::{GlobalAlloc, Layout, System};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::time::{Duration, Instant};

/// Tracks live heap bytes so the harness can report what a watch retains.
struct Counting;

static LIVE_BYTES: AtomicIsize = AtomicIsize::new(0);

// SAFETY: every method delegates to `System` with the caller's arguments.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        LIVE_BYTES.fetch_add(layout.size() as isize, Ordering::Relaxed);
        // SAFETY: forwarded unchanged from the caller.
        unsafe { System.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        LIVE_BYTES.fetch_add(layout.size() as isize, Ordering::Relaxed);
        // SAFETY: forwarded unchanged from the caller.
        unsafe { System.alloc_zeroed(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE_BYTES.fetch_sub(layout.size() as isize, Ordering::Relaxed);
        // SAFETY: forwarded unchanged from the caller.
        unsafe { System.dealloc(ptr, layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        LIVE_BYTES.fetch_add(
            new_size as isize - layout.size() as isize,
            Ordering::Relaxed,
        );
        // SAFETY: forwarded unchanged from the caller.
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

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
const SAMPLES: usize = 200;
const INITIAL_SAMPLES: usize = 40;
const OP: u64 = 1;

fn variables(rows: usize) -> Map<String, Json> {
    json!({"input": {"initial": {"limit": rows}}})
        .as_object()
        .unwrap()
        .clone()
}

fn page(rows: usize) -> Json {
    let items: Vec<_> = (0..rows)
        .map(|i| {
            json!({
                "__typename": "GraphqlSoupDocument",
                "id": format!("doc-{i}"),
                "frecencyScore": 0.5,
                "documentName": format!("Document {i}"),
                "ownerId": "macro|owner@example.com",
                "fileType": "md",
                "projectId": if i % 3 == 0 { Json::Null } else { json!("project-1") },
                "createdAt": "2026-10-01T00:00:00Z",
                "updatedAt": "2026-10-02T00:00:00Z",
                "viewedAt": "2026-10-03T00:00:00Z",
                "deletedAt": null,
                "subType": {"__typename": "GraphqlTaskSubType", "isCompleted": false},
                "properties": [
                    {
                        "id": format!("status-{i}"), "propertyDefinitionId": "status",
                        "displayName": "Status", "dataType": "SELECT_STRING", "isMultiSelect": false,
                        "value": {"__typename": "GraphqlSelectOptionPropertyValue", "optionIds": ["todo"]}
                    },
                    {
                        "id": format!("note-{i}"), "propertyDefinitionId": "note",
                        "displayName": "Note", "dataType": "STRING", "isMultiSelect": false,
                        "value": {"__typename": "GraphqlStringPropertyValue", "value": "note"}
                    }
                ]
            })
        })
        .collect();
    json!({"user": {"id": "viewer", "soup": {"items": items, "nextCursor": null}}})
}

fn document(row: usize) -> EntityKey<'static> {
    EntityKey::entity("GraphqlSoupDocument", &[&format!("doc-{row}")])
}

fn property(id: &str) -> EntityKey<'static> {
    EntityKey::entity("GraphqlProperty", &[id])
}

fn string(value: &str) -> CacheValue {
    CacheValue::String(value.into())
}

fn options(ids: &[&str]) -> CacheValue {
    CacheValue::Object(BTreeMap::from([
        (
            "__typename".into(),
            string("GraphqlSelectOptionPropertyValue"),
        ),
        (
            "optionIds".into(),
            CacheValue::List(ids.iter().map(|id| string(id)).collect()),
        ),
    ]))
}

fn assignments(row: usize, extra: bool) -> CacheValue {
    let mut ids = vec![format!("status-{row}"), format!("note-{row}")];
    if extra {
        ids.push(format!("extra-{row}"));
    }
    CacheValue::List(ids.iter().map(|id| CacheValue::Ref(property(id))).collect())
}

async fn put(
    engine: &mut Engine<InMemoryStorage>,
    key: EntityKey<'static>,
    fields: Vec<(&str, CacheValue)>,
) {
    let fields = fields
        .into_iter()
        .map(|(field, value)| (field.to_owned(), value))
        .collect();
    engine
        .put_records_with_projections(None, vec![(key, Record { fields })], vec![])
        .await
        .unwrap();
}

fn revision(update: &QueryUpdate) -> CacheRevision {
    match update {
        QueryUpdate::Hit { revision, .. }
        | QueryUpdate::Patch { revision, .. }
        | QueryUpdate::Miss { revision } => revision.parse().unwrap(),
    }
}

fn micros(mut samples: Vec<Duration>) -> f64 {
    samples.sort();
    samples[samples.len() / 2].as_secs_f64() * 1e6
}

fn median(mut samples: Vec<usize>) -> usize {
    samples.sort();
    samples[samples.len() / 2]
}

/// One untimed change before a timed watched read.
enum Step {
    Put(EntityKey<'static>, &'static str, CacheValue),
    /// A journal barrier, as when another engine changed shared storage.
    Invalidate(EntityKey<'static>),
}

struct Watched {
    rows: usize,
    cursor: CacheRevision,
}

impl Watched {
    /// Applies `edit` untimed, then times one watched read and its encoding.
    async fn time(
        &mut self,
        engine: &mut Engine<InMemoryStorage>,
        case: &str,
        edit: impl Fn(usize) -> Vec<Step>,
    ) {
        let (mut reads, mut encodes, mut payloads, mut hits) =
            (Vec::new(), Vec::new(), Vec::new(), 0);
        for sample in 0..SAMPLES {
            for step in edit(sample) {
                match step {
                    Step::Put(key, field, value) => put(engine, key, vec![(field, value)]).await,
                    Step::Invalidate(key) => {
                        engine.invalidate_keys([&key]).unwrap();
                    }
                }
            }
            let start = Instant::now();
            let update = engine
                .watch_query(
                    OP,
                    PAGE,
                    None,
                    &variables(self.rows),
                    &[],
                    Some(self.cursor),
                )
                .await
                .unwrap();
            reads.push(start.elapsed());
            self.cursor = revision(&update);
            let start = Instant::now();
            let encoded = serde_json::to_string(&update).unwrap();
            encodes.push(start.elapsed());
            payloads.push(encoded.len());
            match update {
                QueryUpdate::Hit { .. } => hits += 1,
                QueryUpdate::Patch { .. } => {}
                QueryUpdate::Miss { .. } => panic!("{case}: seeded page must not miss"),
            }
        }
        let kind = match hits {
            0 => "patch",
            SAMPLES => "hit",
            _ => "mixed",
        };
        println!(
            "| {} | {case} | {kind} | {:.1} µs | {:.1} µs | {} B |",
            self.rows,
            micros(reads),
            micros(encodes),
            median(payloads),
        );
    }

    /// Brings the subscriber up to date without timing.
    async fn sync(&mut self, engine: &mut Engine<InMemoryStorage>) {
        let update = engine
            .watch_query(
                OP,
                PAGE,
                None,
                &variables(self.rows),
                &[],
                Some(self.cursor),
            )
            .await
            .unwrap();
        self.cursor = revision(&update);
    }
}

#[test]
#[ignore = "prints timings; run in release mode"]
fn watch_query_costs() {
    println!("| rows | case | update | worker: watch_query | encode update | payload |");
    println!("|---:|---|---|---:|---:|---:|");
    let mut summary = Vec::new();
    for rows in [100, 500] {
        block_on(async {
            let mut engine = Engine::new(InMemoryStorage::new());
            let variables = variables(rows);
            engine
                .write_query(None, PAGE, None, &variables, &page(rows), None)
                .await
                .unwrap();
            for row in 0..rows {
                let id = format!("extra-{row}");
                put(
                    &mut engine,
                    property(&id),
                    vec![
                        ("__typename", string("GraphqlProperty")),
                        ("id", string(&id)),
                        ("propertyDefinitionId", string("extra")),
                        ("displayName", string("Extra")),
                        ("dataType", string("SELECT_STRING")),
                        ("isMultiSelect", CacheValue::Bool(false)),
                        ("value", options(&["added"])),
                    ],
                )
                .await;
            }

            let mut reads = Vec::new();
            let mut encodes = Vec::new();
            for _ in 0..SAMPLES {
                let start = Instant::now();
                let result = engine
                    .read_query(None, PAGE, None, &variables)
                    .await
                    .unwrap();
                reads.push(start.elapsed());
                let ReadResult::Hit { data } = result else {
                    panic!("seeded page must hit");
                };
                let start = Instant::now();
                std::hint::black_box(serde_json::to_string(&data).unwrap());
                encodes.push(start.elapsed());
            }

            let mut initial = Vec::new();
            for sample in 0..INITIAL_SAMPLES {
                let op = 1_000 + sample as u64;
                let start = Instant::now();
                let update = engine
                    .watch_query(op, PAGE, None, &variables, &[], None)
                    .await
                    .unwrap();
                initial.push(start.elapsed());
                drop(update);
                engine.teardown_operation(op);
            }
            let before = LIVE_BYTES.load(Ordering::Relaxed);
            let first = engine
                .watch_query(OP, PAGE, None, &variables, &[], None)
                .await
                .unwrap();
            let cursor = revision(&first);
            let hit_bytes = serde_json::to_string(&first).unwrap().len();
            drop(first);
            let retained = LIVE_BYTES.load(Ordering::Relaxed) - before;
            summary.push(format!(
                "| {rows} | {:.1} µs | {:.1} µs | {:.1} µs | {hit_bytes} B | {:.0} KiB |",
                micros(reads),
                micros(encodes),
                micros(initial),
                retained as f64 / 1024.0,
            ));

            let mut watched = Watched { rows, cursor };
            let row = |sample: usize| sample * 7 % rows;
            let rename = |key, prefix: &str, sample: usize| {
                Step::Put(
                    key,
                    "name",
                    CacheValue::String(format!("{prefix} {sample}")),
                )
            };
            watched
                .time(&mut engine, "leaf: row field", |sample| {
                    vec![rename(document(row(sample)), "Renamed", sample)]
                })
                .await;
            watched
                .time(&mut engine, "leaf: nested property", |sample| {
                    let id = format!("status-{}", row(sample));
                    let value = options(&[&format!("option-{sample}")]);
                    vec![Step::Put(property(&id), "value", value)]
                })
                .await;
            watched
                .time(&mut engine, "unrelated record", |sample| {
                    let key = EntityKey::entity("GraphqlSoupDocument", &["unrelated"]);
                    vec![rename(key, "Unrelated", sample)]
                })
                .await;
            watched
                .time(&mut engine, "link: add / remove an assignment", |sample| {
                    let target = row(sample / 2);
                    let links = assignments(target, sample % 2 == 0);
                    vec![Step::Put(document(target), "properties", links)]
                })
                .await;
            watched
                .time(&mut engine, "barrier: leaf edit + invalidation", |sample| {
                    let key = document(row(sample));
                    vec![
                        rename(key.clone(), "Barrier", sample),
                        Step::Invalidate(key),
                    ]
                })
                .await;
            watched
                .time(&mut engine, "tombstone / restore an item", |sample| {
                    let deleted = CacheValue::Bool(sample % 2 == 0);
                    vec![Step::Put(document(row(sample / 2)), DELETED_FIELD, deleted)]
                })
                .await;
            put(
                &mut engine,
                document(0),
                vec![(DELETED_FIELD, CacheValue::Bool(true))],
            )
            .await;
            watched.sync(&mut engine).await;
            watched
                .time(
                    &mut engine,
                    "leaf: row field, list has a tombstone",
                    |sample| {
                        vec![rename(
                            document(1 + row(sample) % (rows - 1)),
                            "After",
                            sample,
                        )]
                    },
                )
                .await;
        });
    }
    println!();
    println!(
        "| rows | full read_query | encode result | initial watch (Hit) | Hit payload | retained by first watch |"
    );
    println!("|---:|---:|---:|---:|---:|---:|");
    for line in summary {
        println!("{line}");
    }
}
