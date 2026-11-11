// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! The client against the fake WhatsApp server in `testing`: pairing, login,
//! info queries, prekey upload and the connection lifecycle events.

use std::sync::Arc;
use std::time::Duration;

use hmac::{Hmac, Mac};
use prost::Message;
use sha2::Sha256;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::*;
use crate::binary::{AttributeValue, NodeContent};
use crate::proto::wa_adv::{
    AdvDeviceIdentity, AdvSignedDeviceIdentity, AdvSignedDeviceIdentityHmac,
};
use crate::qrchan::QrChannelItem;
use crate::signal::CurveSignatures;
use crate::store::{IdentityStore, MemoryStore};
use crate::testing::{
    FakeServer, FakeSignal, FakeSignatures, ServerConnection, attr_string, is_iq,
};
use crate::types::events::ConnectFailureReason;
use crate::types::{SERVER_JID, parse_jid};
use crate::util::keys::new_key_pair;

pub(crate) struct Harness {
    pub(crate) client: Arc<Client>,
    pub(crate) server: FakeServer,
    pub(crate) store: Arc<MemoryStore>,
    pub(crate) events: mpsc::UnboundedReceiver<Event>,
}

pub(crate) fn harness_with(
    paired_as: Option<(&str, &str)>,
    configure: impl FnOnce(&mut ClientConfig),
) -> Harness {
    let store = Arc::new(MemoryStore::default());
    let mut device = store.new_device(&FakeSignatures);
    if let Some((jid, lid)) = paired_as {
        device.id = Some(parse_jid(jid).unwrap());
        device.lid = parse_jid(lid).unwrap();
        device.push_name = "Tester".to_owned();
    }
    let server = FakeServer::new();
    let mut config = ClientConfig {
        dialer: server.dialer(),
        ..ClientConfig::default()
    };
    configure(&mut config);
    let client = Client::new(device, Arc::new(FakeSignal), config);
    let events = client.subscribe();
    Harness {
        client,
        server,
        store,
        events,
    }
}

pub(crate) fn harness(paired_as: Option<(&str, &str)>) -> Harness {
    harness_with(paired_as, |_| {})
}

pub(crate) fn node(
    tag: &str,
    attrs: &[(&str, AttributeValue)],
    content: Option<NodeContent>,
) -> Node {
    Node {
        tag: tag.to_owned(),
        attrs: attrs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), value.clone()))
            .collect(),
        content,
    }
}

pub(crate) fn children(nodes: Vec<Node>) -> Option<NodeContent> {
    Some(NodeContent::Nodes(nodes))
}

pub(crate) fn bytes(data: &[u8]) -> Option<NodeContent> {
    Some(NodeContent::Bytes(data.to_vec()))
}

pub(crate) fn jid(value: &str) -> AttributeValue {
    AttributeValue::Jid(parse_jid(value).unwrap())
}

pub(crate) fn text(value: &str) -> AttributeValue {
    AttributeValue::String(value.to_owned())
}

/// Skips keepalive pings and telemetry the tests don't care about.
pub(crate) fn is_noise(node: &Node) -> bool {
    is_iq(node, "w:p") || node.tag == "ib"
}

pub(crate) async fn next_node(connection: &mut ServerConnection) -> Node {
    connection
        .recv_node_skipping(is_noise)
        .await
        .expect("client sent a node")
}

pub(crate) async fn next_event(events: &mut mpsc::UnboundedReceiver<Event>) -> Event {
    tokio::time::timeout(Duration::from_secs(120), events.recv())
        .await
        .expect("an event arrives")
        .expect("the event channel is open")
}

