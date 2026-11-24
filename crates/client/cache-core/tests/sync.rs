use cache_core::calendar::{
    CalendarCommit, CalendarLinkWatermark, CalendarRangeRequest, CalendarSpan, CalendarSpanKind,
};
use cache_core::engine::Engine;
use cache_core::predicate::ProjectionMutation;
use cache_core::record_selection::RecordSelection;
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::sync::{
    SyncApplied, SyncCalendarArgs, SyncHooks, SyncPageWrite, SyncRun, SyncRunReason, SyncStartArgs,
    SyncStreamError, SyncWriteError,
};
use cache_core::value::EntityKey;
use pollster::block_on;
use predicate_index::RecordKey;
use serde_json::{Value as Json, json};
use std::convert::Infallible;
use std::sync::atomic::{AtomicU64, Ordering};

const TASKS: &str = "query SoupBackfillSyncTasks($input: SoupInput!) { user { id soup(input: $input) { items { __typename id ... on GraphqlSoupDocument { name } } nextCursor } } }";
const TASK_IDS: &str = "query SoupBackfillSyncTaskIds($input: SoupInput!) { user { id soup(input: $input) { items { __typename id } nextCursor } } }";
const OCCURRENCES: &str = "query SyncCalendar($input: CalendarRangeInput!) { user { id calendarOccurrences(input: $input) { nodes { __typename id eventId linkId isCancelled time { __typename ... on GraphqlTimedEventTime { startsAt endsAt } } } hasNextPage endCursor watermark { linkId seq } } } }";
const PASS: &str = "2026-11-01T00:00:00.000Z";
// 2026-10-05T00:00:00Z
const MONDAY_MS: i64 = 1_791_158_400_000;
const MONDAY_DAY: i64 = 20_731;
const DAY_MS: i64 = 86_400_000;
const NOW_MS: i64 = 1_793_577_600_000;

/// Test host: no Soup projections, deterministic clocks.
#[derive(Default)]
struct Hooks {
    ticks: AtomicU64,
}

impl SyncHooks<InMemoryStorage> for Hooks {
    type Error = Infallible;

    async fn page_projections(
        &self,
        _engine: &mut Engine<InMemoryStorage>,
        _page: SyncPageWrite<'_>,
    ) -> Result<Vec<ProjectionMutation>, Infallible> {
        Ok(Vec::new())
    }

    async fn deletion_projections(
        &self,
        _engine: &mut Engine<InMemoryStorage>,
        keys: &[EntityKey<'static>],
    ) -> Result<Vec<ProjectionMutation>, Infallible> {
        Ok(keys
            .iter()
            .filter_map(|key| RecordKey::new(key.to_string()).ok())
            .map(ProjectionMutation::Delete)
            .collect())
    }

    fn monotonic_ms(&self) -> f64 {
        self.ticks.fetch_add(1, Ordering::Relaxed) as f64
    }

    fn wall_clock_ms(&self) -> i64 {
        NOW_MS
    }
}

fn id(n: u128) -> String {
    uuid::Uuid::from_u128(n).to_string()
}

fn task_key(n: u128) -> EntityKey<'static> {
    EntityKey::entity("GraphqlSoupDocument", &[&id(n)])
}

/// A lane as the server declares it (its `lane` line without the type).
fn lane(id: &str, query: &str, paging: &str, kind: Json) -> Json {
    json!({
        "lane": id,
        "query": query,
        "paging": paging,
        "kind": kind,
        "passStartedAt": PASS,
    })
}

/// A run's arguments and the lanes its stream declares.
struct Plan {
    args: SyncStartArgs,
    lanes: Vec<Json>,
}

fn args(lanes: Vec<Json>) -> Plan {
    Plan {
        args: serde_json::from_value(json!({
            "url": "https://example.test/items/soup/graphql/stream",
            "headers": {},
            "pass": "first",
        }))
        .unwrap(),
        lanes,
    }
}

fn declaration(lane: &Json) -> Json {
    let mut line = lane.clone();
    line["type"] = json!("lane");
    line
}

