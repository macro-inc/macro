use super::*;

#[test]
fn detects_oauth_errors_after_report_excerpt() {
    let body = format!("{}invalid_redirect_uri", "x".repeat(300));
    assert!(oauth_error_in_body(&body));
    assert!(!response_excerpt(&body).contains("invalid_redirect_uri"));
}

#[test]
fn redirect_to_error_is_not_a_login() {
    assert!(!is_login_redirect(
        &Url::parse("https://auth.vendor.test/oauth/error").unwrap()
    ));
    assert!(!is_login_redirect(
        &Url::parse("https://auth.vendor.test/oauth/unavailable").unwrap()
    ));
    assert!(!is_login_redirect(
        &Url::parse("https://accounts.vendor.test/oauth/authorize").unwrap()
    ));
    assert!(is_login_redirect(
        &Url::parse("https://auth.vendor.test/login").unwrap()
    ));
    assert!(is_login_redirect(
        &Url::parse("https://vendor.test/users/sign_in").unwrap()
    ));
    assert!(is_login_redirect(
        &Url::parse("https://vendor.test/oauth/chooselocation").unwrap()
    ));
}
