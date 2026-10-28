// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow prekeys.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Go's `nodeToPreKey` fills a `keys.PreKey` with only the public half; here
// a received prekey is its own [`ReceivedPreKey`], since a local `PreKey`
// always has its private key.

//! Uploading this device's prekeys and fetching other devices' prekey bundles.

use std::collections::HashMap;
use std::time::Duration;

use crate::binary::{Node, NodeContent};
use crate::client::Client;
use crate::errors::ClientError;
use crate::request::{InfoQuery, IqType};
use crate::signal::{DJB_TYPE, PreKeyBundle};
use crate::types::{Jid, SERVER_JID};
use crate::util::keys::PreKey;

/// How many prekeys the client uploads in one batch.
pub const WANTED_PRE_KEY_COUNT: u32 = 50;
/// How many prekeys the initial upload after pairing contains.
pub const INITIAL_PRE_KEY_COUNT: u32 = 812;
/// Below this many prekeys on the server, the client uploads a new batch.
pub const MIN_PRE_KEY_COUNT: usize = 5;

/// A prekey from another device's bundle.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReceivedPreKey {
    /// The prekey ID.
    pub key_id: u32,
    /// The public key.
    pub public: [u8; 32],
    /// The signature, for signed prekeys.
    pub signature: Option<[u8; 64]>,
}

/// The result of fetching one device's prekey bundle (`preKeyResp`).
pub(crate) type PreKeyResponse = Result<PreKeyBundle, ClientError>;

impl Client {
    /// How many prekeys the server has left for this device.
    pub(crate) async fn get_server_pre_key_count(&self) -> Result<usize, ClientError> {
        let response = self
            .send_iq(InfoQuery {
                namespace: "encrypt",
                r#type: IqType::Get,
                to: SERVER_JID.clone(),
                content: Some(NodeContent::Nodes(vec![Node {
                    tag: "count".to_owned(),
                    ..Node::default()
                }])),
                ..Default::default()
            })
            .await
            .map_err(|error| error.wrap("failed to get prekey count on server"))?;
        let count = response.get_child_by_tag(&["count"]);
        let mut attrs = count.attr_getter();
        let value = attrs.int("value");
        attrs.error()?;
        Ok(usize::try_from(value).unwrap_or_default())
    }

    /// Uploads a batch of prekeys (812 on the first upload after pairing).
    pub(crate) async fn upload_pre_keys(&self, initial_upload: bool) {
        let mut last_upload = self.upload_pre_keys_lock.lock().await;
        if let Some(last) = *last_upload
            && last + Duration::from_secs(10 * 60) > tokio::time::Instant::now()
        {
            let server_count = self.get_server_pre_key_count().await.unwrap_or_default();
            if server_count >= usize::try_from(WANTED_PRE_KEY_COUNT).unwrap_or(usize::MAX) {
                tracing::debug!("canceling prekey upload request due to likely race condition");
                return;
            }
        }
        let (registration_id, identity_public, signed_pre_key, pre_key_store) = {
            let store = self.store.read().await;
            (
                store.registration_id,
                store.identity_key.public,
                store.signed_pre_key.clone(),
                std::sync::Arc::clone(&store.pre_keys),
            )
        };
        let wanted_count = if initial_upload {
            INITIAL_PRE_KEY_COUNT
        } else {
            WANTED_PRE_KEY_COUNT
        };
        let pre_keys = match pre_key_store.get_or_gen_pre_keys(wanted_count).await {
            Ok(pre_keys) => pre_keys,
            Err(error) => {
                tracing::error!(error = %error, "failed to get prekeys to upload");
                return;
            }
        };
        let Some(last_key_id) = pre_keys.last().map(|key| key.key_id) else {
            tracing::error!("prekey store returned no prekeys to upload");
            return;
        };
        tracing::info!(count = pre_keys.len(), "uploading new prekeys to server");
        let result = self
            .send_iq(InfoQuery {
                namespace: "encrypt",
                r#type: IqType::Set,
                to: SERVER_JID.clone(),
                content: Some(NodeContent::Nodes(vec![
                    bytes_node("registration", registration_id.to_be_bytes().to_vec()),
                    bytes_node("type", vec![DJB_TYPE]),
                    bytes_node("identity", identity_public.to_vec()),
                    Node {
                        tag: "list".to_owned(),
                        content: Some(NodeContent::Nodes(pre_keys_to_nodes(&pre_keys))),
                        ..Node::default()
                    },
                    pre_key_to_node(&signed_pre_key),
                ])),
                ..Default::default()
            })
            .await;
        if let Err(error) = result {
            tracing::error!(error = %error, "failed to send request to upload prekeys");
            return;
        }
        tracing::debug!("got response to uploading prekeys");
        if let Err(error) = pre_key_store.mark_pre_keys_as_uploaded(last_key_id).await {
            tracing::warn!(error = %error, "failed to mark prekeys as uploaded");
            return;
        }
        *last_upload = Some(tokio::time::Instant::now());
        self.pre_keys_uploaded.set();
    }

