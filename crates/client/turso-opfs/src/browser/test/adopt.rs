//! Moving an older identity's pair to a newer owner's paths, and back.
use super::*;

fn exec(connection: &Arc<Connection>, sql: &str) {
    let mut statement = connection.prepare(sql).expect("prepare test SQL");
    drive_statement(&mut statement, |_| Ok(())).expect("execute test SQL");
}

/// Writes a database holding `value` at `identity`, closes it (which empties
/// its WAL) and releases it.
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

/// The bytes of this worker's open file of `role`.
fn open_file_bytes(role: FileRole) -> Vec<u8> {
    REGISTRY.with(|registry| {
        let registry = registry.borrow();
        let entry = registry
            .handles
            .values()
            .find(|entry| entry.role == role)
            .expect("open handle");
        let mut bytes = vec![0; entry.handle.get_size().expect("size") as usize];
        let options = FileSystemReadWriteOptions::new();
        options.set_at(0.0);
        entry
            .handle
            .read_with_u8_array_and_options(&mut bytes, &options)
            .expect("read open file");
        bytes
    })
}

/// Writes a database holding `value` at `identity` whose rows are still in a
/// non-empty WAL, as a build stopped without closing leaves it: copies both
/// files of a scratch database while its connection is open.
async fn write_pair_with_live_wal(identity: &str, value: i64) {
    let scratch = format!("{identity}.scratch");
    clean_pair(&scratch).await;
    let owner = OpfsOwner::acquire(&scratch).await.expect("owner");
    let connected = connect_ready(open_ready(owner).await);
    let connection = connected.connection();
    exec(&connection, "CREATE TABLE kept (value INTEGER NOT NULL)");
    exec(&connection, &format!("INSERT INTO kept VALUES ({value})"));
    let main = open_file_bytes(FileRole::Main);
    let wal = open_file_bytes(FileRole::Wal);
    drop(connection);
    connected
        .try_close()
        .expect("close")
        .preserve()
        .expect("preserve")
        .remove_and_release()
        .await
        .expect("remove scratch");
    assert!(wal.len() > WAL_HEADER_LEN, "the rows are in the WAL");
    clean_pair(identity).await;
    write_file(identity, &main).await;
    write_file(&format!("{identity}-wal"), &wal).await;
}

/// Opens `identity` as an existing pair and returns its stored value.
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

async fn present(identity: &str) -> [bool; 2] {
    let root = worker_root().await.expect("root");
    [
        entry_exists(&root, identity).await,
        entry_exists(&root, &format!("{identity}-wal")).await,
    ]
}

fn marker_name(identity: &str) -> String {
    format!("{identity}{ADOPTION_MARKER_SUFFIX}")
}

