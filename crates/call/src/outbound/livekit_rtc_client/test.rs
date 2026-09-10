use base64::Engine;
use livekit_api::access_token::AccessToken;
use livekit_api::services::{ServiceError, TwirpError, TwirpErrorCode};
use macro_user_id::user_id::MacroUserIdStr;
use sha2::{Digest, Sha256};

use super::*;
use crate::domain::models::CallError;
use crate::domain::ports::CallRtcClient as _;

const API_KEY: &str = "test-api-key";
const API_SECRET: &str = "test-api-secret-test-api-secret-test";

fn twirp(code: &str, msg: &str) -> ServiceError {
    ServiceError::Twirp(TwirpError::Twirp(TwirpErrorCode {
        code: code.to_string(),
        msg: msg.to_string(),
    }))
}

fn client() -> LivekitRtcClient {
    LivekitRtcClient::new("wss://lk.example", API_KEY, API_SECRET, None)
}

fn client_with_transcription_agent(agent_name: &str) -> LivekitRtcClient {
    LivekitRtcClient::new(
        "wss://lk.example",
        API_KEY,
        API_SECRET,
        Some(agent_name.to_owned()),
    )
}

fn sign_webhook(body: &str) -> String {
    let digest = Sha256::digest(body.as_bytes());
    let sha256 = base64::engine::general_purpose::STANDARD.encode(digest);
    AccessToken::with_api_key(API_KEY, API_SECRET)
        .with_sha256(&sha256)
        .to_jwt()
        .expect("webhook jwt")
}

fn participant_joined_body(identity: &str) -> String {
    serde_json::json!({
        "event": "participant_joined",
        "id": "EV_test",
        "createdAt": 1,
        "room": { "name": "room-1" },
        "participant": { "identity": identity }
    })
    .to_string()
}

fn receive_participant_joined(
    client: &LivekitRtcClient,
    identity: &str,
) -> Result<crate::domain::models::CallWebhookEvent, CallError> {
    let body = participant_joined_body(identity);
    let token = sign_webhook(&body);
    client.receive_webhook(&body, &token)
}

#[tokio::test]
async fn verify_access_token_round_trips_identity_and_room() {
    let client = client();
    let identity = MacroUserIdStr::try_from_email("alice@example.com").unwrap();

    let token = client
        .generate_token("room-1", identity.clone())
        .await
        .expect("token mint is pure JWT crypto, no network");

    let verified = client.verify_access_token(&token).expect("token verifies");
    assert_eq!(verified.identity, identity.as_ref());
    assert_eq!(verified.room.as_deref(), Some("room-1"));
}

#[tokio::test]
async fn verify_access_token_rejects_token_signed_with_a_different_secret() {
    let identity = MacroUserIdStr::try_from_email("alice@example.com").unwrap();
    let token = client()
        .generate_token("room-1", identity)
        .await
        .expect("token mint is pure JWT crypto, no network");

    let other = LivekitRtcClient::new(
        "wss://lk.example",
        "test-api-key",
        "a-completely-different-secret-value!",
        None,
    );
    assert!(other.verify_access_token(&token).is_err());
}

#[test]
fn verify_access_token_rejects_garbage() {
    assert!(client().verify_access_token("not-a-jwt").is_err());
}

#[test]
fn remove_participant_not_found_is_already_gone() {
    let error = twirp(TwirpErrorCode::NOT_FOUND, "participant does not exist");
    interpret_remove_participant_result(Err(error))
        .expect("leave must succeed when LiveKit already dropped the participant");
}

#[test]
fn remove_participant_room_not_found_is_already_gone() {
    let error = twirp(TwirpErrorCode::NOT_FOUND, "requested room does not exist");
    interpret_remove_participant_result(Err(error))
        .expect("leave must succeed when the LiveKit room is already gone");
}

#[test]
fn remove_participant_unavailable_still_fails() {
    let error = twirp(TwirpErrorCode::UNAVAILABLE, "overloaded");
    let message = interpret_remove_participant_result(Err(error))
        .expect_err("transient LiveKit failures must still surface")
        .to_string();
    assert_eq!(message, "twirp error: twirp error: unavailable: overloaded");
}

#[test]
fn receive_webhook_accepts_livekit_agent_participant_identity() {
    let event = receive_participant_joined(
        &client_with_transcription_agent("macro-transcriber"),
        "agent-AJ_CNFob6rwkHxK",
    )
    .expect("agent join must not fail webhook ingest");

    assert_eq!(event.event, "participant_joined");
    assert_eq!(event.room_name.as_deref(), Some("room-1"));
    assert_eq!(event.participant_identity, None);
}

#[test]
fn receive_webhook_parses_macro_user_participant_identity() {
    let event = receive_participant_joined(&client(), "macro|alice@example.com")
        .expect("user join must parse identity");

    assert_eq!(
        event
            .participant_identity
            .as_ref()
            .map(|identity| identity.as_ref()),
        Some("macro|alice@example.com")
    );
}

#[test]
fn receive_webhook_skips_configured_transcription_agent_name() {
    let event = receive_participant_joined(
        &client_with_transcription_agent("macro-transcriber"),
        "macro-transcriber",
    )
    .expect("configured agent name must not fail webhook ingest");

    assert_eq!(event.participant_identity, None);
}
