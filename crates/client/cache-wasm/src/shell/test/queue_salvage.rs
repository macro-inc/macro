use super::*;
use crate::shell::salvage::wipe_keeping_queue;
use cache_turso::{QueueLoss, SalvageFile};
use std::cell::Cell;

const UUID: &str = "00000000-0000-4000-8000-000000000011";

/// Lets no note of a loss into a side file, as on a full disk.
const REFUSE_LOSSES: &str = "const frame = args[0];
    if (frame.byteLength === 22 && frame[12] === 4)
      throw new DOMException('full', 'QuotaExceededError');
    return original(...args);";

fn side_file(scope: &str) -> String {
    format!("{}-salvage", database_identity(scope))
}

async fn owner(scope: &str) -> OpfsOwner {
    OpfsOwner::acquire(&database_identity(scope))
        .await
        .expect("owner")
}

/// Every frame of the side file, without the room it keeps after them.
async fn read_side_file(scope: &str) -> Vec<u8> {
    let mut bytes = read_whole_side_file(scope).await;
    bytes.truncate(SalvageFile::decode(&bytes).end() as usize);
    bytes
}

async fn read_whole_side_file(scope: &str) -> Vec<u8> {
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

/// Writes a side file whose lock an engine holds.
async fn leave_side_file(scope: &str, bytes: &[u8]) {
    let hex = bytes.iter().map(|byte| format!("{byte:02x}"));
    run_js(
        "return (async () => {
          const [file, hex] = name.split('|');
          const root = await navigator.storage.getDirectory();
          const entry = await root.getFileHandle(file, { create: true });
          const handle = await entry.createSyncAccessHandle();
          handle.write(Uint8Array.from(hex.match(/../g), (byte) => parseInt(byte, 16)));
          handle.close();
        })()",
        &format!("{}|{}", side_file(scope), hex.collect::<String>()),
    )
    .await;
}

/// A closed database of one account that queues one mutation.
async fn closed_with_queue(scope: &str) {
    closed_with(scope, UUID).await;
}

async fn closed_with(scope: &str, uuid: &str) {
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
    queue_mutation(&engine, uuid).await;
    resolved(engine.close()).await;
}

/// Lets no queue's frame into a side file, as on a full disk.
async fn refuse_queue_frames(refuse: bool) {
    run_js(
        "return (async () => {
          const handle = FileSystemSyncAccessHandle.prototype;
          if (name === '') { handle.write = handle.writeAnything; return; }
          handle.writeAnything = handle.write;
          handle.write = function (bytes, options) {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const room = bytes.byteLength < 14 ? -1 : bytes.byteLength - 13 - view.getUint32(0, true);
            if ((room === 0 || room === 35) && view.getUint8(12) === 1)
              throw new DOMException('full', 'QuotaExceededError');
            return this.writeAnything(bytes, options);
          };
        })()",
        if refuse { "refuse" } else { "" },
    )
    .await;
}

/// Keeps a side file open, as another context does.
async fn hold_side_file(scope: &str) {
    run_js(
        "return (async () => {
          const root = await navigator.storage.getDirectory();
          const entry = await root.getFileHandle(name, { create: true });
          self.heldSideFile = await entry.createSyncAccessHandle();
        })()",
        &side_file(scope),
    )
    .await;
}

async fn release_side_file() {
    run_js("self.heldSideFile.close(); return Promise.resolve();", "").await;
}

/// Breaks one method of every sync handle of a side file: `body` replaces it
/// and may call `original`. Returns through [`restore_side_files`].
async fn break_side_files(method: &str, body: &str) {
    run_js(
        "return (async () => {
          const [method, body] = name.split('|');
          const files = FileSystemFileHandle.prototype;
          const create = files.createSyncAccessHandle;
          self.restoreSideFiles = () => { files.createSyncAccessHandle = create; };
          const replacement = new Function('original', 'args', body);
          files.createSyncAccessHandle = async function (...options) {
            const handle = await create.apply(this, options);
            if (this.name.endsWith('-salvage')) {
              const original = handle[method].bind(handle);
              handle[method] = (...args) => replacement(original, args);
            }
            return handle;
          };
        })()",
        &format!("{method}|{body}"),
    )
    .await;
}

async fn restore_side_files() {
    run_js("self.restoreSideFiles(); return Promise.resolve();", "").await;
}

/// Changes the closed database behind its owner's back.
async fn change(scope: &str, sql: &str) {
    let owner = owner(scope).await;
    let OpenResult::Ready(session) = owner.open().await.expect("open") else {
        panic!("the pair is whole")
    };
    let connected = session.connect().expect("connect");
    connected.connection().execute(sql).expect("change");
    let closed = connected.try_close().expect("close");
    let owner = closed.preserve().expect("preserve");
    owner.release().await.expect("release");
}

/// Wipes as an engine does that dies before it opens the next database.
async fn wipe_and_die(scope: &str) {
    let owner = owner(scope).await;
    let Ok((owner, _)) = wipe_keeping_queue(scope, owner).await else {
        panic!("wipe keeps the queue")
    };
    owner.release().await.expect("release");
}

