use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use serde_json::{Value, json};
use tower::ServiceExt;

use super::*;

#[tokio::test]
async fn anonymous_catalog_exposes_only_public_specs() {
    let response = router::<()>()
        .oneshot(
            Request::get("/computers/catalog")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");

    let body = to_bytes(response.into_body(), 8192).await.unwrap();
    let actual: Value = serde_json::from_slice(&body).unwrap();
    let expected_plans: Vec<Value> = current_catalog()
        .iter()
        .map(|entry| {
            json!({
                "catalogId": entry.id.as_str(),
                "size": entry.size,
                "label": entry.size.label(),
                "vcpus": entry.resources.vcpus.get(),
                "memoryGib": entry.resources.memory_gib.get(),
                "diskGib": entry.resources.disk_gib.get(),
            })
        })
        .collect();

    assert_eq!(
        actual,
        json!({ "plans": expected_plans, "pricing": "unavailable" })
    );
}

#[tokio::test]
async fn public_catalog_rejects_post() {
    let response = router::<()>()
        .oneshot(
            Request::post("/computers/catalog")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}
