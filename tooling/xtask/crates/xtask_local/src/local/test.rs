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

#[test]
fn voice_worker_starts_without_a_profile_or_provider_health_gate() {
    let raw = std::fs::read_to_string(repo_root().join("docker/docker-compose.yml")).unwrap();
    let compose: serde_yaml::Value = serde_yaml::from_str(&raw).unwrap();
    let worker = &compose["services"]["agent_voice"];
    assert!(worker.is_mapping());
    assert!(worker["profiles"].is_null());
    assert!(worker["ports"].is_null());
    assert_eq!(
        worker["build"]["context"].as_str(),
        Some("services/agent_voice")
    );
    // A short-form dependency waits only for startup. A worker using local
    // stub credentials must not prevent unrelated harness features starting.
    assert!(
        compose["services"]["agent_harness_service"]["depends_on"]
            .as_sequence()
            .unwrap()
            .iter()
            .any(|service| service.as_str() == Some("agent_voice"))
    );
}

#[test]
fn voice_worker_receives_only_speech_and_media_configuration() {
    let raw = std::fs::read_to_string(repo_root().join("docker/docker-compose.yml")).unwrap();
    let compose: serde_yaml::Value = serde_yaml::from_str(&raw).unwrap();
    let worker = &compose["services"]["agent_voice"];
    assert!(
        worker["<<"].is_null(),
        "must not inherit the shared env file"
    );
    assert!(worker["env_file"].is_null());
    let env = worker["environment"].as_mapping().unwrap();
    let expected = [
        ("ENVIRONMENT", "${ENVIRONMENT:-local}"),
        ("COMPOSE_PROJECT_NAME", "${COMPOSE_PROJECT_NAME:-macro}"),
        ("LIVEKIT_URL", "${LIVEKIT_SERVER_URL:-}"),
        ("LIVEKIT_API_KEY", "${LIVEKIT_API_KEY:-}"),
        ("LIVEKIT_API_SECRET", "${LIVEKIT_API_SECRET:-}"),
        ("OPENAI_API_KEY", "${OPENAI_API_KEY:-}"),
        (
            "AGENT_VOICE_MODEL",
            "${AGENT_VOICE_MODEL:-gpt-realtime-2.1}",
        ),
    ];
    assert_eq!(env.len(), expected.len());
    for (key, value) in expected {
        assert_eq!(env[key].as_str(), Some(value));
    }
}

fn voice_command_fixture() -> (Instance, env_layer::ResolvedEnv) {
    let instance = Instance::derive(Some("voice-command-test"), None).unwrap();
    let env = env_layer::ResolvedEnv {
        merged: Default::default(),
        doppler_used: false,
        env_file: None,
        generated_path: instance.artifact_dir().join("local.generated.env"),
    };
    (instance, env)
}

#[test]
fn dev_explicit_start_keeps_the_voice_worker_after_dependencies_are_removed() {
    let (instance, env) = voice_command_fixture();
    let command = app_start_command(Mode::Dev, &instance, &env);
    let args: Vec<_> = command.get_args().collect();
    assert!(args.contains(&std::ffi::OsStr::new("agent_voice")));
    assert!(args.contains(&std::ffi::OsStr::new("proxy")));
    let env_index = args.iter().position(|arg| *arg == "--env-file").unwrap();
    assert_eq!(args[env_index + 1], env.generated_path);
}

#[test]
fn normal_and_auxiliary_rebuilds_both_refresh_the_voice_worker() {
    let (instance, env) = voice_command_fixture();
    for build_aux_services in [false, true] {
        let build = app_image_build_command(&instance, &env, build_aux_services);
        let build_args: Vec<_> = build.get_args().collect();
        assert!(build_args.contains(&std::ffi::OsStr::new("agent_voice")));
        let reload = app_image_reload_command(&instance, &env, build_aux_services);
        let reload_args: Vec<_> = reload.get_args().collect();
        assert!(reload_args.contains(&std::ffi::OsStr::new("agent_voice")));
        assert!(reload_args.contains(&std::ffi::OsStr::new("--no-deps")));
        if !build_aux_services {
            assert!(!reload_args.contains(&std::ffi::OsStr::new("--force-recreate")));
            assert!(!reload_args.contains(&std::ffi::OsStr::new("postgres")));
            assert!(!reload_args.contains(&std::ffi::OsStr::new("agent_harness_service")));
        }
    }
}
