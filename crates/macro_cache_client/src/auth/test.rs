//! Run against the CI Redis, or set `REDIS_URL` to a private one.
use super::*;

macro_env_var::maybe_env_var! {
    struct RedisUrl;
}

fn cache() -> MacroCache {
    let redis_url = RedisUrl::new();
    let url = redis_url
        .as_ref()
        .and_then(RedisUrl::value)
        .unwrap_or("redis://127.0.0.1:6379");
    MacroCache::new(url)
}

fn fresh_code(label: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("test-{label}-{nanos}")
}

#[tokio::test]
async fn a_session_code_redeems_once() {
    let cache = cache();
    let code = fresh_code("once");
    cache
        .set_mobile_login_session(&code, "fake-refresh-token")
        .await
        .unwrap();

    let first = cache.take_mobile_login_session(&code).await.unwrap();
    assert_eq!(
        first.as_ref().map(MobileLoginSession::refresh_token),
        Some("fake-refresh-token")
    );

    let second = cache.take_mobile_login_session(&code).await.unwrap();
    assert!(second.is_none(), "a redeemed code must not redeem again");
}

#[tokio::test]
async fn concurrent_redemptions_yield_exactly_one_success() {
    const CONTENDERS: usize = 32;
    let cache = cache();
    let code = fresh_code("race");
    cache
        .set_mobile_login_session(&code, "fake-refresh-token")
        .await
        .unwrap();

    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(CONTENDERS));
    let tasks: Vec<_> = (0..CONTENDERS)
        .map(|_| {
            let cache = cache.clone();
            let code = code.clone();
            let barrier = barrier.clone();
            tokio::spawn(async move {
                barrier.wait().await;
                cache.take_mobile_login_session(&code).await.unwrap()
            })
        })
        .collect();

    let mut successes = 0;
    for task in tasks {
        if task.await.unwrap().is_some() {
            successes += 1;
        }
    }
    assert_eq!(
        successes, 1,
        "exactly one concurrent redemption may succeed"
    );
}

#[tokio::test]
async fn a_restored_session_redeems_once_more_within_its_lifetime() {
    let cache = cache();
    let code = fresh_code("restore");
    cache
        .set_mobile_login_session(&code, "fake-refresh-token")
        .await
        .unwrap();

    let taken = cache
        .take_mobile_login_session(&code)
        .await
        .unwrap()
        .unwrap();
    let lifetime = std::time::Duration::from_secs(MACRO_MOBILE_LOGIN_SESSION_EXPIRY_SECONDS);
    assert!(!taken.remaining().is_zero() && taken.remaining() <= lifetime);
    assert!(
        cache
            .restore_mobile_login_session(&code, &taken)
            .await
            .unwrap()
    );

    let again = cache
        .take_mobile_login_session(&code)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(again.refresh_token(), "fake-refresh-token");
    // The restore keeps the original deadline instead of starting a new one.
    assert!(again.expires_at <= taken.expires_at);
    assert!(
        cache
            .take_mobile_login_session(&code)
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn a_restore_never_overwrites_a_live_code() {
    let cache = cache();
    let code = fresh_code("no-overwrite");
    cache
        .set_mobile_login_session(&code, "fake-first-token")
        .await
        .unwrap();
    let taken = cache
        .take_mobile_login_session(&code)
        .await
        .unwrap()
        .unwrap();
    cache
        .set_mobile_login_session(&code, "fake-second-token")
        .await
        .unwrap();

    assert!(
        !cache
            .restore_mobile_login_session(&code, &taken)
            .await
            .unwrap()
    );
    let live = cache
        .take_mobile_login_session(&code)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(live.refresh_token(), "fake-second-token");
}

#[tokio::test]
async fn errors_and_debug_output_never_contain_the_code_or_token() {
    let cache = MacroCache::new("redis://127.0.0.1:1");
    let code = fresh_code("unreachable");

    let set = cache
        .set_mobile_login_session(&code, "fake-refresh-token")
        .await
        .unwrap_err();
    let take = cache.take_mobile_login_session(&code).await.unwrap_err();
    for error in [set, take] {
        let text = format!("{error:?}");
        assert!(!text.contains(&code), "{text}");
        assert!(!text.contains("fake-refresh-token"), "{text}");
    }

    let session = MobileLoginSession {
        refresh_token: "fake-refresh-token".into(),
        expires_at: std::time::Instant::now(),
    };
    assert!(!format!("{session:?}").contains("fake-refresh-token"));
}

#[tokio::test]
async fn a_session_past_its_original_deadline_is_not_restored() {
    let cache = cache();
    let code = fresh_code("expired");
    cache
        .set_mobile_login_session(&code, "fake-refresh-token")
        .await
        .unwrap();
    let mut taken = cache
        .take_mobile_login_session(&code)
        .await
        .unwrap()
        .unwrap();
    // The refresh outlasted the code's original five minutes.
    taken.expires_at = std::time::Instant::now() - std::time::Duration::from_millis(1);

    assert!(
        !cache
            .restore_mobile_login_session(&code, &taken)
            .await
            .unwrap()
    );
    assert!(
        cache
            .take_mobile_login_session(&code)
            .await
            .unwrap()
            .is_none()
    );
}
