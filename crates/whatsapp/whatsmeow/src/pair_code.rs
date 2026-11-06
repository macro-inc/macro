// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow pair-code.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// The randomness of `generateCompanionEphemeralKey` and the notification
// handler is passed in by the `_with` functions so tests can compare with Go.
// PBKDF2-HMAC-SHA256, AES-CTR and the linking base32 alphabet are small local
// helpers (Go uses `x/crypto/pbkdf2`, `crypto/cipher` and `encoding/base32`).

//! Pairing by phone number link code.

use std::sync::Arc;

use aes::Aes256;
use aes::cipher::{BlockEncrypt, KeyInit};
use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::binary::{Attrs, Node, NodeContent};
use crate::client::{Client, lock};
use crate::errors::{ClientError, element_missing};
use crate::request::{InfoQuery, IqType};
use crate::types::{DEFAULT_USER_SERVER, Jid, SERVER_JID, new_jid};
use crate::util::gcmutil;
use crate::util::hkdfutil;
use crate::util::keys::{KeyPair, new_key_pair};

/// The alphabet of pairing codes (Crockford-like, without 0, I, O, U).
pub const LINKING_BASE32_ALPHABET: &[u8; 32] = b"123456789ABCDEFGHJKLMNPQRSTVWXYZ";
/// PBKDF2 iterations for the link code key (Go's `2<<16`).
const LINK_CODE_PBKDF2_ROUNDS: u32 = 2 << 16;

/// The type of client shown on the phone when pairing, the last field of the
/// QR code.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::Display, strum::EnumString, strum::AsRefStr)]
pub enum PairClientType {
    /// An unknown client.
    #[strum(serialize = "0")]
    Unknown,
    /// Chrome.
    #[strum(serialize = "1")]
    Chrome,
    /// Edge.
    #[strum(serialize = "2")]
    Edge,
    /// Firefox.
    #[strum(serialize = "3")]
    Firefox,
    /// Internet Explorer.
    #[strum(serialize = "4")]
    Ie,
    /// Opera.
    #[strum(serialize = "5")]
    Opera,
    /// Safari.
    #[strum(serialize = "6")]
    Safari,
    /// Electron.
    #[strum(serialize = "7")]
    Electron,
    /// The Windows app.
    #[strum(serialize = "8")]
    Uwp,
    /// Another web client.
    #[strum(serialize = "9")]
    OtherWebClient,
    /// The macOS app.
    #[strum(serialize = "c")]
    MacOs,
    /// Android.
    #[strum(serialize = "e")]
    Android,
}

/// Base32 with the linking alphabet, without padding.
pub fn linking_base32(data: &[u8]) -> String {
    let mut output = String::new();
    let mut buffer: u32 = 0;
    let mut bits = 0;
    for &byte in data {
        buffer = (buffer << 8) | u32::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            output.push(char::from(
                LINKING_BASE32_ALPHABET[((buffer >> bits) & 31) as usize],
            ));
        }
    }
    if bits > 0 {
        output.push(char::from(
            LINKING_BASE32_ALPHABET[((buffer << (5 - bits)) & 31) as usize],
        ));
    }
    output
}

/// PBKDF2-HMAC-SHA256 with a 32-byte output.
pub(crate) fn pbkdf2_sha256(password: &[u8], salt: &[u8], rounds: u32) -> [u8; 32] {
    let mac = <Hmac<Sha256> as Mac>::new_from_slice(password).unwrap_or_else(|_| {
        // HMAC accepts keys of any length.
        <Hmac<Sha256> as Mac>::new_from_slice(&[]).unwrap_or_else(|_| unreachable!())
    });
    let mut first = mac.clone();
    first.update(salt);
    first.update(&1_u32.to_be_bytes());
    let mut block: [u8; 32] = first.finalize().into_bytes().into();
    let mut output = block;
    for _ in 1..rounds {
        let mut next = mac.clone();
        next.update(&block);
        block = next.finalize().into_bytes().into();
        for (out, byte) in output.iter_mut().zip(block) {
            *out ^= byte;
        }
    }
    output
}

