use super::*;
use crate::engine::EngineHandle;
use cache_turso::TursoStorage;
use pollster::block_on;
use serde_json::{Value as Json, json};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

const URL: &str = "https://example.test/items/soup/graphql/stream";
const TASKS: &str = "query SyncTasks($input: SoupInput!) { user { id soup(input: $input) { items { __typename id ... on GraphqlSoupDocument { name } } nextCursor } } }";
const TASK_IDS: &str = "query SyncTaskIds($input: SoupInput!) { user { id soup(input: $input) { items { __typename id } nextCursor } } }";
const PASS: &str = "2026-11-01T00:00:00.000Z";

/// One body read: bytes, a read that never finishes (after reporting that
/// the run reached it), or a signal that the reader got this far.
enum Chunk {
    Bytes(Vec<u8>),
    Stall(oneshot::Sender<()>),
    Signal(std::sync::mpsc::Sender<()>),
}

/// Body reads and drops (a dropped body is a closed connection).
#[derive(Clone, Default)]
struct BodyLog {
    reads: Arc<AtomicUsize>,
    dropped: Arc<AtomicUsize>,
}

impl BodyLog {
    fn reads(&self) -> usize {
        self.reads.load(Ordering::SeqCst)
    }

    fn dropped(&self) -> usize {
        self.dropped.load(Ordering::SeqCst)
    }
}

struct FakeBody {
    chunks: VecDeque<Chunk>,
    log: BodyLog,
}

impl Drop for FakeBody {
    fn drop(&mut self) {
        self.log.dropped.fetch_add(1, Ordering::SeqCst);
    }
}

#[async_trait]
impl SyncResponseBody for FakeBody {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, SyncHttpError> {
        loop {
            match self.chunks.pop_front() {
                None => return Ok(None),
                Some(Chunk::Bytes(bytes)) => {
                    self.log.reads.fetch_add(1, Ordering::SeqCst);
                    return Ok(Some(bytes));
                }
                Some(Chunk::Signal(reached)) => {
                    let _ = reached.send(());
                }
                Some(Chunk::Stall(reached)) => {
                    let _ = reached.send(());
                    return std::future::pending().await;
                }
            }
        }
    }
}

/// Serves queued responses in order and records every request.
#[derive(Default)]
struct FakeOpener {
    responses: std::sync::Mutex<VecDeque<(u16, Vec<Chunk>)>>,
    requests: std::sync::Mutex<Vec<SyncHttpRequest>>,
    bodies: BodyLog,
    /// `content-encoding` of every response.
    encoding: Option<String>,
    /// The server never answers the request.
    silent: bool,
}

#[async_trait]
impl SyncStreamOpener for FakeOpener {
    async fn open(&self, request: SyncHttpRequest) -> Result<SyncHttpResponse, SyncHttpError> {
        self.requests.lock().unwrap().push(request);
        if self.silent {
            return std::future::pending().await;
        }
        let (status, chunks) = self
            .responses
            .lock()
            .unwrap()
            .pop_front()
            .ok_or_else(|| SyncHttpError("no response queued".to_owned()))?;
        Ok(SyncHttpResponse {
            status,
            content_encoding: self.encoding.clone(),
            body: Box::new(FakeBody {
                chunks: chunks.into(),
                log: self.bodies.clone(),
            }),
        })
    }
}

fn runs_with(opener: &Arc<FakeOpener>) -> SyncRuns {
    let runs = SyncRuns::default();
    runs.install_opener(opener.clone());
    runs
}

fn engine() -> EngineHandle {
    EngineHandle::new(TursoStorage::open_in_memory("scope-1").unwrap(), None)
}

fn id(n: u128) -> String {
    format!("00000000-0000-0000-0000-{n:012}")
}

fn task_key(n: u128) -> String {
    format!("GraphqlSoupDocument:{}", id(n))
}

