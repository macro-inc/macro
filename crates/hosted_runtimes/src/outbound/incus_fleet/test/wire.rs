use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

struct FixtureEnrollment;

impl FleetEnrollment for FixtureEnrollment {
    async fn claimed(&self, _: PairingId) -> Result<bool, EnrollmentIssueError> {
        panic!("a computer without an instance has no pairing to check");
    }

    async fn issue(&self) -> Result<crate::domain::enrollment::Enrollment, EnrollmentIssueError> {
        Ok(crate::domain::fakes::enrollment(COMPUTER_ID, false))
    }
}

#[tokio::test]
async fn a_retried_create_reuses_the_data_volume_an_earlier_attempt_made() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/1.0/instances/mc-01900000000070008000000000000001"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({
            "type": "error",
            "status": "",
            "status_code": 0,
            "operation": "",
            "error_code": 404,
            "error": "Instance not found",
            "metadata": null
        })))
        .expect(1)
        .mount(&server)
        .await;
    // The earlier attempt made the volume, then failed before the instance.
    Mock::given(method("POST"))
        .and(path("/1.0/storage-pools/default/volumes/custom"))
        .respond_with(ResponseTemplate::new(409).set_body_json(json!({
            "type": "error",
            "status": "",
            "status_code": 0,
            "operation": "",
            "error_code": 409,
            "error": "Volume by that name already exists",
            "metadata": null
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/1.0/instances"))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({
            "type": "async",
            "status": "Operation created",
            "status_code": 100,
            "operation": "/1.0/operations/3b0e6a52-2222-4d4d-9f9f-cccccccccccc",
            "error_code": 0,
            "error": "",
            "metadata": {
                "id": "3b0e6a52-2222-4d4d-9f9f-cccccccccccc",
                "class": "task",
                "description": "Creating instance",
                "created_at": "2026-11-10T18:00:00Z",
                "updated_at": "2026-11-10T18:00:00Z",
                "status": "Running",
                "status_code": 103,
                "resources": {"instances": ["/1.0/instances/mc-01900000000070008000000000000001"]},
                "metadata": null,
                "may_cancel": false,
                "err": "",
                "location": "none"
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(
            "/1.0/operations/3b0e6a52-2222-4d4d-9f9f-cccccccccccc/wait",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "type": "sync",
            "status": "Success",
            "status_code": 200,
            "operation": "",
            "error_code": 0,
            "error": "",
            "metadata": {
                "id": "3b0e6a52-2222-4d4d-9f9f-cccccccccccc",
                "class": "task",
                "description": "Creating instance",
                "created_at": "2026-11-10T18:00:00Z",
                "updated_at": "2026-11-10T18:00:40Z",
                "status": "Success",
                "status_code": 200,
                "resources": {"instances": ["/1.0/instances/mc-01900000000070008000000000000001"]},
                "metadata": null,
                "may_cancel": false,
                "err": "",
                "location": "none"
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    let fleet = IncusFleet::with_client(
        IncusFleetConfig {
            endpoint: endpoint(),
            host_name: "test-host".to_owned(),
            control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
            reserve_gb: 4,
            oversell_factor: 3,
            shutdown_grace: Duration::from_secs(60),
            images: images("macro-box/2026-11-10", "macro-box-agent/2026-11-10"),
            profile: ProfileName::try_new("macro-box").unwrap(),
            storage_pool: StoragePoolName::try_new("default").unwrap(),
        },
        IncusClient::over_plain_http(&server.uri(), endpoint().timeouts),
    )
    .unwrap();
    let computer = Computer {
        id: COMPUTER_ID,
        team_id: Uuid::nil(),
        name: crate::domain::models::ComputerName::try_new("Fixture computer").unwrap(),
        size: crate::domain::size::ComputerSize::Standard,
        resources: ComputerResources {
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
        state: crate::domain::fakes::state(crate::domain::lifecycle::Phase::Provisioning {
            start: false,
        }),
        harness_id: None,
        created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
        created_at: "2026-11-05T10:00:00Z".parse().unwrap(),
        enrolled_at: None,
        setup_completed_at: None,
        default_agent_id: None,
        image: None,
        enrollment_generation: Default::default(),
    };

    let image = fleet
        .create(
            &computer,
            EnrollmentGeneration::new(1),
            &FixtureEnrollment,
            false,
        )
        .await
        .unwrap();

    assert_eq!(image, GuestImage::try_new("macro-box/2026-11-10").unwrap());
}

#[tokio::test]
async fn destroying_a_computer_whose_instance_was_never_created_deletes_its_data_volume() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/1.0/instances/mc-01900000000070008000000000000001"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({
            "type": "error",
            "status": "",
            "status_code": 0,
            "operation": "",
            "error_code": 404,
            "error": "Instance not found",
            "metadata": null
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path(
            "/1.0/storage-pools/default/volumes/custom/mc-01900000000070008000000000000001-data",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "type": "sync",
            "status": "Success",
            "status_code": 200,
            "operation": "",
            "error_code": 0,
            "error": "",
            "metadata": {}
        })))
        .expect(1)
        .mount(&server)
        .await;
    let fleet = IncusFleet::with_client(
        IncusFleetConfig {
            endpoint: endpoint(),
            host_name: "test-host".to_owned(),
            control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
            reserve_gb: 4,
            oversell_factor: 3,
            shutdown_grace: Duration::from_secs(60),
            images: images("macro-box/2026-11-10", "macro-box-agent/2026-11-10"),
            profile: ProfileName::try_new("macro-box").unwrap(),
            storage_pool: StoragePoolName::try_new("default").unwrap(),
        },
        IncusClient::over_plain_http(&server.uri(), endpoint().timeouts),
    )
    .unwrap();

    fleet.destroy(COMPUTER_ID).await.unwrap();
}
