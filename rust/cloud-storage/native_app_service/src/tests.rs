use crate::{
    domain::{
        self,
        models::{
            AllTargets, Arch, BundleUpdate, DesktopTarget, MobileTarget, PlatformData, UpdateErr,
        },
        ports::{GetJsBundleSemver, NativeAppService},
        service::{self, NativeAppServiceImpl},
    },
    outbound::DefaultBundleFetcher,
};
use reqwest::Url;
use rootcause::Report;

use cool_asserts::assert_matches;
use semver::Version;
use strum::IntoEnumIterator;

#[test]
fn all_urls_work() {
    let fetcher = DefaultBundleFetcher::new("https://macro.com".parse().unwrap());
    let url = fetcher.get_app_bundle_path();
    assert_eq!(url.as_str(), "https://macro.com/app/app-archive.zip");
}

struct MockBundleFetcher;

impl GetJsBundleSemver for MockBundleFetcher {
    async fn get_app_semver(&self) -> Result<semver::Version, Report<UpdateErr>> {
        Ok("1.1.1".parse().unwrap())
    }

    fn get_app_bundle_path(&self) -> Url {
        "https://example.com".parse().unwrap()
    }

    async fn get_app_bundle_checksum(
        &self,
        _version: &semver::Version,
    ) -> Result<String, Report<UpdateErr>> {
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

#[test]
fn needs_update_higher_version() {
    let latest: Version = "2.0.0".parse().unwrap();
    let current: Version = "1.0.0".parse().unwrap();
    assert!(service::needs_update(&latest, &current));
}

#[test]
fn needs_update_same_version_no_metadata() {
    let latest: Version = "1.0.0".parse().unwrap();
    let current: Version = "1.0.0".parse().unwrap();
    assert!(!service::needs_update(&latest, &current));
}

#[test]
fn needs_update_same_version_different_build_metadata() {
    let latest: Version = "1.0.0+abc1234".parse().unwrap();
    let current: Version = "1.0.0+def5678".parse().unwrap();
    assert!(service::needs_update(&latest, &current));
}

#[test]
fn needs_update_same_version_same_build_metadata() {
    let latest: Version = "1.0.0+abc1234".parse().unwrap();
    let current: Version = "1.0.0+abc1234".parse().unwrap();
    assert!(!service::needs_update(&latest, &current));
}

#[test]
fn needs_update_latest_has_metadata_current_does_not() {
    let latest: Version = "1.0.0+abc1234".parse().unwrap();
    let current: Version = "1.0.0".parse().unwrap();
    assert!(service::needs_update(&latest, &current));
}

#[test]
fn needs_update_build_metadata_order_does_not_matter() {
    let a: Version = "1.0.0+aaaa".parse().unwrap();
    let z: Version = "1.0.0+zzzz".parse().unwrap();
    assert!(service::needs_update(&a, &z));
    assert!(service::needs_update(&z, &a));
}

#[test]
fn needs_update_should_not_downgrade() {
    let latest: Version = "1.0.0+abc1234".parse().unwrap();
    let current: Version = "2.0.0".parse().unwrap();
    assert!(!service::needs_update(&latest, &current));
}

struct MockBundleFetcherWithBuild;

impl GetJsBundleSemver for MockBundleFetcherWithBuild {
    async fn get_app_semver(&self) -> Result<semver::Version, Report<UpdateErr>> {
        Ok("1.1.1+abc1234".parse().unwrap())
    }

    fn get_app_bundle_path(&self) -> Url {
        "https://example.com".parse().unwrap()
    }

    async fn get_app_bundle_checksum(
        &self,
        _version: &semver::Version,
    ) -> Result<String, Report<UpdateErr>> {
        Ok("abc123".to_string())
    }
}

#[tokio::test]
async fn it_should_upgrade_when_build_metadata_differs() {
    let semver: Version = "1.1.1+old5678".parse().unwrap();

    let service = NativeAppServiceImpl {
        bundle_fetcher: MockBundleFetcherWithBuild,
        platform_data: mock_platform_data(),
    };

    assert_matches!(
        service
            .get_bundle_update(domain::models::BundleUpdateRequest {
                target: AllTargets::Desktop(DesktopTarget::Darwin),
                arch: Arch::Aarch64,
                semver,
            })
            .await,
        Ok(Some(BundleUpdate { version, .. })) => {
            assert_eq!(version.to_string(), "1.1.1+abc1234");
        }
    );
}

#[tokio::test]
async fn it_should_not_upgrade_when_build_metadata_matches() {
    let semver: Version = "1.1.1+abc1234".parse().unwrap();

    let service = NativeAppServiceImpl {
        bundle_fetcher: MockBundleFetcherWithBuild,
        platform_data: mock_platform_data(),
    };

    assert_matches!(
        service
            .get_bundle_update(domain::models::BundleUpdateRequest {
                target: AllTargets::Desktop(DesktopTarget::Darwin),
                arch: Arch::Aarch64,
                semver,
            })
            .await,
        Ok(None)
    );
}
