// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Presence nodes against whatsmeow's own output (`testdata/presence.json`,
//! see `testdata/generator`), and incoming presences and chat states against
//! the fake server.

use std::sync::Arc;

use super::*;
use crate::binary::AttributeValue;
use crate::client::test::{
    capture_request, children, connect_paired, harness, jid, next_event, node, text,
};
use crate::types::parse_jid;
use crate::vectors::Vectors;

const OWN: (&str, &str) = ("1234:5@s.whatsapp.net", "9876:5@lid");

#[tokio::test(start_paused = true)]
async fn presence_nodes_match_go() {
    let vectors = Vectors::load("presence.json");
    let requests = vectors.value("requests");
    let mut harness = harness(Some(OWN));
    let mut connection = connect_paired(&mut harness).await;
    let to = parse_jid("5555@s.whatsapp.net").unwrap();

    let expected = |key: &str| {
        let data = hex::decode(requests[key].as_str().unwrap()).unwrap();
        crate::binary::unmarshal(&crate::binary::unpack(&data).unwrap()).unwrap()
    };
    let client = Arc::clone(&harness.client);
    let request = capture_request(&mut connection, async move {
        client.send_presence(Presence::Unavailable).await
    })
    .await;
    assert_eq!(request, expected("unavailable"));
    let client = Arc::clone(&harness.client);
    let target = to.clone();
    let request = capture_request(&mut connection, async move {
        client.subscribe_presence(&target).await
    })
    .await;
    assert_eq!(request, expected("subscribe"));
    let client = Arc::clone(&harness.client);
    let target = to.clone();
    let request = capture_request(&mut connection, async move {
        client
            .send_chat_presence(&target, ChatPresence::Composing, ChatPresenceMedia::Audio)
            .await
    })
    .await;
    assert_eq!(request, expected("composing_audio"));
    let client = Arc::clone(&harness.client);
    let request = capture_request(&mut connection, async move {
        client
            .send_chat_presence(&to, ChatPresence::Paused, ChatPresenceMedia::Audio)
            .await
    })
    .await;
    assert_eq!(request, expected("paused"));
}

#[tokio::test(start_paused = true)]
async fn presence_needs_a_push_name_and_can_require_a_privacy_token() {
    let mut harness = crate::client::test::harness_with(Some(OWN), |config| {
        config.error_on_subscribe_presence_without_token = true;
    });
    let _connection = connect_paired(&mut harness).await;
    let error = harness
        .client
        .subscribe_presence(&parse_jid("5555@s.whatsapp.net").unwrap())
        .await
        .unwrap_err();
    assert!(matches!(error, ClientError::NoPrivacyToken));

    harness.client.store.write().await.push_name.clear();
    let error = harness
        .client
        .send_presence(Presence::Available)
        .await
        .unwrap_err();
    assert!(matches!(error, ClientError::NoPushName));
}

async fn next_presence_event(events: &mut tokio::sync::mpsc::UnboundedReceiver<Event>) -> Event {
    loop {
        let event = next_event(events).await;
        if matches!(event, Event::Presence(_) | Event::ChatPresence(_)) {
            return event;
        }
    }
}

#[tokio::test(start_paused = true)]
async fn incoming_presences_and_chat_states_become_events() {
    let mut harness = harness(Some(OWN));
    let mut connection = connect_paired(&mut harness).await;

    connection
        .send_node(&node(
            "presence",
            &[
                ("from", jid("5555@s.whatsapp.net")),
                ("type", text("unavailable")),
                ("last", text("1700000000")),
            ],
            None,
        ))
        .await;
    let Event::Presence(presence) = next_presence_event(&mut harness.events).await else {
        panic!("expected a presence");
    };
    assert_eq!(presence.from.to_string(), "5555@s.whatsapp.net");
    assert!(presence.unavailable);
    assert_eq!(
        presence.last_seen.map(|time| time.timestamp()),
        Some(1_700_000_000)
    );

    connection
        .send_node(&node(
            "presence",
            &[("from", jid("6666@lid")), ("last", text("deny"))],
            None,
        ))
        .await;
    let Event::Presence(presence) = next_presence_event(&mut harness.events).await else {
        panic!("expected a presence");
    };
    assert!(!presence.unavailable);
    assert_eq!(presence.last_seen, None);

    connection
        .send_node(&node(
            "chatstate",
            &[
                ("from", jid("120363001234567890@g.us")),
                ("participant", jid("6666@lid")),
                ("participant_pn", jid("5555@s.whatsapp.net")),
            ],
            children(vec![node("composing", &[("media", text("audio"))], None)]),
        ))
        .await;
    let Event::ChatPresence(chat_presence) = next_presence_event(&mut harness.events).await else {
        panic!("expected a chat presence");
    };
    assert_eq!(chat_presence.state, ChatPresence::Composing);
    assert_eq!(chat_presence.media, ChatPresenceMedia::Audio);
    assert!(chat_presence.source.is_group);
    assert_eq!(
        chat_presence.source.chat.to_string(),
        "120363001234567890@g.us"
    );
    assert_eq!(chat_presence.source.sender.to_string(), "6666@lid");
    assert_eq!(
        chat_presence.source.sender_alt.to_string(),
        "5555@s.whatsapp.net"
    );

    // A direct chat state from one of our own other devices.
    connection
        .send_node(&node(
            "chatstate",
            &[
                (
                    "from",
                    AttributeValue::Jid(parse_jid("1234:7@s.whatsapp.net").unwrap()),
                ),
                ("recipient", jid("5555@s.whatsapp.net")),
            ],
            children(vec![node("paused", &[], None)]),
        ))
        .await;
    let Event::ChatPresence(chat_presence) = next_presence_event(&mut harness.events).await else {
        panic!("expected a chat presence");
    };
    assert_eq!(chat_presence.state, ChatPresence::Paused);
    assert!(chat_presence.source.is_from_me);
    assert_eq!(chat_presence.source.chat.to_string(), "5555@s.whatsapp.net");

    // A chat state without exactly one child is dropped.
    connection
        .send_node(&node(
            "chatstate",
            &[("from", jid("5555@s.whatsapp.net"))],
            None,
        ))
        .await;
    connection
        .send_node(&node(
            "presence",
            &[("from", jid("7777@s.whatsapp.net"))],
            None,
        ))
        .await;
    let Event::Presence(presence) = next_presence_event(&mut harness.events).await else {
        panic!("the dropped chat state emits nothing");
    };
    assert_eq!(presence.from.to_string(), "7777@s.whatsapp.net");
}
