use super::*;
use crate::domain::enrollment::DeviceSecret;
use crate::domain::models::ComputerName;
use crate::domain::persona_credentials::{PersonaCredentials, PersonaEnrollment, PersonaEnv};
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
        assert!(
            !args
                .iter()
                .any(|arg| arg.contains("fixture-bootstrap-value"))
        );
        Ok(match command {
            "ps" if self.exists => "running".to_owned(),
            "ps" => String::new(),
            "inspect" => "test-a 1 00000000-0000-0000-0000-000000000001".to_owned(),
            "create" | "start" | "restart" | "stop" => String::new(),
            _ => panic!("unexpected Docker command"),
        })
    }
}

struct TestEnrollment {
    claimed: bool,
    calls: AtomicU32,
}

impl FleetEnrollment for TestEnrollment {
    async fn claimed(&self, pairing: PairingId) -> Result<bool, PersonaCredentialError> {
        assert_eq!(pairing, PairingId::new_from_uuid(Uuid::from_u128(1)));
        Ok(self.claimed)
    }

    async fn issue(&self) -> Result<Enrollment, PersonaCredentialError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(Enrollment {
            computer_id: COMPUTER_ID,
            generation: EnrollmentGeneration::new(1),
            pairing_id: PairingId::new_from_uuid(Uuid::from_u128(1)),
            device_secret: DeviceSecret::new("fixture-pairing-value".to_owned()),
            name: ComputerName::try_new("Fixture computer").unwrap(),
            service_url_overrides: Default::default(),
            persona: None,
            persona_enrollment: PersonaEnrollment {
                secrets: PersonaCredentials::new(std::collections::BTreeMap::from([(
                    crate::domain::enrollment::PersonaConfigKey::parse("MACRO_API_KEY").unwrap(),
                    "fixture-bootstrap-value".to_owned(),
                )]))?,
                env: PersonaEnv::default(),
            },
        })
    }
}

#[tokio::test]
async fn docker_create_claim_gate_controls_issuance_rewrite_and_restart() {
    for (exists, claimed, expected_issue_calls, expected_commands) in [
        (false, false, 1, vec!["ps", "create", "ps", "start"]),
        (true, false, 1, vec!["ps", "inspect", "ps", "restart"]),
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
                image: "fixture-image".to_owned(),
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
                vcpus: crate::domain::size::Vcpus::new(4),
                memory_gib: crate::domain::size::MemoryGib::new(8),
                disk_gib: crate::domain::size::DiskGib::new(100),
            },
            catalog_entry: crate::domain::size::CatalogEntryId::try_new(
                "standard@2026-11".to_owned(),
            )
            .unwrap(),
            price_id: None,
            state: crate::domain::lifecycle::ComputerState {
                phase: crate::domain::lifecycle::Phase::Provisioning {
                    host: crate::domain::ids::HostId::new(Uuid::nil()),
                    start: true,
                },
                ..crate::domain::lifecycle::ComputerState::reserved(
                    crate::domain::ids::HostId::new(Uuid::nil()),
                    Utc::now(),
                )
            },
            harness_id: None,
            persona: None,
            created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
            created_at: Utc::now(),
            enrolled_at: None,
            enrollment_generation: EnrollmentGeneration::new(if exists { 1 } else { 0 }),
        };
        let source = TestEnrollment {
            claimed,
            calls: AtomicU32::new(0),
        };
        fleet
            .create(&computer, EnrollmentGeneration::new(1), &source, true)
            .await
            .unwrap();
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
                    .contains("fixture-bootstrap-value")
            );
            assert_eq!(
                std::fs::metadata(file).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
}
