mod exec;
mod volumes;

use std::collections::BTreeMap;

use serde_json::json;
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::model::{ImageProtocol, ImageRemote, ImageSource, RootDisk};

#[tokio::test]
async fn missing_instance_is_not_found() {
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
        .mount(&server)
        .await;
    let client = IncusClient::with_http_client(
        &server.uri(),
        reqwest::Client::new(),
        IncusTimeouts {
            request: Duration::from_secs(90),
            connect: Duration::from_secs(10),
            operation_wait_secs: 60,
            operation_waits: 15,
            state_change_secs: 60,
        },
    );

    let result = client
        .instance(&InstanceName::try_new("mc-01900000000070008000000000000001").unwrap())
        .await;

    assert!(matches!(
        result,
        Err(IncusError::NotFound { message }) if message == "Instance not found"
    ));
}

#[tokio::test]
async fn other_error_envelopes_are_rejected_with_status_and_message() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path(
            "/1.0/instances/mc-01900000000070008000000000000001/state",
        ))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({
            "type": "error",
            "status": "",
            "status_code": 0,
            "operation": "",
            "error_code": 400,
            "error": "The instance is already stopped",
            "metadata": null
        })))
        .mount(&server)
        .await;
    let client = IncusClient::with_http_client(
        &server.uri(),
        reqwest::Client::new(),
        IncusTimeouts {
            request: Duration::from_secs(90),
            connect: Duration::from_secs(10),
            operation_wait_secs: 60,
            operation_waits: 15,
            state_change_secs: 60,
        },
    );

    let result = client
        .stop(
            &InstanceName::try_new("mc-01900000000070008000000000000001").unwrap(),
            false,
        )
        .await;

    assert!(matches!(
        result,
        Err(IncusError::Rejected { status: 400, message }) if message == "The instance is already stopped"
    ));
}

#[tokio::test]
async fn instance_decodes_the_sync_envelope() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/1.0/instances/mc-01900000000070008000000000000001"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "type": "sync",
            "status": "Success",
            "status_code": 200,
            "operation": "",
            "error_code": 0,
            "error": "",
            "metadata": {
                "architecture": "x86_64",
                "config": {
                    "limits.cpu": "2",
                    "limits.memory": "4GiB",
                    "user.macro.enrollment": "token-1"
                },
                "devices": {"root": {"size": "100GiB"}},
                "ephemeral": false,
                "profiles": ["default"],
                "stateful": false,
                "description": "",
                "created_at": "2026-11-04T22:10:03.123456789Z",
                "expanded_config": {"limits.cpu": "2"},
                "expanded_devices": {"root": {"path": "/", "pool": "default", "type": "disk"}},
                "name": "mc-01900000000070008000000000000001",
                "status": "Stopped",
                "status_code": 102,
                "last_used_at": "2026-11-04T22:11:00Z",
                "location": "none",
                "type": "virtual-machine",
                "project": "default"
            }
        })))
        .mount(&server)
        .await;
    let client = IncusClient::with_http_client(
        &server.uri(),
        reqwest::Client::new(),
        IncusTimeouts {
            request: Duration::from_secs(90),
            connect: Duration::from_secs(10),
            operation_wait_secs: 60,
            operation_waits: 15,
            state_change_secs: 60,
        },
    );

    let instance = client
        .instance(&InstanceName::try_new("mc-01900000000070008000000000000001").unwrap())
        .await
        .unwrap();

    assert_eq!(
        instance,
        InstanceInfo {
            devices: BTreeMap::from([(
                "root".to_owned(),
                BTreeMap::from([("size".to_owned(), "100GiB".to_owned())])
            )]),
            name: "mc-01900000000070008000000000000001".to_owned(),
            status: InstanceStatus::Stopped,
            kind: InstanceKind::VirtualMachine,
            config: BTreeMap::from([
                ("limits.cpu".to_owned(), "2".to_owned()),
                ("limits.memory".to_owned(), "4GiB".to_owned()),
                ("user.macro.enrollment".to_owned(), "token-1".to_owned()),
            ]),
        }
    );
}

