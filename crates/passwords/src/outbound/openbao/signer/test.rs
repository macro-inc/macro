use super::*;
use axum::{
    Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use base64::engine::general_purpose::STANDARD;
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use p256::{
    ecdsa::{Signature, SigningKey, signature::hazmat::PrehashSigner},
    pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding},
};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};

const KEY_ARN: &str = "arn:aws:kms:us-east-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab";

fn fixed_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32].into()).expect("fixed P-256 scalar")
}

fn public_pem(key: &SigningKey) -> String {
    key.verifying_key()
        .to_public_key_pem(LineEnding::LF)
        .expect("public key PEM")
}

fn validation() -> Validation {
    let mut validation = Validation::new(Algorithm::ES256);
    validation.set_audience(&["macro-passwords"]);
    validation.set_issuer(&["macro-local-passwords"]);
    validation
}

fn claims() -> serde_json::Value {
    let now = chrono::Utc::now().timestamp();
    serde_json::json!({
        "iss": "macro-local-passwords",
        "sub": "macro-passwords-service",
        "aud": "macro-passwords",
        "team_id": "0195f6a4-1f6e-7c1a-8d55-0a0b0c0d0e0f",
        "iat": now,
        "exp": now + 60,
        "audit_id": "4bf92f3577b34da6a3ce929d0e0e4736",
    })
}

#[test]
fn der_with_a_33_byte_r_and_a_low_s_converts_to_raw_r_and_s() {
    let mut der = vec![0x30, 0x45, 0x02, 0x21, 0x00];
    der.extend([0x90; 32]);
    der.extend([0x02, 0x20]);
    der.extend([0x22; 32]);

    let mut expected = [0u8; 64];
    expected[..32].copy_from_slice(&[0x90; 32]);
    expected[32..].copy_from_slice(&[0x22; 32]);
    assert_eq!(der_to_raw(&der), Ok(expected));
}

#[test]
fn der_with_a_31_byte_r_is_left_padded_to_32_bytes() {
    let mut der = vec![0x30, 0x43, 0x02, 0x1f];
    der.extend([0x11; 31]);
    der.extend([0x02, 0x20]);
    der.extend([0x22; 32]);

    let mut expected = [0u8; 64];
    expected[1..32].copy_from_slice(&[0x11; 31]);
    expected[32..].copy_from_slice(&[0x22; 32]);
    assert_eq!(der_to_raw(&der), Ok(expected));
}

#[test]
fn der_with_a_high_s_is_normalized_to_the_low_half() {
    let mut der = vec![0x30, 0x45, 0x02, 0x20];
    der.extend([0x22; 32]);
    der.extend([0x02, 0x21, 0x00]);
    der.extend([0x80; 32]);

    let high = Signature::from_scalars([0x22; 32], [0x80; 32]).expect("valid scalars");
    let low = high.normalize_s().expect("0x80.. is above n/2");
    let raw = der_to_raw(&der).expect("valid DER");
    assert_eq!(&raw[..], &low.to_bytes()[..]);
    assert_ne!(&raw[32..], &[0x80; 32]);
}

#[test]
fn malformed_der_is_an_invalid_signature() {
    assert_eq!(der_to_raw(&[]), Err(SignError::InvalidSignature));
    assert_eq!(
        der_to_raw(&[0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01]),
        Err(SignError::InvalidSignature)
    );
    let mut raw_not_der = vec![0x90; 32];
    raw_not_der.extend([0x22; 32]);
    assert_eq!(der_to_raw(&raw_not_der), Err(SignError::InvalidSignature));
}

#[tokio::test]
async fn es256_jwt_verifies_against_the_public_key_only() {
    let key = fixed_key();
    let signer = LocalJwtSigner::new(key.clone());
    let jwt = es256_jwt(&signer, &claims()).await.expect("JWT");

    let header = jsonwebtoken::decode_header(&jwt).expect("header");
    assert_eq!(header.alg, Algorithm::ES256);
    assert_eq!(header.typ.as_deref(), Some("JWT"));

    let decoded = jsonwebtoken::decode::<serde_json::Value>(
        &jwt,
        &DecodingKey::from_ec_pem(public_pem(&key).as_bytes()).expect("decoding key"),
        &validation(),
    )
    .expect("verifies with the public key");
    assert_eq!(decoded.claims, claims());

    let other = SigningKey::from_bytes(&[9u8; 32].into()).expect("other scalar");
    assert!(
        jsonwebtoken::decode::<serde_json::Value>(
            &jwt,
            &DecodingKey::from_ec_pem(public_pem(&other).as_bytes()).expect("decoding key"),
            &validation(),
        )
        .is_err(),
        "another key's public half must not verify it"
    );
}