/// Starts a run whose stream first declares the plan's lanes.
async fn start(engine: &mut Engine<InMemoryStorage>, plan: &Plan) -> SyncRun {
    let mut run = engine.sync_begin(&plan.args, 0.0).await.unwrap();
    let declarations = plan.lanes.iter().map(declaration).collect::<Vec<_>>();
    let applied = run_stream(engine, &mut run, &ndjson(&declarations))
        .await
        .unwrap();
    assert!(
        applied
            .iter()
            .all(|applied| matches!(applied, SyncApplied::Recorded))
    );
    run
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

fn end(reason: &str) -> Json {
    json!({"type": "end", "reason": reason})
}

fn ndjson(frames: &[Json]) -> Vec<u8> {
    frames
        .iter()
        .flat_map(|frame| {
            let mut line = serde_json::to_vec(frame).unwrap();
            line.push(b'\n');
            line
        })
        .collect()
}

/// Feeds the stream in small chunks, applying every frame as it decodes.
async fn run_stream(
    engine: &mut Engine<InMemoryStorage>,
    run: &mut SyncRun,
    stream: &[u8],
) -> Result<Vec<SyncApplied>, SyncWriteError<Infallible, Infallible>> {
    let hooks = Hooks::default();
    let mut applied = Vec::new();
    for chunk in stream.chunks(97) {
        run.push_bytes(chunk)?;
        while let Some(frame) = engine.sync_apply_next(run, &hooks).await? {
            applied.push(frame);
        }
    }
    Ok(applied)
}

async fn present(engine: &Engine<InMemoryStorage>, keys: &[EntityKey<'static>]) -> Vec<bool> {
    engine
        .storage()
        .get_batch(keys)
        .await
        .unwrap()
        .iter()
        .map(Option::is_some)
        .collect()
}

#[test]
fn hydrate_lane_writes_pages_saves_resume_state_and_completes() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let plan = args(vec![lane(
            "tasks",
            TASKS,
            "soup",
            json!({"kind": "hydrate"}),
        )]);
        let mut run = start(&mut engine, &plan).await;
        let declared = run.partial(0.0).bytes;
        let first = ndjson(&[soup_page("tasks", 0, &[1, 2], Some("c1"))]);
        let applied = run_stream(&mut engine, &mut run, &first).await.unwrap();
        assert!(
            matches!(applied.as_slice(), [SyncApplied::Hydrated { lane, .. }] if lane == "tasks")
        );
        assert_eq!(
            present(&engine, &[task_key(1), task_key(2)]).await,
            [true, true]
        );

        let state = engine.sync_lane_states().await.unwrap();
        assert_eq!(state.len(), 1);
        assert_eq!(state[0].id, "tasks");
        assert_eq!((state[0].pages, state[0].items), (1, 2));
        assert_eq!(state[0].pass_started_at.as_deref(), Some(PASS));
        assert_eq!(state[0].resume, Some(json!({"cursor": "c1"})));
        assert_eq!(state[0].completed_at, None);

        let rest = ndjson(&[
            soup_page("tasks", 1, &[3], None),
            lane_done("tasks", 2, 3),
            end("complete"),
        ]);
        run_stream(&mut engine, &mut run, &rest).await.unwrap();
        let result = run.finish(100.0).unwrap();
        assert_eq!(result.reason, SyncRunReason::Complete);
        assert_eq!(result.bytes, declared + (first.len() + rest.len()) as u64);
        assert_eq!(result.lanes.len(), 1);
        assert_eq!((result.lanes[0].pages, result.lanes[0].items), (2, 3));
        assert!(result.lanes[0].done);
        assert!(result.lanes[0].write_ms > 0.0);

        let state = &engine.sync_lane_states().await.unwrap()[0];
        assert_eq!((state.pages, state.items), (2, 3));
        assert_eq!(state.resume, None);
        assert_eq!(
            state.completed_at.as_deref(),
            Some("2026-11-02T00:00:00.000Z")
        );
        assert_eq!(state.watermark.as_deref(), Some(PASS));
    });
}

