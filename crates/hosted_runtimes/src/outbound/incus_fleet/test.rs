use incus_client::{ImageProtocol, ImageRemote};

use super::*;

const COMPUTER_ID: Uuid = Uuid::from_u128(0x0190_0000_0000_7000_8000_0000_0000_0001);

fn endpoint() -> IncusEndpoint {
    IncusEndpoint {
        url: "https://localhost:18443".to_owned(),
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
    let config = IncusFleetConfig::macro_box(endpoint(), "runtime-dev-1".to_owned(), 4, 3);

    let body = instance_body(&config, COMPUTER_ID, ComputerSize::Large, r#"{"x":1}"#);

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
        ..IncusFleetConfig::macro_box(endpoint(), "runtime-dev-1".to_owned(), 4, 3)
    };

    let body = instance_body(&config, COMPUTER_ID, ComputerSize::Standard, "{}");

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
            &[(
                "user.macro.computer_id",
                "01900000-0000-7000-8000-000000000001",
            )],
        ),
        instance(
            "mc-01900000000070008000000000000002",
            incus_client::InstanceStatus::Freezing,
            &[(
                "user.macro.computer_id",
                "01900000-0000-7000-8000-000000000002",
            )],
        ),
        instance(
            "mc-01900000000070008000000000000003",
            incus_client::InstanceStatus::Error,
            &[(
                "user.macro.computer_id",
                "01900000-0000-7000-8000-000000000003",
            )],
        ),
        instance(
            "operator-scratch",
            incus_client::InstanceStatus::Running,
            &[],
        ),
    ];

    assert_eq!(
        computer_instances(&instances).unwrap(),
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
        ]
    );
}

#[test]
fn listing_rejects_a_computer_id_that_is_not_a_uuid() {
    let instances = [instance(
        "mc-bad",
        incus_client::InstanceStatus::Stopped,
        &[("user.macro.computer_id", "not-a-uuid")],
    )];

    assert!(matches!(
        computer_instances(&instances),
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
