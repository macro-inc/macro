// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Media retry receipts and notifications against whatsmeow's output.

use super::*;
use crate::client::test::{capture_request, connect_paired, harness, next_event};
use crate::proto::wa_mms_retry::{ServerErrorReceipt, media_retry_notification::ResultType};
use crate::types::parse_jid;
use crate::vectors::Vectors;

#[test]
fn receipts_encrypt_and_notifications_parse_like_go() {
    let vectors = Vectors::load("pairing_media.json");
    let media_key = vectors.bytes("media_key");
    let iv: [u8; 12] = vectors.bytes("media_retry_receipt_iv").try_into().unwrap();
    assert_eq!(
        encrypt_media_retry_receipt_with("MSGID1", &media_key, &iv).unwrap(),
        vectors.bytes("media_retry_receipt_ciphertext")
    );
    let event = parse_media_retry_notification(&vectors.node("media_retry_notification")).unwrap();
    assert_eq!(
        event.chat_id.to_string(),
        vectors.string("media_retry_chat")
    );
    assert_eq!(
        event.sender_id.to_string(),
        vectors.string("media_retry_sender")
    );
    assert_eq!(event.message_id, "MSGID1");
    // The notification carries the receipt ciphertext; it decrypts as a
    // ServerErrorReceipt, proving key and AD match.
    let plaintext = gcmutil::decrypt(
        &get_media_retry_key(&media_key),
        &event.iv,
        &event.ciphertext,
        b"MSGID1",
    )
    .unwrap();
    assert_eq!(
        ServerErrorReceipt::decode(plaintext.as_slice())
            .unwrap()
            .stanza_id
            .as_deref(),
        Some("MSGID1")
    );
    let error = MediaRetry {
        message_id: "MSGID1".to_owned(),
        error: Some(MediaRetryError { code: 2 }),
        ..MediaRetry::default()
    };
    assert_eq!(
        decrypt_media_retry_notification(&error, &media_key)
            .unwrap_err()
            .to_string(),
        vectors.string("media_retry_error_2")
    );
}

#[test]
fn a_successful_retry_notification_decrypts_to_the_new_path() {
    let media_key = [5; 32];
    let notification = MediaRetryNotification {
        stanza_id: Some("M2".to_owned()),
        direct_path: Some("/v/new".to_owned()),
        result: Some(ResultType::Success as i32),
        ..Default::default()
    };
    let iv = [6; 12];
    let ciphertext = gcmutil::encrypt(
        &get_media_retry_key(&media_key),
        &iv,
        &notification.encode_to_vec(),
        b"M2",
    )
    .unwrap();
    let event = MediaRetry {
        ciphertext,
        iv: iv.to_vec(),
        message_id: "M2".to_owned(),
        ..MediaRetry::default()
    };
    assert_eq!(
        decrypt_media_retry_notification(&event, &media_key)
            .unwrap()
            .direct_path
            .as_deref(),
        Some("/v/new")
    );
}

#[tokio::test(start_paused = true)]
async fn the_retry_receipt_and_notification_match_go() {
    let vectors = Vectors::load("pairing_media.json");
    let mut harness = harness(Some(("1234:5@s.whatsapp.net", "9876:5@lid")));
    let mut connection = connect_paired(&mut harness).await;
    let info = MessageInfo {
        source: crate::types::MessageSource {
            chat: parse_jid("120363000000000001@g.us").unwrap(),
            sender: parse_jid("777@lid").unwrap(),
            is_group: true,
            ..Default::default()
        },
        id: "MSGID1".to_owned(),
        ..Default::default()
    };
    let client = std::sync::Arc::clone(&harness.client);
    let media_key = vectors.bytes("media_key");
    let mut sent = capture_request(&mut connection, async move {
        client.send_media_retry_receipt(&info, &media_key).await
    })
    .await;
    let mut expected = vectors.node("media_retry_send");
    // The IV is random on both sides.
    for node in [&mut sent, &mut expected] {
        if let Some(NodeContent::Nodes(children)) = &mut node.content {
            children[0].content = None;
        }
    }
    assert_eq!(sent, expected);

    connection
        .send_node(&vectors.node("media_retry_notification"))
        .await;
    loop {
        if let Event::MediaRetry(retry) = next_event(&mut harness.events).await {
            assert_eq!(retry.message_id, "MSGID1");
            break;
        }
    }
}
