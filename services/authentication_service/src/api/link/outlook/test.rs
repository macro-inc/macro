use axum::response::IntoResponse;
use fusionauth::error::{FusionAuthClientError, GenericErrorResponse};
use http_body_util::BodyExt;
use utoipa::OpenApi;

use super::*;
use crate::api::swagger::ApiDoc;

#[tokio::test]
async fn missing_microsoft_identity_provider_maps_to_not_found() {
    let response =
        map_identity_provider_lookup_error(FusionAuthClientError::NoIdentityProviderFound)
            .into_response();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["message"], "identity provider not found");
}

#[test]
fn other_identity_provider_lookup_errors_map_to_internal_server_error() {
    let response =
        map_identity_provider_lookup_error(FusionAuthClientError::Generic(GenericErrorResponse {
            message: "FusionAuth unavailable".into(),
        }))
        .into_response();

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[test]
fn disabled_microsoft_oauth_maps_to_internal_server_error() {
    let response = map_microsoft_oauth_error(FusionAuthClientError::MicrosoftOAuthNotConfigured)
        .into_response();

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[test]
fn original_url_is_optional() {
    let params: InitOutlookLinkQueryParams = serde_json::from_value(serde_json::json!({})).unwrap();

    assert!(params.original_url.is_none());
}

#[test]
fn outlook_link_openapi_includes_path_schema_and_error_responses() {
    let openapi = serde_json::to_value(ApiDoc::openapi()).unwrap();
    let operation = &openapi["paths"]["/link/outlook"]["post"];

    assert_eq!(operation["operationId"], "init_outlook_link");
    assert_eq!(
        operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].as_str(),
        Some("#/components/schemas/InitOutlookLinkResponse")
    );

    for status in ["401", "404", "429", "500"] {
        assert!(
            operation["responses"].get(status).is_some(),
            "missing documented {status} response"
        );
    }

    let original_url = operation["parameters"]
        .as_array()
        .unwrap()
        .iter()
        .find(|parameter| parameter["name"] == "original_url")
        .unwrap();
    assert_ne!(original_url["required"].as_bool(), Some(true));
    assert!(
        openapi["components"]["schemas"]
            .get("InitOutlookLinkResponse")
            .is_some()
    );
}
