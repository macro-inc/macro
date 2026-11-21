use agent_runtime_protocol::domain::schema::v0::{
    ContainerEngine, TeammateRunFailure, TeammateRunState,
};

use super::*;

fn any_image(_: HostArch) -> Option<TeammateImage> {
    Some(TeammateImage {
        repository: "ghcr.io/macro-inc/teammate-runtime".to_owned(),
        image_id: format!("sha256:{}", "a".repeat(64)),
    })
}

fn docker_linux() -> TeammateHostReport {
    TeammateHostReport {
        engine: Some(ContainerEngine {
            kind: ContainerEngineKind::Docker,
            version: "29.0.1".to_owned(),
            rootless: false,
        }),
        engines: Vec::new(),
        os: HostOs::Linux,
        arch: HostArch::Amd64,
        cpus: 8,
        memory_mib: 32 * 1024,
        disk_free_mib: Some(200 * 1024),
        problem: None,
        installs: vec![],
    }
}

#[test]
fn a_connected_machine_with_an_engine_and_room_is_eligible() {
    assert_eq!(
        HostEligibility::of(true, Some(&docker_linux()), any_image),
        HostEligibility::OK
    );
}

#[test]
fn an_offline_machine_is_ineligible_whatever_it_last_reported() {
    let eligibility = HostEligibility::of(false, Some(&docker_linux()), any_image);

    assert!(!eligibility.ok);
    assert_eq!(eligibility.reason, Some(HostIneligibility::Offline));
}

#[test]
fn a_machine_that_never_reported_is_ineligible() {
    assert_eq!(
        HostEligibility::of(true, None, any_image).reason,
        Some(HostIneligibility::NotReported)
    );
}

#[test]
fn the_reported_problem_is_the_reason() {
    let report = TeammateHostReport {
        engine: None,
        problem: Some(TeammateHostProblem::EngineUnreachable),
        ..docker_linux()
    };

    assert_eq!(
        HostEligibility::of(true, Some(&report), any_image).reason,
        Some(HostIneligibility::EngineUnreachable)
    );
}

#[test]
fn the_service_checks_the_hardware_floor_again() {
    // macrod said nothing was wrong, but the machine has 4 GiB of memory.
    let report = TeammateHostReport {
        memory_mib: 4 * 1024,
        ..docker_linux()
    };

    let eligibility = HostEligibility::of(true, Some(&report), any_image);

    assert_eq!(eligibility.reason, Some(HostIneligibility::BelowFloor));
    assert_eq!(eligibility.resource, Some(FloorResource::Memory));
}

#[test]
fn a_report_without_an_engine_is_ineligible_even_without_a_problem() {
    let report = TeammateHostReport {
        engine: None,
        ..docker_linux()
    };

    assert_eq!(
        HostEligibility::of(true, Some(&report), any_image).reason,
        Some(HostIneligibility::NoEngine)
    );
}

#[test]
fn macos_machines_are_listed_as_experimental() {
    let host = TeammateHost::new(
        HostFacts {
            harness_id: HarnessId::new_from_uuid(Uuid::from_u128(1)),
            name: "Laptop".to_owned(),
            connected: true,
            report: Some(TeammateHostReport {
                engines: Vec::new(),
                os: HostOs::Macos,
                arch: HostArch::Arm64,
                ..docker_linux()
            }),
        },
        any_image,
    );

    assert!(host.experimental);
    assert!(host.eligibility.ok);
}

#[test]
fn a_machine_whose_architecture_has_no_image_is_unsupported() {
    let eligibility = HostEligibility::of(true, Some(&docker_linux()), |_| None);

    assert_eq!(
        eligibility.reason,
        Some(HostIneligibility::UnsupportedPlatform)
    );
}

const LOCAL_ID: &str = "sha256:3333333333333333333333333333333333333333333333333333333333333333";

fn overrides(environment: macro_env::Environment, amd64: &str) -> LocalImages {
    let amd64 = amd64.to_owned();
    LocalImages::read(environment, move |name| {
        (name == TeammateRuntimeImage::OVERRIDE_AMD64).then(|| amd64.clone())
    })
}

