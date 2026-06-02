use crate::{
    domain::{
        self,
        models::{
            AllTargets, Arch, BundleAction, BundleManifest, BundlePolicyAction, BundlePolicyRule,
            BundleUpdatePolicy, DesktopTarget, MobileTarget, PlatformData, UpdateErr,
        },
        ports::{GetJsBundleManifest, NativeAppService},
        service::NativeAppServiceImpl,
    },
    inbound::{RouterState, native_app_router},
    outbound::DefaultBundleFetcher,
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use cool_asserts::assert_matches;
use reqwest::Url;
use rootcause::Report;
use std::{
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use strum::IntoEnumIterator;
use tower::ServiceExt;

#[test]
fn all_urls_work() {
    let fetcher = DefaultBundleFetcher::new("https://macro.com".parse().unwrap());
    let url = fetcher.get_app_bundle_path();
    assert_eq!(url.as_str(), "https://macro.com/app/app-archive.zip");
}

struct MockBundleFetcher {
    manifest: BundleManifest,
}

impl MockBundleFetcher {
    fn new(bundle_build: u64, min_native_build: u64) -> Self {
        Self {
            manifest: BundleManifest {
                schema_version: 2,
                bundle_build,
                min_native_build,
                git_sha: Some("abc123".to_string()),
                app_version: "2.5.0".to_string(),
            },
        }
    }
}

static POLICY_ENV_LOCK: Mutex<()> = Mutex::new(());

struct PolicyEnvGuard {
    json: Option<String>,
    file: Option<String>,
}

impl PolicyEnvGuard {
    fn capture() -> Self {
        Self {
            json: std::env::var("BUNDLE_UPDATE_POLICY_JSON").ok(),
            file: std::env::var("BUNDLE_UPDATE_POLICY_FILE").ok(),
        }
    }
}

impl Drop for PolicyEnvGuard {
    fn drop(&mut self) {
        restore_env_var("BUNDLE_UPDATE_POLICY_JSON", self.json.as_deref());
        restore_env_var("BUNDLE_UPDATE_POLICY_FILE", self.file.as_deref());
    }
}

fn restore_env_var(name: &str, value: Option<&str>) {
    match value {
        Some(value) => unsafe { std::env::set_var(name, value) },
        None => unsafe { std::env::remove_var(name) },
    }
}

impl GetJsBundleManifest for MockBundleFetcher {
    async fn get_app_bundle_manifest(&self) -> Result<BundleManifest, Report<UpdateErr>> {
        Ok(self.manifest.clone())
    }

    fn get_app_bundle_path(&self) -> Url {
        "https://example.com".parse().unwrap()
    }

    async fn get_app_bundle_checksum(
        &self,
        _bundle_build: u64,
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

fn service(
    bundle_build: u64,
    min_native_build: u64,
    bundle_policy: BundleUpdatePolicy,
) -> NativeAppServiceImpl<MockBundleFetcher> {
    NativeAppServiceImpl {
        bundle_fetcher: MockBundleFetcher::new(bundle_build, min_native_build),
        bundle_policy,
        platform_data: mock_platform_data(),
    }
}

fn request(
    target: AllTargets,
    arch: Arch,
    current_bundle_build: u64,
    native_build: u64,
) -> domain::models::BundleUpdateRequest {
    domain::models::BundleUpdateRequest {
        target,
        arch,
        current_bundle_build,
        native_build,
    }
}

#[tokio::test]
async fn returns_update_when_deployed_bundle_is_newer() {
    let service = service(20, 0, BundleUpdatePolicy::default());

    assert_matches!(
        service
            .get_bundle_update(request(
                AllTargets::Mobile(MobileTarget::Ios),
                Arch::Aarch64,
                10,
                100,
            ))
            .await,
        Ok(Some(BundleAction::Update(update))) => {
            assert_eq!(update.bundle_build, 20);
            assert_eq!(update.min_native_build, 0);
            assert_eq!(update.url.as_str(), "https://example.com/");
            assert_eq!(update.checksum, "abc123");
        }
    );
}

#[tokio::test]
async fn returns_none_when_deployed_bundle_is_equal_or_older() {
    let service = service(20, 0, BundleUpdatePolicy::default());

    for current_bundle_build in [20, 21] {
        assert_matches!(
            service
                .get_bundle_update(request(
                    AllTargets::Mobile(MobileTarget::Ios),
                    Arch::Aarch64,
                    current_bundle_build,
                    100,
                ))
                .await,
            Ok(None)
        );
    }
}

#[tokio::test]
async fn returns_native_update_required_when_newer_bundle_requires_too_new_native_build() {
    let service = service(20, 200, BundleUpdatePolicy::default());

    assert_matches!(
        service
            .get_bundle_update(request(
                AllTargets::Mobile(MobileTarget::Ios),
                Arch::Aarch64,
                10,
                199,
            ))
            .await,
        Ok(Some(BundleAction::NativeUpdateRequired(required))) => {
            assert_eq!(required.bundle_build, 20);
            assert_eq!(required.min_native_build, 200);
        }
    );
}

#[tokio::test]
async fn policy_blocks_updates_for_matching_target_native_and_bundle_ranges() {
    let service = service(
        20,
        0,
        BundleUpdatePolicy {
            rules: vec![BundlePolicyRule {
                action: BundlePolicyAction::Block,
                target: Some(AllTargets::Mobile(MobileTarget::Ios)),
                native_build_gte: None,
                native_build_lte: Some(142),
                bundle_build_gte: Some(20),
                bundle_build_lte: None,
                reason: Some("ios_142_breakage".to_string()),
            }],
        },
    );

    assert_matches!(
        service
            .get_bundle_update(request(
                AllTargets::Mobile(MobileTarget::Ios),
                Arch::Aarch64,
                10,
                142,
            ))
            .await,
        Ok(None)
    );
}

#[tokio::test]
async fn policy_returns_clear_when_current_active_bundle_is_revoked() {
    let service = service(
        20,
        0,
        BundleUpdatePolicy {
            rules: vec![BundlePolicyRule {
                action: BundlePolicyAction::Revoke,
                target: Some(AllTargets::Mobile(MobileTarget::Ios)),
                native_build_gte: None,
                native_build_lte: Some(142),
                bundle_build_gte: Some(15),
                bundle_build_lte: Some(15),
                reason: Some("bundle_revoked".to_string()),
            }],
        },
    );

    assert_matches!(
        service
            .get_bundle_update(request(
                AllTargets::Mobile(MobileTarget::Ios),
                Arch::Aarch64,
                15,
                142,
            ))
            .await,
        Ok(Some(BundleAction::Clear(clear))) => {
            assert_eq!(clear.reason, "bundle_revoked");
        }
    );
}

#[tokio::test]
async fn all_targets_can_receive_manifest_updates() {
    let service = service(20, 0, BundleUpdatePolicy::default());

    let mobile = MobileTarget::iter()
        .map(AllTargets::Mobile)
        .chain(DesktopTarget::iter().map(AllTargets::Desktop));

    for target in mobile {
        for arch in Arch::iter() {
            assert_matches!(
                service
                    .get_bundle_update(request(target, arch, 10, 100))
                    .await,
                Ok(Some(BundleAction::Update(update))) => {
                    assert_eq!(update.bundle_build, 20);
                }
            );
        }
    }
}

#[tokio::test]
async fn route_returns_update_for_bundle_query_parameters() {
    let service = service(20, 0, BundleUpdatePolicy::default());
    let app = native_app_router::<_, ()>(RouterState {
        inner: Arc::new(service),
    });

    let response = app
        .oneshot(
            Request::builder()
                .uri("/update/bundle/ios/aarch64?current_bundle_build=10&native_build=142")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["action"], "update");
    assert_eq!(body["bundleBuild"], 20);
    assert_eq!(body["minNativeBuild"], 0);
    assert_eq!(body["checksum"], "abc123");
}

#[tokio::test]
async fn route_returns_204_when_no_bundle_action_is_needed() {
    let service = service(20, 0, BundleUpdatePolicy::default());
    let app = native_app_router::<_, ()>(RouterState {
        inner: Arc::new(service),
    });

    let response = app
        .oneshot(
            Request::builder()
                .uri("/update/bundle/ios/aarch64?current_bundle_build=20&native_build=142")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn route_returns_native_update_required_for_incompatible_newer_bundle() {
    let service = service(20, 200, BundleUpdatePolicy::default());
    let app = native_app_router::<_, ()>(RouterState {
        inner: Arc::new(service),
    });

    let response = app
        .oneshot(
            Request::builder()
                .uri("/update/bundle/ios/aarch64?current_bundle_build=10&native_build=142")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["action"], "native_update_required");
    assert_eq!(body["bundleBuild"], 20);
    assert_eq!(body["minNativeBuild"], 200);
}

#[test]
fn missing_policy_env_falls_back_to_default_policy() {
    with_policy_env(None, None, || {
        let policy = BundleUpdatePolicy::from_env().unwrap();
        assert!(policy.rules.is_empty());
    });
}

#[test]
fn malformed_policy_json_fails_to_load() {
    with_policy_env(Some("{not json"), None, || {
        assert!(BundleUpdatePolicy::from_env().is_err());
    });
}

#[test]
fn missing_policy_file_fails_to_load() {
    let missing_path = format!(
        "/tmp/macro-missing-bundle-policy-{}.json",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    with_policy_env(None, Some(&missing_path), || {
        assert!(BundleUpdatePolicy::from_env().is_err());
    });
}

fn with_policy_env(json: Option<&str>, file: Option<&str>, test: impl FnOnce()) {
    let _guard = POLICY_ENV_LOCK.lock().unwrap();
    let _env_guard = PolicyEnvGuard::capture();
    unsafe {
        std::env::remove_var("BUNDLE_UPDATE_POLICY_JSON");
        std::env::remove_var("BUNDLE_UPDATE_POLICY_FILE");
        if let Some(json) = json {
            std::env::set_var("BUNDLE_UPDATE_POLICY_JSON", json);
        }
        if let Some(file) = file {
            std::env::set_var("BUNDLE_UPDATE_POLICY_FILE", file);
        }
    }

    test();
}
