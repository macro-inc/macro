use super::*;
use crate::domain::models::{AppInfo, Arch, Target};

fn app_info() -> AppInfo {
    AppInfo {
        current_bundle_build: 42,
        native_build: 7,
        arch: Arch::Aarch64,
        target: Target::Ios,
    }
}

#[test]
fn update_check_url_joins_gateway_prefix_with_or_without_trailing_slash() {
    // Regression: appending to `/auth/` without removing the empty final segment
    // produced `/auth//update/...`, which the production gateway rejects with 404.
    for base in [
        "https://gateway.macro.com/auth/",
        "https://gateway.macro.com/auth",
    ] {
        let client = BundleClient::new(base.parse().unwrap());
        let request = AppInfo {
            current_bundle_build: 1790022571617,
            native_build: 183,
            ..app_info()
        };

        let url = client.update_check_url(request).unwrap();

        assert_eq!(
            url.as_str(),
            "https://gateway.macro.com/auth/update/bundle/ios/aarch64?current_bundle_build=1790022571617&native_build=183",
            "incorrect update URL for base {base}"
        );
    }
}

#[test]
fn update_check_url_still_supports_gateway_root_base() {
    let client = BundleClient::new("https://gateway.macro.com/".parse().unwrap());

    let url = client.update_check_url(app_info()).unwrap();

    assert_eq!(
        url.as_str(),
        "https://gateway.macro.com/update/bundle/ios/aarch64?current_bundle_build=42&native_build=7"
    );
}

#[test]
fn update_check_url_strips_base_query_and_fragment() {
    let client = BundleClient::new(
        "https://gateway.macro.com/auth/?stale=true#section"
            .parse()
            .unwrap(),
    );

    let url = client.update_check_url(app_info()).unwrap();

    assert_eq!(
        url.as_str(),
        "https://gateway.macro.com/auth/update/bundle/ios/aarch64?current_bundle_build=42&native_build=7"
    );
}
