//! One client connection: the noise handshake as responder, then encrypted
//! binary-XML nodes in both directions.

use std::sync::Arc;

use aes_gcm::Aes256Gcm;
use futures::stream::{SplitSink, SplitStream};
use futures::{SinkExt, StreamExt};
use hmac::{Hmac, Mac};
use prost::Message;
use sha2::Sha256;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message as WebSocketMessage;
use whatsmeow::binary::{Node, marshal, unmarshal, unpack};
use whatsmeow::pair::ADV_DEVICE_SIGNATURE_PREFIX;
use whatsmeow::proto::wa_adv::AdvSignedDeviceIdentity;
use whatsmeow::proto::wa_wa6::{ClientPayload, HandshakeMessage, handshake_message};
use whatsmeow::signal::CurveSignatures;
use whatsmeow::socket::{NOISE_START_PATTERN, NoiseHandshake, WA_CONN_HEADER, generate_iv};
use whatsmeow::util::gcmutil;
use whatsmeow::util::keys::new_key_pair;
use whatsmeow_signal::LibsignalCurveSignatures;

use crate::Shared;
use crate::stanza::{attr_string, children, content_bytes, node, now, text};
use crate::state::{
    ConnectionEntry, DeviceAddress, DeviceKind, Outbound, Pairing, device_jid, iq_result,
};

type Socket = WebSocketStream<TcpStream>;

/// How long a closed connection waits for the client's side of the close.
const CLOSE_GRACE: std::time::Duration = std::time::Duration::from_secs(5);

/// Splits websocket messages into frames: a 3-byte big-endian length, then
/// the frame. The first message also starts with the connection header.
#[derive(Default)]
struct FrameReader {
    header_seen: bool,
    buffer: Vec<u8>,
    frames: std::collections::VecDeque<Vec<u8>>,
}

impl FrameReader {
    fn push(&mut self, data: &[u8]) {
        let mut data = data;
        if !self.header_seen {
            self.header_seen = true;
            data = data.strip_prefix(&WA_CONN_HEADER[..]).unwrap_or(data);
        }
        self.buffer.extend_from_slice(data);
        while self.buffer.len() >= 3 {
            let length = usize::from(self.buffer[0]) << 16
                | usize::from(self.buffer[1]) << 8
                | usize::from(self.buffer[2]);
            if self.buffer.len() < 3 + length {
                break;
            }
            self.frames.push_back(self.buffer[3..3 + length].to_vec());
            self.buffer.drain(..3 + length);
        }
    }
}

async fn read_frame(stream: &mut SplitStream<Socket>, reader: &mut FrameReader) -> Option<Vec<u8>> {
    loop {
        if let Some(frame) = reader.frames.pop_front() {
            return Some(frame);
        }
        match stream.next().await? {
            Ok(WebSocketMessage::Binary(data)) => reader.push(&data),
            Ok(WebSocketMessage::Close(_)) | Err(_) => return None,
            Ok(_) => {}
        }
    }
}

fn frame(data: &[u8]) -> WebSocketMessage {
    let length = u32::try_from(data.len()).unwrap_or(u32::MAX).to_be_bytes();
    let mut message = length[1..].to_vec();
    message.extend_from_slice(data);
    WebSocketMessage::Binary(message.into())
}

struct Established {
    sink: SplitSink<Socket, WebSocketMessage>,
    stream: SplitStream<Socket>,
    reader: FrameReader,
    write_key: Aes256Gcm,
    read_key: Aes256Gcm,
    client_static: [u8; 32],
    payload: ClientPayload,
}

