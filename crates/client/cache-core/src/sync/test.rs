use super::*;
use serde_json::json;

fn lane(id: &str, kind: Json) -> Json {
    json!({
        "id": id,
        "query": "query Q { user { id } }",
        "variables": {"input": {"initial": {"limit": 2}}},
        "paging": "soup",
        "kind": kind,
        "passStartedAt": "2026-11-01T00:00:00.000Z",
    })
}

fn args(lanes: Vec<Json>) -> SyncStartArgs {
    serde_json::from_value(json!({
        "url": "https://example.test/items/soup/graphql/stream",
        "headers": {"x-macro-mail-cache-profile": "v2"},
        "lanes": lanes,
        "maxPages": 3,
    }))
    .unwrap()
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
    let mut run =
        SyncRun::new(&args(vec![lane("tasks", json!({"kind":"hydrate"}))]), 10.0).unwrap();
    let stream = concat!(
        r#"{"type":"page","lane":"tasks","page":0,"variables":{"input":{}},"response":{"data":{"user":{"id":"u"}}},"items":0,"nextVariables":null}"#,
        "\n",
        r#"{"type":"laneDone","lane":"tasks","pages":1,"items":0,"reason":"complete"}"#,
        "\n",
        r#"{"type":"waiting"}"#,
        "\n",
        r#"{"type":"laneError","lane":"tasks","message":"boom"}"#,
        "\n",
        r#"{"type":"end","reason":"maxPages"}"#,
        "\n",
    );
    let (head, tail) = stream.split_at(40);
    assert_eq!(run.push_bytes(head.as_bytes()).unwrap(), 0);
    assert_eq!(run.push_bytes(tail.as_bytes()).unwrap(), 5);
    let frames = run.pending.iter().cloned().collect::<Vec<_>>();
    assert!(
        matches!(&frames[0], SyncFrame::Page { lane, next_variables: None, .. } if lane == "tasks")
    );
    assert!(matches!(
        &frames[1],
        SyncFrame::LaneDone {
            reason: SyncLaneDoneReason::Complete,
            pages: 1,
            ..
        }
    ));
    assert_eq!(frames[2], SyncFrame::Waiting);
    assert!(matches!(&frames[3], SyncFrame::LaneError { message, .. } if message == "boom"));
    assert_eq!(
        frames[4],
        SyncFrame::End {
            reason: SyncEndReason::MaxPages
        }
    );
    assert_eq!(run.partial(25.0).bytes, stream.len() as u64);
    assert_eq!(run.partial(25.0).duration_ms, 15.0);
}

#[test]
fn malformed_frames_and_unterminated_streams_are_stream_errors() {
    let mut run = SyncRun::new(&args(vec![lane("tasks", json!({"kind":"hydrate"}))]), 0.0).unwrap();
    assert!(matches!(
        run.push_bytes(b"{\"type\":\"unknown\"}\n"),
        Err(SyncStreamError::Stream(_))
    ));

    let mut run = SyncRun::new(&args(vec![lane("tasks", json!({"kind":"hydrate"}))]), 0.0).unwrap();
    run.push_bytes(b"{\"type\":\"end\"").unwrap();
    assert!(matches!(run.finish(1.0), Err(SyncStreamError::Stream(_))));

    let run = SyncRun::new(&args(vec![lane("tasks", json!({"kind":"hydrate"}))]), 0.0).unwrap();
    assert_eq!(
        run.finish(1.0),
        Err(SyncStreamError::Stream(
            "stream closed without an end frame".to_owned()
        ))
    );
}

#[test]
fn plans_are_validated_before_any_request() {
    let invalid = [
        vec![lane("Tasks", json!({"kind":"hydrate"}))],
        vec![lane(&"a".repeat(65), json!({"kind":"hydrate"}))],
        vec![
            lane("tasks", json!({"kind":"hydrate"})),
            lane("tasks", json!({"kind":"hydrate"})),
        ],
        vec![lane("ids", json!({"kind":"membership","scopes":[]}))],
        vec![{
            let mut lane = lane("ids", json!({"kind":"membership","scopes":["tasks"]}));
            lane["maxItems"] = json!(10);
            lane
        }],
        vec![lane(
            "calendar-1",
            json!({"kind":"calendar","coverage":[{"kind":"timed","start":0,"end":1}]}),
        )],
    ];
    for lanes in invalid {
        assert!(
            matches!(
                SyncRun::new(&args(lanes.clone()), 0.0),
                Err(SyncStreamError::Plan(_))
            ),
            "{lanes:?}"
        );
    }
    let mut calendar = lane(
        "calendar-1",
        json!({"kind":"calendar","coverage":[{"kind":"timed","start":0,"end":1}]}),
    );
    calendar["paging"] = json!("calendar");
    // Nothing to sync is a valid plan; the server answers `end complete`.
    let mut empty = args(Vec::new());
    empty.max_pages = Some(0);
    let mut run = SyncRun::new(&empty, 0.0).unwrap();
    assert_eq!(run.request_body(), json!({"lanes": [], "maxPages": 0}));
    run.push_bytes(b"{\"type\":\"end\",\"reason\":\"maxPages\"}\n")
        .unwrap();
    SyncRun::new(
        &args(vec![
            lane("tasks", json!({"kind":"hydrate"})),
            lane("tasks-ids", json!({"kind":"membership","scopes":["tasks"]})),
            calendar,
        ]),
        0.0,
    )
    .unwrap();
}

#[test]
fn request_body_carries_only_the_server_fields() {
    let mut tasks = lane("tasks", json!({"kind":"hydrate"}));
    tasks["operationName"] = json!("SoupBackfillSyncTasks");
    tasks["maxItems"] = json!(1000);
    tasks["coverage"] = json!({"entity":"task","scope":"all"});
    let run = SyncRun::new(&args(vec![tasks]), 0.0).unwrap();
    assert_eq!(
        run.request_body(),
        json!({
            "lanes": [{
                "id": "tasks",
                "query": "query Q { user { id } }",
                "operationName": "SoupBackfillSyncTasks",
                "variables": {"input": {"initial": {"limit": 2}}},
                "paging": "soup",
                "maxItems": 1000,
            }],
            "maxPages": 3,
        })
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