/// The `lane` line the server sends before a test lane's first page:
/// `tasks-ids` lists `tasks`; every other lane hydrates.
fn declaration(lane: &str) -> Json {
    let (query, operation, kind) = match lane {
        "tasks-ids" => (
            TASK_IDS,
            "SyncTaskIds",
            json!({"kind": "membership", "scopes": ["tasks"]}),
        ),
        _ => (TASKS, "SyncTasks", json!({"kind": "hydrate"})),
    };
    json!({
        "type": "lane",
        "lane": lane,
        "query": query,
        "operationName": operation,
        "paging": "soup",
        "kind": kind,
        "passStartedAt": PASS,
    })
}

fn args() -> SyncStartArgs {
    serde_json::from_value(json!({
        "url": URL,
        // The run's own content negotiation replaces the app's.
        "headers": {"x-macro-mail-cache-profile": "v5", "Accept": "text/plain"},
        "pass": "first",
    }))
    .unwrap()
}

fn soup_page(lane: &str, page: u64, ids: &[u128], next: Option<&str>) -> Json {
    let items = ids
        .iter()
        .map(|n| json!({"__typename": "GraphqlSoupDocument", "id": id(*n), "name": format!("task {n}")}))
        .collect::<Vec<_>>();
    json!({
        "type": "page",
        "lane": lane,
        "page": page,
        "variables": {"input": {"initial": {"limit": 2}}},
        "response": {"data": {"user": {"id": "viewer", "soup": {"items": items, "nextCursor": next}}}},
        "items": ids.len(),
        "resume": next.map(|cursor| json!({"cursor": cursor})),
    })
}

fn lane_done(lane: &str, pages: u64, items: u64) -> Json {
    json!({"type": "laneDone", "lane": lane, "pages": pages, "items": items, "reason": "complete"})
}

fn end() -> Json {
    json!({"type": "end", "reason": "complete"})
}

/// The frames as NDJSON, each lane's first page in the stream (page 0)
/// preceded by its `lane` line, as the server sends them.
fn ndjson(frames: &[Json]) -> Vec<u8> {
    frames
        .iter()
        .flat_map(|frame| {
            let first_page = frame["type"] == "page" && frame["page"] == 0;
            let declared = first_page.then(|| declaration(frame["lane"].as_str().unwrap()));
            declared.into_iter().chain([frame.clone()])
        })
        .flat_map(|frame| {
            let mut line = serde_json::to_vec(&frame).unwrap();
            line.push(b'\n');
            line
        })
        .collect()
}

/// A publication as `kind` plus what the webview is told.
fn describe(publication: SyncPublication) -> String {
    match publication {
        SyncPublication::Recorded => "recorded".to_owned(),
        SyncPublication::Hydrated { write, .. } => {
            format!(
                "hydrated advanced={} reset={}",
                write.revision_advanced, write.reset
            )
        }
        SyncPublication::Deleted { keys, .. } => format!("deleted {}", keys.join(",")),
        SyncPublication::CalendarCommitted(_) => "calendar".to_owned(),
    }
}

/// Records each publication with [`describe`].
fn recorder() -> (
    Arc<std::sync::Mutex<Vec<String>>>,
    impl Fn(SyncPublication) + Send + 'static,
) {
    let published = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = published.clone();
    let publish = move |publication: SyncPublication| {
        sink.lock().unwrap().push(describe(publication));
    };
    (published, publish)
}

/// Records publications; the first one blocks until `first` returns.
fn recorder_waiting(
    first: impl Fn() + Send + 'static,
) -> (
    Arc<std::sync::Mutex<Vec<String>>>,
    impl Fn(SyncPublication) + Send + 'static,
) {
    let published = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = published.clone();
    let publish = move |publication: SyncPublication| {
        if sink.lock().unwrap().is_empty() {
            first();
        }
        sink.lock().unwrap().push(describe(publication));
    };
    (published, publish)
}

const WAIT: Duration = Duration::from_secs(10);

