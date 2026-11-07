//
// Copyright 2020-2021 Signal Messenger, LLC.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Vendored from libsignal v0.74.1 rust/protocol/src/protocol.rs and modified
// by Macro for WhatsApp's wire format (see NOTICE):
// - the version byte is `0x33` (version 3 in both nibbles), as WhatsApp and
//   go.mau.fi/libsignal write it; libsignal writes its current version (4) in
//   the low nibble, which breaks the MAC whatsmeow recomputes;
// - no Kyber payload and no post-quantum ratchet field;
// - sender key messages carry a 32-bit key ID instead of a distribution UUID
//   and chain ID;
// - a pre-key ID of 0 means "no one-time pre-key", as in go.mau.fi/libsignal;
// - the decryption-error and plaintext content types are gone.

use hmac::{Hmac, Mac};
use libsignal_core::curve::{PrivateKey, PublicKey};
use prost::Message;
use rand::{CryptoRng, Rng};
use sha2::Sha256;
use subtle::ConstantTimeEq;

use super::error::{Result, SignalProtocolError};
use super::proto;

/// The only Double Ratchet message version WhatsApp speaks (X3DH, no Kyber).
pub(crate) const CIPHERTEXT_MESSAGE_CURRENT_VERSION: u8 = 3;
pub(crate) const SENDERKEY_MESSAGE_CURRENT_VERSION: u8 = 3;

fn version_byte(message_version: u8, current_version: u8) -> u8 {
    ((message_version & 0xF) << 4) | current_version
}

#[derive(Debug)]
pub(crate) enum CiphertextMessage {
    SignalMessage(SignalMessage),
    PreKeySignalMessage(PreKeySignalMessage),
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum CiphertextMessageType {
    Whisper,
    PreKey,
    SenderKey,
}

#[derive(Debug, Clone)]
pub(crate) struct SignalMessage {
    message_version: u8,
    sender_ratchet_key: PublicKey,
    counter: u32,
    ciphertext: Box<[u8]>,
    serialized: Box<[u8]>,
}

impl SignalMessage {
    const MAC_LENGTH: usize = 8;

    #[expect(
        clippy::too_many_arguments,
        reason = "mirrors libsignal's constructor, which takes every field of the message"
    )]
    pub(crate) fn new(
        message_version: u8,
        mac_key: &[u8],
        sender_ratchet_key: PublicKey,
        counter: u32,
        previous_counter: u32,
        ciphertext: &[u8],
        sender_identity_key: &PublicKey,
        receiver_identity_key: &PublicKey,
    ) -> Result<Self> {
        let message = proto::wire::SignalMessage {
            ratchet_key: Some(sender_ratchet_key.serialize().into_vec()),
            counter: Some(counter),
            previous_counter: Some(previous_counter),
            ciphertext: Some(Vec::<u8>::from(ciphertext)),
        };
        let mut serialized = Vec::with_capacity(1 + message.encoded_len() + Self::MAC_LENGTH);
        serialized.push(version_byte(
            message_version,
            CIPHERTEXT_MESSAGE_CURRENT_VERSION,
        ));
        message
            .encode(&mut serialized)
            .expect("can always append to a buffer");
        let mac = Self::compute_mac(
            sender_identity_key,
            receiver_identity_key,
            mac_key,
            &serialized,
        )?;
        serialized.extend_from_slice(&mac);
        Ok(Self {
            message_version,
            sender_ratchet_key,
            counter,
            ciphertext: ciphertext.into(),
            serialized: serialized.into_boxed_slice(),
        })
    }

    pub(crate) fn message_version(&self) -> u8 {
        self.message_version
    }

    pub(crate) fn sender_ratchet_key(&self) -> &PublicKey {
        &self.sender_ratchet_key
    }

    pub(crate) fn counter(&self) -> u32 {
        self.counter
    }

    pub(crate) fn serialized(&self) -> &[u8] {
        &self.serialized
    }

    pub(crate) fn body(&self) -> &[u8] {
        &self.ciphertext
    }

    pub(crate) fn verify_mac(
        &self,
        sender_identity_key: &PublicKey,
        receiver_identity_key: &PublicKey,
        mac_key: &[u8],
    ) -> Result<bool> {
        let our_mac = &Self::compute_mac(
            sender_identity_key,
            receiver_identity_key,
            mac_key,
            &self.serialized[..self.serialized.len() - Self::MAC_LENGTH],
        )?;
        let their_mac = &self.serialized[self.serialized.len() - Self::MAC_LENGTH..];
        Ok(our_mac.ct_eq(their_mac).into())
    }

    fn compute_mac(
        sender_identity_key: &PublicKey,
        receiver_identity_key: &PublicKey,
        mac_key: &[u8],
        message: &[u8],
    ) -> Result<[u8; Self::MAC_LENGTH]> {
        if mac_key.len() != 32 {
            return Err(SignalProtocolError::InvalidMacKeyLength(mac_key.len()));
        }
        let mut mac = Hmac::<Sha256>::new_from_slice(mac_key)
            .expect("HMAC-SHA256 should accept any size key");

        mac.update(sender_identity_key.serialize().as_ref());
        mac.update(receiver_identity_key.serialize().as_ref());
        mac.update(message);
        let mut result = [0u8; Self::MAC_LENGTH];
        result.copy_from_slice(&mac.finalize().into_bytes()[..Self::MAC_LENGTH]);
        Ok(result)
    }
}

