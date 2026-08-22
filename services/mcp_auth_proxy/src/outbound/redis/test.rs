use super::*;

fn session() -> AuthorizationSession {
    AuthorizationSession {
        id: SessionId::new(),
        client: ClientCallback {
            code_challenge: "challenge".into(),
            client_state: "client-state".into(),
            client_redirect_uri: "http://127.0.0.1:54321/callback".into(),
        },
    }
}

#[test]
fn current_session_json_round_trips() {
    let session = session();
    let json = serialize_session(&session).unwrap();
    assert_eq!(deserialize_session(&session.id, &json).unwrap(), session);
}

#[test]
fn session_json_with_a_legacy_phase_still_loads() {
    let session = session();
    let json = serde_json::json!({
        "id": session.id.as_str(),
        "client": {
            "code_challenge": "challenge",
            "client_state": "client-state",
            "client_redirect_uri": "http://127.0.0.1:54321/callback"
        },
        "phase": { "kind": "choosing_method" }
    })
    .to_string();

    assert_eq!(deserialize_session(&session.id, &json).unwrap(), session);
}

#[test]
fn legacy_pending_json_loads_as_a_client_callback() {
    let session_id = SessionId::parse_compatible("9b458c32-0d2c-4a9b-89e6-164241642dbc").unwrap();
    let json = r#"{
        "code_challenge": "challenge",
        "client_state": "client-state",
        "client_redirect_uri": "http://127.0.0.1:54321/callback"
    }"#;

    let session = deserialize_session(&session_id, json).unwrap();

    assert_eq!(session.id, session_id);
    assert_eq!(session.client.code_challenge, "challenge");
    assert_eq!(session.client.client_state, "client-state");
    assert_eq!(
        session.client.client_redirect_uri,
        "http://127.0.0.1:54321/callback"
    );
}
