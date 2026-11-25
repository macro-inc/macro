use std::time::{Duration, Instant};

use anyhow::Context;
use redis::AsyncCommands;

use crate::MacroCache;

pub static MACRO_MOBILE_LOGIN_SESSION_PREFIX: &str = "mbl_login:";
/// Session codes bound to a challenge live under their own prefix, as a hash
/// of the refresh token and the challenge. An instance that predates binding
/// looks only at the plain prefix, so it can never redeem a bound code
/// without its verifier.
pub static MACRO_BOUND_MOBILE_LOGIN_SESSION_PREFIX: &str = "mbl_login_bound:";
pub static MACRO_MOBILE_LOGIN_SESSION_EXPIRY_SECONDS: u64 = 5 * 60;

/// This is the length of time a passwordless login code is valid for within FusionAuth
/// This matches the time configured in the fusionauth tenant with some buffer time (30s)
pub static MACRO_PASSWORDLESS_LOGIN_CODE_EXPIRY_SECONDS: u64 = 630;

/// How long after account creation the first completed login is still
/// attributed as a signup (the create-user webhook and the auth callback run
/// within the same auth flow, so this only needs to cover slow IdP round trips).
pub static MACRO_JUST_SIGNED_UP_EXPIRY_SECONDS: u64 = 30 * 60;

/// How long Meta click ids captured at SSO start wait for the create-user
/// webhook. The IdP round trip is the same window as the signup marker.
pub static MACRO_SIGNUP_META_EXPIRY_SECONDS: u64 = MACRO_JUST_SIGNED_UP_EXPIRY_SECONDS;

const REFRESH_TOKEN_FIELD: &str = "refresh_token";
const CHALLENGE_FIELD: &str = "challenge";

/// Redeems a session code in one step. A plain code (`KEYS[1]`) is taken
/// as it is. A bound code (`KEYS[2]`) is taken only when `ARGV[1]` is its
/// challenge; otherwise it stays, so a caller without the verifier cannot
/// spend it. Returns `{status, refresh_token, remaining_ms}`, or nil when
/// neither key exists.
const TAKE_MOBILE_LOGIN_SESSION: &str = r"
local refresh_token = redis.call('GET', KEYS[1])
if refresh_token then
  local remaining_ms = redis.call('PTTL', KEYS[1])
  redis.call('DEL', KEYS[1])
  return {'taken', refresh_token, remaining_ms, ''}
end
local bound = redis.call('HMGET', KEYS[2], 'refresh_token', 'challenge')
if not bound[1] then
  return false
end
if bound[2] ~= ARGV[1] then
  return {'mismatch', '', 0, ''}
end
local remaining_ms = redis.call('PTTL', KEYS[2])
redis.call('DEL', KEYS[2])
return {'taken', bound[1], remaining_ms, bound[2]}
";

/// Puts a bound session back unless its key exists again.
const RESTORE_BOUND_MOBILE_LOGIN_SESSION: &str = r"
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 0
end
redis.call('HSET', KEYS[1], 'refresh_token', ARGV[1], 'challenge', ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
";

fn mobile_login_session_key(session_code: &str) -> String {
    format!("{MACRO_MOBILE_LOGIN_SESSION_PREFIX}{session_code}")
}

fn bound_mobile_login_session_key(session_code: &str) -> String {
    format!("{MACRO_BOUND_MOBILE_LOGIN_SESSION_PREFIX}{session_code}")
}

/// A redeemed session code's session: the refresh token it was minted for,
/// the challenge it was bound to, if any, and the moment the code expires.
/// `Debug` leaves the token and challenge out.
pub struct MobileLoginSession {
    refresh_token: String,
    challenge: Option<String>,
    expires_at: Instant,
}

impl MobileLoginSession {
    /// The refresh token the session code was minted for.
    pub fn refresh_token(&self) -> &str {
        &self.refresh_token
    }

    /// Whether the code was bound to a challenge.
    pub fn is_bound(&self) -> bool {
        self.challenge.is_some()
    }

    /// How long the code has left, counted from its original deadline.
    fn remaining(&self) -> Duration {
        self.expires_at.saturating_duration_since(Instant::now())
    }
}

impl std::fmt::Debug for MobileLoginSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MobileLoginSession")
            .field("bound", &self.is_bound())
            .field("remaining", &self.remaining())
            .finish_non_exhaustive()
    }
}

