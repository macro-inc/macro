use super::*;
use crate::calendar::CalendarSpanKind;
use serde_json::json;

fn args(extra: Json) -> SyncStartArgs {
    let mut args = json!({
        "url": "https://example.test/items/soup/graphql/stream",
        "headers": {"x-macro-mail-cache-profile": "v2"},
        "pass": "first",
    });
    args.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    serde_json::from_value(args).unwrap()
}

fn run() -> SyncRun {
    SyncRun::new(&args(json!({})), &[], &[], 10.0).unwrap()
}

fn declare(id: &str, paging: SyncPaging, kind: SyncLaneKind) -> SyncLane {
    SyncLane {
        id: id.to_owned(),
        query: "query Q { user { id } }".to_owned(),
        operation_name: Some("Q".to_owned()),
        paging,
        kind,
        pass_started_at: "2026-11-01T00:00:00.000Z".to_owned(),
    }
}

#[test]
fn decoder_joins_lines_split_across_chunks_and_skips_blank_lines() {
    let mut decoder = NdjsonDecoder::default();
    assert_eq!(decoder.push(b"{\"a\":").unwrap(), Vec::<Vec<u8>>::new());
    assert_eq!(
        decoder.push(b"1}\n\n{\"b\"").unwrap(),
        vec![b"{\"a\":1}".to_vec()]
    );
    assert!(decoder.finish().is_err());
    assert_eq!(
        decoder.push(b":2}\r\n{\"c\":3}\n").unwrap(),
        vec![b"{\"b\":2}".to_vec(), b"{\"c\":3}".to_vec()]
    );
    decoder.finish().unwrap();
}

#[test]
fn decoder_splits_a_byte_at_a_time() {
    let stream = b"{\"type\":\"end\",\"reason\":\"complete\"}\n";
    let mut decoder = NdjsonDecoder::default();
    let mut lines = Vec::new();
    for byte in stream {
        lines.extend(decoder.push(std::slice::from_ref(byte)).unwrap());
    }
    assert_eq!(lines, vec![stream[..stream.len() - 1].to_vec()]);
}

#[test]
fn run_decodes_every_frame_type_and_counts_bytes() {
    let mut run = run();
    let stream = concat!(
        r#"{"type":"lane","lane":"tasks","query":"query Q { user { id } }","operationName":"Q","paging":"soup","kind":{"kind":"hydrate"},"passStartedAt":"2026-11-01T00:00:00.000Z"}"#,
        "\n",
        r#"{"type":"page","lane":"tasks","page":0,"variables":{"input":{}},"response":{"data":{"user":{"id":"u"}}},"items":0,"resume":{"cursor":"c1"}}"#,
        "\n",
        r#"{"type":"laneDone","lane":"tasks","pages":1,"items":0,"reason":"complete"}"#,
        "\n",
        r#"{"type":"waiting"}"#,
        "\n",
        r#"{"type":"laneError","lane":"tasks","message":"boom"}"#,
        "\n",
        r#"{"type":"progress","lane":"tasks","items":3}"#,
        "\n",
        r#"{"type":"end","reason":"maxPages"}"#,
        "\n",
    );
    let (head, tail) = stream.split_at(40);
    assert_eq!(run.push_bytes(head.as_bytes()).unwrap(), 0);
    assert_eq!(run.push_bytes(tail.as_bytes()).unwrap(), 7);
    let frames = run.pending.iter().cloned().collect::<Vec<_>>();
    assert!(matches!(
        &frames[0],
        SyncFrame::Lane { lane, operation_name: Some(name), paging: SyncPaging::Soup, .. }
            if lane == "tasks" && name == "Q"
    ));
    assert!(
        matches!(&frames[1], SyncFrame::Page { lane, resume: Some(resume), .. } if lane == "tasks" && *resume == json!({"cursor": "c1"}))
    );
    assert!(matches!(
        &frames[2],
        SyncFrame::LaneDone {
            reason: SyncLaneDoneReason::Complete,
            pages: 1,
            ..
        }
    ));
    assert_eq!(frames[3], SyncFrame::Waiting);
    assert!(matches!(&frames[4], SyncFrame::LaneError { message, .. } if message == "boom"));
    // A line type this engine does not know is kept as nothing to apply.
    assert_eq!(frames[5], SyncFrame::Unrecognized);
    assert_eq!(
        frames[6],
        SyncFrame::End {
            reason: SyncEndReason::MaxPages
        }
    );
    assert_eq!(run.partial(25.0).bytes, stream.len() as u64);
    assert_eq!(run.partial(25.0).duration_ms, 15.0);
}

