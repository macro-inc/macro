// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Test doubles: a fake WhatsApp server and a fake Signal implementation.
//!
//! Not a port of a Go file; whatsmeow has no test doubles. Built for the
//! crate's own tests and, behind the `testing` feature, for services that
//! drive a [`Client`](crate::Client) in their tests. Nothing here talks to
//! the network: connections are in-memory websockets.
//!
//! The fake server plays the noise responder with a certificate chain signed
//! by [`FakeSignatures`], so the client must use a [`Signal`](crate::Signal)
//! whose signatures are fake too ([`FakeSignal`]).

use std::sync::Arc;

use aes_gcm::Aes256Gcm;
use async_trait::async_trait;
use futures::{SinkExt, StreamExt};
use prost::Message;
use sha2::{Digest, Sha256};
use tokio::io::DuplexStream;
use tokio::sync::mpsc;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message as WebSocketMessage;
use tokio_tungstenite::tungstenite::protocol::Role;

use crate::binary::{AttributeValue, Attrs, Node, NodeContent, marshal, unmarshal, unpack};
use crate::client::Dialer;
use crate::handshake::{WA_CERT_ISSUER_SERIAL, WA_CERT_PUB_KEY};
use crate::proto::wa_cert::CertChain;
use crate::proto::wa_cert::cert_chain::NoiseCertificate;
use crate::proto::wa_cert::cert_chain::noise_certificate::Details;
use crate::proto::wa_wa6::{ClientPayload, HandshakeMessage, handshake_message};
use crate::signal::{
    CiphertextMessage, CiphertextType, CurveSignatures, PreKeyBundle, SenderKeyName, SignalAddress,
    SignalError, SignalProtocol, SignalProtocolStore,
};
use crate::socket::{
    FrameEvent, FrameSocket, NOISE_START_PATTERN, NoiseHandshake, SocketError, WA_CONN_HEADER,
    generate_iv,
};
use crate::types::{Jid, SERVER_JID};
use crate::util::gcmutil;
use crate::util::keys::{KeyPair, new_key_pair, new_key_pair_from_private_key};

/// A stand-in for XEdDSA: the signature is SHA-256 of the public key and the
/// message, twice. Signing derives the public key from the private key, so
/// signatures made here verify here, and only here.
#[derive(Clone, Copy, Debug, Default)]
pub struct FakeSignatures;

/// The fake signature of a message under a public key.
pub fn fake_signature(public_key: &[u8; 32], message: &[u8]) -> [u8; 64] {
    let digest: [u8; 32] = Sha256::new()
        .chain_update(public_key)
        .chain_update(message)
        .finalize()
        .into();
    let mut signature = [0; 64];
    signature[..32].copy_from_slice(&digest);
    signature[32..].copy_from_slice(&digest);
    signature
}

impl CurveSignatures for FakeSignatures {
    fn calculate_signature(&self, private_key: &[u8; 32], message: &[u8]) -> [u8; 64] {
        fake_signature(&new_key_pair_from_private_key(*private_key).public, message)
    }

    fn verify_signature(
        &self,
        public_key: &[u8; 32],
        message: &[u8],
        signature: &[u8; 64],
    ) -> bool {
        fake_signature(public_key, message) == *signature
    }
}

const FAKE_DIRECT_PREFIX: &[u8] = b"FAKE1";
const FAKE_GROUP_PREFIX: &[u8] = b"FAKEG";
const FAKE_SESSION: &[u8] = b"fake-session";
const FAKE_SENDER_KEY: &[u8] = b"fake-sender-key";

/// A fake Signal protocol: "ciphertexts" are the sender's identity key and
/// the plaintext behind a marker, sessions and sender keys are marker
/// records. It exercises the client's session, prekey and sender key
/// bookkeeping through the real [`SignalProtocolStore`] without any
/// cryptography.
#[derive(Clone, Copy, Debug, Default)]
pub struct FakeSignal;

