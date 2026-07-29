use super::*;

#[test]
fn oauth_authorize_url_uses_public_url() {
    let client = FusionAuthClient::new(
        "tenant-id".into(),
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
fn named_instance_ports_do_not_infer_the_tenant_header() {
    assert!(should_infer_local_tenant_header("http://fusionauth:9011"));
    assert!(should_infer_local_tenant_header("http://localhost:9011"));

    assert!(!should_infer_local_tenant_header("http://localhost:28005"));
    assert!(!should_infer_local_tenant_header("http://localhost:28006"));
    assert!(!should_infer_local_tenant_header("http://localhost:28008"));
    assert!(!should_infer_local_tenant_header("http://localhost:28009"));
    assert!(!should_infer_local_tenant_header("http://localhost:28010"));
}

#[test]
fn tenant_header_is_explicitly_configurable() {
    let without_tenant = auth_headers("api-key".into(), "tenant-id".into(), false);
    assert!(!without_tenant.contains_key(FUSIONAUTH_TENANT_ID_HEADER));

    let with_tenant = auth_headers("api-key".into(), "tenant-id".into(), true);
    assert_eq!(with_tenant[FUSIONAUTH_TENANT_ID_HEADER], "tenant-id");
}