async fn marker_exists(identity: &str) -> bool {
    let root = worker_root().await.expect("root");
    entry_exists(&root, &marker_name(identity)).await
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

/// The whole of file `name`, or `None` when it does not exist.
async fn read_file(name: &str) -> Option<Vec<u8>> {
    let root = worker_root().await.expect("root");
    let file = existing_file(&root, name).await.expect("lookup")?;
    let handle = JsFuture::from(file.create_sync_access_handle())
        .await
        .expect("open")
        .dyn_into::<FileSystemSyncAccessHandle>()
        .expect("sync handle");
    let mut bytes = vec![0; handle.get_size().expect("size") as usize];
    let options = FileSystemReadWriteOptions::new();
    options.set_at(0.0);
    handle
        .read_with_u8_array_and_options(&mut bytes, &options)
        .expect("read");
    close_sync_handle(&handle).expect("close");
    Some(bytes)
}

fn identities(case: &str) -> (String, String) {
    let nonce = js_sys::Date::now() as u64;
    (
        format!("adopt-{case}-{nonce}:t11"),
        format!("adopt-{case}-{nonce}:t12"),
    )
}

/// A database header Turso opens, with the page size field `page_size`, after
/// `edit`.
fn database_header(page_size: u16, edit: impl FnOnce(&mut [u8])) -> Vec<u8> {
    let mut header = vec![0_u8; DATABASE_HEADER_LEN];
    header[..16].copy_from_slice(DATABASE_HEADER);
    header[16..18].copy_from_slice(&page_size.to_be_bytes());
    header[18..24].copy_from_slice(&[2, 2, 0, 64, 32, 32]);
    header[56..60].copy_from_slice(&1_u32.to_be_bytes());
    edit(&mut header);
    header
}

/// A whole first database page Turso opens: [`database_header`] with the page
/// size field `page_size` (1 for 65536), a leaf table b-tree page type, and
/// zeros to the end of the page, after `edit`.
fn database_page(page_size: u16, edit: impl FnOnce(&mut Vec<u8>)) -> Vec<u8> {
    let len = if page_size == 1 {
        65_536
    } else {
        usize::from(page_size)
    };
    let mut page = database_header(page_size, |_| {});
    page.resize(len, 0);
    page[DATABASE_HEADER_LEN] = 0x0d;
    edit(&mut page);
    page
}

/// A WAL header Turso opens, with `page_size` and `salt`, after `edit`.
fn wal_header(page_size: u32, salt: u32, edit: impl FnOnce(&mut [u8])) -> Vec<u8> {
    let mut header = vec![0_u8; WAL_HEADER_LEN];
    header[..4].copy_from_slice(&WAL_MAGICS[0]);
    header[4..8].copy_from_slice(&WAL_FORMAT_VERSION.to_be_bytes());
    header[8..12].copy_from_slice(&page_size.to_be_bytes());
    header[16..20].copy_from_slice(&salt.to_be_bytes());
    edit(&mut header);
    header
}

/// Takes `old`'s lock for an owner of `new`, adopts, and releases both.
async fn adopt_into(old: &str, new: &str) -> AdoptOutcome {
    let mut owner = OpfsOwner::acquire(new).await.expect("owner");
    let lock = owner.lock_previous(old).await.expect("lock").expect("free");
    let outcome = owner.adopt(&lock).await.expect("adopt");
    lock.release().await.expect("release previous");
    owner.release().await.expect("release");
    outcome
}

/// Adopts `old` into `new` and stops between the two moves, as a stopped
/// worker would: the main file sits at `new`, the WAL still at `old`.
async fn adopt_and_stop(old: &str, new: &str) {
    let mut owner = OpfsOwner::acquire(new).await.expect("owner");
    let lock = owner.lock_previous(old).await.expect("lock").expect("free");
    STOP_BETWEEN_MOVES.with(|stop| stop.set(true));
    let stopped = owner.adopt(&lock).await;
    assert_eq!(stopped.expect_err("stopped").kind(), OpfsErrorKind::Move);
    // Neither a stop nor a move poisons the owner.
    lock.release().await.expect("release previous");
    owner.release().await.expect("release");
    assert_eq!(present(new).await, [true, false]);
    assert_eq!(present(old).await, [false, true]);
    assert!(marker_exists(new).await);
}

async fn read_adoption(new: &str) -> Option<Adoption> {
    let mut owner = OpfsOwner::acquire(new).await.expect("owner");
    let adoption = owner.read_adoption().await.expect("read adoption");
    owner.release().await.expect("release");
    adoption
}

/// Completes a split adoption into `new`, holding `old`'s lock when `locked`.
/// Where the adoption into `new` came from and which of its files moved.
async fn moved(new: &str) -> Option<(String, AdoptionState)> {
    read_adoption(new)
        .await
        .map(|adoption| (adoption.previous_identity, adoption.state))
}

fn attempts_name(identity: &str) -> String {
    format!("{identity}{ATTEMPTS_SUFFIX}")
}

async fn complete(old: &str, new: &str, locked: bool) -> CompleteOutcome {
    let mut owner = OpfsOwner::acquire(new).await.expect("owner");
    let lock = if locked {
        owner.lock_previous(old).await.expect("lock")
    } else {
        None
    };
    let completed = owner
        .complete_adoption(lock.as_ref())
        .await
        .expect("complete");
    if let Some(lock) = lock {
        lock.release().await.expect("release previous");
    }
    owner.release().await.expect("release");
    completed
}

async fn give_back(old: &str, new: &str) -> ReturnOutcome {
    let mut owner = OpfsOwner::acquire(new).await.expect("owner");
    let lock = owner.lock_previous(old).await.expect("lock").expect("free");
    let outcome = owner.return_adoption(&lock).await.expect("return");
    lock.release().await.expect("release previous");
    owner.release().await.expect("release");
    outcome
}

#[wasm_bindgen_test]
async fn adopting_moves_the_complete_pair_and_keeps_its_rows() {
    for live_wal in [false, true] {
        let (old, new) = identities(if live_wal { "moved-live" } else { "moved" });
        if live_wal {
            write_pair_with_live_wal(&old, 41).await;
        } else {
            write_pair(&old, 42).await;
        }
        clean_pair(&new).await;
        let old_files = [
            read_file(&old).await,
            read_file(&format!("{old}-wal")).await,
        ];

        assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
        assert_eq!(present(&old).await, [false, false]);
        assert_eq!(
            [
                read_file(&new).await,
                read_file(&format!("{new}-wal")).await
            ],
            old_files,
            "both files moved byte for byte"
        );
        assert_eq!(
            moved(&new).await,
            Some((old.clone(), AdoptionState::Complete))
        );
        assert_eq!(open_and_finish(&new).await, if live_wal { 41 } else { 42 });
        assert!(!marker_exists(&new).await);
        assert_eq!(read_adoption(&new).await, None);

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
}

#[wasm_bindgen_test]
async fn the_previous_lock_keeps_the_older_build_out_until_released() {
    let (old, new) = identities("lock");
    let lock_name = owner_lock_name(&old);
    let owner = OpfsOwner::acquire(&new).await.expect("owner");

    // An older build's context holds it: nothing is taken.
    let held = acquire_raw_web_lock(&lock_name).await;
    assert!(owner.lock_previous(&old).await.expect("lock").is_none());
    held.release().await;

    // Held here, no other context can take it, so the older build cannot
    // open its identity, until it is released or dropped.
    let lock = owner
        .lock_previous(&old)
        .await
        .expect("lock")
        .expect("free");
    assert_eq!(lock.identity(), old);
    assert!(!web_lock_available(&lock_name).await);
    lock.release().await.expect("release");
    assert!(web_lock_available(&lock_name).await);
    let lock = owner
        .lock_previous(&old)
        .await
        .expect("lock")
        .expect("free");
    drop(lock);
    let raw = acquire_raw_web_lock(&lock_name).await;
    raw.release().await;

    for invalid in [new.clone(), marker_name(&old), format!("{old}-wal")] {
        assert_eq!(
            owner
                .lock_previous(&invalid)
                .await
                .map(|lock| lock.is_some())
                .map_err(|error| error.kind()),
            Err(OpfsErrorKind::InvalidName)
        );
    }
    owner.release().await.expect("release");
}

#[wasm_bindgen_test]
async fn a_pair_whose_own_adoption_is_unfinished_stays_until_it_finishes() {
    // The t12 pair came from a t10 name and its first open never succeeded;
    // a t13 build finds it as its newest older pair.
    let nonce = js_sys::Date::now() as u64;
    let oldest = format!("adopt-chained-{nonce}:t10");
    let (old, new) = identities("chained");
    write_pair(&oldest, 4).await;
    clean_pair(&old).await;
    clean_pair(&new).await;
    assert_eq!(adopt_into(&oldest, &old).await, AdoptOutcome::Adopted);
    assert!(marker_exists(&old).await);

    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::PreviousAdopting);
    assert_eq!(present(&new).await, [false, false]);
    assert!(!marker_exists(&new).await);
    assert!(marker_exists(&old).await);

    // Once its own first open succeeds, the pair moves on as any other.
    assert_eq!(open_and_finish(&old).await, 4);
    assert!(!marker_exists(&old).await);
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    assert_eq!(open_and_finish(&new).await, 4);
    clean_pair(&oldest).await;
    clean_pair(&old).await;
    clean_pair(&new).await;
}

#[wasm_bindgen_test]
async fn a_marker_beside_no_whole_pair_leaves_the_pair_it_names_movable() {
    // t12's adoption from t10 wrote its marker and stopped before moving
    // anything: a t13 build finds nothing at t12 and moves t10 itself.
    let nonce = js_sys::Date::now() as u64;
    let oldest = format!("adopt-unmoved-{nonce}:t10");
    let (old, new) = identities("unmoved");
    write_pair(&oldest, 6).await;
    clean_pair(&old).await;
    clean_pair(&new).await;
    write_file(&marker_name(&old), b"an adoption that moved nothing").await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::NothingToAdopt);
    assert_eq!(adopt_into(&oldest, &new).await, AdoptOutcome::Adopted);
    assert_eq!(
        moved(&new).await.map(|(from, _)| from),
        Some(oldest.clone())
    );
    assert_eq!(open_and_finish(&new).await, 6);
    clean_pair(&oldest).await;
    clean_pair(&old).await;
    clean_pair(&new).await;

    // Stopped between its moves, the pair is split across t12 and t10: no
    // whole pair at either, so nothing moves and t12's build completes it.
    let oldest = format!("adopt-split-chain-{nonce}:t10");
    let (old, new) = identities("split-chain");
    write_pair(&oldest, 9).await;
    clean_pair(&old).await;
    clean_pair(&new).await;
    adopt_and_stop(&oldest, &old).await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::NothingToAdopt);
    assert_eq!(
        adopt_into(&oldest, &new).await,
        AdoptOutcome::NothingToAdopt
    );
    assert_eq!(present(&new).await, [false, false]);
    assert!(!marker_exists(&new).await);
    assert_eq!(
        complete(&oldest, &old, false).await,
        CompleteOutcome::Completed
    );
    assert_eq!(open_and_finish(&old).await, 9);
    clean_pair(&oldest).await;
    clean_pair(&old).await;
    clean_pair(&new).await;
}