/// Runs `call` against the fake server and returns the node it sends,
/// normalized like the Go vectors (`captureNode`): the iq `id` is `ID` and a
/// usync `sid` is `SID`. An iq gets a 500 error so the call returns.
pub(crate) async fn capture_request<Call>(connection: &mut ServerConnection, call: Call) -> Node
where
    Call: Future + Send + 'static,
    Call::Output: Send + 'static,
{
    let task = tokio::spawn(call);
    let mut request = next_node(connection).await;
    if request.tag == "iq" {
        connection
            .respond_iq_error(&request, 500, "internal-server-error")
            .await;
        request.attrs.insert("id".to_owned(), text("ID"));
        if let Some(NodeContent::Nodes(children)) = &mut request.content
            && children.len() == 1
            && children[0].tag == "usync"
        {
            children[0].attrs.insert("sid".to_owned(), text("SID"));
        }
    }
    let _ = task.await;
    request
}

/// Answers the post-login requests (prekey count, upload, passive) until the
/// client reports `Connected`.
pub(crate) async fn complete_login(
    connection: &mut ServerConnection,
    events: &mut mpsc::UnboundedReceiver<Event>,
    server_pre_key_count: usize,
) -> Vec<Node> {
    connection
        .send_node(&node(
            "success",
            &[("t", text("1700000000")), ("lid", jid("9876:5@lid"))],
            None,
        ))
        .await;
    let mut requests = Vec::new();
    let mut uploaded = false;
    loop {
        tokio::select! {
            event = next_event(events) => {
                if matches!(event, Event::Connected(_)) {
                    return requests;
                }
            }
            request = next_node(connection) => {
                if is_iq(&request, "encrypt") && attr_string(&request, "type") == "get" {
                    let count = if uploaded { 812 } else { server_pre_key_count };
                    connection
                        .respond_iq(&request, vec![node("count", &[("value", text(&count.to_string()))], None)])
                        .await;
                } else if is_iq(&request, "encrypt") {
                    uploaded = true;
                    connection.respond_iq(&request, vec![]).await;
                } else if request.tag == "iq" {
                    connection.respond_iq(&request, vec![]).await;
                }
                requests.push(request);
            }
        }
    }
}

/// Logs a paired device in and returns the server side of the connection.
pub(crate) async fn connect_paired(harness: &mut Harness) -> ServerConnection {
    harness.client.connect().await.unwrap();
    let mut connection = harness.server.accept().await.unwrap();
    complete_login(&mut connection, &mut harness.events, 50).await;
    connection
}

struct PrimaryDevice {
    account_key: crate::util::keys::KeyPair,
}

impl PrimaryDevice {
    fn pair_success(&self, device: &Device, request_id: &str) -> Node {
        let details = AdvDeviceIdentity {
            raw_id: Some(77),
            timestamp: Some(1_700_000_000),
            key_index: Some(3),
            ..Default::default()
        }
        .encode_to_vec();
        let message = [
            &crate::pair::ADV_ACCOUNT_SIGNATURE_PREFIX[..],
            &details,
            &device.identity_key.public,
        ]
        .concat();
        let signed = AdvSignedDeviceIdentity {
            details: Some(details),
            account_signature_key: Some(self.account_key.public.to_vec()),
            account_signature: Some(
                FakeSignatures
                    .calculate_signature(&self.account_key.private, &message)
                    .to_vec(),
            ),
            device_signature: None,
        }
        .encode_to_vec();
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&device.adv_secret_key).unwrap();
        mac.update(&signed);
        let container = AdvSignedDeviceIdentityHmac {
            details: Some(signed),
            hmac: Some(mac.finalize().into_bytes().to_vec()),
            account_type: None,
        }
        .encode_to_vec();
        node(
            "iq",
            &[
                ("from", AttributeValue::Jid(SERVER_JID.clone())),
                ("id", text(request_id)),
                ("type", text("set")),
                ("xmlns", text("md")),
                ("t", text("1700000000")),
            ],
            children(vec![node(
                "pair-success",
                &[],
                children(vec![
                    node("device-identity", &[], bytes(&container)),
                    node(
                        "device",
                        &[
                            ("jid", jid("1234:5@s.whatsapp.net")),
                            ("lid", jid("9876:5@lid")),
                        ],
                        None,
                    ),
                    node("platform", &[("name", text("android"))], None),
                    node("biz", &[("name", text("Shop"))], None),
                ]),
            )]),
        )
    }
}

