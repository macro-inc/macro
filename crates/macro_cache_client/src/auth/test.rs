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

/// Takes a plain (unbound) code, which never reports a challenge mismatch.
async fn take_plain(cache: &MacroCache, code: &str) -> Option<MobileLoginSession> {
    match cache.take_mobile_login_session(code, None).await.unwrap() {
        MobileLoginRedemption::Taken(session) => Some(session),
        MobileLoginRedemption::Missing => None,
        MobileLoginRedemption::ChallengeMismatch => panic!("a plain code has no challenge"),
    }
}

/// Redis's own clock, in milliseconds, which session deadlines are kept on.
async fn redis_now_ms(cache: &MacroCache) -> i64 {
    let mut connection = cache
        .inner
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    let (seconds, micros): (i64, i64) = redis::cmd("TIME")
        .query_async(&mut connection)
        .await
        .unwrap();
    seconds * 1000 + micros / 1000
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

    let first = take_plain(&cache, &code).await;
    assert_eq!(
        first.as_ref().map(MobileLoginSession::refresh_token),
        Some("fake-refresh-token")
    );

    let second = take_plain(&cache, &code).await;
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
                take_plain(&cache, &code).await
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

    let mut taken = take_plain(&cache, &code).await.unwrap();
    let now = redis_now_ms(&cache).await;
    let lifetime_ms = i64::try_from(MACRO_MOBILE_LOGIN_SESSION_EXPIRY_SECONDS * 1000).unwrap();
    assert!(taken.deadline_ms > now && taken.deadline_ms <= now + lifetime_ms);
    // Most of the code's lifetime went by while the refresh failed.
    taken.deadline_ms = now + 2000;
    assert!(
        cache
            .restore_mobile_login_session(&code, &taken)
            .await
            .unwrap()
    );

    let again = take_plain(&cache, &code).await.unwrap();
    assert_eq!(again.refresh_token(), "fake-refresh-token");
    // The restore keeps the original deadline instead of starting a new one.
    // Redis keeps whole milliseconds, so allow one either way.
    assert!(
        (again.deadline_ms - taken.deadline_ms).abs() <= 1,
        "{} vs {}",
        again.deadline_ms,
        taken.deadline_ms
    );
    assert!(take_plain(&cache, &code).await.is_none());
}

#[tokio::test]
async fn a_restore_never_overwrites_a_live_code() {
    let cache = cache();
    let code = fresh_code("no-overwrite");
    cache
        .set_mobile_login_session(&code, "fake-first-token")
        .await
        .unwrap();
    let taken = take_plain(&cache, &code).await.unwrap();
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
    let live = take_plain(&cache, &code).await.unwrap();
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
    let take = cache
        .take_mobile_login_session(&code, None)
        .await
        .unwrap_err();
    for error in [set, take] {
        let text = format!("{error:?}");
        assert!(!text.contains(&code), "{text}");
        assert!(!text.contains("fake-refresh-token"), "{text}");
    }

    let session = MobileLoginSession {
        refresh_token: "fake-refresh-token".into(),
        challenge: Some("fake-challenge".into()),
        deadline_ms: 0,
    };
    let text = format!("{session:?}");
    assert!(!text.contains("fake-refresh-token"), "{text}");
    assert!(!text.contains("fake-challenge"), "{text}");
}

#[tokio::test]
async fn a_session_past_its_original_deadline_is_not_restored() {
    let cache = cache();
    let code = fresh_code("expired");
    cache
        .set_mobile_login_session(&code, "fake-refresh-token")
        .await
        .unwrap();
    let mut taken = take_plain(&cache, &code).await.unwrap();
    // The refresh outlasted the code's original five minutes: the deadline
    // is checked by Redis when the restore runs, after any delay before it.
    taken.deadline_ms = redis_now_ms(&cache).await - 1;

    assert!(
        !cache
            .restore_mobile_login_session(&code, &taken)
            .await
            .unwrap()
    );
    assert!(take_plain(&cache, &code).await.is_none());
}

const CHALLENGE: &str = "fake-challenge";

async fn bound_code(cache: &MacroCache, label: &str) -> String {
    let code = fresh_code(label);
    cache
        .set_bound_mobile_login_session(&code, "fake-refresh-token", CHALLENGE)
        .await
        .unwrap();
    code
}

