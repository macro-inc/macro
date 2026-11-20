//! Email-code signup: `POST /login/passwordless` creates the account as soon as
//! a code is requested, before anyone has shown they receive mail at the
//! address. What the address alone earns, the team whose auto-join domain is
//! its domain and the referral the request carried, waits for the first code
//! used for it (`GET /oauth/passwordless/{code}`).

#[cfg(test)]
mod test;

use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;

use super::agent_signup::AGENT_SIGNUP_DATA_KEY;

/// FusionAuth user metadata key marking an account an email-code request created.
pub(crate) const EMAIL_CODE_SIGNUP_DATA_KEY: &str = "emailCodeSignup";

/// FusionAuth user metadata for an account an email-code request creates.
pub(crate) fn email_code_signup_data(is_agent: bool) -> Value {
    let mut data = serde_json::Map::new();
    data.insert(EMAIL_CODE_SIGNUP_DATA_KEY.into(), Value::Bool(true));
    if is_agent {
        data.insert(AGENT_SIGNUP_DATA_KEY.into(), Value::Bool(true));
    }
    Value::Object(data)
}

/// Whether FusionAuth user metadata marks an account an email-code request
/// created, whose address nobody had proven when it was created.
pub(crate) fn created_by_email_code(data: Option<&Value>) -> bool {
    data.and_then(|data| data.get(EMAIL_CODE_SIGNUP_DATA_KEY))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// What the first proof of an email-code signup's address unlocks.
pub(crate) trait EmailCodeSignupPort {
    /// Marks the account's address verified. True only for the call that
    /// changed it, so the first proof's follow-ups run once.
    fn claim_first_proof(
        &self,
        fusionauth_user_id: &str,
        email: &str,
    ) -> impl Future<Output = anyhow::Result<bool>> + Send;

    /// Joins the team whose auto-join domain is the user's email domain.
    /// Returns the team joined, or `None` when no team matched or the user is
    /// already on one.
    fn join_domain_team(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = anyhow::Result<Option<uuid::Uuid>>> + Send;

    /// Records that `referral_code` referred the user and rewards the referrer.
    fn track_referral(
        &self,
        user_id: &MacroUserIdStr<'_>,
        referral_code: &str,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// A completed email-code login.
pub(crate) struct EmailCodeLogin<'a> {
    /// The FusionAuth user id, which is `macro_user.id`.
    pub fusionauth_user_id: &'a str,
    /// The address the code was sent to, lowercased.
    pub email: &'a str,
    /// The FusionAuth user's metadata.
    pub user_data: Option<&'a Value>,
    /// The referral code the code's request carried.
    pub referral_code: Option<&'a str>,
}

/// What a completed email-code login unlocked.
#[derive(Debug, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub(crate) enum EmailCodeSignupOutcome {
    /// Not an account an email-code request created.
    NotEmailCodeSignup,
    /// A code was used for this address before.
    AlreadyProven,
    /// The first proof: the domain team join and referral ran.
    FirstProof,
    /// Recording the proof failed, so nothing ran; the next code retries.
    ClaimFailed,
}

/// Runs what an email-code signup's first proof unlocks. Failures are logged,
/// never returned: the login itself has already succeeded.
#[tracing::instrument(
    name = "auth.email_code_signup.first_proof",
    skip_all,
    fields(
        fusionauth_user_id = %login.fusionauth_user_id,
        outcome = tracing::field::Empty,
        team_id = tracing::field::Empty,
        referral = tracing::field::Empty,
    )
)]
pub(crate) async fn finish_email_code_signup<P: EmailCodeSignupPort>(
    port: &P,
    login: EmailCodeLogin<'_>,
) -> EmailCodeSignupOutcome {
    let outcome = first_proof(port, &login).await;
    tracing::Span::current().record("outcome", <&str>::from(&outcome));
    outcome
}

async fn first_proof<P: EmailCodeSignupPort>(
    port: &P,
    login: &EmailCodeLogin<'_>,
) -> EmailCodeSignupOutcome {
    if !created_by_email_code(login.user_data) {
        return EmailCodeSignupOutcome::NotEmailCodeSignup;
    }
    // The parse error quotes the address, so it is not logged.
    let Ok(user_id) = MacroUserIdStr::try_from_email(login.email) else {
        tracing::error!("email-code login address is not a Macro user id");
        return EmailCodeSignupOutcome::ClaimFailed;
    };
    match port
        .claim_first_proof(login.fusionauth_user_id, login.email)
        .await
    {
        Ok(true) => {}
        Ok(false) => return EmailCodeSignupOutcome::AlreadyProven,
        Err(error) => {
            tracing::error!(error = ?error, "failed to record the first email-code proof");
            return EmailCodeSignupOutcome::ClaimFailed;
        }
    }

    let span = tracing::Span::current();
    match port.join_domain_team(&user_id).await {
        Ok(Some(team_id)) => {
            span.record("team_id", tracing::field::display(team_id));
        }
        Ok(None) => {}
        Err(error) => {
            tracing::error!(error = ?error, "failed to join the email domain's team");
        }
    }

    if let Some(referral_code) = login.referral_code {
        let referral = match port.track_referral(&user_id, referral_code).await {
            Ok(()) => "tracked",
            Err(error) => {
                tracing::error!(error = ?error, "failed to track the signup's referral");
                "failed"
            }
        };
        span.record("referral", referral);
    }

    EmailCodeSignupOutcome::FirstProof
}
