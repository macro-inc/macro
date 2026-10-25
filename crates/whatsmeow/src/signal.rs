// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! The boundary to the Signal protocol.
//!
//! whatsmeow delegates the Signal protocol to `go.mau.fi/libsignal`, which is
//! GPL-3.0. This module is not a port of anything: it names the libsignal
//! types and operations whatsmeow uses, as seen from whatsmeow's own call
//! sites, so the rest of the port can be written against them. No
//! implementation ships with the crate; see `AGENTS.md` for the pending
//! licensing decision.
//!
//! Session and sender key records are opaque bytes here: whatsmeow only ever
//! stores them, so their format belongs to whichever implementation is chosen.

use std::fmt;

use async_trait::async_trait;

use crate::store::StoreError;

/// The address of one device's Signal session: a name (the JID user, plus the
/// domain type for non-default domains) and a device number.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SignalAddress {
    /// The user part, e.g. `12345` or `12345_1` for a LID.
    pub name: String,
    /// The device number.
    pub device_id: u32,
}

impl SignalAddress {
    /// Creates a new address.
    pub fn new(name: String, device_id: u32) -> Self {
        Self { name, device_id }
    }
}

/// `name:device`, the form whatsmeow uses as the key of sessions and
/// identities in its stores (its SQL matches them with `LIKE user || ':%'`).
impl fmt::Display for SignalAddress {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}:{}", self.name, self.device_id)
    }
}

/// The key type byte libsignal prefixes Curve25519 public keys with
/// (`ecc.DjbType`).
pub const DJB_TYPE: u8 = 5;

/// Curve25519 signatures (XEdDSA): libsignal's `ecc.CalculateSignature` and
/// `ecc.VerifySignature`. whatsmeow uses them to sign prekeys and pairing
/// messages and to verify the server's noise certificate.
pub trait CurveSignatures: Send + Sync {
    /// Signs `message` with a Curve25519 private key.
    fn calculate_signature(&self, private_key: &[u8; 32], message: &[u8]) -> [u8; 64];

    /// Whether `signature` is a valid signature of `message` by a Curve25519
    /// public key.
    fn verify_signature(&self, public_key: &[u8; 32], message: &[u8], signature: &[u8; 64])
    -> bool;
}

/// A sender's sender key in a group: libsignal's `protocol.SenderKeyName`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct SenderKeyName {
    /// The group JID as a string.
    pub group_id: String,
    /// The sending device.
    pub sender: SignalAddress,
}

/// Another device's keys for starting a session: libsignal's `prekey.Bundle`,
/// as whatsmeow builds it from a prekey response.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreKeyBundle {
    /// The device's registration ID.
    pub registration_id: u32,
    /// The device number.
    pub device_id: u32,
    /// The one-time prekey, if the server had one left.
    pub pre_key: Option<(u32, [u8; 32])>,
    /// The signed prekey ID.
    pub signed_pre_key_id: u32,
    /// The signed prekey.
    pub signed_pre_key_public: [u8; 32],
    /// The identity key's signature of the signed prekey.
    pub signed_pre_key_signature: [u8; 64],
    /// The identity key.
    pub identity_key: [u8; 32],
}

/// The two kinds of one-to-one ciphertext.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CiphertextType {
    /// A message that also sets up the session (`pkmsg`).
    PreKey,
    /// A message in an established session (`msg`).
    Whisper,
}

/// An encrypted one-to-one message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CiphertextMessage {
    /// Which kind of message it is.
    pub kind: CiphertextType,
    /// The serialized message.
    pub serialized: Vec<u8>,
}