#[tokio::test]
async fn a_tampered_es256_jwt_fails_verification() {
    let key = fixed_key();
    let jwt = es256_jwt(&LocalJwtSigner::new(key.clone()), &claims())
        .await
        .expect("JWT");
    let mut parts: Vec<String> = jwt.split('.').map(str::to_owned).collect();
    let mut tampered_claims = claims();
    tampered_claims["team_id"] = "0195f6a4-1f6e-7c1a-8d55-ffffffffffff".into();
    parts[1] = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&tampered_claims).expect("claims"));
    let tampered = parts.join(".");

    assert!(
        jsonwebtoken::decode::<serde_json::Value>(
            &tampered,
            &DecodingKey::from_ec_pem(public_pem(&key).as_bytes()).expect("decoding key"),
            &validation(),
        )
        .is_err()
    );
}

#[tokio::test]
async fn local_signer_reads_a_pkcs8_pem_and_rejects_anything_else() {
    let key = fixed_key();
    let pem = key.to_pkcs8_pem(LineEnding::LF).expect("PKCS#8 PEM");
    let signer = LocalJwtSigner::from_pkcs8_pem(&pem).expect("parses");
    let jwt = es256_jwt(&signer, &claims()).await.expect("JWT");
    jsonwebtoken::decode::<serde_json::Value>(
        &jwt,
        &DecodingKey::from_ec_pem(public_pem(&key).as_bytes()).expect("decoding key"),
        &validation(),
    )
    .expect("same key");

    assert!(matches!(
        LocalJwtSigner::from_pkcs8_pem("not a PKCS#8 PEM document"),
        Err(SignError::InvalidKey)
    ));
}

#[test]
fn key_ids_must_be_key_arns_outside_local_stacks() {
    assert_eq!(
        KmsKeyId::parse(KEY_ARN, false).expect("key ARN").as_str(),
        KEY_ARN
    );
    assert_eq!(
        KmsKeyId::parse("alias/macro-local-passwords-jwt", false),
        Err(KmsKeyIdError::NotKeyArn)
    );
    assert_eq!(
        KmsKeyId::parse(
            "arn:aws:kms:us-east-1:111122223333:alias/passwords-jwt-dev",
            false
        ),
        Err(KmsKeyIdError::NotKeyArn)
    );
    assert_eq!(
        KmsKeyId::parse("1234abcd-12ab-34cd-56ef-1234567890ab", false),
        Err(KmsKeyIdError::NotKeyArn)
    );
    assert_eq!(
        KmsKeyId::parse(&format!("{KEY_ARN} "), false),
        Err(KmsKeyIdError::NotKeyArn)
    );
    assert_eq!(KmsKeyId::parse("", true), Err(KmsKeyIdError::NotKeyArn));
}

#[test]
fn local_stacks_may_name_the_key_by_alias() {
    assert_eq!(
        KmsKeyId::parse("alias/macro-local-passwords-jwt", true)
            .expect("local alias")
            .as_str(),
        "alias/macro-local-passwords-jwt"
    );
    assert_eq!(
        KmsKeyId::parse(KEY_ARN, true).expect("key ARN").as_str(),
        KEY_ARN
    );
    assert_eq!(
        KmsKeyId::parse("alias/", true),
        Err(KmsKeyIdError::NotKeyArn)
    );
}

/// A KMS stand-in that records each `Sign` request and answers with the DER
/// signature of the digest it was sent, as real KMS does for `MessageType::Digest`.
struct FakeKms {
    key: SigningKey,
    requests: Mutex<Vec<(String, serde_json::Value)>>,
    respond: Mutex<Option<(StatusCode, serde_json::Value)>>,
}

async fn fake_kms(
    State(kms): State<Arc<FakeKms>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let target = headers
        .get("x-amz-target")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    let request: serde_json::Value = serde_json::from_slice(&body).expect("JSON body");
    kms.requests
        .lock()
        .expect("requests")
        .push((target, request.clone()));

    if let Some((status, body)) = kms.respond.lock().expect("respond").take() {
        return (status, axum::Json(body)).into_response();
    }

    let digest = STANDARD
        .decode(request["Message"].as_str().expect("Message"))
        .expect("base64 digest");
    let signature: Signature = kms.key.sign_prehash(&digest).expect("prehash sign");
    axum::Json(serde_json::json!({
        "KeyId": KEY_ARN,
        "Signature": STANDARD.encode(signature.to_der().as_bytes()),
        "SigningAlgorithm": "ECDSA_SHA_256",
    }))
    .into_response()
}