#[test]
fn a_run_writes_every_page_natively_and_publishes_it_like_hydration() {
    let handle = engine();
    let stream = ndjson(&[
        soup_page("tasks", 0, &[1, 2], Some("c1")),
        soup_page("tasks", 1, &[3], None),
        lane_done("tasks", 2, 3),
        end(),
    ]);
    // Split inside a line: frames decode across chunk boundaries.
    let (first, rest) = stream.split_at(41);
    let opener = Arc::new(FakeOpener::default());
    opener.responses.lock().unwrap().push_back((
        200,
        vec![Chunk::Bytes(first.to_vec()), Chunk::Bytes(rest.to_vec())],
    ));
    let runs = runs_with(&opener);
    let (published, publish) = recorder();
    let plan = args();

    let outcome = block_on(runs.start(handle.downgrade(), plan, publish));

    let SyncRunOutcome::Completed(result) = &outcome else {
        panic!("expected a completed run, got {outcome:?}");
    };
    assert_eq!(result.bytes, stream.len() as u64);
    assert_eq!(result.lanes.len(), 1);
    assert_eq!((result.lanes[0].pages, result.lanes[0].items), (2, 3));
    assert!(result.lanes[0].done);
    let wire = serde_json::to_value(&outcome).unwrap();
    assert_eq!(wire["ok"], true);
    assert_eq!(wire["result"]["reason"], "complete");
    assert_eq!(wire["result"]["lanes"][0]["id"], "tasks");

    // The `lane` line, both pages, `laneDone` and `end`.
    assert_eq!(
        *published.lock().unwrap(),
        [
            "recorded",
            "hydrated advanced=true reset=false",
            "hydrated advanced=true reset=false",
            "recorded",
            "recorded",
        ]
    );

    let requests = opener.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].url, URL);
    assert_eq!(
        requests[0].headers,
        [
            ("x-macro-mail-cache-profile".to_owned(), "v5".to_owned()),
            ("content-type".to_owned(), "application/json".to_owned()),
            ("accept".to_owned(), "application/x-ndjson".to_owned()),
            ("accept-encoding".to_owned(), "gzip".to_owned()),
        ]
    );
    let body: Json = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(
        body,
        json!({"protocol": cache_core::sync::SYNC_PROTOCOL, "pass": "first", "lanes": []})
    );

    // Every page's records are in the native cache.
    let records = block_on(handle.read_records_by_keys(
        "fragment Task on GraphqlSoupDocument { id name }".to_owned(),
        "Task".to_owned(),
        vec![task_key(1), task_key(3)],
    ))
    .unwrap();
    assert_eq!(
        records
            .records
            .iter()
            .map(|selected| selected.record.clone())
            .collect::<Vec<_>>(),
        [
            json!({"id": id(1), "name": "task 1"}),
            json!({"id": id(3), "name": "task 3"}),
        ]
    );

    let state = block_on(handle.sync_lane_states()).unwrap();
    assert_eq!(state.len(), 1);
    assert_eq!((state[0].pages, state[0].items), (2, 3));
    assert_eq!(state[0].watermark.as_deref(), Some(PASS));
    assert!(state[0].completed_at.is_some());
    assert_eq!(state[0].resume, None);
}

#[test]
fn a_membership_lane_deletes_members_the_server_no_longer_lists() {
    let handle = engine();
    let opener = Arc::new(FakeOpener::default());
    opener.responses.lock().unwrap().extend([
        (
            200,
            vec![Chunk::Bytes(ndjson(&[
                soup_page("tasks", 0, &[1, 2, 3], None),
                lane_done("tasks", 1, 3),
                end(),
            ]))],
        ),
        (
            200,
            vec![Chunk::Bytes(ndjson(&[
                soup_page("tasks-ids", 0, &[1, 3], None),
                lane_done("tasks-ids", 1, 2),
                end(),
            ]))],
        ),
    ]);
    let runs = runs_with(&opener);
    let (_, publish) = recorder();
    let hydrate = args();
    assert!(matches!(
        block_on(runs.start(handle.downgrade(), hydrate, publish)),
        SyncRunOutcome::Completed(_)
    ));

    let (published, publish) = recorder();
    let listing = args();
    let outcome = block_on(runs.start(handle.downgrade(), listing, publish));

    assert!(
        matches!(outcome, SyncRunOutcome::Completed(_)),
        "{outcome:?}"
    );
    assert_eq!(
        *published.lock().unwrap(),
        [
            "recorded".to_owned(),
            "recorded".to_owned(),
            format!("deleted {}", task_key(2)),
            "recorded".to_owned()
        ]
    );
}