impl CurveSignatures for FakeSignal {
    fn calculate_signature(&self, private_key: &[u8; 32], message: &[u8]) -> [u8; 64] {
        FakeSignatures.calculate_signature(private_key, message)
    }

    fn verify_signature(
        &self,
        public_key: &[u8; 32],
        message: &[u8],
        signature: &[u8; 64],
    ) -> bool {
        FakeSignatures.verify_signature(public_key, message, signature)
    }
}

fn fake_error(message: &str) -> SignalError {
    SignalError::Internal(rootcause::report!("fake signal: {}", message).into_dynamic())
}

/// Builds a fake direct ciphertext from a sender identity key.
pub fn fake_direct_ciphertext(sender_identity: &[u8; 32], plaintext: &[u8]) -> Vec<u8> {
    [FAKE_DIRECT_PREFIX, sender_identity, plaintext].concat()
}

/// Builds a fake group ciphertext.
pub fn fake_group_ciphertext(plaintext: &[u8]) -> Vec<u8> {
    [FAKE_GROUP_PREFIX, plaintext].concat()
}

/// Builds a fake sender key distribution message for a group and sender.
pub fn fake_sender_key_distribution_message(name: &SenderKeyName) -> Vec<u8> {
    format!("SKDM:{}:{}", name.group_id, name.sender).into_bytes()
}

#[async_trait]
impl SignalProtocol for FakeSignal {
    async fn process_bundle(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        bundle: &PreKeyBundle,
    ) -> Result<(), SignalError> {
        if !store
            .is_trusted_identity(address, bundle.identity_key)
            .await?
        {
            return Err(SignalError::UntrustedIdentity);
        }
        store.save_identity(address, bundle.identity_key).await?;
        store.store_session(address, b"fresh".to_vec()).await?;
        Ok(())
    }

    async fn encrypt(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        plaintext: &[u8],
    ) -> Result<CiphertextMessage, SignalError> {
        let session = store
            .load_session(address)
            .await?
            .ok_or_else(|| fake_error("no session"))?;
        let kind = if session == b"fresh" {
            CiphertextType::PreKey
        } else {
            CiphertextType::Whisper
        };
        let (identity, _) = store.get_identity_key_pair();
        Ok(CiphertextMessage {
            kind,
            serialized: fake_direct_ciphertext(&identity, plaintext),
        })
    }

