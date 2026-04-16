use crate::{
    domain::{
        self,
        models::{
            AllTargets, Arch, BundleUpdate, DesktopTarget, MobileTarget, PlatformData, UpdateErr,
        },
        ports::{GetJsBundleSemver, NativeAppService},
        service::NativeAppServiceImpl,
    },
    outbound::DefaultBundleFetcher,
};
use reqwest::Url;

use cool_asserts::assert_matches;
use semver::Version;
use strum::IntoEnumIterator;

#[test]
fn all_urls_work() {
    let fetcher = DefaultBundleFetcher::new("https://macro.com".parse().unwrap());
    let _url = fetcher.get_app_bundle_path();
}

struct MockBundleFetcher;

impl GetJsBundleSemver for MockBundleFetcher {
    async fn get_app_semver(&self) -> Result<semver::Version, UpdateErr> {
        Ok("1.1.1".parse().unwrap())
    }

    fn get_app_bundle_path(&self) -> Url {
        "https://example.com".parse().unwrap()
    }

    async fn get_app_bundle_checksum(
        &self,
        _version: &semver::Version,
    ) -> Result<String, UpdateErr> {
        Ok("abc123".to_string())
    }
}

fn mock_platform_data() -> PlatformData {
    PlatformData {
        ios_development_team_id: String::new(),
        ios_app_bundle_id: String::new(),
    }
}

#[tokio::test]
async fn it_should_not_downgrade_mobile() {
    let semver: Version = "1.2.1".parse().unwrap();

    let service = NativeAppServiceImpl {
        bundle_fetcher: MockBundleFetcher,
        platform_data: mock_platform_data(),
    };

    let iter = MobileTarget::iter().flat_map(move |target| {
        let semver = semver.clone();
        Arch::iter().map(move |arch| (AllTargets::Mobile(target), arch, semver.clone()))
    });

    for (target, arch, semver) in iter {
        assert_matches!(
            service
                .get_bundle_update(domain::models::BundleUpdateRequest {
                    target,
                    arch,
                    semver,
                })
                .await,
            Ok(None)
        );
    }
}

#[tokio::test]
async fn it_should_upgrade_mobile() {
    let semver: Version = "1.0.1".parse().unwrap();

    let service = NativeAppServiceImpl {
        bundle_fetcher: MockBundleFetcher,
        platform_data: mock_platform_data(),
    };

    let iter = MobileTarget::iter().flat_map(move |target| {
        let semver = semver.clone();
        Arch::iter().map(move |arch| (AllTargets::Mobile(target), arch, semver.clone()))
    });

    for (target, arch, semver) in iter {
        assert_matches!(
            service
                .get_bundle_update(domain::models::BundleUpdateRequest {
                    target,
                    arch,
                    semver,
                })
                .await,
            Ok(Some(BundleUpdate { version, notes: _, url, checksum })) => {
                assert_eq!(version.to_string(), "1.1.1");
                assert_eq!(url.as_str(), "https://example.com/");
                assert_eq!(checksum, "abc123");
            }
        );
    }
}

#[tokio::test]
async fn it_should_not_downgrade_desktop() {
    let semver: Version = "1.2.1".parse().unwrap();

    let service = NativeAppServiceImpl {
        bundle_fetcher: MockBundleFetcher,
        platform_data: mock_platform_data(),
    };

    let iter = DesktopTarget::iter().flat_map(move |target| {
        let semver = semver.clone();
        Arch::iter().map(move |arch| (AllTargets::Desktop(target), arch, semver.clone()))
    });

    for (target, arch, semver) in iter {
        assert_matches!(
            service
                .get_bundle_update(domain::models::BundleUpdateRequest {
                    target,
                    arch,
                    semver,
                })
                .await,
            Ok(None)
        );
    }
}

#[tokio::test]
async fn it_should_upgrade_desktop() {
    let semver: Version = "1.0.1".parse().unwrap();

    let service = NativeAppServiceImpl {
        bundle_fetcher: MockBundleFetcher,
        platform_data: mock_platform_data(),
    };

    let iter = DesktopTarget::iter().flat_map(move |target| {
        let semver = semver.clone();
        Arch::iter().map(move |arch| (AllTargets::Desktop(target), arch, semver.clone()))
    });

    for (target, arch, semver) in iter {
        assert_matches!(
            service
                .get_bundle_update(domain::models::BundleUpdateRequest {
                    target,
                    arch,
                    semver,
                })
                .await,
            Ok(Some(BundleUpdate { version, notes: _, url, checksum })) => {
                assert_eq!(version.to_string(), "1.1.1");
                assert_eq!(url.as_str(), "https://example.com/");
                assert_eq!(checksum, "abc123");
            }
        );
    }
}
