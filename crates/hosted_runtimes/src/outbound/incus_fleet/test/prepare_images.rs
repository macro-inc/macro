use serde_json::json;
use wiremock::matchers::{body_partial_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

const NOT_FOUND: &str = r#"{"type":"error","status":"","status_code":0,"operation":"","error_code":404,"error":"not found","metadata":null}"#;

fn fleet(server: &MockServer) -> IncusFleet {
    IncusFleet::with_client(
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
    .unwrap()
}

#[tokio::test]
async fn a_new_image_is_unpacked_once_by_an_instance_that_never_starts() {
    let server = MockServer::start().await;
    // Resolved on every pass, so a repointed alias is warmed too.
    Mock::given(method("GET"))
        .and(path("/1.0/images/aliases/macro-box%2F2026-11-10"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "type": "sync", "status": "Success", "status_code": 200, "operation": "",
            "error_code": 0, "error": "",
            "metadata": {
                "name": "macro-box/2026-11-10",
                "description": "",
                "target": "51ec8110e72849c2c96d0301b480a9b4a16af93907fc484728e01011cddeb1a3",
                "type": "virtual-machine"
            }
        })))
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/1.0/images/aliases/macro-box-agent%2F2026-11-10"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "type": "sync", "status": "Success", "status_code": 200, "operation": "",
            "error_code": 0, "error": "",
            "metadata": {
                "name": "macro-box-agent/2026-11-10",
                "description": "",
                "target": "1be639b7b5360000000000000000000000000000000000000000000000000000",
                "type": "virtual-machine"
            }
        })))
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/1.0/instances/mc-51ec8110e72849c2c96d0301b480a9b4"))
        .respond_with(ResponseTemplate::new(404).set_body_raw(NOT_FOUND, "application/json"))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/1.0/instances/mc-1be639b7b53600000000000000000000"))
        .respond_with(ResponseTemplate::new(404).set_body_raw(NOT_FOUND, "application/json"))
        .expect(1)
        .mount(&server)
        .await;
    // The regular image has never been used on this pool; the agent image has.
    Mock::given(method("GET"))
        .and(path(
            "/1.0/storage-pools/default/volumes/image/51ec8110e72849c2c96d0301b480a9b4a16af93907fc484728e01011cddeb1a3",
        ))
        .respond_with(ResponseTemplate::new(404).set_body_raw(NOT_FOUND, "application/json"))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(
            "/1.0/storage-pools/default/volumes/image/1be639b7b5360000000000000000000000000000000000000000000000000000",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "type": "sync", "status": "Success", "status_code": 200, "operation": "",
            "error_code": 0, "error": "",
            "metadata": {
                "name": "1be639b7b5360000000000000000000000000000000000000000000000000000",
                "type": "image",
                "content_type": "block",
                "config": {},
                "used_by": []
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/1.0/instances"))
        .and(body_partial_json(json!({
            "name": "mc-51ec8110e72849c2c96d0301b480a9b4",
            "type": "virtual-machine",
            "profiles": ["macro-box"],
            "config": {"migration.stateful": "false"},
            "devices": {"root": {"type": "disk", "path": "/", "pool": "default", "size": "32GiB"}},
            "source": {
                "type": "image",
                "fingerprint": "51ec8110e72849c2c96d0301b480a9b4a16af93907fc484728e01011cddeb1a3"
            }
        })))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({
            "type": "async", "status": "Operation created", "status_code": 100,
            "operation": "/1.0/operations/3b0e6a52-1111-4d4d-9f9f-cccccccccccc",
            "error_code": 0, "error": "",
            "metadata": {
                "id": "3b0e6a52-1111-4d4d-9f9f-cccccccccccc", "class": "task",
                "description": "Creating instance",
                "created_at": "2026-11-10T18:00:00Z", "updated_at": "2026-11-10T18:00:00Z",
                "status": "Running", "status_code": 103, "resources": {}, "metadata": null,
                "may_cancel": false, "err": "", "location": "none"
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(
            "/1.0/operations/3b0e6a52-1111-4d4d-9f9f-cccccccccccc/wait",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "type": "sync", "status": "Success", "status_code": 200, "operation": "",
            "error_code": 0, "error": "",
            "metadata": {
                "id": "3b0e6a52-1111-4d4d-9f9f-cccccccccccc", "class": "task",
                "description": "Creating instance",
                "created_at": "2026-11-10T18:00:00Z", "updated_at": "2026-11-10T18:00:31Z",
                "status": "Success", "status_code": 200, "resources": {}, "metadata": null,
                "may_cancel": false, "err": "", "location": "none"
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/1.0/instances/mc-51ec8110e72849c2c96d0301b480a9b4"))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({
            "type": "async", "status": "Operation created", "status_code": 100,
            "operation": "/1.0/operations/3b0e6a52-2222-4d4d-9f9f-cccccccccccc",
            "error_code": 0, "error": "",
            "metadata": {
                "id": "3b0e6a52-2222-4d4d-9f9f-cccccccccccc", "class": "task",
                "description": "Deleting instance",
                "created_at": "2026-11-10T18:00:31Z", "updated_at": "2026-11-10T18:00:31Z",
                "status": "Running", "status_code": 103, "resources": {}, "metadata": null,
                "may_cancel": false, "err": "", "location": "none"
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
            "type": "sync", "status": "Success", "status_code": 200, "operation": "",
            "error_code": 0, "error": "",
            "metadata": {
                "id": "3b0e6a52-2222-4d4d-9f9f-cccccccccccc", "class": "task",
                "description": "Deleting instance",
                "created_at": "2026-11-10T18:00:31Z", "updated_at": "2026-11-10T18:00:32Z",
                "status": "Success", "status_code": 200, "resources": {}, "metadata": null,
                "may_cancel": false, "err": "", "location": "none"
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    let fleet = fleet(&server);

    fleet.prepare_images().await.unwrap();
    // A later pass only resolves the aliases.
    fleet.prepare_images().await.unwrap();
}

#[tokio::test]
async fn a_warm_up_interrupted_after_its_create_leaves_no_instance_behind() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/1.0/images/aliases/macro-box%2F2026-11-10"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "type": "sync", "status": "Success", "status_code": 200, "operation": "",
            "error_code": 0, "error": "",
            "metadata": {
                "name": "macro-box/2026-11-10",
                "description": "",
                "target": "51ec8110e72849c2c96d0301b480a9b4a16af93907fc484728e01011cddeb1a3",
                "type": "virtual-machine"
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    // Both images are the same one, which is prepared once.
    Mock::given(method("GET"))
        .and(path("/1.0/images/aliases/macro-box-agent%2F2026-11-10"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "type": "sync", "status": "Success", "status_code": 200, "operation": "",
            "error_code": 0, "error": "",
            "metadata": {
                "name": "macro-box-agent/2026-11-10",
                "description": "",
                "target": "51ec8110e72849c2c96d0301b480a9b4a16af93907fc484728e01011cddeb1a3",
                "type": "virtual-machine"
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    // The previous process stopped between creating the instance (which
    // unpacked the image) and deleting it.
    Mock::given(method("GET"))
        .and(path("/1.0/instances/mc-51ec8110e72849c2c96d0301b480a9b4"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "type": "sync", "status": "Success", "status_code": 200, "operation": "",
            "error_code": 0, "error": "",
            "metadata": {
                "name": "mc-51ec8110e72849c2c96d0301b480a9b4",
                "type": "virtual-machine",
                "status": "Stopped",
                "status_code": 102,
                "config": {"migration.stateful": "false"},
                "devices": {}
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/1.0/instances/mc-51ec8110e72849c2c96d0301b480a9b4"))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({
            "type": "async", "status": "Operation created", "status_code": 100,
            "operation": "/1.0/operations/3b0e6a52-2222-4d4d-9f9f-cccccccccccc",
            "error_code": 0, "error": "",
            "metadata": {
                "id": "3b0e6a52-2222-4d4d-9f9f-cccccccccccc", "class": "task",
                "description": "Deleting instance",
                "created_at": "2026-11-10T18:00:31Z", "updated_at": "2026-11-10T18:00:31Z",
                "status": "Running", "status_code": 103, "resources": {}, "metadata": null,
                "may_cancel": false, "err": "", "location": "none"
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
            "type": "sync", "status": "Success", "status_code": 200, "operation": "",
            "error_code": 0, "error": "",
            "metadata": {
                "id": "3b0e6a52-2222-4d4d-9f9f-cccccccccccc", "class": "task",
                "description": "Deleting instance",
                "created_at": "2026-11-10T18:00:31Z", "updated_at": "2026-11-10T18:00:32Z",
                "status": "Success", "status_code": 200, "resources": {}, "metadata": null,
                "may_cancel": false, "err": "", "location": "none"
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(
            "/1.0/storage-pools/default/volumes/image/51ec8110e72849c2c96d0301b480a9b4a16af93907fc484728e01011cddeb1a3",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "type": "sync", "status": "Success", "status_code": 200, "operation": "",
            "error_code": 0, "error": "",
            "metadata": {
                "name": "51ec8110e72849c2c96d0301b480a9b4a16af93907fc484728e01011cddeb1a3",
                "type": "image",
                "content_type": "block",
                "config": {},
                "used_by": []
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/1.0/instances"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;
    let fleet = fleet(&server);

    fleet.prepare_images().await.unwrap();
}
