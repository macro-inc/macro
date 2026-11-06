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
        instance_name(COMPUTER_ID),
        "mc-01900000000070008000000000000001"
    );
}

#[test]
fn a_large_computer_gets_its_limits_disk_and_state_room() {
    let config = IncusFleetConfig {
        endpoint: endpoint(),
        host_name: "test-host".to_owned(),
        control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
        reserve_gb: 4,
        oversell_factor: 3,
        shutdown_grace: Duration::from_secs(60),
        image: ImageSource {
            reference: ImageReference::Alias("macro-box".to_owned()),
            remote: None,
        },
        profile: "macro-box".to_owned(),
        storage_pool: "default".to_owned(),
    };

    let body = instance_body(
        &config,
        COMPUTER_ID,
        ComputerSize::Large,
        r#"{"x":1}"#,
        "2026-11-05T10:00:00Z".parse().unwrap(),
    );

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
            reference: ImageReference::Alias("ubuntu/24.04".to_owned()),
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
        profile: "macro-box".to_owned(),
        storage_pool: "default".to_owned(),
    };

    let body = instance_body(
        &config,
        COMPUTER_ID,
        ComputerSize::Standard,
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
            name: "mc-legacy".to_owned(),
            status: incus_client::InstanceStatus::Running,
            kind: InstanceKind::VirtualMachine,
            stateful: false,
            config: BTreeMap::from([("user.macro.computer_id".to_owned(), "not-ours".to_owned())]),
        },
        InstanceInfo {
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
