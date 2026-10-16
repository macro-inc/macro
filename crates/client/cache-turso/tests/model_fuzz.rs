//! The core's independent oracle also runs against real filesystem storage.
#![cfg(not(target_arch = "wasm32"))]

#[path = "../../cache-core/tests/support/optimistic_model.rs"]
mod optimistic_model;

use cache_turso::{TursoFileDatabase, TursoStorageCloseOutcome};
use pollster::block_on;
use proptest::prelude::*;

proptest! {
    #[test]
    fn filesystem_optimistic_queries_match_the_reference_model(
        capacity in 1usize..9,
        actions in proptest::collection::vec(optimistic_model::action(), 1..41),
    ) {
        block_on(async {
            let directory = tempfile::tempdir().unwrap();
            let database = TursoFileDatabase::new(directory.path().join("model.turso")).unwrap();
            let engine = optimistic_model::run(
                database.open("model").unwrap(),
                |_| database.open("model").unwrap(),
                capacity,
                actions,
            ).await;
            assert_eq!(engine.into_storage().try_close().unwrap(), TursoStorageCloseOutcome::Healthy);
        });
    }
}
