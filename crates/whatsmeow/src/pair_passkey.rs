// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow pair-passkey.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// The key derivations take their randomness and inputs as parameters
// (`prologue_with`, `passkey_confirmation_code`, …) so tests can compare
// with Go.

//! Pairing that the phone protects with a passkey: the server asks for a
//! WebAuthn assertion, then both sides agree on a short confirmation code.

use std::sync::Arc;
use std::time::Duration;

use hmac::{Hmac, Mac};
use prost::Message;
use sha2::{Digest, Sha256};

use crate::binary::{AttributeValue, Attrs, Node, NodeContent};
use crate::client::{Client, lock};
use crate::errors::{ClientError, element_missing};
use crate::pair_code::linking_base32;
use crate::proto::wa_companion_reg::{
    CompanionCommitment, CompanionEphemeralIdentity, EncryptedPairingRequest, PairingRequest,
    PrimaryEphemeralIdentity, ProloguePayload,
};
use crate::request::{InfoQuery, IqType};
use crate::store::device_props;
use crate::types::events::{Event, PairPasskeyConfirmation, PairPasskeyError, PairPasskeyRequest};
use crate::types::{SERVER_JID, WebAuthnPublicKey, WebAuthnResponse};
use crate::util::gcmutil;
use crate::util::hkdfutil;
use crate::util::keys::{KeyPair, new_key_pair};

/// How long the passkey handoff key stays valid.
const PASSKEY_HANDOFF_KEY_LIFETIME: Duration = Duration::from_secs(5 * 60);

/// The state of a passkey pairing between the response and the confirmation
/// (`passkeyLinkingCache`).
#[derive(Clone)]
pub(crate) struct PasskeyLinkingCache {
    key_pair: KeyPair,
    companion_nonce: Vec<u8>,
    pairing_ref: String,
    device_type: i32,
    encryption_key: Option<Vec<u8>>,
}

/// The HMAC key proving the pairing handoff (`passkeyHandoffKey`).
#[derive(Clone)]
pub(crate) struct PasskeyHandoffKey {
    hmac: Vec<u8>,
    created: tokio::time::Instant,
}

impl PasskeyHandoffKey {
    fn valid(&self) -> bool {
        self.created.elapsed() < PASSKEY_HANDOFF_KEY_LIFETIME
    }
}

/// The passkey state the client keeps.
#[derive(Default)]
pub(crate) struct PasskeyState {
    pub(crate) linking: Option<PasskeyLinkingCache>,
    pub(crate) handoff_key: Option<PasskeyHandoffKey>,
    pub(crate) skip_handoff_ux: bool,
}

/// The handoff HMAC key derived from the ADV secret.
pub fn passkey_handoff_hmac_key(adv_secret: &[u8]) -> Vec<u8> {
    hkdfutil::sha256(adv_secret, &[], b"shortcake-passkey-handoff-v1", 32)
}

/// The serialized `ProloguePayload` committing to the companion's ephemeral
/// identity and nonce.
pub fn prologue_with(
    ephemeral_public: &[u8; 32],
    device_type: i32,
    companion_ref: &str,
    companion_nonce: &[u8],
) -> Vec<u8> {
    let identity = CompanionEphemeralIdentity {
        public_key: Some(ephemeral_public.to_vec()),
        device_type: Some(device_type),
        r#ref: Some(companion_ref.to_owned()),
    }
    .encode_to_vec();
    let commitment: [u8; 32] = Sha256::new()
        .chain_update(&identity)
        .chain_update(companion_nonce)
        .finalize()
        .into();
    ProloguePayload {
        companion_ephemeral_identity: Some(identity),
        commitment: Some(CompanionCommitment {
            hash: Some(commitment.to_vec()),
        }),
    }
    .encode_to_vec()
}

/// HMAC-SHA256 of the prologue with the handoff key.
pub fn pairing_handoff_proof(handoff_key: &[u8], prologue: &[u8]) -> Vec<u8> {
    // HMAC accepts keys of any length.
    let Ok(mut mac) = <Hmac<Sha256> as Mac>::new_from_slice(handoff_key) else {
        return Vec::new();
    };
    mac.update(prologue);
    mac.finalize().into_bytes().to_vec()
}