#[test]
fn failures_keep_written_pages_and_report_progress() {
    let handle = engine();
    let opener = Arc::new(FakeOpener::default());
    opener.responses.lock().unwrap().extend([
        (401, Vec::new()),
        // Closed after one page, without laneDone or end.
        (
            200,
            vec![Chunk::Bytes(ndjson(&[soup_page(
                "tasks",
                0,
                &[1, 2],
                Some("c1"),
            )]))],
        ),
    ]);
    let runs = runs_with(&opener);
    let plan = args();

    let (_, publish) = recorder();
    let outcome = block_on(runs.start(handle.downgrade(), plan.clone(), publish));
    let wire = serde_json::to_value(&outcome).unwrap();
    assert_eq!(wire["ok"], false);
    assert_eq!(wire["failure"], json!({"kind": "http", "status": 401}));
    // Nothing was declared: the server answered before its first line.
    assert_eq!(wire["partial"]["lanes"], json!([]));

    let (_, publish) = recorder();
    let outcome = block_on(runs.start(handle.downgrade(), plan, publish));
    let SyncRunOutcome::Failed {
        failure: SyncFailure::Stream { message },
        partial: Some(partial),
    } = outcome
    else {
        panic!("expected an interrupted stream, got {outcome:?}");
    };
    assert_eq!(message, "stream closed without an end frame");
    assert_eq!(partial.lanes[0].pages, 1);
    let state = block_on(handle.sync_lane_states()).unwrap();
    assert_eq!(state[0].resume, Some(json!({"cursor": "c1"})));
    assert_eq!(state[0].completed_at, None);
}

#[test]
fn a_body_that_goes_silent_is_given_up_as_stalled_keeping_written_pages() {
    let handle = engine();
    let opener = Arc::new(FakeOpener::default());
    let (reached_tx, _reached_rx) = oneshot::channel();
    opener.responses.lock().unwrap().push_back((
        200,
        vec![
            Chunk::Bytes(ndjson(&[soup_page("tasks", 0, &[1, 2], Some("c1"))])),
            Chunk::Stall(reached_tx),
        ],
    ));
    let mut runs = runs_with(&opener);
    runs.stall_timeout = Duration::from_millis(50);
    let plan = args();

    let (_, publish) = recorder();
    let outcome = block_on(runs.start(handle.downgrade(), plan, publish));
    assert_eq!(
        serde_json::to_value(&outcome).unwrap()["failure"],
        json!({"kind": "stalled"})
    );
    let SyncRunOutcome::Failed {
        failure: SyncFailure::Stalled,
        partial: Some(partial),
    } = outcome
    else {
        panic!("expected a stalled stream, got {outcome:?}");
    };
    assert_eq!(partial.lanes[0].pages, 1);
    // The connection is closed and the written page is the resume point.
    assert_eq!(opener.bodies.dropped(), 1);
    let state = block_on(handle.sync_lane_states()).unwrap();
    assert_eq!(state[0].resume, Some(json!({"cursor": "c1"})));
}

#[test]
fn a_request_that_never_answers_is_given_up_as_stalled() {
    let handle = engine();
    let opener = Arc::new(FakeOpener {
        silent: true,
        ..FakeOpener::default()
    });
    let mut runs = runs_with(&opener);
    runs.stall_timeout = Duration::from_millis(50);
    let plan = args();

    let (_, publish) = recorder();
    let outcome = block_on(runs.start(handle.downgrade(), plan.clone(), publish));
    assert!(matches!(
        outcome,
        SyncRunOutcome::Failed {
            failure: SyncFailure::Stalled,
            ..
        }
    ));
    // The slot is free: the next run starts instead of answering busy.
    let (_, publish) = recorder();
    let outcome = block_on(runs.start(handle.downgrade(), plan, publish));
    assert!(matches!(
        outcome,
        SyncRunOutcome::Failed {
            failure: SyncFailure::Stalled,
            ..
        }
    ));
}

