use super::*;

#[tokio::test]
async fn redirects_allow_http_and_other_paths_but_retain_the_public_ip_guard() {
    let source = Url::parse("https://example.com/favicon.ico").unwrap();
    for (destination, allowed) in [
        ("http://8.8.8.8/images/logo.png", true),
        ("https://127.0.0.1/images/logo.png", false),
        ("http://169.254.169.254/metadata", false),
    ] {
        let response = reqwest::Response::from(
            axum::http::Response::builder()
                .status(302)
                .header("location", destination)
                .body("")
                .unwrap(),
        );
        let target = redirect_target(&source, &response).unwrap();
        assert_eq!(target.as_str(), destination);
        assert_eq!(assert_not_internal(&target).await.is_ok(), allowed);
    }
}