/// AES-256-CTR with a 128-bit big-endian counter starting at `iv`, as Go's
/// `cipher.NewCTR`.
pub(crate) fn aes_ctr(key: &[u8; 32], iv: &[u8; 16], data: &[u8]) -> Vec<u8> {
    let cipher = Aes256::new(key.into());
    let mut counter = u128::from_be_bytes(*iv);
    let mut output = Vec::with_capacity(data.len());
    for chunk in data.chunks(16) {
        let mut block = counter.to_be_bytes().into();
        cipher.encrypt_block(&mut block);
        output.extend(chunk.iter().zip(block.iter()).map(|(byte, key)| byte ^ key));
        counter = counter.wrapping_add(1);
    }
    output
}

fn link_code_key(linking_code: &str, salt: &[u8]) -> [u8; 32] {
    pbkdf2_sha256(linking_code.as_bytes(), salt, LINK_CODE_PBKDF2_ROUNDS)
}

/// The companion's ephemeral key for code pairing: the public key encrypted
/// with a key derived from the linking code, prefixed with the salt and IV
/// (80 bytes), and the encoded linking code. `generateCompanionEphemeralKey`
/// with its randomness passed in.
pub fn generate_companion_ephemeral_key_with(
    key_pair: &KeyPair,
    salt: &[u8; 32],
    iv: &[u8; 16],
    linking_code: &[u8; 5],
) -> (Vec<u8>, String) {
    let encoded_linking_code = linking_base32(linking_code);
    let key = link_code_key(&encoded_linking_code, salt);
    let encrypted_public = aes_ctr(&key, iv, &key_pair.public);
    let ephemeral_key = [&salt[..], &iv[..], &encrypted_public].concat();
    (ephemeral_key, encoded_linking_code)
}

/// The pending code pairing (`phoneLinkingCache`).
#[derive(Clone)]
pub(crate) struct PhoneLinkingCache {
    jid: Jid,
    key_pair: KeyPair,
    linking_code: String,
    pairing_ref: String,
}

/// The `companion_finish` key bundle and ADV secret of a code pairing,
/// computed from the primary device's wrapped ephemeral key and identity
/// (the crypto of `handleCodePairNotification`, with its randomness passed
/// in). Returns (wrapped key bundle, ADV secret).
#[expect(
    clippy::too_many_arguments,
    reason = "the inputs of Go's computation, made explicit"
)]
pub fn code_pair_key_bundle_with(
    linking_code: &str,
    ephemeral_key_pair: &KeyPair,
    identity_key_pair: &KeyPair,
    wrapped_primary_ephemeral_public: &[u8],
    primary_identity_public: &[u8],
    adv_secret_random: &[u8; 32],
    key_bundle_salt: &[u8; 32],
    key_bundle_nonce: &[u8; 12],
) -> Result<(Vec<u8>, Vec<u8>), ClientError> {
    if wrapped_primary_ephemeral_public.len() < 80 {
        return Err(ClientError::Other(format!(
            "unexpected length of link_code_pairing_wrapped_primary_ephemeral_pub: {}",
            wrapped_primary_ephemeral_public.len()
        )));
    }
    let primary_salt = &wrapped_primary_ephemeral_public[0..32];
    let primary_iv: [u8; 16] = wrapped_primary_ephemeral_public[32..48]
        .try_into()
        .map_err(|_| ClientError::Other("invalid primary IV".to_owned()))?;
    let primary_encrypted_public = &wrapped_primary_ephemeral_public[48..80];
    let key = link_code_key(linking_code, primary_salt);
    let primary_public: [u8; 32] = aes_ctr(&key, &primary_iv, primary_encrypted_public)
        .try_into()
        .map_err(|_| ClientError::Other("invalid primary ephemeral key".to_owned()))?;
    let ephemeral_shared_secret =
        x25519(ephemeral_key_pair.private, primary_public).map_err(|error| {
            ClientError::Other(format!(
                "failed to compute ephemeral shared secret: {error}"
            ))
        })?;

    let key_bundle_encryption_key = hkdfutil::sha256(
        &ephemeral_shared_secret,
        key_bundle_salt,
        b"link_code_pairing_key_bundle_encryption_key",
        32,
    );
    let plaintext_key_bundle = [
        &identity_key_pair.public[..],
        primary_identity_public,
        &adv_secret_random[..],
    ]
    .concat();
    let encrypted_key_bundle = gcmutil::encrypt(
        &key_bundle_encryption_key,
        key_bundle_nonce,
        &plaintext_key_bundle,
        &[],
    )
    .map_err(|error| ClientError::Other(format!("failed to encrypt key bundle: {error}")))?;
    let wrapped_key_bundle = [
        &key_bundle_salt[..],
        &key_bundle_nonce[..],
        &encrypted_key_bundle,
    ]
    .concat();

    let primary_identity: [u8; 32] = primary_identity_public.try_into().map_err(|_| {
        ClientError::Other(
            "failed to compute identity shared key: bad public key length".to_owned(),
        )
    })?;
    let identity_shared_key =
        x25519(identity_key_pair.private, primary_identity).map_err(|error| {
            ClientError::Other(format!("failed to compute identity shared key: {error}"))
        })?;
    let adv_secret_input = [
        &ephemeral_shared_secret[..],
        &identity_shared_key[..],
        &adv_secret_random[..],
    ]
    .concat();
    let adv_secret = hkdfutil::sha256(&adv_secret_input, &[], b"adv_secret", 32);
    Ok((wrapped_key_bundle, adv_secret))
}