#[tokio::test(start_paused = true)]
async fn pairing_with_qr_codes_then_logging_in() {
    let mut harness = harness(None);
    let mut qr = harness
        .client
        .get_qr_channel(CancellationToken::new())
        .await
        .unwrap();
    harness.client.connect().await.unwrap();

    let mut connection = harness.server.accept().await.unwrap();
    assert!(connection.client_payload.device_pairing_data.is_some());
    assert_eq!(connection.client_payload.username, None);

    connection
        .send_node(&node(
            "iq",
            &[
                ("from", AttributeValue::Jid(SERVER_JID.clone())),
                ("id", text("pair-1")),
                ("type", text("set")),
                ("xmlns", text("md")),
            ],
            children(vec![node(
                "pair-device",
                &[],
                children(vec![
                    node("ref", &[], bytes(b"2@first")),
                    node("ref", &[], bytes(b"2@second")),
                ]),
            )]),
        ))
        .await;
    let ack = next_node(&mut connection).await;
    assert_eq!(ack.tag, "iq");
    assert_eq!(attr_string(&ack, "id"), "pair-1");
    assert_eq!(attr_string(&ack, "type"), "result");

    let Some(QrChannelItem::Code { code, timeout }) = qr.recv().await else {
        panic!("expected a QR code");
    };
    let (noise_public, identity_public, adv_secret) = {
        let store = harness.client.store.read().await;
        (
            store.noise_key.public,
            store.identity_key.public,
            store.adv_secret_key.clone(),
        )
    };
    use base64::Engine;
    let base64 = base64::engine::general_purpose::STANDARD;
    assert_eq!(
        code,
        format!(
            "https://wa.me/settings/linked_devices#2@first,{},{},{},9",
            base64.encode(noise_public),
            base64.encode(identity_public),
            base64.encode(&adv_secret),
        )
    );
    assert_eq!(timeout, Duration::from_secs(20));
    let Some(QrChannelItem::Code { code, .. }) = qr.recv().await else {
        panic!("expected the second QR code after the first expired");
    };
    assert!(code.starts_with("https://wa.me/settings/linked_devices#2@second,"));

    let primary = PrimaryDevice {
        account_key: new_key_pair(),
    };
    let pair_success = {
        let store = harness.client.store.read().await;
        primary.pair_success(&store, "pair-2")
    };
    connection.send_node(&pair_success).await;

    let confirmation = next_node(&mut connection).await;
    assert_eq!(attr_string(&confirmation, "type"), "result");
    assert_eq!(attr_string(&confirmation, "id"), "pair-2");
    let device_identity = confirmation.get_child_by_tag(&["pair-device-sign", "device-identity"]);
    assert_eq!(attr_string(device_identity, "key-index"), "3");
    let Some(NodeContent::Bytes(signed)) = &device_identity.content else {
        panic!("device identity has bytes");
    };
    let signed = AdvSignedDeviceIdentity::decode(signed.as_slice()).unwrap();
    assert_eq!(signed.account_signature_key, None);
    let message = [
        &crate::pair::ADV_DEVICE_SIGNATURE_PREFIX[..],
        signed.details.as_deref().unwrap(),
        &identity_public,
        &primary.account_key.public,
    ]
    .concat();
    let identity_private = harness.client.store.read().await.identity_key.private;
    assert_eq!(
        signed.device_signature.as_deref(),
        Some(&FakeSignatures.calculate_signature(&identity_private, &message)[..])
    );

    loop {
        match next_event(&mut harness.events).await {
            Event::PairSuccess(success) => {
                assert_eq!(success.id.to_string(), "1234:5@s.whatsapp.net");
                assert_eq!(success.lid.to_string(), "9876:5@lid");
                assert_eq!(success.platform, "android");
                assert_eq!(success.business_name, "Shop");
                break;
            }
            Event::Qr(_) => {}
            other => panic!("unexpected event {other:?}"),
        }
    }
    assert!(matches!(qr.recv().await, Some(QrChannelItem::Success)));
    assert!(qr.recv().await.is_none());
    assert_eq!(
        harness.store.saved_devices(),
        vec![parse_jid("1234:5@s.whatsapp.net").unwrap()]
    );
    assert!(
        !harness
            .store
            .is_trusted_identity("9876_1:0", [1; 32])
            .await
            .unwrap(),
        "the primary device's identity is stored under its LID address"
    );
    assert!(
        harness
            .store
            .is_trusted_identity("9876_1:0", primary.account_key.public)
            .await
            .unwrap()
    );

    // The server restarts the stream after pairing; the client logs in.
    connection
        .send_node(&node("stream:error", &[("code", text("515"))], None))
        .await;
    let mut connection = harness.server.accept().await.unwrap();
    assert_eq!(connection.client_payload.username, Some(1234));
    assert_eq!(connection.client_payload.device, Some(5));
    let requests = complete_login(&mut connection, &mut harness.events, 0).await;
    let upload = requests
        .iter()
        .find(|request| is_iq(request, "encrypt") && attr_string(request, "type") == "set")
        .expect("the client uploads prekeys");
    let list = upload.get_child_by_tag(&["list"]);
    assert_eq!(
        list.get_children().len(),
        812,
        "the first upload after pairing"
    );
    assert!(harness.client.is_logged_in());
    assert!(requests.iter().any(|request| is_iq(request, "passive")
        && request.get_optional_child_by_tag(&["active"]).is_some()));
}

