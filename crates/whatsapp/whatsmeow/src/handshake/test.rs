// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! The handshake runs against a fake WhatsApp server over an in-memory
//! websocket. Signatures are faked: libsignal's XEdDSA is behind the
//! `CurveSignatures` boundary.

use futures::{SinkExt, StreamExt};
use sha2::{Digest, Sha256};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message as WebSocketMessage;
use tokio_tungstenite::tungstenite::protocol::Role;

use super::*;
use crate::proto::wa_cert::cert_chain::NoiseCertificate;
use crate::socket::WA_CONN_HEADER;
use crate::util::gcmutil;
use crate::util::keys::new_key_pair_from_private_key;

/// A stand-in signature scheme: the signature is SHA-256 of the key and the
/// message, twice.
struct FakeSignatures;

fn fake_signature(public_key: &[u8; 32], message: &[u8]) -> [u8; 64] {
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
    fn calculate_signature(&self, _: &[u8; 32], _: &[u8]) -> [u8; 64] {
        [0; 64]
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

const INTERMEDIATE_KEY: [u8; 32] = [0x42; 32];

fn fixed_private_key(start: u8) -> [u8; 32] {
    std::array::from_fn(|index| start + u8::try_from(index).unwrap())
}

fn certificate_chain(leaf_key: &[u8; 32], not_after: u64) -> Vec<u8> {
    let intermediate_details = Details {
        serial: Some(7),
        issuer_serial: Some(WA_CERT_ISSUER_SERIAL),
        key: Some(INTERMEDIATE_KEY.to_vec()),
        not_before: Some(1_600_000_000),
        not_after: Some(not_after),
    }
    .encode_to_vec();
    let leaf_details = Details {
        serial: Some(8),
        issuer_serial: Some(7),
        key: Some(leaf_key.to_vec()),
        not_before: Some(1_600_000_000),
        not_after: Some(not_after),
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

fn frame(data: &[u8]) -> WebSocketMessage {
    let length = u32::try_from(data.len()).unwrap().to_be_bytes();
    let mut message = length[1..].to_vec();
    message.extend_from_slice(data);
    WebSocketMessage::Binary(message.into())
}

async fn read_frame(server: &mut WebSocketStream<tokio::io::DuplexStream>, skip: usize) -> Vec<u8> {
    let Some(Ok(WebSocketMessage::Binary(data))) = server.next().await else {
        panic!("expected a binary message");
    };
    data[skip + 3..].to_vec()
}

#[tokio::test]
async fn handshake_with_a_fake_server_establishes_the_noise_socket() {
    let (client, server) = tokio::io::duplex(1 << 16);
    let client = WebSocketStream::from_raw_socket(client, Role::Client, None).await;
    let mut server = WebSocketStream::from_raw_socket(server, Role::Server, None).await;
    let (frame_socket, frames) = FrameSocket::from_websocket(client);

    let client_ephemeral = new_key_pair_from_private_key(fixed_private_key(0x10));
    let noise_key = new_key_pair_from_private_key(fixed_private_key(0x90));
    let client_payload = ClientPayload {
        username: Some(1_234_567_890),
        device: Some(7),
        ..Default::default()
    };

    let server_task = tokio::spawn(async move {
        let server_ephemeral = new_key_pair_from_private_key(fixed_private_key(0x50));
        let server_static = new_key_pair_from_private_key(fixed_private_key(0x70));

        let hello = HandshakeMessage::decode(read_frame(&mut server, 4).await.as_slice()).unwrap();
        let client_ephemeral: [u8; 32] = hello
            .client_hello
            .unwrap()
            .ephemeral
            .unwrap()
            .try_into()
            .unwrap();

        let mut handshake = NoiseHandshake::start(NOISE_START_PATTERN, &WA_CONN_HEADER).unwrap();
        handshake.authenticate(&client_ephemeral);
        handshake.authenticate(&server_ephemeral.public);
        handshake
            .mix_shared_secret_into_key(server_ephemeral.private, client_ephemeral)
            .unwrap();
        let static_ciphertext = handshake.encrypt(&server_static.public).unwrap();
        handshake
            .mix_shared_secret_into_key(server_static.private, client_ephemeral)
            .unwrap();
        let certificate_ciphertext = handshake
            .encrypt(&certificate_chain(&server_static.public, 4_000_000_000))
            .unwrap();
        let server_hello = HandshakeMessage {
            server_hello: Some(handshake_message::ServerHello {
                ephemeral: Some(server_ephemeral.public.to_vec()),
                r#static: Some(static_ciphertext),
                payload: Some(certificate_ciphertext),
                ..Default::default()
            }),
            ..Default::default()
        };
        server
            .send(frame(&server_hello.encode_to_vec()))
            .await
            .unwrap();

        let finish = HandshakeMessage::decode(read_frame(&mut server, 0).await.as_slice())
            .unwrap()
            .client_finish
            .unwrap();
        let client_static: [u8; 32] = handshake
            .decrypt(&finish.r#static.unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        handshake
            .mix_shared_secret_into_key(server_ephemeral.private, client_static)
            .unwrap();
        let payload = ClientPayload::decode(
            handshake
                .decrypt(&finish.payload.unwrap())
                .unwrap()
                .as_slice(),
        )
        .unwrap();
        let (client_write, client_read) = handshake.transport_keys();

        let first_transport_frame = read_frame(&mut server, 0).await;
        let plaintext = gcmutil::decrypt(
            &client_write,
            &crate::socket::generate_iv(0),
            &first_transport_frame,
            &[],
        )
        .unwrap();
        let reply =
            gcmutil::encrypt(&client_read, &crate::socket::generate_iv(0), b"pong", &[]).unwrap();
        server.send(frame(&reply)).await.unwrap();
        (client_static, payload, plaintext, server)
    });

    let (noise_socket, mut events) = do_handshake(
        frame_socket,
        frames,
        &client_ephemeral,
        &noise_key,
        &client_payload,
        &FakeSignatures,
    )
    .await
    .unwrap();
    noise_socket.send_frame(b"ping").await.unwrap();
    assert_eq!(
        events.recv().await,
        Some(NoiseEvent::Frame(b"pong".to_vec()))
    );

    let (client_static, payload, plaintext, _server) = server_task.await.unwrap();
    assert_eq!(client_static, noise_key.public);
    assert_eq!(payload, client_payload);
    assert_eq!(plaintext, b"ping");
}

#[tokio::test]
async fn handshake_fails_when_the_server_hangs_up() {
    let (client, server) = tokio::io::duplex(1 << 16);
    let client = WebSocketStream::from_raw_socket(client, Role::Client, None).await;
    let mut server = WebSocketStream::from_raw_socket(server, Role::Server, None).await;
    let (frame_socket, frames) = FrameSocket::from_websocket(client);
    let server_task = tokio::spawn(async move {
        read_frame(&mut server, 4).await;
        server.close(None).await.unwrap();
    });

    let result = do_handshake(
        frame_socket,
        frames,
        &new_key_pair_from_private_key(fixed_private_key(0x10)),
        &new_key_pair_from_private_key(fixed_private_key(0x90)),
        &ClientPayload::default(),
        &FakeSignatures,
    )
    .await;
    assert!(matches!(result, Err(HandshakeError::Disconnected)));
    server_task.await.unwrap();
}

#[test]
fn certificate_chain_checks_match_go() {
    let static_key = [9; 32];
    let now = DateTime::from_timestamp(1_700_000_000, 0).unwrap();
    assert_eq!(
        verify_server_cert_at(
            &certificate_chain(&static_key, 4_000_000_000),
            &static_key,
            &FakeSignatures,
            now
        ),
        Ok(())
    );
    assert_eq!(
        verify_server_cert_at(
            &certificate_chain(&[8; 32], 4_000_000_000),
            &static_key,
            &FakeSignatures,
            now
        ),
        Err(CertificateError::KeyMismatch)
    );
    assert_eq!(
        verify_server_cert_at(
            &certificate_chain(&static_key, 1_650_000_000),
            &static_key,
            &FakeSignatures,
            now
        )
        .unwrap_err()
        .to_string(),
        "intermediate cert certificate expired (current time 2023-11-14 22:13:20 UTC is after 2022-04-15 05:20:00 UTC)"
    );

    let mut tampered =
        CertChain::decode(certificate_chain(&static_key, 4_000_000_000).as_slice()).unwrap();
    if let Some(intermediate) = tampered.intermediate.as_mut() {
        intermediate.signature = Some(vec![0; 64]);
    }
    assert_eq!(
        verify_server_cert_at(&tampered.encode_to_vec(), &static_key, &FakeSignatures, now),
        Err(CertificateError::IntermediateSignature)
    );
    if let Some(intermediate) = tampered.intermediate.as_mut() {
        intermediate.signature = Some(vec![0; 63]);
    }
    assert_eq!(
        verify_server_cert_at(&tampered.encode_to_vec(), &static_key, &FakeSignatures, now),
        Err(CertificateError::IntermediateSignatureLength(63))
    );
    assert_eq!(
        verify_server_cert_at(&[], &static_key, &FakeSignatures, now),
        Err(CertificateError::MissingParts)
    );
}
