//! Runs against the CI Redis, or set `REDIS_URL` to a private one.
use super::*;
use std::sync::Arc;

macro_env_var::maybe_env_var! {
    struct RedisUrl;
}

const STORED_REFRESH_TOKEN: &str = "fake-stored-refresh-token";
const NEW_ACCESS_TOKEN: &str = "fake-new-access-token";
const NEW_REFRESH_TOKEN: &str = "fake-new-refresh-token";

fn cache() -> MacroCache {
    let redis_url = RedisUrl::new();
    let url = redis_url
        .as_ref()
        .and_then(RedisUrl::value)
        .unwrap_or("redis://127.0.0.1:6379");
    MacroCache::new(url)
}

async fn stored_code(cache: &MacroCache) -> String {
    let code = crate::api::utils::generate_session_code();
    cache
        .set_mobile_login_session(&code, STORED_REFRESH_TOKEN)
        .await
        .unwrap();
    code
}

async fn refreshes(refresh_token: &str) -> Result<(String, String), &'static str> {
    assert_eq!(refresh_token, STORED_REFRESH_TOKEN);
    Ok((NEW_ACCESS_TOKEN.into(), NEW_REFRESH_TOKEN.into()))
}

async fn refresh_fails(_refresh_token: &str) -> Result<(String, String), &'static str> {
    Err("identity provider unavailable")
}

#[tokio::test]
async fn a_second_redemption_is_refused() {
    let cache = cache();
    let code = stored_code(&cache).await;

    let first = redeem_session_code(&cache, &code, refreshes).await.unwrap();
    assert_eq!(first, (NEW_ACCESS_TOKEN.into(), NEW_REFRESH_TOKEN.into()));

    let second = redeem_session_code(&cache, &code, refreshes).await;
    assert!(matches!(second, Err(RedeemError::Invalid)), "{second:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn concurrent_redemptions_yield_exactly_one_success() {
    const CONTENDERS: usize = 32;
    let cache = cache();
    let code = stored_code(&cache).await;

    let barrier = Arc::new(tokio::sync::Barrier::new(CONTENDERS));
    let tasks: Vec<_> = (0..CONTENDERS)
        .map(|_| {
            let (cache, code, barrier) = (cache.clone(), code.clone(), barrier.clone());
            tokio::spawn(async move {
                barrier.wait().await;
                redeem_session_code(&cache, &code, refreshes).await
            })
        })
        .collect();

    let mut successes = 0;
    for task in tasks {
        match task.await.unwrap() {
            Ok(_) => successes += 1,
            Err(RedeemError::Invalid) => {}
            Err(other) => panic!("unexpected failure: {other:?}"),
        }
    }
    assert_eq!(successes, 1);
}

#[tokio::test]
async fn a_failed_refresh_leaves_the_code_for_a_retry() {
    let cache = cache();
    let code = stored_code(&cache).await;

    let failed = redeem_session_code(&cache, &code, refresh_fails).await;
    assert!(matches!(failed, Err(RedeemError::Refresh)), "{failed:?}");

    let retried = redeem_session_code(&cache, &code, refreshes).await;
    assert!(retried.is_ok(), "{retried:?}");

    let replayed = redeem_session_code(&cache, &code, refreshes).await;
    assert!(
        matches!(replayed, Err(RedeemError::Invalid)),
        "{replayed:?}"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn redemption_telemetry_carries_no_code_or_token() {
    // Fails a refresh (the code is restored), redeems the code, replays it,
    // then redeems another one.
    async fn every_outcome(cache: &MacroCache, codes: &[String; 2]) {
        let _ = redeem_session_code(cache, &codes[0], refresh_fails).await;
        let _ = redeem_session_code(cache, &codes[0], refreshes).await;
        let _ = redeem_session_code(cache, &codes[0], refreshes).await;
        let _ = redeem_session_code(cache, &codes[1], refreshes).await;
    }
    let cache = cache();
    let warm_up = [stored_code(&cache).await, stored_code(&cache).await];
    let codes = [stored_code(&cache).await, stored_code(&cache).await];

    let (traces, _guard) = crate::api::trace_capture::capture_traces();
    every_outcome(&cache, &warm_up).await;
    traces.rearm();
    every_outcome(&cache, &codes).await;
    let text = traces.text();

    for outcome in ["refresh_failed", "redeemed", "invalid"] {
        assert!(
            text.contains(&format!("outcome=\"{outcome}\"")),
            "missing {outcome}: {text}"
        );
    }
    assert!(text.contains("code_restored=true"), "{text}");
    for secret in codes.iter().map(String::as_str).chain([
        STORED_REFRESH_TOKEN,
        NEW_ACCESS_TOKEN,
        NEW_REFRESH_TOKEN,
    ]) {
        assert!(!text.contains(secret), "{secret} reached telemetry: {text}");
    }
}

#[tokio::test]
async fn cache_errors_do_not_name_the_code() {
    let cache = MacroCache::new("redis://127.0.0.1:1");
    let code = crate::api::utils::generate_session_code();

    let error = cache.take_mobile_login_session(&code).await.unwrap_err();
    assert!(!format!("{error:?}").contains(&code));
    let error = cache
        .set_mobile_login_session(&code, STORED_REFRESH_TOKEN)
        .await
        .unwrap_err();
    assert!(!format!("{error:?}").contains(&code));
}
