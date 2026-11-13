use super::*;
use crate::domain::enrollment::DeviceSecret;
use crate::domain::models::ComputerName;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU32, Ordering},
};

#[derive(Debug)]
struct FakeDocker {
    exists: bool,
    calls: Mutex<Vec<String>>,
}

impl DockerCommand for FakeDocker {
    fn run(&self, command: &str, args: &[String]) -> Result<String, DockerFleetError> {
        self.calls.lock().unwrap().push(command.to_owned());
        assert!(!args.iter().any(|arg| arg.contains("fixture-pairing-value")));
        if command == "create" {
            assert!(args.iter().any(|arg| arg == "--cpus=6"));
            assert!(args.windows(2).any(|args| args == ["--memory", "12g"]));
            assert!(!args.iter().any(|arg| arg.starts_with("--cpuset")));
        }
        Ok(match command {
            "ps" if self.exists => "running".to_owned(),
            "ps" => String::new(),
            "inspect" => "test-a\t1\t00000000-0000-0000-0000-000000000001\t2026-11-05T10:00:00+00:00\tfixture-image\n".to_owned(),
            "create" | "start" | "restart" | "stop" | "exec" | "volume" => String::new(),
            _ => panic!("unexpected Docker command"),
        })
    }
}

struct TestEnrollment {
    claimed: bool,
    calls: AtomicU32,
}

impl FleetEnrollment for TestEnrollment {
    async fn claimed(&self, pairing: PairingId) -> Result<bool, EnrollmentIssueError> {
        assert_eq!(pairing, PairingId::new_from_uuid(Uuid::from_u128(1)));
        Ok(self.claimed)
    }

    async fn issue(&self) -> Result<Enrollment, EnrollmentIssueError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(Enrollment {
            computer_id: COMPUTER_ID,
            generation: EnrollmentGeneration::new(1),
            pairing_id: PairingId::new_from_uuid(Uuid::from_u128(1)),
            device_secret: DeviceSecret::new("fixture-pairing-value".to_owned()),
            name: ComputerName::try_new("Fixture computer").unwrap(),
            deployment: crate::domain::fakes::deployment(),
            traceparent: None,
        })
    }
}

#[tokio::test]
async fn docker_create_replays_refresh_unclaimed_enrollment_without_rebooting() {
    for (exists, claimed, expected_issue_calls, expected_commands) in [
        (false, false, 1, vec!["ps", "create", "start"]),
        (true, false, 1, vec!["ps", "inspect", "exec"]),
        (true, true, 0, vec!["ps", "inspect"]),
    ] {
        let root = tempfile::tempdir().unwrap();
        let runner = Arc::new(FakeDocker {
            exists,
            calls: Mutex::new(Vec::new()),
        });
        let mut fleet = DockerFleet::new(
            DockerFleetConfig {
                control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
                image: GuestImage::try_new("fixture-image").unwrap(),
                network: "fixture-network".to_owned(),
                enrollment_dir: root.path().to_owned(),
                host_name: "fixture-host".to_owned(),
                memory_gb: 31,
                reserve_gb: 7,
                oversell_factor: 3,
            },
            Environment::Local,
        )
        .unwrap();
        fleet.command = Some(runner.clone());
        if claimed {
            let directory = fleet.enrollment_dir(COMPUTER_ID);
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(
                directory.join(ENROLLMENT_FILE),
                "fixture-existing-enrollment",
            )
            .unwrap();
        }
        let computer = Computer {
            id: COMPUTER_ID,
            team_id: Uuid::nil(),
            name: ComputerName::try_new("Fixture computer").unwrap(),
            size: crate::domain::size::ComputerSize::Standard,
            resources: crate::domain::size::ComputerResources {
                vcpus: crate::domain::size::Vcpus::new(6),
                memory_gib: crate::domain::size::MemoryGib::new(12),
                disk_gib: crate::domain::size::DiskGib::new(100),
            },
            catalog_entry: crate::domain::size::CatalogEntryId::try_new(
                "standard@2026-11".to_owned(),
            )
            .unwrap(),
            funding: crate::domain::models::Funding::Comped {
                reason: "fixture".to_owned(),
            },
            host: crate::domain::ids::HostId::new(Uuid::nil()),
            state: crate::domain::fakes::state(crate::domain::lifecycle::Phase::Provisioning {
                start: true,
            }),
            harness_id: None,
            created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
            created_at: Utc::now(),
            enrolled_at: None,
            setup_completed_at: None,
            default_agent_id: None,
            image: None,
            enrollment_generation: EnrollmentGeneration::new(if exists { 1 } else { 0 }),
        };
        let source = TestEnrollment {
            claimed,
            calls: AtomicU32::new(0),
        };
        let image = fleet
            .create(&computer, EnrollmentGeneration::new(1), &source, true)
            .await
            .unwrap();
        assert_eq!(image.as_str(), "fixture-image");
        assert_eq!(source.calls.load(Ordering::SeqCst), expected_issue_calls);
        assert_eq!(*runner.calls.lock().unwrap(), expected_commands);
        let file = fleet.enrollment_dir(COMPUTER_ID).join(ENROLLMENT_FILE);
        if claimed {
            assert_eq!(
                std::fs::read_to_string(file).unwrap(),
                "fixture-existing-enrollment"
            );
        } else {
            assert!(
                std::fs::read_to_string(&file)
                    .unwrap()
                    .contains("fixture-pairing-value")
            );
            assert_eq!(
                std::fs::metadata(file).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
}

#[derive(Debug, Default)]
struct RecordingDocker {
    calls: Mutex<Vec<Vec<String>>>,
}

impl DockerCommand for RecordingDocker {
    fn run(&self, _command: &str, args: &[String]) -> Result<String, DockerFleetError> {
        self.calls.lock().unwrap().push(args.to_vec());
        Ok(match args[0].as_str() {
            "ps" => "running".to_owned(),
            "inspect" => "test-a\t1\t00000000-0000-0000-0000-000000000001\t2026-11-05T10:00:00+00:00\tmacro-box:2026-11-01\n".to_owned(),
            _ => String::new(),
        })
    }
}

#[tokio::test]
async fn docker_destroy_removes_the_container_then_its_volumes() {
    let root = tempfile::tempdir().unwrap();
    let runner = Arc::new(RecordingDocker::default());
    let mut fleet = DockerFleet::new(
        DockerFleetConfig {
            control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
            image: GuestImage::try_new("macro-box:2026-11-01").unwrap(),
            network: "fixture-network".to_owned(),
            enrollment_dir: root.path().to_owned(),
            host_name: "fixture-host".to_owned(),
            memory_gb: 31,
            reserve_gb: 7,
            oversell_factor: 3,
        },
        Environment::Local,
    )
    .unwrap();
    fleet.command = Some(runner.clone());
    fleet.destroy(COMPUTER_ID).await.unwrap();
    assert_eq!(
        *runner.calls.lock().unwrap(),
        [remove_args(COMPUTER_ID), remove_volumes_args(COMPUTER_ID)]
    );
}