#[tokio::test(start_paused = true)]
async fn pair_success_with_a_bad_hmac_is_rejected() {
    let mut harness = harness(None);
    harness.client.connect().await.unwrap();
    let mut connection = harness.server.accept().await.unwrap();
    let mut pair_success = {
        let store = harness.client.store.read().await;
        PrimaryDevice {
            account_key: new_key_pair(),
        }
        .pair_success(&store, "pair-3")
    };
    let identity = pair_success
        .get_child_by_tag(&["pair-success", "device-identity"])
        .clone();
    let Some(NodeContent::Bytes(container)) = identity.content else {
        panic!("container bytes");
    };
    let mut container = AdvSignedDeviceIdentityHmac::decode(container.as_slice()).unwrap();
    container.hmac = Some(vec![0; 32]);
    if let Some(NodeContent::Nodes(children)) = &mut pair_success.content
        && let Some(NodeContent::Nodes(inner)) = &mut children[0].content
    {
        inner[0].content = bytes(&container.encode_to_vec());
    }
    connection.send_node(&pair_success).await;

    let error = next_node(&mut connection).await;
    assert_eq!(attr_string(&error, "type"), "error");
    let error_child = error.get_child_by_tag(&["error"]);
    assert_eq!(attr_string(error_child, "code"), "401");
    assert_eq!(attr_string(error_child, "text"), "hmac-mismatch");
    loop {
        if let Event::PairError(pair_error) = next_event(&mut harness.events).await {
            assert!(matches!(
                *pair_error.error,
                ClientError::PairInvalidDeviceIdentityHmac
            ));
            break;
        }
    }
    assert!(harness.client.store.read().await.id.is_none());
}

#[tokio::test(start_paused = true)]
async fn info_queries_return_results_and_errors() {
    let mut harness = harness(Some(("1234:5@s.whatsapp.net", "9876:5@lid")));
    let mut connection = connect_paired(&mut harness).await;

    let client = Arc::clone(&harness.client);
    let passive = tokio::spawn(async move { client.set_passive(true).await });
    let request = next_node(&mut connection).await;
    assert!(is_iq(&request, "passive"));
    assert_eq!(attr_string(&request, "type"), "set");
    assert!(request.get_optional_child_by_tag(&["passive"]).is_some());
    connection
        .respond_iq_error(&request, 500, "internal-server-error")
        .await;
    let error = passive.await.unwrap().unwrap_err();
    assert_eq!(
        error.to_string(),
        "info query returned status 500: internal-server-error"
    );
    assert!(error.is(&ClientError::iq_status(
        crate::errors::IqError::INTERNAL_SERVER_ERROR
    )));

    let client = Arc::clone(&harness.client);
    let passive = tokio::spawn(async move { client.set_passive(false).await });
    let request = next_node(&mut connection).await;
    connection.respond_iq(&request, vec![]).await;
    passive.await.unwrap().unwrap();

    let client = Arc::clone(&harness.client);
    let timed_out = tokio::spawn(async move { client.set_passive(false).await });
    let _ignored = next_node(&mut connection).await;
    assert!(matches!(
        timed_out.await.unwrap(),
        Err(ClientError::IqTimedOut)
    ));
}