async fn kms_signer() -> (Arc<FakeKms>, KmsJwtSigner, tokio::task::JoinHandle<()>) {
    let kms = Arc::new(FakeKms {
        key: fixed_key(),
        requests: Mutex::new(Vec::new()),
        respond: Mutex::new(None),
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener");
    let address = listener.local_addr().expect("address");
    let app = Router::new().fallback(fake_kms).with_state(kms.clone());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.expect("server") });
    let config = aws_sdk_kms::Config::builder()
        .behavior_version(aws_sdk_kms::config::BehaviorVersion::latest())
        .region(aws_sdk_kms::config::Region::new("us-east-1"))
        .credentials_provider(aws_sdk_kms::config::Credentials::new(
            "synthetic",
            "synthetic",
            None,
            None,
            "test",
        ))
        .endpoint_url(format!("http://{address}"))
        .build();
    let signer = KmsJwtSigner::new(
        aws_sdk_kms::Client::from_conf(config),
        KmsKeyId::parse(KEY_ARN, false).expect("key ARN"),
    );
    (kms, signer, server)
}

#[tokio::test]
async fn kms_signs_a_locally_computed_digest_and_the_jwt_verifies() {
    let (kms, signer, server) = kms_signer().await;
    let jwt = es256_jwt(&signer, &claims()).await.expect("JWT");

    let signing_input = jwt.rsplit_once('.').expect("three parts").0;
    let requests = kms.requests.lock().expect("requests").clone();
    assert_eq!(requests.len(), 1, "one Sign per JWT");
    let (target, request) = &requests[0];
    assert_eq!(target, "TrentService.Sign");
    assert_eq!(
        request,
        &serde_json::json!({
            "KeyId": KEY_ARN,
            "Message": STANDARD.encode(Sha256::digest(signing_input.as_bytes())),
            "MessageType": "DIGEST",
            "SigningAlgorithm": "ECDSA_SHA_256",
        })
    );

    jsonwebtoken::decode::<serde_json::Value>(
        &jwt,
        &DecodingKey::from_ec_pem(public_pem(&fixed_key()).as_bytes()).expect("decoding key"),
        &validation(),
    )
    .expect("the KMS key's public half verifies the JWT");
    server.abort();
}

#[tokio::test]
async fn kms_refusal_is_unavailable_and_garbage_is_invalid() {
    let (kms, signer, server) = kms_signer().await;

    *kms.respond.lock().expect("respond") = Some((
        StatusCode::BAD_REQUEST,
        serde_json::json!({
            "__type": "AccessDeniedException",
            "message": "User is not authorized to perform: kms:Sign",
        }),
    ));
    assert_eq!(
        signer.sign(b"header.claims").await,
        Err(SignError::Unavailable)
    );

    *kms.respond.lock().expect("respond") = Some((
        StatusCode::OK,
        serde_json::json!({
            "KeyId": KEY_ARN,
            "Signature": STANDARD.encode([0x90u8; 64]),
            "SigningAlgorithm": "ECDSA_SHA_256",
        }),
    ));
    assert_eq!(
        signer.sign(b"header.claims").await,
        Err(SignError::InvalidSignature)
    );
    server.abort();
}

#[tokio::test]
#[ignore = "requires LocalStack on PASSWORDS_TEST_LOCALSTACK_URL"]
#[expect(
    clippy::disallowed_methods,
    reason = "disposable fixture requires an explicit LocalStack endpoint"
)]
async fn localstack_kms_key_signs_jwts_its_public_key_verifies() {
    use aws_sdk_kms::types::{KeySpec, KeyUsageType};
    use p256::pkcs8::DecodePublicKey;
    let url = std::env::var("PASSWORDS_TEST_LOCALSTACK_URL").expect("LocalStack URL");
    let config = macro_aws_config::local_aws_config(&url).await;
    let client = aws_sdk_kms::Client::new(&config);
    let created = client
        .create_key()
        .key_spec(KeySpec::EccNistP256)
        .key_usage(KeyUsageType::SignVerify)
        .description("passwords JWT signer test (disposable)")
        .send()
        .await
        .expect("create key");
    let arn = created
        .key_metadata()
        .and_then(|metadata| metadata.arn())
        .expect("key ARN")
        .to_owned();
    let public_der = client
        .get_public_key()
        .key_id(&arn)
        .send()
        .await
        .expect("public key")
        .public_key()
        .expect("public key bytes")
        .clone()
        .into_inner();
    let public = p256::PublicKey::from_public_key_der(&public_der).expect("SPKI DER");
    let pem = public.to_public_key_pem(LineEnding::LF).expect("PEM");

    let signer = KmsJwtSigner::new(client, KmsKeyId::parse(&arn, false).expect("ARN"));
    let jwt = es256_jwt(&signer, &claims()).await.expect("JWT");
    jsonwebtoken::decode::<serde_json::Value>(
        &jwt,
        &DecodingKey::from_ec_pem(pem.as_bytes()).expect("decoding key"),
        &validation(),
    )
    .expect("verifies with GetPublicKey");
}
