// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow pair.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// `makeQRData` and `getQRClientType` take the client's inputs as parameters
// ([`make_qr_data`], [`get_qr_client_type`]) so they are testable alone.

//! QR code pairing.

use std::sync::Arc;
use std::sync::atomic::Ordering;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use hmac::{Hmac, Mac};
use prost::Message;
use sha2::Sha256;

use crate::binary::{Attrs, Node, NodeContent};
use crate::client::Client;
use crate::errors::ClientError;
use crate::pair_code::PairClientType;
use crate::proto::wa_adv::{
    AdvDeviceIdentity, AdvEncryptionType, AdvSignedDeviceIdentity, AdvSignedDeviceIdentityHmac,
};
use crate::proto::wa_companion_reg::ClientPairingProps;
use crate::proto::wa_companion_reg::device_props::PlatformType;
use crate::proto::wa_wa6::client_payload::user_agent::Platform;
use crate::signal::CurveSignatures;
use crate::store::{Device, base_client_payload, device_props};
use crate::types::events::{Event, PairError, PairSuccess, Qr, RotateAdvSecret};
use crate::types::{Jid, SERVER_JID};
use crate::util::keys::KeyPair;

/// The prefix of the message the primary device's account key signs.
pub const ADV_ACCOUNT_SIGNATURE_PREFIX: [u8; 2] = [6, 0];
/// The prefix of the message the companion's identity key signs.
pub const ADV_DEVICE_SIGNATURE_PREFIX: [u8; 2] = [6, 1];
/// [`ADV_ACCOUNT_SIGNATURE_PREFIX`] for hosted accounts.
pub const ADV_HOSTED_ACCOUNT_SIGNATURE_PREFIX: [u8; 2] = [6, 5];
/// [`ADV_DEVICE_SIGNATURE_PREFIX`] for hosted accounts.
pub const ADV_HOSTED_DEVICE_SIGNATURE_PREFIX: [u8; 2] = [6, 6];

/// The client type the QR code announces: the override if set, else derived
/// from the device props platform, else from the user agent platform. Go
/// reads the override from `Client.QRClientType`.
pub fn get_qr_client_type(client_type_override: Option<PairClientType>) -> PairClientType {
    if let Some(client_type) = client_type_override {
        return client_type;
    }
    let platform_type = device_props()
        .platform_type
        .and_then(|value| PlatformType::try_from(value).ok());
    match platform_type {
        Some(PlatformType::Chrome) => return PairClientType::Chrome,
        Some(PlatformType::Firefox) => return PairClientType::Firefox,
        Some(PlatformType::Edge) => return PairClientType::Edge,
        Some(PlatformType::Ie) => return PairClientType::Ie,
        Some(PlatformType::Opera) => return PairClientType::Opera,
        Some(PlatformType::Safari) => return PairClientType::Safari,
        Some(PlatformType::Uwp) => return PairClientType::Uwp,
        Some(PlatformType::AndroidPhone) => return PairClientType::Android,
        _ => {}
    }
    let platform = base_client_payload()
        .user_agent
        .and_then(|user_agent| user_agent.platform)
        .and_then(|value| Platform::try_from(value).ok());
    match platform {
        Some(Platform::Web) => PairClientType::OtherWebClient,
        Some(Platform::Macos) => PairClientType::MacOs,
        _ => PairClientType::Unknown,
    }
}

/// The contents of one pairing QR code: a link carrying the server's
/// reference, the device's noise and identity keys, its ADV secret, and the
/// client type. Go's `Client.makeQRData` reads the keys from `Client.Store`.
pub fn make_qr_data(store: &Device, reference: &[u8], client_type: PairClientType) -> String {
    format!(
        "https://wa.me/settings/linked_devices#{},{},{},{},{}",
        String::from_utf8_lossy(reference),
        STANDARD.encode(store.noise_key.public),
        STANDARD.encode(store.identity_key.public),
        STANDARD.encode(&store.adv_secret_key),
        client_type,
    )
}

/// Concatenates byte slices.
pub fn concat_bytes(data: &[&[u8]]) -> Vec<u8> {
    data.concat()
}

