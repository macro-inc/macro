//! Cache-population scaling, holding each operation's returned data fixed.
use super::{
    corpus,
    measurement::{Databases, Options, Report},
    population,
};
use cache_core::{
    document::Document,
    engine::{DEFAULT_HOT_CAPACITY, Engine, ReadResult},
    normalize::normalize,
    record_selection::{RecordSelection, SelectedRecord},
    store::Storage,
    value::EntityKey,
};
use pollster::block_on;
use serde_json::{Map, Value};
use std::{cell::RefCell, hint::black_box};

#[derive(Debug, PartialEq)]
enum Data {
    Query(Value),
    Records(Vec<SelectedRecord>),
}

pub fn run(
    options: &Options,
    queries: &[corpus::Query],
    fragments: &[corpus::Query],
    databases: &Databases,
    report: &mut Report,
) {
    let background_selection = RecordSelection::parse(
        "fragment Background on GraphqlSoupDocument { __typename id name createdAt updatedAt }",
        "Background",
    )
    .unwrap();
    let read_background = |engine: &mut Engine<cache_turso::TursoStorage>,
                           keys: &[EntityKey<'static>]| {
        for batch in keys.chunks(population::BATCH_SIZE) {
            let result =
                block_on(engine.read_records_by_keys(&background_selection, batch)).unwrap();
            assert_eq!(result.value.len(), batch.len());
            black_box(result);
        }
    };
    for (fragment, catalog) in [(false, queries), (true, fragments)] {
        for query in catalog
            .iter()
            .filter(|query| query.name.contains(&options.filter))
        {
            for &size in &options.sizes {
                report.read_requests(if fragment {
                    size.div_ceil(population::BATCH_SIZE)
                } else {
                    1
                });
                let (base, variables, expected, selection, keys) = if fragment {
                    let fixture = corpus::record_fixture(query, size);
                    let keys = fixture
                        .expected
                        .iter()
                        .map(|item| item.record_key.clone())
                        .collect::<Vec<_>>();
                    (
                        fixture.records,
                        Map::new(),
                        Data::Records(fixture.expected),
                        Some(fixture.selection),
                        keys,
                    )
                } else {
                    let fixture = corpus::fixture(query, size, 0);
                    let document = Document::parse(&query.document).unwrap();
                    let records = normalize(
                        document.operation(Some(&query.name)).unwrap(),
                        &fixture.variables,
                        &fixture.data,
                    )
                    .unwrap();
                    (
                        records,
                        fixture.variables,
                        Data::Query(fixture.data),
                        None,
                        Vec::new(),
                    )
                };
                let base_keys: Vec<_> = base.keys().cloned().collect();
                let resolvers = corpus::entity_resolvers();
                let read = |engine: &mut Engine<cache_turso::TursoStorage>| -> Data {
                    if let Some(selection) = &selection {
                        let mut records = Vec::new();
                        for batch in keys.chunks(population::BATCH_SIZE) {
                            records.extend(
                                block_on(engine.read_records_by_keys(selection, batch))
                                    .unwrap()
                                    .value,
                            );
                        }
                        assert_eq!(records.len(), size);
                        Data::Records(records)
                    } else {
                        match block_on(engine.read_query_with_entity_resolvers(
                            Some(1),
                            &query.document,
                            Some(&query.name),
                            &variables,
                            &resolvers,
                        ))
                        .unwrap()
                        {
                            ReadResult::Hit { data } => Data::Query(data),
                            ReadResult::Miss => panic!("{} unexpectedly missed", query.name),
                        }
                    }
                };
                for &target in &options.cache_records {
                    let scaffold = population::records(&population::batches(1)[0])
                        .keys()
                        .filter(|key| !base.contains_key(*key))
                        .count()
                        - 1;
                    assert!(
                        target > base.len() + scaffold,
                        "{} size {size} does not fit {target} cache records",
                        query.name
                    );
                    let count = target - base.len() - scaffold;
                    let mut records = base.clone();
                    for batch in population::batches(count) {
                        for (key, record) in population::records(&batch) {
                            records.entry(key).or_default().merge(record);
                        }
                    }
                    assert_eq!(records.len(), target);
                    let all_keys: Vec<_> = records.keys().cloned().collect();
                    let mut storage = databases.open();
                    block_on(storage.put_batch(records.into_iter().collect())).unwrap();
                    assert_eq!(
                        block_on(storage.get_batch(&all_keys))
                            .unwrap()
                            .iter()
                            .filter(|record| record.is_some())
                            .count(),
                        target
                    );
                    let engine = RefCell::new(Engine::new(storage));
                    let background_keys = population::document_keys(count);
                    read_background(&mut engine.borrow_mut(), &background_keys);
                    assert_eq!(read(&mut engine.borrow_mut()), expected);
                    report.population(target, DEFAULT_HOT_CAPACITY);
                    report.measure(query, size, base.len(), "population-hot", || {
                        black_box(read(&mut engine.borrow_mut()));
                    });
                    report.measure_with_setup(
                        query,
                        size,
                        base.len(),
                        "population-hydrate",
                        || {
                            engine
                                .borrow_mut()
                                .invalidate_keys(base_keys.iter())
                                .unwrap();
                        },
                        |()| {
                            black_box(read(&mut engine.borrow_mut()));
                        },
                    );
                    let engine = RefCell::new(Engine::with_capacity(
                        engine.into_inner().into_storage(),
                        1_000,
                    ));
                    report.population(target, 1_000);
                    report.measure_with_setup(
                        query,
                        size,
                        base.len(),
                        "population-pressure",
                        || {
                            read_background(&mut engine.borrow_mut(), &background_keys);
                        },
                        |()| {
                            black_box(read(&mut engine.borrow_mut()));
                        },
                    );
                    assert_eq!(read(&mut engine.borrow_mut()), expected);
                }
            }
        }
    }
}
