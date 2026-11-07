// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Code pairing against whatsmeow's own output
//! (`testdata/generator/inpackage/pairing_media_vectors_test.go`) and the
//! fake server.

use std::sync::Arc;

use super::*;
use crate::client::test::{bytes, children, connect_paired, harness, next_node, node, text};
use crate::testing::{attr_string, is_iq};
use crate::util::keys::new_key_pair_from_private_key;
use crate::vectors::Vectors;

fn array<const N: usize>(data: Vec<u8>) -> [u8; N] {
    data.try_into().unwrap()
}

#[test]
fn companion_ephemeral_keys_match_go() {
    let vectors = Vectors::load("pairing_media.json");
    let key_pair = new_key_pair_from_private_key(array(vectors.bytes("companion_private")));
    let ephemeral_key = vectors.bytes("companion_ephemeral_key");
    let (computed, code) = generate_companion_ephemeral_key_with(
        &key_pair,
        &array(ephemeral_key[..32].to_vec()),
        &array(ephemeral_key[32..48].to_vec()),
        &array(vectors.bytes("companion_linking_code_bytes")),
    );
    assert_eq!(code, vectors.string("companion_linking_code"));
    assert_eq!(computed, ephemeral_key);
}

#[test]
fn the_key_bundle_and_adv_secret_match_go() {
    let vectors = Vectors::load("pairing_media.json");
    let notification = vectors.node("code_pair_notification");
    let registration = notification.get_child_by_tag(&["link_code_companion_reg"]);
    let wrapped_primary = node_bytes(
        registration,
        "link_code_pairing_wrapped_primary_ephemeral_pub",
    )
    .unwrap();
    let finish = vectors.node("code_pair_finish");
    let wrapped_bundle = node_bytes(
        finish.get_child_by_tag(&["link_code_companion_reg"]),
        "link_code_pairing_wrapped_key_bundle",
    )
    .unwrap()
    .to_vec();
    let identity =
        new_key_pair_from_private_key(array(vectors.bytes("code_pair_identity_private")));
    let ephemeral = new_key_pair_from_private_key(array(vectors.bytes("companion_private")));

    // Recover Go's random ADV input by decrypting its bundle, then check the
    // Rust computation reproduces the bundle and the ADV secret exactly.
    let primary_public: [u8; 32] = array(aes_ctr(
        &link_code_key(
            &vectors.string("companion_linking_code"),
            &wrapped_primary[..32],
        ),
        &array(wrapped_primary[32..48].to_vec()),
        &wrapped_primary[48..80],
    ));
    let shared = x25519(ephemeral.private, primary_public).unwrap();
    let bundle_key = hkdfutil::sha256(
        &shared,
        &wrapped_bundle[..32],
        b"link_code_pairing_key_bundle_encryption_key",
        32,
    );
    let plaintext = gcmutil::decrypt(
        &bundle_key,
        &wrapped_bundle[32..44],
        &wrapped_bundle[44..],
        &[],
    )
    .unwrap();
    let (computed_bundle, adv_secret) = code_pair_key_bundle_with(
        &vectors.string("companion_linking_code"),
        &ephemeral,
        &identity,
        wrapped_primary,
        &vectors.bytes("code_pair_primary_identity"),
        &array(plaintext[64..].to_vec()),
        &array(wrapped_bundle[..32].to_vec()),
        &array(wrapped_bundle[32..44].to_vec()),
    )
    .unwrap();
    assert_eq!(computed_bundle, wrapped_bundle);
    assert_eq!(adv_secret, vectors.bytes("code_pair_adv_secret"));
    assert_eq!(&plaintext[..32], &identity.public);
}

#[test]
fn linking_base32_matches_the_alphabet() {
    assert_eq!(linking_base32(&[0, 0, 0, 0, 0]), "11111111");
    assert_eq!(linking_base32(&[0xff; 5]), "ZZZZZZZZ");
}

