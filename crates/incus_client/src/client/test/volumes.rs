use super::*;

#[tokio::test]
async fn create_block_volume_posts_an_empty_custom_block_volume() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/1.0/storage-pools/default/volumes/custom"))
        .and(body_json(json!({
            "name": "mc-01900000000070008000000000000001-data",
            "type": "custom",
            "content_type": "block",
            "config": {"size": "20GiB"}
        })))
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

    client
        .create_block_volume(
            &crate::StoragePoolName::try_new("default").unwrap(),
            &crate::StorageVolumeName::try_new("mc-01900000000070008000000000000001-data").unwrap(),
            "20GiB",
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn attach_volume_patches_only_the_data_disk_device() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/1.0/instances/mc-01900000000070008000000000000001"))
        .and(body_json(json!({
            "devices": {
                "macro-data": {
                    "type": "disk",
                    "pool": "default",
                    "source": "mc-01900000000070008000000000000001-data"
                }
            }
        })))
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

    client
        .attach_volume(
            &InstanceName::try_new("mc-01900000000070008000000000000001").unwrap(),
            "macro-data",
            &crate::StoragePoolName::try_new("default").unwrap(),
            &crate::StorageVolumeName::try_new("mc-01900000000070008000000000000001-data").unwrap(),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn rebuild_replaces_the_root_disk_from_the_alias_and_waits() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(
            "/1.0/instances/mc-01900000000070008000000000000001/rebuild",
        ))
        .and(body_json(json!({
            "source": {"type": "image", "alias": "macro-box/2026-11-10"}
        })))
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
                "description": "Rebuilding instance",
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
                "description": "Rebuilding instance",
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

    client
        .rebuild(
            &InstanceName::try_new("mc-01900000000070008000000000000001").unwrap(),
            &ImageAlias::try_new("macro-box/2026-11-10").unwrap(),
        )
        .await
        .unwrap();
}
