// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow mediaretry.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// `encryptMediaRetryReceipt` takes its IV as a parameter
// ([`encrypt_media_retry_receipt_with`]) so tests can compare with Go.

//! Asking the sender's phone to re-upload media that is gone from the
//! server (404/410 on download).

use prost::Message;

use crate::binary::{Attrs, Node, NodeContent};
use crate::client::Client;
use crate::errors::{ClientError, element_missing};
use crate::proto::wa_mms_retry::{MediaRetryNotification, ServerErrorReceipt};
use crate::types::MessageInfo;
use crate::types::events::{Event, MediaRetry, MediaRetryError};
use crate::util::gcmutil;
use crate::util::hkdfutil;

/// The key that encrypts media retry receipts and notifications.
pub fn get_media_retry_key(media_key: &[u8]) -> Vec<u8> {
    hkdfutil::sha256(media_key, &[], b"WhatsApp Media Retry Notification", 32)
}

/// The encrypted `ServerErrorReceipt` for a message, with the given IV.
pub fn encrypt_media_retry_receipt_with(
    message_id: &str,
    media_key: &[u8],
    iv: &[u8; 12],
) -> Result<Vec<u8>, ClientError> {
    let plaintext = ServerErrorReceipt {
        stanza_id: Some(message_id.to_owned()),
    }
    .encode_to_vec();
    gcmutil::encrypt(
        &get_media_retry_key(media_key),
        iv,
        &plaintext,
        message_id.as_bytes(),
    )
    .map_err(|error| ClientError::Other(format!("failed to encrypt retry receipt: {error}")))
}

/// Decrypts a media retry answer with the media key
/// (`DecryptMediaRetryNotification`). On success the notification holds the
/// new direct path.
pub fn decrypt_media_retry_notification(
    event: &MediaRetry,
    media_key: &[u8],
) -> Result<MediaRetryNotification, ClientError> {
    if let Some(error) = event.error
        && event.ciphertext.is_empty()
    {
        if error.code == 2 {
            return Err(ClientError::MediaNotAvailableOnPhone);
        }
        return Err(ClientError::Other(format!(
            "{} (code: {})",
            ClientError::UnknownMediaRetryError,
            error.code
        )));
    }
    let plaintext = gcmutil::decrypt(
        &get_media_retry_key(media_key),
        &event.iv,
        &event.ciphertext,
        event.message_id.as_bytes(),
    )
    .map_err(|error| ClientError::Other(format!("failed to decrypt notification: {error}")))?;
    MediaRetryNotification::decode(plaintext.as_slice()).map_err(|error| {
        ClientError::Other(format!(
            "failed to unmarshal notification (invalid encryption key?): {error}"
        ))
    })
}

fn child_bytes(node: &Node, tags: &[&str]) -> Option<Vec<u8>> {
    match &node.get_optional_child_by_tag(tags)?.content {
        Some(NodeContent::Bytes(bytes)) => Some(bytes.clone()),
        _ => None,
    }
}

/// Parses a `mediaretry` notification.
pub fn parse_media_retry_notification(node: &Node) -> Result<MediaRetry, ClientError> {
    let mut attrs = node.attr_getter();
    let mut event = MediaRetry {
        timestamp: attrs.unix_time("t"),
        message_id: attrs.string("id"),
        ..MediaRetry::default()
    };
    attrs.error()?;
    let rmr = node
        .get_optional_child_by_tag(&["rmr"])
        .ok_or_else(|| element_missing("rmr", "retry notification"))?;
    let mut rmr_attrs = rmr.attr_getter();
    event.chat_id = rmr_attrs.jid("jid");
    event.from_me = rmr_attrs.bool("from_me");
    event.sender_id = rmr_attrs.optional_jid_or_empty("participant");
    rmr_attrs
        .error()
        .map_err(|error| ClientError::Other(format!("missing attributes in <rmr> tag: {error}")))?;
    if let Some(error_node) = node.get_optional_child_by_tag(&["error"]) {
        event.error = Some(MediaRetryError {
            code: error_node.attr_getter().int("code"),
        });
        return Ok(event);
    }
    event.ciphertext = child_bytes(node, &["encrypt", "enc_p"])
        .ok_or_else(|| element_missing("enc_p", "retry notification"))?;
    event.iv = child_bytes(node, &["encrypt", "enc_iv"])
        .ok_or_else(|| element_missing("enc_iv", "retry notification"))?;
    Ok(event)
}

fn bytes_node(tag: &str, content: Vec<u8>) -> Node {
    Node {
        tag: tag.to_owned(),
        attrs: Attrs::new(),
        content: Some(NodeContent::Bytes(content)),
    }
}

impl Client {
    /// Asks the phone to re-upload the media of a message
    /// (`SendMediaRetryReceipt`); the answer arrives as [`Event::MediaRetry`].
    /// Use it when a download fails with 404 or 410.
    #[tracing::instrument(name = "whatsmeow.media_retry.send", skip_all, err)]
    pub async fn send_media_retry_receipt(
        &self,
        message: &MessageInfo,
        media_key: &[u8],
    ) -> Result<(), ClientError> {
        let iv: [u8; 12] = rand::random();
        let ciphertext = encrypt_media_retry_receipt_with(&message.id, media_key, &iv)
            .map_err(|error| error.wrap("failed to prepare encrypted retry receipt"))?;
        let own_id = self.get_own_id().await.to_non_ad();
        if own_id.is_empty() {
            return Err(ClientError::NotLoggedIn);
        }
        let mut rmr_attrs = Attrs::from([
            ("jid".to_owned(), message.chat.clone().into()),
            ("from_me".to_owned(), message.is_from_me.into()),
        ]);
        if message.is_group {
            rmr_attrs.insert("participant".to_owned(), message.sender.clone().into());
        }
        self.send_node(&Node {
            tag: "receipt".to_owned(),
            attrs: Attrs::from([
                ("id".to_owned(), message.id.clone().into()),
                ("to".to_owned(), own_id.into()),
                ("type".to_owned(), "server-error".into()),
            ]),
            content: Some(NodeContent::Nodes(vec![
                Node {
                    tag: "encrypt".to_owned(),
                    attrs: Attrs::new(),
                    content: Some(NodeContent::Nodes(vec![
                        bytes_node("enc_p", ciphertext),
                        bytes_node("enc_iv", iv.to_vec()),
                    ])),
                },
                Node {
                    tag: "rmr".to_owned(),
                    attrs: rmr_attrs,
                    content: None,
                },
            ])),
        })
        .await
    }

    pub(crate) async fn handle_media_retry_notification(&self, node: &Node) {
        match parse_media_retry_notification(node) {
            Err(error) => {
                tracing::warn!(error = %error, "failed to parse media retry notification")
            }
            Ok(event) => {
                self.dispatch_event(Event::MediaRetry(Box::new(event)))
                    .await;
            }
        }
    }
}

#[cfg(test)]
mod test;