async fn handshake(shared: &Shared, socket: Socket) -> Option<Established> {
    let (mut sink, mut stream) = socket.split();
    let mut reader = FrameReader::default();
    let hello =
        HandshakeMessage::decode(read_frame(&mut stream, &mut reader).await?.as_slice()).ok()?;
    let client_ephemeral: [u8; 32] = hello.client_hello?.ephemeral?.try_into().ok()?;
    let server_ephemeral = new_key_pair();
    let server_static = &shared.identity.static_key;

    let mut noise = NoiseHandshake::start(NOISE_START_PATTERN, &WA_CONN_HEADER).ok()?;
    noise.authenticate(&client_ephemeral);
    noise.authenticate(&server_ephemeral.public);
    noise
        .mix_shared_secret_into_key(server_ephemeral.private, client_ephemeral)
        .ok()?;
    let static_ciphertext = noise.encrypt(&server_static.public).ok()?;
    noise
        .mix_shared_secret_into_key(server_static.private, client_ephemeral)
        .ok()?;
    let certificate_ciphertext = noise.encrypt(&shared.identity.certificate_chain).ok()?;
    let server_hello = HandshakeMessage {
        server_hello: Some(handshake_message::ServerHello {
            ephemeral: Some(server_ephemeral.public.to_vec()),
            r#static: Some(static_ciphertext),
            payload: Some(certificate_ciphertext),
            ..Default::default()
        }),
        ..Default::default()
    };
    sink.send(frame(&server_hello.encode_to_vec())).await.ok()?;

    let finish = HandshakeMessage::decode(read_frame(&mut stream, &mut reader).await?.as_slice())
        .ok()?
        .client_finish?;
    let client_static: [u8; 32] = noise.decrypt(&finish.r#static?).ok()?.try_into().ok()?;
    noise
        .mix_shared_secret_into_key(server_ephemeral.private, client_static)
        .ok()?;
    let payload = ClientPayload::decode(noise.decrypt(&finish.payload?).ok()?.as_slice()).ok()?;
    let (client_write, client_read) = noise.transport_keys();
    Some(Established {
        sink,
        stream,
        reader,
        write_key: gcmutil::prepare(&client_read).ok()?,
        read_key: gcmutil::prepare(&client_write).ok()?,
        client_static,
        payload,
    })
}

/// Serves one accepted TCP connection until it closes.
pub(crate) async fn serve(shared: Arc<Shared>, tcp: TcpStream) {
    let Ok(socket) = tokio_tungstenite::accept_async(tcp).await else {
        tracing::debug!("fake server websocket upgrade failed");
        return;
    };
    let Some(established) = handshake(&shared, socket).await else {
        tracing::debug!("fake server noise handshake failed");
        return;
    };
    let Established {
        mut sink,
        mut stream,
        mut reader,
        write_key,
        read_key,
        client_static,
        payload,
    } = established;

    let (outbound, mut outbound_queue) = mpsc::unbounded_channel();
    let connection_id = {
        let mut state = shared.lock();
        state.next_connection += 1;
        let id = state.next_connection;
        state.connections.insert(
            id,
            ConnectionEntry {
                outbound,
                device: None,
                pairing: None,
            },
        );
        id
    };

    let writer_done = tokio_util::sync::CancellationToken::new();
    let writer_guard = writer_done.clone().drop_guard();
    let writer = tokio::spawn(async move {
        let _done = writer_guard;
        let mut counter = 0u32;
        while let Some(item) = outbound_queue.recv().await {
            match item {
                Outbound::Node(node) => {
                    let Ok(plaintext) = marshal(&node) else {
                        tracing::warn!(tag = %node.tag, "fake server failed to marshal a node");
                        continue;
                    };
                    let Ok(ciphertext) =
                        gcmutil::seal(&write_key, &generate_iv(counter), &plaintext, &[])
                    else {
                        break;
                    };
                    counter += 1;
                    if sink.send(frame(&ciphertext)).await.is_err() {
                        break;
                    }
                }
                Outbound::Close => {
                    let _ = sink.close().await;
                    break;
                }
            }
        }
    });

    match (payload.username, payload.device) {
        (Some(username), device) if payload.device_pairing_data.is_none() => {
            shared.login(
                connection_id,
                DeviceAddress {
                    phone: username.to_string(),
                    device: u16::try_from(device.unwrap_or_default()).unwrap_or_default(),
                },
                client_static,
            );
        }
        _ => shared.start_pairing(connection_id),
    }

    let mut counter = 0u32;
    loop {
        // After the server closes, keep reading until the client finishes the
        // close handshake: dropping the socket while the client still has
        // unread frames (a 515 restart, a conflict) makes the kernel send an
        // RST, which discards them.
        let ciphertext = tokio::select! {
            frame = read_frame(&mut stream, &mut reader) => frame,
            () = async {
                writer_done.cancelled().await;
                tokio::time::sleep(CLOSE_GRACE).await;
            } => None,
        };
        let Some(ciphertext) = ciphertext else {
            break;
        };
        let Ok(plaintext) = gcmutil::open(&read_key, &generate_iv(counter), &ciphertext, &[])
        else {
            tracing::warn!("fake server failed to decrypt a frame");
            break;
        };
        counter += 1;
        let Some(node) = unpack(&plaintext)
            .ok()
            .and_then(|data| unmarshal(&data).ok())
        else {
            tracing::warn!("fake server failed to parse a node");
            continue;
        };
        shared.handle_node(connection_id, &node);
    }

    shared.connection_closed(connection_id);
    writer.abort();
}

impl Shared {
    /// Sends `<pair-device>` with fresh refs to a connection that registers.
    fn start_pairing(&self, connection: u64) {
        let mut state = self.lock();
        let refs: Vec<String> = (0..6)
            .map(|_| {
                let random: [u8; 12] = rand::random();
                let mut reference = String::from("2@");
                for byte in random {
                    reference.push_str(&format!("{byte:02x}"));
                }
                reference
            })
            .collect();
        for reference in &refs {
            state.pairing_refs.insert(reference.clone(), connection);
        }
        let request = node(
            "iq",
            vec![
                ("from", crate::stanza::jid(&whatsmeow::types::SERVER_JID)),
                ("id", text(crate::stanza::random_id())),
                ("type", text("set")),
                ("xmlns", text("md")),
            ],
            children(vec![node(
                "pair-device",
                vec![],
                children(
                    refs.iter()
                        .map(|reference| {
                            node("ref", vec![], crate::stanza::bytes(reference.as_bytes()))
                        })
                        .collect(),
                ),
            )]),
        );
        if let Some(entry) = state.connections.get_mut(&connection) {
            entry.pairing = Some(Pairing { refs });
        }
        state.send(connection, request);
        drop(state);
        self.changed();
    }

    /// Logs a paired device in, replacing an older connection of the device.
    fn login(&self, connection: u64, address: DeviceAddress, client_static: [u8; 32]) {
        let mut state = self.lock();
        let known = matches!(
            state.device(&address).map(|device| &device.kind),
            Some(DeviceKind::Linked { noise_key }) if *noise_key == client_static
        );
        if !known {
            state.send(
                connection,
                node("failure", vec![("reason", text("401"))], None),
            );
            state.close(connection);
            return;
        }
        let previous = state.device(&address).and_then(|device| device.connection);
        if let Some(previous) = previous {
            state.send(
                previous,
                node(
                    "stream:error",
                    vec![],
                    children(vec![node(
                        "conflict",
                        vec![("type", text("replaced"))],
                        None,
                    )]),
                ),
            );
            state.close(previous);
            if let Some(entry) = state.connections.get_mut(&previous) {
                entry.device = None;
            }
            state.detach(&address);
        }
        if let Some(entry) = state.connections.get_mut(&connection) {
            entry.device = Some(address.clone());
        }
        let lid = state.jid_of(&address, true);
        state.send(
            connection,
            node(
                "success",
                vec![("t", now()), ("lid", crate::stanza::jid(&lid))],
                None,
            ),
        );
        let queued: Vec<Node> = state
            .device_mut(&address)
            .map(|device| {
                device.connection = Some(connection);
                device.offline.drain(..).collect()
            })
            .unwrap_or_default();
        let count = queued.len();
        for node in queued {
            state.deliver(&address, node);
        }
        state.send(
            connection,
            node(
                "ib",
                vec![],
                children(vec![node(
                    "offline",
                    vec![("count", text(count.to_string()))],
                    None,
                )]),
            ),
        );
        drop(state);
        self.changed();
    }

    fn connection_closed(&self, connection: u64) {
        let mut state = self.lock();
        let Some(entry) = state.connections.remove(&connection) else {
            return;
        };
        if let Some(pairing) = entry.pairing {
            for reference in pairing.refs {
                state.pairing_refs.remove(&reference);
            }
        }
        if let Some(address) = entry.device
            && state
                .device(&address)
                .is_some_and(|device| device.connection == Some(connection))
        {
            state.detach(&address);
        }
        drop(state);
        self.changed();
    }

    fn handle_node(&self, connection: u64, node: &Node) {
        let mut state = self.lock();
        let Some(entry) = state.connections.get(&connection) else {
            return;
        };
        let Some(address) = entry.device.clone() else {
            drop(state);
            self.handle_pairing_node(connection, node);
            return;
        };
        match node.tag.as_str() {
            "iq" => {
                let response = state.handle_iq(&address, node);
                state.send(connection, response);
            }
            "message" => {
                state
                    .submitted
                    .push((address.clone(), attr_string(node, "id")));
                let ack = state.route_message(&address, node);
                if !state.withheld_acks.contains(&address) {
                    state.send(connection, ack);
                }
            }
            "receipt" => {
                state.acked(&address, &attr_string(node, "id"));
                state.route_receipt(&address, node);
            }
            "ack" if attr_string(node, "class") == "message" => {
                state.acked(&address, &attr_string(node, "id"));
            }
            _ => {}
        }
        drop(state);
        self.changed();
    }

    /// Nodes from a connection that hasn't logged in: the client's answer to
    /// a pair-success, or anything else (answered with an empty result).
    fn handle_pairing_node(&self, connection: u64, request: &Node) {
        if request.tag != "iq" {
            return;
        }
        let iq_type = attr_string(request, "type");
        let id = attr_string(request, "id");
        let mut state = self.lock();
        if iq_type == "get" || iq_type == "set" {
            let response = iq_result(request, vec![]);
            state.send(connection, response);
            return;
        }
        let Some(pending) = state.pending_pairs.remove(&id) else {
            return;
        };
        let result = if iq_type == "result" {
            verify_device_signature(
                request,
                &pending.details,
                &pending.identity_key,
                &pending.account_public,
            )
        } else {
            Err(crate::PairError::Rejected(
                request
                    .get_optional_child_by_tag(&["error"])
                    .map(|error| attr_string(error, "text"))
                    .unwrap_or_default(),
            ))
        };
        let result = result.map(|()| {
            if let Some(user) = state.users.get_mut(&pending.address.phone) {
                user.devices.insert(
                    pending.address.device,
                    crate::state::DeviceRecord {
                        kind: DeviceKind::Linked {
                            noise_key: pending.noise_key,
                        },
                        keys: None,
                        connection: None,
                        offline: Default::default(),
                        unacked: Vec::new(),
                    },
                );
            }
            if let Some(entry) = state.connections.get_mut(&pending.connection)
                && let Some(pairing) = entry.pairing.take()
            {
                for reference in pairing.refs {
                    state.pairing_refs.remove(&reference);
                }
            }
            state.send(
                pending.connection,
                node("stream:error", vec![("code", text("515"))], None),
            );
            state.close(pending.connection);
            device_jid(&pending.address.phone, pending.address.device, false)
        });
        let _ = pending.reply.send(result);
        drop(state);
        self.changed();
    }
}

/// Checks the device's signature in the client's `<pair-device-sign>`.
fn verify_device_signature(
    response: &Node,
    details: &[u8],
    identity_key: &[u8; 32],
    account_public: &[u8; 32],
) -> Result<(), crate::PairError> {
    let signed = response
        .get_optional_child_by_tag(&["pair-device-sign", "device-identity"])
        .and_then(content_bytes)
        .and_then(|data| AdvSignedDeviceIdentity::decode(data).ok())
        .ok_or(crate::PairError::BadDeviceSignature)?;
    let signature: [u8; 64] = signed
        .device_signature
        .as_deref()
        .and_then(|signature| signature.try_into().ok())
        .ok_or(crate::PairError::BadDeviceSignature)?;
    let message = [
        &ADV_DEVICE_SIGNATURE_PREFIX[..],
        details,
        identity_key,
        account_public,
    ]
    .concat();
    if LibsignalCurveSignatures::new().verify_signature(identity_key, &message, &signature) {
        Ok(())
    } else {
        Err(crate::PairError::BadDeviceSignature)
    }
}

/// The HMAC of a signed device identity under the device's ADV secret.
pub(crate) fn adv_hmac(adv_secret: &[u8], signed: &[u8]) -> Vec<u8> {
    let Ok(mut mac) = <Hmac<Sha256> as Mac>::new_from_slice(adv_secret) else {
        return Vec::new();
    };
    mac.update(signed);
    mac.finalize().into_bytes().to_vec()
}
