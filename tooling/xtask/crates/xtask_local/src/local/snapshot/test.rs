use super::*;
use crate::local::instance::Instance;

/// Two computes over identical inputs agree, and instances that differ only in
/// their ports share a key: the kickstart's redirect URLs are left out of it,
/// and FusionAuth gets each instance's own list after it starts.
#[test]
fn key_is_deterministic_and_port_free() {
    let instance = Instance::derive(None, None).unwrap();
    crate::local::fusionauth::write_kickstart(&instance, None, None).unwrap();

    let a = Plan::compute(&instance).unwrap();
    let b = Plan::compute(&instance).unwrap();
    assert_eq!(a.key, b.key, "same inputs must produce the same key");
    assert_eq!(a.key.len(), 64, "sha256 hex");

    let other = Instance::derive(Some("snapshot-key-test"), None).unwrap();
    crate::local::fusionauth::write_kickstart(&other, None, None).unwrap();
    let c = Plan::compute(&other).unwrap();
    let _ = std::fs::remove_dir_all(other.artifact_dir());
    assert_eq!(
        a.key, c.key,
        "a different port window must share the snapshot"
    );
}

/// Any kickstart change other than the redirect URLs is a different init, so
/// it must miss.
#[test]
fn kickstart_without_redirect_urls_keeps_everything_else() {
    let doc = |urls: &[&str], lambda: &str| {
        crate::local::kickstart::build(
            urls.iter().map(|url| url.to_string()).collect(),
            lambda,
            "function reconcile() {}",
            None,
            None,
        )
    };
    let strip = crate::local::kickstart::without_redirect_urls;

    assert_eq!(
        strip(doc(
            &["http://localhost:3000/app"],
            "function populate() {}"
        )),
        strip(doc(
            &["http://localhost:20110/app"],
            "function populate() {}"
        )),
    );
    assert_ne!(
        strip(doc(
            &["http://localhost:3000/app"],
            "function populate() {}"
        )),
        strip(doc(
            &["http://localhost:3000/app"],
            "function populate() { changed }"
        )),
    );
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
