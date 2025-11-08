use axum::Router;
use axum_test::TestServer;
use metering_db_client::paths;
use metering_service::api::health::{HealthResponse, router};

fn create_health_app() -> Router {
    Router::new().nest(paths::HEALTH, router())
}

#[tokio::test]
async fn test_health_endpoint() {
    let app = create_health_app();
    let server = TestServer::new(app).unwrap();

    let response = server.get(paths::HEALTH).await;
    response.assert_status_ok();

    let body: HealthResponse = response.json();
    assert_eq!(body.status, "healthy");
    assert_eq!(body.service, "metering");
    assert!(body.timestamp.timestamp() > 0);
}

#[tokio::test]
async fn test_health_endpoint_structure() {
    let app = create_health_app();
    let server = TestServer::new(app).unwrap();

    let response = server.get(paths::HEALTH).await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();

    // Verify the structure
    assert!(body.get("status").is_some());
    assert!(body.get("service").is_some());
    assert!(body.get("timestamp").is_some());

    // Verify types
    assert!(body["status"].is_string());
    assert!(body["service"].is_string());
    assert!(body["timestamp"].is_string());
}