#[test]
fn a_local_stack_runs_the_image_it_was_given() {
    let images = overrides(
        macro_env::Environment::Local,
        &format!("teammate-runtime@{LOCAL_ID}"),
    );

    assert_eq!(
        TeammateRuntimeImage::resolve(HostArch::Amd64, &images),
        Some(TeammateImage {
            repository: "teammate-runtime".to_owned(),
            image_id: LOCAL_ID.to_owned(),
        })
    );
    // Only the architecture it was given.
    assert_eq!(
        TeammateRuntimeImage::resolve(HostArch::Arm64, &images),
        TeammateRuntimeImage::resolve(HostArch::Arm64, &LocalImages::default())
    );
}

#[test]
fn dev_and_prod_ignore_the_override() {
    for environment in [
        macro_env::Environment::Develop,
        macro_env::Environment::Production,
    ] {
        let images = overrides(environment, &format!("teammate-runtime@{LOCAL_ID}"));

        assert_eq!(images, LocalImages::default());
    }
}

#[test]
fn a_malformed_override_is_ignored() {
    for value in [
        "teammate-runtime",
        "teammate-runtime@sha256:abc",
        "@sha256:3333333333333333333333333333333333333333333333333333333333333333",
        "teammate-runtime@sha256:333333333333333333333333333333333333333333333333333333333333333G",
    ] {
        assert_eq!(
            overrides(macro_env::Environment::Local, value),
            LocalImages::default(),
            "{value}"
        );
    }
}

#[test]
fn a_machine_that_cant_isolate_a_teammates_network_is_ineligible_for_that_reason() {
    let report = TeammateHostReport {
        problem: Some(TeammateHostProblem::NetworkIsolationUnavailable),
        ..docker_linux()
    };

    assert_eq!(
        HostEligibility::of(true, Some(&report), any_image),
        HostEligibility {
            ok: false,
            reason: Some(HostIneligibility::NetworkIsolationUnavailable),
            resource: None,
        }
    );
    assert_eq!(
        serde_json::to_value(HostIneligibility::NetworkIsolationUnavailable).unwrap(),
        "networkIsolationUnavailable"
    );
}

#[test]
fn a_start_refused_for_network_isolation_is_stored_as_a_failure_and_named_on_the_api() {
    assert_eq!(
        install_state(&TeammateRunState::Failed {
            reason: TeammateRunFailure::NetworkIsolationUnavailable
        }),
        (
            InstallRunState::Failed,
            Some(InstallFailure::NetworkIsolationUnavailable)
        )
    );
    assert_eq!(
        InstallFailure::NetworkIsolationUnavailable.as_ref(),
        "network_isolation_unavailable"
    );
    assert_eq!(
        serde_json::to_value(InstallFailure::NetworkIsolationUnavailable).unwrap(),
        "networkIsolationUnavailable"
    );
}

#[test]
fn the_hosts_list_shows_every_installed_engine_and_whether_it_isolates() {
    use agent_runtime_protocol::domain::schema::v0::{
        EngineIsolation, InstalledEngine, IsolationProblem,
    };
    let report = TeammateHostReport {
        engines: vec![
            InstalledEngine {
                kind: ContainerEngineKind::Docker,
                version: Some("29.0.1".to_owned()),
                rootless: false,
                isolation: EngineIsolation::Unavailable {
                    reason: IsolationProblem::GuardRefused,
                },
            },
            InstalledEngine {
                kind: ContainerEngineKind::Podman,
                version: None,
                rootless: true,
                isolation: EngineIsolation::NotProbed,
            },
        ],
        ..docker_linux()
    };

    assert_eq!(
        serde_json::to_value(HostReport::from(&report)).unwrap()["engines"],
        serde_json::json!([
            {
                "kind": "docker",
                "version": "29.0.1",
                "rootless": false,
                "isolation": {"state": "unavailable", "reason": "guardRefused"}
            },
            {
                "kind": "podman",
                "version": null,
                "rootless": true,
                "isolation": {"state": "notProbed"}
            }
        ])
    );
}
