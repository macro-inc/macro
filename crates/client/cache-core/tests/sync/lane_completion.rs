//! What a lane's `laneDone` commits besides its own state.

use super::*;

fn lane_done_capped(lane: &str, pages: u64, items: u64) -> Json {
    json!({"type": "laneDone", "lane": lane, "pages": pages, "items": items, "reason": "maxItems"})
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