impl AsRef<[u8]> for SignalMessage {
    fn as_ref(&self) -> &[u8] {
        &self.serialized
    }
}

impl TryFrom<&[u8]> for SignalMessage {
    type Error = SignalProtocolError;

    fn try_from(value: &[u8]) -> Result<Self> {
        if value.len() < SignalMessage::MAC_LENGTH + 1 {
            return Err(SignalProtocolError::CiphertextMessageTooShort(value.len()));
        }
        let message_version = value[0] >> 4;
        if message_version < CIPHERTEXT_MESSAGE_CURRENT_VERSION {
            return Err(SignalProtocolError::LegacyCiphertextVersion(
                message_version,
            ));
        }
        if message_version > CIPHERTEXT_MESSAGE_CURRENT_VERSION {
            return Err(SignalProtocolError::UnrecognizedCiphertextVersion(
                message_version,
            ));
        }

        let proto_structure =
            proto::wire::SignalMessage::decode(&value[1..value.len() - SignalMessage::MAC_LENGTH])
                .map_err(|_| SignalProtocolError::InvalidProtobufEncoding)?;

        let sender_ratchet_key = proto_structure
            .ratchet_key
            .ok_or(SignalProtocolError::InvalidProtobufEncoding)?;
        let sender_ratchet_key = PublicKey::deserialize(&sender_ratchet_key)?;
        let counter = proto_structure
            .counter
            .ok_or(SignalProtocolError::InvalidProtobufEncoding)?;
        let ciphertext = proto_structure
            .ciphertext
            .ok_or(SignalProtocolError::InvalidProtobufEncoding)?
            .into_boxed_slice();

        Ok(SignalMessage {
            message_version,
            sender_ratchet_key,
            counter,
            ciphertext,
            serialized: Box::from(value),
        })
    }
}

#[derive(Debug, Clone)]
pub(crate) struct PreKeySignalMessage {
    message_version: u8,
    registration_id: u32,
    pre_key_id: Option<u32>,
    signed_pre_key_id: u32,
    base_key: PublicKey,
    identity_key: PublicKey,
    message: SignalMessage,
    serialized: Box<[u8]>,
}

impl PreKeySignalMessage {
    pub(crate) fn new(
        message_version: u8,
        registration_id: u32,
        pre_key_id: Option<u32>,
        signed_pre_key_id: u32,
        base_key: PublicKey,
        identity_key: PublicKey,
        message: SignalMessage,
    ) -> Self {
        let proto_message = proto::wire::PreKeySignalMessage {
            registration_id: Some(registration_id),
            pre_key_id,
            signed_pre_key_id: Some(signed_pre_key_id),
            base_key: Some(base_key.serialize().into_vec()),
            identity_key: Some(identity_key.serialize().into_vec()),
            message: Some(Vec::from(message.as_ref())),
        };
        let mut serialized = Vec::with_capacity(1 + proto_message.encoded_len());
        serialized.push(version_byte(
            message_version,
            CIPHERTEXT_MESSAGE_CURRENT_VERSION,
        ));
        proto_message
            .encode(&mut serialized)
            .expect("can always append to a Vec");
        Self {
            message_version,
            registration_id,
            pre_key_id,
            signed_pre_key_id,
            base_key,
            identity_key,
            message,
            serialized: serialized.into_boxed_slice(),
        }
    }

    pub(crate) fn message_version(&self) -> u8 {
        self.message_version
    }

    pub(crate) fn registration_id(&self) -> u32 {
        self.registration_id
    }

    pub(crate) fn pre_key_id(&self) -> Option<u32> {
        self.pre_key_id
    }

    pub(crate) fn signed_pre_key_id(&self) -> u32 {
        self.signed_pre_key_id
    }

    pub(crate) fn base_key(&self) -> &PublicKey {
        &self.base_key
    }

    pub(crate) fn identity_key(&self) -> &PublicKey {
        &self.identity_key
    }

