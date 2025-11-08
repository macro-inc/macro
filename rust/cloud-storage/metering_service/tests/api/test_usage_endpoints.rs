use crate::common::create_test_usage_request;
use axum::{Router, http::StatusCode};
use axum_test::TestServer;
use chrono::{Duration, Utc};
use metering_db_client::{MeteringDb, Usage, UsageReport, paths};
use metering_service::api::{context::ApiContext, usage};
use serde_json::json;
use sqlx::PgPool;

fn create_test_app(db: MeteringDb) -> Router {
    Router::new()
        .nest(paths::USAGE, usage::router())
        .with_state(ApiContext { db })
}

#[sqlx::test(migrations = "../metering_db_client/migrations")]
async fn test_create_usage_record_endpoint(pool: PgPool) -> sqlx::Result<()> {
    let db = MeteringDb::new(pool);
    let app = create_test_app(db);
    let server = TestServer::new(app).unwrap();

    let request = create_test_usage_request();
    let response = server.post(paths::USAGE).json(&request).await;

    response.assert_status(StatusCode::CREATED);

    let usage: Usage = response.json();
    assert!(!usage.id.to_string().is_empty());
    Ok(())
}

#[sqlx::test(migrations = "../metering_db_client/migrations")]
async fn test_create_usage_record_invalid_payload(pool: PgPool) -> sqlx::Result<()> {
    let db = MeteringDb::new(pool);
    let app = create_test_app(db);
    let server = TestServer::new(app).unwrap();

    let invalid_request = json!({
        "user_id": "invalid-uuid",
        "service_name": "test_service"
        // Missing required fields
    });

    let response = server.post(paths::USAGE).json(&invalid_request).await;

    response.assert_status(StatusCode::UNPROCESSABLE_ENTITY);
    Ok(())
}

#[sqlx::test(migrations = "../metering_db_client/migrations")]
async fn test_get_usage_records_endpoint(pool: PgPool) -> sqlx::Result<()> {
    let db = MeteringDb::new(pool.clone());

    // Create some test data
    let _record1 = db
        .create_usage_record(create_test_usage_request())
        .await
        .unwrap();
    let _record2 = db
        .create_usage_record(create_test_usage_request())
        .await
        .unwrap();

    let app = create_test_app(db);
    let server = TestServer::new(app).unwrap();

    let response = server.get(paths::USAGE).await;
    response.assert_status_ok();

    let body: UsageReport = response.json();
    assert_eq!(body.records.len(), 2);
    assert_eq!(body.total_count, 2);
    assert!(body.total_input_tokens > 0);
    assert!(body.total_output_tokens > 0);
    Ok(())
}

#[sqlx::test(migrations = "../metering_db_client/migrations")]
async fn test_get_usage_records_with_filters(pool: PgPool) -> sqlx::Result<()> {
    let db = MeteringDb::new(pool.clone());

    let user_id = "foo".to_string();
    let mut request = create_test_usage_request();
    request.user_id = user_id.clone();
    let _record = db.create_usage_record(request).await.unwrap();

    // Create another record with different user
    let _other_record = db
        .create_usage_record(create_test_usage_request())
        .await
        .unwrap();

    let app = create_test_app(db);
    let server = TestServer::new(app).unwrap();

    let response = server
        .get(paths::USAGE)
        .add_query_param("user_id", user_id.to_string())
        .await;

    response.assert_status_ok();

    let body: UsageReport = response.json();
    assert_eq!(body.records.len(), 1);
    assert_eq!(body.records[0].user_id, user_id);
    Ok(())
}

#[sqlx::test(migrations = "../metering_db_client/migrations")]
async fn test_get_usage_records_with_pagination(pool: PgPool) -> sqlx::Result<()> {
    let db = MeteringDb::new(pool.clone());

    // Create multiple records
    for _ in 0..5 {
        let _record = db
            .create_usage_record(create_test_usage_request())
            .await
            .unwrap();
    }

    let app = create_test_app(db);
    let server = TestServer::new(app).unwrap();

    let response = server
        .get(paths::USAGE)
        .add_query_param("limit", "3")
        .add_query_param("offset", "0")
        .await;

    response.assert_status_ok();

    let body: UsageReport = response.json();
    assert_eq!(body.records.len(), 3);
    assert_eq!(body.total_count, 5);
    Ok(())
}

#[sqlx::test(migrations = "../metering_db_client/migrations")]
async fn test_get_usage_records_with_date_filter(pool: PgPool) -> sqlx::Result<()> {
    let db = MeteringDb::new(pool.clone());

    let _record = db
        .create_usage_record(create_test_usage_request())
        .await
        .unwrap();

    let app = create_test_app(db);
    let server = TestServer::new(app).unwrap();

    let now = Utc::now();
    let start_date = (now - Duration::hours(1)).to_rfc3339();
    let end_date = (now + Duration::hours(1)).to_rfc3339();

    let response = server
        .get(paths::USAGE)
        .add_query_param("start_date", start_date)
        .add_query_param("end_date", end_date)
        .await;

    response.assert_status_ok();

    let body: UsageReport = response.json();
    assert_eq!(body.records.len(), 1);
    Ok(())
}

#[sqlx::test(migrations = "../metering_db_client/migrations")]
async fn test_service_name_filter(pool: PgPool) -> sqlx::Result<()> {
    let db = MeteringDb::new(pool.clone());

    // Create records with different service names
    let mut request1 = create_test_usage_request();
    request1.service_name = "target_service".to_string();
    let _record1 = db.create_usage_record(request1).await.unwrap();

    let mut request2 = create_test_usage_request();
    request2.service_name = "other_service".to_string();
    let _record2 = db.create_usage_record(request2).await.unwrap();

    let app = create_test_app(db);
    let server = TestServer::new(app).unwrap();

    let response = server
        .get(paths::USAGE)
        .add_query_param("service_name", "target_service")
        .await;

    response.assert_status_ok();

    let body: UsageReport = response.json();
    assert_eq!(body.records.len(), 1);
    assert_eq!(body.records[0].service_name, "target_service");
    Ok(())
}