#[wasm_bindgen_test]
async fn adopting_never_overwrites_or_moves_an_incomplete_pair() {
    // This owner's main file already exists.
    let (old, new) = identities("target");
    write_pair(&old, 1).await;
    write_pair(&new, 2).await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::TargetExists);
    assert_eq!(read_pair(&new).await, 2);
    assert_eq!(read_pair(&old).await, 1);
    assert!(!marker_exists(&new).await);
    clean_pair(&old).await;
    clean_pair(&new).await;

    // No previous files, then only the main file, then an empty pair.
    let (old, new) = identities("nothing");
    clean_pair(&old).await;
    clean_pair(&new).await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::NothingToAdopt);
    write_file(&old, b"").await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::NothingToAdopt);
    write_file(&format!("{old}-wal"), b"").await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::NothingToAdopt);
    assert_eq!(present(&new).await, [false, false]);
    assert!(!marker_exists(&new).await);
    clean_pair(&old).await;

    // A WAL left at this owner's paths without its main file is unusable, so
    // the previous WAL replaces it.
    let (old, new) = identities("lone-wal");
    write_pair(&old, 3).await;
    clean_pair(&new).await;
    write_file(&format!("{new}-wal"), b"stray").await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    assert_eq!(read_file(&format!("{new}-wal")).await, Some(Vec::new()));
    assert_eq!(open_and_finish(&new).await, 3);
    clean_pair(&new).await;
}

#[wasm_bindgen_test]
async fn a_pair_turso_would_not_open_stays_where_it_is() {
    let main = database_page(4096, |_| {});
    let wal = wal_header(4096, 7, |_| {});
    let not_a_wal = vec![b'x'; WAL_HEADER_LEN];
    let cases: Vec<(&str, Vec<u8>, Vec<u8>)> = vec![
        ("main magic", b"not a database header".to_vec(), Vec::new()),
        (
            "main shorter than its header",
            DATABASE_HEADER.to_vec(),
            Vec::new(),
        ),
        ("page size 513", database_header(513, |_| {}), Vec::new()),
        ("page size 256", database_header(256, |_| {}), Vec::new()),
        (
            "versions differ",
            database_header(4096, |h| h[19] = 1),
            Vec::new(),
        ),
        (
            "unknown version",
            database_header(4096, |h| h[18..20].copy_from_slice(&[3, 3])),
            Vec::new(),
        ),
        (
            "usable space below 480",
            database_header(512, |h| h[20] = 40),
            Vec::new(),
        ),
        (
            "max payload fraction",
            database_header(4096, |h| h[21] = 65),
            Vec::new(),
        ),
        (
            "min payload fraction",
            database_header(4096, |h| h[22] = 31),
            Vec::new(),
        ),
        (
            "leaf payload fraction",
            database_header(4096, |h| h[23] = 33),
            Vec::new(),
        ),
        (
            "text encoding",
            database_header(4096, |h| h[56..60].copy_from_slice(&2_u32.to_be_bytes())),
            Vec::new(),
        ),
        (
            "main not a whole page",
            database_page(4096, |p| p.truncate(DATABASE_HEADER_LEN + 1)),
            Vec::new(),
        ),
        (
            "main not whole pages",
            database_page(4096, |p| p.push(0)),
            Vec::new(),
        ),
        (
            "first page type",
            database_page(4096, |p| p[DATABASE_HEADER_LEN] = 0),
            wal.clone(),
        ),
        (
            "first page an index page",
            database_page(4096, |p| p[DATABASE_HEADER_LEN] = 0x0a),
            Vec::new(),
        ),
        ("WAL magic", Vec::new(), not_a_wal),
        (
            "WAL shorter than its header",
            main.clone(),
            wal[..2].to_vec(),
        ),
        (
            "WAL header cut short",
            main.clone(),
            wal[..WAL_HEADER_LEN - 1].to_vec(),
        ),
        (
            "WAL format version",
            main.clone(),
            wal_header(4096, 7, |h| h[7] ^= 1),
        ),
        ("WAL page size", Vec::new(), wal_header(4097, 7, |_| {})),
        (
            "page sizes differ",
            main.clone(),
            wal_header(8192, 7, |_| {}),
        ),
    ];
    let (old, new) = identities("unreadable");
    for (case, main, wal) in cases {
        clean_pair(&old).await;
        clean_pair(&new).await;
        write_file(&old, &main).await;
        write_file(&format!("{old}-wal"), &wal).await;
        assert_eq!(
            adopt_into(&old, &new).await,
            AdoptOutcome::Unreadable,
            "{case}"
        );
        assert_eq!(present(&old).await, [true, true], "{case}");
        assert_eq!(present(&new).await, [false, false], "{case}");
        assert!(!marker_exists(&new).await, "{case}");
    }

    // The same checks accept every header shape Turso opens.
    for (case, main, wal) in [
        ("4096", main.clone(), wal.clone()),
        (
            "65536",
            database_page(1, |_| {}),
            wal_header(65_536, 7, |_| {}),
        ),
        (
            "version 1",
            database_page(512, |p| p[18..20].copy_from_slice(&[1, 1])),
            Vec::new(),
        ),
        (
            "unset encoding",
            database_page(4096, |p| p[56..60].fill(0)),
            wal.clone(),
        ),
        (
            "interior first page, two pages",
            database_page(4096, |p| {
                p[DATABASE_HEADER_LEN] = 0x05;
                p.resize(2 * 4096, 0);
            }),
            Vec::new(),
        ),
        (
            "WAL alone",
            Vec::new(),
            wal_header(4096, 7, |h| h[3] = 0x83),
        ),
    ] {
        clean_pair(&old).await;
        clean_pair(&new).await;
        write_file(&old, &main).await;
        write_file(&format!("{old}-wal"), &wal).await;
        assert_eq!(
            adopt_into(&old, &new).await,
            AdoptOutcome::Adopted,
            "{case}"
        );
    }
    clean_pair(&old).await;
    clean_pair(&new).await;
}

