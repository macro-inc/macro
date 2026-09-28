//! Benchmarks the real native EngineHandle, including its mutex and operation interner.
#[path = "../../../../../crates/client/cache-turso/benches/support/corpus.rs"]
mod corpus;
#[path = "../../../../../crates/client/cache-turso/benches/support/measurement.rs"]
mod measurement;

use cache_core::{document::Document, normalize::normalize, store::Storage};
use clap::Parser;
use corpus::{Fixture, Query};
use graphql_cache_plugin::{EngineHandle, ReadResultWire};
use measurement::{Databases, Options, Report};
use pollster::block_on;
use std::{hint::black_box, path::Path};

fn seed(handle_storage: &mut cache_turso::TursoStorage, query: &Query, fixture: &Fixture) {
    let document = Document::parse(&query.document).unwrap();
    let records = normalize(
        document.operation(Some(&query.name)).unwrap(),
        &fixture.variables,
        &fixture.data,
    )
    .unwrap();
    block_on(handle_storage.put_batch(records.into_iter().collect())).unwrap();
}

fn read(
    handle: &EngineHandle,
    query: &Query,
    fixture: &Fixture,
    registered: bool,
) -> ReadResultWire {
    block_on(handle.read(
        registered.then(|| "benchmark:1".to_owned()),
        query.document.clone(),
        Some(query.name.clone()),
        fixture.variables.clone(),
        Vec::new(),
    ))
    .unwrap()
}

