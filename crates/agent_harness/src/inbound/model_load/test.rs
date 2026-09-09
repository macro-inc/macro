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
                description: None,
                group: None,
            }],
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
            }]
        })
    );
}
