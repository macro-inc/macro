use super::*;
use std::collections::BTreeSet;

use crate::local::instance::Instance;

/// Every mode whose spec we assert invariants over.
const MODES: &[Mode] = &[Mode::Local, Mode::Dev];

/// Cross-field design rules every [`ModeSpec`] must satisfy. These encode what
/// makes a mode *coherent* — a new mode that trips one of these is a bug, not a
/// new policy — so they're the real guard on the table, not a restatement of it.
#[test]
fn mode_specs_are_coherent() {
    for &mode in MODES {
        let s = mode.spec();
        // You either own the local plumbing (LocalEnv: dummy creds + localstack
        // endpoint) or you point at deployed AWS and strip those — never both.
        assert!(
            !(s.overlay_local_env && s.uses_remote_aws),
            "{}: overlay_local_env and uses_remote_aws are mutually exclusive",
            s.label
        );
        // Migrations only make sense against a database this mode runs itself.
        assert!(
            !s.migrates_db || s.runs_local_infra,
            "{}: migrates_db requires runs_local_infra",
            s.label
        );
    }
}

#[test]
fn durable_bake_covers_every_repository_built_local_image() {
    fn direct_build_services(path: &std::path::Path) -> BTreeSet<String> {
        let raw = std::fs::read_to_string(path).unwrap();
        let compose: serde_yaml::Value = serde_yaml::from_str(&raw).unwrap();
        compose["services"]
            .as_mapping()
            .unwrap()
            .iter()
            .filter(|(_, service)| {
                service
                    .as_mapping()
                    .is_some_and(|service| service.contains_key("build"))
            })
            .map(|(name, _)| name.as_str().unwrap().to_string())
            .collect()
    }

    let mut expected = direct_build_services(&repo_root().join("docker/docker-compose.yml"));
    expected.extend(direct_build_services(
        &repo_root().join("docker/docker-compose-databases.yml"),
    ));
    // The generated override adds this build definition.
    expected.insert("sdk-webhook-relay".to_string());
    // The Rust services use the host-built runtime image; this profile-only
    // helper is intentionally never needed by local stack preparation.
    expected.remove("rust_services_image");
    for service in inventory::RUST_SERVICES {
        expected.remove(service.compose_name);
    }

    let actual: BTreeSet<_> = LOCAL_BUILD_SERVICE_IMAGES
        .iter()
        .map(|name| name.to_string())
        .collect();
    assert_eq!(actual, expected);
    assert_eq!(
        LOCAL_PULL_SERVICE_IMAGES,
        ["proxy", "mailpit", "static_file_cdn"]
    );
}

/// Dev never writes a kickstart and does not own the snapshot volumes. Calling
/// `Plan::compute` on a clean machine aborts `run_dev`; hashing a leftover
/// local kickstart would then send `save` into starting Postgres/FusionAuth.
#[test]
fn snapshot_plan_is_local_only() {
    let instance = Instance::derive(Some("snapshot-plan-mode"), None).unwrap();
    let _ = std::fs::remove_dir_all(instance.artifact_dir());

    assert!(
        compute_snapshot_plan(Mode::Dev, false, false, &instance)
            .unwrap()
            .is_none(),
        "dev must not compute a snapshot"
    );

    fusionauth::write_kickstart(&instance, None, None).unwrap();
    assert!(
        compute_snapshot_plan(Mode::Local, false, false, &instance)
            .unwrap()
            .is_some()
    );
    assert!(
        compute_snapshot_plan(Mode::Local, true, false, &instance)
            .unwrap()
            .is_none(),
        "--no-snapshot skips the cache"
    );
    assert!(
        compute_snapshot_plan(Mode::Local, false, true, &instance)
            .unwrap()
            .is_none(),
        "dry-run skips the cache"
    );

    let _ = std::fs::remove_dir_all(instance.artifact_dir());
}

#[test]
fn wait_http_script_uses_a_wall_clock_deadline() {
    let script = wait_http_script("http://example.invalid/health", 120, "0.2");
    assert!(script.contains("SECONDS + 120"));
    assert!(script.contains("sleep 0.2"));
    assert!(
        !script.contains("seq 1"),
        "attempt-counted loops overshoot when curl --max-time hangs"
    );
}

#[test]
fn wait_http_script_stops_near_the_deadline() {
    let start = std::time::Instant::now();
    let status = std::process::Command::new("bash")
        .arg("-lc")
        .arg(wait_http_script("http://127.0.0.1:1/health", 1, "0.2"))
        .status()
        .unwrap();
    assert!(!status.success());
    let elapsed = start.elapsed();
    assert!(
        elapsed < std::time::Duration::from_secs(6),
        "deadline poll hung for {elapsed:?}"
    );
}
