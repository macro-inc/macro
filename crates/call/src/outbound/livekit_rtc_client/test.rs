use livekit_api::services::{ServiceError, TwirpError, TwirpErrorCode};
use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use crate::domain::ports::CallRtcClient as _;

fn twirp(code: &str, msg: &str) -> ServiceError {
    ServiceError::Twirp(TwirpError::Twirp(TwirpErrorCode {
        code: code.to_string(),
        msg: msg.to_string(),
    }))
}

fn client() -> LivekitRtcClient {
    LivekitRtcClient::new(
        "wss://lk.example",
        "test-api-key",
        "test-api-secret-test-api-secret-test",
        None,
    )
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
