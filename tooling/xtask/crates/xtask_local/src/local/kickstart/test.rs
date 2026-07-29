use super::*;

fn env(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

#[test]
fn google_idp_requires_a_real_client_secret() {
    // The legacy Doppler placeholder is a Secrets-Manager key NAME, not a
    // secret — building IdPs from it would bake a broken FusionAuth config
    // into the init snapshot.
    assert!(
        GoogleIdp::from_env(&env(&[
            ("GOOGLE_CLIENT_ID", "abc.apps.googleusercontent.com"),
            ("GOOGLE_CLIENT_SECRET_KEY", "google-client-secret-dev"),
        ]))
        .is_none()
    );
    assert!(GoogleIdp::from_env(&env(&[])).is_none());
    assert!(
        GoogleIdp::from_env(&env(&[
            ("GOOGLE_CLIENT_ID", ""),
            ("GOOGLE_CLIENT_SECRET_KEY", "GOCSPX-real"),
        ]))
        .is_none()
    );

    let ok = GoogleIdp::from_env(&env(&[
        ("GOOGLE_CLIENT_ID", "abc.apps.googleusercontent.com"),
        ("GOOGLE_CLIENT_SECRET_KEY", "GOCSPX-real"),
    ]))
    .expect("a real client id + GOCSPX secret must parse");
    assert_eq!(ok.client_id, "abc.apps.googleusercontent.com");
    assert_eq!(ok.client_secret, "GOCSPX-real");
}

#[test]
fn kickstart_without_google_has_no_idp_requests() {
    let doc = build(
        3000,
        8080,
        "function populate() {}",
        "function reconcile() {}",
        None,
    );
    let urls: Vec<&str> = doc["requests"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["url"].as_str().unwrap())
        .collect();
    assert!(
        !urls.iter().any(|u| u.contains("/api/identity-provider")),
        "no Google client -> no IdP requests: {urls:?}"
    );
}

#[test]
fn kickstart_with_google_adds_lambda_and_both_idps_after_the_application() {
    let google = GoogleIdp {
        client_id: "abc.apps.googleusercontent.com".into(),
        client_secret: "GOCSPX-real".into(),
    };
    let doc = build(
        3000,
        8080,
        "function populate() {}",
        "function reconcile() {}",
        Some(&google),
    );
    let requests = doc["requests"].as_array().unwrap();

    let pos = |needle: &str| {
        requests
            .iter()
            .position(|r| r["url"].as_str().unwrap().contains(needle))
            .unwrap_or_else(|| panic!("missing request for {needle}"))
    };
    let app = pos(identity::APPLICATION_ID);
    let reconcile = pos(identity::RECONCILE_LAMBDA_ID);
    let google_idp = pos(identity::GOOGLE_IDP_ID);
    let gmail_idp = pos(identity::GOOGLE_GMAIL_IDP_ID);
    assert!(app < reconcile && reconcile < google_idp && google_idp < gmail_idp);

    let gmail = &requests[gmail_idp]["body"]["identityProvider"];
    assert_eq!(gmail["name"], "google_gmail");
    assert_eq!(
        gmail["lambdaConfiguration"]["reconcileId"],
        identity::RECONCILE_LAMBDA_ID
    );
    assert_eq!(
        gmail["oauth2"]["client_id"],
        "abc.apps.googleusercontent.com"
    );
    assert!(
        gmail["oauth2"]["scope"]
            .as_str()
            .unwrap()
            .contains("gmail.modify")
    );
    assert_eq!(
        gmail["applicationConfiguration"][identity::APPLICATION_ID]["createRegistration"],
        true
    );

    let plain = &requests[google_idp]["body"]["identityProvider"];
    assert_eq!(plain["name"], "google");
    assert_eq!(plain["oauth2"]["scope"], "openid profile email");
    assert!(plain["lambdaConfiguration"].is_null());
}

#[test]
fn kickstart_adopts_the_default_tenant() {
    let doc = build(
        3000,
        8080,
        "function populate() {}",
        "function reconcile() {}",
        None,
    );
    assert_eq!(
        doc["variables"]["defaultTenantId"],
        identity::TENANT_ID,
        "the built-in default tenant must be pinned to the fixed local id"
    );
    let tenant = doc["requests"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["url"].as_str().unwrap() == format!("/api/tenant/{}", identity::TENANT_ID))
        .expect("missing tenant request");
    assert_eq!(
        tenant["method"], "PATCH",
        "the tenant is reconfigured in place, not created — local stays single-tenant"
    );
}
