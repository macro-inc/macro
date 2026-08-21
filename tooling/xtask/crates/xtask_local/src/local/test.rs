use super::*;
use std::collections::BTreeSet;

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
    let actual: BTreeSet<_> = LOCAL_BUILD_SERVICE_IMAGES
        .iter()
        .map(|name| name.to_string())
        .collect();
    let expected: BTreeSet<_> = [
        "websocket_service",
        "sync_service",
        "lexical_service",
        "ai_editing_worker",
        "analytics_proxy",
        "sdk-webhook-relay",
    ]
    .into_iter()
    .map(str::to_string)
    .collect();
    assert_eq!(actual, expected);
    assert!(
        LOCAL_PULL_SERVICE_IMAGES.is_empty(),
        "local stack must load Nix images, not docker compose pull: {LOCAL_PULL_SERVICE_IMAGES:?}"
    );
}

#[test]
fn local_compose_uses_arion_base() {
    let instance = instance::Instance::derive(None, None).unwrap();
    let files = gen_compose::compose_files(&instance);
    assert_eq!(files[0], gen_compose::arion_compose_yaml());
    assert!(
        files[0].ends_with("target/nix/arion-compose.yaml"),
        "{}",
        files[0].display()
    );
    assert_eq!(
        files[1],
        instance.artifact_dir().join("docker-compose.override.yml")
    );
}