/// Dies later: the next database is there, but nothing was imported into it.
async fn wipe_open_and_die(scope: &str) {
    wipe_and_die(scope).await;
    let copy = read_side_file(scope).await;
    write_side_file(scope, &[]).await;
    let (engine, _, _) = open(scope, false).await;
    resolved(engine.close()).await;
    write_side_file(scope, &copy).await;
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

async fn tell(engine: &CacheEngine, scope: &str) {
    resolved(engine.queue_loss_told()).await;
    assert!(!opfs_file_exists(&side_file(scope)).await);
}

/// The whole queue is there, under its account, and can be sent.
async fn assert_kept(engine: &CacheEngine, scope: &str) {
    tell(engine, scope).await;
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
        tell(&engine, SCOPE).await;
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
        tell(&engine, SCOPE).await;
        close_and_destroy(&engine, SCOPE).await;
    }
}

#[wasm_bindgen_test(async)]
async fn a_queue_lost_behind_an_older_copy_is_never_called_kept() {
    const SCOPE: &str = "cache-wasm-salvage-unreadable";
    closed_with_queue(SCOPE).await;
    wipe_and_die(SCOPE).await;
    let mut older = read_side_file(SCOPE).await;
    older.extend(SalvageFile::read_attempt().repeat(3));
    for dies in [false, true] {
        // This database's own queue is never read.
        closed_with_queue(SCOPE).await;
        write_side_file(SCOPE, &older).await;
        if dies {
            wipe_and_die(SCOPE).await;
        }
        let (engine, _, queue) = open(SCOPE, !dies).await;
        assert_eq!(queue, serde_json::json!(["partial", 1, 0]));
        assert_kept(&engine, SCOPE).await;
        close_and_destroy(&engine, SCOPE).await;
    }
}

#[wasm_bindgen_test(async)]
async fn a_wiped_queue_that_left_no_copy_is_never_called_kept() {
    const SCOPE: &str = "cache-wasm-salvage-no-copy";
    closed_with_queue(SCOPE).await;
    wipe_and_die(SCOPE).await;
    let older = read_side_file(SCOPE).await;
    for recovery in [false, true] {
        closed_with(SCOPE, "00000000-0000-4000-8000-000000000012").await;
        write_side_file(SCOPE, &older).await;
        refuse_queue_frames(true).await;
        wipe_and_die(SCOPE).await;
        refuse_queue_frames(false).await;
        let (engine, _, queue) = open(SCOPE, recovery).await;
        assert_eq!(queue, serde_json::json!(["partial", 1, 0]));
        assert_kept(&engine, SCOPE).await;
        close_and_destroy(&engine, SCOPE).await;
    }
}

#[wasm_bindgen_test(async)]
async fn a_wipe_that_left_no_copy_at_all_says_so() {
    const SCOPE: &str = "cache-wasm-salvage-nothing";
    for recovery in [false, true] {
        closed_with_queue(SCOPE).await;
        refuse_queue_frames(true).await;
        wipe_and_die(SCOPE).await;
        refuse_queue_frames(false).await;
        let (engine, _, queue) = open(SCOPE, recovery).await;
        assert_eq!(queue, serde_json::json!(["unreadable", 0, 0]));
        tell(&engine, SCOPE).await;
        close_and_destroy(&engine, SCOPE).await;
    }
}