/// The pairing encryption key and the confirmation code (`ABCD-EFGH`) from
/// the primary device's ephemeral identity.
pub fn passkey_confirmation_code(
    companion_private: [u8; 32],
    companion_nonce: &[u8],
    device_type: i32,
    pairing_ref: &str,
    primary_public: &[u8; 32],
    primary_nonce: &[u8],
) -> Result<(Vec<u8>, String), ClientError> {
    let shared_secret = x25519_dalek::x25519(companion_private, *primary_public);
    if shared_secret == [0; 32] {
        return Err(ClientError::Other(
            "failed to compute shared secret: bad input point: low order point".to_owned(),
        ));
    }
    let salt = format!("Companion Pairing {device_type} with ref {pairing_ref}");
    let encryption_key = hkdfutil::sha256(
        &shared_secret,
        salt.as_bytes(),
        b"Pairing Information Encryption Key",
        32,
    );
    let digest: [u8; 32] = Sha256::new()
        .chain_update(companion_nonce)
        .chain_update(primary_public)
        .finalize()
        .into();
    let code_bytes: Vec<u8> = primary_nonce
        .iter()
        .zip(digest)
        .take(5)
        .map(|(nonce, digest)| nonce ^ digest)
        .collect();
    let encoded = linking_base32(&code_bytes);
    Ok((
        encryption_key,
        format!("{}-{}", &encoded[..4], &encoded[4..]),
    ))
}

fn bytes_node(tag: &str, content: Vec<u8>) -> Node {
    Node {
        tag: tag.to_owned(),
        attrs: Attrs::new(),
        content: Some(NodeContent::Bytes(content)),
    }
}

fn from_server(node: &Node) -> bool {
    matches!(node.attrs.get("from"), Some(AttributeValue::Jid(from)) if *from == *SERVER_JID)
}

/// Parses the WebAuthn options in a `passkey_prologue_request` notification
/// or the `passkey_request_options` IQ response.
pub fn parse_passkey_notification(node: &Node) -> Result<WebAuthnPublicKey, ClientError> {
    let options = node
        .get_optional_child_by_tag(&["passkey_request_options"])
        .ok_or_else(|| element_missing("passkey_request_options", "passkey notification"))?;
    let Some(NodeContent::Bytes(content)) = &options.content else {
        return Err(ClientError::Other(
            "unexpected content type for <passkey_request_options> node".to_owned(),
        ));
    };
    serde_json::from_slice(content).map_err(|error| {
        ClientError::Other(format!(
            "failed to unmarshal <passkey_request_options> content: {error}"
        ))
    })
}

/// Parses the primary device's ephemeral identity in a continuation
/// notification.
pub fn parse_passkey_continuation_notification(
    node: &Node,
) -> Result<PrimaryEphemeralIdentity, ClientError> {
    let identity = node
        .get_optional_child_by_tag(&["primary_ephemeral_identity"])
        .ok_or_else(|| {
            element_missing(
                "primary_ephemeral_identity",
                "passkey continuation notification",
            )
        })?;
    let Some(NodeContent::Bytes(content)) = &identity.content else {
        return Err(ClientError::Other(
            "unexpected content type for <primary_ephemeral_identity> node".to_owned(),
        ));
    };
    let identity = PrimaryEphemeralIdentity::decode(content.as_slice()).map_err(|error| {
        ClientError::Other(format!(
            "failed to unmarshal primary ephemeral identity: {error}"
        ))
    })?;
    let public_key_length = identity.public_key.as_deref().unwrap_or_default().len();
    let nonce_length = identity.nonce.as_deref().unwrap_or_default().len();
    if public_key_length != 32 {
        return Err(ClientError::Other(format!(
            "unexpected public key length {public_key_length} primary ephemeral identity"
        )));
    } else if nonce_length != 32 {
        return Err(ClientError::Other(format!(
            "unexpected nonce length {nonce_length} primary ephemeral identity"
        )));
    }
    Ok(identity)
}

