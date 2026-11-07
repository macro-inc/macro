// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Passkey pairing on the fake server, with the server and phone side of
//! the key agreement computed independently in the test.

use std::sync::Arc;

use super::*;
use crate::client::test::{bytes, children, harness, next_event, next_node, node, text};
use crate::testing::{attr_string, is_iq};
use crate::types::UnpaddedUrlBytes;

fn child_bytes(node: &Node, tag: &str) -> Vec<u8> {
    match &node.get_child_by_tag(&[tag]).content {
        Some(NodeContent::Bytes(bytes)) => bytes.clone(),
        _ => panic!("<{tag}> has bytes"),
    }
}

#[test]
fn webauthn_json_round_trips_with_go_field_names() {
    let json = r#"{"challenge":"AAEC","timeout":60000,"rpId":"whatsapp.com","allowCredentials":[{"id":"_wAB","type":"public-key","transports":["hybrid"]}],"userVerification":"preferred","extensions":{"appid":"x"}}"#;
    let options: WebAuthnPublicKey = serde_json::from_str(json).unwrap();
    assert_eq!(options.challenge.0, [0, 1, 2]);
    assert_eq!(options.allow_credentials[0].id.0, [255, 0, 1]);
    let response = WebAuthnResponse {
        id: "_wAB".to_owned(),
        raw_id: UnpaddedUrlBytes(vec![255, 0, 1]),
        r#type: "public-key".to_owned(),
        response: Default::default(),
    };
    assert_eq!(
        serde_json::to_string(&response).unwrap(),
        r#"{"id":"_wAB","rawId":"_wAB","type":"public-key","response":{"clientDataJSON":"","authenticatorData":"","signature":"","userHandle":null}}"#
    );
}

