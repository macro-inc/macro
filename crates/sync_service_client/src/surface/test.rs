use super::*;
use std::io::{Read, Write};

fn proof() -> SnapshotProof {
    SnapshotProof {
        operation_id: SurfaceOperationId(Uuid::from_u128(1)),
        source_id: Some(Uuid::from_u128(2)),
        digest: "snapshot-digest".into(),
        content_digest: "content-digest".into(),
        revision: vec![("123".into(), 4)],
        oplog_revision: vec![("123".into(), 4)],
    }
}

#[test]
fn wire_proof_round_trips_and_rejects_invalid_operation_ids() {
    let proof = proof();
    let value = serde_json::to_value(&proof).unwrap();
    assert_eq!(value["operation_id"], Uuid::from_u128(1).to_string());
    assert_eq!(
        serde_json::from_value::<SnapshotProof>(value.clone()).unwrap(),
        proof
    );
    let mut invalid = value;
    invalid["operation_id"] = "not-a-uuid".into();
    assert!(serde_json::from_value::<SnapshotProof>(invalid).is_err());
}

/// Minimal HTTP peer validates transport without another mocking dependency.
fn server(
    path: String,
    expected: serde_json::Value,
    status: u16,
    response: String,
) -> (SyncServiceClient, std::thread::JoinHandle<()>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let task = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        let (headers, body_start, length) = loop {
            let mut buf = [0; 4096];
            let count = socket.read(&mut buf).unwrap();
            assert_ne!(count, 0);
            bytes.extend_from_slice(&buf[..count]);
            if let Some(start) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                let headers = String::from_utf8(bytes[..start].to_vec()).unwrap();
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_lowercase()
                            .strip_prefix("content-length: ")
                            .map(|n| n.parse::<usize>().unwrap())
                    })
                    .unwrap();
                break (headers, start + 4, length);
            }
        };
        while bytes.len() < body_start + length {
            let mut buf = [0; 4096];
            let count = socket.read(&mut buf).unwrap();
            assert_ne!(count, 0);
            bytes.extend_from_slice(&buf[..count]);
        }
        assert!(headers.starts_with(&format!("POST {path} HTTP/1.1")));
        assert!(headers.contains("x-internal-auth-key: secret"));
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes[body_start..body_start + length])
                .unwrap(),
            expected
        );
        write!(socket, "HTTP/1.1 {status} Result\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}", response.len()).unwrap();
    });
    (
        SyncServiceClient::new("secret".into(), format!("http://{address}")),
        task,
    )
}

#[tokio::test]
async fn freeze_uses_legacy_namespace_and_typed_export() {
    let proof = proof();
    let id = proof.source_id.unwrap();
    let export = SurfaceSnapshot {
        proof: proof.clone(),
        snapshot: vec![1, 2],
    };
    let (client, task) = server(
        format!("/document/{id}/migration/freeze"),
        serde_json::json!({ "operation_id": proof.operation_id }),
        200,
        serde_json::to_string(&export).unwrap(),
    );
    assert_eq!(
        client
            .freeze_legacy_surface(id, proof.operation_id)
            .await
            .unwrap(),
        export
    );
    task.join().unwrap();
}

#[tokio::test]
async fn surface_lifecycle_methods_use_isolated_routes() {
    let proof = proof();
    let id = proof.source_id.unwrap();
    for operation in ["verify", "activate", "migration/thaw", "migration/retire"] {
        let kind = if operation.starts_with("migration/") {
            "document"
        } else {
            "surface"
        };
        let (client, task) = server(
            format!("/{kind}/{id}/{operation}"),
            serde_json::to_value(&proof).unwrap(),
            200,
            serde_json::to_string(&proof).unwrap(),
        );
        let result = match operation {
            "verify" => client.verify_surface(id, &proof).await,
            "activate" => client.activate_surface(id, &proof).await,
            "migration/thaw" => client.thaw_legacy_surface(id, &proof).await,
            _ => client.retire_legacy_surface(id, &proof).await,
        };
        assert_eq!(result.unwrap(), proof);
        task.join().unwrap();
    }
    let export = SurfaceSnapshot {
        proof: proof.clone(),
        snapshot: vec![1, 2],
    };
    let (client, task) = server(
        format!("/surface/{id}/import"),
        serde_json::to_value(&export).unwrap(),
        200,
        serde_json::to_string(&proof).unwrap(),
    );
    assert_eq!(client.import_surface(id, &export).await.unwrap(), proof);
    task.join().unwrap();
    let (client, task) = server(
        format!("/surface/{id}/initialize_verified"),
        serde_json::json!({"operation_id": proof.operation_id, "snapshot": [1, 2]}),
        200,
        serde_json::to_string(&proof).unwrap(),
    );
    assert_eq!(
        client
            .initialize_surface(id, proof.operation_id, &[1, 2])
            .await
            .unwrap(),
        proof
    );
    task.join().unwrap();
    let (client, task) = server(
        format!("/surface/{id}/revoke"),
        serde_json::json!({}),
        200,
        String::new(),
    );
    client.revoke_surface(id).await.unwrap();
    task.join().unwrap();
}

#[tokio::test]
async fn conflict_is_typed_and_never_string_matched_as_success() {
    let proof = proof();
    let id = proof.source_id.unwrap();
    let (client, task) = server(
        format!("/surface/{id}/verify"),
        serde_json::to_value(&proof).unwrap(),
        409,
        "snapshot already exists".into(),
    );
    assert!(matches!(
        client.verify_surface(id, &proof).await,
        Err(SurfaceSyncError::Rejected(reqwest::StatusCode::CONFLICT))
    ));
    task.join().unwrap();
}
