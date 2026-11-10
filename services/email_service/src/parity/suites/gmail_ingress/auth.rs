use super::signing::Key;
use super::*;

#[derive(Clone, Copy)]
enum Scenario {
    Cached,
    Missing,
    HeaderVariants,
    BadHeader,
    MissingKid,
    UnknownKid,
    RotatedKid,
    RotatedSignature,
    BadSignature,
    Audience,
    Issuer,
    Expired,
    Algorithm,
    KeyType,
    KeyEncoding,
    FetchFailure,
    FetchMalformed,
    FetchEmpty,
    RefreshFailure,
    CacheMalformed,
    CacheWrongType,
    CacheWriteFailure,
}

async fn run(pool: PgPool, name: &'static str, shard: u32, scenario: Scenario) {
    assert!(
        cfg!(feature = "gmail_webhook_auth"),
        "these goldens require the production default features"
    );
    let (mut lab, mut redis) = if matches!(scenario, Scenario::CacheWriteFailure) {
        start_in_redis(pool, name, shard, RedisDatabase::with_fault_user().await).await
    } else {
        start(pool, name, shard).await
    };
    let mut key = Key::new(&mut lab, "current");
    key.serve(&lab);
    let mut token = key.valid(&mut lab);
    let body = notification("missing@example.com", json!(1));
    let mut status = 401;
    match scenario {
        Scenario::Cached => {
            key.cache(&mut redis).await;
            status = 202;
        }
        Scenario::Missing | Scenario::HeaderVariants => {
            let headers: Vec<Vec<(&str, &[u8])>> = if matches!(scenario, Scenario::Missing) {
                vec![vec![]]
            } else {
                vec![
                    vec![("authorization", b"Basic irrelevant")],
                    vec![("authorization", b"bearer lowercase")],
                    vec![("authorization", b"Bearer")],
                    vec![("authorization", b"Bearer ")],
                    vec![("authorization", &[0xff])],
                ]
            };
            for headers in headers {
                assert_eq!(
                    lab.request_with_headers(
                        "missing or malformed bearer header",
                        "POST",
                        "/gmail/webhook",
                        Auth::MissingCredentials,
                        RequestBody::Json(body.clone()),
                        &headers
                    )
                    .await,
                    401
                );
            }
            lab.transcript.finish();
            return;
        }
        Scenario::BadHeader => {
            token = "not-a-jwt".into();
        }
        Scenario::MissingKid => {
            token = key.token(
                &mut lab,
                "missing-kid",
                json!({"alg":"RS256"}),
                Key::claims(),
            );
        }
        Scenario::UnknownKid => {
            token = key.token(
                &mut lab,
                "unknown-kid",
                json!({"alg":"RS256","kid":"unknown"}),
                Key::claims(),
            );
        }
        Scenario::RotatedKid => {
            let old = Key::new(&mut lab, "old");
            old.cache(&mut redis).await;
            status = 202;
        }
        Scenario::RotatedSignature => {
            let mut old = Key::new(&mut lab, "old-signature");
            old.jwk["kid"] = json!("current");
            old.cache(&mut redis).await;
            status = 202;
        }
        Scenario::BadSignature => {
            let mut old = Key::new(&mut lab, "old-signature");
            old.jwk["kid"] = json!("current");
            old.serve(&lab);
        }
        Scenario::Audience | Scenario::Issuer | Scenario::Expired => {
            let mut claims = Key::claims();
            match scenario {
                Scenario::Audience => claims["aud"] = json!("wrong-audience"),
                Scenario::Issuer => claims["iss"] = json!("wrong-issuer"),
                _ => claims["exp"] = json!(1),
            }
            token = key.token(
                &mut lab,
                name,
                json!({"alg":"RS256","kid":"current"}),
                claims,
            );
        }
        Scenario::Algorithm => {
            token = key.token(
                &mut lab,
                "wrong-algorithm",
                json!({"alg":"HS256","kid":"current"}),
                Key::claims(),
            );
        }
        Scenario::KeyType => {
            key.jwk["kty"] = json!("EC");
            key.serve(&lab);
        }
        Scenario::KeyEncoding => {
            key.jwk["n"] = json!("not+base64*");
            key.serve(&lab);
        }
        Scenario::FetchFailure => {
            lab.stub
                .reply("GET", "/certs", 503, json!({"error":"unavailable"}));
            status = 500;
        }
        Scenario::FetchMalformed => {
            lab.stub
                .reply("GET", "/certs", 200, json!({"keys":"wrong"}));
            status = 500;
        }
        Scenario::FetchEmpty => {
            lab.stub.reply("GET", "/certs", 200, json!({"keys":[]}));
            status = 500;
        }
        Scenario::RefreshFailure => {
            let old = Key::new(&mut lab, "old");
            old.cache(&mut redis).await;
            lab.stub
                .reply("GET", "/certs", 503, json!({"error":"unavailable"}));
        }
        Scenario::CacheMalformed | Scenario::CacheWrongType => {
            let mut command = if matches!(scenario, Scenario::CacheMalformed) {
                redis::cmd("SET")
            } else {
                redis::cmd("SADD")
            };
            let _: () = command
                .arg("google_public_keys")
                .arg("invalid cache")
                .query_async(&mut redis.connection)
                .await
                .expect("corrupt cache");
            status = 202;
        }
        Scenario::CacheWriteFailure => {
            redis.deny_commands(&["setex"]).await;
            status = 202;
        }
    }
    push(&mut lab, "verify Google push token", &token, body, status).await;
    redis.remove_fault_user().await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_cached(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "auth_cached", 51400, Scenario::Cached).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_missing(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "auth_missing", 51403, Scenario::Missing).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_header_variants(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "auth_header_variants",
        51406,
        Scenario::HeaderVariants,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_bad_header(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "auth_bad_header", 51409, Scenario::BadHeader).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_missing_kid(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "auth_missing_kid", 51412, Scenario::MissingKid).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_unknown_kid(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "auth_unknown_kid", 51415, Scenario::UnknownKid).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_rotated_kid(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "auth_rotated_kid", 51418, Scenario::RotatedKid).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_rotated_signature(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "auth_rotated_signature",
        51421,
        Scenario::RotatedSignature,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_bad_signature(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "auth_bad_signature", 51424, Scenario::BadSignature).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_audience(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "auth_audience", 51427, Scenario::Audience).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_issuer(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "auth_issuer", 51430, Scenario::Issuer).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_expired(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "auth_expired", 51433, Scenario::Expired).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_algorithm(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "auth_algorithm", 51436, Scenario::Algorithm).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_key_type(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "auth_key_type", 51439, Scenario::KeyType).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_key_encoding(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "auth_key_encoding", 51442, Scenario::KeyEncoding).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_fetch_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "auth_fetch_failure", 51445, Scenario::FetchFailure).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_fetch_malformed(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "auth_fetch_malformed",
        51448,
        Scenario::FetchMalformed,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_fetch_empty(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "auth_fetch_empty", 51451, Scenario::FetchEmpty).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_refresh_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "auth_refresh_failure",
        51454,
        Scenario::RefreshFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_cache_malformed(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "auth_cache_malformed",
        51457,
        Scenario::CacheMalformed,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_cache_wrong_type(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "auth_cache_wrong_type",
        51460,
        Scenario::CacheWrongType,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn auth_cache_write_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "auth_cache_write_failure",
        51463,
        Scenario::CacheWriteFailure,
    )
    .await;
}
