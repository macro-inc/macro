// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow handshake.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Go's `doHandshake` is a `Client` method that also wires the frame handler
// into the client's node queue. Until the client is ported, it is a function
// taking the client's inputs and returning the noise socket with its events.

//! The noise handshake that opens every connection, and the verification of
//! the server's certificate chain.

use std::time::Duration;

use chrono::{DateTime, Utc};
use prost::Message;
use tokio::sync::mpsc;

use crate::proto::wa_cert::CertChain;
use crate::proto::wa_cert::cert_chain::noise_certificate::Details;
use crate::proto::wa_wa6::{ClientPayload, HandshakeMessage, handshake_message};
use crate::signal::CurveSignatures;
use crate::socket::{
    FrameEvent, FrameSocket, NOISE_START_PATTERN, NoiseEvent, NoiseHandshake, NoiseHandshakeError,
    NoiseSocket, SocketError,
};
use crate::util::gcmutil::GcmError;
use crate::util::keys::KeyPair;

/// How long to wait for the server's handshake response.
pub const NOISE_HANDSHAKE_RESPONSE_TIMEOUT: Duration = Duration::from_secs(20);
/// The issuer serial of the intermediate certificate.
pub const WA_CERT_ISSUER_SERIAL: u32 = 0;
/// WhatsApp's root key that signs the intermediate noise certificate.
pub const WA_CERT_PUB_KEY: [u8; 32] = [
    0x14, 0x23, 0x75, 0x57, 0x4d, 0xa, 0x58, 0x71, 0x66, 0xaa, 0xe7, 0x1e, 0xbe, 0x51, 0x64, 0x37,
    0xc4, 0xa2, 0x8b, 0x73, 0xe3, 0x69, 0x5c, 0x6c, 0xe1, 0xf7, 0xf9, 0x54, 0x5d, 0xa8, 0xee, 0x6b,
];

