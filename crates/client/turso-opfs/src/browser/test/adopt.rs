//! Moving an older identity's pair to a newer owner's paths.
use super::*;

fn exec(connection: &Arc<Connection>, sql: &str) {
    let mut statement = connection.prepare(sql).expect("prepare test SQL");
    drive_statement(&mut statement, |_| Ok(())).expect("execute test SQL");
}

/// Writes a database holding `value` at `identity` and releases it.
async fn write_pair(identity: &str, value: i64) {
    clean_pair(identity).await;
    let owner = OpfsOwner::acquire(identity).await.expect("owner");
    let connected = connect_ready(open_ready(owner).await);
    let connection = connected.connection();
    exec(&connection, "CREATE TABLE kept (value INTEGER NOT NULL)");
    exec(&connection, &format!("INSERT INTO kept VALUES ({value})"));
    drop(connection);
    connected
        .try_close()
        .expect("close")
        .preserve()
        .expect("preserve")
        .release()
        .await
        .expect("release");
}

/// Opens `identity` and returns its stored value.
async fn read_pair(identity: &str) -> i64 {
    let owner = OpfsOwner::acquire(identity).await.expect("owner");
    let session = open_ready(owner).await;
    assert_eq!(session.disposition(), OpenDisposition::Existing);
    let connected = connect_ready(session);
    let connection = connected.connection();
    let value = query_one_i64(&connection, "SELECT value FROM kept").expect("stored value");
    drop(connection);
    connected
        .try_close()
        .expect("close")
        .preserve()
        .expect("preserve")
        .release()
        .await
        .expect("release");
    value
}

async fn present(identity: &str) -> [bool; 2] {
    let root = worker_root().await.expect("root");
    [
        entry_exists(&root, identity).await,
        entry_exists(&root, &format!("{identity}-wal")).await,
    ]
}

async fn journal_exists(identity: &str) -> bool {
    let root = worker_root().await.expect("root");
    entry_exists(&root, &format!("{identity}{ADOPTION_JOURNAL_SUFFIX}")).await
}

/// Creates or replaces the file `name` with exactly `bytes`.
async fn write_file(name: &str, bytes: &[u8]) {
    let root = worker_root().await.expect("root");
    let (handle, _) = open_sync_handle(&root, name, BusyDeadline::start())
        .await
        .expect("open test file");
    handle.truncate_with_f64(0.0).expect("truncate test file");
    let options = FileSystemReadWriteOptions::new();
    options.set_at(0.0);
    handle
        .write_with_u8_array_and_options(bytes, &options)
        .expect("write test file");
    close_sync_handle(&handle).expect("close test file");
}

fn identities(case: &str) -> (String, String) {
    let nonce = js_sys::Date::now() as u64;
    (
        format!("adopt-{case}-{nonce}:t11"),
        format!("adopt-{case}-{nonce}:t12"),
    )
}

#[wasm_bindgen_test]
async fn adopting_moves_the_complete_pair_and_keeps_its_rows() {
    let (old, new) = identities("moved");
    write_pair(&old, 42).await;
    clean_pair(&new).await;

    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    assert_eq!(
        owner.adopt_previous(&old).await.expect("adopt"),
        AdoptOutcome::Adopted
    );
    owner.release().await.expect("release");

    assert_eq!(present(&old).await, [false, false]);
    assert_eq!(present(&new).await, [true, true]);
    assert!(journal_exists(&new).await);
    assert_eq!(open_and_finish(&new).await, 42);
    assert!(!journal_exists(&new).await);
    // The older identity now opens empty, as a fresh database.
    let owner = OpfsOwner::acquire(&old).await.expect("owner");
    let session = open_ready(owner).await;
    assert_eq!(session.disposition(), OpenDisposition::Fresh);
    connect_ready(session)
        .try_close()
        .expect("close")
        .preserve()
        .expect("preserve")
        .remove_and_release()
        .await
        .expect("remove");
    clean_pair(&new).await;
}

