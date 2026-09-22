use super::*;
use crate::domain::model::{LeaseState, Voice, VoiceSessionId};
use livekit_api::access_token::TokenVerifier;
use macro_user_id::cowlike::CowLike;

#[test]
fn browser_token_is_room_scoped_and_microphone_only() {
    let media = LivekitVoiceMedia::new(
        "https://voice.example",
        "test-key".into(),
        "test-secret".into(),
        "https://agent.example/agent-harness",
        "macro-agent-voice-test".into(),
    )
    .unwrap();
    let lease = VoiceLease {
        session_id: macro_uuid::generate_uuid_v7(),
        voice_session_id: VoiceSessionId(macro_uuid::generate_uuid_v7()),
        owner: macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|alice@example.com")
            .unwrap()
            .into_owned(),
        client_session_id: macro_uuid::generate_uuid_v7(),
        voice: Voice::Marin,
        expires_at: chrono::Utc::now() + chrono::Duration::minutes(30),
        state: LeaseState::Active,
    };
    let token = media.token(&lease, 300).unwrap();
    let claims = TokenVerifier::with_api_key("test-key", "test-secret")
        .verify(&token)
        .unwrap();
    assert_eq!(claims.sub, lease.participant_identity());
    assert_eq!(claims.video.room, lease.room_name());
    assert_eq!(claims.video.can_publish_sources, vec!["microphone"]);
    assert!(!claims.video.room_admin && !claims.video.room_create && !claims.video.room_record);
    assert!(claims.video.can_publish_data && claims.video.can_subscribe);
    assert!(claims.exp - claims.nbf <= 300);
    assert_eq!(media.url(), "wss://voice.example/");
}

#[test]
fn invalid_media_configuration_fails_before_serving_requests() {
    for url in [
        "file:///tmp/voice",
        "https://user:password@voice.example",
        "wss://voice.example?token=secret",
        "https://voice.example/#fragment",
        "",
    ] {
        assert!(
            LivekitVoiceMedia::new(
                url,
                "key".into(),
                "secret".into(),
                "https://agent.example",
                "macro-agent-voice-test".into(),
            )
            .is_err()
        );
    }
    assert!(
        LivekitVoiceMedia::new(
            "https://voice.example",
            "".into(),
            "secret".into(),
            "https://agent.example",
            "macro-agent-voice-test".into(),
        )
        .is_err()
    );
    assert!(
        LivekitVoiceMedia::new(
            "https://voice.example",
            "key".into(),
            "  ".into(),
            "https://agent.example",
            "macro-agent-voice-test".into(),
        )
        .is_err()
    );
}

#[test]
fn worker_identity_requires_a_valid_signed_room_grant() {
    let media = LivekitVoiceMedia::new(
        "https://voice.example",
        "test-key".into(),
        "test-secret".into(),
        "https://agent.example",
        "macro-agent-voice-test".into(),
    )
    .unwrap();
    let token = |secret: &str, join: bool| {
        AccessToken::with_api_key("test-key", secret)
            .with_identity("voice-agent-test")
            .with_ttl(Duration::from_secs(60))
            .with_grants(VideoGrants {
                room_join: join,
                room: "private-room".to_owned(),
                ..Default::default()
            })
            .to_jwt()
            .unwrap()
    };
    assert!(media.verify_worker(&token("wrong-secret", true)).is_err());
    assert!(media.verify_worker(&token("test-secret", false)).is_err());
    let identity = media.verify_worker(&token("test-secret", true)).unwrap();
    assert_eq!(identity.identity, "voice-agent-test");
    assert_eq!(identity.room_name, "private-room");
}