#[test]
fn a_line_type_the_engine_does_not_know_is_skipped() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let plan = args(vec![lane(
            "tasks",
            TASKS,
            "soup",
            json!({"kind": "hydrate"}),
        )]);
        let mut run = start(&mut engine, &plan).await;
        let stream = ndjson(&[
            soup_page("tasks", 0, &[1], None),
            json!({"type": "progress", "lane": "tasks", "items": 1}),
            lane_done("tasks", 1, 1),
            end("complete"),
        ]);
        let applied = run_stream(&mut engine, &mut run, &stream).await.unwrap();
        assert_eq!(applied.len(), 4);
        assert!(matches!(applied[1], SyncApplied::Recorded));
        assert_eq!(run.finish(1.0).unwrap().reason, SyncRunReason::Complete);
        assert_eq!(present(&engine, &[task_key(1)]).await, [true]);
        assert!(
            engine.sync_lane_states().await.unwrap()[0]
                .completed_at
                .is_some()
        );
    });
}

#[test]
fn a_resumed_pass_keeps_counting_and_a_new_pass_restarts_counts() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let plan = args(vec![lane(
            "tasks",
            TASKS,
            "soup",
            json!({"kind": "hydrate"}),
        )]);
        let mut run = start(&mut engine, &plan).await;
        let stream = ndjson(&[soup_page("tasks", 0, &[1, 2], Some("c1")), end("maxPages")]);
        run_stream(&mut engine, &mut run, &stream).await.unwrap();
        assert_eq!(run.finish(1.0).unwrap().reason, SyncRunReason::MaxPages);
        assert!(!run.finish(1.0).unwrap().lanes[0].done);

        // A written page whose `resume` is null, in a stream that closes
        // before `laneDone`, keeps the earlier checkpoint.
        let mut run = start(&mut engine, &plan).await;
        let stream = ndjson(&[soup_page("tasks", 0, &[3], None)]);
        run_stream(&mut engine, &mut run, &stream).await.unwrap();
        assert!(matches!(run.finish(1.0), Err(SyncStreamError::Stream(_))));
        let state = &engine.sync_lane_states().await.unwrap()[0];
        assert_eq!((state.pages, state.items), (2, 3));
        assert_eq!(state.resume, Some(json!({"cursor": "c1"})));

        let mut run = start(&mut engine, &plan).await;
        let stream = ndjson(&[
            soup_page("tasks", 0, &[3], None),
            lane_done("tasks", 1, 1),
            end("complete"),
        ]);
        run_stream(&mut engine, &mut run, &stream).await.unwrap();
        let state = &engine.sync_lane_states().await.unwrap()[0];
        assert_eq!((state.pages, state.items), (3, 4));
        assert_eq!(state.resume, None);

        let mut next = lane("tasks", TASKS, "soup", json!({"kind": "hydrate"}));
        next["passStartedAt"] = json!("2026-11-02T00:00:00.000Z");
        let mut run = start(&mut engine, &args(vec![next])).await;
        let stream = ndjson(&[soup_page("tasks", 0, &[1], Some("c2")), end("maxPages")]);
        run_stream(&mut engine, &mut run, &stream).await.unwrap();
        let state = &engine.sync_lane_states().await.unwrap()[0];
        assert_eq!((state.pages, state.items), (1, 1));
        assert_eq!(
            state.pass_started_at.as_deref(),
            Some("2026-11-02T00:00:00.000Z")
        );
        // The last completed pass stays the watermark until this one completes.
        assert_eq!(state.watermark.as_deref(), Some(PASS));
    });
}