#[tokio::test(start_paused = true)]
async fn pairing_with_a_passkey_and_confirmation_code() {
    let mut harness = harness(None);
    harness.client.connect().await.unwrap();
    let mut connection = harness.server.accept().await.unwrap();
    let old_adv_secret = harness.client.store.read().await.adv_secret_key.clone();

    let options = br#"{"challenge":"AAEC","timeout":60000,"rpId":"whatsapp.com","allowCredentials":[],"userVerification":"required","extensions":{}}"#;
    connection
        .send_node(&node(
            "notification",
            &[
                ("from", AttributeValue::Jid(SERVER_JID.clone())),
                ("id", text("N1")),
                ("type", text("passkey_prologue_request")),
            ],
            children(vec![node("passkey_request_options", &[], bytes(options))]),
        ))
        .await;
    let request = loop {
        if let Event::PairPasskeyRequest(request) = next_event(&mut harness.events).await {
            break request;
        }
    };
    assert_eq!(request.public_key.relying_party_id, "whatsapp.com");
    assert_ne!(
        harness.client.store.read().await.adv_secret_key,
        old_adv_secret
    );

    let client = Arc::clone(&harness.client);
    let response = tokio::spawn(async move {
        client
            .send_passkey_response(&WebAuthnResponse {
                id: "_wAB".to_owned(),
                raw_id: UnpaddedUrlBytes(vec![255, 0, 1]),
                r#type: "public-key".to_owned(),
                response: Default::default(),
            })
            .await
    });
    let ref_query = loop {
        let request = next_node(&mut connection).await;
        if is_iq(&request, "md") {
            break request;
        }
    };
    assert_eq!(attr_string(&ref_query, "type"), "get");
    connection
        .respond_iq(&ref_query, vec![node("ref", &[], bytes(b"2@companionref"))])
        .await;
    let prologue_iq = next_node(&mut connection).await;
    let prologue_node = prologue_iq.get_child_by_tag(&["passkey_prologue"]);
    assert_eq!(child_bytes(prologue_node, "credential_id"), [255, 0, 1]);
    let prologue = child_bytes(prologue_node, "prologue_payload");
    assert_eq!(
        child_bytes(prologue_node, "pairing_handoff_proof"),
        pairing_handoff_proof(&passkey_handoff_hmac_key(&old_adv_secret), &prologue)
    );
    let payload = ProloguePayload::decode(prologue.as_slice()).unwrap();
    let identity = CompanionEphemeralIdentity::decode(
        payload.companion_ephemeral_identity.as_deref().unwrap(),
    )
    .unwrap();
    assert_eq!(identity.r#ref.as_deref(), Some("2@companionref"));
    connection.respond_iq(&prologue_iq, vec![]).await;
    response.await.unwrap().unwrap();

    // The phone answers with its ephemeral identity.
    let primary = new_key_pair();
    let primary_nonce = [8; 32];
    connection
        .send_node(&node(
            "notification",
            &[
                ("from", AttributeValue::Jid(SERVER_JID.clone())),
                ("id", text("N2")),
                ("type", text("crsc_continuation")),
            ],
            children(vec![node(
                "primary_ephemeral_identity",
                &[],
                bytes(
                    &PrimaryEphemeralIdentity {
                        public_key: Some(primary.public.to_vec()),
                        nonce: Some(primary_nonce.to_vec()),
                    }
                    .encode_to_vec(),
                ),
            )]),
        ))
        .await;
    let nonce_iq = loop {
        let request = next_node(&mut connection).await;
        if is_iq(&request, "md") {
            break request;
        }
    };
    let companion_nonce = child_bytes(&nonce_iq, "companion_nonce");
    assert_eq!(
        payload.commitment.unwrap().hash.unwrap(),
        Sha256::new()
            .chain_update(payload.companion_ephemeral_identity.as_deref().unwrap())
            .chain_update(&companion_nonce)
            .finalize()
            .to_vec()
    );
    connection.respond_iq(&nonce_iq, vec![]).await;
    let confirmation = loop {
        if let Event::PairPasskeyConfirmation(confirmation) = next_event(&mut harness.events).await
        {
            break confirmation;
        }
    };
    assert!(confirmation.skip_handoff_ux);
    // The phone computes the same key from its side of the agreement and
    // the same code from the nonces.
    let companion_public: [u8; 32] = identity.public_key.unwrap().try_into().unwrap();
    let shared = x25519_dalek::x25519(primary.private, companion_public);
    let encryption_key = hkdfutil::sha256(
        &shared,
        format!(
            "Companion Pairing {} with ref 2@companionref",
            identity.device_type.unwrap_or_default()
        )
        .as_bytes(),
        b"Pairing Information Encryption Key",
        32,
    );
    let digest = Sha256::new()
        .chain_update(&companion_nonce)
        .chain_update(primary.public)
        .finalize();
    let code_bytes: Vec<u8> = (0..5)
        .map(|index| primary_nonce[index] ^ digest[index])
        .collect();
    let code = linking_base32(&code_bytes);
    assert_eq!(confirmation.code, format!("{}-{}", &code[..4], &code[4..]));

    let client = Arc::clone(&harness.client);
    let confirm = tokio::spawn(async move { client.send_passkey_confirmation().await });
    let pairing_iq = next_node(&mut connection).await;
    let wrapped = EncryptedPairingRequest::decode(
        child_bytes(&pairing_iq, "encrypted_pairing_request").as_slice(),
    )
    .unwrap();
    let request = PairingRequest::decode(
        gcmutil::decrypt(
            &encryption_key,
            wrapped.iv.as_deref().unwrap(),
            wrapped.encrypted_payload.as_deref().unwrap(),
            &[],
        )
        .unwrap()
        .as_slice(),
    )
    .unwrap();
    let store = harness.client.store.read().await;
    assert_eq!(
        request.companion_public_key.unwrap(),
        store.noise_key.public
    );
    assert_eq!(request.adv_secret.unwrap(), store.adv_secret_key);
    drop(store);
    connection.respond_iq(&pairing_iq, vec![]).await;
    confirm.await.unwrap().unwrap();
}
