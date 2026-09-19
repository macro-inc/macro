use super::*;
use std::{
    cell::{Cell, RefCell},
    future::Future,
    rc::Rc,
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicUsize},
    },
    task::{Context, Poll, Waker},
};
use turso_core::{Row, StepResult};
use wasm_bindgen_test::*;
use web_sys::{FileSystemGetDirectoryOptions, FileSystemGetFileOptions, FileSystemRemoveOptions};

wasm_bindgen_test_configure!(run_in_dedicated_worker);

#[derive(Debug)]
struct TrackedCompletion {
    completion: Completion,
    count: Arc<AtomicUsize>,
    result: Arc<Mutex<Option<Result<i32, CompletionError>>>>,
}

fn write_completion() -> TrackedCompletion {
    tracked_completion(Completion::new_write)
}

fn sync_completion() -> TrackedCompletion {
    tracked_completion(Completion::new_sync)
}

fn truncate_completion() -> TrackedCompletion {
    tracked_completion(Completion::new_trunc)
}

fn tracked_completion(
    build: impl FnOnce(Box<dyn Fn(Result<i32, CompletionError>) + Send + Sync>) -> Completion,
) -> TrackedCompletion {
    let count = Arc::new(AtomicUsize::new(0));
    let result = Arc::new(Mutex::new(None));
    let callback_count = count.clone();
    let callback_result = result.clone();
    let callback: Box<dyn Fn(Result<i32, CompletionError>) + Send + Sync> =
        Box::new(move |value| {
            callback_count.fetch_add(1, Ordering::SeqCst);
            *callback_result.lock().expect("tracked callback result") = Some(value);
        });
    TrackedCompletion {
        completion: build(callback),
        count,
        result,
    }
}

fn read_completion(buffer: Arc<Buffer>) -> TrackedCompletion {
    let count = Arc::new(AtomicUsize::new(0));
    let result = Arc::new(Mutex::new(None));
    let callback_count = count.clone();
    let callback_result = result.clone();
    let completion = Completion::new_read(buffer, move |value| {
        callback_count.fetch_add(1, Ordering::SeqCst);
        *callback_result.lock().expect("tracked read result") = Some(
            value
                .as_ref()
                .map(|(_, bytes)| *bytes)
                .map_err(|error| *error),
        );
        None
    });
    TrackedCompletion {
        completion,
        count,
        result,
    }
}

fn assert_completion(tracked: &TrackedCompletion, expected: Result<i32, CompletionError>) {
    assert_eq!(tracked.count.load(Ordering::SeqCst), 1);
    assert_eq!(
        tracked.result.lock().expect("tracked result").as_ref(),
        Some(&expected)
    );
    assert!(tracked.completion.finished());
    assert_eq!(tracked.completion.get_error(), expected.err());
}

fn query_one_i64(connection: &Arc<Connection>, sql: &str) -> turso_core::Result<i64> {
    let mut statement = connection.prepare(sql)?;
    let mut result = None;
    drive_statement(&mut statement, |row| {
        result = Some(row.get::<i64>(0)?);
        Ok(())
    })?;
    result.ok_or_else(|| LimboError::InternalError("query returned no row".into()))
}

fn drive_statement(
    statement: &mut turso_core::Statement,
    mut on_row: impl FnMut(&Row) -> turso_core::Result<()>,
) -> turso_core::Result<()> {
    loop {
        match statement.step()? {
            StepResult::Done => return Ok(()),
            StepResult::Row => on_row(
                statement
                    .row()
                    .ok_or_else(|| LimboError::InternalError("row step had no row".into()))?,
            )?,
            StepResult::IO | StepResult::Yield => statement._io().step()?,
            StepResult::Busy => return Err(LimboError::Busy),
            StepResult::Interrupt => return Err(LimboError::Interrupt),
        }
    }
}

async fn recursive_remove(root: &FileSystemDirectoryHandle, path: &str) {
    let options = FileSystemRemoveOptions::new();
    options.set_recursive(true);
    match JsFuture::from(root.remove_entry_with_options(path, &options)).await {
        Ok(_) => {}
        Err(error) if is_not_found(&error) => {}
        Err(error) => panic!("failed to clean browser test artifact: {error:?}"),
    }
}

async fn clean_pair(database_name: &str) {
    let root = worker_root().await.expect("worker OPFS root");
    recursive_remove(&root, database_name).await;
    recursive_remove(&root, &format!("{database_name}-wal")).await;
}

