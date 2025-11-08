mod api;
mod common;
mod db;

use crate::common::create_test_usage_request;
use axum::{Router, http::StatusCode};
use axum_test::TestServer;
use metering_db_client::{CreateUsageRecordRequest, MeteringDb, paths};
use metering_service::api::{context::ApiContext, health, usage};
use sqlx::PgPool;

fn create_full_app(db: MeteringDb) -> Router {
    Router::new()
        .nest(paths::USAGE, usage::router())
        .with_state(ApiContext { db })
        .nest(paths::HEALTH, health::router())
}

#[sqlx::test(migrations = "../metering_db_client/migrations")]
async fn test_full_usage_workflow(pool: PgPool) -> sqlx::Result<()> {
    let db = MeteringDb::new(pool);
    let app = create_full_app(db);
    let server = TestServer::new(app).unwrap();

    // 1. Check health
    let health_response = server.get(paths::HEALTH).await;
    health_response.assert_status_ok();

    // 2. Create usage record
    let usage_request = create_test_usage_request();

    let create_response = server.post(paths::USAGE).json(&usage_request).await;
    create_response.assert_status(StatusCode::CREATED);

    // 3. Query usage records
    let query_response = server
        .get(paths::USAGE)
        .add_query_param("user_id", usage_request.user_id.to_string())
        .await;
    query_response.assert_status_ok();

    let query_body: serde_json::Value = query_response.json();
    assert_eq!(query_body["total_count"], 1);
    assert_eq!(query_body["records"].as_array().unwrap().len(), 1);
    Ok(())
}

#[sqlx::test(migrations = "../metering_db_client/migrations")]
async fn test_multiple_users_usage_tracking(pool: PgPool) -> sqlx::Result<()> {
    let db = MeteringDb::new(pool);
    let app = create_full_app(db);
    let server = TestServer::new(app).unwrap();

    // Create usage records for multiple users
    let user1_id = "foo".to_string();
    let user2_id = "bar".to_string();

    let mut request1 = create_test_usage_request();
    request1.user_id = user1_id.clone();

    let mut request2 = create_test_usage_request();
    request2.user_id = user2_id;

    // Create records
    server
        .post(paths::USAGE)
        .json(&request1)
        .await
        .assert_status(StatusCode::CREATED);
    server
        .post(paths::USAGE)
        .json(&request2)
        .await
        .assert_status(StatusCode::CREATED);

    // Query all records
    let all_response = server.get(paths::USAGE).await;
    all_response.assert_status_ok();

    let all_body: serde_json::Value = all_response.json();
    assert_eq!(all_body["total_count"], 2);

    // Query user1 records only
    let user1_response = server
        .get(paths::USAGE)
        .add_query_param("user_id", user1_id.to_string())
        .await;
    user1_response.assert_status_ok();

    let user1_body: serde_json::Value = user1_response.json();
    assert_eq!(user1_body["total_count"], 1);
    Ok(())
}

#[sqlx::test(migrations = "../metering_db_client/migrations")]
async fn test_load_sample_fixtures(pool: PgPool) -> sqlx::Result<()> {
    let db = MeteringDb::new(pool);
    let app = create_full_app(db);
    let server = TestServer::new(app).unwrap();

    // Load sample data from fixtures
    let fixtures_content = include_str!("fixtures/sample_usage_records.json");
    let sample_records: Vec<CreateUsageRecordRequest> =
        serde_json::from_str(fixtures_content).unwrap();

    // Create all sample records
    for record in sample_records {
        let response = server.post(paths::USAGE).json(&record).await;
        response.assert_status(StatusCode::CREATED);
    }

    // Verify all records were created
    let all_response = server.get(paths::USAGE).await;
    all_response.assert_status_ok();

    let all_body: serde_json::Value = all_response.json();
    assert_eq!(all_body["total_count"], 3);

    // Test filtering by service
    let chat_service_response = server
        .get(paths::USAGE)
        .add_query_param("service_name", "ai_chat_service")
        .await;
    chat_service_response.assert_status_ok();

    let chat_body: serde_json::Value = chat_service_response.json();
    assert_eq!(chat_body["total_count"], 1);
    Ok(())
}

#[sqlx::test(migrations = "../metering_db_client/migrations")]
async fn test_pagination_consistency(pool: PgPool) -> sqlx::Result<()> {
    let db = MeteringDb::new(pool);
    let app = create_full_app(db);
    let server = TestServer::new(app).unwrap();

    // Create 10 records
    for _i in 0..10 {
        let request = create_test_usage_request();

        server
            .post(paths::USAGE)
            .json(&request)
            .await
            .assert_status(StatusCode::CREATED);
    }

    // Test pagination: get first 5 records
    let page1_response = server
        .get(paths::USAGE)
        .add_query_param("limit", "5")
        .add_query_param("offset", "0")
        .await;
    page1_response.assert_status_ok();

    let page1_body: serde_json::Value = page1_response.json();
    assert_eq!(page1_body["records"].as_array().unwrap().len(), 5);
    assert_eq!(page1_body["total_count"], 10);

    // Test pagination: get next 5 records
    let page2_response = server
        .get(paths::USAGE)
        .add_query_param("limit", "5")
        .add_query_param("offset", "5")
        .await;
    page2_response.assert_status_ok();

    let page2_body: serde_json::Value = page2_response.json();
    assert_eq!(page2_body["records"].as_array().unwrap().len(), 5);
    assert_eq!(page2_body["total_count"], 10);

    // Verify no overlap between pages
    let page1_ids: Vec<String> = page1_body["records"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_str().unwrap().to_string())
        .collect();

    let page2_ids: Vec<String> = page2_body["records"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_str().unwrap().to_string())
        .collect();

    // No IDs should be duplicated between pages
    for id in &page1_ids {
        assert!(!page2_ids.contains(id));
    }
    Ok(())
}
