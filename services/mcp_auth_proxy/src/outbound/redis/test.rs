use super::*;

fn session(phase: LoginPhase) -> AuthorizationSession {
    AuthorizationSession {
        id: SessionId::new(),
        client: ClientCallback {
            code_challenge: "challenge".into(),
            client_state: "client-state".into(),
            client_redirect_uri: "http://127.0.0.1:54321/callback".into(),
        },
        phase,
    }
}

#[test]
fn current_session_json_has_a_phase_tag() {
    let session = session(LoginPhase::AwaitingOtp {
        email: crate::domain::models::Email::parse("person@example.com").unwrap(),
    });
    let json = serialize_session(&session).unwrap();
    let value: serde_json::Value = serde_json::from_str(&json).unwrap();

    assert_eq!(value["phase"]["kind"], "awaiting_otp");
    assert_eq!(deserialize_session(&session.id, &json).unwrap(), session);
}

#[test]
fn legacy_pending_json_defaults_to_google_upstream() {
    let session_id = SessionId::parse_compatible("9b458c32-0d2c-4a9b-89e6-164241642dbc").unwrap();
    let json = r#"{
        "code_challenge": "challenge",
        "client_state": "client-state",
        "client_redirect_uri": "http://127.0.0.1:54321/callback"
    }"#;

    let session = deserialize_session(&session_id, json).unwrap();

    assert_eq!(session.id, session_id);
    assert_eq!(
        session.phase,
        LoginPhase::AwaitingUpstream {
            identity_provider: IdentityProvider::GoogleGmail,
        }
    );
}
