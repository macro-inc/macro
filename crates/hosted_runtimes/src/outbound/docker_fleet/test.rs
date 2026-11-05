use super::*;

const COMPUTER_ID: Uuid = Uuid::from_u128(0x0190_0000_0000_7000_8000_0000_0000_0001);

fn config() -> DockerFleetConfig {
    DockerFleetConfig {
        image: "macro-box:latest".to_owned(),
        network: "macro_services".to_owned(),
        enrollment_dir: PathBuf::from("/var/lib/macro/enrollments"),
        host_name: "docker-local".to_owned(),
        memory_gb: 64,
        reserve_gb: 16,
        oversell_factor: 4,
    }
}

#[test]
fn create_runs_systemd_with_the_enrollment_directory_mounted_read_only() {
    let spec = CreateSpec {
        image: "macro-box:latest".to_owned(),
        network: "macro_services".to_owned(),
        computer_id: COMPUTER_ID,
        memory_gb: 8,
        vcpus: 4,
        enrollment_dir: PathBuf::from(
            "/var/lib/macro/enrollments/01900000-0000-7000-8000-000000000001",
        ),
    };

    assert_eq!(
        create_args(&spec),
        [
            "create",
            "--name",
            "macro-computer-01900000-0000-7000-8000-000000000001",
            "--hostname",
            "macro-computer-01900000-0000-7000-8000-000000000001",
            "--label",
            "macro.computer_id=01900000-0000-7000-8000-000000000001",
            "--network",
            "macro_services",
            "--memory",
            "8g",
            "--cpus",
            "4",
            "--privileged",
            "--cgroupns=private",
            "--tmpfs",
            "/run",
            "--tmpfs",
            "/run/lock",
            "--mount",
            "type=bind,source=/var/lib/macro/enrollments/01900000-0000-7000-8000-000000000001,target=/run/macro,readonly",
            "macro-box:latest",
        ]
    );
}

#[test]
fn verbs_name_the_computer_container() {
    assert_eq!(
        verb_args("pause", COMPUTER_ID),
        [
            "pause",
            "macro-computer-01900000-0000-7000-8000-000000000001"
        ]
    );
}

#[test]
fn remove_forces_so_a_missing_container_is_not_an_error() {
    assert_eq!(
        remove_args(COMPUTER_ID),
        [
            "rm",
            "--force",
            "--volumes",
            "macro-computer-01900000-0000-7000-8000-000000000001"
        ]
    );
}

#[test]
fn state_lookup_includes_stopped_containers() {
    assert_eq!(
        state_args(COMPUTER_ID),
        [
            "ps",
            "--all",
            "--filter",
            "label=macro.computer_id=01900000-0000-7000-8000-000000000001",
            "--format",
            "{{.State}}",
        ]
    );
}

#[test]
fn listing_prints_the_computer_id_label_and_state() {
    assert_eq!(
        list_args("macro_services"),
        [
            "ps",
            "--all",
            "--filter",
            "label=macro.computer_id",
            "--filter",
            "network=macro_services",
            "--format",
            "{{.Label \"macro.computer_id\"}} {{.State}}",
        ]
    );
}

struct DockerFixtures(Vec<String>);

impl Drop for DockerFixtures {
    fn drop(&mut self) {
        for name in &self.0 {
            let result = std::process::Command::new("docker")
                .args(["rm", "--force", name])
                .output();
            if !result.is_ok_and(|output| output.status.success()) {
                eprintln!("could not remove Docker fixture {name}");
            }
        }
    }
}

#[tokio::test]
#[ignore = "requires a local Docker daemon with macro-box:latest loaded"]
async fn listing_cannot_expose_another_fleets_containers_to_reconciliation() {
    let own = Uuid::now_v7();
    let other = Uuid::now_v7();
    let mut fixtures = DockerFixtures(Vec::new());
    for (id, network) in [(own, "none"), (other, "host")] {
        let name = format!("fleet-isolation-test-{id}");
        fixtures.0.push(name.clone());
        docker(
            "create",
            &[
                "create".to_owned(),
                "--name".to_owned(),
                name,
                "--network".to_owned(),
                network.to_owned(),
                "--label".to_owned(),
                format!("{COMPUTER_ID_LABEL}={id}"),
                "macro-box:latest".to_owned(),
            ],
        )
        .await
        .unwrap();
    }

    let fleet = DockerFleet::new(
        DockerFleetConfig {
            network: "none".to_owned(),
            ..config()
        },
        Environment::Local,
    )
    .unwrap();
    let listed = fleet.instances().await.unwrap();

    assert!(listed.contains(&(own, InstanceStatus::Stopped)));
    assert!(!listed.iter().any(|(id, _)| *id == other));
}

#[test]
fn listing_maps_docker_states_to_instance_statuses() {
    let output = "01900000-0000-7000-8000-000000000001 running\n\
                  01900000-0000-7000-8000-000000000002 paused\n\
                  01900000-0000-7000-8000-000000000003 exited\n\
                  01900000-0000-7000-8000-000000000004 created\n";

    assert_eq!(
        parse_instances(output).unwrap(),
        [
            (
                Uuid::from_u128(0x0190_0000_0000_7000_8000_0000_0000_0001),
                InstanceStatus::Running
            ),
            (
                Uuid::from_u128(0x0190_0000_0000_7000_8000_0000_0000_0002),
                InstanceStatus::Frozen
            ),
            (
                Uuid::from_u128(0x0190_0000_0000_7000_8000_0000_0000_0003),
                InstanceStatus::Stopped
            ),
            (
                Uuid::from_u128(0x0190_0000_0000_7000_8000_0000_0000_0004),
                InstanceStatus::Stopped
            ),
        ]
    );
}

#[test]
fn listing_rejects_an_unknown_state() {
    let output = "01900000-0000-7000-8000-000000000001 hibernating\n";

    assert!(matches!(
        parse_instances(output),
        Err(DockerFleetError::Malformed(_))
    ));
}

#[test]
fn the_fleet_refuses_every_environment_but_local() {
    assert!(DockerFleet::new(config(), Environment::Local).is_ok());
    assert!(matches!(
        DockerFleet::new(config(), Environment::Develop),
        Err(DockerFleetError::NotLocal(Environment::Develop))
    ));
    assert!(matches!(
        DockerFleet::new(config(), Environment::Production),
        Err(DockerFleetError::NotLocal(Environment::Production))
    ));
}

#[tokio::test]
async fn the_host_registers_with_its_configured_capacity() {
    let fleet = DockerFleet::new(config(), Environment::Local).unwrap();

    assert_eq!(
        fleet.host().await.unwrap(),
        HostRegistration {
            name: "docker-local".to_owned(),
            memory_gb: 64,
            reserve_gb: 16,
            oversell_factor: 4,
        }
    );
}

#[test]
fn only_a_missing_container_is_classified_as_lost() {
    for command in ["start", "restart", "unpause", "pause", "stop"] {
        assert!(
            DockerFleetError::Command {
                command: command.to_owned(),
                status: 1,
                stderr: format!(
                    "Error response from daemon: No such container: {}",
                    container_name(COMPUTER_ID)
                ),
            }
            .is_missing()
        );
        assert!(
            !DockerFleetError::Command {
                command: command.to_owned(),
                status: 1,
                stderr: "Cannot connect to the Docker daemon".to_owned(),
            }
            .is_missing()
        );
    }
}
