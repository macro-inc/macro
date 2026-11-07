use super::*;

const SECRET: &[u8] = b"a distinct installation state test secret";
const NOW: i64 = 1_730_000_000;

fn user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|installer@example.com".to_string()).unwrap()
}

fn state(team_id: Option<Uuid>, exp: i64) -> InstallationState {
    InstallationState {
        macro_user_id: user_id(),
        team_id,
        exp,
    }
}

fn sign_raw_payload(payload: &[u8]) -> String {
    let encoded_payload = URL_SAFE_NO_PAD.encode(payload);
    let signature = signature_for(encoded_payload.as_bytes(), SECRET);
    format!("{encoded_payload}.{}", URL_SAFE_NO_PAD.encode(signature))
}

#[test]
fn team_payload_round_trips_deterministically() {
    let payload = state(
        Some(Uuid::parse_str("8c06ab3e-693c-45a7-8f92-1b5a5bf876ac").unwrap()),
        NOW + 3_600,
    );

    let first_token = sign_installation_state(&payload, SECRET).unwrap();
    let second_token = sign_installation_state(&payload, SECRET).unwrap();

    assert_eq!(first_token, second_token);
    assert!(!first_token.contains('='));
    assert_eq!(
        verify_installation_state(&first_token, SECRET, NOW).unwrap(),
        payload
    );
}

#[test]
fn personal_payload_round_trips_without_team_field() {
    let payload = state(None, NOW + 3_600);
    let token = sign_installation_state(&payload, SECRET).unwrap();
    let encoded_payload = token.split_once('.').unwrap().0;
    let json = URL_SAFE_NO_PAD.decode(encoded_payload).unwrap();

    assert!(!String::from_utf8(json).unwrap().contains("team_id"));
    assert_eq!(
        verify_installation_state(&token, SECRET, NOW).unwrap(),
        payload
    );
}

#[test]
fn expiration_boundary_is_enforced() {
    let token = sign_installation_state(&state(None, NOW), SECRET).unwrap();

    assert_eq!(
        verify_installation_state(&token, SECRET, NOW - 1),
        Ok(state(None, NOW))
    );
    assert_eq!(
        verify_installation_state(&token, SECRET, NOW),
        Err(InstallationStateError::Expired)
    );
    assert_eq!(
        verify_installation_state(&token, SECRET, NOW + 1),
        Err(InstallationStateError::Expired)
    );
}

#[test]
fn malformed_tokens_are_rejected() {
    for token in [
        "",
        "payload",
        ".signature",
        "payload.",
        "payload.signature.extra",
        "%%%.signature",
        "payload.%%%",
    ] {
        assert!(
            verify_installation_state(token, SECRET, NOW).is_err(),
            "token should be rejected: {token}"
        );
    }

    let malformed_json = sign_raw_payload(b"not json");
    assert_eq!(
        verify_installation_state(&malformed_json, SECRET, NOW),
        Err(InstallationStateError::Malformed)
    );
}

#[test]
fn malformed_ids_are_rejected() {
    let malformed_team_id = sign_raw_payload(
        br#"{"macro_user_id":"macro|installer@example.com","team_id":"not-a-uuid","exp":1730003600}"#,
    );
    let malformed_user_id = sign_raw_payload(
        br#"{"macro_user_id":"not-a-macro-user","team_id":"8c06ab3e-693c-45a7-8f92-1b5a5bf876ac","exp":1730003600}"#,
    );

    assert_eq!(
        verify_installation_state(&malformed_team_id, SECRET, NOW),
        Err(InstallationStateError::Malformed)
    );
    assert_eq!(
        verify_installation_state(&malformed_user_id, SECRET, NOW),
        Err(InstallationStateError::Malformed)
    );
}

#[test]
fn payload_tampering_is_rejected() {
    let token = sign_installation_state(&state(None, NOW + 3_600), SECRET).unwrap();
    let (encoded_payload, encoded_signature) = token.split_once('.').unwrap();
    let mut json: serde_json::Value =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(encoded_payload).unwrap()).unwrap();
    json["exp"] = (NOW + 7_200).into();
    let tampered_payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&json).unwrap());
    let tampered_token = format!("{tampered_payload}.{encoded_signature}");

    assert_eq!(
        verify_installation_state(&tampered_token, SECRET, NOW),
        Err(InstallationStateError::InvalidSignature)
    );
}

#[test]
fn signature_tampering_and_wrong_secrets_are_rejected() {
    let token = sign_installation_state(&state(None, NOW + 3_600), SECRET).unwrap();
    let (encoded_payload, encoded_signature) = token.split_once('.').unwrap();
    let mut signature = URL_SAFE_NO_PAD.decode(encoded_signature).unwrap();
    signature[0] ^= 1;
    let tampered_token = format!("{encoded_payload}.{}", URL_SAFE_NO_PAD.encode(signature));

    assert_eq!(
        verify_installation_state(&tampered_token, SECRET, NOW),
        Err(InstallationStateError::InvalidSignature)
    );
    assert_eq!(
        verify_installation_state(&token, b"wrong secret", NOW),
        Err(InstallationStateError::InvalidSignature)
    );
}