async fn replace_poisoned_registry_for_test() {
    let (handles, pending, lock) = REGISTRY.with(|registry| {
        let mut registry = registry.borrow_mut();
        (
            std::mem::take(&mut registry.handles),
            registry.pending_lock.take(),
            registry.owner_lock.take(),
        )
    });
    for entry in handles.into_values() {
        let _ = close_sync_handle(&entry.handle);
    }
    if let Some(pending) = pending {
        pending.controller.abort();
    }
    if let Some(lock) = lock {
        let _ = lock.release.call0(&JsValue::UNDEFINED);
        if let Some(request) = lock.request {
            let _ = JsFuture::from(request).await;
        }
    }
    REGISTRY.with(|registry| *registry.borrow_mut() = Registry::default());
}

async fn open_ready(owner: OpfsOwner) -> OpfsSession {
    match owner.open().await.expect("pre-open OPFS pair") {
        OpenResult::Ready(session) => session,
        OpenResult::ResetRequired(_) => panic!("expected a complete OPFS pair"),
    }
}

fn connect_ready(session: OpfsSession) -> ConnectedOpfsSession {
    session
        .connect()
        .expect("open sole production Turso connection")
}

async fn fresh_closed(database_name: &str) -> ClosedSession {
    let owner = OpfsOwner::acquire(database_name)
        .await
        .expect("identity-bound owner");
    let owner = owner.recovery_wipe().await.expect("fresh recovery wipe");
    connect_ready(open_ready(owner).await)
        .try_close()
        .expect("adapter-driven close")
}

struct RawHeldLock {
    release: Function,
    request: Promise,
    _grant: Function,
}

impl RawHeldLock {
    async fn release(self) {
        self.release
            .call0(&JsValue::UNDEFINED)
            .expect("release raw test Web Lock");
        JsFuture::from(self.request)
            .await
            .expect("raw test Web Lock settles");
    }
}

async fn acquire_raw_web_lock(lock_name: &str) -> RawHeldLock {
    let worker = js_sys::global()
        .dyn_into::<DedicatedWorkerGlobalScope>()
        .expect("DedicatedWorker raw lock");
    let manager = Reflect::get(worker.navigator().as_ref(), &JsValue::from_str("locks"))
        .expect("raw Web Lock manager");
    let mut granted_resolve = None;
    let granted = Promise::new(&mut |resolve, _reject| granted_resolve = Some(resolve.clone()));
    let granted_resolve = granted_resolve.expect("granted resolver");
    let release_slot = Rc::new(RefCell::new(None));
    let callback_release = release_slot.clone();
    let grant = Closure::wrap(Box::new(move |lock: JsValue| -> Promise {
        assert!(!lock.is_null() && !lock.is_undefined());
        let mut release_resolve = None;
        let held = Promise::new(&mut |resolve, _reject| release_resolve = Some(resolve.clone()));
        *callback_release.borrow_mut() = release_resolve;
        let _ = granted_resolve.call1(&JsValue::UNDEFINED, &JsValue::TRUE);
        held
    }) as Box<dyn FnMut(JsValue) -> Promise>)
    .into_js_value()
    .unchecked_into::<Function>();
    let options = Object::new();
    Reflect::set(
        options.as_ref(),
        &JsValue::from_str("mode"),
        &JsValue::from_str("exclusive"),
    )
    .expect("raw lock mode");
    let request = Reflect::get(&manager, &JsValue::from_str("request"))
        .expect("raw request property")
        .dyn_into::<Function>()
        .expect("raw request function")
        .call3(
            &manager,
            &JsValue::from_str(lock_name),
            options.as_ref(),
            grant.as_ref(),
        )
        .expect("raw lock request")
        .dyn_into::<Promise>()
        .expect("raw request promise");
    JsFuture::from(granted).await.expect("raw Web Lock granted");
    let release = release_slot
        .borrow_mut()
        .take()
        .expect("raw lock release resolver");
    RawHeldLock {
        release,
        request,
        _grant: grant,
    }
}

async fn yield_tasks_until(mut condition: impl FnMut() -> bool) {
    for _ in 0..32 {
        if condition() {
            return;
        }
        let task = Promise::new(&mut |resolve, reject| {
            let result = Reflect::get(&js_sys::global(), &JsValue::from_str("setTimeout"))
                .and_then(|value| value.dyn_into::<Function>())
                .and_then(|set_timeout| {
                    set_timeout.call2(&js_sys::global(), resolve.as_ref(), &JsValue::from_f64(0.0))
                });
            if let Err(error) = result {
                let _ = reject.call1(&JsValue::UNDEFINED, &error);
            }
        });
        JsFuture::from(task).await.expect("browser task yield");
    }
    assert!(
        condition(),
        "condition did not settle after browser task yields"
    );
}