#[test]
fn a_complete_membership_listing_deletes_unlisted_members_only() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let plan = args(vec![
            lane("tasks", TASKS, "soup", json!({"kind": "hydrate"})),
            lane(
                "tasks-ids",
                TASK_IDS,
                "soup",
                json!({"kind": "membership", "scopes": ["tasks"]}),
            ),
        ]);
        let mut run = start(&mut engine, &plan).await;
        let mut ids_page = soup_page("tasks-ids", 0, &[1, 3], None);
        ids_page["response"]["data"]["user"]["soup"]["items"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .for_each(|item| {
                item.as_object_mut().unwrap().remove("name");
            });
        let stream = ndjson(&[
            soup_page("tasks", 0, &[1, 2], Some("c1")),
            soup_page("tasks", 1, &[3], None),
            lane_done("tasks", 2, 3),
            ids_page,
            lane_done("tasks-ids", 1, 2),
            end("complete"),
        ]);
        let applied = run_stream(&mut engine, &mut run, &stream).await.unwrap();
        let deleted = applied
            .iter()
            .find_map(|applied| match applied {
                SyncApplied::Deleted { lane, keys, .. } => Some((lane.clone(), keys.clone())),
                _ => None,
            })
            .unwrap();
        assert_eq!(deleted, ("tasks-ids".to_owned(), vec![task_key(2)]));
        assert_eq!(
            present(&engine, &[task_key(1), task_key(2), task_key(3)]).await,
            [true, false, true]
        );
        let result = run.finish(1.0).unwrap();
        assert_eq!((result.lanes[1].pages, result.lanes[1].items), (1, 2));
        let states = engine.sync_lane_states().await.unwrap();
        let ids = states.iter().find(|state| state.id == "tasks-ids").unwrap();
        assert_eq!(ids.resume, None);
        assert_eq!(
            ids.completed_at.as_deref(),
            Some("2026-11-02T00:00:00.000Z")
        );

        // Deleted keys left the lane: a listing without them deletes nothing more,
        // and a record the stream never delivered is never a member.
        let mut engine = engine;
        let plan = args(vec![lane(
            "tasks-ids",
            TASK_IDS,
            "soup",
            json!({"kind": "membership", "scopes": ["tasks"]}),
        )]);
        let mut run = start(&mut engine, &plan).await;
        let mut ids_page = soup_page("tasks-ids", 0, &[1, 3], None);
        ids_page["response"]["data"]["user"]["soup"]["items"][0]
            .as_object_mut()
            .unwrap()
            .remove("name");
        let stream = ndjson(&[ids_page, lane_done("tasks-ids", 1, 2), end("complete")]);
        let applied = run_stream(&mut engine, &mut run, &stream).await.unwrap();
        assert!(
            !applied
                .iter()
                .any(|applied| matches!(applied, SyncApplied::Deleted { .. }))
        );
    });
}

#[test]
fn an_unfinished_membership_listing_deletes_nothing() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let plan = args(vec![
            lane("tasks", TASKS, "soup", json!({"kind": "hydrate"})),
            lane(
                "tasks-ids",
                TASK_IDS,
                "soup",
                json!({"kind": "membership", "scopes": ["tasks"]}),
            ),
        ]);
        let mut run = start(&mut engine, &plan).await;
        let stream = ndjson(&[
            soup_page("tasks", 0, &[1, 2], None),
            lane_done("tasks", 1, 2),
            soup_page("tasks-ids", 0, &[1], Some("c1")),
            end("maxPages"),
        ]);
        run_stream(&mut engine, &mut run, &stream).await.unwrap();
        assert_eq!(
            present(&engine, &[task_key(1), task_key(2)]).await,
            [true, true]
        );
        // Membership lanes never save a resume point.
        let states = engine.sync_lane_states().await.unwrap();
        assert!(states.iter().all(|state| state.id != "tasks-ids"));
    });
}

