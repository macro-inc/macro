use super::*;
use jsonwebtoken::{EncodingKey, Header};
use serde_json::json;

fn signed_claims(algorithm: Algorithm, secret: &str, claims: &Value) -> String {
    jsonwebtoken::encode(
        &Header::new(algorithm),
        claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .unwrap()
}

fn signed(algorithm: Algorithm, secret: &str) -> String {
    signed_claims(
        algorithm,
        secret,
        &json!({"call_id": 42, "state": "hangup", "event_timestamp": 1_746_469_071_000_i64}),
    )
}

#[test]
fn only_our_secret_under_hs256_verifies() {
    let secret = SigningSecret("our-secret".into());
    let claims = JwtVerifier
        .verify(&secret, signed(Algorithm::HS256, "our-secret").as_bytes())
        .unwrap();
    assert_eq!(claims["call_id"], 42);
    assert_eq!(claims["state"], "hangup");

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

#[test]
fn an_optional_expiration_is_enforced() {
    let secret = SigningSecret("our-secret".into());
    let body = jsonwebtoken::encode(
        &Header::new(Algorithm::HS256),
        &json!({"call_id": 42, "state": "hangup", "exp": 1}),
        &EncodingKey::from_secret(secret.0.as_bytes()),
    )
    .unwrap();
    assert!(JwtVerifier.verify(&secret, body.as_bytes()).is_none());
}

#[test]
fn the_signature_is_checked_before_the_claims_are_read() {
    let secret = SigningSecret("our-secret".into());
    let unexpected = json!({"call_id": "not a number", "state": 7, "date_started": {}});
    let claims = JwtVerifier
        .verify(
            &secret,
            signed_claims(Algorithm::HS256, "our-secret", &unexpected).as_bytes(),
        )
        .unwrap();
    assert_eq!(claims, unexpected);
    assert!(
        JwtVerifier
            .verify(
                &secret,
                signed_claims(Algorithm::HS256, "other-secret", &unexpected).as_bytes(),
            )
            .is_none()
    );
}