    /// Fetches prekey bundles, logging and skipping failures
    /// (`fetchPreKeysNoError`).
    pub(crate) async fn fetch_pre_keys_no_error(
        &self,
        retry_devices: &[Jid],
    ) -> HashMap<Jid, PreKeyBundle> {
        if retry_devices.is_empty() {
            return HashMap::new();
        }
        let responses = match self.fetch_pre_keys(retry_devices).await {
            Ok(responses) => responses,
            Err(error) => {
                tracing::warn!(error = %error, count = retry_devices.len(), "failed to fetch prekeys for devices with no existing session");
                return HashMap::new();
            }
        };
        let mut bundles = HashMap::with_capacity(retry_devices.len());
        for (jid, response) in responses {
            match response {
                Ok(bundle) => {
                    bundles.insert(jid, bundle);
                }
                Err(error) => tracing::warn!(error = %error, "failed to fetch prekey for device"),
            }
        }
        bundles
    }

    /// Fetches the prekey bundles of devices.
    pub(crate) async fn fetch_pre_keys(
        &self,
        users: &[Jid],
    ) -> Result<HashMap<Jid, PreKeyResponse>, ClientError> {
        let requests = users
            .iter()
            .map(|user| Node {
                tag: "user".to_owned(),
                attrs: crate::binary::Attrs::from([
                    ("jid".to_owned(), user.into()),
                    ("reason".to_owned(), "identity".into()),
                ]),
                content: None,
            })
            .collect();
        let response = self
            .send_iq(InfoQuery {
                namespace: "encrypt",
                r#type: IqType::Get,
                to: SERVER_JID.clone(),
                content: Some(NodeContent::Nodes(vec![Node {
                    tag: "key".to_owned(),
                    content: Some(NodeContent::Nodes(requests)),
                    ..Node::default()
                }])),
                ..Default::default()
            })
            .await
            .map_err(|error| error.wrap("failed to send prekey request"))?;
        if response.get_children().is_empty() {
            return Err(ClientError::Other(
                "got empty response to prekey request".to_owned(),
            ));
        }
        let list = response.get_child_by_tag(&["list"]);
        let mut responses = HashMap::new();
        for child in list.get_children() {
            if child.tag != "user" {
                continue;
            }
            let jid = child.attr_getter().jid("jid");
            let bundle = node_to_pre_key_bundle(u32::from(jid.device), child);
            responses.insert(jid, bundle);
        }
        Ok(responses)
    }
}

fn bytes_node(tag: &str, content: Vec<u8>) -> Node {
    Node {
        tag: tag.to_owned(),
        content: Some(NodeContent::Bytes(content)),
        ..Node::default()
    }
}

/// The `<key>` (or `<skey>` for signed prekeys) node of a prekey.
pub fn pre_key_to_node(key: &PreKey) -> Node {
    let key_id = key.key_id.to_be_bytes();
    let mut children = vec![
        bytes_node("id", key_id[1..].to_vec()),
        bytes_node("value", key.key_pair.public.to_vec()),
    ];
    let tag = match key.signature {
        Some(signature) => {
            children.push(bytes_node("signature", signature.to_vec()));
            "skey"
        }
        None => "key",
    };
    Node {
        tag: tag.to_owned(),
        content: Some(NodeContent::Nodes(children)),
        ..Node::default()
    }
}

fn node_bytes<'node>(node: &'node Node, tag: &str) -> Option<&'node [u8]> {
    match &node.get_optional_child_by_tag(&[tag])?.content {
        Some(NodeContent::Bytes(bytes)) => Some(bytes),
        _ => None,
    }
}