/// Whether the primary device's account key signed this device's identity
/// details and identity key.
pub fn verify_account_signature(
    device_identity: &AdvSignedDeviceIdentity,
    identity_key: &KeyPair,
    is_hosted: bool,
    signatures: &dyn CurveSignatures,
) -> bool {
    let (Some(signature_key), Some(signature)) = (
        device_identity.account_signature_key.as_deref(),
        device_identity.account_signature.as_deref(),
    ) else {
        return false;
    };
    let (Ok(signature_key), Ok(signature)) = (
        <&[u8; 32]>::try_from(signature_key),
        <&[u8; 64]>::try_from(signature),
    ) else {
        return false;
    };
    let prefix = if is_hosted {
        ADV_HOSTED_ACCOUNT_SIGNATURE_PREFIX
    } else {
        ADV_ACCOUNT_SIGNATURE_PREFIX
    };
    let message = concat_bytes(&[
        &prefix,
        device_identity.details.as_deref().unwrap_or_default(),
        &identity_key.public,
    ]);
    signatures.verify_signature(signature_key, &message, signature)
}

/// This device's signature over its identity details, identity key and the
/// account key, sent back to confirm the pairing.
pub fn generate_device_signature(
    device_identity: &AdvSignedDeviceIdentity,
    identity_key: &KeyPair,
    signatures: &dyn CurveSignatures,
) -> [u8; 64] {
    let message = concat_bytes(&[
        &ADV_DEVICE_SIGNATURE_PREFIX,
        device_identity.details.as_deref().unwrap_or_default(),
        &identity_key.public,
        device_identity
            .account_signature_key
            .as_deref()
            .unwrap_or_default(),
    ]);
    signatures.calculate_signature(&identity_key.private, &message)
}

fn bytes_content(node: &Node) -> Vec<u8> {
    match &node.content {
        Some(NodeContent::Bytes(bytes)) => bytes.clone(),
        _ => Vec::new(),
    }
}

fn string_attr(node: &Node, key: &str) -> String {
    match node.attrs.get(key) {
        Some(crate::binary::AttributeValue::String(value)) => value.clone(),
        _ => String::new(),
    }
}

fn jid_attr(node: &Node, key: &str) -> Jid {
    match node.attrs.get(key) {
        Some(crate::binary::AttributeValue::Jid(value)) => value.clone(),
        _ => Jid::default(),
    }
}

impl Client {
    pub(crate) async fn handle_iq(self: &Arc<Self>, node: &Node) {
        let children = node.get_children();
        let from_server = matches!(
            node.attrs.get("from"),
            Some(crate::binary::AttributeValue::Jid(from)) if *from == *SERVER_JID
        );
        if children.len() != 1 || !from_server {
            return;
        }
        match children[0].tag.as_str() {
            "pair-device" => self.handle_pair_device(node).await,
            "pair-success" => self.handle_pair_success(node).await,
            _ => {}
        }
    }

    async fn handle_pair_device(self: &Arc<Self>, node: &Node) {
        self.paired.store(false, Ordering::SeqCst);
        let pair_device = node.get_child_by_tag(&["pair-device"]);
        let mut attrs = Attrs::from([("type".to_owned(), "result".into())]);
        if let Some(from) = node.attrs.get("from") {
            attrs.insert("to".to_owned(), from.clone());
        }
        if let Some(id) = node.attrs.get("id") {
            attrs.insert("id".to_owned(), id.clone());
        }
        let ack = Node {
            tag: "iq".to_owned(),
            attrs,
            content: None,
        };
        if let Err(error) = self.send_node(&ack).await {
            tracing::warn!(error = %error, "failed to send acknowledgement for pair-device request");
        }

        let client_type = get_qr_client_type(self.config.qr_client_type);
        let mut codes = Vec::with_capacity(pair_device.get_children().len());
        {
            let store = self.store.read().await;
            for (index, child) in pair_device.get_children().iter().enumerate() {
                if child.tag != "ref" {
                    tracing::warn!(tag = %child.tag, index, "pair-device node contains unexpected child tag");
                    continue;
                }
                let Some(NodeContent::Bytes(content)) = &child.content else {
                    tracing::warn!(
                        index,
                        "pair-device node contains unexpected child content type"
                    );
                    continue;
                };
                codes.push(make_qr_data(&store, content, client_type));
            }
        }
        self.dispatch_event(Event::Qr(Qr { codes })).await;
    }

    /// Replaces the ADV secret, for `companion_reg_refresh` notifications.
    pub(crate) async fn rotate_adv_secret(self: &Arc<Self>) {
        let new_secret: [u8; 32] = rand::random();
        let old_secret = {
            let mut store = self.store.write().await;
            std::mem::replace(&mut store.adv_secret_key, new_secret.to_vec())
        };
        self.dispatch_event(Event::RotateAdvSecret(RotateAdvSecret {
            old_secret: STANDARD.encode(old_secret),
            new_secret: STANDARD.encode(new_secret),
        }))
        .await;
    }

