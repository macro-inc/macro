use super::*;
use serde_json::json;

/// `challenge` = base64url("whatsapp-challenge"), credential id =
/// base64url("credential-1"), as whatsmeow serializes `WebAuthnPublicKey`.
fn whatsapp_request() -> serde_json::Value {
    json!({
        "challenge": "d2hhdHNhcHAtY2hhbGxlbmdl",
        "timeout": 300000,
        "rpId": "whatsapp.com",
        "allowCredentials": [
            { "id": "Y3JlZGVudGlhbC0x", "type": "public-key", "transports": ["hybrid", "internal"] }
        ],
        "userVerification": "preferred",
        "extensions": {}
    })
}

fn assertion(
    client_data: serde_json::Value,
    relying_party_id: &str,
    flags: u8,
    raw_id: &[u8],
) -> PublicKeyCredential {
    let mut authenticator_data = Sha256::digest(relying_party_id.as_bytes()).to_vec();
    authenticator_data.push(flags);
    authenticator_data.extend_from_slice(&[0, 0, 0, 1]);
    PublicKeyCredential {
        id: URL_SAFE_NO_PAD.encode(raw_id),
        raw_id: raw_id.to_vec(),
        response: webauthn_rs_proto::AuthenticatorAssertionResponseRaw {
            authenticator_data,
            client_data_json: serde_json::to_vec(&client_data).unwrap(),
            signature: vec![1, 2, 3],
            user_handle: None,
        },
        extensions: Default::default(),
        type_: "public-key".into(),
    }
}

fn whatsapp_client_data() -> serde_json::Value {
    json!({
        "type": "webauthn.get",
        "challenge": "d2hhdHNhcHAtY2hhbGxlbmdl",
        "origin": "https://web.whatsapp.com",
        "crossOrigin": false
    })
}

#[test]
fn whatsapp_request_is_pinned_to_required_verification() {
    let mut request = whatsapp_request();
    request["extensions"] = json!({ "appid": "https://evil.example", "uvm": true });

    let options = request_options(request).unwrap().public_key;

    assert_eq!(options.rp_id, "whatsapp.com");
    assert_eq!(options.challenge, b"whatsapp-challenge");
    assert_eq!(options.allow_credentials.len(), 1);
    assert_eq!(options.allow_credentials[0].id, b"credential-1");
    assert_eq!(options.user_verification, UserVerificationPolicy::Required);
    assert_eq!(options.timeout, Some(60_000));
    let extensions = options.extensions.unwrap();
    assert_eq!(extensions.appid, None);
    assert_eq!(extensions.uvm, Some(true));
}

#[test]
fn web_whatsapp_relying_party_is_accepted() {
    let mut request = whatsapp_request();
    request["rpId"] = json!("web.whatsapp.com");
    assert_eq!(
        request_options(request).unwrap().public_key.rp_id,
        "web.whatsapp.com"
    );
}

#[test]
fn other_relying_parties_are_rejected() {
    for relying_party_id in [
        "evil.example",
        "whatsapp.com.evil.example",
        "evilwhatsapp.com",
        "com",
        "",
    ] {
        let mut request = whatsapp_request();
        request["rpId"] = json!(relying_party_id);
        assert_eq!(
            request_options(request).unwrap_err(),
            AuthenticationError::Invalid,
            "{relying_party_id}"
        );
    }
}

#[test]
fn malformed_requests_are_rejected() {
    let mut missing_relying_party = whatsapp_request();
    missing_relying_party
        .as_object_mut()
        .unwrap()
        .remove("rpId");
    let mut missing_verification = whatsapp_request();
    missing_verification
        .as_object_mut()
        .unwrap()
        .remove("userVerification");
    let mut empty_challenge = whatsapp_request();
    empty_challenge["challenge"] = json!("");
    let mut not_base64_challenge = whatsapp_request();
    not_base64_challenge["challenge"] = json!("not base64!");
    let mut oversized_challenge = whatsapp_request();
    oversized_challenge["challenge"] = json!(URL_SAFE_NO_PAD.encode([7u8; 1025]));
    let mut wrapped = json!({});
    wrapped["publicKey"] = whatsapp_request();

    for request in [
        json!(null),
        json!("whatsapp.com"),
        json!([]),
        wrapped,
        missing_relying_party,
        missing_verification,
        empty_challenge,
        not_base64_challenge,
        oversized_challenge,
    ] {
        assert_eq!(
            request_options(request.clone()).unwrap_err(),
            AuthenticationError::Invalid,
            "{request}"
        );
    }
}

#[test]
fn verified_assertion_is_accepted() {
    let options = request_options(whatsapp_request()).unwrap().public_key;
    let credential = assertion(
        whatsapp_client_data(),
        "whatsapp.com",
        FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
        b"credential-1",
    );
    assert_eq!(verify_assertion(&options, &credential), Ok(()));
}

#[test]
fn assertion_without_user_verification_is_rejected() {
    let options = request_options(whatsapp_request()).unwrap().public_key;
    for flags in [FLAG_USER_PRESENT, FLAG_USER_VERIFIED, 0] {
        let credential = assertion(
            whatsapp_client_data(),
            "whatsapp.com",
            flags,
            b"credential-1",
        );
        assert_eq!(
            verify_assertion(&options, &credential),
            Err(AuthenticationError::Unverified),
            "flags {flags:#x}"
        );
    }
}

#[test]
fn assertion_for_anything_else_is_rejected() {
    let options = request_options(whatsapp_request()).unwrap().public_key;
    let verified = FLAG_USER_PRESENT | FLAG_USER_VERIFIED;

    let mut other_origin = whatsapp_client_data();
    other_origin["origin"] = json!("https://evil.example");
    let mut other_challenge = whatsapp_client_data();
    other_challenge["challenge"] = json!("b3RoZXI");
    let mut registration = whatsapp_client_data();
    registration["type"] = json!("webauthn.create");

    let mut truncated = assertion(
        whatsapp_client_data(),
        "whatsapp.com",
        verified,
        b"credential-1",
    );
    truncated.response.authenticator_data.truncate(32);
    let mut garbled_client_data = assertion(
        whatsapp_client_data(),
        "whatsapp.com",
        verified,
        b"credential-1",
    );
    garbled_client_data.response.client_data_json = b"{".to_vec();

    for credential in [
        assertion(other_origin, "whatsapp.com", verified, b"credential-1"),
        assertion(other_challenge, "whatsapp.com", verified, b"credential-1"),
        assertion(registration, "whatsapp.com", verified, b"credential-1"),
        assertion(
            whatsapp_client_data(),
            "evil.example",
            verified,
            b"credential-1",
        ),
        assertion(
            whatsapp_client_data(),
            "whatsapp.com",
            verified,
            b"credential-2",
        ),
        truncated,
        garbled_client_data,
    ] {
        assert_eq!(
            verify_assertion(&options, &credential),
            Err(AuthenticationError::Unavailable),
            "{credential:?}"
        );
    }
}