/// Parses a `<user>` node of a prekey response into a bundle.
pub fn node_to_pre_key_bundle(device_id: u32, node: &Node) -> Result<PreKeyBundle, ClientError> {
    if let Some(error_node) = node.get_optional_child_by_tag(&["error"]) {
        return Err(ClientError::Other(format!(
            "got error getting prekeys: {error_node}"
        )));
    }
    let registration_id = node_bytes(node, "registration")
        .and_then(|bytes| <[u8; 4]>::try_from(bytes).ok())
        .map(u32::from_be_bytes)
        .ok_or_else(|| {
            ClientError::Other("invalid registration ID in prekey response".to_owned())
        })?;

    let keys_node = node.get_optional_child_by_tag(&["keys"]).unwrap_or(node);

    let identity_key = node_bytes(keys_node, "identity")
        .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
        .ok_or_else(|| ClientError::Other("invalid identity key in prekey response".to_owned()))?;

    let pre_key = match keys_node.get_optional_child_by_tag(&["key"]) {
        Some(pre_key_node) => Some(node_to_pre_key(pre_key_node).map_err(|error| {
            ClientError::Other(format!("invalid prekey in prekey response: {error}"))
        })?),
        None => None,
    };
    let signed_pre_key =
        node_to_pre_key(keys_node.get_child_by_tag(&["skey"])).map_err(|error| {
            ClientError::Other(format!("invalid signed prekey in prekey response: {error}"))
        })?;
    let signed_pre_key_signature = signed_pre_key.signature.ok_or_else(|| {
        ClientError::Other("invalid signed prekey in prekey response: missing signature".to_owned())
    })?;

    Ok(PreKeyBundle {
        registration_id,
        device_id,
        pre_key: pre_key.map(|key| (key.key_id, key.public)),
        signed_pre_key_id: signed_pre_key.key_id,
        signed_pre_key_public: signed_pre_key.public,
        signed_pre_key_signature,
        identity_key,
    })
}

/// Parses a `<key>` or `<skey>` node.
pub fn node_to_pre_key(node: &Node) -> Result<ReceivedPreKey, String> {
    let id = node.get_child_by_tag(&["id"]);
    let key_id = if id.tag != "id" {
        return Err("prekey node doesn't contain ID tag".to_owned());
    } else {
        match &id.content {
            Some(NodeContent::Bytes(bytes)) if bytes.len() == 3 => {
                u32::from_be_bytes([0, bytes[0], bytes[1], bytes[2]])
            }
            Some(NodeContent::Bytes(bytes)) => {
                return Err(format!(
                    "prekey ID has unexpected number of bytes ({}, expected 3)",
                    bytes.len()
                ));
            }
            _ => return Err("prekey ID has unexpected content".to_owned()),
        }
    };
    let value = node.get_child_by_tag(&["value"]);
    let public = if value.tag != "value" {
        return Err("prekey node doesn't contain value tag".to_owned());
    } else {
        match &value.content {
            Some(NodeContent::Bytes(bytes)) => {
                <[u8; 32]>::try_from(bytes.as_slice()).map_err(|_| {
                    format!(
                        "prekey value has unexpected number of bytes ({}, expected 32)",
                        bytes.len()
                    )
                })?
            }
            _ => return Err("prekey value has unexpected content".to_owned()),
        }
    };
    let mut signature = None;
    if node.tag == "skey" {
        let signature_node = node.get_child_by_tag(&["signature"]);
        if signature_node.tag != "signature" {
            return Err("prekey node doesn't contain signature tag".to_owned());
        }
        signature = Some(match &signature_node.content {
            Some(NodeContent::Bytes(bytes)) => {
                <[u8; 64]>::try_from(bytes.as_slice()).map_err(|_| {
                    format!(
                        "prekey signature has unexpected number of bytes ({}, expected 64)",
                        bytes.len()
                    )
                })?
            }
            _ => return Err("prekey signature has unexpected content".to_owned()),
        });
    }
    Ok(ReceivedPreKey {
        key_id,
        public,
        signature,
    })
}

/// The `<key>` nodes of many prekeys.
pub fn pre_keys_to_nodes(pre_keys: &[PreKey]) -> Vec<Node> {
    pre_keys.iter().map(pre_key_to_node).collect()
}

#[cfg(test)]
mod test;