#[test]
fn a_page_without_a_checkpoint_decodes() {
    let mut run = run();
    run.push_bytes(b"{\"type\":\"page\",\"lane\":\"tasks\",\"page\":0,\"variables\":{},\"response\":{},\"items\":0,\"resume\":null}\n")
        .unwrap();
    run.push_bytes(
        b"{\"type\":\"page\",\"lane\":\"tasks\",\"page\":1,\"variables\":{},\"response\":{},\"items\":0}\n",
    )
    .unwrap();
    assert!(
        run.pending
            .iter()
            .all(|frame| matches!(frame, SyncFrame::Page { resume: None, .. }))
    );
}

#[test]
fn malformed_frames_and_unterminated_streams_are_stream_errors() {
    // A known line type must still have its fields; only unknown types skip.
    for line in [
        &b"{\"type\":\"laneDone\",\"lane\":\"tasks\"}\n"[..],
        b"{\"type\":\"end\",\"reason\":\"later\"}\n",
        b"{\"lane\":\"tasks\"}\n",
        b"{\"type\":\"lane\",\"lane\":\"tasks\",\"query\":\"query Q { user { id } }\",\"paging\":\"grouped\",\"kind\":{\"kind\":\"hydrate\"},\"passStartedAt\":\"x\"}\n",
        b"{\"type\":\"lane\",\"lane\":\"tasks\",\"query\":\"query Q { user { id } }\",\"paging\":\"soup\",\"kind\":{\"kind\":\"hydrate\"}}\n",
    ] {
        let mut run = run();
        assert!(matches!(
            run.push_bytes(line),
            Err(SyncStreamError::Stream(_))
        ));
    }

    let mut run = run();
    run.push_bytes(b"{\"type\":\"end\"").unwrap();
    assert!(matches!(run.finish(1.0), Err(SyncStreamError::Stream(_))));

    assert_eq!(
        self::run().finish(1.0),
        Err(SyncStreamError::Stream(
            "stream closed without an end frame".to_owned()
        ))
    );
}