#[test]
fn stop_ends_a_waiting_run_while_reads_proceed_between_pages() {
    let handle = engine();
    let (reached_tx, reached_rx) = oneshot::channel();
    let opener = Arc::new(FakeOpener::default());
    opener.responses.lock().unwrap().extend([
        (
            200,
            vec![
                Chunk::Bytes(ndjson(&[soup_page("tasks", 0, &[1, 2], Some("c1"))])),
                Chunk::Stall(reached_tx),
            ],
        ),
        (200, vec![Chunk::Bytes(ndjson(&[end()]))]),
    ]);
    let runs = Arc::new(runs_with(&opener));
    let plan = args();
    let (written_tx, written_rx) = std::sync::mpsc::channel();
    let running = tauri::async_runtime::spawn({
        let (runs, weak, plan) = (runs.clone(), handle.downgrade(), plan.clone());
        async move {
            runs.start(weak, plan, move |_| {
                let _ = written_tx.send(());
            })
            .await
        }
    });
    // The reader waits for more bytes and the first page is written.
    block_on(reached_rx).unwrap();
    written_rx.recv_timeout(WAIT).unwrap();

    // The run waits for bytes without holding the engine.
    let state = block_on(handle.sync_lane_states()).unwrap();
    assert_eq!(state[0].pages, 1);
    assert_eq!(
        block_on(runs.start(handle.downgrade(), plan.clone(), |_| {})),
        SyncRunOutcome::Failed {
            failure: SyncFailure::Busy,
            partial: None
        }
    );

    block_on(runs.stop());
    let outcome = block_on(running).unwrap();
    let SyncRunOutcome::Failed {
        failure: SyncFailure::Aborted,
        partial: Some(partial),
    } = outcome
    else {
        panic!("expected an aborted run, got {outcome:?}");
    };
    assert_eq!(partial.lanes[0].pages, 1);
    // Stopping closed the connection.
    assert_eq!(opener.bodies.dropped(), 1);
    // Stopping frees the slot.
    assert!(matches!(
        block_on(runs.start(handle.downgrade(), plan, |_| {})),
        SyncRunOutcome::Completed(_)
    ));
}

#[test]
fn the_body_is_read_ahead_while_pages_are_written() {
    let handle = engine();
    let (read_all_tx, read_all_rx) = std::sync::mpsc::channel();
    let opener = Arc::new(FakeOpener::default());
    opener.responses.lock().unwrap().push_back((
        200,
        vec![
            Chunk::Bytes(ndjson(&[soup_page("tasks", 0, &[1, 2], Some("c1"))])),
            Chunk::Bytes(ndjson(&[soup_page("tasks", 1, &[3, 4], Some("c2"))])),
            Chunk::Bytes(ndjson(&[soup_page("tasks", 2, &[5], None)])),
            Chunk::Bytes(ndjson(&[lane_done("tasks", 3, 5), end()])),
            Chunk::Signal(read_all_tx),
        ],
    ));
    let runs = SyncRuns {
        publish_interval: Duration::ZERO,
        ..SyncRuns::default()
    };
    runs.install_opener(opener.clone());
    // Publishing the first page waits for the reader to reach the end of the
    // body; a read-then-write loop would never get there.
    let (published, publish) = recorder_waiting(move || {
        read_all_rx
            .recv_timeout(WAIT)
            .expect("the body is read while the first page is written");
    });
    let plan = args();

    let outcome = block_on(runs.start(handle.downgrade(), plan, publish));

    assert!(
        matches!(outcome, SyncRunOutcome::Completed(_)),
        "{outcome:?}"
    );
    assert_eq!(published.lock().unwrap().len(), 6);
    assert_eq!(opener.bodies.dropped(), 1);
    let state = block_on(handle.sync_lane_states()).unwrap();
    assert_eq!((state[0].pages, state[0].items), (3, 5));
}