#[tokio::test(start_paused = true)]
async fn a_server_disconnect_interrupts_queries_and_reconnects() {
    let mut harness = harness(Some(("1234:5@s.whatsapp.net", "9876:5@lid")));
    let mut connection = connect_paired(&mut harness).await;

    let client = Arc::clone(&harness.client);
    let passive = tokio::spawn(async move { client.set_passive(true).await });
    let first = next_node(&mut connection).await;
    connection.close().await;
    assert!(matches!(
        next_event(&mut harness.events).await,
        Event::Disconnected(_)
    ));

    // Auto-reconnect logs in again and the query is retried on the new socket.
    let mut connection = harness.server.accept().await.unwrap();
    connection
        .send_node(&node("success", &[("t", text("1700000000"))], None))
        .await;
    loop {
        let request = next_node(&mut connection).await;
        if attr_string(&request, "id") == attr_string(&first, "id") {
            connection.respond_iq(&request, vec![]).await;
            break;
        }
        connection
            .respond_iq(
                &request,
                vec![node("count", &[("value", text("50"))], None)],
            )
            .await;
    }
    passive.await.unwrap().unwrap();
}

#[tokio::test(start_paused = true)]
async fn a_logged_out_connect_failure_deletes_the_device() {
    let mut harness = harness(Some(("1234:5@s.whatsapp.net", "9876:5@lid")));
    harness.client.connect().await.unwrap();
    let mut connection = harness.server.accept().await.unwrap();
    connection
        .send_node(&node("failure", &[("reason", text("401"))], None))
        .await;
    loop {
        if let Event::LoggedOut(logged_out) = next_event(&mut harness.events).await {
            assert!(logged_out.on_connect);
            assert_eq!(logged_out.reason, ConnectFailureReason::LOGGED_OUT);
            break;
        }
    }
    let store = harness.client.store.read().await;
    assert!(store.deleted);
    assert!(store.id.is_none());
}

#[tokio::test(start_paused = true)]
async fn qr_codes_run_out_into_a_timeout() {
    let mut harness = harness(None);
    let mut qr = harness
        .client
        .get_qr_channel(CancellationToken::new())
        .await
        .unwrap();
    harness.client.connect().await.unwrap();
    let mut connection = harness.server.accept().await.unwrap();
    connection
        .send_node(&node(
            "iq",
            &[
                ("from", AttributeValue::Jid(SERVER_JID.clone())),
                ("id", text("pair-1")),
                ("type", text("set")),
            ],
            children(vec![node(
                "pair-device",
                &[],
                children(vec![node("ref", &[], bytes(b"2@only"))]),
            )]),
        ))
        .await;
    assert!(matches!(qr.recv().await, Some(QrChannelItem::Code { .. })));
    assert!(matches!(qr.recv().await, Some(QrChannelItem::Timeout)));
    assert!(qr.recv().await.is_none());
    assert!(!harness.client.is_connected().await);
}

#[tokio::test(start_paused = true)]
async fn stream_replaced_stops_reconnecting() {
    let mut harness = harness(Some(("1234:5@s.whatsapp.net", "9876:5@lid")));
    let connection = connect_paired(&mut harness).await;
    let mut connection = connection;
    connection
        .send_node(&node(
            "stream:error",
            &[],
            children(vec![node("conflict", &[("type", text("replaced"))], None)]),
        ))
        .await;
    loop {
        if let Event::StreamReplaced(_) = next_event(&mut harness.events).await {
            break;
        }
    }
    connection.close().await;
    let more = tokio::time::timeout(Duration::from_secs(60), harness.events.recv()).await;
    assert!(
        !matches!(more, Ok(Some(Event::Disconnected(_)))),
        "a replaced stream is an expected disconnect"
    );
    assert!(
        tokio::time::timeout(Duration::from_secs(60), harness.server.accept())
            .await
            .is_err(),
        "the client doesn't reconnect"
    );
}

