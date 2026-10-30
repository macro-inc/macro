// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Message secret keys against whatsmeow's output, and an encrypted
//! reaction round trip through the store.

use super::*;
use crate::client::test::harness;
use crate::store::MsgSecretStore;
use crate::types::MessageSource;
use crate::vectors::Vectors;

#[test]
fn secret_keys_match_go() {
    let vectors = Vectors::load("pairing_media.json");
    let secret = vectors.bytes("msg_secret");
    let sender = parse_jid("9876:5@lid").unwrap();
    let original_sender = parse_jid("777:2@lid").unwrap();
    for (use_case, name) in [
        (MsgSecretType::Reaction, "Enc Reaction"),
        (MsgSecretType::PollVote, "Poll Vote"),
        (MsgSecretType::MessageEdit, "Message Edit"),
    ] {
        let (key, additional) =
            generate_msg_secret_key(use_case, &sender, "ORIG1", &original_sender, &secret);
        assert_eq!(key, vectors.bytes(&format!("msg_secret_key_{name}")));
        assert_eq!(additional, vectors.bytes(&format!("msg_secret_ad_{name}")));
    }
    let hashes: Vec<String> = hash_poll_options(&["yes".to_owned(), "no".to_owned()])
        .iter()
        .map(hex::encode)
        .collect();
    let expected: Vec<String> = vectors
        .value("poll_option_hashes")
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap().to_owned())
        .collect();
    assert_eq!(hashes, expected);
}

#[tokio::test(start_paused = true)]
async fn an_encrypted_reaction_decrypts_for_the_other_side() {
    let harness = harness(Some(("1234:5@s.whatsapp.net", "9876:5@lid")));
    let group = parse_jid("120363000000000001@g.us").unwrap();
    let author = parse_jid("777@lid").unwrap();
    harness
        .store
        .put_message_secret(&group, &author, &"ORIG1".to_owned(), vec![9; 32])
        .await
        .unwrap();
    let root = MessageInfo {
        source: MessageSource {
            chat: group.clone(),
            sender: author.clone(),
            is_group: true,
            ..Default::default()
        },
        id: "ORIG1".to_owned(),
        ..Default::default()
    };
    let key = MessageKey {
        remote_jid: Some(group.to_string()),
        from_me: Some(false),
        id: Some("ORIG1".to_owned()),
        participant: Some(author.to_string()),
    };
    let encrypted = harness
        .client
        .encrypt_reaction(
            &root,
            ReactionMessage {
                key: Some(key),
                text: Some("👍".to_owned()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    // Received in the group from our LID: decrypting finds the same secret.
    let received = Message {
        info: MessageInfo {
            source: MessageSource {
                chat: group,
                sender: parse_jid("9876:5@lid").unwrap(),
                is_group: true,
                ..Default::default()
            },
            id: "R1".to_owned(),
            ..Default::default()
        },
        message: Some(wa_e2e::Message {
            enc_reaction_message: Some(encrypted),
            ..Default::default()
        }),
        ..Default::default()
    };
    let reaction = harness.client.decrypt_reaction(&received).await.unwrap();
    assert_eq!(reaction.text.as_deref(), Some("👍"));
    assert!(matches!(
        harness.client.decrypt_comment(&received).await,
        Err(ClientError::NotEncryptedCommentMessage)
    ));
}