#[wasm_bindgen_test]
fn a_marker_reads_back_only_as_written() {
    let marker = Marker {
        previous_identity: "graphql-cache:scope:s4.v4.t11".to_owned(),
        wal: WalFingerprint {
            size: 4096 + 32,
            header: wal_header(4096, 9, |_| {}),
        },
        adopted_at_ms: 1_795_000_000_123,
    };
    let bytes = marker.encode().expect("encode");
    assert_eq!(Marker::decode(&bytes), Some(marker.clone()));
    assert_eq!(
        &bytes[bytes.len() - 8..],
        &1_795_000_000_123_u64.to_be_bytes(),
        "the adoption time ends it"
    );
    let empty = Marker {
        wal: WalFingerprint {
            size: 0,
            header: Vec::new(),
        },
        ..marker.clone()
    };
    assert_eq!(
        Marker::decode(&empty.encode().expect("encode")),
        Some(empty)
    );
    assert_eq!(Marker::decode(&bytes[..bytes.len() - 1]), None, "cut short");
    let mut longer = bytes.clone();
    longer.push(b'+');
    assert_eq!(Marker::decode(&longer), None, "a byte past its end");
    assert_eq!(Marker::decode(b""), None, "empty");
    let mut wrong_magic = bytes.clone();
    wrong_magic[0] ^= 1;
    assert_eq!(Marker::decode(&wrong_magic), None, "magic");
    let short_header = Marker {
        wal: WalFingerprint {
            size: 4096 + 32,
            header: vec![0; 8],
        },
        ..marker
    };
    assert_eq!(
        Marker::decode(&short_header.encode().expect("encode")),
        None,
        "a header shorter than the WAL it fingerprints"
    );
}

#[wasm_bindgen_test]
fn an_attempt_takes_the_first_free_slot_until_none_is_left() {
    assert_eq!(next_attempt(&FREE_ATTEMPTS), (1, Some(0)));
    assert_eq!(next_attempt(b"++------"), (3, Some(2)));
    assert_eq!(next_attempt(b"+++++++-"), (8, Some(7)));
    assert_eq!(next_attempt(b"++++++++"), (8, None), "full: counts 8");
    // Any byte but a free slot's counts, so a slot written halfway reads.
    assert_eq!(next_attempt(b"\0-------"), (2, Some(1)));
}

#[wasm_bindgen_test]
async fn a_failed_wal_move_puts_the_main_file_back() {
    let (old, new) = identities("wal-move-fails");
    write_pair(&old, 6).await;
    clean_pair(&new).await;
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    let lock = owner
        .lock_previous(&old)
        .await
        .expect("lock")
        .expect("free");
    FAIL_WAL_MOVE.with(|fail| fail.set(true));
    let failed = owner.adopt(&lock).await;
    assert_eq!(failed.expect_err("failed").kind(), OpfsErrorKind::Move);
    lock.release().await.expect("release previous");
    owner.release().await.expect("release");
    assert_eq!(present(&old).await, [true, true]);
    assert_eq!(present(&new).await, [false, false]);
    assert!(!marker_exists(&new).await);
    assert_eq!(read_pair(&old).await, 6);
    clean_pair(&old).await;
}

#[wasm_bindgen_test]
async fn a_split_adoption_completes_only_with_the_wal_it_recorded() {
    // The WAL that stayed behind was empty: an empty one is recreated, with
    // or without the older identity's lock.
    let (old, new) = identities("split-empty");
    write_pair(&old, 7).await;
    clean_pair(&new).await;
    adopt_and_stop(&old, &new).await;
    assert_eq!(moved(&new).await, Some((old.clone(), AdoptionState::Split)));
    assert_eq!(
        complete(&old, &new, false).await,
        CompleteOutcome::Completed
    );
    assert_eq!(present(&new).await, [true, true]);
    assert_eq!(
        read_adoption(&new).await.map(|adoption| adoption.state),
        Some(AdoptionState::Complete)
    );
    assert_eq!(open_and_finish(&new).await, 7);
    clean_pair(&old).await;
    clean_pair(&new).await;

    // A WAL holding rows moves only under the older identity's lock, and only
    // while it is the WAL the marker recorded.
    let (old, new) = identities("split-live");
    write_pair_with_live_wal(&old, 8).await;
    clean_pair(&new).await;
    let wal_name = format!("{old}-wal");
    let wal = read_file(&wal_name).await.expect("WAL");
    adopt_and_stop(&old, &new).await;
    assert_eq!(
        complete(&old, &new, false).await,
        CompleteOutcome::LockNeeded,
        "no lock"
    );
    let mut reset = wal.clone();
    reset[16] ^= 1;
    write_file(&wal_name, &reset).await;
    assert_eq!(
        complete(&old, &new, true).await,
        CompleteOutcome::WalLost,
        "new salts"
    );
    write_file(&wal_name, &wal[..wal.len() - 1]).await;
    assert_eq!(
        complete(&old, &new, true).await,
        CompleteOutcome::WalLost,
        "another size"
    );
    write_file(&wal_name, &wal).await;
    // Nothing moved while it was refused.
    assert_eq!(present(&new).await, [true, false]);
    assert_eq!(complete(&old, &new, true).await, CompleteOutcome::Completed);
    assert_eq!(present(&old).await, [false, false]);
    assert_eq!(read_file(&format!("{new}-wal")).await, Some(wal));
    assert_eq!(open_and_finish(&new).await, 8);
    clean_pair(&new).await;

    // The lock of another identity than the marker names is refused.
    let (old, new) = identities("split-other");
    write_pair_with_live_wal(&old, 9).await;
    clean_pair(&new).await;
    adopt_and_stop(&old, &new).await;
    let (other, _) = identities("split-other-lock");
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    let lock = owner
        .lock_previous(&other)
        .await
        .expect("lock")
        .expect("free");
    assert_eq!(
        owner
            .complete_adoption(Some(&lock))
            .await
            .map_err(|error| error.kind()),
        Err(OpfsErrorKind::InvalidName)
    );
    lock.release().await.expect("release previous");
    owner.release().await.expect("release");
    assert_eq!(present(&new).await, [true, false]);
    clean_pair(&old).await;
    clean_pair(&new).await;
}

