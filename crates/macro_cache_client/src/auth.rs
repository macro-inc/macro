use anyhow::Context;

use crate::MacroCache;

pub static MACRO_MOBILE_LOGIN_SESSION_PREFIX: &str = "mbl_login:";
pub static MACRO_MOBILE_LOGIN_SESSION_EXPIRY_SECONDS: u64 = 5 * 60;

/// This is the length of time a passwordless login code is valid for within FusionAuth
/// This matches the time configured in the fusionauth tenant with some buffer time (30s)
pub static MACRO_PASSWORDLESS_LOGIN_CODE_EXPIRY_SECONDS: u64 = 630;

/// How long after account creation the first completed login is still
/// attributed as a signup (the create-user webhook and the auth callback run
/// within the same auth flow, so this only needs to cover slow IdP round trips).
pub static MACRO_JUST_SIGNED_UP_EXPIRY_SECONDS: u64 = 30 * 60;

/// Where a session code bound to a sign-in lives: one hash holding the
/// refresh token and the S256 challenge of a verifier that only the sign-in
/// attempt which asked for the code holds. One record, so Redis can never
/// evict the challenge and keep the token; and a key of its own, so a server
/// that predates binding finds no code here to redeem without the verifier.
pub static MACRO_MOBILE_LOGIN_BOUND_SESSION_PREFIX: &str = "mbl_login_bound:";

const REFRESH_TOKEN_FIELD: &str = "refresh_token";
const CHALLENGE_FIELD: &str = "challenge";

/// Lua defining `deadline_ms(key)`: when `key` expires, in milliseconds
/// since the epoch on Redis's own clock, or a negative number when it has no
/// expiry. Redis 7.0 reads the stored deadline exactly with PEXPIRETIME, and
/// any error from it fails the script. An older Redis, which has neither
/// PEXPIRETIME nor `REDIS_VERSION_NUM`, rebuilds the deadline from TIME, read
/// first, and the TTL left, which can put it a millisecond early but never
/// late.
macro_rules! deadline_lua {
    () => {
        include_str!("auth/deadline.lua")
    };
}

/// Reads a bound mobile login session and deletes it in one step, returning
/// the stored refresh token, its deadline and the challenge. The restore
/// compares that deadline with Redis's clock, so it never counts the time
/// spent reaching Redis. A record missing its challenge or its expiry was
/// not written by this module: it is spent and never redeems. Each script
/// touches one key, so it runs on a cluster too.
/// KEYS: the bound key. ARGV: the record's fields.
const TAKE_BOUND_MOBILE_LOGIN_SESSION: &str =
    concat!(deadline_lua!(), include_str!("auth/take_bound.lua"));

/// The same for an unbound session: its refresh token and deadline.
/// KEYS: the unbound key.
const TAKE_UNBOUND_MOBILE_LOGIN_SESSION: &str =
    concat!(deadline_lua!(), include_str!("auth/take_unbound.lua"));

/// Puts a taken session back under its key until exactly its original
/// deadline, unless that has passed or the code exists again. PEXPIREAT
/// pins the deadline; should it fail, the record is deleted and the error
/// returned, so the code stays spent rather than outliving its deadline.
/// PEXPIREAT deletes the record itself when the deadline passed after the
/// check above, so the script reports whether the record is still there.
/// An unbound write also carries the deadline in case that delete fails
/// too, since a server that predates the deadline checks redeems an unbound
/// record without one; the takes here refuse it. Before Redis 7.0 it carries
/// the time left instead, which can run past the deadline by the time between
/// TIME and SET. The take that preceded this restore ran DEL, so a delete
/// fails only if Redis's permissions changed in between.
/// KEYS: the session's key. ARGV: the refresh token, the deadline, then for
/// a bound code the record's fields and challenge.
const RESTORE_MOBILE_LOGIN_SESSION: &str = include_str!("auth/restore.lua");

fn mobile_login_session_key(session_code: &str) -> String {
    format!("{MACRO_MOBILE_LOGIN_SESSION_PREFIX}{session_code}")
}

fn bound_mobile_login_session_key(session_code: &str) -> String {
    format!("{MACRO_MOBILE_LOGIN_BOUND_SESSION_PREFIX}{session_code}")
}

/// A redeemed session code's session: the refresh token it was minted for,
/// the challenge it is bound to, if any, and the moment the code expires.
/// `Debug` leaves the token and the challenge out.
pub struct MobileLoginSession {
    refresh_token: String,
    code_challenge: Option<String>,
    /// When the code expires, in milliseconds since the epoch on Redis's
    /// clock.
    expires_at_ms: i64,
}

