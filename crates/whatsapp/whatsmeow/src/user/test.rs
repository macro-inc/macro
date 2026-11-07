// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Device lists, blocklists and usync requests against whatsmeow's own
//! output (`testdata/user.json`, see `testdata/generator`), and the user
//! queries against the fake server.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};

use super::*;
use crate::client::test::{
    Harness, capture_request, children, connect_paired, harness, jid, next_node, node, text,
};
use crate::store::LidStore;
use crate::testing::{ServerConnection, attr_string, is_iq};
use crate::vectors::Vectors;

const OWN: (&str, &str) = ("1234:5@s.whatsapp.net", "9876:5@lid");

fn node_from_hex(value: &Value) -> Node {
    let data = hex::decode(value.as_str().unwrap()).unwrap();
    crate::binary::unmarshal(&crate::binary::unpack(&data).unwrap()).unwrap()
}

fn jid_strings(jids: &[Jid]) -> Vec<String> {
    jids.iter().map(ToString::to_string).collect()
}

fn parse(value: &str) -> Jid {
    parse_jid(value).unwrap()
}

#[test]
fn device_lists_and_blocklists_parse_like_go() {
    let vectors = Vectors::load("user.json");
    let Value::Array(device_lists) = vectors.value("device_lists") else {
        panic!("device_lists is a list");
    };
    for device_list in device_lists {
        let user = parse(device_list["user"].as_str().unwrap());
        let devices = parse_device_list(&user, &node_from_hex(&device_list["node"]));
        assert_eq!(json!(jid_strings(&devices)), device_list["devices"]);
        assert_eq!(participant_list_hash_v2(&devices), device_list["hash"]);
    }

    let (blocklist, mappings) = Client::parse_blocklist(&vectors.node("blocklist_node"));
    assert_eq!(
        json!({
            "d_hash": blocklist.d_hash,
            "addressing_mode": blocklist.addressing_mode.as_str(),
            "items": blocklist.items.iter().map(|item| json!({
                "lid": item.lid.to_string(),
                "pn": item.pn.to_string(),
                "active": item.active,
            })).collect::<Vec<_>>(),
        }),
        *vectors.value("blocklist")
    );
    assert_eq!(
        json!(
            mappings
                .iter()
                .map(|pair| [pair.lid.to_string(), pair.pn.to_string()])
                .collect::<Vec<_>>()
        ),
        *vectors.value("blocklist_lid_pairs")
    );
}

#[tokio::test(start_paused = true)]
async fn user_requests_match_go() {
    let vectors = Vectors::load("user.json");
    let requests = vectors.value("requests");
    let mut harness = harness(Some(OWN));
    let mut connection = connect_paired(&mut harness).await;

    macro_rules! check {
        ($key:literal, |$client:ident| $call:expr) => {{
            let $client = Arc::clone(&harness.client);
            let request = capture_request(&mut connection, async move {
                let _ = $call;
            })
            .await;
            assert_eq!(request, node_from_hex(&requests[$key]), $key);
        }};
    }

    check!("get_user_devices", |client| client
        .get_user_devices(&[parse("5555@s.whatsapp.net"), parse("6666:3@lid")])
        .await);
    check!("is_on_whatsapp", |client| client
        .is_on_whatsapp(&["+15551234567"])
        .await);
    check!("get_user_info", |client| client
        .get_user_info(&[parse("5555@s.whatsapp.net"), parse("6666@lid")])
        .await);
    check!("profile_picture_preview", |client| client
        .get_profile_picture_info(
            &parse("5555@s.whatsapp.net"),
            &GetProfilePictureParams {
                preview: true,
                existing_id: "old".to_owned(),
                ..GetProfilePictureParams::default()
            },
        )
        .await);
    check!("profile_picture_full", |client| client
        .get_profile_picture_info(
            &parse("5555@s.whatsapp.net"),
            &GetProfilePictureParams {
                common_gid: parse("120363001234567890@g.us"),
                invite_code: "inv".to_owned(),
                persona_id: "persona".to_owned(),
                ..GetProfilePictureParams::default()
            },
        )
        .await);
    check!("profile_picture_community", |client| client
        .get_profile_picture_info(
            &parse("120363009999999999@g.us"),
            &GetProfilePictureParams {
                is_community: true,
                ..GetProfilePictureParams::default()
            },
        )
        .await);
    check!("get_blocklist", |client| client.get_blocklist("").await);
    check!("get_blocklist_with_hash", |client| client
        .get_blocklist("hash1")
        .await);
    check!("block_lid", |client| client
        .update_blocklist(&parse("6666@lid"), BlocklistChangeAction::Block, "hash1")
        .await);
    check!("unblock_lid", |client| client
        .update_blocklist(&parse("6666@lid"), BlocklistChangeAction::Unblock, "")
        .await);
}

