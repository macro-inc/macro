use super::*;
use crate::local::instance::Instance;

/// The key must change when any init-defining input changes, and only then —
/// two computes over identical inputs agree, and the kickstart (which encodes
/// the instance's ports) is part of the key, so snapshots can't cross
/// instances with different port windows.
#[test]
fn key_is_deterministic_and_kickstart_sensitive() {
    let instance = Instance::derive(None, None).unwrap();
    crate::local::fusionauth::write_kickstart(&instance, None, None).unwrap();

    let a = Plan::compute(&instance).unwrap();
    let b = Plan::compute(&instance).unwrap();
    assert_eq!(a.key, b.key, "same inputs must produce the same key");
    assert_eq!(a.key.len(), 64, "sha256 hex");

    // A named instance generates a kickstart with different ports → new key.
    let other = Instance::derive(Some("snapshot-key-test"), None).unwrap();
    crate::local::fusionauth::write_kickstart(&other, None, None).unwrap();
    let c = Plan::compute(&other).unwrap();
    assert_ne!(
        a.key, c.key,
        "instances with different ports must not share snapshots"
    );

    // Cleanup the test instance's generated dir.
    let _ = std::fs::remove_dir_all(other.artifact_dir());
}

/// `exists()` trusts only a manifest that matches the key and format — a
/// half-written or foreign directory is a cache miss, not a restore.
#[test]
fn exists_requires_a_matching_manifest() {
    let dir = std::env::temp_dir().join("macro-snapshot-exists-test");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let plan = Plan {
        key: "k".repeat(64),
        dir: dir.clone(),
    };
    assert!(!plan.exists(), "no manifest → miss");

    std::fs::write(dir.join("manifest.json"), "not json").unwrap();
    assert!(!plan.exists(), "garbage manifest → miss");

    let manifest = Manifest {
        format: FORMAT,
        key: plan.key.clone(),
        created_unix: 0,
        archives: vec![],
    };
    std::fs::write(
        dir.join("manifest.json"),
        serde_json::to_string(&manifest).unwrap(),
    )
    .unwrap();
    assert!(plan.exists(), "matching manifest → hit");

    let mismatched = Manifest {
        key: "x".repeat(64),
        ..manifest
    };
    std::fs::write(
        dir.join("manifest.json"),
        serde_json::to_string(&mismatched).unwrap(),
    )
    .unwrap();
    assert!(!plan.exists(), "key mismatch → miss");

    let _ = std::fs::remove_dir_all(&dir);
}