#[wasm_bindgen_test]
async fn an_open_of_a_split_adoption_creates_nothing_and_fails() {
    // An open before the split completed, as a build that never read the
    // marker would run: it creates no WAL, so the adoption still reads as
    // split, and the owner comes back unchanged.
    let (old, new) = identities("split-open");
    write_pair_with_live_wal(&old, 23).await;
    clean_pair(&new).await;
    adopt_and_stop(&old, &new).await;
    let owner = OpfsOwner::acquire(&new).await.expect("owner");
    let failure = owner.open().await.expect_err("an open of a split");
    assert_eq!(failure.error().kind(), OpfsErrorKind::Open);
    failure
        .into_owner()
        .expect("the owner comes back")
        .release()
        .await
        .expect("release");
    assert_eq!(present(&new).await, [true, false]);
    assert_eq!(moved(&new).await, Some((old.clone(), AdoptionState::Split)));
    // It still completes with the WAL it recorded and keeps its rows.
    assert_eq!(complete(&old, &new, true).await, CompleteOutcome::Completed);
    assert_eq!(open_and_finish(&new).await, 23);
    clean_pair(&old).await;
    clean_pair(&new).await;
}

#[wasm_bindgen_test]
async fn stale_and_malformed_markers_read_as_no_adoption() {
    let (old, new) = identities("markers");
    let recorded = |identity: &str| {
        Marker {
            previous_identity: identity.to_owned(),
            wal: WalFingerprint {
                size: 0,
                header: Vec::new(),
            },
            adopted_at_ms: 0,
        }
        .encode()
        .expect("encode")
    };
    let valid = recorded(&old);
    for (case, bytes) in [
        ("garbage", b"not a marker".to_vec()),
        ("empty", Vec::new()),
        ("cut short", valid[..valid.len() - 1].to_vec()),
        ("own identity", recorded(&new)),
        ("invalid identity", recorded("a/b")),
        ("reserved identity", recorded(&format!("{old}-wal"))),
    ] {
        write_pair(&new, 10).await;
        write_file(&marker_name(&new), &bytes).await;
        write_file(&attempts_name(&new), b"+-------").await;
        assert_eq!(read_adoption(&new).await, None, "{case}");
        assert!(!marker_exists(&new).await, "{case}");
        assert_eq!(read_file(&attempts_name(&new)).await, None, "{case}");
        assert_eq!(read_pair(&new).await, 10, "{case}: the files stay");
    }
    clean_pair(&new).await;

    // A valid marker whose main file is not here: the adoption never moved
    // it, or a return moved it back. The WAL beside it goes too.
    write_file(&marker_name(&new), &valid).await;
    write_file(&format!("{new}-wal"), b"").await;
    assert_eq!(read_adoption(&new).await, None);
    assert!(!marker_exists(&new).await);
    assert_eq!(present(&new).await, [false, false]);
}

#[wasm_bindgen_test]
async fn files_that_never_opened_go_back_to_the_older_identity() {
    // After both moves, and after a split that was completed.
    for split in [false, true] {
        let (old, new) = identities(if split { "return-split" } else { "return" });
        write_pair(&old, 11).await;
        clean_pair(&new).await;
        if split {
            adopt_and_stop(&old, &new).await;
            assert_eq!(
                complete(&old, &new, false).await,
                CompleteOutcome::Completed
            );
        } else {
            assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
        }
        assert_eq!(give_back(&old, &new).await, ReturnOutcome::Returned);
        assert_eq!(present(&new).await, [false, false]);
        assert!(!marker_exists(&new).await);
        assert_eq!(read_adoption(&new).await, None);
        assert_eq!(read_pair(&old).await, 11);
        clean_pair(&old).await;
    }
}

#[wasm_bindgen_test]
async fn a_return_clears_a_marker_its_older_identity_was_left_with() {
    // t12's pair moved to t13. A t12 build then began adopting t10 and
    // stopped after its marker, before moving anything. The pair t13 gives
    // back is t12's own again, and t10's stays where it is.
    let nonce = js_sys::Date::now() as u64;
    let oldest = format!("adopt-return-marked-{nonce}:t10");
    let (old, new) = identities("return-marked");
    write_pair(&oldest, 3).await;
    write_pair(&old, 12).await;
    clean_pair(&new).await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    let stopped = Marker {
        previous_identity: oldest.clone(),
        wal: WalFingerprint {
            size: 0,
            header: Vec::new(),
        },
        adopted_at_ms: 0,
    }
    .encode()
    .expect("encode");
    write_file(&attempts_name(&old), b"+-------").await;
    write_file(&marker_name(&old), &stopped).await;
    assert_eq!(give_back(&old, &new).await, ReturnOutcome::Returned);
    assert!(!marker_exists(&old).await);
    assert_eq!(read_file(&attempts_name(&old)).await, None);
    assert_eq!(read_adoption(&old).await, None);
    assert_eq!(read_pair(&old).await, 12);
    assert_eq!(read_pair(&oldest).await, 3);
    clean_pair(&oldest).await;
    clean_pair(&old).await;
    clean_pair(&new).await;

    // The count beside that marker cannot be removed: the pair still goes
    // back without waiting on it, so the moves keep the whole busy wait, and
    // the count left alone labels nothing.
    let (old, new) = identities("return-marked-count");
    write_pair(&old, 18).await;
    clean_pair(&new).await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    write_file(&attempts_name(&old), b"+-------").await;
    write_file(&marker_name(&old), &stopped).await;
    let root = worker_root().await.expect("root");
    let (held, _) = open_sync_handle(&root, &attempts_name(&old), BusyDeadline::start())
        .await
        .expect("hold the count open");
    BUSY_WAITS.with(|waits| waits.set(0));
    assert_eq!(give_back(&old, &new).await, ReturnOutcome::Returned);
    let waits = BUSY_WAITS.with(std::cell::Cell::get);
    close_sync_handle(&held).expect("close the count");
    assert_eq!(waits, 0, "the return waited on the held count");
    assert!(!marker_exists(&old).await);
    assert_eq!(read_adoption(&old).await, None);
    assert_eq!(read_pair(&old).await, 18);
    clean_pair(&old).await;
    clean_pair(&new).await;
}

#[wasm_bindgen_test]
async fn a_return_moves_nothing_unless_the_database_is_self_contained() {
    // This owner's WAL still holds rows: the main file alone would lose them.
    let (old, new) = identities("refused-wal");
    write_pair_with_live_wal(&old, 13).await;
    clean_pair(&new).await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    assert_eq!(give_back(&old, &new).await, ReturnOutcome::WalNotEmpty);
    assert_eq!(present(&new).await, [true, true]);
    assert_eq!(present(&old).await, [false, false]);
    assert!(marker_exists(&new).await);
    assert_eq!(open_and_finish(&new).await, 13);
    clean_pair(&new).await;

    // The older identity holds a database again: it is never overwritten.
    let (old, new) = identities("refused-taken");
    write_pair(&old, 14).await;
    clean_pair(&new).await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    write_pair(&old, 15).await;
    assert_eq!(give_back(&old, &new).await, ReturnOutcome::Occupied);
    assert_eq!(read_pair(&old).await, 15);
    assert_eq!(present(&new).await, [true, true]);
    clean_pair(&old).await;
    clean_pair(&new).await;

    // A WAL the older identity left non-empty without its main file.
    let (old, new) = identities("refused-old-wal");
    write_pair(&old, 16).await;
    clean_pair(&new).await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    write_file(&format!("{old}-wal"), &wal_header(4096, 3, |_| {})).await;
    assert_eq!(give_back(&old, &new).await, ReturnOutcome::Occupied);
    assert_eq!(present(&new).await, [true, true]);
    clean_pair(&old).await;
    clean_pair(&new).await;
}

