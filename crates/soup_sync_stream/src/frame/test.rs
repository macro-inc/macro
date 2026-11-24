use super::*;
use crate::calendar::{CalendarSpan, SpanKind};
use serde_json::json;

#[test]
fn encodes_each_frame_as_one_ndjson_line() {
    let lane = LaneId::try_from("tasks".to_owned()).unwrap();
    let Value::Object(variables) = json!({ "input": { "initial": { "limit": 2 } } }) else {
        panic!("variables literal is an object");
    };
    let frames = [
        Frame::Lane {
            lane: lane.clone(),
            query: "query Tasks {\n  user { id }\n}".to_owned(),
            operation_name: "Tasks".to_owned(),
            paging: Paging::Soup,
            kind: LaneKind::Hydrate,
            pass_started_at: "2026-11-02T12:00:00.000Z".to_owned(),
        },
        Frame::Page {
            lane: lane.clone(),
            page: 0,
            variables,
            response: json!({ "data": { "user": { "soup": { "nextCursor": "c1\nc2" } } } }),
            items: 2,
            resume: Some(json!({ "cursor": "c1\nc2", "items": 2 })),
        },
        Frame::LaneDone {
            lane: lane.clone(),
            pages: 12,
            items: 5800,
            reason: LaneDoneReason::MaxItems,
        },
        Frame::LaneError {
            lane,
            message: "page response has GraphQL errors".to_owned(),
        },
        Frame::End {
            reason: EndReason::MaxPages,
        },
    ];
    let lines: Vec<String> = frames
        .iter()
        .map(|frame| String::from_utf8(frame.to_line().unwrap().to_vec()).unwrap())
        .collect();
    assert_eq!(
        lines,
        [
            "{\"type\":\"lane\",\"lane\":\"tasks\",\"query\":\"query Tasks {\\n  user { id }\\n}\",\"operationName\":\"Tasks\",\"paging\":\"soup\",\"kind\":{\"kind\":\"hydrate\"},\"passStartedAt\":\"2026-11-02T12:00:00.000Z\"}\n",
            "{\"type\":\"page\",\"lane\":\"tasks\",\"page\":0,\"variables\":{\"input\":{\"initial\":{\"limit\":2}}},\"response\":{\"data\":{\"user\":{\"soup\":{\"nextCursor\":\"c1\\nc2\"}}}},\"items\":2,\"resume\":{\"cursor\":\"c1\\nc2\",\"items\":2}}\n",
            "{\"type\":\"laneDone\",\"lane\":\"tasks\",\"pages\":12,\"items\":5800,\"reason\":\"maxItems\"}\n",
            "{\"type\":\"laneError\",\"lane\":\"tasks\",\"message\":\"page response has GraphQL errors\"}\n",
            "{\"type\":\"end\",\"reason\":\"maxPages\"}\n",
        ]
    );
}

#[test]
fn a_calendar_lane_declares_its_coverage_and_no_lane_coverage() {
    let frame = Frame::Lane {
        lane: LaneId::try_from("calendar-near-0".to_owned()).unwrap(),
        query: "query CalendarOccurrences { user { id } }".to_owned(),
        operation_name: "CalendarOccurrences".to_owned(),
        paging: Paging::Calendar,
        kind: LaneKind::Calendar {
            coverage: vec![CalendarSpan {
                kind: SpanKind::Timed,
                start: 0,
                end: 86_400_000,
            }],
        },
        pass_started_at: "2026-11-02T12:00:00.000Z".to_owned(),
    };
    assert_eq!(
        frame.to_line().unwrap().as_ref(),
        b"{\"type\":\"lane\",\"lane\":\"calendar-near-0\",\"query\":\"query CalendarOccurrences { user { id } }\",\"operationName\":\"CalendarOccurrences\",\"paging\":\"calendar\",\"kind\":{\"kind\":\"calendar\",\"coverage\":[{\"kind\":\"timed\",\"start\":0,\"end\":86400000}]},\"passStartedAt\":\"2026-11-02T12:00:00.000Z\"}\n"
    );
}

#[test]
fn a_page_with_nothing_to_resume_sends_null() {
    let frame = Frame::Page {
        lane: LaneId::try_from("tasks".to_owned()).unwrap(),
        page: 3,
        variables: Map::new(),
        response: json!({ "data": null }),
        items: 0,
        resume: None,
    };
    assert_eq!(
        frame.to_line().unwrap().as_ref(),
        b"{\"type\":\"page\",\"lane\":\"tasks\",\"page\":3,\"variables\":{},\"response\":{\"data\":null},\"items\":0,\"resume\":null}\n"
    );
}