impl Client {
    pub(crate) async fn handle_passkey_notification(self: &Arc<Self>, node: &Node) {
        if !from_server(node) {
            tracing::warn!("ignoring passkey notification from non-server JID");
            return;
        }
        let public_key = match parse_passkey_notification(node) {
            Ok(public_key) => public_key,
            Err(error) => {
                tracing::warn!(error = %error, "failed to parse passkey notification");
                match self.get_passkey_request_options().await {
                    Ok(public_key) => {
                        tracing::debug!(
                            "fetched passkey options after failing to parse notification"
                        );
                        public_key
                    }
                    Err(second_error) => {
                        tracing::warn!(error = %second_error, "failed to fetch passkey options");
                        self.dispatch_event(Event::PairPasskeyError(PairPasskeyError {
                            error: Arc::new(ClientError::Other(format!(
                                "failed to parse passkey notification: {error} (fetching key also failed: {second_error})"
                            ))),
                            continuation: false,
                        }))
                        .await;
                        return;
                    }
                }
            }
        };
        let new_secret: [u8; 32] = rand::random();
        let old_secret = {
            let mut store = self.store.write().await;
            std::mem::replace(&mut store.adv_secret_key, new_secret.to_vec())
        };
        lock(&self.passkey_state).handoff_key = Some(PasskeyHandoffKey {
            hmac: passkey_handoff_hmac_key(&old_secret),
            created: tokio::time::Instant::now(),
        });
        self.dispatch_event(Event::PairPasskeyRequest(Box::new(PairPasskeyRequest {
            public_key,
        })))
        .await;
    }

    /// Sends the authenticator's answer to an [`Event::PairPasskeyRequest`]
    /// (`SendPasskeyResponse`).
    #[tracing::instrument(name = "whatsmeow.pair.passkey_response", skip_all, err)]
    pub async fn send_passkey_response(
        &self,
        passkey_response: &WebAuthnResponse,
    ) -> Result<(), ClientError> {
        let marshaled_response = serde_json::to_vec(passkey_response).map_err(|error| {
            ClientError::Other(format!("failed to marshal WebAuthnResponse: {error}"))
        })?;
        let companion_ref = self
            .get_companion_ref()
            .await
            .map_err(|error| error.wrap("failed to get companion ref"))?;
        let key_pair = new_key_pair();
        let companion_nonce: [u8; 32] = rand::random();
        let device_type = device_props().platform_type.unwrap_or_default();
        let prologue = prologue_with(
            &key_pair.public,
            device_type,
            &companion_ref,
            &companion_nonce,
        );
        let handoff_key = {
            let mut state = lock(&self.passkey_state);
            state.linking = Some(PasskeyLinkingCache {
                key_pair,
                companion_nonce: companion_nonce.to_vec(),
                pairing_ref: companion_ref,
                device_type,
                encryption_key: None,
            });
            let handoff_key = state.handoff_key.clone().filter(PasskeyHandoffKey::valid);
            state.skip_handoff_ux = handoff_key.is_some();
            handoff_key
        };
        let mut content = vec![
            bytes_node("credential_id", passkey_response.raw_id.0.clone()),
            bytes_node("webauthn_assertion", marshaled_response),
            bytes_node("prologue_payload", prologue.clone()),
        ];
        if let Some(handoff_key) = handoff_key {
            content.push(bytes_node(
                "pairing_handoff_proof",
                pairing_handoff_proof(&handoff_key.hmac, &prologue),
            ));
        }
        self.send_iq(InfoQuery {
            namespace: "md",
            r#type: IqType::Set,
            to: SERVER_JID.clone(),
            content: Some(NodeContent::Nodes(vec![Node {
                tag: "passkey_prologue".to_owned(),
                attrs: Attrs::new(),
                content: Some(NodeContent::Nodes(content)),
            }])),
            ..Default::default()
        })
        .await
        .map_err(|error| error.wrap("failed to send passkey response"))?;
        lock(&self.passkey_state).handoff_key = None;
        Ok(())
    }

    pub(crate) async fn try_handle_passkey_continuation_notification(self: Arc<Self>, node: Node) {
        if !from_server(&node) {
            tracing::warn!("ignoring passkey continuation notification from non-server JID");
            return;
        }
        if let Err(error) = self.handle_passkey_continuation_notification(&node).await {
            tracing::warn!(error = %error, "failed to handle passkey continuation notification");
            self.dispatch_event(Event::PairPasskeyError(PairPasskeyError {
                error: Arc::new(error),
                continuation: true,
            }))
            .await;
        }
    }

