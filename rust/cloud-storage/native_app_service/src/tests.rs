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
use macro_env::Environment;
use reqwest::Url;

use cool_asserts::assert_matches;
use semver::Version;
use strum::IntoEnumIterator;

#[test]
fn all_urls_work() {
    let fetcher = DefaultBundleFetcher {
        semver_file_name: "",
        bundle_archive_name: "",
    };
    let _urls = Environment::iter()
        .map(|e| fetcher.get_app_bundle_path(&e))
        .collect::<Vec<_>>();
}

struct MockBundleFetcher;

impl GetJsBundleSemver for MockBundleFetcher {
    async fn get_app_semver(&self, _env: &Environment) -> Result<semver::Version, UpdateErr> {
        Ok("1.1.1".parse().unwrap())
    }

    fn get_app_bundle_path(&self, _env: &Environment) -> Url {
        "https://example.com".parse().unwrap()
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

    let iter = MobileTarget::iter()
        .flat_map(move |target| {
            let semver = semver.clone();
            Arch::iter().map(move |arch| (AllTargets::Mobile(target), arch, semver.clone()))
        })
        .flat_map(|p| Environment::iter().map(move |e| (p.clone(), e)))
        .map(|((target, arch, semver), e)| async move {
            let service = NativeAppServiceImpl {
                bundle_fetcher: MockBundleFetcher,
                environment: e,
                platform_data: mock_platform_data(),
            };

            service
                .get_bundle_update(domain::models::BundleUpdateRequest {
                    target,
                    arch,
                    semver,
                })
                .await
        });

    for fut in iter {
        assert_matches!(fut.await, Ok(None))
    }
}

#[tokio::test]
async fn it_should_upgrade_mobile() {
    let semver: Version = "1.0.1".parse().unwrap();
    let iter = MobileTarget::iter()
        .flat_map(move |target| {
            let semver = semver.clone();
            Arch::iter().map(move |arch| (AllTargets::Mobile(target), arch, semver.clone()))
        })
        .flat_map(|p| Environment::iter().map(move |e| (p.clone(), e)))
        .map(|((target, arch, semver), e)| async move {
            let service = NativeAppServiceImpl {
                bundle_fetcher: MockBundleFetcher,
                environment: e,
                platform_data: mock_platform_data(),
            };

            service
                .get_bundle_update(domain::models::BundleUpdateRequest {
                    target,
                    arch,
                    semver,
                })
                .await
        });

    for fut in iter {
        assert_matches!(fut.await, Ok(Some(BundleUpdate { version, notes: _, url })) => {
            assert_eq!(version.to_string(), "1.1.1");
            assert_eq!(url.as_str(), "https://example.com/");
        })
    }
}

#[tokio::test]
async fn it_should_not_downgrade_desktop() {
    let semver: Version = "1.2.1".parse().unwrap();
    let iter = DesktopTarget::iter()
        .flat_map(move |target| {
            let semver = semver.clone();
            Arch::iter().map(move |arch| (AllTargets::Desktop(target), arch, semver.clone()))
        })
        .flat_map(|p| Environment::iter().map(move |e| (p.clone(), e)))
        .map(|((target, arch, semver), e)| async move {
            let service = NativeAppServiceImpl {
                bundle_fetcher: MockBundleFetcher,
                environment: e,
                platform_data: mock_platform_data(),
            };

            service
                .get_bundle_update(domain::models::BundleUpdateRequest {
                    target,
                    arch,
                    semver,
                })
                .await
        });

    for fut in iter {
        assert_matches!(fut.await, Ok(None));
    }
}

#[tokio::test]
async fn it_should_upgrade_desktop() {
    let semver: Version = "1.0.1".parse().unwrap();
    let iter = DesktopTarget::iter()
        .flat_map(move |target| {
            let semver = semver.clone();
            Arch::iter().map(move |arch| (AllTargets::Desktop(target), arch, semver.clone()))
        })
        .flat_map(|p| Environment::iter().map(move |e| (p.clone(), e)))
        .map(|((target, arch, semver), e)| async move {
            let service = NativeAppServiceImpl {
                bundle_fetcher: MockBundleFetcher,
                environment: e,
                platform_data: mock_platform_data(),
            };

            service
                .get_bundle_update(domain::models::BundleUpdateRequest {
                    target,
                    arch,
                    semver,
                })
                .await
        });

    for fut in iter {
        assert_matches!(fut.await, Ok(Some(BundleUpdate { version, notes: _, url })) => {
            assert_eq!(version.to_string(), "1.1.1");
            assert_eq!(url.as_str(), "https://example.com/");
        })
    }
}
