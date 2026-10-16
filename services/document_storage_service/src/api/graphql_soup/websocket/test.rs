use super::*;
use async_graphql::{Context, EmptyMutation, Json, Object, Schema, Subscription};
use axum::{Router, routing::get};
use flate2::{Compress, Compression, Decompress, FlushCompress, FlushDecompress};
use futures::Stream;
use serde_json::{Value, json};
use std::{net::SocketAddr, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    task::JoinHandle,
    time::timeout,
};
use tungstenite_signal::client::IntoClientRequest;

const MAX_TEST_MESSAGE_BYTES: usize = 256 * 1024;

struct Query;

#[Object]
impl Query {
    async fn ready(&self) -> bool {
        true
    }
}

struct Subscriptions;

#[Subscription]
impl Subscriptions {
    async fn viewer(&self, context: &Context<'_>) -> impl Stream<Item = String> {
        let viewer = context.data_unchecked::<String>().clone();
        futures::stream::iter([viewer.clone(), viewer])
    }

    async fn snapshots(&self, context: &Context<'_>) -> impl Stream<Item = Json<Value>> {
        futures::stream::iter(
            context
                .data_unchecked::<Vec<Value>>()
                .clone()
                .into_iter()
                .map(Json),
        )
    }
}

struct TestServer {
    address: SocketAddr,
    task: JoinHandle<()>,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn start_server() -> TestServer {
    start_server_with_payloads(Vec::new()).await
}

async fn start_server_with_payloads(payloads: Vec<Value>) -> TestServer {
    let app = Router::new().route(
        "/soup/graphql/ws",
        get(
            move |headers: HeaderMap, upgrade: GraphqlWebSocketUpgrade| {
                let payloads = payloads.clone();
                async move {
                    // Mirror the production handler's requirement: extraction must not
                    // upgrade the connection until the handler supplies authorized data.
                    if headers.get(header::AUTHORIZATION).is_none() {
                        return StatusCode::UNAUTHORIZED.into_response();
                    }
                    let schema = Schema::build(Query, EmptyMutation, Subscriptions).finish();
                    let mut data = Data::default();
                    data.insert(String::from("authorized-viewer"));
                    data.insert(payloads);
                    upgrade.serve(schema, data)
                }
            },
        ),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    TestServer { address, task }
}

async fn handshake(
    address: SocketAddr,
    protocol: &str,
    extensions: Option<&str>,
    authorized: bool,
) -> (TcpStream, String) {
    let mut socket = TcpStream::connect(address).await.unwrap();
    let mut request = format!(
        include_str!("handshake.txt"),
        address = address,
        protocol = protocol
    )
    .replace('\n', "\r\n");
    if authorized {
        request.push_str("Authorization: test\r\n");
    }
    if let Some(extensions) = extensions {
        request.push_str(&format!("Sec-WebSocket-Extensions: {extensions}\r\n"));
    }
    request.push_str("\r\n");
    socket.write_all(request.as_bytes()).await.unwrap();
    let mut response = Vec::new();
    while !response.ends_with(b"\r\n\r\n") {
        response.push(socket.read_u8().await.unwrap());
        assert!(response.len() < 8192);
    }
    (
        socket,
        String::from_utf8(response).unwrap().to_ascii_lowercase(),
    )
}

// Use independent flate2 framing rather than the Signal client: assert RSV1
// and actual raw DEFLATE payloads on the wire, not just handshake advertising.
async fn send_json(socket: &mut (impl AsyncWrite + Unpin), message: Value, compressed: bool) {
    let payload = serde_json::to_vec(&message).unwrap();
    let payload = if compressed {
        let mut output = Vec::with_capacity(payload.len() + 128);
        Compress::new(Compression::fast(), false)
            .compress_vec(&payload, &mut output, FlushCompress::Sync)
            .unwrap();
        assert!(output.ends_with(&[0, 0, 255, 255]));
        output.truncate(output.len() - 4);
        output
    } else {
        payload
    };
    socket
        .write_u8(if compressed { 0xc1 } else { 0x81 })
        .await
        .unwrap();
    if payload.len() < 126 {
        socket.write_u8(0x80 | payload.len() as u8).await.unwrap();
    } else {
        socket.write_u8(0x80 | 126).await.unwrap();
        socket
            .write_u16(payload.len().try_into().unwrap())
            .await
            .unwrap();
    }
    let mask = [1, 2, 3, 4];
    socket.write_all(&mask).await.unwrap();
    let masked: Vec<_> = payload
        .iter()
        .enumerate()
        .map(|(index, byte)| byte ^ mask[index % 4])
        .collect();
    socket.write_all(&masked).await.unwrap();
}

struct MeasuredMessage {
    json: Value,
    payload_bytes: usize,
    frame_bytes: usize,
    decoded_bytes: usize,
}

async fn read_json(socket: &mut TcpStream, compressed: bool) -> Value {
    read_measured_message(socket, compressed).await.json
}

async fn read_measured_message(socket: &mut TcpStream, compressed: bool) -> MeasuredMessage {
    timeout(Duration::from_secs(5), async {
        let header = socket.read_u8().await.unwrap();
        assert_eq!(header, if compressed { 0xc1 } else { 0x81 });
        let length = socket.read_u8().await.unwrap();
        assert_eq!(length & 0x80, 0, "server frames must not be masked");
        let (length, header_bytes) = match length {
            126 => (usize::from(socket.read_u16().await.unwrap()), 4),
            127 => (socket.read_u64().await.unwrap().try_into().unwrap(), 10),
            length => (usize::from(length), 2),
        };
        assert!(length < MAX_TEST_MESSAGE_BYTES);
        let mut payload = vec![0; length];
        socket.read_exact(&mut payload).await.unwrap();
        if compressed {
            payload.extend_from_slice(&[0, 0, 255, 255]);
            let mut output = Vec::with_capacity(MAX_TEST_MESSAGE_BYTES);
            let mut decoder = Decompress::new(false);
            decoder
                .decompress_vec(&payload, &mut output, FlushDecompress::Sync)
                .unwrap();
            assert_eq!(decoder.total_in(), payload.len() as u64);
            payload = output;
        }
        MeasuredMessage {
            json: serde_json::from_slice(&payload).unwrap(),
            payload_bytes: length,
            frame_bytes: header_bytes + length,
            decoded_bytes: payload.len(),
        }
    })
    .await
    .expect("GraphQL response timed out")
}

async fn subscription_roundtrip(protocol: &str, offer: Option<&str>, compressed: bool) {
    let server = start_server().await;
    let (mut socket, response) = handshake(server.address, protocol, offer, true).await;
    assert!(response.starts_with("http/1.1 101"), "{response}");
    assert!(response.contains(&format!("sec-websocket-protocol: {protocol}\r\n")));
    assert_eq!(response.contains("sec-websocket-extensions:"), compressed);
    if compressed {
        assert!(response.contains("server_no_context_takeover"));
        assert!(response.contains("client_no_context_takeover"));
    }
    send_json(&mut socket, json!({"type": "connection_init"}), compressed).await;
    assert_eq!(
        read_json(&mut socket, compressed).await["type"],
        "connection_ack"
    );

    let modern = protocol == "graphql-transport-ws";
    send_json(
        &mut socket,
        json!({
            "id": "1",
            "type": if modern { "subscribe" } else { "start" },
            "payload": {"query": "subscription { viewer }"}
        }),
        compressed,
    )
    .await;
    // Both messages must decode with a fresh dictionary (no context takeover).
    for _ in 0..2 {
        let message = read_json(&mut socket, compressed).await;
        assert_eq!(message["id"], "1");
        assert_eq!(message["type"], if modern { "next" } else { "data" });
        assert_eq!(message["payload"]["data"]["viewer"], "authorized-viewer");
    }
    assert_eq!(read_json(&mut socket, compressed).await["type"], "complete");
    if modern {
        // Application-level ping/pong remains handled by async-graphql.
        send_json(&mut socket, json!({"type": "ping"}), compressed).await;
        assert_eq!(read_json(&mut socket, compressed).await["type"], "pong");
    }
}

fn measurement_snapshot(entity_count: usize) -> Value {
    let template: Value = serde_json::from_str(include_str!("measurement-entity.json")).unwrap();
    let entities: Vec<_> = (0..entity_count)
        .map(|index| {
            let mut entity = template.clone();
            entity["id"] = json!(format!("018c8d80-0000-7000-8000-{index:012x}"));
            entity["name"] = json!(format!("Planning document {index}"));
            entity["isUnread"] = json!(index % 3 == 0);
            entity
        })
        .collect();
    json!({"entities": entities, "totalCount": entity_count, "hasNextPage": false})
}

async fn measure_snapshot_connection(
    address: SocketAddr,
    compressed: bool,
    snapshot_count: usize,
) -> Vec<MeasuredMessage> {
    let offer = compressed.then_some("permessage-deflate; client_max_window_bits");
    let (mut socket, response) = handshake(address, "graphql-transport-ws", offer, true).await;
    assert!(response.starts_with("http/1.1 101"));
    assert_eq!(response.contains("sec-websocket-extensions:"), compressed);
    // Keep client requests identical. A negotiated connection can receive
    // uncompressed messages; only the server-to-client bytes are measured here.
    send_json(&mut socket, json!({"type": "connection_init"}), false).await;
    let mut messages = vec![read_measured_message(&mut socket, compressed).await];
    assert_eq!(messages[0].json["type"], "connection_ack");
    send_json(
        &mut socket,
        json!({
            "id": "measure",
            "type": "subscribe",
            "payload": {"query": "subscription { snapshots }"}
        }),
        false,
    )
    .await;
    for _ in 0..snapshot_count {
        let message = read_measured_message(&mut socket, compressed).await;
        assert_eq!(message.json["type"], "next");
        assert!(message.json["payload"].get("errors").is_none());
        messages.push(message);
    }
    let complete = read_measured_message(&mut socket, compressed).await;
    assert_eq!(complete.json["type"], "complete");
    messages.push(complete);
    messages
}

/// A local TCP measurement of this production upgrade adapter, not an estimate
/// from recompressing serialized JSON. The data is explicitly synthetic; it is
/// not a claim about production traffic. Run with `--nocapture` for the CSV.
#[tokio::test]
async fn measure_subscription_payload_sizes() {
    let sizes = [1, 25, 100];
    let server = start_server_with_payloads(sizes.map(measurement_snapshot).to_vec()).await;
    let plain = measure_snapshot_connection(server.address, false, sizes.len()).await;
    let deflate = measure_snapshot_connection(server.address, true, sizes.len()).await;
    let labels = [
        "connection_ack",
        "snapshot_1_entity",
        "snapshot_25_entities",
        "snapshot_100_entities",
        "complete",
    ];
    println!(
        "case,plain_payload_bytes,deflate_payload_bytes,plain_frame_bytes,deflate_frame_bytes,payload_saved_percent"
    );
    for ((label, plain), deflate) in labels.iter().zip(&plain).zip(&deflate) {
        assert_eq!(plain.json, deflate.json);
        assert_eq!(plain.decoded_bytes, deflate.decoded_bytes);
        assert_eq!(plain.payload_bytes, plain.decoded_bytes);
        let saved = 100.0 * (1.0 - deflate.payload_bytes as f64 / plain.payload_bytes as f64);
        println!(
            "{label},{},{},{},{},{saved:.2}",
            plain.payload_bytes, deflate.payload_bytes, plain.frame_bytes, deflate.frame_bytes
        );
    }
    for (plain, deflate) in plain[1..=sizes.len()].iter().zip(&deflate[1..=sizes.len()]) {
        assert!(deflate.payload_bytes < plain.payload_bytes);
    }
    // Tiny GraphQL control messages can grow under deflate; do not assert savings for
    // connection_ack/complete or hide their cost in the larger snapshots.
}

#[tokio::test]
async fn browser_compression_roundtrip_for_both_graphql_protocols() {
    for protocol in ["graphql-transport-ws", "graphql-ws"] {
        subscription_roundtrip(
            protocol,
            Some("permessage-deflate; client_max_window_bits"),
            true,
        )
        .await;
    }
}

#[tokio::test]
async fn uncompressed_clients_and_unsupported_offers_still_work() {
    for protocol in ["graphql-transport-ws", "graphql-ws"] {
        for offer in [None, Some("permessage-deflate; unknown=1")] {
            subscription_roundtrip(protocol, offer, false).await;
        }
    }
}

#[tokio::test]
async fn compressed_connections_can_receive_uncompressed_messages() {
    let server = start_server().await;
    let (mut socket, response) = handshake(
        server.address,
        "graphql-transport-ws",
        Some("permessage-deflate"),
        true,
    )
    .await;
    assert!(response.contains("sec-websocket-extensions:"));
    send_json(&mut socket, json!({"type": "connection_init"}), false).await;
    assert_eq!(read_json(&mut socket, true).await["type"], "connection_ack");
}

#[tokio::test]
async fn receive_limits_match_previous_axum_limits_for_every_negotiation_outcome() {
    for offer in [
        None,
        Some("permessage-deflate"),
        Some("permessage-deflate; unknown=1"),
    ] {
        let mut request = "ws://localhost/soup/graphql/ws"
            .into_client_request()
            .unwrap();
        request.headers_mut().insert(
            header::SEC_WEBSOCKET_PROTOCOL,
            HeaderValue::from_static("graphql-transport-ws"),
        );
        if let Some(offer) = offer {
            request.headers_mut().insert(
                header::SEC_WEBSOCKET_EXTENSIONS,
                HeaderValue::from_static(offer),
            );
        }
        // Extraction needs a Hyper upgrade handle, but this test never awaits it.
        let on_upgrade = hyper::upgrade::on(&mut request);
        request.extensions_mut().insert(on_upgrade);
        let (mut parts, ()) = request.into_parts();
        let upgrade = GraphqlWebSocketUpgrade::from_request_parts(&mut parts, &())
            .await
            .unwrap();

        assert_eq!(upgrade.config.max_message_size, Some(64 << 20));
        assert_eq!(upgrade.config.max_frame_size, Some(16 << 20));
        assert_eq!(
            upgrade.config.extensions.permessage_deflate.is_some(),
            offer == Some("permessage-deflate")
        );
    }
}

#[tokio::test]
async fn decompressed_messages_still_obey_size_limits() {
    let (mut client, server) = tokio::io::duplex(4096);
    let mut config = WebSocketConfig::default()
        .max_message_size(Some(64))
        .max_frame_size(Some(128));
    config.extensions.permessage_deflate = Some(DeflateConfig::default());
    let mut server = WebSocketStream::from_raw_socket(server, Role::Server, Some(config)).await;
    // The compressed frame fits, but its decoded contents exceed the limit.
    send_json(&mut client, json!({"payload": "x".repeat(1024)}), true).await;
    let result = timeout(Duration::from_secs(5), server.next())
        .await
        .unwrap();
    assert!(matches!(
        result,
        Some(Err(tungstenite_signal::Error::Capacity(
            tungstenite_signal::error::CapacityError::MessageTooLong { .. }
        )))
    ));
}

#[tokio::test]
async fn rejected_authorization_never_upgrades() {
    let server = start_server().await;
    let (_, response) = handshake(
        server.address,
        "graphql-transport-ws",
        Some("permessage-deflate"),
        false,
    )
    .await;
    assert!(response.starts_with("http/1.1 401"));
    assert!(!response.contains("sec-websocket-extensions:"));
}

#[tokio::test]
async fn unsupported_graphql_protocol_is_rejected() {
    let server = start_server().await;
    let (_, response) = handshake(server.address, "unsupported", None, true).await;
    assert!(response.starts_with("http/1.1 400"));
}

#[test]
fn negotiates_supported_window_sizes_and_context_limits() {
    for bits in 9..=15 {
        let offer = format!(
            "permessage-deflate; server_max_window_bits={bits}; client_max_window_bits={bits}; server_no_context_takeover; client_no_context_takeover"
        );
        let (config, response) = accept_deflate_offer(&offer).unwrap();
        assert_eq!(config.server_max_window_bits().get(), bits);
        assert_eq!(config.client_max_window_bits().get(), bits);
        assert!(config.server_no_context_takeover);
        assert!(config.client_no_context_takeover);
        let response = response.to_str().unwrap();
        assert!(response.contains(&format!("server_max_window_bits={bits}")));
        assert!(response.contains(&format!("client_max_window_bits={bits}")));
    }
}

#[test]
fn declines_invalid_or_unsupported_parameters() {
    for offer in [
        "other-extension",
        "permessage-deflate; unknown",
        "permessage-deflate; server_no_context_takeover=1",
        "permessage-deflate; client_no_context_takeover=1",
        "permessage-deflate; server_no_context_takeover; server_no_context_takeover",
        "permessage-deflate; client_max_window_bits; client_max_window_bits=12",
        "permessage-deflate; server_max_window_bits",
        "permessage-deflate; server_max_window_bits=8",
        "permessage-deflate; client_max_window_bits=16",
        "permessage-deflate; client_max_window_bits=+12",
        "permessage-deflate; client_max_window_bits=012",
        "permessage-deflate; client_max_window_bits=",
        "permessage-deflate;",
    ] {
        assert!(accept_deflate_offer(offer).is_none(), "accepted {offer}");
    }
}

#[test]
fn picks_first_supported_offer_across_multiple_headers() {
    let mut headers = HeaderMap::new();
    headers.append(
        header::SEC_WEBSOCKET_EXTENSIONS,
        HeaderValue::from_static("unknown, permessage-deflate; server_max_window_bits=8"),
    );
    headers.append(
        header::SEC_WEBSOCKET_EXTENSIONS,
        HeaderValue::from_static(
            "permessage-deflate; server_max_window_bits=10, permessage-deflate",
        ),
    );
    let (config, _) = negotiate_compression(&headers).unwrap();
    assert_eq!(config.server_max_window_bits().get(), 10);
}

#[test]
fn does_not_mistake_quoted_values_for_extension_offers() {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::SEC_WEBSOCKET_EXTENSIONS,
        HeaderValue::from_static("unknown; value=\"ignored,permessage-deflate\""),
    );
    assert!(negotiate_compression(&headers).is_none());
}
