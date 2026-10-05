use std::time::{Duration, Instant};

use serde_json::json;

use super::{PEEK_LIMIT, PEEK_WINDOW, StreamingCalls, peek_arguments};

fn peek(prefix: &str) -> Option<serde_json::Value> {
    peek_arguments(prefix).map(serde_json::Value::Object)
}

#[test]
fn an_open_string_reads_as_far_as_it_has_arrived() {
    assert_eq!(
        peek(r#"{"to":"alice@example.com","body":"Hi Al"#),
        Some(json!({ "to": "alice@example.com", "body": "Hi Al" }))
    );
}

#[test]
fn open_containers_close_where_the_prefix_stops() {
    assert_eq!(
        peek(r#"{"ids":["a","b"#),
        Some(json!({ "ids": ["a", "b"] }))
    );
    assert_eq!(
        peek(r#"{"event":{"title":"Standup","attendees":[{"email":"a@b.c""#),
        Some(json!({ "event": { "title": "Standup", "attendees": [{ "email": "a@b.c" }] } }))
    );
}

#[test]
fn a_prefix_ending_in_a_key_falls_back_to_its_last_member() {
    assert_eq!(
        peek(r#"{"query":"cats","lim"#),
        Some(json!({ "query": "cats" }))
    );
    assert_eq!(
        peek(r#"{"query":"cats","limit":"#),
        Some(json!({ "query": "cats" }))
    );
    assert_eq!(
        peek(r#"{"query":"cats","flag":tr"#),
        Some(json!({ "query": "cats" }))
    );
}

#[test]
fn an_escape_cut_in_half_is_dropped() {
    assert_eq!(
        peek(r#"{"text":"say \"hi\"#),
        Some(json!({ "text": "say \"hi" }))
    );
    assert_eq!(peek(r#"{"text":"line\"#), Some(json!({ "text": "line" })));
}

#[test]
fn nothing_complete_is_no_peek() {
    assert_eq!(peek(""), None);
    assert_eq!(peek("{"), Some(json!({})));
    assert_eq!(peek(r#"{"que"#), None);
    assert_eq!(peek(r#"{"query":"#), None);
}

#[test]
fn whole_arguments_read_as_themselves() {
    assert_eq!(
        peek(r#"{"query":"cats","limit":3}"#),
        Some(json!({ "query": "cats", "limit": 3 }))
    );
}

#[test]
fn peeks_go_out_at_most_once_per_window() {
    let start = Instant::now();
    let mut calls = StreamingCalls::default();
    calls.open("call");

    assert_eq!(
        calls.push_arguments("call", r#"{"body":"a"#, start),
        Some(json!({ "body": "a" }))
    );
    assert_eq!(
        calls.push_arguments("call", "b", start + PEEK_WINDOW / 2),
        None,
        "inside the window"
    );
    assert_eq!(
        calls.push_arguments("call", "c", start + PEEK_WINDOW),
        Some(json!({ "body": "abc" })),
        "the next peek carries everything since"
    );
}

#[test]
fn a_peek_that_says_nothing_new_is_not_sent() {
    let start = Instant::now();
    let mut calls = StreamingCalls::default();
    calls.open("call");

    assert!(calls.push_arguments("call", r#"{"a":1,"#, start).is_some());
    assert_eq!(
        calls.push_arguments("call", r#""b"#, start + PEEK_WINDOW),
        None,
        "still only `a`"
    );
}

#[test]
fn long_arguments_stop_being_peeked() {
    let start = Instant::now();
    let mut calls = StreamingCalls::default();
    calls.open("call");

    assert!(
        calls
            .push_arguments("call", r#"{"body":""#, start)
            .is_some()
    );
    let long = "x".repeat(PEEK_LIMIT);
    assert_eq!(
        calls.push_arguments("call", &long, start + Duration::from_secs(1)),
        None
    );
    assert_eq!(
        calls.push_arguments("call", "y", start + Duration::from_secs(2)),
        None
    );
}

#[test]
fn fragments_of_an_unopened_call_are_ignored() {
    let mut calls = StreamingCalls::default();
    assert_eq!(
        calls.push_arguments("stray", r#"{"a":1}"#, Instant::now()),
        None
    );
}

#[test]
fn calls_left_open_are_reported_in_open_order() {
    let mut calls = StreamingCalls::default();
    calls.open("first");
    calls.open("second");
    calls.open("third");

    assert!(calls.finish("second"));
    assert!(!calls.finish("never-opened"));
    assert_eq!(calls.into_unfinished(), vec!["first", "third"]);
}
