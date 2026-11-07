// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Expected values come from `testdata/media/vectors.json`, written by
//! `testdata/generator/media` running whatsmeow's Go code.

use chrono::TimeZone;
use serde_json::Value;

use super::*;
use crate::binary::{marshal, unmarshal};

fn vectors() -> Value {
    serde_json::from_str(include_str!("../../testdata/media/vectors.json")).unwrap()
}

fn hex_field(value: &Value) -> Vec<u8> {
    hex::decode(value.as_str().unwrap()).unwrap()
}

#[test]
fn parses_go_media_conn_response() {
    let vector = &vectors()["media_conn"];
    // Go's Marshal prepends the uncompressed flag byte.
    let response = unmarshal(&hex_field(&vector["response"])[1..]).unwrap();

    let before = Utc::now();
    let media_conn = parse_media_conn(&response).unwrap();

    assert_eq!(media_conn.auth, vector["auth"].as_str().unwrap());
    assert_eq!(media_conn.ttl, vector["ttl"].as_i64().unwrap());
    assert_eq!(media_conn.auth_ttl, vector["auth_ttl"].as_i64().unwrap());
    assert_eq!(
        media_conn.max_buckets,
        vector["max_buckets"].as_i64().unwrap()
    );
    let hostnames: Vec<&str> = vector["hosts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|host| host["hostname"].as_str().unwrap())
        .collect();
    assert_eq!(
        media_conn
            .hosts
            .iter()
            .map(|host| host.hostname.as_str())
            .collect::<Vec<_>>(),
        hostnames
    );
    assert!(media_conn.fetched_at >= before && media_conn.fetched_at <= Utc::now());
}

#[test]
fn builds_go_media_conn_request() {
    let vector = &vectors()["media_conn"];
    // Go encodes attributes in map order, so compare the decoded node.
    let request = unmarshal(&hex_field(&vector["request"])[1..]).unwrap();
    assert_eq!(build_media_conn_iq("1234.5678-2"), request);
    assert_eq!(
        unmarshal(&marshal(&request).unwrap()[1..]).unwrap(),
        request
    );
}

#[test]
fn rejects_unexpected_responses() {
    let empty = Node {
        tag: "iq".to_owned(),
        ..Node::default()
    };
    assert_eq!(
        parse_media_conn(&empty).unwrap_err().to_string(),
        "failed to query media connections: unexpected child tag"
    );

    let mut response = build_media_conn_iq("1");
    let error = parse_media_conn(&response).unwrap_err();
    assert_eq!(
        error.to_string(),
        "failed to parse media connections: [didn't find required attribute 'auth' \
         didn't find required attribute 'ttl' didn't find required attribute 'auth_ttl' \
         didn't find required attribute 'max_buckets']"
    );

    let Some(NodeContent::Nodes(children)) = &mut response.content else {
        unreachable!()
    };
    for (key, value) in [
        ("auth", "a"),
        ("ttl", "1"),
        ("auth_ttl", "2"),
        ("max_buckets", "3"),
    ] {
        children[0].attrs.insert(key.to_owned(), value.into());
    }
    children[0].content = Some(NodeContent::Nodes(vec![Node {
        tag: "host".to_owned(),
        ..Node::default()
    }]));
    assert_eq!(
        parse_media_conn(&response).unwrap_err(),
        MediaConnError::InvalidHost(ErrorList(vec![crate::binary::AttrError::Missing(
            "hostname".to_owned()
        )]))
    );
}

#[test]
fn expiry_and_refresh() {
    let media_conn = MediaConn {
        auth: String::new(),
        auth_ttl: 0,
        ttl: 300,
        max_buckets: 0,
        fetched_at: Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
        hosts: Vec::new(),
    };
    let expiry = Utc.with_ymd_and_hms(2026, 1, 1, 0, 5, 0).unwrap();
    assert_eq!(media_conn.expiry(), expiry);

    assert!(media_conn_needs_refresh(None, false, expiry));
    assert!(!media_conn_needs_refresh(Some(&media_conn), false, expiry));
    assert!(media_conn_needs_refresh(Some(&media_conn), true, expiry));
    assert!(media_conn_needs_refresh(
        Some(&media_conn),
        false,
        expiry + TimeDelta::nanoseconds(1)
    ));
}
