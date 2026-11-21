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
    assert_eq!(read_pair(&new).await, 42);
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
    clean_pair(&old).await;

    // No previous files, then only one of the pair.
    let (old, new) = identities("nothing");
    clean_pair(&old).await;
    clean_pair(&new).await;
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    assert_eq!(
        owner.adopt_previous(&old).await.expect("adopt"),
        AdoptOutcome::NothingToAdopt
    );
    let root = worker_root().await.expect("root");
    let options = FileSystemGetFileOptions::new();
    options.set_create(true);
    JsFuture::from(root.get_file_handle_with_options(&old, &options))
        .await
        .expect("create main only");
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
    owner.release().await.expect("release");
    assert_eq!(present(&new).await, [false, false]);
    clean_pair(&old).await;
}

#[wasm_bindgen_test]
async fn a_stop_between_the_moves_leaves_halves_that_only_reset() {
    let (old, new) = identities("stopped");
    write_pair(&old, 7).await;
    clean_pair(&new).await;

    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    STOP_BETWEEN_MOVES.with(|stop| stop.set(true));
    let error = owner.adopt_previous(&old).await.expect_err("stopped");
    assert_eq!(error.kind(), OpfsErrorKind::Move);
    // The owner is still usable: the stop is not a poisoned registry.
    assert_eq!(present(&new).await, [true, false]);
    assert_eq!(present(&old).await, [false, true]);
    match owner.open().await.expect("pre-open") {
        OpenResult::ResetRequired(session) => {
            let owner = session.reset().await.expect("reset");
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
        }
        OpenResult::Ready(_) => panic!("a half-moved pair must never open"),
    }
    let owner = OpfsOwner::acquire(&old).await.expect("owner");
    match owner.open().await.expect("pre-open") {
        OpenResult::ResetRequired(session) => session
            .reset()
            .await
            .expect("reset")
            .remove_and_release()
            .await
            .expect("remove"),
        OpenResult::Ready(_) => panic!("the remaining half must never open"),
    }
}