#[test]
fn a_lane_line_that_breaks_the_contract_is_refused() {
    let membership = |scopes: &[&str]| SyncLaneKind::Membership {
        scopes: scopes.iter().map(|scope| (*scope).to_owned()).collect(),
    };
    let calendar = |start, end| SyncLaneKind::Calendar {
        coverage: vec![CalendarSpan {
            kind: CalendarSpanKind::Timed,
            start,
            end,
        }],
    };
    for lane in [
        declare("Tasks", SyncPaging::Soup, SyncLaneKind::Hydrate),
        declare(&"a".repeat(65), SyncPaging::Soup, SyncLaneKind::Hydrate),
        declare("ids", SyncPaging::Soup, membership(&[])),
        declare("ids", SyncPaging::Soup, membership(&["Tasks"])),
        declare("calendar-1", SyncPaging::Soup, calendar(0, 1)),
        declare("calendar-1", SyncPaging::Calendar, calendar(2, 1)),
    ] {
        let mut run = run();
        assert!(
            matches!(run.declare(lane.clone()), Err(SyncStreamError::Stream(_))),
            "{lane:?}"
        );
        assert!(run.lanes.is_empty());
    }

    let mut run = run();
    run.declare(declare("tasks", SyncPaging::Soup, SyncLaneKind::Hydrate))
        .unwrap();
    run.declare(declare(
        "tasks-ids",
        SyncPaging::Soup,
        membership(&["tasks"]),
    ))
    .unwrap();
    run.declare(declare("calendar-1", SyncPaging::Calendar, calendar(0, 1)))
        .unwrap();
    assert!(matches!(
        run.declare(declare("tasks", SyncPaging::Soup, SyncLaneKind::Hydrate)),
        Err(SyncStreamError::Stream(message)) if message.contains("twice")
    ));
    let ids = run
        .lanes
        .iter()
        .map(|lane| lane.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(ids, ["tasks", "tasks-ids", "calendar-1"]);
    // The summary lists lanes in the order they were declared.
    let summary = run.partial(10.0);
    let ids = summary
        .lanes
        .iter()
        .map(|lane| lane.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(ids, ["tasks", "tasks-ids", "calendar-1"]);
}

#[test]
fn arguments_are_checked_before_any_request() {
    for extra in [
        json!({"skipLanes": ["Tasks"]}),
        json!({"calendar": {"timeZone": ""}}),
    ] {
        assert!(
            matches!(
                SyncRun::new(&args(extra.clone()), &[], &[], 0.0),
                Err(SyncStreamError::Plan(_))
            ),
            "{extra}"
        );
    }
}

#[test]
fn the_request_carries_the_pass_and_every_lane_s_saved_state() {
    let saved = [
        SyncLaneState {
            id: "documents-recent".to_owned(),
            resume: Some(json!({"cursor": "c1", "items": 500})),
            pages: 1,
            items: 500,
            pass_started_at: Some("2026-11-01T00:00:00.000Z".to_owned()),
            ..SyncLaneState::default()
        },
        SyncLaneState {
            id: "tasks".to_owned(),
            completed_at: Some("2026-11-01T00:10:00.000Z".to_owned()),
            watermark: Some("2026-11-01T00:00:00.000Z".to_owned()),
            ..SyncLaneState::default()
        },
    ];
    let coverage = [CalendarSpan {
        kind: CalendarSpanKind::AllDay,
        start: 20_758,
        end: 20_788,
    }];
    let run = SyncRun::new(
        &args(json!({
            "pass": "second",
            "maxPages": 20,
            "calendar": {"timeZone": "Europe/Berlin"},
            "completedSince": "2026-11-02T00:00:00.000Z",
            "skipLanes": ["email-older"],
        })),
        &saved,
        &coverage,
        0.0,
    )
    .unwrap();
    assert_eq!(
        *run.request_body(),
        json!({
            "protocol": SYNC_PROTOCOL,
            "pass": "second",
            "lanes": [
                {"id": "documents-recent", "resume": {"cursor": "c1", "items": 500}},
                {"id": "tasks", "watermark": "2026-11-01T00:00:00.000Z", "completedAt": "2026-11-01T00:10:00.000Z"},
            ],
            "calendar": {
                "timeZone": "Europe/Berlin",
                "coverage": [{"kind": "allDay", "start": 20_758, "end": 20_788}],
            },
            "completedSince": "2026-11-02T00:00:00.000Z",
            "skipLanes": ["email-older"],
            "maxPages": 20,
        })
    );
    // Without calendar arguments no coverage goes out, whatever is cached.
    let run = SyncRun::new(&args(json!({})), &[], &coverage, 0.0).unwrap();
    assert_eq!(
        *run.request_body(),
        json!({"protocol": 1, "pass": "first", "lanes": []})
    );
}

#[test]
fn lowest_watermark_keeps_the_per_link_minimum() {
    let link = |link_id: &str, seq: i64| CalendarLinkWatermark {
        link_id: link_id.to_owned(),
        seq,
    };
    let first = [link("a", 7), link("b", 2)];
    let second = [link("a", 3), link("c", 9)];
    assert_eq!(
        lowest_watermark([first.as_slice(), second.as_slice(), &[]]),
        vec![link("a", 3), link("b", 2), link("c", 9)]
    );
}
