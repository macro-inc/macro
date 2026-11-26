use uuid::Uuid;

use super::*;
use crate::domain::models::HostConnection;

fn images() -> GuestImages<GuestImage> {
    GuestImages {
        regular: GuestImage::try_new("macro-box/2026-11-17").unwrap(),
        agent: GuestImage::try_new("macro-box-agent/2026-11-17").unwrap(),
    }
}

fn settings() -> FirecrackerSettings {
    FirecrackerSettings {
        control_plane_id: ControlPlaneId::try_new("test-a").unwrap(),
        client_cert_pem: "not a certificate".to_owned(),
        client_key_pem: zeroize::Zeroizing::new("not a key".to_owned()),
        connect_timeout: Duration::from_secs(5),
        request_timeout: Duration::from_secs(60),
        images: images(),
    }
}

fn row() -> HostRecord {
    HostRecord {
        id: HostId::new(Uuid::from_u128(2)),
        name: crate::domain::models::HostName::try_new("microvm-1").unwrap(),
        connection: Some(HostConnection {
            endpoint: "https://10.0.0.2:8443".parse().unwrap(),
            server_certificate_pem: "pinned".to_owned(),
        }),
        max_concurrent_starts: 1,
    }
}

fn refusal(fleets: &HostFleets, host: &HostRecord) -> HostFleetsError {
    match fleets.fleet(host) {
        Ok(_) => panic!("{} should not be driven", host.name),
        Err(error) => error,
    }
}

#[test]
fn a_firecracker_row_without_firecracker_settings_fails_loudly() {
    let fleets = HostFleets::new(None, None);

    assert!(matches!(
        refusal(&fleets, &row()),
        HostFleetsError::NoFirecracker { .. }
    ));
}

#[test]
fn only_rows_with_a_connection_are_driven_and_built() {
    let fleets = HostFleets::new(None, Some(settings()));
    let local = HostRecord {
        connection: None,
        ..row()
    };

    assert!(fleets.drives(&row()));
    assert!(!fleets.drives(&local));
    assert!(matches!(
        refusal(&fleets, &local),
        HostFleetsError::NoConnection { .. }
    ));
    // The credentials are checked when the client is built.
    assert!(matches!(
        refusal(&fleets, &row()),
        HostFleetsError::Firecracker(FirecrackerFleetError::Client(
            firecracker_host_api::client::ClientError::Credentials(_)
        ))
    ));
}

#[test]
fn a_firecracker_control_plane_has_no_home_fleet() {
    assert!(HostFleets::new(None, Some(settings())).home().is_none());
}