/// What an attempt to redeem a session code found.
#[derive(Debug)]
pub enum MobileLoginRedemption {
    /// The code redeemed, and it is gone.
    Taken(MobileLoginSession),
    /// The code is unknown, expired or already redeemed.
    Missing,
    /// The code is bound to a challenge the caller did not present. It stays
    /// live for the caller that holds the verifier.
    ChallengeMismatch,
}

/// Generates the rate limit key for channel invites for a given ip
macro_rules! macro_passwordless_login_code {
    ($email:expr) => {
        format!("pw_login_code:{}", $email)
    };
}

/// Generates the "account was just created" marker key for a given email
macro_rules! macro_just_signed_up {
    ($email:expr) => {
        format!("just_signed_up:{}", $email)
    };
}

impl MacroCache {
    /// **LEGACY** removes a user's session from redis
    /// This is used for legacy auth only
    pub async fn delete_user(&self, user_id: &str) -> anyhow::Result<()> {
        let mut keys: Vec<String> = vec![user_id.to_string()];

        let session_id = macro_redis::get::get_optional::<String>(&self.inner, user_id).await?;

        if let Some(session_id) = session_id {
            keys.push(session_id.clone());
            keys.push(format!("{session_id}-id"));
        }

        let keys = keys.iter().map(|k| k.as_str()).collect::<Vec<&str>>();
        macro_redis::delete::delete_multiple(&self.inner, &keys).await
    }

    /// Stores a mobile login session under a freshly minted session code.
    ///
    /// Errors never name the key: it embeds the code, and callers log them.
    pub async fn set_mobile_login_session(
        &self,
        session_code: &str,
        refresh_token: &str,
    ) -> anyhow::Result<()> {
        let mut connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;
        connection
            .set_ex::<_, _, ()>(
                mobile_login_session_key(session_code),
                refresh_token,
                MACRO_MOBILE_LOGIN_SESSION_EXPIRY_SECONDS,
            )
            .await
            .context("unable to store mobile login session")
    }

    /// Stores a mobile login session that redeems only with `challenge`.
    ///
    /// Errors never name the key: it embeds the code, and callers log them.
    pub async fn set_bound_mobile_login_session(
        &self,
        session_code: &str,
        refresh_token: &str,
        challenge: &str,
    ) -> anyhow::Result<()> {
        let mut connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;
        let key = bound_mobile_login_session_key(session_code);
        let expiry = i64::try_from(MACRO_MOBILE_LOGIN_SESSION_EXPIRY_SECONDS).unwrap_or(i64::MAX);
        redis::pipe()
            .atomic()
            .hset_multiple(
                &key,
                &[
                    (REFRESH_TOKEN_FIELD, refresh_token),
                    (CHALLENGE_FIELD, challenge),
                ],
            )
            .ignore()
            .expire(&key, expiry)
            .ignore()
            .query_async::<()>(&mut connection)
            .await
            .context("unable to store bound mobile login session")
    }

    /// Redeems a session code: returns its session and deletes it in one
    /// atomic step, so a code succeeds at most once however many callers race
    /// for it. A bound code redeems only when `challenge` is the one it was
    /// stored with.
    pub async fn take_mobile_login_session(
        &self,
        session_code: &str,
        challenge: Option<&str>,
    ) -> anyhow::Result<MobileLoginRedemption> {
        let mut connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;
        let taken: Option<(String, String, i64, String)> =
            redis::Script::new(TAKE_MOBILE_LOGIN_SESSION)
                .key(mobile_login_session_key(session_code))
                .key(bound_mobile_login_session_key(session_code))
                .arg(challenge.unwrap_or_default())
                .invoke_async(&mut connection)
                .await
                .context("unable to redeem mobile login session")?;
        let Some((status, refresh_token, remaining_ms, stored_challenge)) = taken else {
            return Ok(MobileLoginRedemption::Missing);
        };
        if status != "taken" {
            return Ok(MobileLoginRedemption::ChallengeMismatch);
        }
        // Fix the deadline now: a restore after a slow refresh must not get
        // back the time the refresh took.
        Ok(MobileLoginRedemption::Taken(MobileLoginSession {
            refresh_token,
            challenge: Some(stored_challenge).filter(|challenge| !challenge.is_empty()),
            expires_at: Instant::now()
                + Duration::from_millis(u64::try_from(remaining_ms).unwrap_or(0)),
        }))
    }

