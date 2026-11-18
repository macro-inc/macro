use proptest::prelude::*;
use serde::Deserialize;

use super::{
    BuiltAt, BundleBuild, BundleManifest, CommitSha, CommitTime, IdentityError, NativeFloor,
    NativePlatform, SourceCommit,
};

const SHA: &str = "cd95980272a4cfd4d0d5e6d2a3a8a1b0c9f8e7d6";
const OTHER_SHA: &str = "0123456789abcdef0123456789abcdef01234567";

fn commit(sha: &str, secs: u64) -> SourceCommit {
    SourceCommit::new(sha.parse().unwrap(), CommitTime::try_new(secs).unwrap())
}

fn parse(json: &str) -> Result<BundleManifest, serde_json::Error> {
    serde_json::from_str(json)
}

#[test]
fn encoding_is_commit_seconds_in_milliseconds() {
    // Desktop releases already in the field report exactly this number for
    // their embedded bundle (desktop-release.mjs), so it must not change.
    assert_eq!(
        commit(SHA, 1_794_870_406).bundle_build().get(),
        1_794_870_406_000
    );
}

fn floors() -> impl Strategy<Value = NativeFloor> {
    prop_oneof![
        any::<u64>().prop_map(|min_native_build| NativeFloor::Shared { min_native_build }),
        (any::<u64>(), any::<u64>(), any::<u64>()).prop_map(|(min_native_build, android, ios)| {
            NativeFloor::PerPlatform {
                min_native_build,
                android,
                ios,
            }
        }),
    ]
}

fn commit_secs() -> impl Strategy<Value = u64> {
    1..u64::MAX / 1000
}

proptest! {
    /// The embedded bundle of a native build and the OTA bundle deployed from
    /// the same commit differ in floors and build time, never in identity.
    #[test]
    fn every_build_of_one_commit_has_one_identity(
        secs in commit_secs(),
        embedded_floor in floors(),
        ota_floor in floors(),
        ota_built_at in any::<u64>(),
    ) {
        let embedded = BundleManifest::new(commit(SHA, secs), None, embedded_floor, "2.5.0".into());
        let ota = BundleManifest::new(
            commit(SHA, secs),
            Some(BuiltAt::from_unix_millis(ota_built_at)),
            ota_floor,
            "2.6.0".into(),
        );

        prop_assert_eq!(embedded.bundle_build(), ota.bundle_build());

        // And through the wire, as apps and the server read it.
        let embedded: BundleManifest = serde_json::from_str(&serde_json::to_string(&embedded).unwrap()).unwrap();
        let ota: BundleManifest = serde_json::from_str(&serde_json::to_string(&ota).unwrap()).unwrap();
        prop_assert_eq!(embedded.bundle_build(), ota.bundle_build());
    }

    /// An older commit's bundle never outranks a newer commit's, however late
    /// it was built.
    #[test]
    fn identity_follows_commit_time_not_build_time(
        older in commit_secs(),
        newer in commit_secs(),
        built_at in any::<u64>(),
    ) {
        prop_assume!(older < newer);
        let late_old_build = BundleManifest::new(
            commit(OTHER_SHA, older),
            Some(BuiltAt::from_unix_millis(built_at)),
            NativeFloor::Shared { min_native_build: 0 },
            "2.5.0".into(),
        );

        prop_assert!(late_old_build.bundle_build() < commit(SHA, newer).bundle_build());
    }

    /// Commits merged in the same second compare equal: no update either way.
    #[test]
    fn commits_in_the_same_second_tie(secs in commit_secs()) {
        prop_assert_eq!(commit(SHA, secs).bundle_build(), commit(OTHER_SHA, secs).bundle_build());
    }

    #[test]
    fn manifests_round_trip(secs in commit_secs(), floor in floors(), built_at in proptest::option::of(any::<u64>())) {
        let manifest = BundleManifest::new(
            commit(SHA, secs),
            built_at.map(BuiltAt::from_unix_millis),
            floor,
            "2.5.0".into(),
        );
        let json = serde_json::to_string(&manifest).unwrap();

        prop_assert_eq!(parse(&json).unwrap(), manifest);
    }
}

