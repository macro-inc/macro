use super::*;
use serde_json::json;

#[test]
fn encodes_each_frame_as_one_ndjson_line() {
    let lane = LaneId::try_from("tasks".to_owned()).unwrap();
    let Value::Object(variables) = json!({ "input": { "initial": { "limit": 2 } } }) else {
        panic!("variables literal is an object");
    };
    let Value::Object(next_variables) =
        json!({ "input": { "continuation": { "cursor": "c1\nc2" } } })
    else {
        panic!("next variables literal is an object");
    };
    let frames = [
        Frame::Page {
            lane: lane.clone(),
            page: 0,
            variables,
            response: json!({ "data": { "user": { "soup": { "nextCursor": "c1\nc2" } } } }),
            items: 2,
            next_variables: Some(next_variables),
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
            "{\"type\":\"page\",\"lane\":\"tasks\",\"page\":0,\"variables\":{\"input\":{\"initial\":{\"limit\":2}}},\"response\":{\"data\":{\"user\":{\"soup\":{\"nextCursor\":\"c1\\nc2\"}}}},\"items\":2,\"nextVariables\":{\"input\":{\"continuation\":{\"cursor\":\"c1\\nc2\"}}}}\n",
            "{\"type\":\"laneDone\",\"lane\":\"tasks\",\"pages\":12,\"items\":5800,\"reason\":\"maxItems\"}\n",
            "{\"type\":\"laneError\",\"lane\":\"tasks\",\"message\":\"page response has GraphQL errors\"}\n",
            "{\"type\":\"end\",\"reason\":\"maxPages\"}\n",
        ]
    );
}

#[test]
fn a_finished_lane_page_sends_null_next_variables() {
    let frame = Frame::Page {
        lane: LaneId::try_from("tasks".to_owned()).unwrap(),
        page: 3,
        variables: Map::new(),
        response: json!({ "data": null }),
        items: 0,
        next_variables: None,
    };
    assert_eq!(
        frame.to_line().unwrap().as_ref(),
        b"{\"type\":\"page\",\"lane\":\"tasks\",\"page\":3,\"variables\":{},\"response\":{\"data\":null},\"items\":0,\"nextVariables\":null}\n"
    );
}
