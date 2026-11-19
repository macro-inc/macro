use super::*;

const MIB: u64 = 1024 * 1024;

fn host_info(limits: serde_json::Value) -> serde_json::Value {
    json!({
        "name": "microvm-profile-1",
        "firecrackerVersion": "v1.18.0",
        "cpus": 32,
        "memoryTotalBytes": 128u64 * 1024 * MIB,
        "memoryAvailableBytes": 100u64 * 1024 * MIB,
        "guestResidentMemoryBytes": 20u64 * 1024 * MIB,
        "ksmSharedBytes": 0,
        "limits": limits,
        "networkSlots": {"total": 128, "free": 120},
        "images": ["macro-box/2026-11-17"],
        "goldens": []
    })
}

fn guest(
    computer_id: &str,
    control_plane_id: &str,
    state: &str,
    usage: serde_json::Value,
) -> serde_json::Value {
    json!({
        "computerId": computer_id,
        "controlPlaneId": control_plane_id,
        "generation": 1,
        "pairingId": "00000000-0000-0000-0000-000000000001",
        "image": "macro-box/2026-11-17",
        "role": "person",
        "resources": {"vcpus": 4, "memoryMib": 8192, "rootDiskGib": 32, "homeDiskGib": 68},
        "state": state,
        "restorePending": false,
        "enrollmentPresent": false,
        "createdAt": "2026-11-17T12:00:00Z",
        "usage": usage
    })
}

#[tokio::test]
async fn memory_is_the_hosts_resident_memory_its_limits_and_this_control_planes_guests() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/host"))
        .respond_with(ResponseTemplate::new(200).set_body_json(host_info(json!({
            "guestMemoryMaxBytes": 1000 * MIB,
            "squeezeAboveBytes": 700 * MIB,
            "squeezeBelowBytes": 800 * MIB,
            "homeDiskGib": [68, 168]
        }))))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/computers"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            guest(
                "01900000-0000-7000-8000-000000000001",
                "test-a",
                "running",
                json!({"residentMemoryBytes": 900 * MIB, "privateMemoryBytes": 600 * MIB, "swapBytes": 100 * MIB, "cpuUsageMicroseconds": 42})
            ),
            guest("01900000-0000-7000-8000-000000000002", "test-a", "hibernated", json!(null)),
            guest("01900000-0000-7000-8000-000000000003", "someone-else", "running", json!(null)),
        ])))
        .mount(&server)
        .await;

    let memory = fleet(&server).memory().await.unwrap();

    // 128 GiB total, 100 GiB available.
    assert_eq!(memory.report.resident_memory_mib, 28 * 1024);
    assert_eq!(
        memory.limits,
        HostLimitsState::Enforced(Some(HostAgentLimits {
            guest_memory_max_mib: 1000,
            squeeze_above_mib: 700,
            squeeze_below_mib: 800,
            home_disk_gib: vec![68, 168],
        }))
    );
    assert_eq!(
        memory.guests,
        vec![
            GuestUsage {
                computer_id: COMPUTER_ID,
                hibernated: false,
                private_memory_bytes: Some(600 * MIB),
                swap_bytes: Some(100 * MIB),
                cpu_usage_microseconds: Some(42),
            },
            GuestUsage {
                computer_id: ComputerId::new_from_uuid(Uuid::from_u128(
                    0x0190_0000_0000_7000_8000_0000_0000_0002
                )),
                hibernated: true,
                private_memory_bytes: None,
                swap_bytes: None,
                cpu_usage_microseconds: None,
            },
        ]
    );
}

#[tokio::test]
async fn a_host_never_given_limits_or_given_only_a_ceiling_reports_none() {
    for limits in [
        json!(null),
        json!({"guestMemoryMaxBytes": 1000 * MIB, "homeDiskGib": [68]}),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/host"))
            .respond_with(ResponseTemplate::new(200).set_body_json(host_info(limits.clone())))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/v1/computers"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;
        assert_eq!(
            fleet(&server).memory().await.unwrap().limits,
            HostLimitsState::Enforced(None),
            "{limits}"
        );
    }
}

#[tokio::test]
async fn limits_are_put_in_bytes() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/v1/host/limits"))
        .and(body_partial_json(json!({
            "guestMemoryMaxBytes": 1000 * MIB,
            "squeezeAboveBytes": 700 * MIB,
            "squeezeBelowBytes": 800 * MIB,
            "homeDiskGib": [68, 168]
        })))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    fleet(&server)
        .set_host_limits(HostAgentLimits {
            guest_memory_max_mib: 1000,
            squeeze_above_mib: 700,
            squeeze_below_mib: 800,
            home_disk_gib: vec![68, 168],
        })
        .await
        .unwrap();
}
