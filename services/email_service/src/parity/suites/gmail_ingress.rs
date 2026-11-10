//! Gmail push authentication and internal deletion HTTP contracts.

use super::redis_database::RedisDatabase;
use crate::parity::lab::{Auth, Lab, LabOptions, RequestBody};
use base64::{Engine, engine::general_purpose::URL_SAFE};
use serde_json::{Value, json};
use sqlx::PgPool;

mod auth;
mod delete;
mod signing;
mod webhook;

async fn start(pool: PgPool, name: &'static str, shard: u32) -> (Lab, RedisDatabase) {
    start_in_redis(pool, name, shard, RedisDatabase::start().await).await
}

async fn start_in_redis(
    pool: PgPool,
    name: &'static str,
    shard: u32,
    redis: RedisDatabase,
) -> (Lab, RedisDatabase) {
    let mut lab = Lab::start_with_redis(
        pool,
        LabOptions {
            suite: "gmail_ingress",
            name,
            shard,
            gmail_label_write_batches: false,
        },
        redis.uri.clone(),
    )
    .await;
    lab.record_redis_scope("");
    lab.transcript.normalizer.replace(&redis.uri, "<redis>");
    if let Some(user) = redis.fault_user() {
        lab.transcript
            .normalizer
            .replace(user, "<redis-fault-user>");
    }
    lab.transcript.normalizer.sort_response_keys = true;
    (lab, redis)
}

fn notification(email: &str, history: Value) -> Value {
    envelope(
        URL_SAFE.encode(
            serde_json::to_vec(&json!({
                "emailAddress":email,"historyId":history,
            }))
            .expect("notification JSON"),
        ),
    )
}

fn envelope(data: String) -> Value {
    json!({"message":{"data":data,"messageId":"message-1",
        "publishTime":"2026-01-01T00:00:00Z"},
        "subscription":"projects/parity/subscriptions/gmail"})
}

async fn push(lab: &mut Lab, step: &str, token: &str, body: Value, status: u16) {
    let bearer = format!("Bearer {token}");
    assert_eq!(
        lab.request_with_headers(
            step,
            "POST",
            "/gmail/webhook",
            Auth::MissingCredentials,
            RequestBody::Json(body),
            &[("authorization", bearer.as_bytes())]
        )
        .await,
        status,
        "{step}"
    );
}