#[test]
fn calendar_lane_commits_its_coverage_with_the_lowest_watermark() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let coverage =
            json!([{"kind": "timed", "start": MONDAY_MS, "end": MONDAY_MS + 7 * DAY_MS}]);
        let plan = args(vec![lane(
            "calendar-1",
            OCCURRENCES,
            "calendar",
            json!({"kind": "calendar", "coverage": coverage}),
        )]);
        let mut run = start(&mut engine, &plan).await;
        let occurrence = |n: u128, start_ms: i64| {
            let iso = |ms: i64| {
                chrono::DateTime::from_timestamp_millis(ms)
                    .unwrap()
                    .to_rfc3339()
            };
            json!({
                "__typename": "GraphqlCalendarOccurrence", "id": id(n), "eventId": id(n + 100),
                "linkId": "l1", "isCancelled": false,
                "time": {"__typename": "GraphqlTimedEventTime", "startsAt": iso(start_ms), "endsAt": iso(start_ms + 3_600_000)},
            })
        };
        let page = |page: u64, nodes: Vec<Json>, watermark: Json, next: Option<&str>| {
            json!({
                "type": "page", "lane": "calendar-1", "page": page,
                "variables": {"input": {"after": next}},
                "response": {"data": {"user": {"id": "viewer", "calendarOccurrences": {
                    "nodes": nodes, "hasNextPage": next.is_some(), "endCursor": next, "watermark": watermark,
                }}}},
                "items": 1,
                "resume": null,
            })
        };
        let stream = ndjson(&[
            page(
                0,
                vec![occurrence(1, MONDAY_MS + DAY_MS)],
                json!([{"linkId": "l1", "seq": "9"}, {"linkId": "l2", "seq": "4"}]),
                Some("e1"),
            ),
            end("maxPages"),
        ]);
        run_stream(&mut engine, &mut run, &stream).await.unwrap();

        // The next run resumes the window; the earlier page's watermark still counts.
        let mut run = start(&mut engine, &plan).await;
        let stream = ndjson(&[
            page(
                0,
                vec![occurrence(2, MONDAY_MS + 2 * DAY_MS)],
                json!([{"linkId": "l1", "seq": "12"}, {"linkId": "l2", "seq": "3"}]),
                None,
            ),
            lane_done("calendar-1", 1, 1),
            end("complete"),
        ]);
        let applied = run_stream(&mut engine, &mut run, &stream).await.unwrap();
        assert!(
            applied
                .iter()
                .any(|applied| matches!(applied, SyncApplied::CalendarCommitted { .. }))
        );
        let range = engine
            .calendar_range(&CalendarRangeRequest {
                start_ms: MONDAY_MS,
                end_ms: MONDAY_MS + 7 * DAY_MS,
                start_day: MONDAY_DAY,
                end_day: MONDAY_DAY + 7,
                event_key: None,
            })
            .await
            .unwrap()
            .value;
        assert_eq!(range.occurrence_keys.len(), 2);
        assert!(
            range
                .gaps
                .iter()
                .all(|gap| gap.kind != cache_core::calendar::CalendarSpanKind::Timed)
        );
        let link = |link_id: &str, seq: i64| CalendarLinkWatermark {
            link_id: link_id.into(),
            seq,
        };
        assert_eq!(range.watermark, Some(vec![link("l1", 9), link("l2", 3)]));
    });
}

#[test]
fn clearing_the_cache_wipes_sync_state_and_members() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let plan = args(vec![lane(
            "tasks",
            TASKS,
            "soup",
            json!({"kind": "hydrate"}),
        )]);
        let mut run = start(&mut engine, &plan).await;
        let stream = ndjson(&[
            soup_page("tasks", 0, &[1], None),
            lane_done("tasks", 1, 1),
            end("complete"),
        ]);
        run_stream(&mut engine, &mut run, &stream).await.unwrap();
        assert_eq!(engine.sync_lane_states().await.unwrap().len(), 1);
        engine.clear().await.unwrap();
        assert!(engine.sync_lane_states().await.unwrap().is_empty());
        use cache_core::store::SyncStorage;
        assert!(
            engine
                .storage()
                .load_sync_members(&["tasks".to_owned()])
                .await
                .unwrap()
                .is_empty()
        );
    });
}

