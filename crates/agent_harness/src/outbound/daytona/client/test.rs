use super::*;

mod live_env {
    macro_env_var::maybe_env_vars! {
        pub struct DaytonaApiKey;
        pub struct DaytonaSnapshot;
        pub struct DaytonaApiUrl;
    }
}

fn optional_env(value: Option<impl AsRef<str>>) -> Option<String> {
    value
        .map(|value| value.as_ref().trim().to_owned())
        .filter(|value| !value.is_empty())
}

#[test]
fn sandbox_list_deserializes_the_paginated_daytona_response() {
    let response = serde_json::json!({
        "items": [{
            "id": "sandbox-1",
            "state": "started",
            "errorReason": null,
            "labels": {
                "macro.agent_session_id": "session-1"
            }
        }],
        "nextCursor": null
    });

    let response: SandboxListDto =
        serde_json::from_value(response).expect("Daytona's sandbox list response should parse");

    assert_eq!(response.items.len(), 1);
    assert_eq!(response.items[0].id, "sandbox-1");
    assert_eq!(response.items[0].state, SandboxState::Started);
}

#[test]
fn create_request_omits_cpu_memory_and_disk() {
    let snapshot = Snapshot::new("macro-agent-harness".into());
    let request = configuration_parameters(
        &snapshot,
        Env::from(HashMap::new()),
        Labels::from(HashMap::new()),
    );
    let json = serde_json::to_value(&request).expect("create request should serialize");
    assert_eq!(json["snapshot"], "macro-agent-harness");
    assert_eq!(json["autoStopInterval"], 0);
    assert!(json.get("cpu").is_none());
    assert!(json.get("memory").is_none());
    assert!(json.get("disk").is_none());
}

#[test]
fn resize_request_omits_unset_fields() {
    let json = serde_json::to_value(&ResizeSandboxRequest {
        cpu: Some(16),
        memory: Some(32),
        disk: None,
    })
    .expect("resize request should serialize");
    assert_eq!(json["cpu"], 16);
    assert_eq!(json["memory"], 32);
    assert!(json.get("disk").is_none());
}

#[test]
fn resize_404_cannot_post_means_the_route_is_missing() {
    assert!(resize_not_enabled(
        reqwest::StatusCode::NOT_FOUND,
        r#"{"message":"Cannot POST /api/sandbox/abc/resize"}"#,
    ));
    assert!(!resize_not_enabled(
        reqwest::StatusCode::NOT_FOUND,
        r#"{"message":"Sandbox with ID or name abc not found"}"#,
    ));
}

#[tokio::test]
async fn live_hot_resize_increases_cpu_and_memory_without_touching_disk() {
    let Some(api_key) = live_env::DaytonaApiKey::new().and_then(|key| optional_env(key.value()))
    else {
        eprintln!("skipping live Daytona hot-resize: DAYTONA_API_KEY is unset");
        return;
    };
    let snapshot = live_env::DaytonaSnapshot::new()
        .and_then(|snapshot| optional_env(snapshot.value()))
        .unwrap_or_else(|| "macro-agent-harness".to_owned());
    let api_url = live_env::DaytonaApiUrl::new()
        .and_then(|url| optional_env(url.value()))
        .unwrap_or_else(|| "https://app.daytona.io/api".to_owned());
    let client = DaytonaClient::new(api_url, DaytonaApiKey::new(api_key));
    let labels = Labels::from(HashMap::from([(
        "macro.test".to_owned(),
        format!("sandbox-size-{}", macro_uuid::generate_uuid_v7()),
    )]));
    let id = client
        .create(&Snapshot::new(snapshot), Env::from(HashMap::new()), labels)
        .await
        .expect("create a throwaway sandbox");

    let outcome = async {
        client
            .wait_for_started(&id, Duration::from_secs(300))
            .await?;
        let (cpu, memory, disk) = client.resources(&id).await?;
        let cpu = cpu.expect("daytona should report cpu after start");
        let memory = memory.expect("daytona should report memory after start");
        eprintln!("snapshot sandbox started at cpu={cpu} memory_gib={memory} disk={disk:?}");

        // Stay inside Daytona's default per-sandbox cap (4 vCPU / 8 GiB).
        // Create-from-snapshot inherits those quotas, so the only in-quota
        // hot-up is: stop, shrink, start, then raise CPU/RAM without disk.
        let (low_cpu, low_memory) = (cpu.min(2), memory.min(4));
        assert!(
            low_cpu < cpu || low_memory < memory,
            "need headroom under the snapshot quota to hot-resize back up"
        );

        eprintln!("stopping to shrink cpu {cpu}->{low_cpu} memory_gib {memory}->{low_memory}");
        client.stop(&id).await?;
        client
            .wait_for_stopped(&id, Duration::from_secs(60))
            .await?;
        match client
            .resize(&id, Some(low_cpu), Some(low_memory), None)
            .await
        {
            Ok(()) => {}
            Err(error @ DaytonaError::ResizeNotEnabled) => {
                eprintln!(
                    "skipping live Daytona hot-resize: create-without-resources worked \
                     (cpu={cpu} memory_gib={memory} disk={disk:?}) but POST /sandbox/{{id}}/resize \
                     404s Cannot POST. The official Python SDK hits the same 404. A missing \
                     sandbox 404s with not found, so the route exists and this organization \
                     does not get the handler."
                );
                return Err(error);
            }
            Err(error) => return Err(error),
        }
        client
            .wait_for_resize(&id, Duration::from_secs(300))
            .await?;
        client.start(&id).await?;
        client
            .wait_for_started(&id, Duration::from_secs(300))
            .await?;

        eprintln!(
            "hot-resizing cpu {low_cpu}->{cpu} memory_gib {low_memory}->{memory} without disk"
        );
        client.resize(&id, Some(cpu), Some(memory), None).await?;
        client
            .wait_for_resize(&id, Duration::from_secs(300))
            .await?;
        let (after_cpu, after_memory, after_disk) = client.resources(&id).await?;
        assert_eq!(after_cpu, Some(cpu), "cpu should hot-resize");
        assert_eq!(after_memory, Some(memory), "memory should hot-resize");
        assert_eq!(after_disk, disk, "disk should be unchanged");
        Ok::<(), DaytonaError>(())
    }
    .await;
    if let Err(error) = client.delete(&id).await {
        eprintln!("failed to delete throwaway sandbox {id}: {error}");
    }
    match outcome {
        Ok(()) => {}
        Err(DaytonaError::ResizeNotEnabled) => {}
        Err(error) => panic!("hot resize should succeed: {error}"),
    }
}