#[wasm_bindgen_test]
async fn a_return_stopped_after_its_main_move_reads_as_no_adoption() {
    let (old, new) = identities("return-stopped");
    write_pair(&old, 17).await;
    clean_pair(&new).await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    // What a return leaves when it stops right after moving the main file:
    // the older pair is whole, and this owner keeps its empty WAL and marker.
    let root = worker_root().await.expect("root");
    write_file(&format!("{old}-wal"), b"").await;
    let main = existing_file(&root, &new)
        .await
        .expect("lookup")
        .expect("main");
    move_entry(&root, &main, &old, BusyDeadline::start())
        .await
        .expect("move main back");
    assert_eq!(present(&new).await, [false, true]);
    assert!(marker_exists(&new).await);

    assert_eq!(read_adoption(&new).await, None);
    assert_eq!(present(&new).await, [false, false]);
    assert!(!marker_exists(&new).await);
    assert_eq!(read_pair(&old).await, 17);
    clean_pair(&old).await;
}

#[wasm_bindgen_test]
async fn a_return_whose_cleanup_fails_still_reports_the_files_returned() {
    let (old, new) = identities("return-cleanup");
    write_pair(&old, 19).await;
    clean_pair(&new).await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    // Removing the marker fails after the main file went back, as it does
    // while another context holds it open. (A marker held open from the
    // start fails the return before anything moves: it reads the marker
    // first.)
    REMOVAL_FAILS_AT.with(|at| at.replace(Some(marker_name(&new))));
    let outcome = give_back(&old, &new).await;
    REMOVAL_FAILS_AT.with(|at| at.replace(None));
    assert_eq!(outcome, ReturnOutcome::Returned);
    assert_eq!(read_pair(&old).await, 19);
    assert!(marker_exists(&new).await);

    // The marker left without a main file reads as no adoption, and goes.
    assert_eq!(read_adoption(&new).await, None);
    assert!(!marker_exists(&new).await);
    assert_eq!(present(&new).await, [false, false]);
    clean_pair(&old).await;
}

#[wasm_bindgen_test]
async fn discarding_or_wiping_ends_the_adoption() {
    let (old, new) = identities("discarded");
    write_pair(&old, 18).await;
    clean_pair(&new).await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    owner.discard_adoption().await.expect("discard");
    assert_eq!(owner.read_adoption().await.expect("read"), None);
    owner.release().await.expect("release");
    assert_eq!(read_pair(&new).await, 18);
    clean_pair(&new).await;

    let (old, new) = identities("wiped");
    write_pair(&old, 19).await;
    clean_pair(&new).await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    let owner = OpfsOwner::acquire(&new).await.expect("owner");
    let owner = owner.recovery_wipe().await.expect("wipe");
    assert!(!marker_exists(&new).await);
    owner.remove_and_release().await.expect("remove");
    assert_eq!(read_adoption(&new).await, None);
    assert_eq!(present(&new).await, [false, false]);

    // A wipe that stops never leaves moved files without their marker:
    // after the marker, nothing is left; after the main file, the marker and
    // the WAL beside no main file are stale.
    let (old, new) = identities("wipe-stopped");
    write_pair(&old, 20).await;
    clean_pair(&new).await;
    for fault in [ResetFault::MarkerRemoved, ResetFault::MainRemoved] {
        assert_eq!(
            adopt_into(&old, &new).await,
            AdoptOutcome::Adopted,
            "{fault:?}"
        );
        let owner = OpfsOwner::acquire(&new).await.expect("owner");
        REGISTRY.with(|registry| registry.borrow_mut().faults.reset_fault = Some(fault));
        let failure = owner.recovery_wipe().await.expect_err("stopped wipe");
        assert_eq!(failure.error().kind(), OpfsErrorKind::Remove, "{fault:?}");
        replace_poisoned_registry_for_test().await;
        assert!(!present(&new).await[0], "{fault:?}");
        assert_eq!(read_adoption(&new).await, None, "{fault:?}");
        assert_eq!(present(&new).await, [false, false], "{fault:?}");
        assert!(!marker_exists(&new).await, "{fault:?}");
        write_pair(&old, 20).await;
    }
    clean_pair(&old).await;
    clean_pair(&new).await;
}

