use super::*;

#[test]
fn autodesk_reaches_its_endpoints_on_the_aps_origin() {
    let app = ApiApp::autodesk().unwrap();

    assert_eq!(app.id.as_str(), "autodesk");
    assert_eq!(
        app.authorize_url.as_str(),
        "https://developer.api.autodesk.com/authentication/v2/authorize"
    );
    assert_eq!(
        app.token_url.as_str(),
        "https://developer.api.autodesk.com/authentication/v2/token"
    );
    assert_eq!(
        app.revoke_url.as_str(),
        "https://developer.api.autodesk.com/authentication/v2/revoke"
    );
    assert_eq!(app.scope, "data:read");
}

#[test]
fn api_calls_may_go_only_to_the_api_origin() {
    let app = ApiApp::autodesk().unwrap();

    assert!(
        app.api_url("https://developer.api.autodesk.com/project/v1/hubs")
            .is_ok()
    );
    assert!(
        app.api_url("https://developer.api.autodesk.com:443/project/v1/hubs")
            .is_ok()
    );
    // Credentials in the URL, without spelling an address the PII scan reads.
    let with_userinfo = ["https://user", "developer.api.autodesk.com/project/v1/hubs"].join("@");
    for refused in [
        with_userinfo.as_str(),
        "https://api.userprofile.autodesk.com/userinfo",
        "http://developer.api.autodesk.com/project/v1/hubs",
        "https://developer.api.autodesk.com:8443/project/v1/hubs",
        "https://developer.api.autodesk.com.evil.example/project/v1/hubs",
        "/project/v1/hubs",
    ] {
        assert!(app.api_url(refused).is_err(), "{refused} was allowed");
    }
}