#[wasm_bindgen_test(async)]
async fn a_queue_wiped_unread_says_so_after_a_death() {
    const SCOPE: &str = "cache-wasm-salvage-unread-death";
    // Reads that never came back.
    closed_with_queue(SCOPE).await;
    write_side_file(SCOPE, &SalvageFile::read_attempt().repeat(3)).await;
    wipe_open_and_die(SCOPE).await;
    let (engine, _, queue) = open(SCOPE, false).await;
    assert_eq!(queue, serde_json::json!(["unreadable", 0, 0]));
    tell(&engine, SCOPE).await;
    resolved(engine.close()).await;

    // A write no build can read.
    closed_with_queue(SCOPE).await;
    change(
        SCOPE,
        "UPDATE optimistic_layers SET normalized_updates = x'ff'",
    )
    .await;
    wipe_open_and_die(SCOPE).await;
    let (engine, _, queue) = open(SCOPE, false).await;
    assert_eq!(queue, serde_json::json!(["unreadable", 0, 1]));
    resolved(engine.close()).await;

    // The death of one that told its own loss is not told again.
    closed_with_queue(SCOPE).await;
    change(
        SCOPE,
        "UPDATE optimistic_layers SET normalized_updates = x'ff'",
    )
    .await;
    let (engine, _, queue) = open(SCOPE, true).await;
    assert_eq!(queue, serde_json::json!(["unreadable", 0, 1]));
    tell(&engine, SCOPE).await;
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_queue_given_up_at_a_wipe_says_so_after_a_death() {
    const SCOPE: &str = "cache-wasm-salvage-given-up-death";
    closed_with_queue(SCOPE).await;
    change(
        SCOPE,
        "INSERT INTO meta (key, value) VALUES ('salvaged-queue', '00000000-0000-0000-0000-000000000000 99 9007199254740991 true')",
    )
    .await;
    wipe_open_and_die(SCOPE).await;
    let (engine, _, queue) = open(SCOPE, false).await;
    assert_eq!(queue, serde_json::json!(["abandoned", 0, 1]));
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_latched_reset_that_could_not_read_the_queue_tells_the_next_open() {
    const SCOPE: &str = "cache-wasm-salvage-latched-loss";
    closed_with_queue(SCOPE).await;
    let (engine, _, _) = open(SCOPE, false).await;
    engine.arm_storage_fault(TestStorageFault::GetBatch).await;
    resolved(engine.invalidate_keys(vec!["GraphqlSoupDocument:any".into()])).await;
    assert_reset_required(engine.read_query(
        None,
        PROPERTY_QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        JsValue::UNDEFINED,
    ))
    .await;
    leave_side_file(SCOPE, &SalvageFile::read_attempt().repeat(3)).await;
    resolved(engine.close()).await;
    let told = read_side_file(SCOPE).await;
    write_side_file(SCOPE, &[]).await;
    let (engine, _, _) = open(SCOPE, false).await;
    resolved(engine.close()).await;
    write_side_file(SCOPE, &told).await;
    let (engine, _, queue) = open(SCOPE, false).await;
    assert_eq!(queue, serde_json::json!(["unreadable", 0, 0]));
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_loss_that_could_not_be_told_is_told_by_every_open_until_it_was() {
    const SCOPE: &str = "cache-wasm-salvage-untold";
    closed_with_queue(SCOPE).await;
    wipe_and_die(SCOPE).await;
    let copy = read_side_file(SCOPE).await;
    let doubted = [copy.clone(), SalvageFile::loss(QueueLoss::default())].concat();
    let given_up = [copy, SalvageFile::import_attempt().repeat(3)].concat();
    let unreadable = ("unreadable", 0);
    let cases = [
        // Reads that never came back.
        (
            Some(SalvageFile::read_attempt().repeat(3)),
            true,
            unreadable,
            unreadable,
        ),
        (Some(doubted), false, ("partial", 0), unreadable),
        (Some(given_up), false, ("abandoned", 1), ("abandoned", 1)),
        // One of the database's files is gone.
        (None, false, unreadable, unreadable),
    ];
    for (file, recovery, first, later) in cases {
        if recovery || file.is_none() {
            closed_with_queue(SCOPE).await;
        }
        match file {
            Some(file) => write_side_file(SCOPE, &file).await,
            None => remove_opfs_file(&database_identity(SCOPE)).await,
        }
        let mut recovery = recovery;
        for (outcome, dropped) in [first, later, later, later, later] {
            let (engine, _, queue) = open(SCOPE, recovery).await;
            assert_eq!((&queue[0], &queue[2]), (&outcome.into(), &dropped.into()));
            resolved(engine.close()).await;
            recovery = false;
        }
        let (engine, _, _) = open(SCOPE, false).await;
        tell(&engine, SCOPE).await;
        resolved(engine.close()).await;
        let (engine, _, queue) = open(SCOPE, false).await;
        assert_eq!(queue, serde_json::json!(["none", 0, 0]));
        close_and_destroy(&engine, SCOPE).await;
    }
}

#[wasm_bindgen_test(async)]
async fn a_loss_nobody_was_told_of_outlives_a_wipe_that_carries_newer_writes() {
    const SCOPE: &str = "cache-wasm-salvage-untold-wipe";
    for (dies, recovery) in [(false, true), (true, false), (true, true)] {
        closed_with_queue(SCOPE).await;
        write_side_file(SCOPE, &SalvageFile::loss(QueueLoss::default())).await;
        if dies {
            wipe_and_die(SCOPE).await;
        }
        let (engine, _, queue) = open(SCOPE, recovery).await;
        assert_eq!(
            queue,
            serde_json::json!(["partial", 1, 0]),
            "{dies} {recovery}"
        );
        assert_kept(&engine, SCOPE).await;
        close_and_destroy(&engine, SCOPE).await;
    }
}

#[wasm_bindgen_test(async)]
async fn a_copy_that_may_have_been_imported_is_never_called_kept_once_its_database_is_torn() {
    const SCOPE: &str = "cache-wasm-salvage-torn";
    closed_with_queue(SCOPE).await;
    wipe_and_die(SCOPE).await;
    let mut copy = read_side_file(SCOPE).await;
    copy.extend(SalvageFile::import_attempt());
    for recovery in [false, true] {
        let (engine, _, _) = open(SCOPE, false).await;
        resolved(engine.close()).await;
        remove_opfs_file(&database_identity(SCOPE)).await;
        write_side_file(SCOPE, &copy).await;
        let (engine, _, queue) = open(SCOPE, recovery).await;
        assert_eq!(queue, serde_json::json!(["partial", 1, 0]));
        assert_kept(&engine, SCOPE).await;
        resolved(engine.close()).await;
    }
    destroy_cache(SCOPE.into()).await.expect("destroy");
}

#[wasm_bindgen_test(async)]
async fn a_copy_of_a_torn_database_is_never_called_kept_when_its_doubt_does_not_fit() {
    const SCOPE: &str = "cache-wasm-salvage-torn-full";
    closed_with_queue(SCOPE).await;
    wipe_and_die(SCOPE).await;
    let mut copy = read_side_file(SCOPE).await;
    copy.extend(SalvageFile::import_attempt());
    for recovery in [false, true] {
        let (engine, _, _) = open(SCOPE, false).await;
        resolved(engine.close()).await;
        remove_opfs_file(&database_identity(SCOPE)).await;
        write_side_file(SCOPE, &copy).await;
        break_side_files("write", REFUSE_LOSSES).await;
        let (engine, _, queue) = open(SCOPE, recovery).await;
        restore_side_files().await;
        assert_eq!(queue, serde_json::json!(["partial", 1, 0]));
        assert_kept(&engine, SCOPE).await;
        resolved(engine.close()).await;
    }
    destroy_cache(SCOPE.into()).await.expect("destroy");
}

#[wasm_bindgen_test(async)]
async fn a_copy_of_a_torn_database_is_never_called_kept_after_a_death() {
    const SCOPE: &str = "cache-wasm-salvage-torn-death";
    closed_with_queue(SCOPE).await;
    wipe_and_die(SCOPE).await;
    let mut copy = read_side_file(SCOPE).await;
    copy.extend(SalvageFile::import_attempt());
    for recovery in [false, true] {
        let (engine, _, _) = open(SCOPE, false).await;
        resolved(engine.close()).await;
        remove_opfs_file(&database_identity(SCOPE)).await;
        write_side_file(SCOPE, &copy).await;
        let owner = owner(SCOPE).await;
        let (owner, crossing) = match recovery {
            true => wipe_keeping_queue(SCOPE, owner)
                .await
                .unwrap_or_else(|_| panic!("wipe")),
            false => (owner, Crossing::default()),
        };
        let sidecar = owner.sidecar();
        let Ok((storage, _, _)) = open_or_wipe(SCOPE, owner, &sidecar, crossing).await else {
            panic!("a fresh database opens")
        };
        release_storage(storage).await.expect("release");
        let (engine, _, queue) = open(SCOPE, false).await;
        assert_eq!(queue, serde_json::json!(["partial", 1, 0]));
        assert_kept(&engine, SCOPE).await;
        resolved(engine.close()).await;
    }
    destroy_cache(SCOPE.into()).await.expect("destroy");
}

#[wasm_bindgen_test(async)]
async fn a_torn_database_says_so_after_a_death_at_creating_its_missing_file() {
    const SCOPE: &str = "cache-wasm-salvage-torn-create";
    closed_with_queue(SCOPE).await;
    let wal = format!("{}-wal", database_identity(SCOPE));
    remove_opfs_file(&wal).await;
    run_js(
        "const directory = FileSystemDirectoryHandle.prototype;
         const original = directory.getFileHandle;
         self.restoreFiles = () => { directory.getFileHandle = original; };
         directory.getFileHandle = async function (file, options) {
           const handle = await original.call(this, file, options);
           if (file === name && options?.create)
             throw new DOMException('died', 'UnknownError');
           return handle;
         };
         return Promise.resolve();",
        &wal,
    )
    .await;
    let died = open_cache_inner(SCOPE.into(), None, false, None, false).await;
    run_js("self.restoreFiles(); return Promise.resolve();", "").await;
    assert!(died.is_err());
    let (engine, _, queue) = open(SCOPE, false).await;
    assert_eq!(queue, serde_json::json!(["unreadable", 0, 0]));
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_torn_database_is_not_opened_while_its_side_file_is_busy() {
    const SCOPE: &str = "cache-wasm-salvage-torn-busy";
    closed_with_queue(SCOPE).await;
    remove_opfs_file(&format!("{}-wal", database_identity(SCOPE))).await;
    hold_side_file(SCOPE).await;
    let busy = open_cache_inner(SCOPE.into(), None, false, None, false).await;
    release_side_file().await;
    assert!(busy.is_err());
    let (engine, _, queue) = open(SCOPE, false).await;
    assert_eq!(queue, serde_json::json!(["unreadable", 0, 0]));
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_torn_database_says_so_after_a_wipe_that_found_it_busy() {
    const SCOPE: &str = "cache-wasm-salvage-torn-wal-busy";
    closed_with_queue(SCOPE).await;
    remove_opfs_file(&database_identity(SCOPE)).await;
    run_js(
        "return (async () => {
          const root = await navigator.storage.getDirectory();
          const entry = await root.getFileHandle(name);
          self.heldWal = await entry.createSyncAccessHandle();
        })()",
        &format!("{}-wal", database_identity(SCOPE)),
    )
    .await;
    let busy = open_cache_inner(SCOPE.into(), None, true, None, false).await;
    run_js("self.heldWal.close(); return Promise.resolve();", "").await;
    assert!(busy.is_err());
    let (engine, _, queue) = open(SCOPE, false).await;
    assert_eq!(queue, serde_json::json!(["unreadable", 0, 0]));
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_torn_database_says_so_when_its_doubt_does_not_fit() {
    const SCOPE: &str = "cache-wasm-salvage-torn-blank";
    for recovery in [false, true] {
        closed_with_queue(SCOPE).await;
        remove_opfs_file(&database_identity(SCOPE)).await;
        break_side_files("write", REFUSE_LOSSES).await;
        let (engine, _, queue) = open(SCOPE, recovery).await;
        restore_side_files().await;
        assert_eq!(queue, serde_json::json!(["unreadable", 0, 0]), "{recovery}");
        close_and_destroy(&engine, SCOPE).await;
    }
}

#[wasm_bindgen_test(async)]
async fn a_loss_nobody_was_told_of_outlives_a_death_before_it_is_noted_behind_newer_writes() {
    const SCOPE: &str = "cache-wasm-salvage-untold-death";
    closed_with_queue(SCOPE).await;
    write_side_file(SCOPE, &SalvageFile::loss(QueueLoss::default())).await;
    break_side_files("write", REFUSE_LOSSES).await;
    wipe_and_die(SCOPE).await;
    restore_side_files().await;
    let (engine, _, queue) = open(SCOPE, false).await;
    assert_eq!(queue, serde_json::json!(["partial", 1, 0]));
    assert_kept(&engine, SCOPE).await;
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_death_between_noting_a_loss_and_ending_the_copy_under_it_queues_nothing_twice() {
    const SCOPE: &str = "cache-wasm-salvage-untold-cut";
    closed_with_queue(SCOPE).await;
    wipe_and_die(SCOPE).await;
    let copy = read_side_file(SCOPE).await;
    let untold = [SalvageFile::loss(QueueLoss::default()), copy.clone()].concat();
    let doubted = [copy, SalvageFile::loss(QueueLoss::default())].concat();
    let skip_ending = "if (args[0] === 22) throw new DOMException('died', 'UnknownError');
        return original(...args);";
    for left in [untold, doubted] {
        let (engine, _, _) = open(SCOPE, false).await;
        resolved(engine.close()).await;
        write_side_file(SCOPE, &left).await;
        let owner = owner(SCOPE).await;
        let sidecar = owner.sidecar();
        break_side_files("truncate", skip_ending).await;
        let noted = sidecar
            .replace(&SalvageFile::loss(QueueLoss::default()))
            .await;
        restore_side_files().await;
        owner.release().await.expect("release");
        assert!(noted.is_err());
        let (engine, _, queue) = open(SCOPE, false).await;
        assert_ne!(queue[0], "none");
        assert_ne!(queue[0], "kept");
        tell(&engine, SCOPE).await;
        assert_eq!(depth(&engine).await, "1");
        resolved(engine.close()).await;
    }
    destroy_cache(SCOPE.into()).await.expect("destroy");
}

#[wasm_bindgen_test(async)]
async fn a_told_loss_that_could_not_be_let_go_of_is_let_go_of_later() {
    const SCOPE: &str = "cache-wasm-salvage-told-busy";
    closed_with_queue(SCOPE).await;
    write_side_file(SCOPE, &SalvageFile::loss(QueueLoss::default())).await;
    let (engine, _, _) = open(SCOPE, false).await;
    hold_side_file(SCOPE).await;
    let told = wasm_bindgen_futures::JsFuture::from(engine.queue_loss_told()).await;
    release_side_file().await;
    assert!(told.is_err());
    tell(&engine, SCOPE).await;
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn telling_leaves_a_queue_that_could_not_be_read() {
    const SCOPE: &str = "cache-wasm-salvage-told-unread";
    closed_with_queue(SCOPE).await;
    wipe_and_die(SCOPE).await;
    break_side_files("read", "throw new DOMException('no', 'NotReadableError');").await;
    run_js(
        "self.removeEntry = FileSystemDirectoryHandle.prototype.removeEntry;
         const create = FileSystemFileHandle.prototype.createSyncAccessHandle;
         self.createAny = create;
         FileSystemFileHandle.prototype.createSyncAccessHandle = async function (...options) {
           const handle = await create.apply(this, options);
           if (this.name.endsWith('-salvage'))
             handle.write = handle.truncate = () => {
               throw new DOMException('full', 'QuotaExceededError');
             };
           return handle;
         };
         FileSystemDirectoryHandle.prototype.removeEntry = async function (file, options) {
           if (file.endsWith('-salvage')) throw new DOMException('no', 'UnknownError');
           return self.removeEntry.call(this, file, options);
         };
         return Promise.resolve();",
        "",
    )
    .await;
    let (engine, _, queue) = open(SCOPE, false).await;
    run_js(
        "FileSystemFileHandle.prototype.createSyncAccessHandle = self.createAny;
         FileSystemDirectoryHandle.prototype.removeEntry = self.removeEntry;
         return Promise.resolve();",
        "",
    )
    .await;
    restore_side_files().await;
    assert_eq!(queue[0], "unreadable");
    resolved(engine.queue_loss_told()).await;
    resolved(engine.close()).await;
    let (engine, _, _) = open(SCOPE, false).await;
    assert_kept(&engine, SCOPE).await;
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_queue_the_database_holds_is_not_given_up_for_the_deaths_that_followed() {
    const SCOPE: &str = "cache-wasm-salvage-held-deaths";
    closed_with_queue(SCOPE).await;
    wipe_and_die(SCOPE).await;
    let mut copy = read_side_file(SCOPE).await;
    let (engine, _, _) = open(SCOPE, false).await;
    resolved(engine.close()).await;
    copy.extend(SalvageFile::import_attempt().repeat(3));
    write_side_file(SCOPE, &copy).await;
    let (engine, _, queue) = open(SCOPE, false).await;
    assert_eq!(queue, serde_json::json!(["none", 0, 0]));
    assert_kept(&engine, SCOPE).await;
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_copy_is_forgotten_before_its_database() {
    const SCOPE: &str = "cache-wasm-salvage-forgotten-first";
    for reset in [false, true] {
        closed_with_queue(SCOPE).await;
        wipe_and_die(SCOPE).await;
        let copy = read_side_file(SCOPE).await;
        let (engine, _, _) = open(SCOPE, false).await;
        if !reset {
            resolved(engine.close()).await;
        }
        leave_side_file(SCOPE, &copy).await;
        run_js(
            "const directory = FileSystemDirectoryHandle.prototype;
             const original = directory.removeEntry;
             self.removedFiles = [];
             self.restoreFiles = () => { directory.removeEntry = original; };
             directory.removeEntry = function (file, options) {
               self.removedFiles.push(file);
               return original.call(this, file, options);
             };
             return Promise.resolve();",
            "",
        )
        .await;
        match reset {
            true => {
                resolved(engine.physical_reset()).await;
            }
            false => destroy_cache(SCOPE.into()).await.expect("destroy"),
        }
        let first = run_js(
            "self.restoreFiles(); return Promise.resolve(self.removedFiles[0]);",
            "",
        )
        .await;
        assert_eq!(first.as_string(), Some(side_file(SCOPE)), "{reset}");
        if reset {
            resolved(engine.close()).await;
        }
    }
    destroy_cache(SCOPE.into()).await.expect("destroy");
}

#[wasm_bindgen_test(async)]
async fn a_database_outlives_a_copy_that_cannot_be_forgotten() {
    const SCOPE: &str = "cache-wasm-salvage-forgotten-busy";
    for reset in [false, true] {
        closed_with_queue(SCOPE).await;
        wipe_and_die(SCOPE).await;
        let copy = read_side_file(SCOPE).await;
        let (engine, _, _) = open(SCOPE, false).await;
        if !reset {
            resolved(engine.close()).await;
        }
        leave_side_file(SCOPE, &copy).await;
        hold_side_file(SCOPE).await;
        let failed = match reset {
            true => wasm_bindgen_futures::JsFuture::from(engine.physical_reset())
                .await
                .is_err(),
            false => destroy_cache(SCOPE.into()).await.is_err(),
        };
        release_side_file().await;
        assert!(failed);
        // Only the database says that the copy is of a queue it took.
        let (engine, _, queue) = open(SCOPE, false).await;
        assert_eq!(queue, serde_json::json!(["none", 0, 0]), "{reset}");
        assert_kept(&engine, SCOPE).await;
        close_and_destroy(&engine, SCOPE).await;
    }
}

#[wasm_bindgen_test(async)]
async fn an_import_from_memory_leaves_the_copy_that_could_not_be_read() {
    const SCOPE: &str = "cache-wasm-salvage-import-unread";
    closed_with_queue(SCOPE).await;
    let owner = owner(SCOPE).await;
    let Ok((owner, crossing)) = wipe_keeping_queue(SCOPE, owner).await else {
        panic!("wipe keeps the queue")
    };
    let sidecar = owner.sidecar();
    let Ok((mut storage, _, crossing)) = open_or_wipe(SCOPE, owner, &sidecar, crossing).await
    else {
        panic!("a fresh database opens")
    };
    break_side_files("read", "throw new DOMException('no', 'NotReadableError');").await;
    let full = "const handle = FileSystemSyncAccessHandle.prototype;
         if (name === '') { handle.write = self.writeAny; return Promise.resolve(); }
         self.writeAny = handle.write;
         handle.write = () => { throw new DOMException('full', 'QuotaExceededError'); };
         return Promise.resolve();";
    run_js(full, "refuse").await;
    let died = crossing.finish(&sidecar, &mut storage).await;
    run_js(full, "").await;
    restore_side_files().await;
    assert!(died.is_err());
    release_storage(storage).await.expect("release");

    let (engine, _, queue) = open(SCOPE, false).await;
    assert_eq!(queue, serde_json::json!(["kept", 1, 0]));
    assert_kept(&engine, SCOPE).await;
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_copy_that_cannot_be_forgotten_fails_without_losing_the_lock() {
    const SCOPE: &str = "cache-wasm-salvage-forget-fails";
    closed_with_queue(SCOPE).await;
    hold_side_file(SCOPE).await;
    assert!(destroy_cache(SCOPE.into()).await.is_err());
    release_side_file().await;
    destroy_cache(SCOPE.into()).await.expect("destroy");

    closed_with_queue(SCOPE).await;
    let (engine, _, _) = open(SCOPE, false).await;
    hold_side_file(SCOPE).await;
    let reset = wasm_bindgen_futures::JsFuture::from(engine.physical_reset()).await;
    assert!(reset.is_err());
    release_side_file().await;
    let (engine, _, _) = open(SCOPE, false).await;
    resolved(engine.close()).await;

    // The database holds its copy already, and the copy cannot go.
    closed_with_queue(SCOPE).await;
    wipe_and_die(SCOPE).await;
    let copy = read_side_file(SCOPE).await;
    let (engine, _, _) = open(SCOPE, false).await;
    resolved(engine.close()).await;
    write_side_file(SCOPE, &copy).await;
    let full = "throw new DOMException('full', 'QuotaExceededError');";
    break_side_files("truncate", full).await;
    run_js(
        "self.removeEntry = FileSystemDirectoryHandle.prototype.removeEntry;
         FileSystemDirectoryHandle.prototype.removeEntry = async () => {
           throw new DOMException('no', 'UnknownError');
         };
         return Promise.resolve();",
        "",
    )
    .await;
    let failed = open_cache_inner(SCOPE.into(), None, true, None, false).await;
    run_js(
        "FileSystemDirectoryHandle.prototype.removeEntry = self.removeEntry;
         return Promise.resolve();",
        "",
    )
    .await;
    restore_side_files().await;
    assert!(failed.is_err());
    let (engine, _, _) = open(SCOPE, true).await;
    assert_kept(&engine, SCOPE).await;
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_disk_with_room_for_no_more_than_the_attempt_still_says_what_is_lost() {
    const SCOPE: &str = "cache-wasm-salvage-full";
    closed_with_queue(SCOPE).await;
    wipe_and_die(SCOPE).await;
    let older = read_side_file(SCOPE).await;
    closed_with(SCOPE, "00000000-0000-4000-8000-000000000012").await;
    write_side_file(SCOPE, &older).await;
    break_side_files(
        "write",
        "const [bytes, { at }] = args;
         self.sideFileRoom ??= at + bytes.byteLength;
         if (at + bytes.byteLength > self.sideFileRoom)
           throw new DOMException('full', 'QuotaExceededError');
         return original(...args);",
    )
    .await;
    wipe_and_die(SCOPE).await;
    restore_side_files().await;
    let (engine, _, queue) = open(SCOPE, false).await;
    assert_eq!(queue, serde_json::json!(["partial", 1, 0]));
    assert_kept(&engine, SCOPE).await;
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_full_disk_still_says_what_is_lost_behind_a_copy() {
    const SCOPE: &str = "cache-wasm-salvage-full-copy";
    closed_with_queue(SCOPE).await;
    wipe_and_die(SCOPE).await;
    let older = read_whole_side_file(SCOPE).await;
    closed_with(SCOPE, "00000000-0000-4000-8000-000000000012").await;
    write_side_file(SCOPE, &older).await;
    break_side_files(
        "write",
        &format!(
            "const [bytes, {{ at }}] = args;
             if (at + bytes.byteLength > {})
               throw new DOMException('full', 'QuotaExceededError');
             return original(...args);",
            older.len()
        ),
    )
    .await;
    wipe_and_die(SCOPE).await;
    restore_side_files().await;
    let (engine, _, queue) = open(SCOPE, false).await;
    assert_eq!(queue, serde_json::json!(["partial", 1, 0]));
    assert_kept(&engine, SCOPE).await;
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_copy_that_cannot_be_read_is_never_overtaken() {
    const SCOPE: &str = "cache-wasm-salvage-unreadable-copy";
    let broken = "throw new DOMException('no', 'NotReadableError');";
    closed_with_queue(SCOPE).await;
    wipe_and_die(SCOPE).await;
    let copy = read_side_file(SCOPE).await;
    for recovery in [false, true] {
        destroy_cache(SCOPE.into()).await.expect("destroy");
        closed_with(SCOPE, "00000000-0000-4000-8000-000000000012").await;
        write_side_file(SCOPE, &copy).await;
        break_side_files("read", broken).await;
        let (engine, _, queue) = open(SCOPE, recovery).await;
        restore_side_files().await;
        let expected = if recovery { "partial" } else { "unreadable" };
        assert_eq!(queue[0], expected, "{queue}");
        resolved(engine.close()).await;
        let (engine, _, _) = open(SCOPE, false).await;
        assert_eq!(depth(&engine).await, "1");
        resolved(engine.close()).await;

        // A failure that passes costs nothing.
        destroy_cache(SCOPE.into()).await.expect("destroy");
        write_side_file(SCOPE, &copy).await;
        break_side_files(
            "read",
            "if (self.failedOnce) return original(...args);
             self.failedOnce = true;
             throw new DOMException('no', 'NotReadableError');",
        )
        .await;
        run_js("self.failedOnce = false; return Promise.resolve();", "").await;
        let (engine, _, queue) = open(SCOPE, recovery).await;
        restore_side_files().await;
        assert_eq!(queue, serde_json::json!(["kept", 1, 0]));
        assert_kept(&engine, SCOPE).await;
        close_and_destroy(&engine, SCOPE).await;
    }
}

#[wasm_bindgen_test(async)]
async fn a_partial_import_that_could_not_tell_is_told_by_the_next_open() {
    const SCOPE: &str = "cache-wasm-salvage-untold";
    closed_with_queue(SCOPE).await;
    wipe_and_die(SCOPE).await;
    let mut partial = read_side_file(SCOPE).await;
    partial.extend(SalvageFile::loss(QueueLoss::default()));
    write_side_file(SCOPE, &partial).await;
    let (engine, _, queue) = open(SCOPE, false).await;
    assert_eq!(queue, serde_json::json!(["partial", 1, 0]));
    resolved(engine.close()).await;
    write_side_file(SCOPE, &partial).await;
    let (engine, _, queue) = open(SCOPE, false).await;
    assert_eq!(queue, serde_json::json!(["partial", 0, 0]));
    assert_kept(&engine, SCOPE).await;
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn failed_imports_of_an_older_queue_do_not_give_up_a_newer_one() {
    const SCOPE: &str = "cache-wasm-salvage-other-imports";
    closed_with_queue(SCOPE).await;
    wipe_and_die(SCOPE).await;
    let mut older = read_side_file(SCOPE).await;
    older.extend(SalvageFile::import_attempt().repeat(3));
    closed_with(SCOPE, "00000000-0000-4000-8000-000000000012").await;
    write_side_file(SCOPE, &older).await;
    refuse_queue_frames(true).await;
    let (engine, _, queue) = open(SCOPE, true).await;
    refuse_queue_frames(false).await;
    assert_eq!(queue, serde_json::json!(["partial", 2, 0]));
    assert_eq!(depth(&engine).await, "2");
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_copy_never_outlives_the_account_it_was_queued_under() {
    const SCOPE: &str = "cache-wasm-salvage-account";
    closed_with_queue(SCOPE).await;
    wipe_and_die(SCOPE).await;
    let copy = read_side_file(SCOPE).await;

    // Signing out clears the database and keeps its name.
    let (engine, _, _) = open(SCOPE, false).await;
    leave_side_file(SCOPE, &copy).await;
    resolved(engine.clear()).await;
    assert!(!opfs_file_exists(&side_file(SCOPE)).await);
    resolved(engine.close()).await;

    // Another account's first response resets it.
    closed_with_queue(SCOPE).await;
    let (engine, _, _) = open(SCOPE, false).await;
    leave_side_file(SCOPE, &copy).await;
    resolved(engine.write_query(
        write_context(None),
        PROPERTY_QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        js(property_base()),
        Some("user-2".into()),
    ))
    .await;
    assert_eq!(depth(&engine).await, "0");
    assert!(!opfs_file_exists(&side_file(SCOPE)).await);
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_clear_that_leaves_the_copy_behind_fails() {
    const SCOPE: &str = "cache-wasm-salvage-clear-fails";
    closed_with_queue(SCOPE).await;
    let (engine, _, _) = open(SCOPE, false).await;
    hold_side_file(SCOPE).await;
    let cleared = wasm_bindgen_futures::JsFuture::from(engine.clear()).await;
    assert!(cleared.is_err());
    assert_eq!(depth(&engine).await, "0");
    release_side_file().await;
    resolved(engine.clear()).await;
    assert!(!opfs_file_exists(&side_file(SCOPE)).await);
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_side_file_whose_database_is_gone_is_cleaned_up() {
    const SCOPE: &str = "cache-wasm-salvage-alone";
    closed_with_queue(SCOPE).await;
    wipe_and_die(SCOPE).await;
    let copy = read_side_file(SCOPE).await;
    destroy_cache(SCOPE.into()).await.expect("destroy");
    let older = format!("{}:s0.v0.t2", legacy_cache_database_name(SCOPE));
    remove_opfs_pair(&older).await;
    for (bytes, expected) in [
        (
            &*copy,
            serde_json::json!({ "outcome": "queued-mutations", "queuedMutations": 1 }),
        ),
        (
            &*SalvageFile::read_attempt(),
            serde_json::json!({ "outcome": "removed" }),
        ),
    ] {
        let owner = OpfsOwner::acquire(&older).await.expect("older owner");
        owner.sidecar().write_tail(0, bytes).await.expect("write");
        owner.release().await.expect("release");
        assert_eq!(stale_cleanup(SCOPE, &older).await, expected);
        assert!(!opfs_file_exists(&older).await, "nothing else was created");
    }
    assert!(!opfs_file_exists(&format!("{older}-salvage")).await);
    remove_opfs_pair(&database_identity(SCOPE)).await;
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