#[test]
fn read_ahead_stops_at_the_byte_budget_until_pages_are_applied() {
    let handle = engine();
    let first = ndjson(&[soup_page("tasks", 0, &[1, 2], Some("c1"))]);
    let opener = Arc::new(FakeOpener::default());
    opener.responses.lock().unwrap().push_back((
        200,
        vec![
            Chunk::Bytes(first.clone()),
            Chunk::Bytes(ndjson(&[soup_page("tasks", 1, &[3, 4], Some("c2"))])),
            Chunk::Bytes(ndjson(&[soup_page("tasks", 2, &[5], None)])),
            Chunk::Bytes(ndjson(&[lane_done("tasks", 3, 5), end()])),
        ],
    ));
    // The first chunk fills the budget; the reader holds the next one until
    // the first is applied.
    let runs = SyncRuns {
        read_ahead_bytes: first.len(),
        publish_interval: Duration::ZERO,
        ..SyncRuns::default()
    };
    runs.install_opener(opener.clone());
    let reads = opener.bodies.clone();
    let reads_at_first_write = Arc::new(AtomicUsize::new(0));
    let (published, publish) = recorder_waiting({
        let reads_at_first_write = reads_at_first_write.clone();
        move || reads_at_first_write.store(reads.reads(), Ordering::SeqCst)
    });
    let plan = args();

    let outcome = block_on(runs.start(handle.downgrade(), plan, publish));

    assert!(
        matches!(outcome, SyncRunOutcome::Completed(_)),
        "{outcome:?}"
    );
    assert!(reads_at_first_write.load(Ordering::SeqCst) <= 2);
    assert_eq!(opener.bodies.reads(), 4);
    assert_eq!(published.lock().unwrap().len(), 6);
}

#[test]
fn a_broken_frame_closes_the_connection_and_keeps_the_resume_point() {
    let handle = engine();
    let (reached_tx, _reached_rx) = oneshot::channel();
    let opener = Arc::new(FakeOpener::default());
    opener.responses.lock().unwrap().push_back((
        200,
        vec![
            Chunk::Bytes(ndjson(&[soup_page("tasks", 0, &[1, 2], Some("c1"))])),
            Chunk::Bytes(b"{\"type\":\"page\"}\n".to_vec()),
            Chunk::Stall(reached_tx),
        ],
    ));
    let runs = runs_with(&opener);
    let plan = args();

    let outcome = block_on(runs.start(handle.downgrade(), plan, |_| {}));

    let SyncRunOutcome::Failed {
        failure: SyncFailure::Stream { message },
        partial: Some(partial),
    } = outcome
    else {
        panic!("expected a stream failure, got {outcome:?}");
    };
    assert!(message.starts_with("invalid frame"), "{message}");
    assert_eq!(partial.lanes[0].pages, 1);
    // The reader was waiting on the server; failing closed the connection.
    assert_eq!(opener.bodies.dropped(), 1);
    let state = block_on(handle.sync_lane_states()).unwrap();
    assert_eq!(state[0].resume, Some(json!({"cursor": "c1"})));
}

#[test]
fn a_failed_lane_is_reported_and_the_other_lanes_finish() {
    let handle = engine();
    let mut refused = soup_page("tasks", 1, &[3], None);
    refused["response"]["errors"] = json!([{"message": "denied"}]);
    let opener = Arc::new(FakeOpener::default());
    opener.responses.lock().unwrap().push_back((
        200,
        vec![Chunk::Bytes(ndjson(&[
            soup_page("tasks", 0, &[1, 2], Some("c1")),
            refused,
            json!({"type": "laneError", "lane": "tasks", "message": "page response has GraphQL errors"}),
            soup_page("docs", 0, &[4], None),
            lane_done("docs", 1, 1),
            end(),
        ]))],
    ));
    let runs = runs_with(&opener);
    let plan = args();

    let outcome = block_on(runs.start(handle.downgrade(), plan, |_| {}));

    let wire = serde_json::to_value(&outcome).unwrap();
    assert_eq!(wire["ok"], true, "{wire}");
    assert_eq!(wire["result"]["reason"], "complete");
    assert_eq!(
        wire["result"]["lanes"][0]["error"],
        "page response has GraphQL errors"
    );
    assert_eq!(wire["result"]["lanes"][0]["done"], false);
    assert_eq!(wire["result"]["lanes"][1]["done"], true);
    assert!(wire["result"]["lanes"][1].get("error").is_none());
    // The failed lane resumes from its last written page; the other completed.
    let states = block_on(handle.sync_lane_states()).unwrap();
    let state = |id: &str| states.iter().find(|state| state.id == id).unwrap();
    assert_eq!(state("tasks").resume, Some(json!({"cursor": "c1"})));
    assert_eq!(state("tasks").completed_at, None);
    assert!(state("docs").completed_at.is_some());
}

