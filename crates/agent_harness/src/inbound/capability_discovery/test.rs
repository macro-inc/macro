use axum::body::to_bytes;

use super::*;

#[test]
fn target_request_maps_all_supported_harnesses() {
    let in_memory = DiscoverAgentCapabilities::try_from(DiscoverAgentCapabilitiesRequest {
        harness: CapabilityHarnessDto::InMemory,
        harness_id: None,
        model: None,
    })
    .unwrap();
    assert_eq!(in_memory.harness, CapabilityHarness::InMemory);

    let macrod_id = Uuid::new_v4();
    let macrod = DiscoverAgentCapabilities::try_from(DiscoverAgentCapabilitiesRequest {
        harness: CapabilityHarnessDto::Macrod,
        harness_id: Some(macrod_id),
        model: None,
    })
    .unwrap();
    assert_eq!(macrod.harness, CapabilityHarness::Macrod);
    assert_eq!(macrod.harness_id.unwrap().as_uuid(), macrod_id);
}

#[test]
fn handler_errors_map_to_transport_statuses() {
    for (error, status) in [
        (
            DiscoverAgentCapabilitiesError::BadRequest("bad".to_owned()),
            StatusCode::BAD_REQUEST,
        ),
        (
            DiscoverAgentCapabilitiesError::Forbidden,
            StatusCode::FORBIDDEN,
        ),
        (
            DiscoverAgentCapabilitiesError::Disconnected,
            StatusCode::CONFLICT,
        ),
        (
            DiscoverAgentCapabilitiesError::Timeout,
            StatusCode::GATEWAY_TIMEOUT,
        ),
        (
            DiscoverAgentCapabilitiesError::CredentialRejected("reconnect".to_owned()),
            StatusCode::CONFLICT,
        ),
        (
            DiscoverAgentCapabilitiesError::Probe("failed".to_owned()),
            StatusCode::BAD_GATEWAY,
        ),
    ] {
        assert_eq!(capability_error_response(error).status(), status);
    }
}

#[tokio::test]
async fn successful_response_serializes_config_options() {
    let response = (
        StatusCode::OK,
        Json(DiscoverAgentCapabilitiesResponse::from(AgentCapabilities {
            config_options: vec![agent_fold::domain::session_config::SessionConfigOption {
                id: "reasoning_effort".to_owned(),
                name: "Fast".to_owned(),
                description: None,
                category: Some("thought_level".to_owned()),
                kind: agent_fold::domain::session_config::SessionConfigKind::Select {
                    current_value: "high".to_owned(),
                    options: vec![
                        agent_fold::domain::session_config::SessionConfigSelectOption {
                            value: "high".to_owned(),
                            name: "High".to_owned(),
                            description: None,
                            group: None,
                        },
                    ],
                },
            }],
        })),
    )
        .into_response();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        serde_json::json!({
            "configOptions": [{
                "id": "reasoning_effort",
                "name": "Fast",
                "description": null,
                "category": "thought_level",
                "type": "select",
                "currentValue": "high",
                "options": [{
                    "value": "high",
                    "name": "High",
                    "description": null,
                    "group": null
                }]
            }]
        })
    );
}

/// A refused credential is the caller's to fix, so it answers 4xx with a
/// JSON body the client can tell apart from a disconnected runtime.
#[tokio::test]
async fn a_rejected_credential_answers_a_json_conflict_with_the_message() {
    let response = capability_error_response(DiscoverAgentCapabilitiesError::CredentialRejected(
        "Reconnect Cursor with a personal API key.".to_owned(),
    ));
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        serde_json::json!({
            "code": "provider_credential_rejected",
            "message": "Reconnect Cursor with a personal API key."
        })
    );
}
