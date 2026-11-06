use incus_client::{ImageProtocol, ImageRemote, IncusTimeouts};

use super::*;
use uuid::Uuid;

const COMPUTER_ID: ComputerId =
    ComputerId::new(Uuid::from_u128(0x0190_0000_0000_7000_8000_0000_0000_0001));

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
        stateful: false,
        config: config
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect(),
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
        image: ImageSource {
            reference: ImageReference::Alias(
                incus_client::ImageAlias::try_new("macro-box").unwrap(),
            ),
            remote: None,
        },
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
        price_id: Some(crate::domain::models::StripePriceId::parse("price_saved").unwrap()),
        state: crate::domain::lifecycle::ComputerState::reserved(
            crate::domain::ids::HostId::new(Uuid::nil()),
            "2026-11-05T10:00:00Z".parse().unwrap(),
        ),
        harness_id: None,
        persona: None,
        created_by: "macro|owner@example.com".to_owned(),
        created_at: "2026-11-05T10:00:00Z".parse().unwrap(),
        enrolled_at: None,
    };
    let body = instance_body(
        &config,
        &computer,
        r#"{"x":1}"#,
        "2026-11-05T10:00:00Z".parse().unwrap(),
    );

    let mut observed = instance("mc-test", incus_client::InstanceStatus::Stopped, &[]);
    observed.config = body.config.as_ref().unwrap().0.clone();
    observed.devices = body.devices.as_ref().unwrap().0.clone();
    assert!(limits_match(&observed, purchased));
    assert!(!limits_match(&observed, new_catalog.resources));
    observed
        .devices
        .get_mut("root")
        .unwrap()
        .insert("size.state".to_owned(), "9GiB".to_owned());
    assert!(!limits_match(&observed, purchased));
    observed
        .devices
        .get_mut("root")
        .unwrap()
        .insert("size.state".to_owned(), "17GiB".to_owned());
    observed
        .devices
        .get_mut("root")
        .unwrap()
        .insert("size".to_owned(), "100GiB".to_owned());
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
                "user.macro.computer_id": "01900000-0000-7000-8000-000000000001",
                "user.macro.enrollment": "{\"x\":1}",
                "user.macro.control_plane": "test-a",
                "user.macro.created_at": "2026-11-05T10:00:00+00:00",
            },
            "devices": {
                "root": {
                    "type": "disk",
                    "path": "/",
                    "pool": "default",
                    "size": "200GiB",
                    "size.state": "17GiB",
                },
            },
            "source": {
                "type": "image",
                "alias": "macro-box",
            },
        })
    );
}

#[test]
fn a_remote_image_names_its_server_and_protocol() {
    let config = IncusFleetConfig {
        image: ImageSource {
            reference: ImageReference::Alias(
                incus_client::ImageAlias::try_new("ubuntu/24.04").unwrap(),
            ),
            remote: Some(ImageRemote {
                server: "https://images.linuxcontainers.org".to_owned(),
                protocol: ImageProtocol::Simplestreams,
            }),
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
        price_id: Some(crate::domain::models::StripePriceId::parse("price_saved").unwrap()),
        state: crate::domain::lifecycle::ComputerState::reserved(
            crate::domain::ids::HostId::new(Uuid::nil()),
            "2026-11-05T10:00:00Z".parse().unwrap(),
        ),
        harness_id: None,
        persona: None,
        created_by: "macro|owner@example.com".to_owned(),
        created_at: "2026-11-05T10:00:00Z".parse().unwrap(),
        enrolled_at: None,
    };
    let body = instance_body(
        &config,
        &computer,
        "{}",
        "2026-11-05T10:00:00Z".parse().unwrap(),
    );

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
            incus_client::InstanceStatus::Freezing,
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
                computer_id: ComputerId::new(Uuid::from_u128(
                    0x0190_0000_0000_7000_8000_0000_0000_0001
                )),
                status: InstanceStatus::Running,
                control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
                created_at: None,
            },
            FleetInstance {
                computer_id: ComputerId::new(Uuid::from_u128(
                    0x0190_0000_0000_7000_8000_0000_0000_0002
                )),
                status: InstanceStatus::Frozen,
                control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
                created_at: None,
            },
            FleetInstance {
                computer_id: ComputerId::new(Uuid::from_u128(
                    0x0190_0000_0000_7000_8000_0000_0000_0003
                )),
                status: InstanceStatus::Stopped,
                control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
                created_at: None,
            },
        ]
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
fn listing_ignores_foreign_and_unlabelled_computers_before_parsing_them() {
    let instances = [
        InstanceInfo {
            devices: BTreeMap::new(),
            name: "mc-foreign".to_owned(),
            status: incus_client::InstanceStatus::Running,
            kind: InstanceKind::VirtualMachine,
            stateful: false,
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
            stateful: false,
            config: BTreeMap::from([("user.macro.computer_id".to_owned(), "not-ours".to_owned())]),
        },
        InstanceInfo {
            devices: BTreeMap::new(),
            name: "mc-own".to_owned(),
            status: incus_client::InstanceStatus::Running,
            kind: InstanceKind::VirtualMachine,
            stateful: false,
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