/// Signal protocol failures whatsmeow distinguishes.
#[derive(Debug, thiserror::Error)]
pub enum SignalError {
    /// The peer's identity key changed (`signalerror.ErrUntrustedIdentity`).
    #[error("untrusted identity")]
    UntrustedIdentity,
    /// The message was already decrypted (`signalerror.ErrOldCounter`).
    #[error("old counter")]
    OldCounter,
    /// There is no sender key for the sender (`signalerror.ErrNoSenderKeyForUser`).
    #[error("no sender key for user")]
    NoSenderKeyForUser,
    /// The store failed.
    #[error(transparent)]
    Store(#[from] StoreError),
    /// Any other protocol failure.
    #[error("signal protocol error: {0:?}")]
    Internal(rootcause::Report),
}

/// The storage libsignal reads and writes while encrypting and decrypting:
/// the methods whatsmeow's `store.Device` implements in `store/signal.go`.
///
/// Object safe (`&dyn SignalProtocolStore`), hence `async_trait`.
#[async_trait]
pub trait SignalProtocolStore: Send + Sync {
    /// The local identity keypair as (public, private).
    fn get_identity_key_pair(&self) -> ([u8; 32], [u8; 32]);
    /// The local registration ID.
    fn get_local_registration_id(&self) -> u32;
    /// Remembers a peer's identity key.
    async fn save_identity(
        &self,
        address: &SignalAddress,
        identity_key: [u8; 32],
    ) -> Result<(), StoreError>;
    /// Whether a peer's identity key is the trusted one.
    async fn is_trusted_identity(
        &self,
        address: &SignalAddress,
        identity_key: [u8; 32],
    ) -> Result<bool, StoreError>;
    /// A one-time prekey as (public, private).
    async fn load_pre_key(&self, id: u32) -> Result<Option<([u8; 32], [u8; 32])>, StoreError>;
    /// Removes a used one-time prekey.
    async fn remove_pre_key(&self, id: u32) -> Result<(), StoreError>;
    /// The serialized session record, or `None` for a new session.
    async fn load_session(&self, address: &SignalAddress) -> Result<Option<Vec<u8>>, StoreError>;
    /// Stores a serialized session record.
    async fn store_session(
        &self,
        address: &SignalAddress,
        record: Vec<u8>,
    ) -> Result<(), StoreError>;
    /// Whether there is a session with the address.
    async fn contains_session(&self, address: &SignalAddress) -> Result<bool, StoreError>;
    /// The signed prekey as (public, private, signature), if the ID matches.
    fn load_signed_pre_key(&self, id: u32) -> Option<([u8; 32], [u8; 32], [u8; 64])>;
    /// Stores a serialized sender key record.
    async fn store_sender_key(
        &self,
        name: &SenderKeyName,
        record: Vec<u8>,
    ) -> Result<(), StoreError>;
    /// The serialized sender key record, or `None` for a new one.
    async fn load_sender_key(&self, name: &SenderKeyName) -> Result<Option<Vec<u8>>, StoreError>;
}

/// The Signal protocol operations whatsmeow runs: libsignal's session builder
/// and cipher, and group session builder and cipher.
///
/// Object safe so a client can hold `Arc<dyn SignalProtocol>`, hence
/// `async_trait`.
#[async_trait]
pub trait SignalProtocol: Send + Sync {
    /// Starts a session from another device's prekey bundle
    /// (`session.Builder.ProcessBundle`).
    async fn process_bundle(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        bundle: &PreKeyBundle,
    ) -> Result<(), SignalError>;

    /// Encrypts a padded plaintext for a device (`session.Cipher.Encrypt`).
    async fn encrypt(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        plaintext: &[u8],
    ) -> Result<CiphertextMessage, SignalError>;

    /// Decrypts a `pkmsg`, setting up the session
    /// (`session.Cipher.DecryptMessage` of a `PreKeySignalMessage`).
    async fn decrypt_pre_key_message(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, SignalError>;

    /// Decrypts a `msg` in an established session
    /// (`session.Cipher.Decrypt` of a `SignalMessage`).
    async fn decrypt_message(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, SignalError>;

    /// Creates (or reuses) the local sender key for a group and returns the
    /// serialized distribution message (`groups.SessionBuilder.Create`).
    async fn create_sender_key_distribution_message(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
    ) -> Result<Vec<u8>, SignalError>;

    /// Stores another device's sender key from its serialized distribution
    /// message (`groups.SessionBuilder.Process`).
    async fn process_sender_key_distribution_message(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
        message: &[u8],
    ) -> Result<(), SignalError>;

    /// Encrypts a padded plaintext for a group (`groups.GroupCipher.Encrypt`).
    async fn group_encrypt(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, SignalError>;

    /// Decrypts a `skmsg` (`groups.GroupCipher.Decrypt`).
    async fn group_decrypt(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, SignalError>;
}