fn main() {
    let options = Options::parse();
    options.validate();
    assert!(
        options.cache_records.is_empty(),
        "use the cache-turso benchmark for --cache-records"
    );
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..");
    let queries = corpus::queries(&root);
    let record_queries = corpus::record_queries(&root);
    let databases = Databases::new(options.disk);
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .build()
        .unwrap();
    let inventory = queries.iter().chain(&record_queries).collect::<Vec<_>>();
    let mut report = Report::new("tauri-engine-handle", &options, &inventory);
    for query in &queries {
        if !query.name.contains(&options.filter) {
            continue;
        }
        for &size in &options.sizes {
            let fixture = corpus::fixture(query, size, 0);
            let mut storage = databases.open();
            seed(&mut storage, query, &fixture);
            let handle = EngineHandle::new(storage, None);
            match read(&handle, query, &fixture, true) {
                ReadResultWire::Hit { data } => {
                    assert_eq!(data, fixture.data, "{} round trip", query.name)
                }
                ReadResultWire::Miss => panic!("{} must hit", query.name),
            }
            for mode in ["hot", "hot-registered", "hot-json"] {
                report.measure(query, size, fixture.records, mode, || {
                    let result = read(&handle, query, &fixture, mode != "hot");
                    assert!(matches!(result, ReadResultWire::Hit { .. }));
                    if mode == "hot-json" {
                        black_box(serde_json::to_vec(&result).unwrap());
                    } else {
                        black_box(result);
                    }
                });
            }
            report.measure(query, size, fixture.records, "hot-resolvers", || {
                let result = block_on(handle.read(
                    Some("benchmark:1".into()),
                    query.document.clone(),
                    Some(query.name.clone()),
                    fixture.variables.clone(),
                    corpus::entity_resolvers(),
                ))
                .unwrap();
                assert!(matches!(result, ReadResultWire::Hit { .. }));
                black_box(result);
            });
            let request = serde_json::to_vec(&ReadRequest {
                op_id: Some("benchmark:1".into()),
                query: query.document.clone(),
                operation_name: Some(query.name.clone()),
                variables: fixture.variables.clone(),
                entity_resolvers: corpus::entity_resolvers(),
            })
            .unwrap();
            report.measure(query, size, fixture.records, "ipc-json-codec", || {
                let request: ReadRequest = serde_json::from_slice(&request).unwrap();
                let result = block_on(handle.read(
                    request.op_id,
                    request.query,
                    request.operation_name,
                    request.variables,
                    request.entity_resolvers,
                ))
                .unwrap();
                assert!(matches!(result, ReadResultWire::Hit { .. }));
                black_box(serde_json::to_vec(&result).unwrap());
            });
            report.measure(query, size, fixture.records, "concurrent-8-total", || {
                runtime.block_on(async {
                    let gate = std::sync::Arc::new(tokio::sync::Barrier::new(8));
                    let mut tasks = Vec::new();
                    for client in 0..8 {
                        let handle = handle.clone();
                        let gate = gate.clone();
                        let document = query.document.clone();
                        let name = query.name.clone();
                        let variables = fixture.variables.clone();
                        tasks.push(tokio::spawn(async move {
                            gate.wait().await;
                            let result = handle
                                .read(
                                    Some(format!("client-{client}:1")),
                                    document,
                                    Some(name),
                                    variables,
                                    corpus::entity_resolvers(),
                                )
                                .await
                                .unwrap();
                            assert!(matches!(result, ReadResultWire::Hit { .. }));
                            black_box(result);
                        }));
                    }
                    for task in tasks {
                        task.await.unwrap();
                    }
                });
            });
            handle.shutdown().unwrap();
            for &variants in options
                .variants
                .iter()
                .filter(|_| corpus::has_argument_variants(query))
            {
                let mut engine = cache_core::engine::Engine::new(databases.open());
                for variant in 0..variants {
                    let fixture = corpus::fixture(query, size, variant);
                    block_on(engine.write_query(
                        None,
                        &query.document,
                        Some(&query.name),
                        &fixture.variables,
                        &fixture.data,
                        None,
                    ))
                    .unwrap();
                }
                let handle = EngineHandle::new(engine.into_storage(), None);
                black_box(read(&handle, query, &fixture, true));
                report.measure(
                    query,
                    size,
                    fixture.records,
                    &format!("variants-{variants}"),
                    || {
                        let result = read(&handle, query, &fixture, true);
                        assert!(matches!(result, ReadResultWire::Hit { .. }));
                        black_box(result);
                    },
                );
                handle.shutdown().unwrap();
            }
        }
    }
    for query in &record_queries {
        if !query.name.contains(&options.filter) {
            continue;
        }
        for &size in &options.sizes {
            let fixture = corpus::record_fixture(query, size);
            black_box(&fixture.selection);
            let keys: Vec<_> = fixture
                .expected
                .iter()
                .map(|record| record.record_key.to_string())
                .collect();
            let mut storage = databases.open();
            block_on(storage.put_batch(fixture.records.clone().into_iter().collect())).unwrap();
            let handle = EngineHandle::new(storage, None);
            assert_eq!(
                block_on(handle.read_records_by_keys(
                    query.document.clone(),
                    query.name.clone(),
                    keys.clone()
                ))
                .unwrap()
                .records,
                fixture.expected
            );
            report.measure(query, size, fixture.records.len(), "records-hot", || {
                black_box(
                    block_on(handle.read_records_by_keys(
                        query.document.clone(),
                        query.name.clone(),
                        keys.clone(),
                    ))
                    .unwrap(),
                );
            });
            report.measure(query, size, fixture.records.len(), "records-parse", || {
                black_box(
                    cache_core::record_selection::RecordSelection::parse(
                        &query.document,
                        &query.name,
                    )
                    .unwrap(),
                );
                black_box(
                    block_on(handle.read_records_by_keys(
                        query.document.clone(),
                        query.name.clone(),
                        keys.clone(),
                    ))
                    .unwrap(),
                );
            });
            handle.shutdown().unwrap();
        }
    }
    report.finish(&options);
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadRequest {
    op_id: Option<String>,
    query: String,
    operation_name: Option<String>,
    variables: serde_json::Map<String, serde_json::Value>,
    entity_resolvers: Vec<cache_core::entity_resolver::EntityResolver>,
}