fn usync_devices_response(users: Vec<(&str, &[&str])>) -> Node {
    node(
        "usync",
        &[],
        children(vec![node(
            "list",
            &[],
            children(
                users
                    .into_iter()
                    .map(|(user, device_ids)| {
                        node(
                            "user",
                            &[("jid", jid(user))],
                            children(vec![node(
                                "devices",
                                &[],
                                children(vec![node(
                                    "device-list",
                                    &[],
                                    children(
                                        device_ids
                                            .iter()
                                            .map(|id| node("device", &[("id", text(id))], None))
                                            .collect(),
                                    ),
                                )]),
                            )]),
                        )
                    })
                    .collect(),
            ),
        )]),
    )
}

fn usync_user_jids(request: &Node) -> Vec<String> {
    request
        .get_child_by_tag(&["usync", "list"])
        .get_children()
        .iter()
        .map(|user| attr_string(user, "jid"))
        .collect()
}

async fn devices_of(
    harness: &Harness,
    connection: &mut ServerConnection,
    jids: Vec<Jid>,
    response: Option<Node>,
) -> Vec<String> {
    let client = Arc::clone(&harness.client);
    let call = tokio::spawn(async move { client.get_user_devices(&jids).await });
    if let Some(response) = response {
        let request = next_node(connection).await;
        connection.respond_iq(&request, vec![response]).await;
    }
    jid_strings(&call.await.unwrap().unwrap())
}

#[tokio::test(start_paused = true)]
async fn user_devices_are_cached_until_a_device_notification() {
    let mut harness = harness(Some(OWN));
    let mut connection = connect_paired(&mut harness).await;
    let users = vec![parse("5555@s.whatsapp.net"), parse("6666@lid")];

    let client = Arc::clone(&harness.client);
    let first_users = users.clone();
    let first = tokio::spawn(async move { client.get_user_devices(&first_users).await });
    let request = next_node(&mut connection).await;
    assert!(is_iq(&request, "usync"));
    let usync = request.get_child_by_tag(&["usync"]);
    assert_eq!(attr_string(usync, "mode"), "query");
    assert_eq!(attr_string(usync, "context"), "message");
    assert_eq!(
        usync_user_jids(&request),
        ["5555@s.whatsapp.net", "6666@lid"]
    );
    connection
        .respond_iq(
            &request,
            vec![usync_devices_response(vec![
                ("5555@s.whatsapp.net", &["0", "2"]),
                ("6666@lid", &["0"]),
            ])],
        )
        .await;
    let expected = ["5555@s.whatsapp.net", "5555:2@s.whatsapp.net", "6666@lid"];
    assert_eq!(jid_strings(&first.await.unwrap().unwrap()), expected);

    // Cached: answered without a query.
    assert_eq!(
        devices_of(&harness, &mut connection, users.clone(), None).await,
        expected
    );
    let cached = harness.client.user_devices_cache.lock().await;
    assert_eq!(
        cached.get(&parse("5555@s.whatsapp.net")).unwrap().dhash,
        participant_list_hash_v2(&[parse("5555@s.whatsapp.net"), parse("5555:2@s.whatsapp.net")])
    );
    drop(cached);

    connection
        .send_node(&node(
            "notification",
            &[
                ("id", text("d1")),
                ("type", text("devices")),
                ("from", jid("5555@s.whatsapp.net")),
                ("t", text("1700000000")),
            ],
            children(vec![node(
                "update",
                &[("device_hash", text("2:whatever"))],
                children(vec![node(
                    "device",
                    &[("jid", jid("5555:2@s.whatsapp.net"))],
                    None,
                )]),
            )]),
        ))
        .await;
    let ack = next_node(&mut connection).await;
    assert_eq!(ack.tag, "ack");

    let client = Arc::clone(&harness.client);
    let again = tokio::spawn(async move { client.get_user_devices(&users).await });
    let request = next_node(&mut connection).await;
    assert_eq!(
        usync_user_jids(&request),
        ["5555@s.whatsapp.net"],
        "only the invalidated user is queried again"
    );
    connection
        .respond_iq(
            &request,
            vec![usync_devices_response(vec![(
                "5555@s.whatsapp.net",
                &["0"],
            )])],
        )
        .await;
    assert_eq!(
        jid_strings(&again.await.unwrap().unwrap()),
        ["6666@lid", "5555@s.whatsapp.net"],
        "cached users come first, like Go"
    );
}

