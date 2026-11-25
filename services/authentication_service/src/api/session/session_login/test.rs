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

    let first = redeem_session_code(&cache, &code, None, refreshes)
        .await
        .unwrap();
    assert_eq!(first, (NEW_ACCESS_TOKEN.into(), NEW_REFRESH_TOKEN.into()));

    let second = redeem_session_code(&cache, &code, None, refreshes).await;
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
                redeem_session_code(&cache, &code, None, refreshes).await
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

    let failed = redeem_session_code(&cache, &code, None, refresh_fails).await;
    assert!(matches!(failed, Err(RedeemError::Refresh)), "{failed:?}");

    let retried = redeem_session_code(&cache, &code, None, refreshes).await;
    assert!(retried.is_ok(), "{retried:?}");

    let replayed = redeem_session_code(&cache, &code, None, refreshes).await;
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
        let _ = redeem_session_code(cache, &codes[0], None, refresh_fails).await;
        let _ = redeem_session_code(cache, &codes[0], None, refreshes).await;
        let _ = redeem_session_code(cache, &codes[0], None, refreshes).await;
        let _ = redeem_session_code(cache, &codes[1], None, refreshes).await;
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

    let error = cache
        .take_mobile_login_session(&code, None)
        .await
        .unwrap_err();
    assert!(!format!("{error:?}").contains(&code));
    let error = cache
        .set_mobile_login_session(&code, STORED_REFRESH_TOKEN)
        .await
        .unwrap_err();
    assert!(!format!("{error:?}").contains(&code));
}

/// RFC 7636, Appendix B.
const VERIFIER: &str = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

fn challenge_of(verifier: &str) -> CodeChallenge {
    CodeChallenge::of(&CodeVerifier::parse(verifier.into()).unwrap())
}

async fn bound_code(cache: &MacroCache) -> String {
    let code = crate::api::utils::generate_session_code();
    cache
        .set_bound_mobile_login_session(
            &code,
            STORED_REFRESH_TOKEN,
            challenge_of(VERIFIER).as_str(),
        )
        .await
        .unwrap();
    code
}

#[tokio::test]
async fn a_bound_code_redeems_only_with_its_verifier() {
    let cache = cache();
    let code = bound_code(&cache).await;
    let other_verifier = "a".repeat(43);

    // A caller without the verifier, or with another one, is refused like an
    // unknown code, and the code stays for the app that holds the verifier.
    for wrong in [None, Some(challenge_of(&other_verifier))] {
        let refused = redeem_session_code(&cache, &code, wrong.as_ref(), refreshes).await;
        assert!(matches!(refused, Err(RedeemError::Invalid)), "{refused:?}");
    }

    let redeemed =
        redeem_session_code(&cache, &code, Some(&challenge_of(VERIFIER)), refreshes).await;
    assert_eq!(
        redeemed.unwrap(),
        (NEW_ACCESS_TOKEN.into(), NEW_REFRESH_TOKEN.into())
    );

    let replayed =
        redeem_session_code(&cache, &code, Some(&challenge_of(VERIFIER)), refreshes).await;
    assert!(
        matches!(replayed, Err(RedeemError::Invalid)),
        "{replayed:?}"
    );
}

#[tokio::test]
async fn a_failed_refresh_leaves_a_bound_code_bound() {
    let cache = cache();
    let code = bound_code(&cache).await;
    let challenge = challenge_of(VERIFIER);

    let failed = redeem_session_code(&cache, &code, Some(&challenge), refresh_fails).await;
    assert!(matches!(failed, Err(RedeemError::Refresh)), "{failed:?}");

    let without_verifier = redeem_session_code(&cache, &code, None, refreshes).await;
    assert!(
        matches!(without_verifier, Err(RedeemError::Invalid)),
        "{without_verifier:?}"
    );
    let retried = redeem_session_code(&cache, &code, Some(&challenge), refreshes).await;
    assert!(retried.is_ok(), "{retried:?}");
}

#[tokio::test(flavor = "current_thread")]
async fn bound_redemption_telemetry_carries_no_code_token_or_verifier() {
    async fn refused_then_redeemed(cache: &MacroCache, code: &str) {
        let _ = redeem_session_code(cache, code, None, refreshes).await;
        let _ = redeem_session_code(cache, code, Some(&challenge_of(VERIFIER)), refreshes).await;
    }
    let cache = cache();
    let warm_up = bound_code(&cache).await;
    let code = bound_code(&cache).await;

    let (traces, _guard) = crate::api::trace_capture::capture_traces();
    refused_then_redeemed(&cache, &warm_up).await;
    traces.rearm();
    refused_then_redeemed(&cache, &code).await;
    let text = traces.text();

    assert!(text.contains("outcome=\"challenge_mismatch\""), "{text}");
    assert!(text.contains("bound=true"), "{text}");
    for secret in [
        code.as_str(),
        VERIFIER,
        challenge_of(VERIFIER).as_str(),
        STORED_REFRESH_TOKEN,
        NEW_ACCESS_TOKEN,
        NEW_REFRESH_TOKEN,
    ] {
        assert!(!text.contains(secret), "{secret} reached telemetry: {text}");
    }
}

/// What `verified_handler` answers for a body it cannot read: the extractor
/// sees the request first, and its rejection must become the documented 400.
async fn read_verified_request(body: &str, json: bool) -> Response {
    use axum::extract::FromRequest;
    let mut request = axum::http::Request::post("/session/login");
    if json {
        request = request.header(axum::http::header::CONTENT_TYPE, "application/json");
    }
    let request = request
        .body(axum::body::Body::from(body.to_owned()))
        .unwrap();
    match Json::<VerifiedSessionLoginRequest>::from_request(request, &()).await {
        Ok(_) => StatusCode::OK.into_response(),
        Err(rejection) => bad_request(rejection),
    }
}

#[tokio::test]
async fn an_unreadable_verified_login_answers_the_documented_400() {
    for (body, json) in [
        (r#"{"sessionCode":"code"}"#, true),
        (r#"{"sessionCode":"code","#, true),
        (r#"{"sessionCode":"code","verifier":"v"}"#, false),
    ] {
        let response = read_verified_request(body, json).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{body}");
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let error: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(error["message"].is_string(), "{body}: {error}");
    }
    let readable = read_verified_request(r#"{"sessionCode":"code","verifier":"v"}"#, true).await;
    assert_eq!(readable.status(), StatusCode::OK);
}
