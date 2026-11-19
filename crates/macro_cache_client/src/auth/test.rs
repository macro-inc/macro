//! Run against the CI Redis, or set `REDIS_URL` to a private one.
use super::*;

macro_env_var::maybe_env_var! {
    struct RedisUrl;
}

fn redis_url() -> String {
    let redis_url = RedisUrl::new();
    redis_url
        .as_ref()
        .and_then(RedisUrl::value)
        .unwrap_or("redis://127.0.0.1:6379")
        .to_owned()
}

fn cache() -> MacroCache {
    MacroCache::new(&redis_url())
}

/// A cache signed in as a fresh ACL user that may run every command but
/// `refused`, and the user's name, to remove it with [`remove_user`]. Its
/// password comes from Redis and only the returned cache holds it, so a
/// user a failed test leaves behind lets no one sign in.
async fn cache_refusing(cache: &MacroCache, refused: &[&str]) -> (MacroCache, String) {
    let url = redis_url();
    let address = url
        .strip_prefix("redis://")
        .expect("REDIS_URL must be a redis:// URL");
    assert!(
        !address.contains('@'),
        "REDIS_URL must carry no credentials"
    );
    let mut connection = cache
        .inner
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    let user = fresh_code("acl");
    let password: String = redis::cmd("ACL")
        .arg("GENPASS")
        .query_async(&mut connection)
        .await
        .unwrap();
    let refusing = MacroCache::new(&format!("redis://{user}:{password}@{address}"));
    let mut setuser = redis::cmd("ACL");
    setuser
        .arg("SETUSER")
        .arg(&user)
        .arg("on")
        .arg(format!(">{password}"))
        .arg("~*")
        .arg("+@all");
    for command in refused {
        setuser.arg(format!("-{command}"));
    }
    setuser.query_async::<()>(&mut connection).await.unwrap();
    (refusing, user)
}

/// Removes an ACL user from [`cache_refusing`] and returns the commands
/// Redis refused it, from the ACL log.
async fn remove_user(cache: &MacroCache, user: &str) -> Vec<String> {
    let mut connection = cache
        .inner
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    // The log holds every client's newest refusals and returns ten unless
    // asked for more; ask for all it keeps by default.
    let log: Vec<std::collections::HashMap<String, redis::Value>> = redis::cmd("ACL")
        .arg("LOG")
        .arg(128)
        .query_async(&mut connection)
        .await
        .unwrap();
    redis::cmd("ACL")
        .arg("DELUSER")
        .arg(user)
        .query_async::<()>(&mut connection)
        .await
        .unwrap();
    let mut refused: Vec<String> =
        log.into_iter()
            .filter_map(
                |mut entry| match (entry.remove("username"), entry.remove("object")) {
                    (
                        Some(redis::Value::BulkString(name)),
                        Some(redis::Value::BulkString(object)),
                    ) if name == user.as_bytes() => String::from_utf8(object).ok(),
                    _ => None,
                },
            )
            .collect();
    refused.sort();
    refused
}

fn fresh_code(label: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("test-{label}-{nanos}")
}

/// Redis's clock in milliseconds since the epoch: the clock deadlines use.
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

/// Whether the server has PEXPIRETIME, which came in Redis 7.0 together with
/// the `REDIS_VERSION_NUM` its scripts can read.
async fn has_pexpiretime(cache: &MacroCache) -> bool {
    let mut connection = cache
        .inner
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    let version: i64 = redis::cmd("EVAL")
        .arg("return redis.REDIS_VERSION_NUM or 0")
        .arg(0)
        .query_async(&mut connection)
        .await
        .unwrap();
    version >= 0x07_00_00
}

/// When `key` expires on Redis's clock, read directly rather than through a
/// take. Needs PEXPIRETIME.
async fn stored_deadline_ms(cache: &MacroCache, key: &str) -> i64 {
    let mut connection = cache
        .inner
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    redis::cmd("PEXPIRETIME")
        .arg(key)
        .query_async(&mut connection)
        .await
        .unwrap()
}

/// Milliseconds before `key` expires: -1 when it never does, -2 when absent.
async fn ttl_ms(cache: &MacroCache, key: &str) -> i64 {
    let mut connection = cache
        .inner
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    redis::cmd("PTTL")
        .arg(key)
        .query_async(&mut connection)
        .await
        .unwrap()
}

