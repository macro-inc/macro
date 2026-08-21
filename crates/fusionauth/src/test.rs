use super::*;

#[test]
fn oauth_authorize_url_uses_public_url() {
    let client = FusionAuthClient::new(
        "api-key".into(),
        "client-id".into(),
        "client-secret".into(),
        "http://fusionauth:9011".into(),
        "http://localhost:28011/oauth/redirect".into(),
        "google-client-id".into(),
        "google-client-secret".into(),
    )
    .with_public_url("http://localhost:28005".into());

    let url = client
        .construct_oauth2_authorize_url::<()>("idp-id", None, None)
        .unwrap();

    assert!(url.starts_with("http://localhost:28005/oauth2/authorize?"));
    assert!(!url.contains("fusionauth:9011"));
}
