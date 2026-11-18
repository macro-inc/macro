use super::*;
use crate::outbound::email_api::{
    EmailServiceTokenSource, GmailApi, RateBudget, RedisGmailRequestGate,
};
use crate::util::redis::RedisClient;
use redis::AsyncCommands;
use std::collections::BTreeMap;
use std::sync::Arc;

// Only Redis is exercised. The other concrete adapter leaves point to unused
// local endpoints and the database pool is lazy; no simulation is needed.
async fn effects(
    redis_client: redis::Client,
    redis: redis::aio::MultiplexedConnection,
) -> BackfillWorkerEffects {
    let unused_url = "http://127.0.0.1:9";
    let db = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://postgres@127.0.0.1:9/unused")
        .unwrap();
    let sqs_sdk = aws_sdk_sqs::Client::from_conf(
        aws_sdk_sqs::Config::builder()
            .behavior_version(aws_sdk_sqs::config::BehaviorVersion::latest())
            .region(aws_sdk_sqs::config::Region::new("us-east-1"))
            .credentials_provider(aws_sdk_sqs::config::Credentials::new(
                "test", "test", None, None, "test",
            ))
            .endpoint_url(unused_url)
            .build(),
    );
    let sqs_client = sqs_client::SQS::new(sqs_sdk.clone());
    let email_api = GmailApi::new(
        email_api_client::GmailApiClientRepository::new(gmail_client::GmailClient::new_with_urls(
            None,
            unused_url.to_string(),
            unused_url.to_string(),
            unused_url.to_string(),
            "test".to_string(),
        )),
        EmailServiceTokenSource::new(
            db.clone(),
            redis,
            authentication_service_client::AuthServiceClient::new(
                "test".to_string(),
                unused_url.to_string(),
            ),
            sqs_client.clone(),
        ),
        RedisGmailRequestGate::new(
            redis_client.get_connection_manager().await.unwrap(),
            RateBudget::Backfill,
        ),
    );
    BackfillWorkerEffects {
        invitation_extractor: crate::composition::workers::invitation_extractor(
            db.clone(),
            email_api.clone(),
        ),
        sqs_client,
        contacts_ingress: Arc::new(contacts::domain::service::SqsContactsIngress {
            queue: contacts::outbound::ingress::SqsContactsQueue::new(
                sqs_sdk.clone(),
                unused_url.to_string(),
            ),
        }),
        email_api,
        redis_client: RedisClient::new(redis_client, 60),
        sfs_client: static_file_service_client::StaticFileServiceClient::new(
            "test".to_string(),
            unused_url.to_string(),
        ),
        connection_gateway_client: connection_gateway_client::client::ConnectionGatewayClient::new(
            "test".to_string(),
            unused_url.to_string(),
        ),
        dss_client: document_storage_service_client::DocumentStorageServiceClient::new(
            "test".to_string(),
            unused_url.to_string(),
        ),
        system_properties_service: Arc::new(system_properties::SystemPropertiesServiceImpl::new(
            system_properties::PgSystemPropertiesRepository::new(db.clone()),
        )),
        macro_event_broker: macro_event_broker::MacroEventBrokerService::new(
            macro_event_broker::KafkaEventPublisher::new("127.0.0.1:9").unwrap(),
            tokio_util::task::TaskTracker::new(),
        ),
        db,
    }
}

#[tokio::test]
async fn delete_thread_progress_removes_only_the_requested_redis_progress() {
    let client = redis::Client::open("redis://127.0.0.1:6379/").unwrap();
    let mut redis = client.get_multiplexed_async_connection().await.unwrap();
    let effects = effects(client, redis.clone()).await;
    let job = Uuid::now_v7();
    let other_job = Uuid::now_v7();
    let target = format!("bf_thread_status:{job}:target");
    let other_thread = format!("bf_thread_status:{job}:other");
    let other_job_thread = format!("bf_thread_status:{other_job}:target");
    let job_key = format!("bf_job_status:{job}");
    for key in [&target, &other_thread, &other_job_thread] {
        let _: () = redis
            .hset_multiple(key, &[("completed_messages", 1), ("total_messages", 3)])
            .await
            .unwrap();
        let _: bool = redis.expire(key, 60).await.unwrap();
    }
    effects
        .redis_client
        .init_backfill_job_progress(job, 4)
        .await
        .unwrap();
    let _: bool = redis.expire(&job_key, 60).await.unwrap();
    let untouched = [&other_thread, &other_job_thread, &job_key];
    let mut before = Vec::new();
    for key in untouched {
        before.push(
            redis
                .hgetall::<_, BTreeMap<String, i32>>(key)
                .await
                .unwrap(),
        );
    }
    assert!(redis.exists::<_, bool>(&target).await.unwrap());

    effects.delete_thread_progress(job, "target").await;

    assert!(!redis.exists::<_, bool>(&target).await.unwrap());
    for (key, expected) in untouched.into_iter().zip(&before) {
        assert_eq!(
            &redis
                .hgetall::<_, BTreeMap<String, i32>>(key)
                .await
                .unwrap(),
            expected
        );
    }
    effects.delete_thread_progress(job, "target").await;
    assert!(!redis.exists::<_, bool>(&target).await.unwrap());
    let _: () = redis
        .del(&[&other_thread, &other_job_thread, &job_key])
        .await
        .unwrap();
}