#[wasm_bindgen_test]
async fn attempts_are_counted_beside_the_marker_until_the_adoption_ends() {
    let (old, new) = identities("attempts");
    write_pair(&old, 20).await;
    clean_pair(&new).await;
    // A count an earlier adoption left behind is not this one's.
    write_file(&attempts_name(&new), b"++++++++").await;
    let before = js_sys::Date::now() as u64;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    let after = js_sys::Date::now() as u64;
    let marker = read_file(&marker_name(&new)).await.expect("marker");
    assert_eq!(
        read_file(&attempts_name(&new)).await.as_deref(),
        Some(&b"--------"[..]),
        "written fresh before the move"
    );
    let adopted_at = read_adoption(&new).await.expect("adoption").adopted_at_ms;
    assert!(
        (before..=after).contains(&adopted_at),
        "{before} <= {adopted_at} <= {after}"
    );
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    for counted in 1..=3 {
        assert_eq!(
            owner.record_attempt().await.expect("record attempt"),
            counted
        );
    }
    owner.release().await.expect("release");
    assert_eq!(
        read_file(&attempts_name(&new)).await.as_deref(),
        Some(&b"+++-----"[..]),
        "each attempt overwrote a free slot in place"
    );
    assert_eq!(
        read_file(&marker_name(&new)).await.as_ref(),
        Some(&marker),
        "the marker is never written again"
    );

    // An attempt whose write fails counts nothing.
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    FAIL_ATTEMPT_WRITE.with(|fail| fail.set(true));
    assert_eq!(
        owner.record_attempt().await.map_err(|error| error.kind()),
        Err(OpfsErrorKind::Write)
    );
    assert_eq!(
        read_file(&attempts_name(&new)).await.as_deref(),
        Some(&b"+++-----"[..])
    );
    // Once every slot is used the count stays at eight without writing.
    for counted in 4..=8 {
        assert_eq!(owner.record_attempt().await.expect("record"), counted);
    }
    FAIL_ATTEMPT_WRITE.with(|fail| fail.set(true));
    assert_eq!(owner.record_attempt().await.expect("full"), 8);
    FAIL_ATTEMPT_WRITE.with(|fail| fail.set(false));
    owner.release().await.expect("release");
    assert_eq!(
        read_file(&attempts_name(&new)).await.as_deref(),
        Some(&b"++++++++"[..])
    );
    // A count that is not exactly its eight slots counts nothing, so one cut
    // short never spends attempts nobody made.
    for wrong in [&b"-----"[..], &b"---------"[..]] {
        write_file(&attempts_name(&new), wrong).await;
        let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
        assert_eq!(
            owner.record_attempt().await.map_err(|error| error.kind()),
            Err(OpfsErrorKind::Write),
            "{} bytes",
            wrong.len()
        );
        owner.release().await.expect("release");
        assert_eq!(
            read_file(&attempts_name(&new)).await.as_deref(),
            Some(wrong)
        );
    }
    assert_eq!(open_and_finish(&new).await, 20);
    assert_eq!(read_file(&attempts_name(&new)).await, None);

    // Nothing to count once the adoption ended.
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    assert_eq!(
        owner.record_attempt().await.map_err(|error| error.kind()),
        Err(OpfsErrorKind::Write)
    );
    assert!(!marker_exists(&new).await);
    owner.release().await.expect("release");

    // Nor in a count its marker left behind, whatever it says.
    write_file(&attempts_name(&new), b"+++-----").await;
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    assert_eq!(
        owner.record_attempt().await.map_err(|error| error.kind()),
        Err(OpfsErrorKind::Write)
    );
    assert_eq!(owner.read_adoption().await.expect("read"), None);
    owner.release().await.expect("release");
    assert_eq!(
        read_file(&attempts_name(&new)).await.as_deref(),
        Some(&b"+++-----"[..])
    );
    clean_pair(&new).await;
}

#[wasm_bindgen_test]
async fn a_count_that_cannot_be_removed_holds_no_wipe_or_removal_back() {
    // The count beside a marker stays open somewhere. A wipe still removes
    // the pair and the marker and recreates the pair, a removal still
    // removes everything else, and the count left behind counts nothing.
    let (old, new) = identities("held-count-wipe");
    write_pair(&old, 21).await;
    clean_pair(&new).await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    let root = worker_root().await.expect("root");
    let (held, _) = open_sync_handle(&root, &attempts_name(&new), BusyDeadline::start())
        .await
        .expect("hold the count open");
    let owner = OpfsOwner::acquire(&new).await.expect("owner");
    let owner = owner.recovery_wipe().await.expect("wipe");
    assert!(!marker_exists(&new).await);
    assert_eq!(present(&new).await, [true, true]);
    owner.remove_and_release().await.expect("remove");
    assert_eq!(present(&new).await, [false, false]);
    close_sync_handle(&held).expect("close the count");
    assert_eq!(
        read_file(&attempts_name(&new)).await.as_deref(),
        Some(&FREE_ATTEMPTS[..])
    );
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    assert_eq!(
        owner.record_attempt().await.map_err(|error| error.kind()),
        Err(OpfsErrorKind::Write)
    );
    assert_eq!(owner.read_adoption().await.expect("read"), None);
    owner.release().await.expect("release");
    clean_pair(&old).await;
    clean_pair(&new).await;
}

#[wasm_bindgen_test]
async fn a_removal_that_leaves_a_file_keeps_the_marker_beside_it() {
    // Moved files whose first open never succeeded are removed while their
    // WAL stays open somewhere: the main file goes, the WAL stays, and so
    // does the marker, so what is left never reads as this identity's own.
    let (old, new) = identities("removal-held-wal");
    write_pair(&old, 22).await;
    clean_pair(&new).await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    let root = worker_root().await.expect("root");
    let (held, _) = open_sync_handle(&root, &format!("{new}-wal"), BusyDeadline::start())
        .await
        .expect("hold the WAL open");
    let owner = OpfsOwner::acquire(&new).await.expect("owner");
    let removed = owner.remove_and_release().await;
    close_sync_handle(&held).expect("close the WAL");
    assert!(removed.is_err());
    assert_eq!(present(&new).await, [false, true]);
    assert!(marker_exists(&new).await);
    // The next read finds the marker beside no main file and removes it
    // with the WAL.
    assert_eq!(read_adoption(&new).await, None);
    assert!(!marker_exists(&new).await);
    assert_eq!(present(&new).await, [false, false]);
    clean_pair(&old).await;
    clean_pair(&new).await;
}

#[wasm_bindgen_test]
async fn a_read_cut_short_is_an_error_and_moves_or_removes_nothing() {
    // A marker read short fails the read and stays.
    let (old, new) = identities("short-marker-read");
    write_pair(&old, 22).await;
    clean_pair(&new).await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    SHORT_READ.with(|short| short.set(1));
    assert_eq!(
        owner.read_adoption().await.map_err(|error| error.kind()),
        Err(OpfsErrorKind::Read)
    );
    owner.release().await.expect("release");
    assert!(marker_exists(&new).await);
    assert_eq!(moved(&new).await, Some((old, AdoptionState::Complete)));
    clean_pair(&new).await;

    // A recorded WAL read short does not read as a different WAL: the split
    // stays as it was, and completes once the read succeeds.
    let (old, new) = identities("short-wal-read");
    write_pair_with_live_wal(&old, 23).await;
    clean_pair(&new).await;
    adopt_and_stop(&old, &new).await;
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    let lock = owner
        .lock_previous(&old)
        .await
        .expect("lock")
        .expect("free");
    let marker = read_file(&marker_name(&new)).await.expect("marker");
    // The marker read comes first; cut the WAL read that follows it.
    SHORT_READ.with(|short| short.set(2));
    assert_eq!(
        owner
            .complete_adoption(Some(&lock))
            .await
            .map_err(|error| error.kind()),
        Err(OpfsErrorKind::Read)
    );
    lock.release().await.expect("release previous");
    owner.release().await.expect("release");
    assert_eq!(read_file(&marker_name(&new)).await, Some(marker));
    assert_eq!(present(&new).await, [true, false]);
    assert_eq!(present(&old).await, [false, true]);
    assert_eq!(complete(&old, &new, true).await, CompleteOutcome::Completed);
    assert_eq!(open_and_finish(&new).await, 23);
    clean_pair(&new).await;
}

