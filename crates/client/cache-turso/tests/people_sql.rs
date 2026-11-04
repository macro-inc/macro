#![cfg(not(target_arch = "wasm32"))]
#[path = "common/people_sql.rs"]
mod people_sql;
use cache_core::engine::Engine;
use cache_turso::{TursoFileDatabase, TursoStorage};
use pollster::block_on;

#[test]
fn local_people_queries_filter_aggregate_and_limit_before_materialization() {
    block_on(async {
        let storage = TursoStorage::open_in_memory("local-people-sql").unwrap();
        let mut engine = Engine::with_capacity(storage, 16);
        let scope = people_sql::seed(&mut engine, 1_000).await;
        people_sql::contract(engine, &scope, 1_000).await;
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
        people_sql::contract(engine, &scope, 100_000).await;
        eprintln!("100k local SQL reopen and contract: {:?}", start.elapsed());
    });
}
