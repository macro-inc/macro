use super::*;
use crate::shell::salvage::wipe_keeping_queue;
use cache_turso::SalvageFile;
use std::cell::Cell;

const UUID: &str = "00000000-0000-4000-8000-000000000011";

fn side_file(scope: &str) -> String {
    format!("{}-salvage", database_identity(scope))
}

async fn owner(scope: &str) -> OpfsOwner {
    OpfsOwner::acquire(&database_identity(scope))
        .await
        .expect("owner")
}

async fn read_side_file(scope: &str) -> Vec<u8> {
    let owner = owner(scope).await;
    let bytes = owner.sidecar().read().await.expect("side file");
    owner.release().await.expect("release");
    bytes
}

async fn write_side_file(scope: &str, bytes: &[u8]) {
    let owner = owner(scope).await;
    owner.sidecar().write_tail(0, bytes).await.expect("write");
    owner.release().await.expect("release");
}

/// A closed database of one account that queues one mutation.
async fn closed_with_queue(scope: &str) {
    let engine = fresh_engine(scope).await;
    resolved(engine.write_query(
        write_context(None),
        PROPERTY_QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        js(property_base()),
        Some("user-1".into()),
    ))
    .await;
    queue_one_mutation(&engine).await;
    resolved(engine.close()).await;
}

/// Wipes as an engine does that dies before it opens the next database.
async fn wipe_and_die(scope: &str) {
    let owner = owner(scope).await;
    let Ok((owner, _)) = wipe_keeping_queue(scope, owner).await else {
        panic!("wipe keeps the queue")
    };
    owner.release().await.expect("release");
}

async fn open(scope: &str, recovery: bool) -> (CacheEngine, &'static str, serde_json::Value) {
    let (engine, outcome, queue) = open_cache_inner(scope.into(), None, recovery, None, false)
        .await
        .expect("open");
    let queue = serde_json::json!([queue.outcome.as_str(), queue.kept, queue.dropped]);
    (engine, outcome.as_str(), queue)
}

async fn depth(engine: &CacheEngine) -> String {
    let diagnostics = resolved(engine.queue_diagnostics()).await;
    js_sys::Reflect::get(&diagnostics, &JsValue::from_str("depth"))
        .expect("depth")
        .as_string()
        .expect("depth is text")
}

/// The whole queue is there, under its account, and can be sent.
async fn assert_kept(engine: &CacheEngine, scope: &str) {
    assert_eq!(depth(engine).await, "1");
    assert!(!opfs_file_exists(&side_file(scope)).await);
    let identity: Option<String> = from_js(resolved(engine.bound_identity()).await);
    assert_eq!(identity.as_deref(), Some("user-1"));
    let claimed = claim(engine).await;
    assert_eq!(claimed["uuid"], UUID, "{claimed}");
}

/// Claims once every earlier lease has ended.
async fn claim(engine: &CacheEngine) -> serde_json::Value {
    thread_local!(static NOW: Cell<f64> = const { Cell::new(100.0) });
    let now = NOW.replace(NOW.get() + 100.0);
    from_js(resolved(engine.claim_next_mutation("next".into(), now, now + 50.0)).await)
}