#[test]
fn cache_shutdown_stops_the_run_and_still_closes_storage() {
    let handle = engine();
    let weak = handle.downgrade();
    let (reached_tx, reached_rx) = oneshot::channel();
    let opener = Arc::new(FakeOpener::default());
    opener.responses.lock().unwrap().push_back((
        200,
        vec![
            Chunk::Bytes(ndjson(&[soup_page("tasks", 0, &[1], Some("c1"))])),
            Chunk::Stall(reached_tx),
        ],
    ));
    let state = Arc::new(crate::CacheState {
        cache: std::sync::Mutex::new(Some(crate::InitializedCache {
            scope: "scope-1".to_owned(),
            handle,
        })),
        sync: runs_with(&opener),
    });
    let plan = args();
    let running = tauri::async_runtime::spawn({
        let state = state.clone();
        async move { state.sync.start(weak, plan, |_| {}).await }
    });
    block_on(reached_rx).unwrap();

    // The desktop installer requires this to close the database.
    state.shutdown().unwrap();
    assert!(matches!(
        block_on(running).unwrap(),
        SyncRunOutcome::Failed {
            failure: SyncFailure::Aborted,
            ..
        }
    ));
}

#[test]
fn a_host_without_an_opener_cannot_stream() {
    let handle = engine();
    let plan = args();
    let outcome = block_on(SyncRuns::default().start(handle.downgrade(), plan, |_| {}));
    assert_eq!(
        serde_json::to_value(&outcome).unwrap(),
        json!({"ok": false, "failure": {"kind": "unsupported"}})
    );
}

#[test]
fn hydrated_pages_coalesce_into_one_publication_per_interval() {
    let handle = engine();
    let opener = Arc::new(FakeOpener::default());
    opener.responses.lock().unwrap().push_back((
        200,
        vec![Chunk::Bytes(ndjson(&[
            soup_page("tasks", 0, &[1, 2], Some("c1")),
            soup_page("tasks", 1, &[3, 4], Some("c2")),
            soup_page("tasks", 2, &[5], None),
            lane_done("tasks", 3, 5),
            end(),
        ]))],
    ));
    // Only the first page publishes on its own; the rest wait for a frame that
    // is not a page (or the end of the run).
    let runs = SyncRuns {
        publish_interval: Duration::MAX,
        ..SyncRuns::default()
    };
    runs.install_opener(opener.clone());
    let published = Arc::new(std::sync::Mutex::new(Vec::new()));
    let publish = {
        let published = published.clone();
        move |publication: SyncPublication| {
            let entry = match publication {
                SyncPublication::Hydrated { write, .. } => format!("hydrated {}", write.revision),
                other => describe(other),
            };
            published.lock().unwrap().push(entry);
        }
    };
    let plan = args();

    let outcome = block_on(runs.start(handle.downgrade(), plan, publish));

    assert!(
        matches!(outcome, SyncRunOutcome::Completed(_)),
        "{outcome:?}"
    );
    let published = published.lock().unwrap().clone();
    assert_eq!(published.len(), 5, "{published:?}");
    // The `lane` line comes first.
    assert_eq!(published[0], "recorded");
    let published = &published[1..];
    assert!(published[0].starts_with("hydrated "));
    // The merged publication carries the last page's revision.
    let revision = |entry: &str| {
        entry
            .strip_prefix("hydrated ")
            .and_then(|revision| revision.parse::<u64>().ok())
            .unwrap()
    };
    assert_eq!(revision(&published[1]), revision(&published[0]) + 2);
    assert_eq!(&published[2..], ["recorded", "recorded"]);
}

fn gzip(bytes: &[u8]) -> Vec<u8> {
    use std::io::Write as _;
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(bytes).unwrap();
    encoder.finish().unwrap()
}