async fn web_lock_available(lock_name: &str) -> bool {
    let worker = js_sys::global()
        .dyn_into::<DedicatedWorkerGlobalScope>()
        .expect("DedicatedWorker lock probe");
    let manager = Reflect::get(worker.navigator().as_ref(), &JsValue::from_str("locks"))
        .expect("Web Lock manager");
    let options = Object::new();
    Reflect::set(
        options.as_ref(),
        &JsValue::from_str("mode"),
        &JsValue::from_str("exclusive"),
    )
    .expect("lock mode");
    Reflect::set(
        options.as_ref(),
        &JsValue::from_str("ifAvailable"),
        &JsValue::TRUE,
    )
    .expect("ifAvailable");
    let observed = Rc::new(Cell::new(None));
    let callback_observed = observed.clone();
    let callback = Closure::wrap(Box::new(move |lock: JsValue| -> Promise {
        callback_observed.set(Some(!lock.is_null() && !lock.is_undefined()));
        Promise::resolve(&JsValue::UNDEFINED)
    }) as Box<dyn FnMut(JsValue) -> Promise>);
    let request = Reflect::get(&manager, &JsValue::from_str("request"))
        .expect("request property")
        .dyn_into::<Function>()
        .expect("request function")
        .call3(
            &manager,
            &JsValue::from_str(lock_name),
            options.as_ref(),
            callback.as_ref().unchecked_ref::<Function>().as_ref(),
        )
        .expect("request lock probe")
        .dyn_into::<Promise>()
        .expect("request promise");
    JsFuture::from(request).await.expect("lock probe completes");
    observed.get().expect("lock callback observed")
}

fn poll_once<F: Future>(mut future: std::pin::Pin<&mut F>) -> Poll<F::Output> {
    let waker = Waker::noop();
    let mut context = Context::from_waker(waker);
    future.as_mut().poll(&mut context)
}

fn assert_poisoned() {
    assert!(REGISTRY.with(|registry| registry.borrow().machine.is_poisoned()));
}