    /// Puts back a session whose redemption failed after it was taken, until
    /// its original deadline, so the client can retry. A bound session goes
    /// back bound to the same challenge. Never restores an expired code or
    /// overwrites one that exists again. Returns whether it was restored.
    pub async fn restore_mobile_login_session(
        &self,
        session_code: &str,
        session: &MobileLoginSession,
    ) -> anyhow::Result<bool> {
        let remaining_ms = u64::try_from(session.remaining().as_millis()).unwrap_or(u64::MAX);
        if remaining_ms == 0 {
            return Ok(false);
        }
        let mut connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;
        if let Some(challenge) = &session.challenge {
            let restored: bool = redis::Script::new(RESTORE_BOUND_MOBILE_LOGIN_SESSION)
                .key(bound_mobile_login_session_key(session_code))
                .arg(&session.refresh_token)
                .arg(challenge)
                .arg(remaining_ms)
                .invoke_async(&mut connection)
                .await
                .context("unable to restore bound mobile login session")?;
            return Ok(restored);
        }
        let options = redis::SetOptions::default()
            .conditional_set(redis::ExistenceCheck::NX)
            .with_expiration(redis::SetExpiry::PX(remaining_ms));
        let restored: Option<String> = connection
            .set_options(
                mobile_login_session_key(session_code),
                &session.refresh_token,
                options,
            )
            .await
            .context("unable to restore mobile login session")?;
        Ok(restored.is_some())
    }

    /// Sets the passwordless login code for a given email
    pub async fn set_passwordless_login_code(&self, email: &str, code: &str) -> anyhow::Result<()> {
        let key = macro_passwordless_login_code!(email.to_lowercase());

        macro_redis::set::set_with_expiry(
            &self.inner,
            &key,
            code,
            MACRO_PASSWORDLESS_LOGIN_CODE_EXPIRY_SECONDS,
        )
        .await
    }

    /// Gets the passwordless login code for a given email
    pub async fn get_passwordless_login_code(&self, email: &str) -> anyhow::Result<String> {
        let key = macro_passwordless_login_code!(email.to_lowercase());
        macro_redis::get::get::<String>(&self.inner, &key).await
    }

    /// Marks an account as just created so the auth callback that completes the
    /// same flow can attribute the login as a signup.
    pub async fn mark_user_just_signed_up(&self, email: &str) -> anyhow::Result<()> {
        let key = macro_just_signed_up!(email.to_lowercase());
        macro_redis::set::set_with_expiry(&self.inner, &key, 1, MACRO_JUST_SIGNED_UP_EXPIRY_SECONDS)
            .await
    }

    /// Consumes the just-signed-up marker for an email. Returns true exactly
    /// once per marker: GETDEL is atomic, so the first caller wins.
    pub async fn take_user_just_signed_up(&self, email: &str) -> anyhow::Result<bool> {
        let key = macro_just_signed_up!(email.to_lowercase());
        let value = macro_redis::get::get_del_optional::<u8>(&self.inner, &key).await?;
        Ok(value.is_some())
    }

    /// Stores Meta click ids for the browser that started SSO from `ip` with
    /// `user_agent`. A different browser at the same address keeps its own slot.
    pub async fn stash_signup_meta(
        &self,
        ip: &str,
        user_agent: &str,
        json: &str,
    ) -> anyhow::Result<()> {
        let key = signup_meta_key(ip, user_agent);
        macro_redis::set::set_with_expiry(&self.inner, &key, json, MACRO_SIGNUP_META_EXPIRY_SECONDS)
            .await
    }

    /// Takes the Meta click ids stashed for this address and user agent.
    pub async fn take_signup_meta(
        &self,
        ip: &str,
        user_agent: &str,
    ) -> anyhow::Result<Option<String>> {
        let key = signup_meta_key(ip, user_agent);
        macro_redis::get::get_del_optional::<String>(&self.inner, &key).await
    }
}

fn signup_meta_key(ip: &str, user_agent: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    user_agent.hash(&mut hasher);
    format!("signup_meta:{ip}:{:x}", hasher.finish())
}

#[cfg(test)]
mod test;
