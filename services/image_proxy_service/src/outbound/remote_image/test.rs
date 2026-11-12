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

#[test]
fn blocks_special_use_addresses_for_logo_fetching() {
    for address in [
        "100.64.0.1",
        "192.0.0.8",
        "198.18.0.1",
        "224.0.0.1",
        "240.0.0.1",
        "192.0.2.1",
        "2001:db8::1",
        "2002:7f00:1::1",
        "64:ff9b::7f00:1",
        "192.88.99.1",
        "3fff::1",
        "3ffe::1",
        "ff02::1",
    ] {
        assert!(is_private_ip(&address.parse().unwrap()), "{address}");
    }
}
