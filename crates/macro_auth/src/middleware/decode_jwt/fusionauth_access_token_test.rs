use super::*;
use crate::macro_api_token::{EncodeMacroApiTokenArgs, encode_macro_api_token};

const FUSIONAUTH_SECRET: &str = "fusionauth-secret";
const ISSUED_AT: u64 = 1_700_000_000;
/// Base64url of `{"alg":"none","typ":"JWT"}`.
const NONE_ALGORITHM_HEADER: &str = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0";

fn args() -> JwtValidationArgs {
    JwtValidationArgs {
        audience: Audience::new_testing("macro-app"),
        issuer: Issuer::new_testing("auth.macro.test"),
        jwt_secret: LocalOrRemoteSecret::Local(JwtSecretKey::new_testing(FUSIONAUTH_SECRET)),
        macro_api_token_issuer: MacroApiTokenIssuer::new_testing("macro-api.test"),
        macro_api_token_public_key: LocalOrRemoteSecret::Local(
            MacroApiTokenPublicKey::new_testing(tests::PUBLIC_KEY),
        ),
    }
}

/// An expired access token FusionAuth issued for this application without the Macro claims.
fn claims_without_macro_claims() -> serde_json::Value {
    serde_json::json!({
        "aud": "macro-app", "exp": ISSUED_AT + 3600, "iat": ISSUED_AT, "iss": "auth.macro.test",
        "sub": "fusion-user", "tid": "tenant", "email": "user@example.com",
        "applicationId": "macro-app", "roles": [],
    })
}

fn with(claim: &str, value: serde_json::Value) -> serde_json::Value {
    let mut claims = claims_without_macro_claims();
    claims[claim] = value;
    claims
}

fn without(claim: &str) -> serde_json::Value {
    let mut claims = claims_without_macro_claims();
    claims.as_object_mut().unwrap().remove(claim);
    claims
}

fn sign(algorithm: Algorithm, secret: &str, claims: &serde_json::Value) -> String {
    let mut header = jsonwebtoken::Header::new(algorithm);
    header.kid = Some("fusionauth-key".into());
    jsonwebtoken::encode(
        &header,
        claims,
        &jsonwebtoken::EncodingKey::from_secret(secret.as_bytes()),
    )
    .unwrap()
}

#[test]
fn token_without_macro_claims_is_recognized_as_issued_for_this_application() {
    let expired = sign(
        Algorithm::HS256,
        FUSIONAUTH_SECRET,
        &claims_without_macro_claims(),
    );
    let unexpired = sign(
        Algorithm::HS256,
        FUSIONAUTH_SECRET,
        &with("exp", 4_102_444_800_u64.into()),
    );

    for token in [&expired, &unexpired] {
        assert!(matches!(
            validate_macro_access_token(token, &args()),
            Err(MacroAuthError::JwtValidationFailed { .. })
        ));
        assert_eq!(
            validate_fusionauth_access_token_allow_expired(token, &args()).unwrap(),
            UNIX_EPOCH + Duration::from_secs(ISSUED_AT)
        );
    }
}

#[test]
fn tokens_not_issued_by_fusionauth_for_this_application_are_rejected() {
    let valid = sign(
        Algorithm::HS256,
        FUSIONAUTH_SECRET,
        &claims_without_macro_claims(),
    );
    assert!(validate_fusionauth_access_token_allow_expired(&valid, &args()).is_ok());
    let [header, payload, signature]: [&str; 3] =
        valid.split('.').collect::<Vec<_>>().try_into().unwrap();
    let other_user = sign(
        Algorithm::HS256,
        FUSIONAUTH_SECRET,
        &with("sub", "other-fusion-user".into()),
    );
    let other_payload = other_user.split('.').nth(1).unwrap();
    let macro_api_token = encode_macro_api_token(EncodeMacroApiTokenArgs {
        fusionauth_id: "fusion-user".into(),
        macro_user_id: "macro|user@example.com".into(),
        organization_id: None,
        issuer: "macro-api.test".into(),
        private_key: tests::PRIVATE_KEY.into(),
        expiry_seconds: 60,
        agent_id: None,
    })
    .unwrap();

    let hs256 = |claims: serde_json::Value| sign(Algorithm::HS256, FUSIONAUTH_SECRET, &claims);
    let cases = [
        (
            "signed with another secret",
            sign(
                Algorithm::HS256,
                "other-secret",
                &claims_without_macro_claims(),
            ),
        ),
        (
            "signed with HS512",
            sign(
                Algorithm::HS512,
                FUSIONAUTH_SECRET,
                &claims_without_macro_claims(),
            ),
        ),
        ("unsigned", format!("{NONE_ALGORITHM_HEADER}.{payload}.")),
        (
            "payload swapped under a valid signature",
            format!("{header}.{other_payload}.{signature}"),
        ),
        ("another audience", hs256(with("aud", "other-app".into()))),
        (
            "another issuer",
            hs256(with("iss", "other.issuer.test".into())),
        ),
        ("no audience", hs256(without("aud"))),
        ("no issuer", hs256(without("iss"))),
        ("no expiry", hs256(without("exp"))),
        ("no issued-at", hs256(without("iat"))),
        (
            "issued-at out of range",
            hs256(with("iat", u64::MAX.into())),
        ),
        ("Macro API token", macro_api_token),
        ("not a JWT", "not-a-jwt".into()),
    ];

    for (case, token) in cases {
        assert!(
            validate_fusionauth_access_token_allow_expired(&token, &args()).is_err(),
            "{case}"
        );
    }
}