    pub(crate) fn message(&self) -> &SignalMessage {
        &self.message
    }

    pub(crate) fn serialized(&self) -> &[u8] {
        &self.serialized
    }
}

impl TryFrom<&[u8]> for PreKeySignalMessage {
    type Error = SignalProtocolError;

    fn try_from(value: &[u8]) -> Result<Self> {
        if value.is_empty() {
            return Err(SignalProtocolError::CiphertextMessageTooShort(value.len()));
        }

        let message_version = value[0] >> 4;
        if message_version < CIPHERTEXT_MESSAGE_CURRENT_VERSION {
            return Err(SignalProtocolError::LegacyCiphertextVersion(
                message_version,
            ));
        }
        if message_version > CIPHERTEXT_MESSAGE_CURRENT_VERSION {
            return Err(SignalProtocolError::UnrecognizedCiphertextVersion(
                message_version,
            ));
        }

        let proto_structure = proto::wire::PreKeySignalMessage::decode(&value[1..])
            .map_err(|_| SignalProtocolError::InvalidProtobufEncoding)?;

        let base_key = proto_structure
            .base_key
            .ok_or(SignalProtocolError::InvalidProtobufEncoding)?;
        let identity_key = proto_structure
            .identity_key
            .ok_or(SignalProtocolError::InvalidProtobufEncoding)?;
        let message = proto_structure
            .message
            .ok_or(SignalProtocolError::InvalidProtobufEncoding)?;
        let signed_pre_key_id = proto_structure
            .signed_pre_key_id
            .ok_or(SignalProtocolError::InvalidProtobufEncoding)?;

        Ok(PreKeySignalMessage {
            message_version,
            registration_id: proto_structure.registration_id.unwrap_or(0),
            pre_key_id: proto_structure.pre_key_id.filter(|id| *id != 0),
            signed_pre_key_id,
            base_key: PublicKey::deserialize(&base_key)?,
            identity_key: PublicKey::deserialize(&identity_key)?,
            message: SignalMessage::try_from(message.as_ref())?,
            serialized: Box::from(value),
        })
    }
}

#[derive(Debug, Clone)]
pub(crate) struct SenderKeyMessage {
    message_version: u8,
    key_id: u32,
    iteration: u32,
    ciphertext: Box<[u8]>,
    serialized: Box<[u8]>,
}

impl SenderKeyMessage {
    const SIGNATURE_LEN: usize = 64;

    pub(crate) fn new<R: CryptoRng + Rng>(
        message_version: u8,
        key_id: u32,
        iteration: u32,
        ciphertext: Box<[u8]>,
        csprng: &mut R,
        signature_key: &PrivateKey,
    ) -> Result<Self> {
        let proto_message = proto::wire::SenderKeyMessage {
            id: Some(key_id),
            iteration: Some(iteration),
            ciphertext: Some(ciphertext.to_vec()),
        };
        let proto_message_len = proto_message.encoded_len();
        let mut serialized = Vec::with_capacity(1 + proto_message_len + Self::SIGNATURE_LEN);
        serialized.push(version_byte(
            message_version,
            SENDERKEY_MESSAGE_CURRENT_VERSION,
        ));
        proto_message
            .encode(&mut serialized)
            .expect("can always append to a buffer");
        let signature = signature_key.calculate_signature(&serialized, csprng)?;
        serialized.extend_from_slice(&signature[..]);
        Ok(Self {
            message_version: SENDERKEY_MESSAGE_CURRENT_VERSION,
            key_id,
            iteration,
            ciphertext,
            serialized: serialized.into_boxed_slice(),
        })
    }

    pub(crate) fn verify_signature(&self, signature_key: &PublicKey) -> bool {
        signature_key.verify_signature(
            &self.serialized[..self.serialized.len() - Self::SIGNATURE_LEN],
            &self.serialized[self.serialized.len() - Self::SIGNATURE_LEN..],
        )
    }

    pub(crate) fn message_version(&self) -> u8 {
        self.message_version
    }

    pub(crate) fn key_id(&self) -> u32 {
        self.key_id
    }

    pub(crate) fn iteration(&self) -> u32 {
        self.iteration
    }

    pub(crate) fn ciphertext(&self) -> &[u8] {
        &self.ciphertext
    }

    pub(crate) fn serialized(&self) -> &[u8] {
        &self.serialized
    }
}

impl TryFrom<&[u8]> for SenderKeyMessage {
    type Error = SignalProtocolError;