#[wasm_bindgen_test]
async fn real_worker_opfs_contract_and_consuming_lifecycle() {
    let nonce = js_sys::Date::now() as u64;
    let database_name = format!("wp05-{nonce}.db");
    let wal_name = format!("{database_name}-wal");
    clean_pair(&database_name).await;

    assert_eq!(
        OpfsOwner::acquire("")
            .await
            .expect_err("empty database identity")
            .kind(),
        OpfsErrorKind::InvalidName
    );
    assert_eq!(
        OpfsOwner::acquire("nested/cache.db")
            .await
            .expect_err("database identity must be a direct child")
            .kind(),
        OpfsErrorKind::InvalidName
    );
    assert_eq!(
        OpfsOwner::acquire(&format!("{database_name}-wal"))
            .await
            .expect_err("a WAL path cannot become a second canonical identity")
            .kind(),
        OpfsErrorKind::InvalidName
    );

    // Cancellation before grant keeps JS-owned callbacks alive until the
    // aborted request rejects, then clears the pending capability without a
    // trap or leaked lock.
    let queued_db = format!("wp05-lock-queued-{nonce}.db");
    let queued_lock_name = owner_lock_name(&queued_db);
    let blocker = acquire_raw_web_lock(&queued_lock_name).await;
    let mut queued_acquire = Box::pin(OpfsOwner::acquire(&queued_db));
    assert!(matches!(poll_once(queued_acquire.as_mut()), Poll::Pending));
    assert!(REGISTRY.with(|registry| registry.borrow().pending_lock.is_some()));
    drop(queued_acquire);
    yield_tasks_until(|| REGISTRY.with(|registry| registry.borrow().pending_lock.is_none())).await;
    assert!(REGISTRY.with(|registry| registry.borrow().owner_lock.is_none()));
    assert_eq!(
        REGISTRY.with(|registry| registry.borrow().machine.phase_label()),
        "unowned"
    );
    blocker.release().await;
    assert!(web_lock_available(&queued_lock_name).await);

    // If the browser grants before Rust polls the acquisition future again,
    // dropping that future poisons, releases, and retains all JS callbacks
    // until the held request fulfills.
    let granted_db = format!("wp05-lock-granted-{nonce}.db");
    let granted_lock_name = owner_lock_name(&granted_db);
    let mut granted_acquire = Box::pin(OpfsOwner::acquire(&granted_db));
    assert!(matches!(poll_once(granted_acquire.as_mut()), Poll::Pending));
    yield_tasks_until(|| REGISTRY.with(|registry| registry.borrow().owner_lock.is_some())).await;
    assert!(REGISTRY.with(|registry| registry.borrow().pending_lock.is_some()));
    drop(granted_acquire);
    yield_tasks_until(|| {
        REGISTRY.with(|registry| {
            let registry = registry.borrow();
            registry.pending_lock.is_none() && registry.owner_lock.is_none()
        })
    })
    .await;
    assert_poisoned();
    assert!(web_lock_available(&granted_lock_name).await);
    replace_poisoned_registry_for_test().await;

    let mut owner = OpfsOwner::acquire(&database_name)
        .await
        .expect("physical owner Web Lock");
    assert_eq!(owner.database_path(), database_name);
    assert_eq!(owner.lock_name(), owner_lock_name(&database_name));
    assert!(!web_lock_available(owner.lock_name()).await);
    assert_eq!(
        OpfsOwner::acquire("other.db")
            .await
            .expect_err("one worker cannot own a second capability")
            .kind(),
        OpfsErrorKind::Ownership
    );

    REGISTRY.with(|registry| registry.borrow_mut().faults.fail_open = Some(FileRole::Wal));
    let failure = owner
        .open()
        .await
        .expect_err("injected WAL pre-open failure");
    assert_eq!(failure.error().kind(), OpfsErrorKind::Open);
    owner = failure
        .into_owner()
        .expect("certain partial-open cleanup returns locked owner");
    assert_eq!(
        REGISTRY.with(|registry| registry.borrow().machine.phase_label()),
        "idle"
    );
    assert!(REGISTRY.with(|registry| registry.borrow().handles.is_empty()));

    let incomplete = match owner.open().await.expect("detect one-sided pair") {
        OpenResult::ResetRequired(incomplete) => incomplete,
        OpenResult::Ready(_) => panic!("one-sided pair must never expose Turso I/O"),
    };
    assert_eq!(incomplete.database_path(), database_name);
    owner = incomplete
        .reset()
        .await
        .expect("reset-only type removes and recreates both paths");

    let session = open_ready(owner).await;
    assert_eq!(session.disposition(), OpenDisposition::Fresh);
    assert_eq!(session.database_path(), database_name);
    assert_eq!(session.wal_path(), wal_name);

    // Internal-only direct adapter checks. Production callers cannot obtain
    // this I/O; they can only consume OpfsSession::connect.
    {
        let io = session.io.clone();
        let main = io
            .open_file(&database_name, OpenFlags::Create, true)
            .expect("approved main flags");
        let wal = io
            .open_file(&wal_name, OpenFlags::Create, false)
            .expect("approved WAL flags");
        assert!(
            io.open_file("unregistered.db", OpenFlags::Create, true)
                .is_err()
        );
        assert!(
            io.open_file(&database_name, OpenFlags::ReadOnly, true)
                .is_err()
        );
        assert!(
            io.open_file(&database_name, OpenFlags::Create | OpenFlags::NoLock, true,)
                .is_err()
        );
        assert!(io.open_file(&wal_name, OpenFlags::Create, true).is_err());
        assert!(io.remove_file(&database_name).is_err());
        assert_eq!(
            io.file_id(&database_name).expect("registered file ID"),
            FileId::from_path_hash(&database_name)
        );
        main.lock_file(true)
            .expect("owner lock makes file lock a no-op");
        main.unlock_file().expect("owner unlock no-op");
        // Monotonic clock samples are strictly increasing.
        assert!(io.current_time_monotonic() < io.current_time_monotonic());
        // Wall-clock micros is the sub-second microsecond component.
        assert!(io.current_time_wall_clock().micros < 1_000_000);

        let empty = write_completion();
        drop(
            main.pwrite(
                u64::MAX,
                Arc::new(Buffer::new(Vec::new())),
                empty.completion.clone(),
            )
            .expect("empty write submission"),
        );
        assert_completion(&empty, Ok(0));

        REGISTRY.with(|registry| registry.borrow_mut().faults.max_write_chunk = Some(2));
        let partial = write_completion();
        drop(
            main.pwrite(
                0,
                Arc::new(Buffer::new(b"abcdef".to_vec())),
                partial.completion.clone(),
            )
            .expect("partial write retry submission"),
        );
        assert_completion(&partial, Ok(6));
        REGISTRY.with(|registry| registry.borrow_mut().faults.max_write_chunk = None);

        let vectored = write_completion();
        drop(
            main.pwritev(
                6,
                vec![
                    Arc::new(Buffer::new(b"12".to_vec())),
                    Arc::new(Buffer::new(b"34".to_vec())),
                ],
                vectored.completion.clone(),
            )
            .expect("vectored write submission"),
        );
        assert_completion(&vectored, Ok(4));
        assert_eq!(main.size().expect("size after writes"), 10);

        let before_overflow = main.size().expect("size before overflow probes");
        let overflow = write_completion();
        drop(
            main.pwrite(
                MAX_SAFE_INTEGER,
                Arc::new(Buffer::new(vec![1])),
                overflow.completion.clone(),
            )
            .expect("overflow submission completes through callback"),
        );
        assert_completion(
            &overflow,
            Err(CompletionError::IOError(
                ErrorKind::InvalidInput,
                "OPFS write end exceeds JavaScript safe integer",
            )),
        );
        assert_eq!(
            main.size().expect("pwrite overflow is mutation-free"),
            before_overflow
        );

        let vectored_overflow = write_completion();
        drop(
            main.pwritev(
                MAX_SAFE_INTEGER - 1,
                vec![
                    Arc::new(Buffer::new(vec![1])),
                    Arc::new(Buffer::new(vec![2])),
                ],
                vectored_overflow.completion.clone(),
            )
            .expect("vectored overflow submission"),
        );
        assert_completion(
            &vectored_overflow,
            Err(CompletionError::IOError(
                ErrorKind::InvalidInput,
                "OPFS write end exceeds JavaScript safe integer",
            )),
        );
        assert_eq!(
            main.size().expect("pwritev overflow is mutation-free"),
            before_overflow
        );
        assert_eq!(
            preflight_write_range(0, [i32::MAX as usize, 1]),
            Err(CompletionError::ShortWrite)
        );

        let truncate = truncate_completion();
        drop(
            main.truncate(0, truncate.completion.clone())
                .expect("clear direct test bytes"),
        );
        assert_completion(&truncate, Ok(0));
        let injected = CompletionError::IOError(ErrorKind::StorageFull, "injected partial error");
        REGISTRY.with(|registry| {
            let mut registry = registry.borrow_mut();
            registry.faults.max_write_chunk = Some(2);
            registry.faults.write_error_after_chunks = Some((1, injected));
        });
        let partial_error = write_completion();
        drop(
            main.pwrite(
                0,
                Arc::new(Buffer::new(b"abcdef".to_vec())),
                partial_error.completion.clone(),
            )
            .expect("partial-then-error submission"),
        );
        assert_completion(&partial_error, Err(injected));
        assert_eq!(main.size().expect("first chunk was physically written"), 2);
        let partial_bytes = Arc::new(Buffer::new(vec![0; 2]));
        let partial_read = read_completion(partial_bytes.clone());
        drop(
            main.pread(0, partial_read.completion.clone())
                .expect("read partial runtime write"),
        );
        assert_completion(&partial_read, Ok(2));
        assert_eq!(partial_bytes.as_slice(), b"ab");
        REGISTRY.with(|registry| registry.borrow_mut().faults.max_write_chunk = None);

        let clear = truncate_completion();
        drop(
            main.truncate(0, clear.completion.clone())
                .expect("restore blank Turso main file"),
        );
        assert_completion(&clear, Ok(0));
        let sync = sync_completion();
        drop(
            main.sync(sync.completion.clone(), FileSyncType::Fsync)
                .expect("sync blank file"),
        );
        assert_completion(&sync, Ok(0));

        let reentrant_rejected = Arc::new(AtomicBool::new(false));
        let callback_file = main.clone();
        let callback_observation = reentrant_rejected.clone();
        let reentrant = Completion::new_write(move |_| {
            callback_observation.store(callback_file.size().is_err(), Ordering::SeqCst);
        });
        drop(
            main.pwrite(0, Arc::new(Buffer::new(Vec::new())), reentrant.clone())
                .expect("reentrancy callback probe"),
        );
        assert!(reentrant.finished());
        assert!(reentrant_rejected.load(Ordering::SeqCst));
        drop((main, wal, io));
    }

    let stale_owner = session.owner;
    let stale_session = session.session;
    let connected = connect_ready(session);
    let connection = connected.connection();
    connection
        .execute("CREATE TABLE persistence (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
        .expect("create persistence table");
    connection
        .execute("INSERT INTO persistence (id, value) VALUES (1, 'preserved')")
        .expect("insert persistence marker");
    assert_eq!(
        query_one_i64(&connection, "SELECT COUNT(*) FROM persistence")
            .expect("query persistence count"),
        1
    );

    let close_failure = connected
        .try_close()
        .expect_err("connection clone proves graceful close was omitted");
    assert_eq!(
        close_failure.error().kind(),
        OpfsErrorKind::ActiveReferences
    );
    let connected = close_failure
        .into_session()
        .expect("pre-close rejection returns connected session");
    assert!(!connection.is_closed());
    let connection_weak = Arc::downgrade(&connection);
    drop(connection);
    let close_calls = REGISTRY.with(|registry| registry.borrow().faults.connection_close_calls);
    let closed = connected
        .try_close()
        .expect("adapter calls and proves Connection::close success");
    assert_eq!(
        REGISTRY.with(|registry| registry.borrow().faults.connection_close_calls),
        close_calls + 1
    );
    assert!(connection_weak.upgrade().is_none());

    let valid_token = closed.token;
    let invalid = ClosedSession {
        owner: closed.owner,
        token: CloseToken::from_raw(valid_token.get() + 1),
        armed: true,
    };
    assert_eq!(
        invalid.preserve().expect_err("invalid close token").kind(),
        OpfsErrorKind::Lifecycle
    );
    assert_eq!(
        REGISTRY.with(|registry| registry.borrow().machine.phase_label()),
        "closed"
    );
    let closed = ClosedSession {
        owner: stale_owner,
        token: valid_token,
        armed: true,
    };
    owner = closed.preserve().expect("valid one-use preserve");

    let session = open_ready(owner).await;
    assert_eq!(session.disposition(), OpenDisposition::Existing);
    let connected = connect_ready(session);
    let connection = connected.connection();
    assert_eq!(
        query_one_i64(&connection, "SELECT COUNT(*) FROM persistence")
            .expect("preserved row count"),
        1
    );
    drop(connection);
    owner = connected
        .try_close()
        .expect("close preserved Turso session")
        .reset()
        .await
        .expect("delete and recreate complete pair");
    assert!(REGISTRY.with(|registry| {
        registry
            .borrow_mut()
            .machine
            .preserve(stale_owner, valid_token)
            .is_err()
    }));
    assert_eq!(
        REGISTRY.with(|registry| registry.borrow().machine.phase_label()),
        "idle"
    );

    let stale_io = OpfsIo {
        owner: stale_owner,
        session: stale_session,
        references: Arc::new(SessionReferences),
        last_monotonic_nanos: AtomicU64::new(0),
    };
    assert!(
        stale_io
            .open_file(&database_name, OpenFlags::Create, true)
            .is_err()
    );
    assert_eq!(
        REGISTRY.with(|registry| registry.borrow().machine.phase_label()),
        "idle"
    );

    let session = open_ready(owner).await;
    assert_eq!(session.disposition(), OpenDisposition::Fresh);
    {
        let io = session.io.clone();
        let main = io
            .open_file(&database_name, OpenFlags::Create, true)
            .expect("recreated main");
        let wal = io
            .open_file(&wal_name, OpenFlags::Create, false)
            .expect("recreated WAL");
        assert_eq!(main.size().expect("recreated main is empty"), 0);
        assert_eq!(wal.size().expect("recreated WAL is empty"), 0);
    }
    let connected = connect_ready(session);
    let closed = connected.try_close().expect("close recreated pair");
    owner = closed.preserve().expect("preserve recreated pair");
    let lock_name = owner.lock_name().to_owned();
    owner
        .release()
        .await
        .expect("prove physical Web Lock release");
    assert!(web_lock_available(&lock_name).await);
    clean_pair(&database_name).await;

    // Recovery wipe recursively resolves a pre-open directory conflict while
    // the bound owner lock is physically held.
    let recovery_db = format!("wp05-recovery-{nonce}.db");
    let root = worker_root().await.expect("recovery root");
    let directory_options = FileSystemGetDirectoryOptions::new();
    directory_options.set_create(true);
    let conflict =
        JsFuture::from(root.get_directory_handle_with_options(&recovery_db, &directory_options))
            .await
            .expect("conflicting main directory")
            .dyn_into::<FileSystemDirectoryHandle>()
            .expect("directory conflict type");
    let child_options = FileSystemGetFileOptions::new();
    child_options.set_create(true);
    JsFuture::from(conflict.get_file_handle_with_options("child", &child_options))
        .await
        .expect("non-empty conflict");
    owner = OpfsOwner::acquire(&recovery_db)
        .await
        .expect("recovery owner");
    owner = owner
        .recovery_wipe()
        .await
        .expect("owner-bound pre-open recovery wipe");
    let connected = connect_ready(open_ready(owner).await);
    owner = connected
        .try_close()
        .expect("close recovery pair")
        .preserve()
        .expect("preserve recovery pair");
    owner.release().await.expect("release recovery lock");
    clean_pair(&recovery_db).await;

    // Cancellation after start_reset enters Resetting and the armed future
    // guard poisons on drop.
    let cancel_db = format!("wp05-cancel-{nonce}.db");
    let closed = fresh_closed(&cancel_db).await;
    let mut reset = Box::pin(closed.reset());
    assert!(matches!(poll_once(reset.as_mut()), Poll::Pending));
    assert_eq!(
        REGISTRY.with(|registry| registry.borrow().machine.phase_label()),
        "resetting"
    );
    drop(reset);
    assert_poisoned();
    replace_poisoned_registry_for_test().await;
    clean_pair(&cancel_db).await;

    for (suffix, fault, expected_kind) in [
        (
            "remove",
            ResetFault::AfterMainRemoval,
            OpfsErrorKind::Remove,
        ),
        (
            "recreate",
            ResetFault::AfterMainRecreate,
            OpfsErrorKind::Recreate,
        ),
    ] {
        let db = format!("wp05-{suffix}-{nonce}.db");
        let closed = fresh_closed(&db).await;
        REGISTRY.with(|registry| registry.borrow_mut().faults.reset_fault = Some(fault));
        let failure = closed
            .reset()
            .await
            .expect_err("partial reset failure must poison");
        assert_eq!(failure.error().kind(), expected_kind);
        assert_poisoned();
        replace_poisoned_registry_for_test().await;
        clean_pair(&db).await;
    }

    // Adapter-driven Connection::close failure is consuming and poison-only.
    let close_fail_db = format!("wp05-close-fail-{nonce}.db");
    let owner = OpfsOwner::acquire(&close_fail_db)
        .await
        .expect("close-failure owner")
        .recovery_wipe()
        .await
        .expect("close-failure wipe");
    let connected = connect_ready(open_ready(owner).await);
    REGISTRY.with(|registry| registry.borrow_mut().faults.fail_connection_close = true);
    let failure = connected
        .try_close()
        .expect_err("injected Turso close failure");
    assert_eq!(failure.error().kind(), OpfsErrorKind::Turso);
    assert!(failure.into_session().is_none());
    assert_poisoned();
    replace_poisoned_registry_for_test().await;
    clean_pair(&close_fail_db).await;

    // Pinned Turso marks a connection closed before shutdown checkpoint can
    // fail. A faithful out-of-band marked-then-error sequence must therefore
    // never be accepted later as a healthy adapter-driven close.
    let out_of_band_db = format!("wp05-out-of-band-close-{nonce}.db");
    let owner = OpfsOwner::acquire(&out_of_band_db)
        .await
        .expect("out-of-band owner")
        .recovery_wipe()
        .await
        .expect("out-of-band wipe");
    let connected = connect_ready(open_ready(owner).await);
    let connection = connected.connection();
    assert!(inject_out_of_band_marked_close_failure(&connection).is_err());
    assert!(connection.is_closed());
    drop(connection);
    let failure = connected
        .try_close()
        .expect_err("already-closed connection must poison");
    assert_eq!(failure.error().kind(), OpfsErrorKind::Turso);
    assert!(failure.into_session().is_none());
    assert_poisoned();
    replace_poisoned_registry_for_test().await;
    clean_pair(&out_of_band_db).await;

    // Open/storage failures preserve storage-full classification but never
    // return a reusable ready session. Recovery is replacement + canonical
    // lock reacquisition + wipe-before-open.
    let storage_fail_db = format!("wp05-storage-fail-{nonce}.db");
    let owner = OpfsOwner::acquire(&storage_fail_db)
        .await
        .expect("storage-failure owner")
        .recovery_wipe()
        .await
        .expect("storage-failure wipe");
    let session = open_ready(owner).await;
    REGISTRY.with(|registry| {
        registry.borrow_mut().faults.database_open_error = Some(CompletionError::IOError(
            ErrorKind::StorageFull,
            "injected database storage recovery",
        ));
    });
    let failure = session
        .connect()
        .expect_err("database open/storage failure must poison");
    assert_eq!(failure.error().kind(), OpfsErrorKind::StorageFull);
    assert_poisoned();
    replace_poisoned_registry_for_test().await;
    let owner = OpfsOwner::acquire(&storage_fail_db)
        .await
        .expect("replacement storage owner")
        .recovery_wipe()
        .await
        .expect("replacement recovery wipe");
    let connected = connect_ready(open_ready(owner).await);
    let owner = connected
        .try_close()
        .expect("replacement closes cleanly")
        .preserve()
        .expect("replacement preserve");
    owner.release().await.expect("release replacement lock");
    clean_pair(&storage_fail_db).await;

    let connect_fail_db = format!("wp05-connect-fail-{nonce}.db");
    let owner = OpfsOwner::acquire(&connect_fail_db)
        .await
        .expect("connect-failure owner")
        .recovery_wipe()
        .await
        .expect("connect-failure wipe");
    let session = open_ready(owner).await;
    REGISTRY.with(|registry| {
        registry.borrow_mut().faults.database_connect_error = Some(CompletionError::IOError(
            ErrorKind::Other,
            "injected database connect failure",
        ));
    });
    let failure = session
        .connect()
        .expect_err("database connect failure must poison");
    assert_eq!(failure.error().kind(), OpfsErrorKind::Turso);
    assert_poisoned();
    replace_poisoned_registry_for_test().await;
    clean_pair(&connect_fail_db).await;

    // Omitting the consuming close transition poisons on drop.
    let omit_db = format!("wp05-omit-close-{nonce}.db");
    let owner = OpfsOwner::acquire(&omit_db)
        .await
        .expect("omitted-close owner")
        .recovery_wipe()
        .await
        .expect("omitted-close wipe");
    drop(connect_ready(open_ready(owner).await));
    assert_poisoned();
    replace_poisoned_registry_for_test().await;
    clean_pair(&omit_db).await;

    let incomplete_drop_db = format!("wp05-incomplete-drop-{nonce}.db");
    let root = worker_root().await.expect("incomplete-drop root");
    let create = FileSystemGetFileOptions::new();
    create.set_create(true);
    JsFuture::from(root.get_file_handle_with_options(&incomplete_drop_db, &create))
        .await
        .expect("create one-sided main path");
    let owner = OpfsOwner::acquire(&incomplete_drop_db)
        .await
        .expect("incomplete-drop owner");
    let incomplete = match owner.open().await.expect("one-sided open") {
        OpenResult::ResetRequired(incomplete) => incomplete,
        OpenResult::Ready(_) => panic!("one-sided drop probe must be reset-only"),
    };
    drop(incomplete);
    assert_poisoned();
    replace_poisoned_registry_for_test().await;
    clean_pair(&incomplete_drop_db).await;

    // Browser-invalid state for a registered active handle is an ownership
    // invariant failure: ErrorKind::Other plus poison, never WouldBlock.
    let invalid_db = format!("wp05-invalid-handle-{nonce}.db");
    let owner = OpfsOwner::acquire(&invalid_db)
        .await
        .expect("invalid-handle owner")
        .recovery_wipe()
        .await
        .expect("invalid-handle wipe");
    let session = open_ready(owner).await;
    let io = session.io.clone();
    let main = io
        .open_file(&invalid_db, OpenFlags::Create, true)
        .expect("registered main before invalidation");
    let registered_main = REGISTRY.with(|registry| {
        registry
            .borrow()
            .handles
            .values()
            .find(|entry| entry.role == FileRole::Main)
            .expect("registered main handle")
            .handle
            .clone()
    });
    close_sync_handle(&registered_main).expect("externally invalidate active handle in test");
    let error = main.size().expect_err("invalid active handle must fail");
    assert!(matches!(
        error,
        LimboError::CompletionError(CompletionError::IOError(ErrorKind::Other, _))
    ));
    assert_poisoned();
    drop((main, io, session));
    replace_poisoned_registry_for_test().await;
    clean_pair(&invalid_db).await;

    // Armed owner and close-token drops also poison and begin lock release.
    let owner_drop_db = format!("wp05-owner-drop-{nonce}.db");
    drop(
        OpfsOwner::acquire(&owner_drop_db)
            .await
            .expect("owner drop capability"),
    );
    assert_poisoned();
    replace_poisoned_registry_for_test().await;

    let token_drop_db = format!("wp05-token-drop-{nonce}.db");
    drop(fresh_closed(&token_drop_db).await);
    assert_poisoned();
    replace_poisoned_registry_for_test().await;
    clean_pair(&token_drop_db).await;

    // Uncertain partial-open and handle-close cleanup retain no reusable type.
    let uncertain_open_db = format!("wp05-open-poison-{nonce}.db");
    let owner = OpfsOwner::acquire(&uncertain_open_db)
        .await
        .expect("uncertain-open owner");
    REGISTRY.with(|registry| {
        let mut registry = registry.borrow_mut();
        registry.faults.fail_open = Some(FileRole::Wal);
        registry.faults.fail_close = Some(FileRole::Main);
    });
    let failure = owner
        .open()
        .await
        .expect_err("uncertain partial-open cleanup");
    assert_eq!(failure.error().kind(), OpfsErrorKind::Poisoned);
    assert!(failure.into_owner().is_none());
    assert_poisoned();
    replace_poisoned_registry_for_test().await;
    clean_pair(&uncertain_open_db).await;

    let uncertain_close_db = format!("wp05-handle-close-{nonce}.db");
    let owner = OpfsOwner::acquire(&uncertain_close_db)
        .await
        .expect("uncertain-handle-close owner")
        .recovery_wipe()
        .await
        .expect("uncertain-handle-close wipe");
    let connected = connect_ready(open_ready(owner).await);
    REGISTRY.with(|registry| registry.borrow_mut().faults.fail_close = Some(FileRole::Wal));
    let failure = connected
        .try_close()
        .expect_err("uncertain sync handle close");
    assert_eq!(failure.error().kind(), OpfsErrorKind::Close);
    assert!(failure.into_session().is_none());
    assert_poisoned();
    replace_poisoned_registry_for_test().await;
    clean_pair(&uncertain_close_db).await;
}