#[tokio::test]
async fn a_bound_code_redeems_only_with_its_challenge() {
    let cache = cache();
    let code = bound_code(&cache, "bound").await;

    for wrong in [None, Some("another-challenge")] {
        let refused = cache.take_mobile_login_session(&code, wrong).await.unwrap();
        assert!(
            matches!(refused, MobileLoginRedemption::ChallengeMismatch),
            "{refused:?}"
        );
    }

    // The refused attempts left the code for the holder of the verifier.
    let taken = cache
        .take_mobile_login_session(&code, Some(CHALLENGE))
        .await
        .unwrap();
    let MobileLoginRedemption::Taken(session) = taken else {
        panic!("{taken:?}");
    };
    assert_eq!(session.refresh_token(), "fake-refresh-token");
    assert!(session.is_bound());

    let again = cache
        .take_mobile_login_session(&code, Some(CHALLENGE))
        .await
        .unwrap();
    assert!(matches!(again, MobileLoginRedemption::Missing), "{again:?}");
}

#[tokio::test]
async fn a_bound_code_expires_with_the_session_lifetime() {
    let cache = cache();
    let code = bound_code(&cache, "bound-ttl").await;
    let mut connection = cache
        .inner
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    let ttl: i64 = connection
        .ttl(bound_mobile_login_session_key(&code))
        .await
        .unwrap();
    let lifetime = i64::try_from(MACRO_MOBILE_LOGIN_SESSION_EXPIRY_SECONDS).unwrap();
    assert!(ttl > 0 && ttl <= lifetime, "{ttl}");
}

#[tokio::test]
async fn a_restored_bound_code_stays_bound() {
    let cache = cache();
    let code = bound_code(&cache, "bound-restore").await;
    let MobileLoginRedemption::Taken(taken) = cache
        .take_mobile_login_session(&code, Some(CHALLENGE))
        .await
        .unwrap()
    else {
        panic!("the bound code should redeem");
    };

    assert!(
        cache
            .restore_mobile_login_session(&code, &taken)
            .await
            .unwrap()
    );
    let without_challenge = cache.take_mobile_login_session(&code, None).await.unwrap();
    assert!(
        matches!(without_challenge, MobileLoginRedemption::ChallengeMismatch),
        "{without_challenge:?}"
    );
    // A second restore while the code is live again changes nothing.
    assert!(
        !cache
            .restore_mobile_login_session(&code, &taken)
            .await
            .unwrap()
    );
    let again = cache
        .take_mobile_login_session(&code, Some(CHALLENGE))
        .await
        .unwrap();
    assert!(
        matches!(again, MobileLoginRedemption::Taken(_)),
        "{again:?}"
    );
}

#[tokio::test]
async fn bound_code_errors_never_contain_the_code_token_or_challenge() {
    let cache = MacroCache::new("redis://127.0.0.1:1");
    let code = fresh_code("bound-unreachable");

    let set = cache
        .set_bound_mobile_login_session(&code, "fake-refresh-token", CHALLENGE)
        .await
        .unwrap_err();
    let take = cache
        .take_mobile_login_session(&code, Some(CHALLENGE))
        .await
        .unwrap_err();
    for error in [set, take] {
        let text = format!("{error:?}");
        assert!(!text.contains(&code), "{text}");
        assert!(!text.contains("fake-refresh-token"), "{text}");
        assert!(!text.contains(CHALLENGE), "{text}");
    }
}

#[tokio::test]
async fn a_bound_session_past_its_original_deadline_is_not_restored() {
    let cache = cache();
    let code = bound_code(&cache, "bound-expired").await;
    let MobileLoginRedemption::Taken(mut taken) = cache
        .take_mobile_login_session(&code, Some(CHALLENGE))
        .await
        .unwrap()
    else {
        panic!("the bound code should redeem");
    };
    taken.deadline_ms = redis_now_ms(&cache).await - 1;

    assert!(
        !cache
            .restore_mobile_login_session(&code, &taken)
            .await
            .unwrap()
    );
    let after = cache
        .take_mobile_login_session(&code, Some(CHALLENGE))
        .await
        .unwrap();
    assert!(matches!(after, MobileLoginRedemption::Missing), "{after:?}");
}