#[tokio::test(start_paused = true)]
async fn the_media_connection_is_queried_once_and_cached() {
    let mut harness = harness(Some(("1234:5@s.whatsapp.net", "9876:5@lid")));
    let mut connection = connect_paired(&mut harness).await;
    let client = Arc::clone(&harness.client);
    let first = tokio::spawn(async move { client.refresh_media_conn(false).await });
    let request = next_node(&mut connection).await;
    assert!(is_iq(&request, "w:m"));
    assert_eq!(attr_string(&request, "type"), "set");
    connection
        .respond_iq(
            &request,
            vec![node(
                "media_conn",
                &[
                    ("auth", text("token")),
                    ("ttl", text("300")),
                    ("auth_ttl", text("60")),
                    ("max_buckets", text("12")),
                ],
                children(vec![node(
                    "host",
                    &[("hostname", text("mmg.example"))],
                    None,
                )]),
            )],
        )
        .await;
    let media_conn = first.await.unwrap().unwrap();
    assert_eq!(media_conn.auth, "token");
    assert_eq!(media_conn.hosts[0].hostname, "mmg.example");
    let cached = harness.client.refresh_media_conn(false).await.unwrap();
    assert_eq!(cached, media_conn);
}

#[tokio::test(start_paused = true)]
async fn deleting_the_device_resets_the_app_state_processor() {
    let harness = harness(Some(("1234:5@s.whatsapp.net", "9876:5@lid")));
    let before = harness.client.app_state_processor();
    harness.client.delete_device().await.unwrap();
    let after = harness.client.app_state_processor();
    assert!(!Arc::ptr_eq(&before, &after));
    assert!(matches!(
        after.app_state.get_app_state_version("regular").await,
        Err(crate::store::StoreError::DeviceDeleted)
    ));
}

/// The queue loop must handle a `stream:error` it dequeues after the
/// connection ended (Go drops it). `tokio::select!` picks either arm when
/// both are ready, so run it many times: the dropping path would be taken
/// about half of the time.
#[tokio::test(start_paused = true)]
async fn a_stream_error_dequeued_after_the_connection_ended_is_handled() {
    let mut harness = harness_with(Some(("1234:5@s.whatsapp.net", "9876:5@lid")), |config| {
        config.disable_login_auto_reconnect = true;
    });
    for _ in 0..64 {
        let (queue_sender, queue_receiver) = mpsc::channel(4);
        queue_sender
            .send(node("stream:error", &[("code", text("515"))], None))
            .await
            .unwrap();
        let connection = CancellationToken::new();
        connection.cancel();
        let (close_wait, closed) = tokio::sync::oneshot::channel();
        Arc::clone(&harness.client)
            .handler_queue_loop(connection, queue_receiver, close_wait)
            .await;
        closed.await.unwrap();
        loop {
            if let Event::ManualLoginReconnect(_) = next_event(&mut harness.events).await {
                break;
            }
        }
    }
}

#[tokio::test(start_paused = true)]
async fn a_515_followed_by_a_close_still_reconnects_after_pairing() {
    let mut harness = harness(Some(("1234:5@s.whatsapp.net", "9876:5@lid")));
    let connection = connect_paired(&mut harness).await;
    // Pairing expects a disconnect, so only the 515 can trigger the login.
    harness.client.expect_disconnect();
    connection
        .send_node_and_close(&node("stream:error", &[("code", text("515"))], None))
        .await;
    let mut connection = tokio::time::timeout(Duration::from_secs(60), harness.server.accept())
        .await
        .expect("the client reconnects after the 515")
        .unwrap();
    complete_login(&mut connection, &mut harness.events, 50).await;
    assert!(harness.client.is_logged_in());
}
