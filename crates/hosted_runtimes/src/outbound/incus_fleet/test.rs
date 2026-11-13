use incus_client::{ImageProtocol, ImageRemote, IncusTimeouts};
use macro_user_id::user_id::MacroUserIdStr;
use std::str::FromStr;

use super::*;
use uuid::Uuid;

const COMPUTER_ID: ComputerId =
    ComputerId::new_from_uuid(Uuid::from_u128(0x0190_0000_0000_7000_8000_0000_0000_0001));

fn endpoint() -> IncusEndpoint {
    IncusEndpoint {
        url: "https://localhost:18443".to_owned(),
        timeouts: IncusTimeouts {
            request: Duration::from_secs(90),
            connect: Duration::from_secs(10),
            operation_wait_secs: 60,
            operation_waits: 15,
            state_change_secs: 60,
        },
        client_cert_pem: String::new(),
        client_key_pem: String::new(),
        server_cert_pem: String::new(),
    }
}

fn instance(
    name: &str,
    status: incus_client::InstanceStatus,
    config: &[(&str, &str)],
) -> InstanceInfo {
    InstanceInfo {
        devices: BTreeMap::new(),
        name: name.to_owned(),
        status,
        kind: InstanceKind::VirtualMachine,
        config: config
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect(),
    }
}

fn alias(name: &str) -> ImageSource {
    ImageSource {
        reference: ImageReference::Alias(incus_client::ImageAlias::try_new(name).unwrap()),
        remote: None,
    }
}

fn images(regular: &str, agent: &str) -> GuestImages<ImageSource> {
    GuestImages {
        regular: alias(regular),
        agent: alias(agent),
    }
}

#[test]
fn an_agent_computer_is_created_and_recorded_from_the_agent_image() {
    let images = images("macro-box/2026-11-10", "macro-box-agent/2026-11-10")
        .try_map(IncusImage::new)
        .unwrap();
    for (agent, expected) in [
        (true, "macro-box-agent/2026-11-10"),
        (false, "macro-box/2026-11-10"),
    ] {
        let image = images.for_enrollment(&crate::domain::fakes::enrollment(COMPUTER_ID, agent));
        let config = instance_config(
            &ControlPlaneId::parse("test-a".to_owned()).unwrap(),
            "2026-11-05T10:00:00Z".parse().unwrap(),
            COMPUTER_ID,
            &image.name,
            ComputerResources {
                vcpus: crate::domain::size::Vcpus::new(4),
                memory_gib: crate::domain::size::MemoryGib::new(8),
                disk_gib: crate::domain::size::DiskGib::new(100),
            },
            "{}",
        );
        assert_eq!(image.source, alias(expected));
        assert_eq!(config[IMAGE_KEY], expected);
    }
}

#[test]
fn instance_names_start_with_a_letter_and_fit_a_hostname_label() {
    assert_eq!(
        instance_name(COMPUTER_ID).as_str(),
        "mc-01900000000070008000000000000001"
    );
}