#[tokio::test(start_paused = true)]
async fn is_on_whatsapp_parses_users_and_stores_lid_mappings() {
    let mut harness = harness(Some(OWN));
    let mut connection = connect_paired(&mut harness).await;
    let client = Arc::clone(&harness.client);
    let call = tokio::spawn(async move { client.is_on_whatsapp(&["+15551234567", "+1999"]).await });
    let request = next_node(&mut connection).await;
    let usync = request.get_child_by_tag(&["usync"]);
    assert_eq!(attr_string(usync, "context"), "interactive");
    let contact = request.get_child_by_tag(&["usync", "list", "user", "contact"]);
    // Sent as a string; the decoder hands strings back as bytes.
    assert_eq!(
        contact.content,
        Some(NodeContent::Bytes(b"+15551234567@c.us".to_vec()))
    );
    connection
        .respond_iq(
            &request,
            vec![node(
                "usync",
                &[],
                children(vec![node(
                    "list",
                    &[],
                    children(vec![
                        node(
                            "user",
                            &[
                                ("jid", jid("4242@lid")),
                                ("pn_jid", jid("15551234567@s.whatsapp.net")),
                            ],
                            children(vec![node(
                                "contact",
                                &[("type", text("in"))],
                                crate::client::test::bytes(b"+15551234567@c.us"),
                            )]),
                        ),
                        node(
                            "user",
                            &[("pn_jid", jid("1999@s.whatsapp.net"))],
                            children(vec![node(
                                "contact",
                                &[("type", text("out"))],
                                crate::client::test::bytes(b"+1999@c.us"),
                            )]),
                        ),
                        node("user", &[], None),
                    ]),
                )]),
            )],
        )
        .await;
    let responses = call.await.unwrap().unwrap();
    assert_eq!(responses.len(), 2);
    assert_eq!(responses[0].query, "+15551234567");
    assert!(responses[0].is_in);
    assert_eq!(responses[0].jid.to_string(), "4242@lid");
    assert_eq!(
        responses[0].phone_number.to_string(),
        "15551234567@s.whatsapp.net"
    );
    assert_eq!(responses[1].jid.to_string(), "1999@s.whatsapp.net");
    assert!(!responses[1].is_in);
    assert_eq!(
        harness
            .store
            .get_pn_for_lid(&parse("4242@lid"))
            .await
            .unwrap()
            .map(|pn| pn.to_string()),
        Some("15551234567@s.whatsapp.net".to_owned())
    );
}