    async fn handle_passkey_continuation_notification(
        &self,
        node: &Node,
    ) -> Result<(), ClientError> {
        let cache = lock(&self.passkey_state).linking.clone().ok_or_else(|| {
            ClientError::Other(
                "received passkey continuation notification without a linking cache".to_owned(),
            )
        })?;
        let primary = parse_passkey_continuation_notification(node)
            .map_err(|error| error.wrap("failed to parse passkey continuation notification"))?;
        let primary_public: [u8; 32] = primary
            .public_key
            .as_deref()
            .unwrap_or_default()
            .try_into()
            .map_err(|_| ClientError::Other("bad primary public key".to_owned()))?;
        self.send_iq(InfoQuery {
            namespace: "md",
            r#type: IqType::Set,
            to: SERVER_JID.clone(),
            content: Some(NodeContent::Nodes(vec![bytes_node(
                "companion_nonce",
                cache.companion_nonce.clone(),
            )])),
            ..Default::default()
        })
        .await
        .map_err(|error| error.wrap("failed to send companion nonce"))?;
        let (encryption_key, code) = passkey_confirmation_code(
            cache.key_pair.private,
            &cache.companion_nonce,
            cache.device_type,
            &cache.pairing_ref,
            &primary_public,
            primary.nonce.as_deref().unwrap_or_default(),
        )?;
        let skip_handoff_ux = {
            let mut state = lock(&self.passkey_state);
            if let Some(linking) = state.linking.as_mut() {
                linking.encryption_key = Some(encryption_key);
            }
            state.skip_handoff_ux
        };
        self.dispatch_event(Event::PairPasskeyConfirmation(PairPasskeyConfirmation {
            code,
            skip_handoff_ux,
        }))
        .await;
        Ok(())
    }

    /// Confirms that the code of [`Event::PairPasskeyConfirmation`] was shown
    /// and accepted, finishing the pairing (`SendPasskeyConfirmation`).
    #[tracing::instrument(name = "whatsmeow.pair.passkey_confirmation", skip_all, err)]
    pub async fn send_passkey_confirmation(&self) -> Result<(), ClientError> {
        let encryption_key = {
            let state = lock(&self.passkey_state);
            let cache = state.linking.as_ref().ok_or_else(|| {
                ClientError::Other("no passkey linking cache available".to_owned())
            })?;
            cache.encryption_key.clone().ok_or_else(|| {
                ClientError::Other(
                    "passkey linking cache does not have an encryption key yet".to_owned(),
                )
            })?
        };
        let request = {
            let store = self.store.read().await;
            PairingRequest {
                companion_public_key: Some(store.noise_key.public.to_vec()),
                companion_identity_key: Some(store.identity_key.public.to_vec()),
                adv_secret: Some(store.adv_secret_key.clone()),
            }
            .encode_to_vec()
        };
        let iv: [u8; 12] = rand::random();
        let encrypted_request =
            gcmutil::encrypt(&encryption_key, &iv, &request, &[]).map_err(|error| {
                ClientError::Other(format!("failed to encrypt PairingRequest: {error}"))
            })?;
        let wrapped_request = EncryptedPairingRequest {
            encrypted_payload: Some(encrypted_request),
            iv: Some(iv.to_vec()),
        }
        .encode_to_vec();
        self.send_iq(InfoQuery {
            namespace: "md",
            r#type: IqType::Set,
            to: SERVER_JID.clone(),
            content: Some(NodeContent::Nodes(vec![bytes_node(
                "encrypted_pairing_request",
                wrapped_request,
            )])),
            ..Default::default()
        })
        .await?;
        lock(&self.passkey_state).linking = None;
        Ok(())
    }

    async fn get_companion_ref(&self) -> Result<String, ClientError> {
        let response = self
            .send_iq(InfoQuery {
                namespace: "md",
                r#type: IqType::Get,
                to: SERVER_JID.clone(),
                content: Some(NodeContent::Nodes(vec![Node {
                    tag: "ref".to_owned(),
                    ..Node::default()
                }])),
                ..Default::default()
            })
            .await?;
        let reference = response
            .get_optional_child_by_tag(&["ref"])
            .ok_or_else(|| element_missing("ref", "get ref response"))?;
        match &reference.content {
            Some(NodeContent::Bytes(bytes)) => Ok(String::from_utf8_lossy(bytes).into_owned()),
            _ => Err(ClientError::Other(
                "unexpected content type for <ref> node".to_owned(),
            )),
        }
    }

    async fn get_passkey_request_options(&self) -> Result<WebAuthnPublicKey, ClientError> {
        let response = self
            .send_iq(InfoQuery {
                namespace: "md",
                r#type: IqType::Get,
                to: SERVER_JID.clone(),
                content: Some(NodeContent::Nodes(vec![Node {
                    tag: "passkey_request_options".to_owned(),
                    ..Node::default()
                }])),
                ..Default::default()
            })
            .await?;
        parse_passkey_notification(&response)
    }
}

#[cfg(test)]
mod test;
