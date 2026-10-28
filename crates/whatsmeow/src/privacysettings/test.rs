// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Privacy settings parsing against whatsmeow's output, and the fetch and
//! cache on the fake server.

use std::sync::Arc;

use super::*;
use crate::client::test::{connect_paired, harness, next_node, node, text};
use crate::testing::is_iq;
use crate::types::ReceiptType;
use crate::vectors::Vectors;

#[test]
fn settings_parse_like_go() {
    let vectors = Vectors::load("pairing_media.json");
    let mut settings = PrivacySettings::default();
    let event = parse_privacy_settings(&vectors.node("privacy_node"), &mut settings);
    assert_eq!(
        settings.read_receipts.as_str(),
        vectors.string("privacy_read_receipts")
    );
    assert_eq!(
        settings.last_seen.as_str(),
        vectors.string("privacy_last_seen")
    );
    let changed: Vec<bool> = vectors
        .value("privacy_changed")
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_bool().unwrap())
        .collect();
    assert_eq!(
        changed,
        [
            event.read_receipts_changed,
            event.last_seen_changed,
            event.group_add_changed
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn read_receipts_follow_the_fetched_setting() {
    let mut harness = harness(Some(("1234:5@s.whatsapp.net", "9876:5@lid")));
    let mut connection = connect_paired(&mut harness).await;
    let client = Arc::clone(&harness.client);
    let mark = tokio::spawn(async move {
        client
            .mark_read(
                &["M1".to_owned()],
                chrono::Utc::now(),
                &crate::types::parse_jid("5550001@s.whatsapp.net").unwrap(),
                &crate::types::Jid::default(),
                None,
            )
            .await
    });
    let query = next_node(&mut connection).await;
    assert!(is_iq(&query, "privacy"));
    connection
        .respond_iq(
            &query,
            vec![node(
                "privacy",
                &[],
                Some(NodeContent::Nodes(vec![node(
                    "category",
                    &[("name", text("readreceipts")), ("value", text("none"))],
                    None,
                )])),
            )],
        )
        .await;
    let receipt = next_node(&mut connection).await;
    assert_eq!(
        crate::testing::attr_string(&receipt, "type"),
        ReceiptType::ReadSelf.as_str()
    );
    mark.await.unwrap().unwrap();
    // Cached now: no second query.
    assert_eq!(
        harness
            .client
            .try_fetch_privacy_settings(false)
            .await
            .unwrap()
            .read_receipts,
        PrivacySetting::None
    );
}