#[test]
fn recorded_limits_and_units_survive_catalog_changes() {
    let config = IncusFleetConfig {
        endpoint: endpoint(),
        host_name: "test-host".to_owned(),
        control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
        reserve_gb: 4,
        oversell_factor: 3,
        shutdown_grace: Duration::from_secs(60),
        images: images("macro-box/2026-11-10", "macro-box-agent/2026-11-10"),
        profile: ProfileName::try_new("macro-box").unwrap(),
        storage_pool: StoragePoolName::try_new("default").unwrap(),
    };

    // A newly offered version cannot change this older purchase's limits.
    let new_catalog = crate::domain::size::CatalogEntry {
        id: crate::domain::size::CatalogEntryId::try_new("standard@2026-12".to_owned()).unwrap(),
        size: crate::domain::size::ComputerSize::Standard,
        resources: ComputerResources {
            vcpus: crate::domain::size::Vcpus::new(12),
            memory_gib: crate::domain::size::MemoryGib::new(24),
            disk_gib: crate::domain::size::DiskGib::new(300),
        },
    };
    assert_eq!(new_catalog.resources.units(), 3);
    let purchased = ComputerResources {
        vcpus: crate::domain::size::Vcpus::new(8),
        memory_gib: crate::domain::size::MemoryGib::new(16),
        disk_gib: crate::domain::size::DiskGib::new(200),
    };
    assert_eq!(purchased.units(), 2);
    let computer = Computer {
        id: COMPUTER_ID,
        team_id: Uuid::nil(),
        name: crate::domain::models::ComputerName::try_new("Recorded computer").unwrap(),
        size: crate::domain::size::ComputerSize::Standard,
        resources: purchased,
        catalog_entry: crate::domain::size::CatalogEntryId::try_new("standard@2026-10".to_owned())
            .unwrap(),
        funding: crate::domain::models::Funding::Stripe {
            price_id: stripe::PriceId::from_str("price_saved").unwrap(),
        },
        host: crate::domain::ids::HostId::new(Uuid::nil()),
        state: crate::domain::fakes::state(crate::domain::lifecycle::Phase::Stopped),
        harness_id: None,
        created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
        created_at: "2026-11-05T10:00:00Z".parse().unwrap(),
        enrolled_at: None,
        setup_completed_at: None,
        default_agent_id: None,
        image: None,
        enrollment_generation: Default::default(),
    };
    let body = instance_body(
        &config,
        &IncusImage::new(config.images.regular.clone()).unwrap(),
        &computer,
        r#"{"x":1}"#,
        "2026-11-05T10:00:00Z".parse().unwrap(),
    )
    .unwrap();

    let mut observed = instance("mc-test", incus_client::InstanceStatus::Stopped, &[]);
    observed.config = body.config.as_ref().unwrap().0.clone();
    observed.devices = body.devices.as_ref().unwrap().0.clone();
    assert!(limits_match(&observed, purchased));
    assert!(!limits_match(&observed, new_catalog.resources));
    observed
        .devices
        .get_mut("root")
        .unwrap()
        .insert("size".to_owned(), "200GiB".to_owned());
    assert!(!limits_match(&observed, purchased));

    assert_eq!(
        serde_json::to_value(&body).unwrap(),
        serde_json::json!({
            "name": "mc-01900000000070008000000000000001",
            "type": "virtual-machine",
            "profiles": ["macro-box"],
            "config": {
                "limits.cpu": "8",
                "limits.memory": "16GiB",
                "migration.stateful": "false",
                "user.macro.computer_id": "01900000-0000-7000-8000-000000000001",
                "user.macro.enrollment": "{\"x\":1}",
                "user.macro.control_plane": "test-a",
                "user.macro.created_at": "2026-11-05T10:00:00+00:00",
                "user.macro.image": "macro-box/2026-11-10",
            },
            "devices": {
                "root": {
                    "type": "disk",
                    "path": "/",
                    "pool": "default",
                    "size": "32GiB",
                },
                "data": {
                    "type": "disk",
                    "pool": "default",
                    "source": "mc-01900000000070008000000000000001-data",
                },
            },
            "source": {
                "type": "image",
                "alias": "macro-box/2026-11-10",
            },
        })
    );
}

#[test]
fn a_remote_image_names_its_server_and_protocol() {
    let config = IncusFleetConfig {
        images: GuestImages {
            regular: ImageSource {
                reference: ImageReference::Alias(
                    incus_client::ImageAlias::try_new("ubuntu/24.04").unwrap(),
                ),
                remote: Some(ImageRemote {
                    server: "https://images.linuxcontainers.org".to_owned(),
                    protocol: ImageProtocol::Simplestreams,
                }),
            },
            agent: alias("ubuntu-agent/24.04"),
        },
        endpoint: endpoint(),
        host_name: "test-host".to_owned(),
        control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
        reserve_gb: 4,
        oversell_factor: 3,
        shutdown_grace: Duration::from_secs(60),
        profile: ProfileName::try_new("macro-box").unwrap(),
        storage_pool: StoragePoolName::try_new("default").unwrap(),
    };

    let computer = Computer {
        id: COMPUTER_ID,
        team_id: Uuid::nil(),
        name: crate::domain::models::ComputerName::try_new("Recorded computer").unwrap(),
        size: crate::domain::size::ComputerSize::Standard,
        resources: crate::domain::size::ComputerResources {
            vcpus: crate::domain::size::Vcpus::new(4),
            memory_gib: crate::domain::size::MemoryGib::new(8),
            disk_gib: crate::domain::size::DiskGib::new(100),
        },
        catalog_entry: crate::domain::size::CatalogEntryId::try_new("standard@2026-10".to_owned())
            .unwrap(),
        funding: crate::domain::models::Funding::Stripe {
            price_id: stripe::PriceId::from_str("price_saved").unwrap(),
        },
        host: crate::domain::ids::HostId::new(Uuid::nil()),
        state: crate::domain::fakes::state(crate::domain::lifecycle::Phase::Stopped),
        harness_id: None,
        created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
        created_at: "2026-11-05T10:00:00Z".parse().unwrap(),
        enrolled_at: None,
        setup_completed_at: None,
        default_agent_id: None,
        image: None,
        enrollment_generation: Default::default(),
    };
    let body = instance_body(
        &config,
        &IncusImage::new(config.images.regular.clone()).unwrap(),
        &computer,
        "{}",
        "2026-11-05T10:00:00Z".parse().unwrap(),
    )
    .unwrap();

    assert_eq!(
        serde_json::to_value(body.source).unwrap(),
        serde_json::json!({
            "type": "image",
            "alias": "ubuntu/24.04",
            "server": "https://images.linuxcontainers.org",
            "protocol": "simplestreams",
        })
    );
}

