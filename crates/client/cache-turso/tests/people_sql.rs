#![cfg(not(target_arch = "wasm32"))]
#[path = "common/contact_sync.rs"]
mod contact_sync;
#[path = "common/name_search.rs"]
mod name_search;
#[path = "common/people_sql.rs"]
mod people_sql;

#[test]
fn indexed_name_windows_match_the_streaming_reference() {
    block_on(async {
        let mut engine =
            Engine::with_capacity(TursoStorage::open_in_memory("name-windows").unwrap(), 16);
        let scope = people_sql::seed(&mut engine, 1_000).await;
        name_search::contract(&mut engine, &scope).await;
    });
}

#[test]
fn authoritative_contact_removal_rejects_stale_writes_and_survives_reopening() {
    block_on(async {
        contact_sync::contract(TursoStorage::open_in_memory("contact-sync").unwrap()).await;
    });
}
use cache_core::engine::Engine;
use cache_turso::{TursoFileDatabase, TursoStorage};
use pollster::block_on;

#[test]
fn local_people_queries_filter_aggregate_and_limit_before_materialization() {
    block_on(async {
        let storage = TursoStorage::open_in_memory("local-people-sql").unwrap();
        let mut engine = Engine::with_capacity(storage, 16);
        let scope = people_sql::seed(&mut engine, 1_000).await;
        let engine = people_sql::contract(engine, &scope, 1_000).await;
        contact_sync::verify(engine, &scope, 1_000).await;
    });
}

#[test]
#[ignore = "100k real local SQL execution and persisted reopen"]
fn local_people_sql_100k() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let database = TursoFileDatabase::new(directory.path().join("people-sql.db")).unwrap();
        let mut engine = Engine::with_capacity(database.open("local-people-sql").unwrap(), 16);
        let start = std::time::Instant::now();
        let scope = people_sql::seed(&mut engine, 100_000).await;
        eprintln!("100k local SQL hydration: {:?}", start.elapsed());
        let start = std::time::Instant::now();
        let engine = people_sql::contract(engine, &scope, 100_000).await;
        eprintln!("100k local SQL contract: {:?}", start.elapsed());
        drop(engine);
        let start = std::time::Instant::now();
        let engine = Engine::with_capacity(database.open("local-people-sql").unwrap(), 16);
        let engine = people_sql::contract(engine, &scope, 100_000).await;
        eprintln!("100k local SQL reopen and contract: {:?}", start.elapsed());
        let start = std::time::Instant::now();
        contact_sync::verify(engine, &scope, 100_000).await;
        eprintln!("100k bounded verification/deletion: {:?}", start.elapsed());
    });
}
