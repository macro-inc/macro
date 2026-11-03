use super::*;
use crate::domain::models::CallState;
use jsonwebtoken::{EncodingKey, Header};
use serde_json::json;

fn signed(algorithm: Algorithm, secret: &str) -> String {
    jsonwebtoken::encode(
        &Header::new(algorithm),
        &json!({"call_id": 42, "state": "hangup", "event_timestamp": 1_746_469_071_000_i64}),
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .unwrap()
}

#[test]
fn only_our_secret_under_hs256_verifies() {
    let secret = SigningSecret("our-secret".into());
    let event = JwtVerifier
        .verify(&secret, signed(Algorithm::HS256, "our-secret").as_bytes())
        .unwrap();
    assert_eq!(event.call_id.0, 42);
    assert_eq!(event.state, CallState::Hangup);

    for body in [
        signed(Algorithm::HS256, "other-secret"),
        signed(Algorithm::HS512, "our-secret"),
        r#"{"call_id":42,"state":"hangup"}"#.to_owned(),
    ] {
        assert!(
            JwtVerifier.verify(&secret, body.as_bytes()).is_none(),
            "{body}"
        );
    }
}