    async fn decrypt_pre_key_message(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, SignalError> {
        let (identity, plaintext) = split_direct(ciphertext)?;
        if !store.is_trusted_identity(address, identity).await? {
            return Err(SignalError::UntrustedIdentity);
        }
        store.save_identity(address, identity).await?;
        store.store_session(address, FAKE_SESSION.to_vec()).await?;
        Ok(plaintext)
    }

    async fn decrypt_message(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, SignalError> {
        if store.load_session(address).await?.is_none() {
            return Err(fake_error("no session"));
        }
        let (_, plaintext) = split_direct(ciphertext)?;
        Ok(plaintext)
    }

    async fn create_sender_key_distribution_message(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
    ) -> Result<Vec<u8>, SignalError> {
        if store.load_sender_key(name).await?.is_none() {
            store
                .store_sender_key(name, FAKE_SENDER_KEY.to_vec())
                .await?;
        }
        Ok(fake_sender_key_distribution_message(name))
    }

    async fn process_sender_key_distribution_message(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
        message: &[u8],
    ) -> Result<(), SignalError> {
        if !message.starts_with(b"SKDM:") {
            return Err(fake_error("not a fake sender key distribution message"));
        }
        store.store_sender_key(name, message.to_vec()).await?;
        Ok(())
    }

    async fn group_encrypt(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, SignalError> {
        if store.load_sender_key(name).await?.is_none() {
            return Err(SignalError::NoSenderKeyForUser);
        }
        Ok(fake_group_ciphertext(plaintext))
    }

    async fn group_decrypt(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, SignalError> {
        if store.load_sender_key(name).await?.is_none() {
            return Err(SignalError::NoSenderKeyForUser);
        }
        ciphertext
            .strip_prefix(FAKE_GROUP_PREFIX)
            .map(<[u8]>::to_vec)
            .ok_or_else(|| fake_error("not a fake group ciphertext"))
    }
}

fn split_direct(ciphertext: &[u8]) -> Result<([u8; 32], Vec<u8>), SignalError> {
    let rest = ciphertext
        .strip_prefix(FAKE_DIRECT_PREFIX)
        .ok_or_else(|| fake_error("not a fake ciphertext"))?;
    if rest.len() < 32 {
        return Err(fake_error("fake ciphertext too short"));
    }
    let (identity, plaintext) = rest.split_at(32);
    let identity = <[u8; 32]>::try_from(identity).map_err(|_| fake_error("bad identity"))?;
    Ok((identity, plaintext.to_vec()))
}

/// The key the fake intermediate certificate is issued to.
const INTERMEDIATE_KEY: [u8; 32] = [0x42; 32];

fn certificate_chain(leaf_key: &[u8; 32]) -> Vec<u8> {
    const NOT_BEFORE: u64 = 1_600_000_000;
    const NOT_AFTER: u64 = 4_000_000_000;
    let intermediate_details = Details {
        serial: Some(7),
        issuer_serial: Some(WA_CERT_ISSUER_SERIAL),
        key: Some(INTERMEDIATE_KEY.to_vec()),
        not_before: Some(NOT_BEFORE),
        not_after: Some(NOT_AFTER),
    }
    .encode_to_vec();
    let leaf_details = Details {
        serial: Some(8),
        issuer_serial: Some(7),
        key: Some(leaf_key.to_vec()),
        not_before: Some(NOT_BEFORE),
        not_after: Some(NOT_AFTER),
    }
    .encode_to_vec();
    CertChain {
        intermediate: Some(NoiseCertificate {
            signature: Some(fake_signature(&WA_CERT_PUB_KEY, &intermediate_details).to_vec()),
            details: Some(intermediate_details),
        }),
        leaf: Some(NoiseCertificate {
            signature: Some(fake_signature(&INTERMEDIATE_KEY, &leaf_details).to_vec()),
            details: Some(leaf_details),
        }),
    }
    .encode_to_vec()
}

/// A fake WhatsApp server. Hand [`FakeServer::dialer`] to the client config;
/// every dial shows up in [`FakeServer::accept`] once the noise handshake is
/// done.
pub struct FakeServer {
    dialer: Arc<FakeDialer>,
    connections: mpsc::UnboundedReceiver<ServerConnection>,
}

impl Default for FakeServer {
    fn default() -> Self {
        Self::new()
    }
}

impl FakeServer {
    /// A new server with no connections.
    pub fn new() -> FakeServer {
        let (sender, connections) = mpsc::unbounded_channel();
        FakeServer {
            dialer: Arc::new(FakeDialer {
                connections: sender,
            }),
            connections,
        }
    }

    /// The dialer that connects to this server.
    pub fn dialer(&self) -> Arc<FakeDialer> {
        Arc::clone(&self.dialer)
    }

    /// The next connection, after its handshake. `None` once the dialer is
    /// gone.
    pub async fn accept(&mut self) -> Option<ServerConnection> {
        self.connections.recv().await
    }
}

/// Dials a [`FakeServer`] over an in-memory websocket.
pub struct FakeDialer {
    connections: mpsc::UnboundedSender<ServerConnection>,
}

#[async_trait]
impl Dialer for FakeDialer {
    async fn dial(&self) -> Result<(FrameSocket, mpsc::Receiver<FrameEvent>), SocketError> {
        let (client, server) = tokio::io::duplex(1 << 20);
        let client = WebSocketStream::from_raw_socket(client, Role::Client, None).await;
        let server = WebSocketStream::from_raw_socket(server, Role::Server, None).await;
        let connections = self.connections.clone();
        tokio::spawn(async move {
            match ServerConnection::handshake(server).await {
                Some(connection) => {
                    let _ = connections.send(connection);
                }
                None => tracing::debug!("fake server handshake failed"),
            }
        });
        Ok(FrameSocket::from_websocket(client))
    }
}

/// The server side of one connection, after the noise handshake.
pub struct ServerConnection {
    websocket: WebSocketStream<DuplexStream>,
    write_key: Aes256Gcm,
    read_key: Aes256Gcm,
    write_counter: u32,
    read_counter: u32,
    /// The client's static noise key.
    pub client_static: [u8; 32],
    /// The payload the client logged in or registered with.
    pub client_payload: ClientPayload,
}

impl ServerConnection {
    async fn read_frame(
        websocket: &mut WebSocketStream<DuplexStream>,
        skip: usize,
    ) -> Option<Vec<u8>> {
        loop {
            match websocket.next().await? {
                Ok(WebSocketMessage::Binary(data)) => {
                    return data.get(skip + 3..).map(<[u8]>::to_vec);
                }
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

    async fn handshake(mut websocket: WebSocketStream<DuplexStream>) -> Option<ServerConnection> {
        let server_ephemeral = new_key_pair();
        let server_static: KeyPair = new_key_pair();

        let hello = HandshakeMessage::decode(
            Self::read_frame(&mut websocket, WA_CONN_HEADER.len())
                .await?
                .as_slice(),
        )
        .ok()?;
        let client_ephemeral: [u8; 32] = hello.client_hello?.ephemeral?.try_into().ok()?;

        let mut handshake = NoiseHandshake::start(NOISE_START_PATTERN, &WA_CONN_HEADER).ok()?;
        handshake.authenticate(&client_ephemeral);
        handshake.authenticate(&server_ephemeral.public);
        handshake
            .mix_shared_secret_into_key(server_ephemeral.private, client_ephemeral)
            .ok()?;
        let static_ciphertext = handshake.encrypt(&server_static.public).ok()?;
        handshake
            .mix_shared_secret_into_key(server_static.private, client_ephemeral)
            .ok()?;
        let certificate_ciphertext = handshake
            .encrypt(&certificate_chain(&server_static.public))
            .ok()?;
        let server_hello = HandshakeMessage {
            server_hello: Some(handshake_message::ServerHello {
                ephemeral: Some(server_ephemeral.public.to_vec()),
                r#static: Some(static_ciphertext),
                payload: Some(certificate_ciphertext),
                ..Default::default()
            }),
            ..Default::default()
        };
        websocket
            .send(Self::frame(&server_hello.encode_to_vec()))
            .await
            .ok()?;

        let finish =
            HandshakeMessage::decode(Self::read_frame(&mut websocket, 0).await?.as_slice())
                .ok()?
                .client_finish?;
        let client_static: [u8; 32] = handshake.decrypt(&finish.r#static?).ok()?.try_into().ok()?;
        handshake
            .mix_shared_secret_into_key(server_ephemeral.private, client_static)
            .ok()?;
        let client_payload =
            ClientPayload::decode(handshake.decrypt(&finish.payload?).ok()?.as_slice()).ok()?;
        let (client_write, client_read) = handshake.transport_keys();
        Some(ServerConnection {
            websocket,
            write_key: gcmutil::prepare(&client_read).ok()?,
            read_key: gcmutil::prepare(&client_write).ok()?,
            write_counter: 0,
            read_counter: 0,
            client_static,
            client_payload,
        })
    }

    /// The next node from the client; `None` when the client disconnected.
    pub async fn recv_node(&mut self) -> Option<Node> {
        let ciphertext = Self::read_frame(&mut self.websocket, 0).await?;
        let plaintext = gcmutil::open(
            &self.read_key,
            &generate_iv(self.read_counter),
            &ciphertext,
            &[],
        )
        .ok()?;
        self.read_counter += 1;
        unmarshal(&unpack(&plaintext).ok()?).ok()
    }

    /// The next node from the client that isn't a keepalive ping, receipt
    /// ack or other node matching `skip`.
    pub async fn recv_node_skipping(&mut self, skip: impl Fn(&Node) -> bool) -> Option<Node> {
        loop {
            let node = self.recv_node().await?;
            if !skip(&node) {
                return Some(node);
            }
        }
    }

    /// Sends a node to the client.
    pub async fn send_node(&mut self, node: &Node) {
        let Ok(plaintext) = marshal(node) else {
            panic!("fake server failed to marshal a node");
        };
        let ciphertext = gcmutil::seal(
            &self.write_key,
            &generate_iv(self.write_counter),
            &plaintext,
            &[],
        )
        .unwrap_or_default();
        self.write_counter += 1;
        let _ = self.websocket.send(Self::frame(&ciphertext)).await;
    }

    /// Sends a node and closes the websocket right behind it, as the server
    /// does with the 515 after pairing.
    pub async fn send_node_and_close(mut self, node: &Node) {
        let Ok(plaintext) = marshal(node) else {
            panic!("fake server failed to marshal a node");
        };
        let ciphertext = gcmutil::seal(
            &self.write_key,
            &generate_iv(self.write_counter),
            &plaintext,
            &[],
        )
        .unwrap_or_default();
        let _ = self.websocket.feed(Self::frame(&ciphertext)).await;
        let _ = self.websocket.close(None).await;
    }

    /// Closes the websocket, as the server going away.
    pub async fn close(mut self) {
        let _ = self.websocket.close(None).await;
    }

    /// Answers an `<iq>` with `type="result"` and the given children.
    pub async fn respond_iq(&mut self, request: &Node, children: Vec<Node>) {
        let mut attrs = Attrs::from([
            ("type".to_owned(), "result".into()),
            ("from".to_owned(), SERVER_JID.clone().into()),
        ]);
        if let Some(id) = request.attrs.get("id") {
            attrs.insert("id".to_owned(), id.clone());
        }
        let content = (!children.is_empty()).then_some(NodeContent::Nodes(children));
        self.send_node(&Node {
            tag: "iq".to_owned(),
            attrs,
            content,
        })
        .await;
    }

    /// Answers an `<iq>` with `type="error"` and an `<error>` child.
    pub async fn respond_iq_error(&mut self, request: &Node, code: i64, text: &str) {
        let mut attrs = Attrs::from([
            ("type".to_owned(), "error".into()),
            ("from".to_owned(), SERVER_JID.clone().into()),
        ]);
        if let Some(id) = request.attrs.get("id") {
            attrs.insert("id".to_owned(), id.clone());
        }
        self.send_node(&Node {
            tag: "iq".to_owned(),
            attrs,
            content: Some(NodeContent::Nodes(vec![Node {
                tag: "error".to_owned(),
                attrs: Attrs::from([
                    ("code".to_owned(), code.into()),
                    ("text".to_owned(), text.into()),
                ]),
                content: None,
            }])),
        })
        .await;
    }
}

/// Whether a node is an `<iq>` with the given namespace.
pub fn is_iq(node: &Node, xmlns: &str) -> bool {
    node.tag == "iq" && attr_string(node, "xmlns") == xmlns
}

/// A string attribute, or empty.
pub fn attr_string(node: &Node, key: &str) -> String {
    match node.attrs.get(key) {
        Some(AttributeValue::String(value)) => value.clone(),
        Some(AttributeValue::Jid(jid)) => jid.to_string(),
        None => String::new(),
    }
}

/// A JID attribute, or the empty JID.
pub fn attr_jid(node: &Node, key: &str) -> Jid {
    match node.attrs.get(key) {
        Some(AttributeValue::Jid(jid)) => jid.clone(),
        _ => Jid::default(),
    }
}