#[tokio::test]
async fn create_instance_maps_a_failed_operation() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/1.0/instances"))
        .and(body_json(json!({
            "name": "mc-01900000000070008000000000000001",
            "type": "virtual-machine",
            "profiles": ["default", "macro-box"],
            "config": {"limits.cpu": "2", "user.macro.enrollment": "token-1"},
            "devices": {"root": {"type": "disk", "path": "/", "pool": "default", "size": "40GiB"}},
            "source": {
                "type": "image",
                "alias": "macro-box/2026-11-04",
                "server": "https://images.example.test",
                "protocol": "simplestreams"
            }
        })))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({
            "type": "async",
            "status": "Operation created",
            "status_code": 100,
            "operation": "/1.0/operations/6916c8a6-9b7d-4abd-90b3-aaaaaaaaaaaa",
            "error_code": 0,
            "error": "",
            "metadata": {
                "id": "6916c8a6-9b7d-4abd-90b3-aaaaaaaaaaaa",
                "class": "task",
                "description": "Creating instance",
                "created_at": "2026-11-04T22:10:03.123456789Z",
                "updated_at": "2026-11-04T22:10:03.123456789Z",
                "status": "Running",
                "status_code": 103,
                "resources": {"instances": ["/1.0/instances/mc-01900000000070008000000000000001"]},
                "metadata": null,
                "may_cancel": false,
                "err": "",
                "location": "none"
            }
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/1.0/operations/6916c8a6-9b7d-4abd-90b3-aaaaaaaaaaaa/wait"))
        .and(query_param("timeout", "7"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "type": "sync",
            "status": "Success",
            "status_code": 200,
            "operation": "",
            "error_code": 0,
            "error": "",
            "metadata": {
                "id": "6916c8a6-9b7d-4abd-90b3-aaaaaaaaaaaa",
                "class": "task",
                "description": "Creating instance",
                "created_at": "2026-11-04T22:10:03.123456789Z",
                "updated_at": "2026-11-04T22:10:09.5Z",
                "status": "Failure",
                "status_code": 400,
                "resources": {"instances": ["/1.0/instances/mc-01900000000070008000000000000001"]},
                "metadata": null,
                "may_cancel": false,
                "err": "Failed instance creation: Failed getting remote image info: Image not found",
                "location": "none"
            }
        })))
        .mount(&server)
        .await;
    let client = IncusClient::with_http_client(
        &server.uri(),
        reqwest::Client::new(),
        IncusTimeouts {
            request: Duration::from_secs(90),
            connect: Duration::from_secs(10),
            operation_wait_secs: 7,
            operation_waits: 15,
            state_change_secs: 60,
        },
    );

    let result = client
        .create_instance(CreateInstance {
            name: InstanceName::try_new("mc-01900000000070008000000000000001").unwrap(),
            image: ImageSource {
                reference: ImageReference::Alias(
                    ImageAlias::try_new("macro-box/2026-11-04").unwrap(),
                ),
                remote: Some(ImageRemote {
                    server: "https://images.example.test".to_owned(),
                    protocol: ImageProtocol::Simplestreams,
                }),
            },
            kind: InstanceKind::VirtualMachine,
            profiles: vec![
                crate::ProfileName::try_new("default").unwrap(),
                crate::ProfileName::try_new("macro-box").unwrap(),
            ],
            config: BTreeMap::from([
                ("limits.cpu".to_owned(), "2".to_owned()),
                ("user.macro.enrollment".to_owned(), "token-1".to_owned()),
            ]),
            root_disk: Some(RootDisk {
                pool: crate::StoragePoolName::try_new("default").unwrap(),
                size: "40GiB".to_owned(),
            }),
        })
        .await;

    assert!(matches!(
        result,
        Err(IncusError::OperationFailed { operation_id, message })
            if operation_id == "6916c8a6-9b7d-4abd-90b3-aaaaaaaaaaaa"
                && message == "Failed instance creation: Failed getting remote image info: Image not found"
    ));
}