#[wasm_bindgen_test(async)]
async fn a_recovery_open_keeps_the_queue_and_wipes_the_rest() {
    const SCOPE: &str = "cache-wasm-salvage-recovery";
    closed_with_queue(SCOPE).await;
    let (engine, outcome, queue) = open(SCOPE, true).await;
    assert_eq!(outcome, "reset-storage-uncertain");
    assert_eq!(queue, serde_json::json!(["kept", 1, 0]));
    let read: serde_json::Value = from_js(
        resolved(engine.read_query(
            None,
            PROPERTY_QUERY.into(),
            Some("Soup".into()),
            js(variables()),
            JsValue::UNDEFINED,
        ))
        .await,
    );
    assert_eq!(read["kind"], "miss");
    assert_kept(&engine, SCOPE).await;
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_queue_survives_an_engine_that_dies_at_any_step_of_the_wipe() {
    const SCOPE: &str = "cache-wasm-salvage-deaths";
    for recovery in [false, true] {
        // After the copy, before the wipe.
        closed_with_queue(SCOPE).await;
        wipe_and_die(SCOPE).await;
        let copy = read_side_file(SCOPE).await;
        assert!(!copy.is_empty());
        closed_with_queue(SCOPE).await;
        write_side_file(SCOPE, &copy).await;
        let (engine, _, _) = open(SCOPE, recovery).await;
        assert_kept(&engine, SCOPE).await;
        resolved(engine.close()).await;

        // During the copy.
        closed_with_queue(SCOPE).await;
        write_side_file(SCOPE, &copy[..copy.len() - 1]).await;
        let (engine, _, _) = open(SCOPE, recovery).await;
        assert_kept(&engine, SCOPE).await;
        resolved(engine.close()).await;

        // During the wipe, which leaves one file of the pair.
        destroy_cache(SCOPE.into()).await.expect("destroy");
        remove_opfs_file(&database_identity(SCOPE)).await;
        write_side_file(SCOPE, &copy).await;
        let (engine, _, queue) = open(SCOPE, recovery).await;
        assert_eq!(queue, serde_json::json!(["kept", 1, 0]));
        assert_kept(&engine, SCOPE).await;
        resolved(engine.close()).await;

        // After the wipe, once and again.
        closed_with_queue(SCOPE).await;
        wipe_and_die(SCOPE).await;
        wipe_and_die(SCOPE).await;
        let (engine, _, queue) = open(SCOPE, recovery).await;
        assert_eq!(queue, serde_json::json!(["kept", 1, 0]));
        assert_kept(&engine, SCOPE).await;
        resolved(engine.close()).await;

        // After the import, before the copy is gone.
        write_side_file(SCOPE, &copy).await;
        let (engine, _, _) = open(SCOPE, recovery).await;
        assert_kept(&engine, SCOPE).await;
        close_and_destroy(&engine, SCOPE).await;
    }
}

#[wasm_bindgen_test(async)]
async fn a_settled_write_never_comes_back_from_a_copy() {
    const SCOPE: &str = "cache-wasm-salvage-settled";
    for recovery in [false, true] {
        closed_with_queue(SCOPE).await;
        wipe_and_die(SCOPE).await;
        let copy = read_side_file(SCOPE).await;
        let (engine, _, _) = open(SCOPE, false).await;
        let claimed = claim(&engine).await;
        resolved(
            engine.rollback_optimistic_write(
                claimed["transactionId"].as_str().expect("id").into(),
                "next".into(),
                claimed["leaseGeneration"]
                    .as_str()
                    .expect("generation")
                    .into(),
            ),
        )
        .await;
        assert_eq!(depth(&engine).await, "0");
        resolved(engine.close()).await;
        write_side_file(SCOPE, &copy).await;
        let (engine, _, _) = open(SCOPE, recovery).await;
        assert_eq!(depth(&engine).await, "0");
        assert!(!opfs_file_exists(&side_file(SCOPE)).await);
        close_and_destroy(&engine, SCOPE).await;
    }
}

#[wasm_bindgen_test(async)]
async fn a_latched_reset_keeps_the_queue_for_the_next_open() {
    const SCOPE: &str = "cache-wasm-salvage-latched";
    closed_with_queue(SCOPE).await;
    let (engine, _, _) = open(SCOPE, false).await;
    resolved(engine.invalidate_keys(vec!["GraphqlSoupDocument:any".into()])).await;
    engine.arm_storage_fault(TestStorageFault::GetBatch).await;
    assert_reset_required(engine.read_query(
        None,
        PROPERTY_QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        JsValue::UNDEFINED,
    ))
    .await;
    resolved(engine.close()).await;
    assert!(opfs_file_exists(&side_file(SCOPE)).await);
    let (engine, _, queue) = open(SCOPE, false).await;
    assert_eq!(queue, serde_json::json!(["kept", 1, 0]));
    assert_kept(&engine, SCOPE).await;
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_queue_that_keeps_ending_the_engine_is_given_up() {
    const SCOPE: &str = "cache-wasm-salvage-attempts";
    for (attempts, survives) in [(2, true), (3, false)] {
        // Reads that never came back.
        closed_with_queue(SCOPE).await;
        write_side_file(SCOPE, &SalvageFile::read_attempt().repeat(attempts)).await;
        let (engine, _, queue) = open(SCOPE, true).await;
        if survives {
            assert_eq!(queue, serde_json::json!(["kept", 1, 0]));
            assert_kept(&engine, SCOPE).await;
        } else {
            assert_eq!(queue, serde_json::json!(["unreadable", 0, 0]));
            assert_eq!(depth(&engine).await, "0");
        }
        assert!(!opfs_file_exists(&side_file(SCOPE)).await);
        resolved(engine.close()).await;

        // Imports that never came back.
        closed_with_queue(SCOPE).await;
        wipe_and_die(SCOPE).await;
        let mut copy = read_side_file(SCOPE).await;
        copy.extend(SalvageFile::import_attempt().repeat(attempts));
        write_side_file(SCOPE, &copy).await;
        let (engine, _, queue) = open(SCOPE, false).await;
        if survives {
            assert_kept(&engine, SCOPE).await;
        } else {
            assert_eq!(queue, serde_json::json!(["abandoned", 0, 1]));
            assert_eq!(depth(&engine).await, "0");
        }
        assert!(!opfs_file_exists(&side_file(SCOPE)).await);
        close_and_destroy(&engine, SCOPE).await;
    }
}

#[wasm_bindgen_test(async)]
async fn deliberate_wipes_take_the_copy_too() {
    const SCOPE: &str = "cache-wasm-salvage-deliberate";
    closed_with_queue(SCOPE).await;
    wipe_and_die(SCOPE).await;
    let copy = read_side_file(SCOPE).await;
    destroy_cache(SCOPE.into()).await.expect("destroy");
    assert!(!opfs_file_exists(&side_file(SCOPE)).await);

    closed_with_queue(SCOPE).await;
    let (engine, _, _) = open(SCOPE, false).await;
    resolved(engine.physical_reset()).await;
    assert_eq!(depth(&engine).await, "0");
    resolved(engine.close()).await;

    // An older build's database stays while its queue is still on its way.
    let older = format!("{}:s0.v0.t3", legacy_cache_database_name(SCOPE));
    remove_opfs_pair(&older).await;
    move_opfs_pair(&database_identity(SCOPE), &older).await;
    let owner = OpfsOwner::acquire(&older).await.expect("older owner");
    owner.sidecar().write_tail(0, &copy).await.expect("copy");
    owner.release().await.expect("release");
    assert_eq!(
        stale_cleanup(SCOPE, &older).await,
        serde_json::json!({ "outcome": "queued-mutations", "queuedMutations": 1 })
    );
    let owner = OpfsOwner::acquire(&older).await.expect("older owner");
    owner.sidecar().remove().await.expect("remove");
    owner.release().await.expect("release");
    assert_eq!(
        stale_cleanup(SCOPE, &older).await,
        serde_json::json!({ "outcome": "removed" })
    );
    remove_opfs_pair(&database_identity(SCOPE)).await;
}