    fn try_from(value: &[u8]) -> Result<Self> {
        if value.len() < 1 + Self::SIGNATURE_LEN {
            return Err(SignalProtocolError::CiphertextMessageTooShort(value.len()));
        }
        let message_version = value[0] >> 4;
        if message_version < SENDERKEY_MESSAGE_CURRENT_VERSION {
            return Err(SignalProtocolError::LegacyCiphertextVersion(
                message_version,
            ));
        }
        if message_version > SENDERKEY_MESSAGE_CURRENT_VERSION {
            return Err(SignalProtocolError::UnrecognizedCiphertextVersion(
                message_version,
            ));
        }
        let proto_structure =
            proto::wire::SenderKeyMessage::decode(&value[1..value.len() - Self::SIGNATURE_LEN])
                .map_err(|_| SignalProtocolError::InvalidProtobufEncoding)?;

        let key_id = proto_structure
            .id
            .ok_or(SignalProtocolError::InvalidProtobufEncoding)?;
        let iteration = proto_structure
            .iteration
            .ok_or(SignalProtocolError::InvalidProtobufEncoding)?;
        let ciphertext = proto_structure
            .ciphertext
            .ok_or(SignalProtocolError::InvalidProtobufEncoding)?
            .into_boxed_slice();

        Ok(SenderKeyMessage {
            message_version,
            key_id,
            iteration,
            ciphertext,
            serialized: Box::from(value),
        })
    }
}

#[derive(Debug, Clone)]
pub(crate) struct SenderKeyDistributionMessage {
    key_id: u32,
    iteration: u32,
    chain_key: Vec<u8>,
    signing_key: PublicKey,
    serialized: Box<[u8]>,
}

impl SenderKeyDistributionMessage {
    pub(crate) fn new(
        message_version: u8,
        key_id: u32,
        iteration: u32,
        chain_key: Vec<u8>,
        signing_key: PublicKey,
    ) -> Self {
        let proto_message = proto::wire::SenderKeyDistributionMessage {
            id: Some(key_id),
            iteration: Some(iteration),
            chain_key: Some(chain_key.clone()),
            signing_key: Some(signing_key.serialize().to_vec()),
        };
        let mut serialized = Vec::with_capacity(1 + proto_message.encoded_len());
        serialized.push(version_byte(
            message_version,
            SENDERKEY_MESSAGE_CURRENT_VERSION,
        ));
        proto_message
            .encode(&mut serialized)
            .expect("can always append to a buffer");

        Self {
            key_id,
            iteration,
            chain_key,
            signing_key,
            serialized: serialized.into_boxed_slice(),
        }
    }

    pub(crate) fn key_id(&self) -> u32 {
        self.key_id
    }

    pub(crate) fn iteration(&self) -> u32 {
        self.iteration
    }

    pub(crate) fn chain_key(&self) -> &[u8] {
        &self.chain_key
    }

    pub(crate) fn signing_key(&self) -> &PublicKey {
        &self.signing_key
    }

    pub(crate) fn serialized(&self) -> &[u8] {
        &self.serialized
    }
}

impl TryFrom<&[u8]> for SenderKeyDistributionMessage {
    type Error = SignalProtocolError;

    fn try_from(value: &[u8]) -> Result<Self> {
        // The message contains at least a X25519 key and a chain key
        if value.len() < 1 + 32 + 32 {
            return Err(SignalProtocolError::CiphertextMessageTooShort(value.len()));
        }

        let message_version = value[0] >> 4;

        if message_version < SENDERKEY_MESSAGE_CURRENT_VERSION {
            return Err(SignalProtocolError::LegacyCiphertextVersion(
                message_version,
            ));
        }
        if message_version > SENDERKEY_MESSAGE_CURRENT_VERSION {
            return Err(SignalProtocolError::UnrecognizedCiphertextVersion(
                message_version,
            ));
        }

        let proto_structure = proto::wire::SenderKeyDistributionMessage::decode(&value[1..])
            .map_err(|_| SignalProtocolError::InvalidProtobufEncoding)?;

        let key_id = proto_structure
            .id
            .ok_or(SignalProtocolError::InvalidProtobufEncoding)?;
        let iteration = proto_structure
            .iteration
            .ok_or(SignalProtocolError::InvalidProtobufEncoding)?;
        let chain_key = proto_structure
            .chain_key
            .ok_or(SignalProtocolError::InvalidProtobufEncoding)?;
        let signing_key = proto_structure
            .signing_key
            .ok_or(SignalProtocolError::InvalidProtobufEncoding)?;

        if chain_key.len() != 32 || signing_key.len() != 33 {
            return Err(SignalProtocolError::InvalidProtobufEncoding);
        }

        let signing_key = PublicKey::deserialize(&signing_key)?;

        Ok(SenderKeyDistributionMessage {
            key_id,
            iteration,
            chain_key,
            signing_key,
            serialized: Box::from(value),
        })
    }
}