/// Why the handshake failed. The messages match whatsmeow's.
#[derive(Debug, thiserror::Error)]
pub enum HandshakeError {
    /// Starting or mixing the handshake failed.
    #[error("noise handshake failed: {0}")]
    Noise(#[from] NoiseHandshakeError),
    /// Sending a handshake frame failed.
    #[error("failed to send handshake message: {0}")]
    Send(#[source] SocketError),
    /// No response within [`NOISE_HANDSHAKE_RESPONSE_TIMEOUT`].
    #[error("timed out waiting for handshake response")]
    Timeout,
    /// The socket closed before the server answered.
    #[error("socket closed while waiting for handshake response")]
    Disconnected,
    /// The response wasn't a handshake message.
    #[error("failed to unmarshal handshake response: {0}")]
    Unmarshal(#[source] prost::DecodeError),
    /// The server hello lacked a part.
    #[error("missing parts of handshake response")]
    MissingParts,
    /// The server's static key didn't decrypt.
    #[error("failed to decrypt server static ciphertext: {0}")]
    DecryptStatic(#[source] GcmError),
    /// The server's static key wasn't 32 bytes.
    #[error("unexpected length of server static plaintext {0} (expected 32)")]
    StaticLength(usize),
    /// The certificate didn't decrypt.
    #[error("failed to decrypt noise certificate ciphertext: {0}")]
    DecryptCertificate(#[source] GcmError),
    /// The certificate didn't verify.
    #[error("failed to verify server cert: {0}")]
    Certificate(#[from] CertificateError),
}

/// Why the server's noise certificate didn't verify.
#[derive(Debug, thiserror::Error, PartialEq)]
pub enum CertificateError {
    /// The chain or its details didn't parse.
    #[error("failed to unmarshal noise certificate: {0}")]
    Unmarshal(#[source] prost::DecodeError),
    /// A certificate lacked details or a signature.
    #[error("missing parts of noise certificate")]
    MissingParts,
    /// The intermediate signature wasn't 64 bytes.
    #[error("unexpected length of intermediate cert signature {0} (expected 64)")]
    IntermediateSignatureLength(usize),
    /// The leaf signature wasn't 64 bytes.
    #[error("unexpected length of leaf cert signature {0} (expected 64)")]
    LeafSignatureLength(usize),
    /// WhatsApp's root key didn't sign the intermediate certificate.
    #[error("failed to verify intermediate cert signature")]
    IntermediateSignature,
    /// The intermediate certificate has another issuer.
    #[error("unexpected intermediate issuer serial {0} (expected {WA_CERT_ISSUER_SERIAL})")]
    IntermediateIssuer(u32),
    /// The intermediate key wasn't 32 bytes.
    #[error("unexpected length of intermediate cert key {0} (expected 32)")]
    IntermediateKeyLength(usize),
    /// The intermediate key didn't sign the leaf certificate. Go reports this
    /// with the intermediate message too.
    #[error("failed to verify intermediate cert signature")]
    LeafSignature,
    /// The leaf wasn't issued by the intermediate.
    #[error("unexpected leaf issuer serial {got} (expected {expected})")]
    LeafIssuer {
        /// The leaf's issuer serial.
        got: u32,
        /// The intermediate's serial.
        expected: u32,
    },
    /// The leaf key isn't the server's static key.
    #[error("cert key doesn't match decrypted static")]
    KeyMismatch,
    /// A certificate isn't valid at the current time.
    #[error("{which} cert {reason}")]
    Validity {
        /// "intermediate" or "leaf".
        which: &'static str,
        /// Not valid yet or expired.
        reason: ValidityError,
    },
}

/// Why a certificate isn't valid now.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ValidityError {
    /// Before the certificate's start.
    #[error("certificate not valid yet (current time {now} is before {not_before})")]
    NotYetValid {
        /// The current time.
        now: DateTime<Utc>,
        /// The certificate's start.
        not_before: DateTime<Utc>,
    },
    /// After the certificate's end.
    #[error("certificate expired (current time {now} is after {not_after})")]
    Expired {
        /// The current time.
        now: DateTime<Utc>,
        /// The certificate's end.
        not_after: DateTime<Utc>,
    },
}

/// Runs the `Noise_XX_25519_AESGCM_SHA256` handshake for the WhatsApp web
/// API over a freshly connected frame socket, sending `client_payload` as the
/// final message. On success, frames go through the returned noise socket.
pub async fn do_handshake(
    frame_socket: FrameSocket,
    mut frames: mpsc::Receiver<FrameEvent>,
    ephemeral_key_pair: &KeyPair,
    noise_key: &KeyPair,
    client_payload: &ClientPayload,
    signatures: &dyn CurveSignatures,
) -> Result<(NoiseSocket, mpsc::Receiver<NoiseEvent>), HandshakeError> {
    let header = frame_socket.header().await.unwrap_or_default();
    let mut handshake = NoiseHandshake::start(NOISE_START_PATTERN, &header)?;
    handshake.authenticate(&ephemeral_key_pair.public);
    let data = HandshakeMessage {
        client_hello: Some(handshake_message::ClientHello {
            ephemeral: Some(ephemeral_key_pair.public.to_vec()),
            ..Default::default()
        }),
        ..Default::default()
    }
    .encode_to_vec();
    frame_socket
        .send_frame(&data)
        .await
        .map_err(HandshakeError::Send)?;

    let response = match tokio::time::timeout(NOISE_HANDSHAKE_RESPONSE_TIMEOUT, frames.recv()).await
    {
        Err(_) => return Err(HandshakeError::Timeout),
        Ok(Some(FrameEvent::Frame(response))) => response,
        Ok(Some(FrameEvent::Disconnected { .. }) | None) => {
            return Err(HandshakeError::Disconnected);
        }
    };
    let handshake_response =
        HandshakeMessage::decode(response.as_slice()).map_err(HandshakeError::Unmarshal)?;
    let server_hello = handshake_response.server_hello.unwrap_or_default();
    let (Some(server_ephemeral), Some(server_static_ciphertext), Some(certificate_ciphertext)) = (
        server_hello.ephemeral,
        server_hello.r#static,
        server_hello.payload,
    ) else {
        return Err(HandshakeError::MissingParts);
    };
    let server_ephemeral: [u8; 32] = server_ephemeral
        .try_into()
        .map_err(|_| HandshakeError::MissingParts)?;

    handshake.authenticate(&server_ephemeral);
    handshake.mix_shared_secret_into_key(ephemeral_key_pair.private, server_ephemeral)?;

    let static_decrypted = handshake
        .decrypt(&server_static_ciphertext)
        .map_err(HandshakeError::DecryptStatic)?;
    let static_decrypted: [u8; 32] = static_decrypted
        .try_into()
        .map_err(|wrong: Vec<u8>| HandshakeError::StaticLength(wrong.len()))?;
    handshake.mix_shared_secret_into_key(ephemeral_key_pair.private, static_decrypted)?;

    let certificate_decrypted = handshake
        .decrypt(&certificate_ciphertext)
        .map_err(HandshakeError::DecryptCertificate)?;
    verify_server_cert(&certificate_decrypted, &static_decrypted, signatures)?;

    let encrypted_public_key = handshake.encrypt(&noise_key.public)?;
    handshake.mix_shared_secret_into_key(noise_key.private, server_ephemeral)?;

    let encrypted_client_finish_payload = handshake.encrypt(&client_payload.encode_to_vec())?;
    let data = HandshakeMessage {
        client_finish: Some(handshake_message::ClientFinish {
            r#static: Some(encrypted_public_key),
            payload: Some(encrypted_client_finish_payload),
            ..Default::default()
        }),
        ..Default::default()
    }
    .encode_to_vec();
    frame_socket
        .send_frame(&data)
        .await
        .map_err(HandshakeError::Send)?;

    Ok(handshake.finish(frame_socket, frames)?)
}

/// Checks that `now` is within the certificate's validity.
fn check_cert_validity(details: &Details, now: DateTime<Utc>) -> Result<(), ValidityError> {
    let seconds = |value: Option<u64>| {
        DateTime::from_timestamp(
            i64::try_from(value.unwrap_or_default()).unwrap_or(i64::MAX),
            0,
        )
        .unwrap_or(DateTime::<Utc>::MAX_UTC)
    };
    let not_before = seconds(details.not_before);
    let not_after = seconds(details.not_after);
    if now < not_before {
        return Err(ValidityError::NotYetValid { now, not_before });
    }
    if now > not_after {
        return Err(ValidityError::Expired { now, not_after });
    }
    Ok(())
}

/// Verifies the server's certificate chain: WhatsApp's root key signs the
/// intermediate, the intermediate signs the leaf, and the leaf key is the
/// static key the server used in the handshake.
pub fn verify_server_cert(
    certificate_decrypted: &[u8],
    static_decrypted: &[u8; 32],
    signatures: &dyn CurveSignatures,
) -> Result<(), CertificateError> {
    verify_server_cert_at(
        certificate_decrypted,
        static_decrypted,
        signatures,
        Utc::now(),
    )
}

fn verify_server_cert_at(
    certificate_decrypted: &[u8],
    static_decrypted: &[u8; 32],
    signatures: &dyn CurveSignatures,
    now: DateTime<Utc>,
) -> Result<(), CertificateError> {
    let certificate_chain =
        CertChain::decode(certificate_decrypted).map_err(CertificateError::Unmarshal)?;
    let intermediate = certificate_chain.intermediate.unwrap_or_default();
    let leaf = certificate_chain.leaf.unwrap_or_default();
    let (
        Some(intermediate_details_raw),
        Some(intermediate_signature),
        Some(leaf_details_raw),
        Some(leaf_signature),
    ) = (
        intermediate.details,
        intermediate.signature,
        leaf.details,
        leaf.signature,
    )
    else {
        return Err(CertificateError::MissingParts);
    };
    let intermediate_signature: [u8; 64] = intermediate_signature
        .try_into()
        .map_err(|wrong: Vec<u8>| CertificateError::IntermediateSignatureLength(wrong.len()))?;
    let leaf_signature: [u8; 64] = leaf_signature
        .try_into()
        .map_err(|wrong: Vec<u8>| CertificateError::LeafSignatureLength(wrong.len()))?;

    if !signatures.verify_signature(
        &WA_CERT_PUB_KEY,
        &intermediate_details_raw,
        &intermediate_signature,
    ) {
        return Err(CertificateError::IntermediateSignature);
    }
    let intermediate_details = Details::decode(intermediate_details_raw.as_slice())
        .map_err(CertificateError::Unmarshal)?;
    let intermediate_issuer = intermediate_details.issuer_serial.unwrap_or_default();
    if intermediate_issuer != WA_CERT_ISSUER_SERIAL {
        return Err(CertificateError::IntermediateIssuer(intermediate_issuer));
    }
    let intermediate_key = intermediate_details.key.clone().unwrap_or_default();
    let intermediate_key: [u8; 32] = intermediate_key
        .try_into()
        .map_err(|wrong: Vec<u8>| CertificateError::IntermediateKeyLength(wrong.len()))?;
    if !signatures.verify_signature(&intermediate_key, &leaf_details_raw, &leaf_signature) {
        return Err(CertificateError::LeafSignature);
    }
    check_cert_validity(&intermediate_details, now).map_err(|reason| {
        CertificateError::Validity {
            which: "intermediate",
            reason,
        }
    })?;

    let leaf_details =
        Details::decode(leaf_details_raw.as_slice()).map_err(CertificateError::Unmarshal)?;
    let expected_issuer = intermediate_details.serial.unwrap_or_default();
    let leaf_issuer = leaf_details.issuer_serial.unwrap_or_default();
    if leaf_issuer != expected_issuer {
        return Err(CertificateError::LeafIssuer {
            got: leaf_issuer,
            expected: expected_issuer,
        });
    }
    let leaf_key = leaf_details.key.clone().unwrap_or_default();
    if !constant_time_eq::constant_time_eq(&leaf_key, static_decrypted) {
        return Err(CertificateError::KeyMismatch);
    }
    check_cert_validity(&leaf_details, now).map_err(|reason| CertificateError::Validity {
        which: "leaf",
        reason,
    })
}

#[cfg(test)]
mod test;