#[tokio::test]
async fn stop_waits_for_the_operation_to_succeed() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path(
            "/1.0/instances/mc-01900000000070008000000000000001/state",
        ))
        .and(body_json(
            json!({"action": "stop", "force": false, "timeout": 60}),
        ))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({
            "type": "async",
            "status": "Operation created",
            "status_code": 100,
            "operation": "/1.0/operations/0d9f1c2e-1111-4c4c-8e8e-bbbbbbbbbbbb",
            "error_code": 0,
            "error": "",
            "metadata": {
                "id": "0d9f1c2e-1111-4c4c-8e8e-bbbbbbbbbbbb",
                "class": "task",
                "description": "Stopping instance",
                "created_at": "2026-11-04T22:20:00Z",
                "updated_at": "2026-11-04T22:20:00Z",
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
            "/1.0/operations/0d9f1c2e-1111-4c4c-8e8e-bbbbbbbbbbbb/wait",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "type": "sync",
            "status": "Success",
            "status_code": 200,
            "operation": "",
            "error_code": 0,
            "error": "",
            "metadata": {
                "id": "0d9f1c2e-1111-4c4c-8e8e-bbbbbbbbbbbb",
                "class": "task",
                "description": "Stopping instance",
                "created_at": "2026-11-04T22:20:00Z",
                "updated_at": "2026-11-04T22:20:04Z",
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
    let client = IncusClient::with_http_client(
        &server.uri(),
        reqwest::Client::new(),
        IncusTimeouts {
            request: Duration::from_secs(90),
            connect: Duration::from_secs(10),
            operation_wait_secs: 60,
            operation_waits: 15,
            state_change_secs: 60,
        },
    );

    let result = client
        .stop(
            &InstanceName::try_new("mc-01900000000070008000000000000001").unwrap(),
            false,
        )
        .await;

    assert!(result.is_ok());
}

#[tokio::test]
async fn remove_config_key_rewrites_the_instance_under_its_etag() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/1.0/instances/mc-01900000000070008000000000000001"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("ETag", "\"5f1d2c\"")
                .set_body_json(json!({
                    "type": "sync",
                    "status": "Success",
                    "status_code": 200,
                    "metadata": {
                        "architecture": "x86_64",
                        "config": {"limits.cpu": "2", "user.macro.enrollment": "token-1"},
                        "devices": {},
                        "ephemeral": false,
                        "profiles": ["default"],
                        "stateful": false,
                        "description": "",
                        "name": "mc-01900000000070008000000000000001",
                        "status": "Running",
                        "status_code": 103,
                        "type": "virtual-machine"
                    }
                })),
        )
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/1.0/instances/mc-01900000000070008000000000000001"))
        .and(header("If-Match", "\"5f1d2c\""))
        .and(body_json(json!({
            "architecture": "x86_64",
            "config": {"limits.cpu": "2"},
            "devices": {},
            "ephemeral": false,
            "profiles": ["default"],
            "description": ""
        })))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({
            "type": "async",
            "status": "Operation created",
            "status_code": 100,
            "operation": "/1.0/operations/77aa0000-2222-4d4d-9f9f-cccccccccccc",
            "metadata": {
                "id": "77aa0000-2222-4d4d-9f9f-cccccccccccc",
                "class": "task",
                "description": "Updating instance",
                "status": "Success",
                "status_code": 200,
                "err": ""
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    let client = IncusClient::with_http_client(
        &server.uri(),
        reqwest::Client::new(),
        IncusTimeouts {
            request: Duration::from_secs(90),
            connect: Duration::from_secs(10),
            operation_wait_secs: 60,
            operation_waits: 15,
            state_change_secs: 60,
        },
    );

    let result = client
        .remove_config_key(
            &InstanceName::try_new("mc-01900000000070008000000000000001").unwrap(),
            "user.macro.enrollment",
        )
        .await;

    assert!(result.is_ok());
}

#[tokio::test]
async fn resources_reads_host_totals() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/1.0/resources"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "type": "sync",
            "status": "Success",
            "status_code": 200,
            "metadata": {
                "cpu": {"architecture": "x86_64", "sockets": [], "total": 8},
                "memory": {"nodes": [], "hugepages_total": 0, "hugepages_used": 0, "hugepages_size": 2097152, "used": 4294967296_u64, "total": 33331802112_u64},
                "gpu": {"cards": [], "total": 0}
            }
        })))
        .mount(&server)
        .await;
    let client = IncusClient::with_http_client(
        &server.uri(),
        reqwest::Client::new(),
        IncusTimeouts {
            request: Duration::from_secs(90),
            connect: Duration::from_secs(10),
            operation_wait_secs: 60,
            operation_waits: 15,
            state_change_secs: 60,
        },
    );

    let resources = client.resources().await.unwrap();

    assert_eq!(
        resources,
        HostResources {
            memory_total_bytes: 33331802112,
            memory_used_bytes: 4294967296,
            cpu_threads: 8,
        }
    );
}

#[tokio::test]
async fn server_info_reports_untrusted_certificates() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/1.0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "type": "sync",
            "status": "Success",
            "status_code": 200,
            "metadata": {
                "api_extensions": ["instances"],
                "api_status": "stable",
                "api_version": "1.0",
                "auth": "untrusted",
                "public": false,
                "auth_methods": ["tls"]
            }
        })))
        .mount(&server)
        .await;
    let client = IncusClient::with_http_client(
        &server.uri(),
        reqwest::Client::new(),
        IncusTimeouts {
            request: Duration::from_secs(90),
            connect: Duration::from_secs(10),
            operation_wait_secs: 60,
            operation_waits: 15,
            state_change_secs: 60,
        },
    );

    let info = client.server_info().await.unwrap();

    assert_eq!(
        info,
        ServerInfo {
            auth: ServerAuth::Untrusted,
            api_version: "1.0".to_owned(),
            server_name: None,
            server_version: None,
        }
    );
}

#[test]
fn cancelled_operation_is_an_error() {
    let operation: types::Operation = serde_json::from_value(json!({
        "id": "3c1e0f00-3333-4e4e-afaf-dddddddddddd",
        "class": "task",
        "description": "Starting instance",
        "created_at": "2026-11-04T22:30:00Z",
        "updated_at": "2026-11-04T22:30:02Z",
        "status": "Cancelled",
        "status_code": 401,
        "resources": null,
        "metadata": null,
        "may_cancel": true,
        "err": "",
        "location": "none"
    }))
    .unwrap();

    let result = finished_operation("3c1e0f00-3333-4e4e-afaf-dddddddddddd", &operation);

    assert!(matches!(
        result,
        Err(IncusError::OperationCancelled { operation_id })
            if operation_id == "3c1e0f00-3333-4e4e-afaf-dddddddddddd"
    ));
}
