use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

fn client(server: &MockServer) -> GmailClient {
    GmailClient::new_with_urls(
        String::new(),
        server.uri(),
        server.uri(),
        format!("{}/certs", server.uri()),
        String::new(),
    )
}

#[tokio::test]
async fn jwks_parses_quoted_case_insensitive_cache_max_age() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/certs"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("Cache-Control", "public, MAX-AGE=\"3600\", must-revalidate")
                .set_body_json(serde_json::json!({
                    "keys": [{
                        "kid": "key-1", "alg": "RS256", "kty": "RSA",
                        "n": "modulus", "e": "AQAB"
                    }]
                })),
        )
        .mount(&server)
        .await;

    let keys = fetch_google_public_keys(&client(&server))
        .await
        .expect("JWKS should decode");

    assert_eq!(keys.max_age_seconds, 3600);
    assert_eq!(keys.keys["key-1"].kid, "key-1");
}

#[tokio::test]
async fn jwks_defaults_to_zero_for_invalid_cache_control() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/certs"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("Cache-Control", "max-age=invalid")
                .set_body_json(serde_json::json!({
                    "keys": [{
                        "kid": "key-1", "alg": "RS256", "kty": "RSA",
                        "n": "modulus", "e": "AQAB"
                    }]
                })),
        )
        .mount(&server)
        .await;

    let keys = fetch_google_public_keys(&client(&server))
        .await
        .expect("JWKS should decode");
    assert_eq!(keys.max_age_seconds, 0);
}
