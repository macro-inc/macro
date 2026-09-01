use super::*;
use cache_core::store::Storage;
use cache_core::value::EntityKey;
use turso_opfs::{OpenResult, OpfsOwner};
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_dedicated_worker);

fn key(value: &str) -> EntityKey<'static> {
    EntityKey(value.to_owned().into())
}

#[cfg(feature = "browser-test-hooks")]
#[wasm_bindgen_test(async)]
async fn browser_corrupt_queue_hook_preserves_queue_bindings() {
    let owner = OpfsOwner::acquire("cache-turso-browser-corrupt-queue.db")
        .await
        .unwrap()
        .recovery_wipe()
        .await
        .unwrap();
    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("recovery wipe must produce a complete fresh pair")
    };
    let mut storage =
        TursoStorage::from_opfs_session(session.connect().unwrap(), "browser-corrupt-queue")
            .unwrap();
    storage.browser_test_corrupt_queue_payload().unwrap();
    assert_eq!(
        storage
            .load_mutation_queue()
            .await
            .unwrap_err()
            .physical_reset_reason(),
        Some(PhysicalResetReason::Codec)
    );
    let TursoStorageCloseOutcome::ResetRequired(closed) = storage.try_close().unwrap() else {
        panic!("corrupt queue payload must require reset")
    };
    closed.reset().await.unwrap().release().await.unwrap();
}

#[wasm_bindgen_test(async)]
async fn runtime_corruption_closes_reset_only_and_replacement_is_empty() {
    let owner = OpfsOwner::acquire("cache-turso-wp06-runtime-reset.db")
        .await
        .unwrap()
        .recovery_wipe()
        .await
        .unwrap();
    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("recovery wipe must produce a complete fresh pair")
    };
    let storage =
        TursoStorage::from_opfs_session(session.connect().unwrap(), "runtime-reset").unwrap();
    driver::execute(
        &storage.connection(),
        RECORD_UPSERT,
        vec![text("Thing"), text("1"), Value::from_blob(vec![0xff])],
    )
    .unwrap();
    assert_eq!(
        storage
            .get_batch(&[key("Thing:1")])
            .await
            .unwrap_err()
            .physical_reset_reason(),
        Some(PhysicalResetReason::Codec)
    );
    assert_eq!(
        storage
            .load_mutation_queue()
            .await
            .unwrap_err()
            .physical_reset_reason(),
        Some(PhysicalResetReason::Codec)
    );

    let TursoStorageCloseOutcome::ResetRequired(closed) = storage.try_close().unwrap() else {
        panic!("runtime corruption must make preservation unavailable")
    };
    assert_eq!(closed.reason(), PhysicalResetReason::Codec);
    let owner = closed.reset().await.unwrap();
    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("physical reset must recreate a complete pair")
    };
    let replacement =
        TursoStorage::from_opfs_session(session.connect().unwrap(), "runtime-reset").unwrap();
    assert_eq!(
        replacement.get_batch(&[key("Thing:1")]).await.unwrap(),
        vec![None]
    );
    let TursoStorageCloseOutcome::Healthy(closed) = replacement.try_close().unwrap() else {
        panic!("fresh replacement must be healthy")
    };
    closed.preserve().unwrap().release().await.unwrap();
}
