use crate::common::create_test_usage_request;
use chrono::{Duration, Utc};
use metering_db_client::{MeteringDb, UsageQuery};
use sqlx::PgPool;

#[sqlx::test(migrations = "../metering_db_client/migrations")]
async fn test_create_usage_record(pool: PgPool) -> sqlx::Result<()> {
    let db = MeteringDb::new(pool);

    let request = create_test_usage_request();
    let user_id = request.user_id.clone();
    let service_name = request.service_name.clone();

    let result = db.create_usage_record(request.clone()).await;
    assert!(result.is_ok());

    let record = result.unwrap();
    assert_eq!(record.user_id, user_id);
    assert_eq!(record.service_name, service_name);
    assert_eq!(record.input_tokens, request.input_tokens);
    assert_eq!(record.output_tokens, request.output_tokens);
    assert_eq!(record.model, request.model.to_provider_model_string().1);
    Ok(())
}

#[sqlx::test(migrations = "../metering_db_client/migrations")]
async fn test_create_minimal_usage_record(pool: PgPool) -> sqlx::Result<()> {
    let db = MeteringDb::new(pool);

    let request = create_test_usage_request();

    let result = db.create_usage_record(request.clone()).await;
    assert!(result.is_ok());

    let record = result.unwrap();
    assert_eq!(record.user_id, request.user_id);
    assert_eq!(record.service_name, request.service_name);
    assert_eq!(record.model, request.model.to_provider_model_string().1);
    Ok(())
}

#[sqlx::test(migrations = "../metering_db_client/migrations")]
async fn test_get_usage_records_no_filter(pool: PgPool) -> sqlx::Result<()> {
    let db = MeteringDb::new(pool);

    // Create test records
    let _record1 = db
        .create_usage_record(create_test_usage_request())
        .await
        .unwrap();
    let _record2 = db
        .create_usage_record(create_test_usage_request())
        .await
        .unwrap();

    let query = UsageQuery {
        user_id: None,
        service_name: None,
        start_date: None,
        end_date: None,
        limit: None,
        offset: None,
    };

    let result = db.get_usage_records(query).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert_eq!(report.records.len(), 2);
    assert_eq!(report.total_count, 2);
    Ok(())
}

#[sqlx::test(migrations = "../metering_db_client/migrations")]
async fn test_get_usage_records_filter_by_user(pool: PgPool) -> sqlx::Result<()> {
    let db = MeteringDb::new(pool);

    let req1 = create_test_usage_request();
    // Create records for specific user and another user
    let _record1 = db.create_usage_record(req1.clone()).await.unwrap();
    let _record2 = db
        .create_usage_record(create_test_usage_request())
        .await
        .unwrap(); // Different user

    let query = UsageQuery {
        user_id: Some(req1.user_id.clone()),
        service_name: None,
        start_date: None,
        end_date: None,
        limit: None,
        offset: None,
    };

    let result = db.get_usage_records(query).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert_eq!(dbg!(&report).records.len(), 1);
    assert_eq!(report.total_count, 1);
    assert_eq!(report.records[0].user_id, req1.user_id);
    Ok(())
}

#[sqlx::test(migrations = "../metering_db_client/migrations")]
async fn test_get_usage_records_filter_by_service(pool: PgPool) -> sqlx::Result<()> {
    let db = MeteringDb::new(pool);

    // Create records with different services
    let req1 = create_test_usage_request();
    let _record1 = db.create_usage_record(req1.clone()).await.unwrap(); // "test_ai_service"
    let mut req2 = create_test_usage_request();
    req2.service_name = "some_other_name".to_string();

    let _record2 = db.create_usage_record(req2).await.unwrap(); // "minimal_service"

    let query = UsageQuery {
        user_id: None,
        service_name: Some(req1.service_name.clone()),
        start_date: None,
        end_date: None,
        limit: None,
        offset: None,
    };

    let result = db.get_usage_records(query).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert_eq!(report.records.len(), 1);
    assert_eq!(report.records[0].service_name, req1.service_name);
    Ok(())
}

#[sqlx::test(migrations = "../metering_db_client/migrations")]
async fn test_get_usage_records_filter_by_date_range(pool: PgPool) -> sqlx::Result<()> {
    let db = MeteringDb::new(pool);

    let now = Utc::now();
    let one_hour_ago = now - Duration::hours(1);
    let one_hour_later = now + Duration::hours(1);

    // Create a record
    let _record = db
        .create_usage_record(create_test_usage_request())
        .await
        .unwrap();

    // Query with date range that includes the record
    let query = UsageQuery {
        user_id: None,
        service_name: None,
        start_date: Some(one_hour_ago),
        end_date: Some(one_hour_later),
        limit: None,
        offset: None,
    };

    let result = db.get_usage_records(query).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert_eq!(report.records.len(), 1);

    // Query with date range that excludes the record
    let query_excluded = UsageQuery {
        user_id: None,
        service_name: None,
        start_date: Some(one_hour_later),
        end_date: Some(one_hour_later + Duration::hours(1)),
        limit: None,
        offset: None,
    };

    let result_excluded = db.get_usage_records(query_excluded).await;
    assert!(result_excluded.is_ok());

    let report_excluded = result_excluded.unwrap();
    assert_eq!(report_excluded.records.len(), 0);
    Ok(())
}

#[sqlx::test(migrations = "../metering_db_client/migrations")]
async fn test_get_usage_records_pagination(pool: PgPool) -> sqlx::Result<()> {
    let db = MeteringDb::new(pool);

    // Create multiple records
    for _ in 0..5 {
        let _record = db
            .create_usage_record(create_test_usage_request())
            .await
            .unwrap();
    }

    // Test limit
    let query = UsageQuery {
        user_id: None,
        service_name: None,
        start_date: None,
        end_date: None,
        limit: Some(3),
        offset: None,
    };

    let result = db.get_usage_records(query).await;
    assert!(result.is_ok());

    let report = result.unwrap();
    assert_eq!(report.records.len(), 3);
    assert_eq!(report.total_count, 5);

    // Test offset
    let query_offset = UsageQuery {
        user_id: None,
        service_name: None,
        start_date: None,
        end_date: None,
        limit: Some(3),
        offset: Some(3),
    };

    let result_offset = db.get_usage_records(query_offset).await;
    assert!(result_offset.is_ok());

    let report_offset = result_offset.unwrap();
    assert_eq!(report_offset.records.len(), 2); // Remaining 2 records
    assert_eq!(report_offset.total_count, 5);
    Ok(())
}
