use crate::{
    domain::{
        self,
        models::{
            AllTargets, Arch, BundleAction, BundlePolicyAction, BundlePolicyRule,
            BundleUpdatePolicy, DeployedManifest, DesktopTarget, LegacyManifest, MobileTarget,
            PlatformData, UpdateErr,
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
use bundle_identity::{
    BuiltAt, BundleBuild, BundleManifest, CommitTime, NativeFloor, SourceCommit,
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

/// Commit the mock deployed bundle was built from, abbreviated as CI does.
const DEPLOYED_GIT_SHA: &str = "cd959802";

struct MockBundleFetcher {
    manifest: DeployedManifest,
}

impl MockBundleFetcher {
    fn new(bundle_build: u64, min_native_build: u64) -> Self {
        Self {
            manifest: DeployedManifest::Legacy(LegacyManifest {
                schema_version: 2,
                min_native_builds: None,
                bundle_build,
                min_native_build,
                git_sha: Some(DEPLOYED_GIT_SHA.to_string()),
                app_version: "2.5.0".to_string(),
            }),
        }
    }
}

/// The legacy manifest a test service deploys, for tests that reshape it.
fn legacy(service: &mut NativeAppServiceImpl<MockBundleFetcher>) -> &mut LegacyManifest {
    match &mut service.bundle_fetcher.manifest {
        DeployedManifest::Legacy(manifest) => manifest,
        DeployedManifest::Stamped(_) => panic!("test service deploys a legacy manifest"),
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
    async fn get_app_bundle_manifest(&self) -> Result<DeployedManifest, Report<UpdateErr>> {
        Ok(self.manifest.clone())
    }

    fn get_app_bundle_path(&self) -> Url {
        "https://example.com".parse().unwrap()
    }

    async fn get_app_bundle_checksum(
        &self,
        _manifest: &DeployedManifest,
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
        current_bundle_build: BundleBuild::reported(current_bundle_build),
        native_build,
        manifest_schema: Some(3),
        current_git_sha: None,
        stamped_manifests: false,
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
            assert_eq!(update.bundle_build.get(), 20);
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
            assert_eq!(required.bundle_build.get(), 20);
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
                bundle_build_gte: Some(BundleBuild::reported(20)),
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
                bundle_build_gte: Some(BundleBuild::reported(15)),
                bundle_build_lte: Some(BundleBuild::reported(15)),
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
async fn legacy_manifests_only_update_platforms_with_legacy_numbering() {
    let service = service(20, 0, BundleUpdatePolicy::default());

    let mobile = MobileTarget::iter()
        .map(AllTargets::Mobile)
        .chain(DesktopTarget::iter().map(AllTargets::Desktop));

    for target in mobile {
        if target == AllTargets::Mobile(MobileTarget::Android) {
            assert_matches!(
                service
                    .get_bundle_update(request(target, Arch::Aarch64, 10, 100))
                    .await,
                Ok(None)
            );
            continue;
        }
        for arch in Arch::iter() {
            assert_matches!(
                service
                    .get_bundle_update(request(target, arch, 10, 100))
                    .await,
                Ok(Some(BundleAction::Update(update))) => {
                    assert_eq!(update.bundle_build.get(), 20);
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

#[tokio::test]
async fn shared_bundle_uses_independent_mobile_build_minima() {
    let mut service = service(20, 0, BundleUpdatePolicy::default());
    legacy(&mut service).schema_version = 3;
    legacy(&mut service).min_native_builds = Some(domain::models::MobileBuildMinima {
        android: 2_050_001,
        ios: 184,
    });
    for (target, build, minimum) in [
        (MobileTarget::Android, 2_050_000, 2_050_001),
        (MobileTarget::Ios, 183, 184),
    ] {
        assert_matches!(
            service.get_bundle_update(request(AllTargets::Mobile(target), Arch::Aarch64, 10, build)).await,
            Ok(Some(BundleAction::NativeUpdateRequired(required))) => {
                assert_eq!(required.min_native_build, minimum);
            }
        );
        assert_matches!(
            service.get_bundle_update(request(AllTargets::Mobile(target), Arch::Aarch64, 10, minimum)).await,
            Ok(Some(BundleAction::Update(update))) => {
                assert_eq!(update.min_native_build, minimum);
            }
        );
    }
}

#[tokio::test]
async fn schema_3_reaches_only_desktop_updaters_that_read_it() {
    let mut service = service(20, 0, BundleUpdatePolicy::default());
    legacy(&mut service).schema_version = 3;
    legacy(&mut service).min_native_build = 5;
    legacy(&mut service).min_native_builds = Some(domain::models::MobileBuildMinima {
        android: 2_050_001,
        ios: 184,
    });
    for target in DesktopTarget::iter() {
        let target = AllTargets::Desktop(target);
        // Older desktop updaters reject schema 3 after downloading it, on
        // every check, so they are never offered one.
        let legacy = domain::models::BundleUpdateRequest {
            manifest_schema: None,
            ..request(target, Arch::Aarch64, 10, 202_611_100_001)
        };
        assert_matches!(service.get_bundle_update(legacy).await, Ok(None));
        assert_matches!(
            service.get_bundle_update(request(target, Arch::Aarch64, 10, 4)).await,
            Ok(Some(BundleAction::NativeUpdateRequired(required))) => {
                assert_eq!(required.min_native_build, 5);
            }
        );
        assert_matches!(
            service.get_bundle_update(request(target, Arch::Aarch64, 10, 5)).await,
            Ok(Some(BundleAction::Update(update))) => {
                assert_eq!(update.min_native_build, 5);
            }
        );
    }
}

#[tokio::test]
async fn route_reads_the_updater_manifest_schema() {
    let mut service = service(20, 0, BundleUpdatePolicy::default());
    legacy(&mut service).schema_version = 3;
    legacy(&mut service).min_native_builds = Some(domain::models::MobileBuildMinima {
        android: 2_050_001,
        ios: 184,
    });
    let app = native_app_router::<_, ()>(RouterState {
        inner: Arc::new(service),
    });
    for (query, status) in [
        (
            "current_bundle_build=10&native_build=1",
            StatusCode::NO_CONTENT,
        ),
        (
            "current_bundle_build=10&native_build=1&manifest_schema=3",
            StatusCode::OK,
        ),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/update/bundle/darwin/aarch64?{query}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), status, "{query}");
    }
}

#[tokio::test]
async fn ambiguous_or_unknown_manifest_cannot_offer_an_update() {
    let mut service = service(20, 0, BundleUpdatePolicy::default());
    for schema in [3, 4] {
        legacy(&mut service).schema_version = schema;
        assert_matches!(
            service
                .get_bundle_update(request(
                    AllTargets::Mobile(MobileTarget::Android),
                    Arch::Aarch64,
                    10,
                    2_050_000
                ))
                .await,
            Ok(None)
        );
    }
    legacy(&mut service).schema_version = 2;
    legacy(&mut service).min_native_builds =
        Some(domain::models::MobileBuildMinima { android: 9, ios: 2 });
    assert_matches!(
        service
            .get_bundle_update(request(
                AllTargets::Mobile(MobileTarget::Android),
                Arch::Aarch64,
                10,
                2_050_000
            ))
            .await,
        Ok(None)
    );
}

#[tokio::test]
async fn bundle_from_the_running_commit_is_not_an_update() {
    let service = service(20, 0, BundleUpdatePolicy::default());
    let desktop = AllTargets::Desktop(DesktopTarget::Darwin);
    let from_commit = |sha: &str| domain::models::BundleUpdateRequest {
        current_git_sha: Some(sha.to_string()),
        ..request(desktop, Arch::Aarch64, 10, 202_611_160_001)
    };

    // Nix abbreviates to seven digits, CI to eight; either names the commit.
    for same in ["cd95980", "cd959802", "CD959802", "cd95980272"] {
        assert_matches!(service.get_bundle_update(from_commit(same)).await, Ok(None));
    }
    for other in ["f2cc9fe", "cd9598", "unknown", ""] {
        assert_matches!(
            service.get_bundle_update(from_commit(other)).await,
            Ok(Some(BundleAction::Update(update))) => assert_eq!(update.bundle_build.get(), 20)
        );
    }
}

#[tokio::test]
async fn route_reads_the_running_git_sha() {
    let app = native_app_router::<_, ()>(RouterState {
        inner: Arc::new(service(20, 0, BundleUpdatePolicy::default())),
    });
    let status = |query: &'static str| {
        let app = app.clone();
        async move {
            app.oneshot(
                Request::builder()
                    .uri(format!("/update/bundle/darwin/aarch64?{query}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
            .status()
        }
    };

    assert_eq!(
        status("current_bundle_build=10&native_build=1&manifest_schema=3&current_git_sha=cd95980")
            .await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        status("current_bundle_build=10&native_build=1&manifest_schema=3&current_git_sha=f2cc9fe")
            .await,
        StatusCode::OK
    );
}

/// Commit X: the native release embeds its bundle.
const COMMIT_X_SECS: u64 = 1_794_870_406;
const COMMIT_X: &str = "cd95980272a4cfd4d0d5e6d2a3a8a1b0c9f8e7d6";
/// Commit W, merged an hour before X.
const COMMIT_W_SECS: u64 = COMMIT_X_SECS - 3_600;
const COMMIT_W: &str = "0123456789abcdef0123456789abcdef01234567";

fn stamped(sha: &str, commit_secs: u64, built_at_ms: u64) -> DeployedManifest {
    DeployedManifest::Stamped(BundleManifest::new(
        SourceCommit::new(
            sha.parse().unwrap(),
            CommitTime::try_new(commit_secs).unwrap(),
        ),
        Some(BuiltAt::from_unix_millis(built_at_ms)),
        NativeFloor::Shared {
            min_native_build: 0,
        },
        "2.5.0".to_string(),
    ))
}

fn deploying(manifest: DeployedManifest) -> NativeAppServiceImpl<MockBundleFetcher> {
    let mut service = service(0, 0, BundleUpdatePolicy::default());
    service.bundle_fetcher.manifest = manifest;
    service
}

/// The number a native build of `sha` embeds, as bundle-stamp derives it.
fn embedded(sha: &str, commit_secs: u64) -> u64 {
    SourceCommit::new(
        sha.parse().unwrap(),
        CommitTime::try_new(commit_secs).unwrap(),
    )
    .bundle_build()
    .get()
}

#[tokio::test]
async fn the_deploy_of_the_embedded_commit_is_not_an_update() {
    // Deployed an hour after the commit; no git sha needed to tell.
    let service = deploying(stamped(
        COMMIT_X,
        COMMIT_X_SECS,
        (COMMIT_X_SECS + 3_600) * 1000,
    ));

    for target in [
        AllTargets::Mobile(MobileTarget::Ios),
        AllTargets::Desktop(DesktopTarget::Darwin),
    ] {
        assert_matches!(
            service
                .get_bundle_update(request(
                    target,
                    Arch::Aarch64,
                    embedded(COMMIT_X, COMMIT_X_SECS),
                    1
                ))
                .await,
            Ok(None)
        );
    }
}

#[tokio::test]
async fn an_older_commit_built_later_is_never_offered() {
    // W's deploy ran after X was committed, which build-time numbering read
    // as newer than X's embedded bundle.
    let service = deploying(stamped(
        COMMIT_W,
        COMMIT_W_SECS,
        (COMMIT_X_SECS + 600) * 1000,
    ));

    assert_matches!(
        service
            .get_bundle_update(request(
                AllTargets::Mobile(MobileTarget::Ios),
                Arch::Aarch64,
                embedded(COMMIT_X, COMMIT_X_SECS),
                1
            ))
            .await,
        Ok(None)
    );
}

#[tokio::test]
async fn a_newer_commit_is_offered_with_its_derived_number() {
    let service = deploying(stamped(
        COMMIT_X,
        COMMIT_X_SECS,
        (COMMIT_X_SECS + 60) * 1000,
    ));

    assert_matches!(
        service
            .get_bundle_update(request(
                AllTargets::Mobile(MobileTarget::Ios),
                Arch::Aarch64,
                embedded(COMMIT_W, COMMIT_W_SECS),
                1
            ))
            .await,
        Ok(Some(BundleAction::Update(update))) => {
            assert_eq!(update.bundle_build.get(), COMMIT_X_SECS * 1000);
        }
    );
}

#[tokio::test]
async fn legacy_client_numbers_take_the_first_newer_commit() {
    let service = deploying(stamped(
        COMMIT_X,
        COMMIT_X_SECS,
        (COMMIT_X_SECS + 60) * 1000,
    ));
    let ios = AllTargets::Mobile(MobileTarget::Ios);

    // A legacy number is the build time of the client's bundle.
    assert_matches!(
        service
            .get_bundle_update(request(ios, Arch::Aarch64, COMMIT_X_SECS * 1000 - 1, 1))
            .await,
        Ok(Some(BundleAction::Update(_)))
    );
    assert_matches!(
        service
            .get_bundle_update(request(ios, Arch::Aarch64, COMMIT_X_SECS * 1000 + 1, 1))
            .await,
        Ok(None)
    );
}

#[tokio::test]
async fn policy_ranges_select_commits() {
    let mut service = deploying(stamped(
        COMMIT_X,
        COMMIT_X_SECS,
        (COMMIT_X_SECS + 60) * 1000,
    ));
    service.bundle_policy = BundleUpdatePolicy {
        rules: vec![BundlePolicyRule {
            action: BundlePolicyAction::Block,
            target: None,
            native_build_gte: None,
            native_build_lte: None,
            bundle_build_gte: Some(BundleBuild::reported(embedded(COMMIT_X, COMMIT_X_SECS))),
            bundle_build_lte: Some(BundleBuild::reported(embedded(COMMIT_X, COMMIT_X_SECS))),
            reason: None,
        }],
    };

    assert_matches!(
        service
            .get_bundle_update(request(
                AllTargets::Mobile(MobileTarget::Ios),
                Arch::Aarch64,
                embedded(COMMIT_W, COMMIT_W_SECS),
                1
            ))
            .await,
        Ok(None)
    );
}

#[test]
fn policy_json_reads_bundle_ranges_as_numbers() {
    let policy: BundleUpdatePolicy = serde_json::from_str(
        r#"{"rules":[{"action":"revoke","bundleBuildGte":1794870406000,"reason":"bad"}]}"#,
    )
    .unwrap();

    assert_eq!(
        policy.rules[0].bundle_build_gte,
        Some(BundleBuild::reported(1_794_870_406_000))
    );
    assert_eq!(policy.rules[0].bundle_build_lte, None);
}

#[test]
fn live_manifests_are_read_strictly_once_stamped() {
    let legacy = DeployedManifest::from_json(
        r#"{"schemaVersion":2,"bundleBuild":1794871234567,"minNativeBuild":0,"gitSha":"cd95980","appVersion":"2.5.0"}"#,
    )
    .unwrap();
    assert_eq!(legacy.bundle_build().get(), 1_794_871_234_567);
    assert_eq!(legacy.built_at(), None);

    let stamped = DeployedManifest::from_json(&format!(
        r#"{{"schemaVersion":2,"bundleBuild":1794870406000,"commitTime":1794870406,"gitSha":"{COMMIT_X}","builtAt":1794871234567,"minNativeBuild":0,"appVersion":"2.5.0"}}"#
    ))
    .unwrap();
    assert_eq!(stamped.bundle_build().get(), 1_794_870_406_000);
    assert_eq!(
        stamped.built_at(),
        Some(BuiltAt::from_unix_millis(1_794_871_234_567))
    );

    // Naming a commit time but disagreeing with it is never read as legacy.
    let inconsistent = DeployedManifest::from_json(&format!(
        r#"{{"schemaVersion":2,"bundleBuild":1794871234567,"commitTime":1794870406,"gitSha":"{COMMIT_X}","minNativeBuild":0,"appVersion":"2.5.0"}}"#
    ));
    assert!(inconsistent.is_err());
}

#[tokio::test]
async fn updaters_that_need_stamped_manifests_are_not_offered_legacy_ones() {
    let legacy = service(20, 0, BundleUpdatePolicy::default());
    let stamped_only = |current: u64| domain::models::BundleUpdateRequest {
        stamped_manifests: true,
        ..request(
            AllTargets::Mobile(MobileTarget::Ios),
            Arch::Aarch64,
            current,
            1,
        )
    };
    assert_matches!(legacy.get_bundle_update(stamped_only(10)).await, Ok(None));

    let stamped = deploying(stamped(
        COMMIT_X,
        COMMIT_X_SECS,
        (COMMIT_X_SECS + 60) * 1000,
    ));
    assert_matches!(
        stamped.get_bundle_update(stamped_only(10)).await,
        Ok(Some(BundleAction::Update(_)))
    );
}

#[tokio::test]
async fn route_reads_the_stamped_manifests_capability() {
    let app = native_app_router::<_, ()>(RouterState {
        inner: Arc::new(service(20, 0, BundleUpdatePolicy::default())),
    });
    let status = |query: &'static str| {
        let app = app.clone();
        async move {
            app.oneshot(
                Request::builder()
                    .uri(format!("/update/bundle/ios/aarch64?{query}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
            .status()
        }
    };

    assert_eq!(
        status("current_bundle_build=10&native_build=1&manifest_schema=3").await,
        StatusCode::OK
    );
    assert_eq!(
        status("current_bundle_build=10&native_build=1&manifest_schema=3&stamped_manifests=true")
            .await,
        StatusCode::NO_CONTENT
    );
}
