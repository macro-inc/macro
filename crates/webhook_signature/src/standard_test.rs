use super::*;

/// The reference vector the Standard Webhooks libraries test against, so the
/// scheme can never drift from what MCP gateways and receivers verify.
const REFERENCE_SECRET: &str = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const REFERENCE_ID: &str = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const REFERENCE_TIMESTAMP: i64 = 1_614_265_330;
const REFERENCE_BODY: &[u8] = br#"{"test": 2432232314}"#;
const REFERENCE_SIGNATURE: &str = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";

fn reference_secret() -> SigningSecret {
    SigningSecret::parse(REFERENCE_SECRET).unwrap()
}

#[test]
fn signs_the_reference_vector() {
    let signature = reference_secret()
        .sign(REFERENCE_ID, REFERENCE_TIMESTAMP, REFERENCE_BODY)
        .unwrap();
    assert_eq!(signature, REFERENCE_SIGNATURE);
}

#[test]
fn verifies_the_reference_vector() {
    assert!(reference_secret().verify(
        REFERENCE_ID,
        REFERENCE_TIMESTAMP,
        REFERENCE_BODY,
        REFERENCE_SIGNATURE,
    ));
}

#[test]
fn tampering_fails_verification() {
    let secret = reference_secret();
    let other =
        SigningSecret::parse(&format!("{SECRET_PREFIX}{}", BASE64.encode([7u8; 32]))).unwrap();
    assert!(!secret.verify(
        REFERENCE_ID,
        REFERENCE_TIMESTAMP,
        b"{}",
        REFERENCE_SIGNATURE
    ));
    assert!(!secret.verify(
        "msg_other",
        REFERENCE_TIMESTAMP,
        REFERENCE_BODY,
        REFERENCE_SIGNATURE
    ));
    assert!(!secret.verify(
        REFERENCE_ID,
        REFERENCE_TIMESTAMP + 1,
        REFERENCE_BODY,
        REFERENCE_SIGNATURE
    ));
    assert!(!other.verify(
        REFERENCE_ID,
        REFERENCE_TIMESTAMP,
        REFERENCE_BODY,
        REFERENCE_SIGNATURE
    ));
}

#[test]
fn rejects_malformed_signature_entries() {
    let secret = reference_secret();
    let digest = REFERENCE_SIGNATURE.trim_start_matches("v1,");
    for header in [
        "",
        "v1,",
        "v1,!!!",
        digest,
        &format!("v1a,{digest}"),
        &format!("v2,{digest}"),
    ] {
        assert!(
            !secret.verify(REFERENCE_ID, REFERENCE_TIMESTAMP, REFERENCE_BODY, header),
            "{header:?} must not verify"
        );
    }
}

#[test]
fn any_rotated_signature_verifies() {
    let header = format!("v1,AAAA v1a,ignored {REFERENCE_SIGNATURE}");
    assert!(reference_secret().verify(REFERENCE_ID, REFERENCE_TIMESTAMP, REFERENCE_BODY, &header));
}

#[test]
fn parses_only_whsec_keys_of_24_to_64_bytes() {
    let encoded = |len: usize| format!("{SECRET_PREFIX}{}", BASE64.encode(vec![1u8; len]));
    assert!(SigningSecret::parse(&encoded(MIN_SECRET_BYTES)).is_ok());
    assert!(SigningSecret::parse(&encoded(MAX_SECRET_BYTES)).is_ok());
    assert_eq!(
        SigningSecret::parse(&encoded(MIN_SECRET_BYTES - 1)).unwrap_err(),
        SecretError::InvalidLength
    );
    assert_eq!(
        SigningSecret::parse(&encoded(MAX_SECRET_BYTES + 1)).unwrap_err(),
        SecretError::InvalidLength
    );
    assert_eq!(
        SigningSecret::parse("MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw").unwrap_err(),
        SecretError::MissingPrefix
    );
    assert_eq!(
        SigningSecret::parse("whsec_not base64!").unwrap_err(),
        SecretError::InvalidBase64
    );
}

#[test]
fn round_trips_the_whsec_form() {
    assert_eq!(&*reference_secret().expose(), REFERENCE_SECRET);
}

#[test]
fn debug_redacts_the_key() {
    let debug = format!("{:?}", reference_secret());
    assert_eq!(debug, "SigningSecret([REDACTED])");
}
