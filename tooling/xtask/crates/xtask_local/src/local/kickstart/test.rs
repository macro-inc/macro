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
        None,
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

/// A no-Doppler stack fills these with placeholders so the service's config
/// loader is satisfied. Building the provider from them would bake a broken
/// FusionAuth config into the init snapshot, which reads as a *configured*
/// GitHub connector that fails at the callback rather than an absent one.
#[test]
fn github_idp_requires_a_real_client() {
    assert!(GithubIdp::from_env(&env(&[])).is_none());
    assert!(
        GithubIdp::from_env(&env(&[
            ("GITHUB_CLIENT_ID", "local-github-client"),
            ("GITHUB_CLIENT_SECRET", "local-github-client-secret"),
        ]))
        .is_none()
    );
    assert!(
        GithubIdp::from_env(&env(&[
            ("GITHUB_CLIENT_ID", "Iv23livpJoVJw98dlKCk"),
            ("GITHUB_CLIENT_SECRET", "local-github-client-secret"),
        ]))
        .is_none()
    );
    assert!(
        GithubIdp::from_env(&env(&[
            ("GITHUB_CLIENT_ID", ""),
            ("GITHUB_CLIENT_SECRET", "realsecret"),
        ]))
        .is_none()
    );

    let ok = GithubIdp::from_env(&env(&[
        ("GITHUB_CLIENT_ID", "Iv23livpJoVJw98dlKCk"),
        ("GITHUB_CLIENT_SECRET", "a-real-github-secret"),
    ]))
    .expect("a real github client must parse");
    assert_eq!(ok.client_id, "Iv23livpJoVJw98dlKCk");
    assert_eq!(ok.client_secret, "a-real-github-secret");
    // No Doppler layer, so the local constant stands in.
    assert_eq!(ok.idp_id, identity::GITHUB_IDP_ID);
}

/// `authentication_service` reads `GITHUB_IDP_ID` as config and Doppler
/// overrides it with the dev instance's id. Creating the provider at our own
/// constant instead would put it somewhere the service never looks: starting a
/// link (by name) would work while every link call addressed nothing.
#[test]
fn the_github_idp_id_follows_the_env_the_service_reads() {
    let github = GithubIdp::from_env(&env(&[
        ("GITHUB_CLIENT_ID", "Iv23livpJoVJw98dlKCk"),
        ("GITHUB_CLIENT_SECRET", "a-real-github-secret"),
        ("GITHUB_IDP_ID", "c8014fe7-aeb4-4898-a460-4047e0fdf6d8"),
    ]))
    .expect("a real github client must parse");
    assert_eq!(github.idp_id, "c8014fe7-aeb4-4898-a460-4047e0fdf6d8");

    let doc = build(
        3000,
        8080,
        "function populate() {}",
        "function reconcile() {}",
        None,
        Some(&github),
    );
    assert!(
        doc["requests"]
            .as_array()
            .expect("requests")
            .iter()
            .any(|request| request["url"].as_str()
                == Some("/api/identity-provider/c8014fe7-aeb4-4898-a460-4047e0fdf6d8"))
    );
}

/// `authentication_service` resolves this provider by name to start a link and
/// then addresses it by `GITHUB_IDP_ID` for the link itself, so one provider
/// has to answer to both or the two halves address different things.
#[test]
fn the_github_idp_is_created_under_both_the_name_and_the_id_the_service_uses() {
    let github = GithubIdp {
        client_id: "Iv23livpJoVJw98dlKCk".to_string(),
        client_secret: "a-real-github-secret".to_string(),
        idp_id: identity::GITHUB_IDP_ID.to_string(),
    };
    let doc = build(
        3000,
        8080,
        "function populate() {}",
        "function reconcile() {}",
        None,
        Some(&github),
    );

    let requests = doc["requests"].as_array().expect("requests");
    let idp = requests
        .iter()
        .find(|request| {
            request["url"]
                .as_str()
                .is_some_and(|url| url.ends_with(identity::GITHUB_IDP_ID))
        })
        .expect("the github identity provider must be created at its fixed id");

    let provider = &idp["body"]["identityProvider"];
    assert_eq!(provider["name"], "github");
    // FusionAuth has no GitHub provider type; it rejects one outright.
    assert_eq!(provider["type"], "OpenIDConnect");
    assert_eq!(provider["enabled"], true);
    // The provider and the service must share one OAuth client.
    assert_eq!(provider["oauth2"]["client_id"], "Iv23livpJoVJw98dlKCk");
    assert_eq!(provider["oauth2"]["client_secret"], "a-real-github-secret");
    assert_eq!(
        provider["applicationConfiguration"][identity::APPLICATION_ID]["enabled"],
        true
    );
}

/// Absent client, absent provider - the connector is plainly unavailable
/// rather than misconfigured.
#[test]
fn kickstart_without_github_creates_no_github_idp() {
    let doc = build(
        3000,
        8080,
        "function populate() {}",
        "function reconcile() {}",
        None,
        None,
    );

    assert!(
        !doc["requests"]
            .as_array()
            .expect("requests")
            .iter()
            .any(|request| request["url"]
                .as_str()
                .is_some_and(|url| url.contains(identity::GITHUB_IDP_ID)))
    );
}