/// X25519 that rejects low-order points like Go's `curve25519.X25519`.
fn x25519(private: [u8; 32], public: [u8; 32]) -> Result<[u8; 32], &'static str> {
    let shared = x25519_dalek::x25519(private, public);
    if shared == [0; 32] {
        return Err("bad input point: low order point");
    }
    Ok(shared)
}

fn bytes_node(tag: &str, content: Vec<u8>) -> Node {
    Node {
        tag: tag.to_owned(),
        attrs: Attrs::new(),
        content: Some(NodeContent::Bytes(content)),
    }
}

fn node_bytes<'node>(node: &'node Node, tag: &str) -> Option<&'node [u8]> {
    match &node.get_optional_child_by_tag(&[tag])?.content {
        Some(NodeContent::Bytes(bytes)) => Some(bytes),
        _ => None,
    }
}

impl Client {
    /// Starts pairing with a code the user types on their phone instead of
    /// scanning a QR code; returns the code as `ABCD-EFGH` (`PairPhone`).
    ///
    /// Connect first and wait for the first QR event. The display name must
    /// look like `Browser (OS)`.
    #[tracing::instrument(name = "whatsmeow.pair_phone", skip_all, err)]
    pub async fn pair_phone(
        &self,
        phone: &str,
        show_push_notification: bool,
        client_type: PairClientType,
        client_display_name: &str,
    ) -> Result<String, ClientError> {
        let key_pair = new_key_pair();
        let (ephemeral_key, encoded_linking_code) = generate_companion_ephemeral_key_with(
            &key_pair,
            &rand::random(),
            &rand::random(),
            &rand::random(),
        );
        let phone: String = phone.chars().filter(char::is_ascii_digit).collect();
        if phone.len() <= 6 {
            return Err(ClientError::PhoneNumberTooShort);
        } else if phone.starts_with('0') {
            return Err(ClientError::PhoneNumberIsNotInternational);
        }
        let jid = new_jid(&phone, DEFAULT_USER_SERVER);
        let noise_public = self.store.read().await.noise_key.public;
        let response = self
            .send_iq(InfoQuery {
                namespace: "md",
                r#type: IqType::Set,
                to: SERVER_JID.clone(),
                content: Some(NodeContent::Nodes(vec![Node {
                    tag: "link_code_companion_reg".to_owned(),
                    attrs: Attrs::from([
                        ("jid".to_owned(), jid.clone().into()),
                        ("stage".to_owned(), "companion_hello".into()),
                        (
                            "should_show_push_notification".to_owned(),
                            show_push_notification.into(),
                        ),
                    ]),
                    content: Some(NodeContent::Nodes(vec![
                        bytes_node(
                            "link_code_pairing_wrapped_companion_ephemeral_pub",
                            ephemeral_key,
                        ),
                        bytes_node("companion_server_auth_key_pub", noise_public.to_vec()),
                        Node {
                            tag: "companion_platform_id".to_owned(),
                            attrs: Attrs::new(),
                            content: Some(NodeContent::String(client_type.to_string())),
                        },
                        Node {
                            tag: "companion_platform_display".to_owned(),
                            attrs: Attrs::new(),
                            content: Some(NodeContent::String(client_display_name.to_owned())),
                        },
                        bytes_node("link_code_pairing_nonce", vec![0]),
                    ])),
                }])),
                ..Default::default()
            })
            .await?;
        let pairing_ref = response
            .get_optional_child_by_tag(&["link_code_companion_reg", "link_code_pairing_ref"])
            .ok_or_else(|| {
                element_missing("link_code_pairing_ref", "code link registration response")
            })?;
        let Some(NodeContent::Bytes(pairing_ref)) = &pairing_ref.content else {
            return Err(ClientError::Other(
                "unexpected type in content of link_code_pairing_ref tag".to_owned(),
            ));
        };
        *lock(&self.phone_linking_cache) = Some(PhoneLinkingCache {
            jid,
            key_pair,
            linking_code: encoded_linking_code.clone(),
            pairing_ref: String::from_utf8_lossy(pairing_ref).into_owned(),
        });
        Ok(format!(
            "{}-{}",
            &encoded_linking_code[..4],
            &encoded_linking_code[4..]
        ))
    }