/// Whether a take read back the deadline `stored`: exactly, where Redis has
/// PEXPIRETIME. Before that the take adds the TTL left to a clock it read
/// first, so it is never late, and early by the time between the two.
async fn read_back(cache: &MacroCache, read: i64, stored: i64) -> bool {
    if has_pexpiretime(cache).await {
        read == stored
    } else {
        (-1_000..=0).contains(&(read - stored))
    }
}

/// Writes a record directly: an unbound value, or a hash of `fields`, that
/// expires at `expires_at_ms`, or never when it is `None`.
async fn write_raw(
    cache: &MacroCache,
    key: &str,
    fields: &[(&str, &str)],
    expires_at_ms: Option<i64>,
) {
    let mut connection = cache
        .inner
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    let mut pipe = redis::pipe();
    if fields.is_empty() {
        pipe.set(key, "fake-refresh-token");
    } else {
        pipe.hset_multiple(key, fields);
    }
    if let Some(expires_at_ms) = expires_at_ms {
        pipe.cmd("PEXPIREAT").arg(key).arg(expires_at_ms);
    }
    pipe.query_async::<()>(&mut connection).await.unwrap();
}

#[tokio::test]
async fn a_take_reads_the_deadline_the_code_was_stored_with() {
    let cache = cache();
    let deadline = redis_now_ms(&cache).await + 60_007;
    let unbound = fresh_code("deadline");
    write_raw(
        &cache,
        &mobile_login_session_key(&unbound),
        &[],
        Some(deadline),
    )
    .await;
    let bound = fresh_code("bound-deadline");
    write_raw(
        &cache,
        &bound_mobile_login_session_key(&bound),
        &[
            (REFRESH_TOKEN_FIELD, "fake-refresh-token"),
            (CHALLENGE_FIELD, FAKE_CHALLENGE),
        ],
        Some(deadline),
    )
    .await;

    for code in [&unbound, &bound] {
        let taken = cache
            .take_mobile_login_session(code)
            .await
            .unwrap()
            .unwrap();
        assert!(
            read_back(&cache, taken.expires_at_ms, deadline).await,
            "read {}, stored {deadline}",
            taken.expires_at_ms
        );
    }
}