#[wasm_bindgen_test]
async fn attempts_are_counted_while_the_marker_does_not_read() {
    let (old, new) = identities("unread-count");
    write_pair(&old, 24).await;
    clean_pair(&new).await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    for counted in 1..=3 {
        SHORT_READ.with(|short| short.set(1));
        assert_eq!(
            owner.read_adoption().await.map_err(|error| error.kind()),
            Err(OpfsErrorKind::Read)
        );
        assert_eq!(owner.record_attempt().await.expect("count"), counted);
    }
    // The count goes with the marker, however the adoption ends.
    owner.discard_adoption().await.expect("discard");
    owner.release().await.expect("release");
    assert_eq!(read_file(&attempts_name(&new)).await, None);
    clean_pair(&new).await;

    // A wipe removes both, whatever sits at their names.
    let (old, new) = identities("unread-wipe");
    write_pair(&old, 25).await;
    clean_pair(&new).await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    assert_eq!(owner.record_attempt().await.expect("count"), 1);
    let owner = owner.recovery_wipe().await.expect("wipe");
    owner.remove_and_release().await.expect("remove");
    assert_eq!(read_file(&attempts_name(&new)).await, None);
    assert!(!marker_exists(&new).await);

    // No database is named like a count, so none can alias one.
    assert!(approved_paths(&attempts_name(&old)).is_err());

    // When the files beside a marker cannot be looked up, the read fails
    // after the marker read, and the time the marker records still reads.
    let (old, new) = identities("unread-files");
    write_pair(&old, 26).await;
    clean_pair(&new).await;
    let before = js_sys::Date::now() as u64;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    let after = js_sys::Date::now() as u64;
    let root = worker_root().await.expect("root");
    let wal = format!("{new}-wal");
    recursive_remove(&root, &wal).await;
    let directory = FileSystemGetDirectoryOptions::new();
    directory.set_create(true);
    JsFuture::from(root.get_directory_handle_with_options(&wal, &directory))
        .await
        .expect("a directory where the WAL belongs");
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    assert_eq!(
        owner.read_adoption().await.map_err(|error| error.kind()),
        Err(OpfsErrorKind::Move)
    );
    let began = owner
        .read_adoption_time()
        .await
        .expect("the marker reads")
        .expect("a marker");
    assert!(
        (before..=after).contains(&began),
        "{before} <= {began} <= {after}"
    );
    owner.release().await.expect("release");
    assert!(marker_exists(&new).await);
    clean_pair(&new).await;
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    assert_eq!(owner.read_adoption_time().await.expect("no marker"), None);
    owner.release().await.expect("release");
}

#[wasm_bindgen_test]
async fn a_return_without_a_whole_pair_here_is_an_error() {
    let (old, new) = identities("return-split-pair");
    write_pair_with_live_wal(&old, 21).await;
    clean_pair(&new).await;
    adopt_and_stop(&old, &new).await;
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    let lock = owner
        .lock_previous(&old)
        .await
        .expect("lock")
        .expect("free");
    assert_eq!(
        owner
            .return_adoption(&lock)
            .await
            .map_err(|error| error.kind()),
        Err(OpfsErrorKind::Move)
    );
    lock.release().await.expect("release previous");
    owner.release().await.expect("release");
    // Nothing moved: the split still completes.
    assert_eq!(present(&new).await, [true, false]);
    assert_eq!(present(&old).await, [false, true]);
    assert_eq!(complete(&old, &new, true).await, CompleteOutcome::Completed);
    assert_eq!(open_and_finish(&new).await, 21);
    clean_pair(&new).await;
}

#[wasm_bindgen_test]
async fn a_return_goes_only_to_the_identity_the_marker_names() {
    // The lock of an empty identity the marker does not name: nothing moves
    // there, and the adoption still reads as it did.
    let (old, new) = identities("return-other");
    write_pair(&old, 24).await;
    clean_pair(&new).await;
    assert_eq!(adopt_into(&old, &new).await, AdoptOutcome::Adopted);
    let (other, _) = identities("return-other-lock");
    clean_pair(&other).await;
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    let lock = owner
        .lock_previous(&other)
        .await
        .expect("lock")
        .expect("free");
    assert_eq!(
        owner
            .return_adoption(&lock)
            .await
            .map_err(|error| error.kind()),
        Err(OpfsErrorKind::InvalidName)
    );
    lock.release().await.expect("release previous");
    owner.release().await.expect("release");
    assert_eq!(present(&other).await, [false, false]);
    assert_eq!(
        moved(&new).await,
        Some((old.clone(), AdoptionState::Complete))
    );

    // Without a marker the files here are this owner's own: they go nowhere.
    let mut owner = OpfsOwner::acquire(&new).await.expect("owner");
    owner.discard_adoption().await.expect("discard");
    let lock = owner
        .lock_previous(&old)
        .await
        .expect("lock")
        .expect("free");
    assert_eq!(
        owner
            .return_adoption(&lock)
            .await
            .map_err(|error| error.kind()),
        Err(OpfsErrorKind::Move)
    );
    lock.release().await.expect("release previous");
    owner.release().await.expect("release");
    assert_eq!(present(&old).await, [false, false]);
    assert_eq!(read_pair(&new).await, 24);
    clean_pair(&new).await;
}

/// Whether a context that waits for `lock_name` gets it within `ms`.
async fn lock_granted_within(lock_name: &str, ms: u32) -> bool {
    let race = Function::new_with_args(
        "name, ms",
        "return new Promise((resolve) => {
          const timer = setTimeout(() => resolve(false), ms);
          navigator.locks.request(name, { mode: 'exclusive' }, () => {
            clearTimeout(timer);
            resolve(true);
          });
        });",
    );
    let promise = race
        .call2(
            &JsValue::UNDEFINED,
            &JsValue::from_str(lock_name),
            &JsValue::from(ms),
        )
        .expect("lock race")
        .dyn_into::<Promise>()
        .expect("lock race promise");
    JsFuture::from(promise)
        .await
        .expect("lock race settles")
        .as_bool()
        .expect("lock race is boolean")
}

#[wasm_bindgen_test]
async fn a_lock_request_dropped_before_it_returns_lets_the_lock_go() {
    let (old, new) = identities("lock-dropped");
    let owner = OpfsOwner::acquire(&new).await.expect("owner");
    {
        let request = std::pin::pin!(owner.lock_previous(&old));
        assert!(poll_once(request).is_pending());
    }
    // The browser grants the request after it was dropped; the grant ends at
    // once instead of holding the older build out until this worker ends.
    assert!(lock_granted_within(&owner_lock_name(&old), 2_000).await);
    owner.release().await.expect("release");
}