    async fn handle_pair_success(self: &Arc<Self>, node: &Node) {
        if let Some(server_time) = node.attr_getter().unix_time("t") {
            let offset = (server_time.timestamp() - chrono::Utc::now().timestamp()) * 1_000_000_000;
            self.server_time_offset.store(offset, Ordering::SeqCst);
        }
        let id = string_attr(node, "id");
        let pair_success = node.get_child_by_tag(&["pair-success"]);

        let device_identity_bytes =
            bytes_content(pair_success.get_child_by_tag(&["device-identity"]));
        let business_name = string_attr(pair_success.get_child_by_tag(&["biz"]), "name");
        let jid = jid_attr(pair_success.get_child_by_tag(&["device"]), "jid");
        let lid = jid_attr(pair_success.get_child_by_tag(&["device"]), "lid");
        let platform = string_attr(pair_success.get_child_by_tag(&["platform"]), "name");
        let client_props_bytes = bytes_content(pair_success.get_child_by_tag(&["client-props"]));
        let props =
            ClientPairingProps::decode(client_props_bytes.as_slice()).unwrap_or_else(|error| {
                tracing::warn!(error = %error, "failed to parse client pairing props");
                ClientPairingProps::default()
            });

        let client = Arc::clone(self);
        self.spawn(async move {
            let result = client
                .handle_pair(
                    &device_identity_bytes,
                    &id,
                    &business_name,
                    &platform,
                    &jid,
                    &lid,
                )
                .await;
            match result {
                Err(error) => {
                    tracing::error!(error = %error, "failed to pair device");
                    client.disconnect().await;
                    client
                        .dispatch_event(Event::PairError(PairError {
                            id: jid,
                            lid,
                            business_name,
                            platform,
                            props,
                            error: Arc::new(error),
                        }))
                        .await;
                }
                Ok(()) => {
                    tracing::info!("successfully paired");
                    let unified = Arc::clone(&client);
                    client.spawn(async move { unified.send_unified_session().await });
                    client
                        .dispatch_event(Event::PairSuccess(PairSuccess {
                            id: jid,
                            lid,
                            business_name,
                            platform,
                            props,
                        }))
                        .await;
                }
            }
        });
    }

    #[tracing::instrument(name = "whatsmeow.pair", skip_all, err)]
    async fn handle_pair(
        &self,
        device_identity_bytes: &[u8],
        request_id: &str,
        business_name: &str,
        platform: &str,
        jid: &Jid,
        lid: &Jid,
    ) -> Result<(), ClientError> {
        let container = match AdvSignedDeviceIdentityHmac::decode(device_identity_bytes) {
            Ok(container) => container,
            Err(error) => {
                self.send_pair_error(request_id, 500, "internal-error")
                    .await;
                return Err(ClientError::PairProto {
                    message: "failed to parse device identity container in pair success message"
                        .to_owned(),
                    source: error.into(),
                });
            }
        };

        let (adv_secret_key, identity_key) = {
            let store = self.store.read().await;
            (store.adv_secret_key.clone(), store.identity_key.clone())
        };
        // HMAC accepts keys of any length.
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&adv_secret_key)
            .map_err(|error| ClientError::Other(error.to_string()))?;
        if container.account_type == Some(AdvEncryptionType::Hosted as i32) {
            mac.update(&ADV_HOSTED_ACCOUNT_SIGNATURE_PREFIX);
        }
        mac.update(container.details.as_deref().unwrap_or_default());
        if mac
            .verify_slice(container.hmac.as_deref().unwrap_or_default())
            .is_err()
        {
            tracing::warn!("invalid HMAC from pair success message");
            self.send_pair_error(request_id, 401, "hmac-mismatch").await;
            return Err(ClientError::PairInvalidDeviceIdentityHmac);
        }

        let mut device_identity =
            match AdvSignedDeviceIdentity::decode(container.details.as_deref().unwrap_or_default())
            {
                Ok(identity) => identity,
                Err(error) => {
                    self.send_pair_error(request_id, 500, "internal-error")
                        .await;
                    return Err(ClientError::PairProto {
                        message: "failed to parse signed device identity in pair success message"
                            .to_owned(),
                        source: error.into(),
                    });
                }
            };