impl MobileLoginSession {
    /// The refresh token the session code was minted for.
    pub fn refresh_token(&self) -> &str {
        &self.refresh_token
    }

    /// The challenge stored with the code, which only the verifier of the
    /// sign-in attempt that asked for it answers. `None` for a code minted
    /// without one.
    pub fn code_challenge(&self) -> Option<&str> {
        self.code_challenge.as_deref()
    }
}

impl std::fmt::Debug for MobileLoginSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MobileLoginSession")
            .field("bound", &self.code_challenge.is_some())
            .field("expires_at_ms", &self.expires_at_ms)
            .finish_non_exhaustive()
    }
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

    /// Stores a mobile login session under a freshly minted session code,
    /// as one record with the challenge it is bound to when the sign-in sent
    /// one.
    ///
    /// Errors never name the key: it embeds the code, and callers log them.
    pub async fn set_mobile_login_session(
        &self,
        session_code: &str,
        refresh_token: &str,
        code_challenge: Option<&str>,
    ) -> anyhow::Result<()> {
        let mut connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;
        let mut pipe = redis::pipe();
        match code_challenge {
            Some(code_challenge) => {
                let key = bound_mobile_login_session_key(session_code);
                pipe.atomic()
                    .hset_multiple(
                        &key,
                        &[
                            (REFRESH_TOKEN_FIELD, refresh_token),
                            (CHALLENGE_FIELD, code_challenge),
                        ],
                    )
                    .expire(
                        &key,
                        MACRO_MOBILE_LOGIN_SESSION_EXPIRY_SECONDS.cast_signed(),
                    );
            }
            None => {
                pipe.set_ex(
                    mobile_login_session_key(session_code),
                    refresh_token,
                    MACRO_MOBILE_LOGIN_SESSION_EXPIRY_SECONDS,
                );
            }
        }
        pipe.query_async::<()>(&mut connection)
            .await
            .context("unable to store mobile login session")
    }

    /// Redeems a session code: returns its session and deletes it in one
    /// atomic step, so a code succeeds at most once however many callers race
    /// for it. `None` means the code is unknown, expired or already redeemed.
    /// A code is stored either bound or unbound, so the two takes can't both
    /// find it.
    pub async fn take_mobile_login_session(
        &self,
        session_code: &str,
    ) -> anyhow::Result<Option<MobileLoginSession>> {
        let mut connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;
        let bound: Option<(String, i64, String)> =
            redis::Script::new(TAKE_BOUND_MOBILE_LOGIN_SESSION)
                .key(bound_mobile_login_session_key(session_code))
                .arg(REFRESH_TOKEN_FIELD)
                .arg(CHALLENGE_FIELD)
                .invoke_async(&mut connection)
                .await
                .context("unable to redeem mobile login session")?;
        if let Some((refresh_token, expires_at_ms, code_challenge)) = bound {
            return Ok(Some(MobileLoginSession {
                refresh_token,
                code_challenge: Some(code_challenge),
                expires_at_ms,
            }));
        }
        let unbound: Option<(String, i64)> = redis::Script::new(TAKE_UNBOUND_MOBILE_LOGIN_SESSION)
            .key(mobile_login_session_key(session_code))
            .invoke_async(&mut connection)
            .await
            .context("unable to redeem mobile login session")?;
        Ok(
            unbound.map(|(refresh_token, expires_at_ms)| MobileLoginSession {
                refresh_token,
                code_challenge: None,
                expires_at_ms,
            }),
        )
    }

    /// Puts back a session whose redemption failed after it was taken, with
    /// its challenge, until its original deadline, so the client can retry.
    /// Never restores a code past that deadline, however long the refresh
    /// took, or overwrites one that exists again. Returns whether it was
    /// restored.
    pub async fn restore_mobile_login_session(
        &self,
        session_code: &str,
        session: &MobileLoginSession,
    ) -> anyhow::Result<bool> {
        let mut connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;
        let script = redis::Script::new(RESTORE_MOBILE_LOGIN_SESSION);
        let key = match session.code_challenge {
            Some(_) => bound_mobile_login_session_key(session_code),
            None => mobile_login_session_key(session_code),
        };
        let mut invocation = script.key(key);
        invocation
            .arg(&session.refresh_token)
            .arg(session.expires_at_ms);
        if let Some(code_challenge) = &session.code_challenge {
            invocation
                .arg(REFRESH_TOKEN_FIELD)
                .arg(CHALLENGE_FIELD)
                .arg(code_challenge);
        }
        let restored: u8 = invocation
            .invoke_async(&mut connection)
            .await
            .context("unable to restore mobile login session")?;
        Ok(restored == 1)
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
}

#[cfg(test)]
mod test;