#[test]
fn listing_keeps_only_computer_instances_and_maps_their_status() {
    let instances = [
        instance(
            "mc-01900000000070008000000000000001",
            incus_client::InstanceStatus::Running,
            &[
                ("user.macro.control_plane", "test-a"),
                (
                    "user.macro.computer_id",
                    "01900000-0000-7000-8000-000000000001",
                ),
            ],
        ),
        instance(
            "mc-01900000000070008000000000000002",
            incus_client::InstanceStatus::Starting,
            &[
                ("user.macro.control_plane", "test-a"),
                (
                    "user.macro.computer_id",
                    "01900000-0000-7000-8000-000000000002",
                ),
            ],
        ),
        instance(
            "mc-01900000000070008000000000000003",
            incus_client::InstanceStatus::Error,
            &[
                ("user.macro.control_plane", "test-a"),
                (
                    "user.macro.computer_id",
                    "01900000-0000-7000-8000-000000000003",
                ),
            ],
        ),
        instance(
            "operator-scratch",
            incus_client::InstanceStatus::Running,
            &[],
        ),
    ];

    assert_eq!(
        computer_instances(
            &instances,
            &ControlPlaneId::parse("test-a".to_owned()).unwrap()
        )
        .unwrap(),
        [
            FleetInstance {
                computer_id: ComputerId::new_from_uuid(Uuid::from_u128(
                    0x0190_0000_0000_7000_8000_0000_0000_0001
                )),
                status: InstanceStatus::Running,
                control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
                created_at: None,
            },
            FleetInstance {
                computer_id: ComputerId::new_from_uuid(Uuid::from_u128(
                    0x0190_0000_0000_7000_8000_0000_0000_0002
                )),
                status: InstanceStatus::Running,
                control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
                created_at: None,
            },
            FleetInstance {
                computer_id: ComputerId::new_from_uuid(Uuid::from_u128(
                    0x0190_0000_0000_7000_8000_0000_0000_0003
                )),
                status: InstanceStatus::Stopped,
                control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
                created_at: None,
            },
        ]
    );
}

/// Orphan cleanup destroys by computer id, so an instance not named for the
/// id it carries is never taken for that computer.
#[test]
fn listing_leaves_out_an_instance_not_named_for_its_computer() {
    let instances = [instance(
        "operator-copy",
        incus_client::InstanceStatus::Running,
        &[
            ("user.macro.control_plane", "test-a"),
            (
                "user.macro.computer_id",
                "01900000-0000-7000-8000-000000000001",
            ),
        ],
    )];

    assert_eq!(
        computer_instances(
            &instances,
            &ControlPlaneId::parse("test-a".to_owned()).unwrap()
        )
        .unwrap(),
        []
    );
}

#[test]
fn listing_rejects_a_computer_id_that_is_not_a_uuid() {
    let instances = [instance(
        "mc-bad",
        incus_client::InstanceStatus::Stopped,
        &[
            ("user.macro.control_plane", "test-a"),
            ("user.macro.computer_id", "not-a-uuid"),
        ],
    )];

    assert!(matches!(
        computer_instances(
            &instances,
            &ControlPlaneId::parse("test-a".to_owned()).unwrap()
        ),
        Err(IncusFleetError::BadComputerId { .. })
    ));
}

#[test]
fn an_unknown_incus_status_is_an_error() {
    let unknown = instance(
        "mc-01900000000070008000000000000001",
        incus_client::InstanceStatus::Unknown {
            code: 999,
            status: "Mystery".to_owned(),
        },
        &[],
    );

    assert!(matches!(
        observed_status(&unknown),
        Err(IncusFleetError::UnknownStatus { .. })
    ));
}

