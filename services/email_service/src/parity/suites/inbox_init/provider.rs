use super::*;

enum Scenario {
    BadRequest,
    Unauthorized,
    Forbidden,
    NotFound,
    Quota,
    Unavailable,
    Dropped,
    InvalidWatch,
    WatchConflict,
    AuthUnauthorized,
    AuthForbidden,
    AuthNotFound,
    AuthUnavailable,
    AuthMalformed,
}

async fn run(pool: PgPool, name: &'static str, shard: u32, scenario: Scenario) {
    let (mut lab, _redis) = start(pool, name, shard).await;
    attempt(&lab, 2, Some("new@example.com"), "GMAIL", &[], &[]).await;
    let status = match scenario {
        Scenario::BadRequest => {
            reply(
                &lab,
                400,
                json!({"error":{"code":400,"message":"invalid watch"}}),
            );
            500
        }
        Scenario::Unauthorized => {
            reply(&lab, 401, json!({"error":{"code":401,"message":"expired"}}));
            400
        }
        Scenario::Forbidden => {
            reply(
                &lab,
                403,
                json!({"error":{"code":403,"message":"forbidden"}}),
            );
            400
        }
        Scenario::NotFound => {
            reply(
                &lab,
                404,
                json!({"error":{"code":404,"message":"not found"}}),
            );
            500
        }
        Scenario::Quota => {
            lab.gmail.lock().endpoint_headers.insert(
                WATCH.into(),
                vec![("retry-after".into(), RETRY_AFTER_SECONDS.into())],
            );
            reply(
                &lab,
                429,
                json!({"error":{"code":429,"message":"Too many concurrent requests for user"}}),
            );
            429
        }
        Scenario::Unavailable => {
            reply(
                &lab,
                503,
                json!({"error":{"code":503,"message":"unavailable"}}),
            );
            500
        }
        Scenario::Dropped => {
            lab.gmail.lock().drop_endpoints.insert(WATCH.into());
            500
        }
        Scenario::InvalidWatch => {
            reply(&lab, 200, json!({"historyId":"9","expiration":"bad"}));
            500
        }
        Scenario::WatchConflict => {
            lab.gmail.lock().endpoint_replies.insert(WATCH.into(),vec![
                (400,json!({"error":{"code":400,"message":"Only one push notification client allowed per developer"}})),
                (200,json!({"historyId":"101","expiration":"1893456000000"})),
            ].into());
            200
        }
        Scenario::AuthUnauthorized
        | Scenario::AuthForbidden
        | Scenario::AuthNotFound
        | Scenario::AuthUnavailable
        | Scenario::AuthMalformed => {
            let (code, body) = match scenario {
                Scenario::AuthUnauthorized => (401, json!({"message":"unauthorized"})),
                Scenario::AuthForbidden => (403, json!({"message":"forbidden"})),
                Scenario::AuthNotFound => (404, json!({"message":"missing"})),
                Scenario::AuthUnavailable => (500, json!({"message":"unavailable"})),
                _ => (200, json!({"wrong":"shape"})),
            };
            lab.stub
                .reply_sequence("GET", "/internal/google_access_token", vec![(code, body)]);
            if code == 403 || code == 404 { 400 } else { 500 }
        }
    };
    init(&mut lab, "provider result", Auth::User(2), &query(), status).await;
    lab.transcript.finish();
}

fn reply(lab: &Lab, status: u16, body: Value) {
    lab.gmail
        .lock()
        .endpoint_replies
        .insert(WATCH.into(), vec![(status, body)].into());
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn provider_bad_request(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "provider_bad_request", 52400, Scenario::BadRequest).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn provider_unauthorized(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "provider_unauthorized", 52403, Scenario::Unauthorized).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn provider_forbidden(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "provider_forbidden", 52406, Scenario::Forbidden).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn provider_not_found(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "provider_not_found", 52409, Scenario::NotFound).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn provider_quota(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "provider_quota", 52412, Scenario::Quota).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn provider_unavailable(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "provider_unavailable", 52415, Scenario::Unavailable).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn provider_dropped(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "provider_dropped", 52418, Scenario::Dropped).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn provider_invalid_watch(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "provider_invalid_watch",
        52421,
        Scenario::InvalidWatch,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn provider_watch_conflict(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "provider_watch_conflict",
        52424,
        Scenario::WatchConflict,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn provider_auth_unauthorized(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "provider_auth_unauthorized",
        52427,
        Scenario::AuthUnauthorized,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn provider_auth_forbidden(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "provider_auth_forbidden",
        52430,
        Scenario::AuthForbidden,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn provider_auth_not_found(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "provider_auth_not_found",
        52433,
        Scenario::AuthNotFound,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn provider_auth_unavailable(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "provider_auth_unavailable",
        52436,
        Scenario::AuthUnavailable,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn provider_auth_malformed(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "provider_auth_malformed",
        52439,
        Scenario::AuthMalformed,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn provider_retry_after(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let (mut lab, _redis) = start(pool, "provider_retry_after", 52500).await;
    attempt(&lab, 2, Some("new@example.com"), "GMAIL", &[], &[]).await;
    reply(
        &lab,
        429,
        json!({"error":{"code":429,"message":"rate limited"}}),
    );
    lab.gmail.lock().endpoint_headers.insert(
        WATCH.into(),
        vec![("retry-after".into(), RETRY_AFTER_SECONDS.into())],
    );
    init(
        &mut lab,
        "provider retry delay",
        Auth::User(2),
        &query(),
        429,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn provider_redis_unavailable(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let (mut lab, mut redis) = start_in_redis(
        pool,
        "provider_redis_unavailable",
        52503,
        false,
        RedisDatabase::with_fault_user().await,
    )
    .await;
    redis.deny_commands(&["eval", "evalsha"]).await;
    init(&mut lab, "admission fails closed", Auth::User(2), "", 429).await;
    redis.remove_fault_user().await;
    lab.transcript.finish();
}