#[tokio::test]
async fn a_record_without_an_expiry_never_redeems() {
    // Should a restore's expiry fail after its write, the record it leaves
    // must not outlive the code's deadline.
    let cache = cache();
    let unbound = fresh_code("no-expiry");
    write_raw(&cache, &mobile_login_session_key(&unbound), &[], None).await;
    let bound = fresh_code("bound-no-expiry");
    write_raw(
        &cache,
        &bound_mobile_login_session_key(&bound),
        &[
            (REFRESH_TOKEN_FIELD, "fake-refresh-token"),
            (CHALLENGE_FIELD, FAKE_CHALLENGE),
        ],
        None,
    )
    .await;

    for code in [&unbound, &bound] {
        assert!(
            cache
                .take_mobile_login_session(code)
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(stored_keys(&cache, code).await, [false, false]);
    }
}

#[tokio::test]
async fn a_bound_record_missing_its_challenge_is_refused_like_an_unknown_code() {
    let cache = cache();
    let code = fresh_code("bound-no-challenge");
    write_raw(
        &cache,
        &bound_mobile_login_session_key(&code),
        &[(REFRESH_TOKEN_FIELD, "fake-refresh-token")],
        Some(redis_now_ms(&cache).await + 60_000),
    )
    .await;

    assert!(
        cache
            .take_mobile_login_session(&code)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(stored_keys(&cache, &code).await, [false, false]);
}

#[tokio::test]
async fn a_session_code_redeems_once() {
    let cache = cache();
    let code = fresh_code("once");
    cache
        .set_mobile_login_session(&code, "fake-refresh-token", None)
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
        .set_mobile_login_session(&code, "fake-refresh-token", None)
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
        .set_mobile_login_session(&code, "fake-refresh-token", None)
        .await
        .unwrap();

    let mut taken = cache
        .take_mobile_login_session(&code)
        .await
        .unwrap()
        .unwrap();
    let now = redis_now_ms(&cache).await;
    let lifetime_ms = i64::try_from(MACRO_MOBILE_LOGIN_SESSION_EXPIRY_SECONDS * 1000).unwrap();
    assert!(taken.expires_at_ms > now && taken.expires_at_ms <= now + lifetime_ms);
    // Most of the code's lifetime went by while the refresh failed.
    taken.expires_at_ms = now + 2_000;
    assert!(
        cache
            .restore_mobile_login_session(&code, &taken)
            .await
            .unwrap()
    );
    // The restore keeps the original deadline instead of starting a new one.
    if has_pexpiretime(&cache).await {
        let stored = stored_deadline_ms(&cache, &mobile_login_session_key(&code)).await;
        assert_eq!(stored, taken.expires_at_ms);
    }

    let again = cache
        .take_mobile_login_session(&code)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(again.refresh_token(), "fake-refresh-token");
    assert!(
        read_back(&cache, again.expires_at_ms, taken.expires_at_ms).await,
        "restored until {}, taken with {}",
        again.expires_at_ms,
        taken.expires_at_ms
    );
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
        .set_mobile_login_session(&code, "fake-first-token", None)
        .await
        .unwrap();
    let taken = cache
        .take_mobile_login_session(&code)
        .await
        .unwrap()
        .unwrap();
    cache
        .set_mobile_login_session(&code, "fake-second-token", None)
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
        .set_mobile_login_session(&code, "fake-refresh-token", None)
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
        code_challenge: Some(FAKE_CHALLENGE.into()),
        expires_at_ms: 0,
    };
    let text = format!("{session:?}");
    assert!(!text.contains("fake-refresh-token"), "{text}");
    assert!(!text.contains(FAKE_CHALLENGE), "{text}");
}

const FAKE_CHALLENGE: &str = "fake-challenge";

/// Whether the unbound and the bound key of `code` exist.
async fn stored_keys(cache: &MacroCache, code: &str) -> [bool; 2] {
    let mut connection = cache
        .inner
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    let mut exists = [false; 2];
    for (key, found) in [
        mobile_login_session_key(code),
        bound_mobile_login_session_key(code),
    ]
    .iter()
    .zip(&mut exists)
    {
        *found = redis::cmd("EXISTS")
            .arg(key)
            .query_async(&mut connection)
            .await
            .unwrap();
    }
    exists
}

#[tokio::test]
async fn a_bound_code_is_one_record_that_unbound_readers_never_see() {
    // A server that predates binding reads only the unbound key, so it can
    // never redeem a bound code without its verifier, and no eviction can
    // separate the challenge from the token.
    let cache = cache();
    let code = fresh_code("bound-record");
    cache
        .set_mobile_login_session(&code, "fake-refresh-token", Some(FAKE_CHALLENGE))
        .await
        .unwrap();

    assert_eq!(stored_keys(&cache, &code).await, [false, true]);
}

#[tokio::test]
async fn a_bound_code_redeems_with_its_challenge_and_leaves_nothing_behind() {
    let cache = cache();
    let code = fresh_code("bound");
    cache
        .set_mobile_login_session(&code, "fake-refresh-token", Some(FAKE_CHALLENGE))
        .await
        .unwrap();

    let taken = cache
        .take_mobile_login_session(&code)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(taken.code_challenge(), Some(FAKE_CHALLENGE));
    assert_eq!(stored_keys(&cache, &code).await, [false, false]);

    // A code minted later under the same name starts without a challenge.
    cache
        .set_mobile_login_session(&code, "fake-refresh-token", None)
        .await
        .unwrap();
    let unbound = cache
        .take_mobile_login_session(&code)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(unbound.code_challenge(), None);
}

#[tokio::test]
async fn a_restored_code_keeps_its_challenge() {
    let cache = cache();
    let code = fresh_code("bound-restore");
    cache
        .set_mobile_login_session(&code, "fake-refresh-token", Some(FAKE_CHALLENGE))
        .await
        .unwrap();
    let taken = cache
        .take_mobile_login_session(&code)
        .await
        .unwrap()
        .unwrap();

    assert!(
        cache
            .restore_mobile_login_session(&code, &taken)
            .await
            .unwrap()
    );
    assert_eq!(stored_keys(&cache, &code).await, [false, true]);
    if has_pexpiretime(&cache).await {
        let stored = stored_deadline_ms(&cache, &bound_mobile_login_session_key(&code)).await;
        assert_eq!(stored, taken.expires_at_ms);
    }
    let again = cache
        .take_mobile_login_session(&code)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        again.code_challenge(),
        Some(FAKE_CHALLENGE),
        "a retry must not find the code unbound"
    );
    assert!(
        read_back(&cache, again.expires_at_ms, taken.expires_at_ms).await,
        "restored until {}, taken with {}",
        again.expires_at_ms,
        taken.expires_at_ms
    );
}