#[test]
fn broken_streams_fail_the_run() {
    block_on(async {
        let plan = args(vec![lane(
            "tasks",
            TASKS,
            "soup",
            json!({"kind": "hydrate"}),
        )]);
        let lane_error = json!({"type": "laneError", "lane": "tasks", "message": "boom"});
        for frames in [
            vec![end("error")],
            vec![lane_error.clone(), end("error")],
            vec![soup_page("other", 0, &[1], None)],
            vec![json!({"type": "laneError", "lane": "other", "message": "boom"})],
            vec![lane_done("tasks", 0, 0), soup_page("tasks", 0, &[1], None)],
            vec![lane_done("tasks", 0, 0), lane_error.clone()],
            vec![lane_error.clone(), soup_page("tasks", 0, &[1], None)],
            vec![lane_error.clone(), lane_done("tasks", 0, 0)],
            vec![lane_error.clone(), lane_error.clone()],
            vec![end("complete"), end("complete")],
        ] {
            let mut engine = Engine::new(InMemoryStorage::new());
            let mut run = start(&mut engine, &plan).await;
            let result = match run_stream(&mut engine, &mut run, &ndjson(&frames)).await {
                Ok(_) => run.finish(1.0).map(|_| ()).map_err(SyncWriteError::Stream),
                Err(error) => Err(error),
            };
            assert!(
                matches!(
                    result,
                    Err(SyncWriteError::Stream(SyncStreamError::Stream(_)))
                ),
                "{frames:?}: {result:?}"
            );
        }
    });
}

#[test]
fn a_failed_lane_keeps_its_resume_point_and_the_other_lanes_finish() {
    block_on(async {
        let plan = args(vec![
            lane("tasks", TASKS, "soup", json!({"kind": "hydrate"})),
            lane("docs", TASKS, "soup", json!({"kind": "hydrate"})),
        ]);
        let mut engine = Engine::new(InMemoryStorage::new());
        let mut run = start(&mut engine, &plan).await;
        let mut refused = soup_page("tasks", 1, &[2], None);
        refused["response"]["errors"] = json!([{"message": "denied"}]);
        let stream = ndjson(&[
            soup_page("tasks", 0, &[1], Some("c1")),
            refused,
            json!({"type": "laneError", "lane": "tasks", "message": "page response has GraphQL errors"}),
            soup_page("docs", 0, &[3], None),
            lane_done("docs", 1, 1),
            end("complete"),
        ]);
        run_stream(&mut engine, &mut run, &stream).await.unwrap();
        let result = run.finish(10.0).unwrap();

        // The run completes and reports the failed lane.
        assert_eq!(result.reason, SyncRunReason::Complete);
        let tasks = &result.lanes[0];
        assert_eq!((tasks.pages, tasks.done), (1, false));
        assert_eq!(
            tasks.error.as_deref(),
            Some("page response has GraphQL errors")
        );
        assert!(result.lanes[1].done && result.lanes[1].error.is_none());
        // The refused page wrote nothing; the lanes around it wrote theirs.
        assert_eq!(
            present(&engine, &[task_key(1), task_key(2), task_key(3)]).await,
            [true, false, true]
        );
        // The failed lane resumes from its last written page; the other completed.
        let states = engine.sync_lane_states().await.unwrap();
        let state = |id: &str| states.iter().find(|state| state.id == id).unwrap().clone();
        assert_eq!(state("tasks").resume, Some(json!({"cursor": "c1"})));
        assert_eq!(
            (state("tasks").pages, state("tasks").completed_at),
            (1, None)
        );
        assert!(state("docs").completed_at.is_some());
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(
            json["lanes"][0]["error"],
            "page response has GraphQL errors"
        );
        assert!(json["lanes"][1].get("error").is_none());
    });
}

#[test]
fn a_lane_that_fails_before_any_page_leaves_no_state() {
    block_on(async {
        let plan = args(vec![lane(
            "tasks",
            TASKS,
            "soup",
            json!({"kind": "hydrate"}),
        )]);
        let mut engine = Engine::new(InMemoryStorage::new());
        let mut run = start(&mut engine, &plan).await;
        let mut unpaged = soup_page("tasks", 0, &[1], None);
        unpaged["response"]["data"]["user"]
            .as_object_mut()
            .unwrap()
            .remove("soup");
        let stream = ndjson(&[
            unpaged,
            json!({"type": "laneError", "lane": "tasks", "message": "page lacks paging fields"}),
            end("complete"),
        ]);
        run_stream(&mut engine, &mut run, &stream).await.unwrap();
        let result = run.finish(1.0).unwrap();
        assert_eq!(
            result.lanes[0].error.as_deref(),
            Some("page lacks paging fields")
        );
        assert_eq!(present(&engine, &[task_key(1)]).await, [false]);
        assert!(engine.sync_lane_states().await.unwrap().is_empty());
    });
}