#[tokio::test(start_paused = true)]
async fn pairing_with_a_phone_number_code() {
    let mut harness = harness(None);
    harness.client.connect().await.unwrap();
    let mut connection = harness.server.accept().await.unwrap();

    let client = Arc::clone(&harness.client);
    let pair = tokio::spawn(async move {
        client
            .pair_phone(
                "+1 (555) 000-1111",
                true,
                PairClientType::Chrome,
                "Chrome (Linux)",
            )
            .await
    });
    let hello = next_node(&mut connection).await;
    assert!(is_iq(&hello, "md"));
    let registration = hello.get_child_by_tag(&["link_code_companion_reg"]);
    assert_eq!(attr_string(registration, "stage"), "companion_hello");
    assert_eq!(
        attr_string(registration, "jid"),
        "15550001111@s.whatsapp.net"
    );
    assert_eq!(
        attr_string(registration, "should_show_push_notification"),
        "true"
    );
    let wrapped_companion = node_bytes(
        registration,
        "link_code_pairing_wrapped_companion_ephemeral_pub",
    )
    .unwrap()
    .to_vec();
    connection
        .respond_iq(
            &hello,
            vec![node(
                "link_code_companion_reg",
                &[],
                children(vec![node("link_code_pairing_ref", &[], bytes(b"REF9"))]),
            )],
        )
        .await;
    let code = pair.await.unwrap().unwrap();
    assert_eq!(code.len(), 9);
    let linking_code = code.replace('-', "");

    // The phone decrypts the companion key with the code and answers with
    // its own wrapped ephemeral key.
    let companion_public: [u8; 32] = array(aes_ctr(
        &link_code_key(&linking_code, &wrapped_companion[..32]),
        &array(wrapped_companion[32..48].to_vec()),
        &wrapped_companion[48..80],
    ));
    let primary_ephemeral = new_key_pair();
    let primary_identity = new_key_pair();
    let salt = [3; 32];
    let iv = [4; 16];
    let wrapped_primary = [
        &salt[..],
        &iv[..],
        &aes_ctr(
            &link_code_key(&linking_code, &salt),
            &iv,
            &primary_ephemeral.public,
        ),
    ]
    .concat();
    connection
        .send_node(&node(
            "notification",
            &[
                (
                    "from",
                    crate::binary::AttributeValue::Jid(SERVER_JID.clone()),
                ),
                ("id", text("N1")),
                ("type", text("link_code_companion_reg")),
            ],
            children(vec![node(
                "link_code_companion_reg",
                &[],
                children(vec![
                    node("link_code_pairing_ref", &[], bytes(b"REF9")),
                    node(
                        "link_code_pairing_wrapped_primary_ephemeral_pub",
                        &[],
                        bytes(&wrapped_primary),
                    ),
                    node("primary_identity_pub", &[], bytes(&primary_identity.public)),
                ]),
            )]),
        ))
        .await;
    let finish = loop {
        let request = next_node(&mut connection).await;
        if is_iq(&request, "md") {
            break request;
        }
    };
    let registration = finish.get_child_by_tag(&["link_code_companion_reg"]);
    assert_eq!(attr_string(registration, "stage"), "companion_finish");
    let wrapped_bundle = node_bytes(registration, "link_code_pairing_wrapped_key_bundle").unwrap();
    let shared = x25519(primary_ephemeral.private, companion_public).unwrap();
    let bundle_key = hkdfutil::sha256(
        &shared,
        &wrapped_bundle[..32],
        b"link_code_pairing_key_bundle_encryption_key",
        32,
    );
    let plaintext = gcmutil::decrypt(
        &bundle_key,
        &wrapped_bundle[32..44],
        &wrapped_bundle[44..],
        &[],
    )
    .unwrap();
    let identity_public = harness.client.store.read().await.identity_key.public;
    assert_eq!(&plaintext[..32], &identity_public);
    assert_eq!(&plaintext[32..64], &primary_identity.public);
    // The phone derives the same ADV secret the client stored.
    let identity_shared = x25519(primary_identity.private, identity_public).unwrap();
    let adv_secret = hkdfutil::sha256(
        &[&shared[..], &identity_shared[..], &plaintext[64..]].concat(),
        &[],
        b"adv_secret",
        32,
    );
    assert_eq!(harness.client.store.read().await.adv_secret_key, adv_secret);
    connection.respond_iq(&finish, vec![]).await;
    let _ = connect_paired;
}

#[tokio::test(start_paused = true)]
async fn short_and_local_phone_numbers_are_rejected() {
    let harness = harness(None);
    assert!(matches!(
        harness
            .client
            .pair_phone("12345", false, PairClientType::Chrome, "Chrome (Linux)")
            .await,
        Err(ClientError::PhoneNumberTooShort)
    ));
    assert!(matches!(
        harness
            .client
            .pair_phone(
                "0555000111",
                false,
                PairClientType::Chrome,
                "Chrome (Linux)"
            )
            .await,
        Err(ClientError::PhoneNumberIsNotInternational)
    ));
}