#[test]
fn manifests_not_derived_from_their_commit_are_rejected() {
    let mismatch = parse(&format!(
        r#"{{"schemaVersion":2,"bundleBuild":1794871234567,"commitTime":1794870406,"gitSha":"{SHA}","minNativeBuild":0,"appVersion":"2.5.0"}}"#
    ));
    assert!(mismatch.unwrap_err().to_string().contains("does not match"));

    let short_sha = parse(
        r#"{"schemaVersion":2,"bundleBuild":1794870406000,"commitTime":1794870406,"gitSha":"cd95980","minNativeBuild":0,"appVersion":"2.5.0"}"#,
    );
    assert!(short_sha.is_err());

    let uppercase_sha = parse(&format!(
        r#"{{"schemaVersion":2,"bundleBuild":1794870406000,"commitTime":1794870406,"gitSha":"{}","minNativeBuild":0,"appVersion":"2.5.0"}}"#,
        SHA.to_uppercase()
    ));
    assert!(uppercase_sha.is_err());

    // What every pipeline wrote before commit stamping.
    let legacy = parse(
        r#"{"schemaVersion":2,"bundleBuild":1794871234567,"minNativeBuild":0,"gitSha":"cd95980","appVersion":"2.5.0"}"#,
    );
    assert!(legacy.unwrap_err().to_string().contains("no commitTime"));

    let zero_time = parse(&format!(
        r#"{{"schemaVersion":2,"bundleBuild":0,"commitTime":0,"gitSha":"{SHA}","minNativeBuild":0,"appVersion":"2.5.0"}}"#
    ));
    assert!(zero_time.is_err());

    let schema_without_minima = parse(&format!(
        r#"{{"schemaVersion":3,"bundleBuild":1794870406000,"commitTime":1794870406,"gitSha":"{SHA}","minNativeBuild":0,"appVersion":"2.5.0"}}"#
    ));
    assert!(schema_without_minima.is_err());
}

#[test]
fn reproducible_builds_record_no_build_time() {
    let manifest = parse(&format!(
        r#"{{"schemaVersion":2,"bundleBuild":1794870406000,"commitTime":1794870406,"gitSha":"{SHA}","minNativeBuild":0,"appVersion":"2.5.0"}}"#
    ))
    .unwrap();

    assert_eq!(manifest.built_at(), None);
    assert_eq!(
        manifest.bundle_build(),
        BundleBuild::reported(1_794_870_406_000)
    );
}

/// The manifest reader every app and server deployed before commit stamping
/// uses (no `deny_unknown_fields`). Stamped manifests must keep parsing there,
/// with the same number.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[expect(dead_code, reason = "mirrors the deployed reader's fields")]
struct DeployedReader {
    schema_version: u64,
    bundle_build: u64,
    min_native_build: u64,
    #[serde(default)]
    min_native_builds: Option<DeployedMinima>,
    git_sha: Option<String>,
    app_version: String,
}

#[derive(Deserialize)]
#[expect(dead_code, reason = "mirrors the deployed reader's fields")]
struct DeployedMinima {
    android: u64,
    ios: u64,
}

#[test]
fn stamped_manifests_parse_in_deployed_readers() {
    let manifest = BundleManifest::new(
        commit(SHA, 1_794_870_406),
        Some(BuiltAt::from_unix_millis(1_794_871_234_567)),
        NativeFloor::PerPlatform {
            min_native_build: 0,
            android: 2_050_001,
            ios: 184,
        },
        "2.5.0".into(),
    );
    let deployed: DeployedReader =
        serde_json::from_str(&serde_json::to_string(&manifest).unwrap()).unwrap();

    assert_eq!(deployed.bundle_build, 1_794_870_406_000);
    assert_eq!(deployed.schema_version, 3);
}

#[test]
fn mobile_minima_are_independent_and_android_ignores_the_shared_one() {
    let per_platform = BundleManifest::new(
        commit(SHA, 1),
        None,
        NativeFloor::PerPlatform {
            min_native_build: 5,
            android: 2_050_001,
            ios: 184,
        },
        "2.5.0".into(),
    );
    assert_eq!(
        per_platform.minimum_for(NativePlatform::Android),
        Some(2_050_001)
    );
    assert_eq!(per_platform.minimum_for(NativePlatform::Ios), Some(184));
    assert_eq!(per_platform.minimum_for(NativePlatform::Desktop), Some(5));

    let shared = BundleManifest::new(
        commit(SHA, 1),
        None,
        NativeFloor::Shared {
            min_native_build: 7,
        },
        "2.5.0".into(),
    );
    assert_eq!(shared.minimum_for(NativePlatform::Android), None);
    assert_eq!(shared.minimum_for(NativePlatform::Ios), Some(7));
}

#[test]
fn future_dated_commits_are_rejected() {
    let now = 1_794_870_406;

    assert_eq!(
        commit(SHA, now + 2 * 60 * 60).checked_against(now),
        Err(IdentityError::CommitInFuture {
            commit_secs: now + 2 * 60 * 60,
            now_secs: now,
        })
    );
    assert!(commit(SHA, now + 30 * 60).checked_against(now).is_ok());
}

#[test]
fn commit_ids_must_be_full_lowercase_hex() {
    assert!(SHA.parse::<CommitSha>().is_ok());
    assert!("cd95980".parse::<CommitSha>().is_err());
    assert!(format!("{}g", &SHA[..39]).parse::<CommitSha>().is_err());
}

#[test]
fn read_file_reports_the_path() {
    let error =
        BundleManifest::read_file(std::path::Path::new("/nonexistent/bundle-manifest.json"))
            .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("/nonexistent/bundle-manifest.json")
    );
}