const SCREEN: &str = "query ScreenTasks($input: SoupInput!) { user { id soup(input: $input) { items { __typename id ... on GraphqlSoupDocument { name ownerId } } nextCursor } } }";

/// What a screen load writes: a fuller selection than the sync lane's.
async fn screen_load(engine: &mut Engine<InMemoryStorage>, viewer: &str) {
    let variables = json!({"input": {"initial": {"limit": 2}}});
    let data = json!({"user": {"id": viewer, "soup": {"items": [
        {"__typename": "GraphqlSoupDocument", "id": id(1), "name": "old", "ownerId": "owner-1"}
    ], "nextCursor": null}}});
    engine
        .write_query(
            None,
            SCREEN,
            None,
            variables.as_object().unwrap(),
            &data,
            Some(viewer),
        )
        .await
        .unwrap();
}

async fn task_rows(engine: &mut Engine<InMemoryStorage>, ids: &[u128]) -> Vec<Json> {
    let selection = RecordSelection::parse(
        &engine.schema_snapshot(),
        "fragment Task on GraphqlSoupDocument { id name ownerId }",
        "Task",
    )
    .unwrap();
    let keys = ids.iter().map(|n| task_key(*n)).collect::<Vec<_>>();
    engine
        .read_records_by_keys(&selection, &keys)
        .await
        .unwrap()
        .value
        .into_iter()
        .map(|selected| selected.record)
        .collect()
}

#[test]
fn sync_pages_merge_into_records_screens_loaded() {
    block_on(async {
        // Hot: the screen's record is still in the engine's hot tier.
        let mut engine = Engine::new(InMemoryStorage::new());
        screen_load(&mut engine, "viewer").await;
        let before = engine.current_revision();
        let plan = args(vec![lane(
            "tasks",
            TASKS,
            "soup",
            json!({"kind": "hydrate"}),
        )]);
        let mut run = start(&mut engine, &plan).await;
        let applied = run_stream(
            &mut engine,
            &mut run,
            &ndjson(&[soup_page("tasks", 0, &[1, 2], None)]),
        )
        .await
        .unwrap();
        let [SyncApplied::Hydrated { result, .. }] = applied.as_slice() else {
            panic!("expected one hydrated page, got {applied:?}");
        };
        assert!(result.write_result.revision_advanced);
        assert_eq!(result.write_result.revision, engine.current_revision());
        assert!(engine.current_revision() > before);
        // The sync lane's minimal fields update the record; the screen's extra
        // field stays.
        assert_eq!(
            task_rows(&mut engine, &[1]).await,
            [json!({"id": id(1), "name": "task 1", "ownerId": "owner-1"})]
        );
        // A new record has only the lane's fields (so it is not a complete row
        // for the screen's selection).
        assert_eq!(present(&engine, &[task_key(2)]).await, [true]);
        assert!(task_rows(&mut engine, &[2]).await.is_empty());

        // Cold: the record is only in storage (a reopened engine).
        let mut engine = Engine::new(InMemoryStorage::new());
        screen_load(&mut engine, "viewer").await;
        let mut engine = Engine::new(engine.into_storage());
        let mut run = start(&mut engine, &plan).await;
        run_stream(
            &mut engine,
            &mut run,
            &ndjson(&[soup_page("tasks", 0, &[1], None)]),
        )
        .await
        .unwrap();
        assert_eq!(
            task_rows(&mut engine, &[1]).await,
            [json!({"id": id(1), "name": "task 1", "ownerId": "owner-1"})]
        );
        assert_eq!(engine.sync_lane_states().await.unwrap()[0].pages, 1);
    });
}

