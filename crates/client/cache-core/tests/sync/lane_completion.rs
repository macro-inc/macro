//! What a lane's `laneDone` commits besides its own state.

use super::*;

fn lane_done_capped(lane: &str, pages: u64, items: u64) -> Json {
    json!({"type": "laneDone", "lane": lane, "pages": pages, "items": items, "reason": "maxItems"})
}

fn ids_page(lane: &str, ids: &[u128]) -> Json {
    let mut page = soup_page(lane, 0, ids, None);
    for item in page["response"]["data"]["user"]["soup"]["items"]
        .as_array_mut()
        .unwrap()
    {
        item.as_object_mut().unwrap().remove("name");
    }
    page
}

fn tasks_and_ids() -> Plan {
    args(vec![
        lane("tasks", TASKS, "soup", json!({"kind": "hydrate"})),
        lane(
            "tasks-ids",
            TASK_IDS,
            "soup",
            json!({"kind": "membership", "scopes": ["tasks"]}),
        ),
    ])
}

async fn lane_state(engine: &Engine<InMemoryStorage>, id: &str) -> cache_core::sync::SyncLaneState {
    engine
        .sync_lane_states()
        .await
        .unwrap()
        .into_iter()
        .find(|state| state.id == id)
        .unwrap()
}

#[test]
fn a_capped_calendar_window_commits_its_watermark_but_no_coverage() {
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
        let page = json!({
            "type": "page", "lane": "calendar-1", "page": 0,
            "variables": {"input": {}},
            "response": {"data": {"user": {"id": "viewer", "calendarOccurrences": {
                "nodes": [], "hasNextPage": true, "endCursor": "e1",
                "watermark": [{"linkId": "l1", "seq": "9"}],
            }}}},
            "items": 0,
            "resume": null,
        });
        let stream = ndjson(&[page, lane_done_capped("calendar-1", 1, 0), end("complete")]);
        run_stream(&mut engine, &mut run, &stream).await.unwrap();

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
        assert!(
            range
                .gaps
                .iter()
                .any(|gap| gap.kind == CalendarSpanKind::Timed)
        );
        assert_eq!(
            range.watermark,
            Some(vec![CalendarLinkWatermark {
                link_id: "l1".into(),
                seq: 9,
            }])
        );
    });
}

#[test]
fn a_listed_record_no_scope_lane_delivered_makes_the_scopes_run_whole_again() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let mut run = start(&mut engine, &tasks_and_ids()).await;
        let stream = ndjson(&[
            soup_page("tasks", 0, &[1], None),
            lane_done("tasks", 1, 1),
            ids_page("tasks-ids", &[1]),
            lane_done("tasks-ids", 1, 1),
            end("complete"),
        ]);
        run_stream(&mut engine, &mut run, &stream).await.unwrap();
        // Every listed record is a member: the next run catches up.
        assert_eq!(
            lane_state(&engine, "tasks").await.watermark.as_deref(),
            Some(PASS)
        );

        // A catch-up pass delivers nothing, but task 2 was shared meanwhile.
        let mut run = start(&mut engine, &tasks_and_ids()).await;
        let stream = ndjson(&[
            soup_page("tasks", 0, &[], None),
            lane_done("tasks", 1, 0),
            ids_page("tasks-ids", &[1, 2]),
            lane_done("tasks-ids", 1, 2),
            end("complete"),
        ]);
        run_stream(&mut engine, &mut run, &stream).await.unwrap();
        let tasks = lane_state(&engine, "tasks").await;
        assert_eq!((tasks.watermark, tasks.completed_at), (None, None));
        assert!(
            lane_state(&engine, "tasks-ids")
                .await
                .completed_at
                .is_some()
        );

        let run = engine.sync_begin(&tasks_and_ids().args, 0.0).await.unwrap();
        let lanes = run.request_body()["lanes"].as_array().unwrap().clone();
        assert!(lanes.iter().any(|lane| *lane == json!({"id": "tasks"})));
    });
}

#[test]
fn a_scope_lane_still_in_its_first_pass_keeps_the_others_catching_up() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let plan = args(vec![
            lane("recent", TASKS, "soup", json!({"kind": "hydrate"})),
            lane("rest", TASKS, "soup", json!({"kind": "hydrate"})),
            lane(
                "ids",
                TASK_IDS,
                "soup",
                json!({"kind": "membership", "scopes": ["recent", "rest"]}),
            ),
        ]);
        let mut run = start(&mut engine, &plan).await;
        // `recent` completes capped; `rest` has not run yet.
        let stream = ndjson(&[
            soup_page("recent", 0, &[1], None),
            lane_done_capped("recent", 1, 1),
            ids_page("ids", &[1, 2]),
            lane_done("ids", 1, 2),
            end("complete"),
        ]);
        run_stream(&mut engine, &mut run, &stream).await.unwrap();
        assert_eq!(
            lane_state(&engine, "recent").await.watermark.as_deref(),
            Some(PASS)
        );
    });
}
