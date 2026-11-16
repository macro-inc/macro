use axum::body::to_bytes;

use super::*;

#[test]
fn target_request_maps_all_supported_harnesses() {
    let in_memory = LoadAgentModels::try_from(LoadAgentModelsRequest {
        harness: ModelHarnessDto::InMemory,
        harness_id: None,
    })
    .unwrap();
    assert_eq!(in_memory.harness, ModelHarness::InMemory);

    let macrod_id = Uuid::new_v4();
    let macrod = LoadAgentModels::try_from(LoadAgentModelsRequest {
        harness: ModelHarnessDto::Macrod,
        harness_id: Some(macrod_id),
    })
    .unwrap();
    assert_eq!(macrod.harness, ModelHarness::Macrod);
    assert_eq!(macrod.harness_id.unwrap().as_uuid(), macrod_id);
}

#[test]
fn handler_errors_map_to_transport_statuses() {
    for (error, status) in [
        (
            LoadAgentModelsError::BadRequest("bad".to_owned()),
            StatusCode::BAD_REQUEST,
        ),
        (LoadAgentModelsError::Forbidden, StatusCode::FORBIDDEN),
        (LoadAgentModelsError::Disconnected, StatusCode::CONFLICT),
        (LoadAgentModelsError::Timeout, StatusCode::GATEWAY_TIMEOUT),
        (
            LoadAgentModelsError::CredentialRejected("reconnect".to_owned()),
            StatusCode::CONFLICT,
        ),
        (
            LoadAgentModelsError::Probe("failed".to_owned()),
            StatusCode::BAD_GATEWAY,
        ),
    ] {
        assert_eq!(model_error_response(error).status(), status);
    }
}

#[tokio::test]
async fn successful_response_serializes_available_catalog() {
    let response = (
        StatusCode::OK,
        Json(LoadAgentModelsResponse::from(AgentModels {
            status: AgentModelsStatus::Available,
            current_model: Some("fast".to_owned()),
            models: vec![agent_fold::domain::model::ModelOption {
                id: "fast".to_owned(),
                name: "Fast".to_owned(),
                supports_images: None,
                description: None,
                group: None,
            }],
            cached_at: None,
        })),
    )
        .into_response();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        serde_json::json!({
            "status": "available",
            "currentModel": "fast",
            "models": [{
                "id": "fast",
                "name": "Fast",
                "description": null,
                "group": null
            }],
            "cachedAt": null
        })
    );
}

/// A refused credential is the caller's to fix, so it answers 4xx with a
/// JSON body the client can tell apart from a disconnected runtime.
#[tokio::test]
async fn a_rejected_credential_answers_a_json_conflict_with_the_message() {
    let response = model_error_response(LoadAgentModelsError::CredentialRejected(
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