#[wasm_bindgen_test]
async fn adopting_never_overwrites_moves_while_in_use_or_moves_an_incomplete_pair() {
    // This owner's paths already hold a database.
    let (old, new) = identities("target");
    write_pair(&old, 1).await;
    write_pair(&new, 2).await;
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    assert_eq!(
        owner.adopt_previous(&old).await.expect("adopt"),
        AdoptOutcome::TargetExists
    );
    owner.release().await.expect("release");
    assert_eq!(read_pair(&new).await, 2);
    assert_eq!(read_pair(&old).await, 1);
    clean_pair(&old).await;
    clean_pair(&new).await;

    // An older build's context holds the previous identity.
    let (old, new) = identities("in-use");
    write_pair(&old, 3).await;
    clean_pair(&new).await;
    let held = acquire_raw_web_lock(&owner_lock_name(&old)).await;
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    assert_eq!(
        owner.adopt_previous(&old).await.expect("adopt"),
        AdoptOutcome::PreviousInUse
    );
    owner.release().await.expect("release");
    held.release().await;
    assert_eq!(present(&old).await, [true, true]);
    assert_eq!(present(&new).await, [false, false]);
    assert!(!journal_exists(&new).await);
    clean_pair(&old).await;

    // No previous files, then only one of the pair, then an empty pair.
    let (old, new) = identities("nothing");
    clean_pair(&old).await;
    clean_pair(&new).await;
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    assert_eq!(
        owner.adopt_previous(&old).await.expect("adopt"),
        AdoptOutcome::NothingToAdopt
    );
    write_file(&old, b"").await;
    assert_eq!(
        owner.adopt_previous(&old).await.expect("adopt"),
        AdoptOutcome::NothingToAdopt
    );
    write_file(&format!("{old}-wal"), b"").await;
    assert_eq!(
        owner.adopt_previous(&old).await.expect("adopt"),
        AdoptOutcome::NothingToAdopt
    );
    assert_eq!(
        owner
            .adopt_previous(&new)
            .await
            .map_err(|error| error.kind()),
        Err(OpfsErrorKind::InvalidName)
    );
    assert_eq!(
        owner
            .adopt_previous(&format!("{old}{ADOPTION_JOURNAL_SUFFIX}"))
            .await
            .map_err(|error| error.kind()),
        Err(OpfsErrorKind::InvalidName)
    );
    owner.release().await.expect("release");
    assert_eq!(present(&new).await, [false, false]);
    assert!(!journal_exists(&new).await);
    clean_pair(&old).await;
}

#[wasm_bindgen_test]
async fn a_pair_that_does_not_start_like_a_database_stays_where_it_is() {
    let (old, new) = identities("unreadable");
    for (main, wal) in [
        (b"not a database header".as_slice(), b"".as_slice()),
        (b"".as_slice(), b"not a WAL".as_slice()),
        (b"SQLite format 3\0".as_slice(), b"\x37\x7f".as_slice()),
    ] {
        clean_pair(&old).await;
        clean_pair(&new).await;
        write_file(&old, main).await;
        write_file(&format!("{old}-wal"), wal).await;
        let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
        assert_eq!(
            owner.adopt_previous(&old).await.expect("adopt"),
            AdoptOutcome::Unreadable
        );
        owner.release().await.expect("release");
        assert_eq!(present(&old).await, [true, true]);
        assert_eq!(present(&new).await, [false, false]);
        assert!(!journal_exists(&new).await);
    }
    clean_pair(&old).await;
}

/// Adopts `old` into `new`, stopping between the two moves when `stop`.
async fn adopt(old: &str, new: &str, stop: bool) {
    let mut owner = OpfsOwner::acquire(new).await.expect("owner");
    STOP_BETWEEN_MOVES.with(|cell| cell.set(stop));
    let adopted = owner.adopt_previous(old).await;
    if stop {
        assert_eq!(adopted.expect_err("stopped").kind(), OpfsErrorKind::Move);
        // The stop leaves one file at each identity, and the journal.
        assert_eq!(present(new).await, [true, false]);
        assert_eq!(present(old).await, [false, true]);
    } else {
        assert_eq!(adopted.expect("adopt"), AdoptOutcome::Adopted);
    }
    assert!(journal_exists(new).await);
    // The owner is still usable: neither a stop nor a move poisons it.
    owner.release().await.expect("release");
}

async fn resume(new: &str) -> Option<PendingAdoption> {
    let mut owner = OpfsOwner::acquire(new).await.expect("owner");
    let pending = owner.resume_adoption().await.expect("resume");
    owner.release().await.expect("release");
    pending
}

async fn give_back(new: &str) -> Option<PendingAdoption> {
    let mut owner = OpfsOwner::acquire(new).await.expect("owner");
    let pending = owner.return_adoption().await.expect("return");
    owner.release().await.expect("release");
    pending
}

