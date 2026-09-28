//! Production GraphQL query benchmarks over the native Turso adapter.
#[path = "browser_fixtures.rs"]
mod browser_fixtures;
#[path = "corpus.rs"]
mod corpus;
#[path = "measurement.rs"]
mod measurement;
#[path = "population.rs"]
mod population;
#[path = "population_native.rs"]
mod population_native;

use cache_core::engine::{Engine, ReadResult};
use cache_core::store::Storage;
use cache_turso::TursoStorage;
use clap::Parser;
use corpus::{Fixture, Query};
use measurement::{Databases, Options, Report};
use pollster::block_on;
use std::{hint::black_box, path::Path};

#[derive(Parser)]
struct Arguments {
    #[command(flatten)]
    options: Options,
    /// Export the same validated fixtures for the browser worker benchmark.
    #[arg(long)]
    export_browser: Option<std::path::PathBuf>,
}

fn read(
    engine: &mut Engine<TursoStorage>,
    query: &Query,
    fixture: &Fixture,
    registered: bool,
) -> serde_json::Value {
    match block_on(engine.read_query(
        registered.then_some(1),
        &query.document,
        Some(&query.name),
        &fixture.variables,
    ))
    .unwrap()
    {
        ReadResult::Hit { data } => data,
        ReadResult::Miss => panic!("{} unexpectedly missed", query.name),
    }
}

fn write(engine: &mut Engine<TursoStorage>, query: &Query, fixture: &Fixture) {
    black_box(
        block_on(engine.write_query(
            None,
            &query.document,
            Some(&query.name),
            &fixture.variables,
            &fixture.data,
            None,
        ))
        .unwrap(),
    );
}

fn read_records(
    engine: &mut Engine<TursoStorage>,
    selection: &cache_core::record_selection::RecordSelection,
    keys: &[cache_core::value::EntityKey<'static>],
) -> Vec<cache_core::record_selection::SelectedRecord> {
    keys.chunks(population::BATCH_SIZE)
        .flat_map(|batch| {
            block_on(engine.read_records_by_keys(selection, batch))
                .unwrap()
                .value
        })
        .collect()
}

pub fn run() {
    let arguments = Arguments::parse();
    let options = arguments.options;
    options.validate();
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let databases = Databases::new(options.disk);
    let queries = corpus::queries(&root);
    let record_queries = corpus::record_queries(&root);
    if let Some(directory) = arguments.export_browser {
        browser_fixtures::export(&directory, &options, &queries, &record_queries);
        return;
    }
    let inventory = queries.iter().chain(&record_queries).collect::<Vec<_>>();
    let mut report = Report::new("native-core-turso", &options, &inventory);
    if !options.cache_records.is_empty() {
        population_native::run(&options, &queries, &record_queries, &databases, &mut report);
        report.finish(&options);
        return;
    }
    for query in &queries {
        if !query.name.contains(&options.filter) {
            continue;
        }
        for &size in &options.sizes {
            let fixture = corpus::fixture(query, size, 0);
            let mut engine = Engine::new(databases.open());
            write(&mut engine, query, &fixture);
            assert_eq!(
                read(&mut engine, query, &fixture, true),
                fixture.data,
                "{} round trip",
                query.name
            );
            for mode in ["hot", "hot-registered", "hot-json"] {
                report.measure(query, size, fixture.records, mode, || {
                    let data = read(&mut engine, query, &fixture, mode != "hot");
                    if mode == "hot-json" {
                        black_box(
                            serde_json::to_vec(&serde_json::json!({"kind": "hit", "data": data}))
                                .unwrap(),
                        );
                    } else {
                        black_box(data);
                    }
                });
            }
            let resolvers = corpus::entity_resolvers();
            report.measure(query, size, fixture.records, "hot-resolvers", || {
                let result = block_on(engine.read_query_with_entity_resolvers(
                    Some(1),
                    &query.document,
                    Some(&query.name),
                    &fixture.variables,
                    &resolvers,
                ))
                .unwrap();
                assert!(matches!(result, ReadResult::Hit { .. }));
                black_box(result);
            });
            report.measure(query, size, fixture.records, "unchanged-write", || {
                write(&mut engine, query, &fixture)
            });
            let cold = std::cell::RefCell::new(Some(engine));
            report.measure_with_setup(
                query,
                size,
                fixture.records,
                "cold-engine",
                || {
                    let engine = cold.borrow_mut().take().unwrap();
                    Engine::new(engine.into_storage())
                },
                |mut engine| {
                    let data = read(&mut engine, query, &fixture, true);
                    *cold.borrow_mut() = Some(engine);
                    black_box(data);
                },
            );
            let mut pressured = Engine::with_capacity(databases.open(), 16);
            write(&mut pressured, query, &fixture);
            report.measure(query, size, fixture.records, "capacity-16", || {
                black_box(read(&mut pressured, query, &fixture, true));
            });
            let mut empty = Engine::new(databases.open());
            report.measure(query, size, 0, "miss", || {
                assert!(matches!(
                    block_on(empty.read_query(
                        Some(1),
                        &query.document,
                        Some(&query.name),
                        &fixture.variables
                    ))
                    .unwrap(),
                    ReadResult::Miss
                ));
            });
            for &variants in options
                .variants
                .iter()
                .filter(|_| corpus::has_argument_variants(query))
            {
                let mut variants_engine = Engine::new(databases.open());
                for variant in 0..variants {
                    write(
                        &mut variants_engine,
                        query,
                        &corpus::fixture(query, size, variant),
                    );
                }
                assert_eq!(
                    read(&mut variants_engine, query, &fixture, true),
                    fixture.data
                );
                report.measure(
                    query,
                    size,
                    fixture.records,
                    &format!("variants-{variants}"),
                    || {
                        black_box(read(&mut variants_engine, query, &fixture, true));
                    },
                );
            }
        }
    }
    for query in &record_queries {
        if !query.name.contains(&options.filter) {
            continue;
        }
        for &size in &options.sizes {
            let fixture = corpus::record_fixture(query, size);
            report.read_requests(size.div_ceil(population::BATCH_SIZE));
            let keys: Vec<_> = fixture
                .expected
                .iter()
                .map(|record| record.record_key.clone())
                .collect();
            let mut storage = databases.open();
            block_on(storage.put_batch(fixture.records.clone().into_iter().collect())).unwrap();
            let mut engine = Engine::new(storage);
            assert_eq!(
                read_records(&mut engine, &fixture.selection, &keys),
                fixture.expected
            );
            report.measure(query, size, fixture.records.len(), "records-hot", || {
                black_box(read_records(&mut engine, &fixture.selection, &keys));
            });
            report.measure(query, size, fixture.records.len(), "records-parse", || {
                let selection = cache_core::record_selection::RecordSelection::parse(
                    &query.document,
                    &query.name,
                )
                .unwrap();
                black_box(read_records(&mut engine, &selection, &keys));
            });
        }
    }
    report.finish(&options);
}
