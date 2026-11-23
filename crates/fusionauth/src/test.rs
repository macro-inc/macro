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

#[test]
fn oauth_authorize_url_passes_a_prompt_to_the_identity_provider() {
    let client = FusionAuthClient::new(
        "api-key".into(),
        "client-id".into(),
        "client-secret".into(),
        "http://fusionauth:9011".into(),
        "http://localhost:28011/oauth/redirect".into(),
        "google-client-id".into(),
        "google-client-secret".into(),
    );

    let with_prompt = client
        .construct_oauth2_authorize_url_with_prompt::<()>("idp-id", None, "select_account", None)
        .unwrap();
    let without = client
        .construct_oauth2_authorize_url::<()>("idp-id", None, None)
        .unwrap();

    let prompt = |url: &str| {
        Url::parse(url)
            .unwrap()
            .query_pairs()
            .find(|(key, _)| key == "prompt")
            .map(|(_, value)| value.into_owned())
    };
    assert_eq!(prompt(&with_prompt).as_deref(), Some("select_account"));
    assert_eq!(prompt(&without), None);
    assert!(with_prompt.contains("idp_hint=idp-id"));
}