/// Opens `identity` as an existing pair, reads its value, then finishes the
/// adoption the way an open does once it succeeded.
async fn open_and_finish(identity: &str) -> i64 {
    let owner = OpfsOwner::acquire(identity).await.expect("owner");
    let session = open_ready(owner).await;
    assert_eq!(session.disposition(), OpenDisposition::Existing);
    let connected = connect_ready(session);
    let connection = connected.connection();
    let value = query_one_i64(&connection, "SELECT value FROM kept").expect("stored value");
    drop(connection);
    connected.finish_adoption().await.expect("finish");
    connected
        .try_close()
        .expect("close")
        .preserve()
        .expect("preserve")
        .release()
        .await
        .expect("release");
    value
}

#[wasm_bindgen_test]
async fn a_stopped_adoption_is_resumed_into_the_new_identity() {
    let (old, new) = identities("resumed");
    write_pair(&old, 7).await;
    clean_pair(&new).await;
    adopt(&old, &new, true).await;

    assert_eq!(
        resume(&new).await,
        Some(PendingAdoption {
            previous_identity: old.clone(),
            outcome: PendingOutcome::Complete,
        })
    );
    assert_eq!(present(&new).await, [true, true]);
    assert_eq!(present(&old).await, [false, false]);
    // The journal stays until an open succeeds, so resuming again is harmless.
    assert!(journal_exists(&new).await);
    assert_eq!(
        resume(&new).await.map(|pending| pending.outcome),
        Some(PendingOutcome::Complete)
    );
    assert_eq!(open_and_finish(&new).await, 7);
    assert!(!journal_exists(&new).await);
    assert_eq!(resume(&new).await, None);
    assert_eq!(give_back(&new).await, None);
    assert_eq!(present(&new).await, [true, true]);
    clean_pair(&new).await;
}

#[wasm_bindgen_test]
async fn an_unfinished_adoption_goes_back_to_the_older_identity() {
    // Stopped between the moves, and after both moves.
    for stop in [true, false] {
        let (old, new) = identities(if stop { "returned-half" } else { "returned" });
        write_pair(&old, 9).await;
        clean_pair(&new).await;
        adopt(&old, &new, stop).await;
        assert_eq!(
            give_back(&new).await,
            Some(PendingAdoption {
                previous_identity: old.clone(),
                outcome: PendingOutcome::Returned,
            })
        );
        assert_eq!(present(&new).await, [false, false]);
        assert!(!journal_exists(&new).await);
        assert_eq!(read_pair(&old).await, 9);
        clean_pair(&old).await;
    }

    // An older build's context took the lock meanwhile: nothing goes back,
    // and the files stay for the caller to reset.
    let (old, new) = identities("return-held");
    write_pair(&old, 11).await;
    clean_pair(&new).await;
    adopt(&old, &new, false).await;
    let held = acquire_raw_web_lock(&owner_lock_name(&old)).await;
    assert_eq!(
        give_back(&new).await.map(|pending| pending.outcome),
        Some(PendingOutcome::Blocked)
    );
    held.release().await;
    assert_eq!(present(&new).await, [true, true]);
    assert_eq!(present(&old).await, [false, false]);
    assert!(!journal_exists(&new).await);
    clean_pair(&new).await;

    // The older identity holds new files by then: none are overwritten.
    let (old, new) = identities("return-taken");
    write_pair(&old, 12).await;
    clean_pair(&new).await;
    adopt(&old, &new, false).await;
    write_pair(&old, 13).await;
    assert_eq!(
        give_back(&new).await.map(|pending| pending.outcome),
        Some(PendingOutcome::Blocked)
    );
    assert_eq!(read_pair(&old).await, 13);
    assert_eq!(present(&new).await, [true, true]);
    clean_pair(&old).await;
    clean_pair(&new).await;
}

#[wasm_bindgen_test]
async fn wiping_an_identity_removes_its_journal() {
    let (old, new) = identities("wiped");
    write_pair(&old, 5).await;
    clean_pair(&new).await;
    adopt(&old, &new, false).await;
    let owner = OpfsOwner::acquire(&new).await.expect("owner");
    let owner = owner.recovery_wipe().await.expect("wipe");
    assert!(!journal_exists(&new).await);
    owner.remove_and_release().await.expect("remove");
    // A journal-free identity has nothing to resume or return.
    assert_eq!(resume(&new).await, None);
    assert_eq!(present(&new).await, [false, false]);
    clean_pair(&new).await;
}
