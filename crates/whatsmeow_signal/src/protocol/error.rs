//
// Copyright 2020-2021 Signal Messenger, LLC.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Vendored from libsignal v0.74.1 rust/protocol/src/error.rs and modified by
// Macro: variants for features WhatsApp doesn't use (Kyber, sealed sender,
// fingerprints, FFI) are gone, and addresses are kept out of the messages so
// errors can be logged without leaking phone numbers. See NOTICE.

use libsignal_core::curve::{CurveError, KeyType};
use whatsmeow::store::StoreError;

use super::messages::CiphertextMessageType;

pub(crate) type Result<T> = std::result::Result<T, SignalProtocolError>;

#[derive(Debug, thiserror::Error)]
pub(crate) enum SignalProtocolError {
    #[error("invalid argument: {0}")]
    InvalidArgument(String),
    #[error("invalid state for call to {0} to succeed: {1}")]
    InvalidState(&'static str, String),

    #[error("protobuf encoding was invalid")]
    InvalidProtobufEncoding,

    #[error("ciphertext serialized bytes were too short <{0}>")]
    CiphertextMessageTooShort(usize),
    #[error("ciphertext version was too old <{0}>")]
    LegacyCiphertextVersion(u8),
    #[error("ciphertext version was unrecognized <{0}>")]
    UnrecognizedCiphertextVersion(u8),
    #[error("unrecognized message version <{0}>")]
    UnrecognizedMessageVersion(u32),

    #[error("no key type identifier")]
    NoKeyTypeIdentifier,
    #[error("bad key type <{0:#04x}>")]
    BadKeyType(u8),
    #[error("bad key length <{1}> for key with type <{0}>")]
    BadKeyLength(KeyType, usize),
    #[error("invalid key agreement output (all-zero shared secret)")]
    InvalidKeyAgreement,

    #[error("invalid signature detected")]
    SignatureValidationFailed,

    #[error("untrusted identity")]
    UntrustedIdentity,

    #[error("invalid prekey identifier")]
    InvalidPreKeyId,
    #[error("invalid signed prekey identifier")]
    InvalidSignedPreKeyId,

    #[error("invalid MAC key length <{0}>")]
    InvalidMacKeyLength(usize),

    #[error("missing sender key state")]
    NoSenderKeyState,

    #[error("session not found")]
    SessionNotFound,
    #[error("invalid session: {0}")]
    InvalidSessionStructure(&'static str),
    #[error("invalid sender key session")]
    InvalidSenderKeySession,

    #[error("message with old counter {0} / {1}")]
    DuplicatedMessage(u32, u32),
    #[error("invalid {0:?} message: {1}")]
    InvalidMessage(CiphertextMessageType, &'static str),

    #[error(transparent)]
    Store(#[from] StoreError),
}

impl From<CurveError> for SignalProtocolError {
    fn from(error: CurveError) -> Self {
        match error {
            CurveError::NoKeyTypeIdentifier => Self::NoKeyTypeIdentifier,
            CurveError::BadKeyType(raw) => Self::BadKeyType(raw),
            CurveError::BadKeyLength(key_type, len) => Self::BadKeyLength(key_type, len),
            CurveError::InvalidKeyAgreement => Self::InvalidKeyAgreement,
        }
    }
}
