//! The channel timeline's reference model also runs against real filesystem
//! storage, reopened on every reload.
#![cfg(not(target_arch = "wasm32"))]

#[path = "../../cache-core/tests/support/channel_device.rs"]
mod channel_device;
#[path = "../../cache-core/tests/support/channel_model.rs"]
mod channel_model;
#[path = "../../cache-core/tests/support/channel_server.rs"]
mod channel_server;

use cache_turso::{TursoFileDatabase, TursoStorage, TursoStorageCloseOutcome};
use channel_model::Violation;
use pollster::block_on;
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn no_order_of_answers_leaves_a_deleted_message_or_a_gap_on_disk(
        ops in proptest::collection::vec(channel_model::op(), 1..80),
    ) {
        let directory = tempfile::tempdir().unwrap();
        let database = TursoFileDatabase::new(directory.path().join("model.turso")).unwrap();
        let reopen = |storage: TursoStorage| {
            assert_eq!(storage.try_close().unwrap(), TursoStorageCloseOutcome::Healthy);
            database.open("model").unwrap()
        };
        let outcome = block_on(channel_model::run(database.open("model").unwrap(), reopen, &ops));
        if let Err(Violation { wrong, detail }) = outcome {
            return Err(TestCaseError::fail(format!("{wrong:?}: {detail}")));
        }
    }
}