#[tokio::test(start_paused = true)]
async fn user_info_and_profile_pictures() {
    let mut harness = harness(Some(OWN));
    let mut connection = connect_paired(&mut harness).await;
    let user = parse("5555@s.whatsapp.net");

    let client = Arc::clone(&harness.client);
    let lookup = user.clone();
    let call = tokio::spawn(async move { client.get_user_info(&[lookup]).await });
    let request = next_node(&mut connection).await;
    assert_eq!(
        attr_string(request.get_child_by_tag(&["usync"]), "mode"),
        "full"
    );
    connection
        .respond_iq(
            &request,
            vec![node(
                "usync",
                &[],
                children(vec![node(
                    "list",
                    &[],
                    children(vec![node(
                        "user",
                        &[("jid", jid("5555@s.whatsapp.net"))],
                        children(vec![
                            node("status", &[], crate::client::test::bytes(b"Busy")),
                            node("picture", &[("id", text("pic1"))], None),
                            node("lid", &[("val", jid("7777@lid"))], None),
                            node(
                                "devices",
                                &[],
                                children(vec![node(
                                    "device-list",
                                    &[],
                                    children(vec![node("device", &[("id", text("4"))], None)]),
                                )]),
                            ),
                        ]),
                    )]),
                )]),
            )],
        )
        .await;
    let info = call.await.unwrap().unwrap();
    let info = info.get(&user).unwrap();
    assert_eq!(info.status, "Busy");
    assert_eq!(info.picture_id, "pic1");
    assert_eq!(info.lid.to_string(), "7777@lid");
    assert_eq!(jid_strings(&info.devices), ["5555:4@s.whatsapp.net"]);
    assert_eq!(
        harness
            .store
            .get_lid_for_pn(&user)
            .await
            .unwrap()
            .map(|lid| lid.to_string()),
        Some("7777@lid".to_owned())
    );

    let client = Arc::clone(&harness.client);
    let lookup = user.clone();
    let call = tokio::spawn(async move {
        client
            .get_profile_picture_info(&lookup, &GetProfilePictureParams::default())
            .await
    });
    let request = next_node(&mut connection).await;
    assert!(is_iq(&request, "w:profile:picture"));
    assert_eq!(attr_string(&request, "target"), "5555@s.whatsapp.net");
    connection
        .respond_iq(
            &request,
            vec![node(
                "picture",
                &[
                    ("id", text("pic2")),
                    ("url", text("https://pps.example/pic")),
                    ("type", text("image")),
                    ("direct_path", text("/v/pic")),
                    ("hash", text("AQID")),
                ],
                None,
            )],
        )
        .await;
    let picture = call.await.unwrap().unwrap().unwrap();
    assert_eq!(picture.id, "pic2");
    assert_eq!(picture.url, "https://pps.example/pic");
    assert_eq!(picture.hash, [1, 2, 3]);

    let client = Arc::clone(&harness.client);
    let lookup = user.clone();
    let call = tokio::spawn(async move {
        client
            .get_profile_picture_info(&lookup, &GetProfilePictureParams::default())
            .await
    });
    let request = next_node(&mut connection).await;
    connection
        .respond_iq_error(&request, 404, "item-not-found")
        .await;
    let error = call.await.unwrap().unwrap_err();
    assert_eq!(
        error.to_string(),
        "that user or group does not have a profile picture"
    );
    assert!(error.is(&ClientError::ProfilePictureNotSet));

    let client = Arc::clone(&harness.client);
    let call = tokio::spawn(async move {
        client
            .get_profile_picture_info(
                &user,
                &GetProfilePictureParams {
                    existing_id: "pic2".to_owned(),
                    ..GetProfilePictureParams::default()
                },
            )
            .await
    });
    let request = next_node(&mut connection).await;
    connection
        .respond_iq(
            &request,
            vec![node("picture", &[("status", text("304"))], None)],
        )
        .await;
    assert_eq!(call.await.unwrap().unwrap(), None, "unchanged picture");
}

#[tokio::test(start_paused = true)]
async fn blocklists_are_fetched_and_updated() {
    let mut harness = harness(Some(OWN));
    let mut connection = connect_paired(&mut harness).await;

    let client = Arc::clone(&harness.client);
    let call = tokio::spawn(async move { client.get_blocklist("").await });
    let request = next_node(&mut connection).await;
    assert!(is_iq(&request, "blocklist"));
    connection
        .respond_iq(
            &request,
            vec![node(
                "list",
                &[("dhash", text("h1"))],
                children(vec![node(
                    "item",
                    &[
                        ("jid", jid("6666@lid")),
                        ("pn_jid", jid("5555@s.whatsapp.net")),
                        ("active", text("true")),
                    ],
                    None,
                )]),
            )],
        )
        .await;
    let blocklist = call.await.unwrap().unwrap().unwrap();
    assert!(blocklist.is_blocked(&parse("5555@s.whatsapp.net")));
    assert_eq!(jid_strings(&blocklist.lids()), ["6666@lid"]);

    // Blocking a phone number goes by the LID the store now knows.
    let client = Arc::clone(&harness.client);
    let call = tokio::spawn(async move {
        client
            .update_blocklist(
                &parse("5555@s.whatsapp.net"),
                BlocklistChangeAction::Block,
                "h1",
            )
            .await
    });
    let request = next_node(&mut connection).await;
    let item = request.get_child_by_tag(&["item"]);
    assert_eq!(attr_string(item, "jid"), "6666@lid");
    assert_eq!(attr_string(item, "pn_jid"), "5555@s.whatsapp.net");
    assert_eq!(attr_string(item, "action"), "block");
    connection
        .respond_iq(
            &request,
            vec![node("list", &[("matched", text("true"))], None)],
        )
        .await;
    assert_eq!(call.await.unwrap().unwrap(), None, "the hash matched");

    let nothing = tokio::time::timeout(Duration::from_secs(5), next_node(&mut connection)).await;
    assert!(nothing.is_err());
}