#[test]
fn a_sync_page_for_another_viewer_resets_the_cache_and_keeps_its_lane_state() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        screen_load(&mut engine, "someone-else").await;
        let plan = args(vec![lane(
            "tasks",
            TASKS,
            "soup",
            json!({"kind": "hydrate"}),
        )]);
        let mut run = start(&mut engine, &plan).await;
        // Pages are tagged `viewer`, not the bound identity.
        let applied = run_stream(
            &mut engine,
            &mut run,
            &ndjson(&[soup_page("tasks", 0, &[2, 3], Some("c1"))]),
        )
        .await
        .unwrap();
        let [SyncApplied::Hydrated { result, .. }] = applied.as_slice() else {
            panic!("expected one hydrated page, got {applied:?}");
        };
        assert!(result.write_result.reset);
        assert_eq!(
            present(&engine, &[task_key(1), task_key(2), task_key(3)]).await,
            [false, true, true]
        );
        let state = engine.sync_lane_states().await.unwrap();
        assert_eq!((state[0].pages, state[0].items), (1, 2));
        assert!(state[0].resume.is_some());
    });
}

#[test]
fn a_run_s_request_carries_every_lane_s_saved_state() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let plan = args(vec![
            lane("tasks", TASKS, "soup", json!({"kind": "hydrate"})),
            lane("docs", TASKS, "soup", json!({"kind": "hydrate"})),
        ]);
        let mut run = start(&mut engine, &plan).await;
        let stream = ndjson(&[
            soup_page("tasks", 0, &[1], None),
            lane_done("tasks", 1, 1),
            soup_page("docs", 0, &[2], Some("c7")),
            end("maxPages"),
        ]);
        run_stream(&mut engine, &mut run, &stream).await.unwrap();

        let mut next = args(Vec::new());
        next.args.max_pages = Some(20);
        next.args.completed_since = Some(PASS.to_owned());
        let run = engine.sync_begin(&next.args, 0.0).await.unwrap();
        assert_eq!(
            *run.request_body(),
            json!({
                "protocol": 1,
                "pass": "first",
                "lanes": [
                    {"id": "docs", "resume": {"cursor": "c7"}},
                    {"id": "tasks", "watermark": PASS, "completedAt": "2026-11-02T00:00:00.000Z"},
                ],
                "completedSince": PASS,
                "maxPages": 20,
            })
        );
    });
}

#[test]
fn a_calendar_run_sends_the_cache_s_coverage_merged() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let span = |start: i64, end: i64| CalendarSpan {
            kind: CalendarSpanKind::Timed,
            start,
            end,
        };
        engine
            .calendar_commit(&CalendarCommit {
                coverage: vec![span(MONDAY_MS, MONDAY_MS + DAY_MS)],
                ..CalendarCommit::default()
            })
            .await
            .unwrap();
        engine
            .calendar_commit(&CalendarCommit {
                coverage: vec![span(MONDAY_MS + DAY_MS, MONDAY_MS + 2 * DAY_MS)],
                ..CalendarCommit::default()
            })
            .await
            .unwrap();

        let mut plan = args(Vec::new());
        let run = engine.sync_begin(&plan.args, 0.0).await.unwrap();
        assert!(run.request_body().get("calendar").is_none());

        plan.args.calendar = Some(SyncCalendarArgs {
            time_zone: "Europe/Berlin".to_owned(),
        });
        let run = engine.sync_begin(&plan.args, 0.0).await.unwrap();
        assert_eq!(
            run.request_body()["calendar"],
            json!({
                "timeZone": "Europe/Berlin",
                "coverage": [{"kind": "timed", "start": MONDAY_MS, "end": MONDAY_MS + 2 * DAY_MS}],
            })
        );
    });
}

#[test]
fn frames_of_a_lane_the_stream_never_declared_break_it() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let mut run = start(&mut engine, &args(Vec::new())).await;
        let result = run_stream(
            &mut engine,
            &mut run,
            &ndjson(&[soup_page("tasks", 0, &[1], None)]),
        )
        .await;
        assert!(matches!(
            result,
            Err(SyncWriteError::Stream(SyncStreamError::Stream(message))) if message.contains("unknown lane")
        ));
        assert_eq!(present(&engine, &[task_key(1)]).await, [false]);
    });
}
