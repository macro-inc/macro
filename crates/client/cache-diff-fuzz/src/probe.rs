//! The fixed reads a probe runs: every sort and direction over every
//! partition, every Mail view to its last page, browse and typed search.

use crate::sequence::excluded;
use serde_json::{Value, json};

/// The sorts the local index answers, and one it leaves to the server.
const SORTS: &[&str] = &["UPDATED_AT", "CREATED_AT", "VIEWED_UPDATED"];
const VIEWS: &[&str] = &[
    "INBOX",
    "ALL",
    "DRAFTS",
    "SENT",
    "STARRED",
    "IMPORTANT",
    "OTHER",
];

pub fn filters() -> Vec<Value> {
    let mut out = Vec::new();
    let partitions = [
        excluded(&[
            "documentFilter",
            "projectFilter",
            "chatFilter",
            "channelFilter",
        ]),
        excluded(&["documentFilter", "projectFilter", "chatFilter"]),
        excluded(&["documentFilter"]),
        excluded(&["channelFilter"]),
    ];
    for filters in &partitions {
        for sort in SORTS {
            for direction in ["DESC", "ASC"] {
                for limit in [1, 63, 64, 65, 500] {
                    out.push(json!({
                        "filters": filters,
                        "sortMethod": sort,
                        "sortDirection": direction,
                        "limit": limit,
                    }));
                }
            }
        }
    }
    for view in VIEWS {
        for direction in ["DESC", "ASC"] {
            out.push(json!({
                "filters": excluded(&["emailFilter"]),
                "sortMethod": "UPDATED_AT",
                "sortDirection": direction,
                "limit": 50,
                "mail": { "view": view },
            }));
        }
    }
    out
}

pub fn searches() -> Vec<Value> {
    [
        "", "pro", "PROJECT", "café", "cafe", "日本", "a-b", "ﬁ", "straße", "o'neil",
    ]
    .iter()
    .map(|query| {
        json!({
            "profile": "quick-access-v1",
            "query": query,
            "limit": 50,
            "nowMs": crate::sequence::NOW_MS,
        })
    })
    .collect()
}

pub fn people() -> Vec<Value> {
    ["", "a", "example"]
        .iter()
        .map(|query| {
            json!({
                "mode": "command",
                "query": query,
                "excluded": [],
                "senderDomain": null,
                "limit": 20,
                "nowMs": crate::sequence::NOW_MS,
                "cursor": null,
            })
        })
        .collect()
}