    pub(crate) async fn try_handle_code_pair_notification(self: Arc<Self>, parent: Node) {
        if let Err(error) = self.handle_code_pair_notification(&parent).await {
            tracing::error!(error = %error, "failed to handle code pair notification");
        }
    }

    async fn handle_code_pair_notification(&self, parent: &Node) -> Result<(), ClientError> {
        let node = parent
            .get_optional_child_by_tag(&["link_code_companion_reg"])
            .ok_or_else(|| element_missing("link_code_companion_reg", "notification"))?;
        let link_cache = lock(&self.phone_linking_cache).clone().ok_or_else(|| {
            ClientError::Other(
                "received code pair notification without a pending pairing".to_owned(),
            )
        })?;
        self.paired
            .store(false, std::sync::atomic::Ordering::SeqCst);
        let pairing_ref = node_bytes(node, "link_code_pairing_ref").unwrap_or_default();
        if pairing_ref != link_cache.pairing_ref.as_bytes() {
            return Err(ClientError::Other(
                "pairing ref mismatch in code pair notification".to_owned(),
            ));
        }
        let wrapped_primary_ephemeral_public =
            node_bytes(node, "link_code_pairing_wrapped_primary_ephemeral_pub").ok_or_else(
                || {
                    element_missing(
                        "link_code_pairing_wrapped_primary_ephemeral_pub",
                        "notification",
                    )
                },
            )?;
        let primary_identity_public = node_bytes(node, "primary_identity_pub")
            .ok_or_else(|| element_missing("primary_identity_pub", "notification"))?;
        let identity_key = self.store.read().await.identity_key.clone();
        let (wrapped_key_bundle, adv_secret) = code_pair_key_bundle_with(
            &link_cache.linking_code,
            &link_cache.key_pair,
            &identity_key,
            wrapped_primary_ephemeral_public,
            primary_identity_public,
            &rand::random(),
            &rand::random(),
            &rand::random(),
        )?;
        self.store.write().await.adv_secret_key = adv_secret;
        self.send_iq(InfoQuery {
            namespace: "md",
            r#type: IqType::Set,
            to: SERVER_JID.clone(),
            content: Some(NodeContent::Nodes(vec![Node {
                tag: "link_code_companion_reg".to_owned(),
                attrs: Attrs::from([
                    ("jid".to_owned(), link_cache.jid.clone().into()),
                    ("stage".to_owned(), "companion_finish".into()),
                ]),
                content: Some(NodeContent::Nodes(vec![
                    bytes_node("link_code_pairing_wrapped_key_bundle", wrapped_key_bundle),
                    bytes_node("companion_identity_public", identity_key.public.to_vec()),
                    bytes_node("link_code_pairing_ref", pairing_ref.to_vec()),
                ])),
            }])),
            ..Default::default()
        })
        .await
        .map(|_| ())
    }
}

#[cfg(test)]
mod test;