#[tokio::test]
async fn a_session_past_its_original_deadline_is_not_restored() {
    let cache = cache();
    let code = fresh_code("expired");
    cache
        .set_mobile_login_session(&code, "fake-refresh-token", None)
        .await
        .unwrap();
    let mut taken = cache
        .take_mobile_login_session(&code)
        .await
        .unwrap()
        .unwrap();
    // The refresh outlasted the code's original five minutes.
    taken.expires_at_ms = redis_now_ms(&cache).await - 1;

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

#[tokio::test]
async fn a_take_fails_rather_than_guess_when_redis_refuses_to_read_the_deadline() {
    let cache = cache();
    // Before Redis 7.0 a take reads TIME and PTTL instead.
    if !has_pexpiretime(&cache).await {
        return;
    }
    let unbound = fresh_code("refused-deadline");
    cache
        .set_mobile_login_session(&unbound, "fake-refresh-token", None)
        .await
        .unwrap();
    let bound = fresh_code("bound-refused-deadline");
    cache
        .set_mobile_login_session(&bound, "fake-refresh-token", Some(FAKE_CHALLENGE))
        .await
        .unwrap();

    let mut outcomes = Vec::new();
    for code in [&unbound, &bound] {
        // A user per take, so each one's refusal is in the log.
        let (refused, user) = cache_refusing(&cache, &["pexpiretime"]).await;
        let failed = refused.take_mobile_login_session(code).await.is_err();
        outcomes.push((failed, remove_user(&cache, &user).await));
    }
    let refused = vec!["pexpiretime".to_owned()];
    assert_eq!(outcomes, [(true, refused.clone()), (true, refused)]);
}

#[tokio::test]
async fn a_restore_that_cannot_pin_its_deadline_leaves_the_code_spent() {
    let cache = cache();
    let unbound = fresh_code("unpinned");
    cache
        .set_mobile_login_session(&unbound, "fake-refresh-token", None)
        .await
        .unwrap();
    let bound = fresh_code("bound-unpinned");
    cache
        .set_mobile_login_session(&bound, "fake-refresh-token", Some(FAKE_CHALLENGE))
        .await
        .unwrap();

    let mut outcomes = Vec::new();
    for code in [&unbound, &bound] {
        let taken = cache
            .take_mobile_login_session(code)
            .await
            .unwrap()
            .unwrap();
        let (refused, user) = cache_refusing(&cache, &["pexpireat"]).await;
        let restored = refused.restore_mobile_login_session(code, &taken).await;
        outcomes.push((
            restored.is_err(),
            remove_user(&cache, &user).await,
            stored_keys(&cache, code).await,
        ));
    }
    let refused = vec!["pexpireat".to_owned()];
    assert_eq!(
        outcomes,
        [
            (true, refused.clone(), [false, false]),
            (true, refused, [false, false])
        ],
        "a refused expiry must not leave a record behind"
    );
}

#[tokio::test]
async fn an_unbound_restore_that_can_neither_pin_nor_delete_still_expires() {
    // A server that predates the deadline checks redeems an unbound record
    // with no expiry, so the write itself carries the deadline.
    let cache = cache();
    let (refused, user) = cache_refusing(&cache, &["pexpireat", "del"]).await;
    let code = fresh_code("unpinned-undeleted");
    cache
        .set_mobile_login_session(&code, "fake-refresh-token", None)
        .await
        .unwrap();
    let taken = cache
        .take_mobile_login_session(&code)
        .await
        .unwrap()
        .unwrap();

    let restored = refused.restore_mobile_login_session(&code, &taken).await;
    assert_eq!(remove_user(&cache, &user).await, ["del", "pexpireat"]);
    assert!(restored.is_err());
    let key = mobile_login_session_key(&code);
    if has_pexpiretime(&cache).await {
        assert_eq!(stored_deadline_ms(&cache, &key).await, taken.expires_at_ms);
    } else {
        // Before Redis 7.0 the write carries the time left, which can run
        // past the deadline by the time between two commands.
        let left_ms = ttl_ms(&cache, &key).await;
        let lifetime_ms = i64::try_from(MACRO_MOBILE_LOGIN_SESSION_EXPIRY_SECONDS * 1000).unwrap();
        assert!(
            left_ms > 0 && left_ms <= lifetime_ms,
            "left with {left_ms} ms"
        );
    }
}