        let device_identity_details =
            match AdvDeviceIdentity::decode(device_identity.details.as_deref().unwrap_or_default())
            {
                Ok(details) => details,
                Err(error) => {
                    self.send_pair_error(request_id, 500, "internal-error")
                        .await;
                    return Err(ClientError::PairProto {
                        message: "failed to parse device identity details in pair success message"
                            .to_owned(),
                        source: error.into(),
                    });
                }
            };

        let is_hosted =
            device_identity_details.device_type == Some(AdvEncryptionType::Hosted as i32);
        if !verify_account_signature(
            &device_identity,
            &identity_key,
            is_hosted,
            self.signatures(),
        ) {
            self.send_pair_error(request_id, 401, "signature-mismatch")
                .await;
            return Err(ClientError::PairInvalidDeviceSignature);
        }

        device_identity.device_signature = Some(
            generate_device_signature(&device_identity, &identity_key, self.signatures()).to_vec(),
        );

        if let Some(callback) = &self.config.pre_pair_callback
            && !callback(jid, platform, business_name)
        {
            self.send_pair_error(request_id, 500, "internal-error")
                .await;
            return Err(ClientError::PairRejectedLocally);
        }

        let mut main_device_lid = lid.clone();
        main_device_lid.device = 0;
        let Ok(main_device_identity) = <[u8; 32]>::try_from(
            device_identity
                .account_signature_key
                .as_deref()
                .unwrap_or_default(),
        ) else {
            // verify_account_signature already checked the length.
            return Err(ClientError::PairInvalidDeviceSignature);
        };
        let account = device_identity.clone();
        device_identity.account_signature_key = None;
        let self_signed_device_identity = device_identity.encode_to_vec();

        let identities = {
            let mut store = self.store.write().await;
            store.account = Some(account);
            store.id = Some(jid.clone());
            store.lid = lid.clone();
            store.business_name = business_name.to_owned();
            store.platform = platform.to_owned();
            if let Err(error) = store.save().await {
                drop(store);
                self.send_pair_error(request_id, 500, "internal-error")
                    .await;
                return Err(ClientError::PairDatabase {
                    message: "failed to save device store".to_owned(),
                    source: error,
                });
            }
            Arc::clone(&store.identities)
        };
        self.store_lid_pn_mapping(lid, jid).await;
        if let Err(error) = identities
            .put_identity(
                &main_device_lid.signal_address().to_string(),
                main_device_identity,
            )
            .await
        {
            let _ = self.delete_device().await;
            self.send_pair_error(request_id, 500, "internal-error")
                .await;
            return Err(ClientError::PairDatabase {
                message: "failed to store main device identity".to_owned(),
                source: error,
            });
        }

        // Expect a disconnect after this and don't dispatch the usual
        // Disconnected event.
        self.expect_disconnect();
        self.paired.store(true, Ordering::SeqCst);

        let confirmation = Node {
            tag: "iq".to_owned(),
            attrs: Attrs::from([
                ("to".to_owned(), SERVER_JID.clone().into()),
                ("type".to_owned(), "result".into()),
                ("id".to_owned(), request_id.into()),
            ]),
            content: Some(NodeContent::Nodes(vec![Node {
                tag: "pair-device-sign".to_owned(),
                attrs: Attrs::new(),
                content: Some(NodeContent::Nodes(vec![Node {
                    tag: "device-identity".to_owned(),
                    attrs: Attrs::from([(
                        "key-index".to_owned(),
                        device_identity_details.key_index.unwrap_or_default().into(),
                    )]),
                    content: Some(NodeContent::Bytes(self_signed_device_identity)),
                }])),
            }])),
        };
        if let Err(error) = self.send_node(&confirmation).await {
            let _ = self.delete_device().await;
            return Err(error.wrap("failed to send pairing confirmation"));
        }
        Ok(())
    }

    async fn send_pair_error(&self, id: &str, code: i64, text: &str) {
        let node = Node {
            tag: "iq".to_owned(),
            attrs: Attrs::from([
                ("to".to_owned(), SERVER_JID.clone().into()),
                ("type".to_owned(), "error".into()),
                ("id".to_owned(), id.into()),
            ]),
            content: Some(NodeContent::Nodes(vec![Node {
                tag: "error".to_owned(),
                attrs: Attrs::from([
                    ("code".to_owned(), code.into()),
                    ("text".to_owned(), text.into()),
                ]),
                content: None,
            }])),
        };
        if let Err(error) = self.send_node(&node).await {
            tracing::error!(error = %error, "failed to send pair error node");
        }
    }
}

#[cfg(test)]
mod test;