#[test]
fn not_found_is_lost_but_a_host_failure_is_not() {
    assert!(
        IncusFleetError::Incus(IncusError::NotFound {
            message: "Instance not found".to_owned(),
        })
        .is_missing()
    );
    assert!(
        !IncusFleetError::Incus(IncusError::Rejected {
            status: 503,
            message: "Unavailable".to_owned(),
        })
        .is_missing()
    );
}

#[test]
fn invalid_requests_fail_for_good_but_host_trouble_is_retried() {
    let permanent = |error: IncusError| IncusFleetError::Incus(error).is_permanent();
    assert!(permanent(IncusError::OperationFailed {
        operation_id: "op".to_owned(),
        message: "Failed creating instance record: Failed initializing instance: Failed add validation for device \"data\": Only additional disks coming from a shared storage pool are supported with migration.stateful=true".to_owned(),
    }));
    assert!(permanent(IncusError::Rejected {
        status: 400,
        message: "Invalid config".to_owned(),
    }));
    assert!(!permanent(IncusError::OperationFailed {
        operation_id: "op".to_owned(),
        message: "Failed to run: qemu exited".to_owned(),
    }));
    assert!(!permanent(IncusError::Rejected {
        status: 409,
        message: "Instance is busy running a start operation".to_owned(),
    }));
    assert!(!permanent(IncusError::Rejected {
        status: 503,
        message: "Unavailable".to_owned(),
    }));
    assert!(!permanent(IncusError::OperationTimedOut {
        operation_id: "op".to_owned(),
    }));
    assert!(IncusFleetError::DiskTooSmall { disk_gib: 16 }.is_permanent());
}

#[test]
fn listing_ignores_foreign_and_unlabelled_computers_before_parsing_them() {
    let instances = [
        InstanceInfo {
            devices: BTreeMap::new(),
            name: "mc-foreign".to_owned(),
            status: incus_client::InstanceStatus::Running,
            kind: InstanceKind::VirtualMachine,
            config: BTreeMap::from([
                ("user.macro.control_plane".to_owned(), "test-b".to_owned()),
                ("user.macro.computer_id".to_owned(), "not-ours".to_owned()),
            ]),
        },
        InstanceInfo {
            devices: BTreeMap::new(),
            name: "mc-legacy".to_owned(),
            status: incus_client::InstanceStatus::Running,
            kind: InstanceKind::VirtualMachine,
            config: BTreeMap::from([("user.macro.computer_id".to_owned(), "not-ours".to_owned())]),
        },
        InstanceInfo {
            devices: BTreeMap::new(),
            name: "mc-01900000000070008000000000000001".to_owned(),
            status: incus_client::InstanceStatus::Running,
            kind: InstanceKind::VirtualMachine,
            config: BTreeMap::from([
                ("user.macro.control_plane".to_owned(), "test-a".to_owned()),
                (
                    "user.macro.computer_id".to_owned(),
                    "01900000-0000-7000-8000-000000000001".to_owned(),
                ),
                (
                    "user.macro.created_at".to_owned(),
                    "2026-11-05T10:00:00Z".to_owned(),
                ),
            ]),
        },
    ];
    assert_eq!(
        computer_instances(
            &instances,
            &ControlPlaneId::parse("test-a".to_owned()).unwrap()
        )
        .unwrap(),
        vec![FleetInstance {
            computer_id: COMPUTER_ID,
            status: InstanceStatus::Running,
            control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
            created_at: Some("2026-11-05T10:00:00Z".parse().unwrap()),
        }]
    );
}

#[test]
fn only_a_conflict_means_the_data_volume_already_exists() {
    assert!(volume_exists(&IncusError::Rejected {
        status: 409,
        message: "Volume by that name already exists".to_owned(),
    }));
    assert!(!volume_exists(&IncusError::Rejected {
        status: 400,
        message: "Invalid size".to_owned(),
    }));
    assert!(!volume_exists(&IncusError::NotFound {
        message: "Storage pool not found".to_owned(),
    }));
}

#[test]
fn exec_runs_as_the_macro_user_from_its_home() {
    assert_eq!(
        exec_command(&["harnessd"]),
        ExecCommand {
            command: vec!["harnessd".to_owned()],
            environment: BTreeMap::from([
                ("HOME".to_owned(), "/home/macro".to_owned()),
                (
                    "PATH".to_owned(),
                    "/run/wrappers/bin:/run/current-system/sw/bin".to_owned()
                ),
            ]),
            user: 1000,
            group: 1000,
            cwd: "/home/macro".to_owned(),
        }
    );
}
