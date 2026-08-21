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
fn create_request_sends_cpu_memory_and_disk() {
    let snapshot = Snapshot::new("macro-agent-harness".into());
    let request = configuration_parameters(
        &snapshot,
        Env::from(HashMap::new()),
        Labels::from(HashMap::new()),
        8,
        16,
        96,
    );
    let json = serde_json::to_value(&request).expect("create request should serialize");
    assert_eq!(json["snapshot"], "macro-agent-harness");
    assert_eq!(json["cpu"], 8);
    assert_eq!(json["memory"], 16);
    assert_eq!(json["disk"], 96);
    assert_eq!(json["autoStopInterval"], 0);
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
        .create(
            &Snapshot::new(snapshot),
            Env::from(HashMap::new()),
            labels,
            crate::domain::sandbox::SandboxResources {
                cpu: 2,
                memory_gib: 4,
                disk_gib: 96,
            },
        )
        .await
        .expect("create a throwaway sandbox");

    let outcome = async {
        client
            .wait_for_started(&id, Duration::from_secs(180))
            .await?;
        client.resize(&id, Some(8), Some(16), None).await?;
        client
            .wait_for_resize(&id, Duration::from_secs(180))
            .await?;
        let (cpu, memory, disk) = client.resources(&id).await?;
        assert_eq!(cpu, Some(8), "cpu should hot-resize to 8");
        assert_eq!(memory, Some(16), "memory should hot-resize to 16 GiB");
        assert_eq!(disk, Some(96), "disk should stay 96 GiB");
        Ok::<(), DaytonaError>(())
    }
    .await;
    let _ = client.delete(&id).await;
    outcome.expect("hot resize should succeed");
}