#[test]
fn a_gzip_body_is_decoded_as_it_streams() {
    let handle = engine();
    let stream = ndjson(&[
        soup_page("tasks", 0, &[1, 2], Some("c1")),
        soup_page("tasks", 1, &[3], None),
        lane_done("tasks", 2, 3),
        end(),
    ]);
    let compressed = gzip(&stream);
    // Chunks split anywhere in the compressed bytes.
    let chunks = compressed
        .chunks(7)
        .map(|chunk| Chunk::Bytes(chunk.to_vec()))
        .collect::<Vec<_>>();
    let opener = Arc::new(FakeOpener {
        encoding: Some("gzip".to_owned()),
        ..FakeOpener::default()
    });
    opener.responses.lock().unwrap().push_back((200, chunks));
    let runs = runs_with(&opener);
    let plan = args();

    let outcome = block_on(runs.start(handle.downgrade(), plan, |_| {}));

    let SyncRunOutcome::Completed(result) = &outcome else {
        panic!("expected a completed run, got {outcome:?}");
    };
    // The run counts decoded bytes (what the read-ahead budget holds).
    assert_eq!(result.bytes, stream.len() as u64);
    let state = block_on(handle.sync_lane_states()).unwrap();
    assert_eq!((state[0].pages, state[0].items), (2, 3));
    assert!(state[0].completed_at.is_some());
}

#[test]
fn a_truncated_gzip_body_fails_the_run_and_keeps_written_pages() {
    let handle = engine();
    let compressed = gzip(&ndjson(&[
        soup_page("tasks", 0, &[1, 2], Some("c1")),
        soup_page("tasks", 1, &[3], None),
        lane_done("tasks", 2, 3),
        end(),
    ]));
    let opener = Arc::new(FakeOpener {
        encoding: Some("gzip".to_owned()),
        ..FakeOpener::default()
    });
    // The connection closes before the gzip trailer.
    opener.responses.lock().unwrap().push_back((
        200,
        vec![Chunk::Bytes(compressed[..compressed.len() - 6].to_vec())],
    ));
    let runs = runs_with(&opener);
    let plan = args();

    let outcome = block_on(runs.start(handle.downgrade(), plan, |_| {}));

    assert!(
        matches!(
            &outcome,
            SyncRunOutcome::Failed {
                failure: SyncFailure::Stream { .. },
                ..
            }
        ),
        "{outcome:?}"
    );
    assert_eq!(opener.bodies.dropped(), 1);
}

#[test]
fn a_gzip_frame_is_decoded_before_the_next_chunk_arrives() {
    use std::io::Write as _;
    let frame = ndjson(&[soup_page("tasks", 0, &[1, 2], Some("c1"))]);
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(&frame).unwrap();
    // A sync flush, as the server's encoder does while it waits for the next
    // page: everything sent so far decodes.
    encoder.flush().unwrap();
    let sent = std::mem::take(encoder.get_mut());
    let mut decoder = BodyDecoder::new(Some("gzip")).unwrap();

    // The whole frame comes out now, not when the next chunk arrives.
    assert_eq!(decoder.decode(sent).unwrap(), frame);
}

#[test]
fn an_unknown_content_encoding_fails_before_writing() {
    let handle = engine();
    let opener = Arc::new(FakeOpener {
        encoding: Some("br".to_owned()),
        ..FakeOpener::default()
    });
    opener.responses.lock().unwrap().push_back((
        200,
        vec![Chunk::Bytes(ndjson(&[soup_page("tasks", 0, &[1], None)]))],
    ));
    let runs = runs_with(&opener);
    let plan = args();

    let outcome = block_on(runs.start(handle.downgrade(), plan, |_| {}));

    let SyncRunOutcome::Failed {
        failure: SyncFailure::Stream { message },
        ..
    } = outcome
    else {
        panic!("expected a stream failure, got {outcome:?}");
    };
    assert_eq!(message, "unsupported content-encoding `br`");
    assert!(block_on(handle.sync_lane_states()).unwrap().is_empty());
}
