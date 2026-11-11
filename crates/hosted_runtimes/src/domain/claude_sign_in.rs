//! Warning a team before its computer's Claude sign-in runs out.
//!
//! A computer whose Claude Code runs on an account signed in through Macro
//! stops working when that sign-in expires or Claude rejects it. The control
//! plane checks every such computer each pass and tells whoever signed it in,
//! plus the team's admins and owner: [`ClaudeSignInStage::ExpiresSoon`]
//! within [`EXPIRES_SOON_WITHIN`] of the expiry, [`ClaudeSignInStage::ExpiresToday`]
//! within [`EXPIRES_TODAY_WITHIN`], and [`ClaudeSignInStage::Expired`] once it
//! passed or macrod reports Claude signed out. Each stage is sent at most
//! once per sign-in; a later stage skips the earlier ones it overtook.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use chrono::{DateTime, Duration, Utc};
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;
use tracing::Instrument;
use uuid::Uuid;

use crate::domain::ids::ComputerId;

/// How far ahead of the expiry the first warning goes out.
pub const EXPIRES_SOON_WITHIN: Duration = Duration::days(3);
/// How far ahead of the expiry the last warning goes out: "expires today".
pub const EXPIRES_TODAY_WITHIN: Duration = Duration::days(1);

/// How close a sign-in is to no longer working, in the order notices go out.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, strum::AsRefStr, strum::EnumString,
)]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "account_notice_stage", rename_all = "snake_case")
)]
#[strum(serialize_all = "snake_case")]
pub enum ClaudeSignInStage {
    /// Expires within [`EXPIRES_SOON_WITHIN`].
    ExpiresSoon,
    /// Expires within [`EXPIRES_TODAY_WITHIN`].
    ExpiresToday,
    /// Expired, or Claude no longer accepts it.
    Expired,
}

/// What macrod last reported about Claude Code's sign-in on the computer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaudeReport {
    /// Claude has no account: the sign-in was rejected or removed.
    SignedOut,
    /// Claude is signed in.
    SignedIn {
        /// When the sign-in stops refreshing; unknown for some credentials.
        expires_at: Option<DateTime<Utc>>,
    },
}

/// A notice sent, or due, for one sign-in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClaudeSignInNotice {
    /// The sign-in it is about.
    pub signed_in_at: DateTime<Utc>,
    /// How close the sign-in was to no longer working.
    pub stage: ClaudeSignInStage,
    /// The expiry it warned about; `None` when macrod reported Claude signed out.
    pub expires_at: Option<DateTime<Utc>>,
}

/// A computer whose Claude Code runs on an account signed in through Macro:
/// its active Claude login.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeSignIn {
    /// The login (`harness_account_logins` row), where notices are recorded.
    pub login_id: Uuid,
    /// The computer.
    pub computer_id: ComputerId,
    /// Its harness, where the sign-in lives.
    pub harness_id: HarnessId,
    /// The team that owns the computer.
    pub team_id: Uuid,
    /// The computer's name as the team sees it.
    pub computer_name: String,
    /// Who signed Claude in through Macro; `None` once that user is deleted.
    pub signed_in_by: Option<MacroUserIdStr<'static>>,
    /// When the sign-in was recorded.
    pub signed_in_at: DateTime<Utc>,
    /// macrod's latest Claude report, if it sent one.
    pub report: Option<ClaudeReport>,
    /// When macrod sent `report`.
    pub reported_at: Option<DateTime<Utc>>,
    /// The last notice sent for this login.
    pub last_notice: Option<ClaudeSignInNotice>,
}

/// The notice `sign_in` is due at `now`, if any.
///
/// Only a report macrod sent after the sign-in counts: an older one describes
/// the account before it. A notice already sent for this sign-in and expiry at
/// the same or a later stage suppresses it, and nothing follows `Expired`
/// until someone signs in again.
pub fn due_notice(now: DateTime<Utc>, sign_in: &ClaudeSignIn) -> Option<ClaudeSignInNotice> {
    let reported_after_sign_in = sign_in
        .reported_at
        .is_some_and(|reported_at| reported_at > sign_in.signed_in_at);
    if !reported_after_sign_in {
        return None;
    }

    let (stage, expires_at) = match sign_in.report? {
        ClaudeReport::SignedOut => (ClaudeSignInStage::Expired, None),
        ClaudeReport::SignedIn { expires_at } => {
            let expires_at = expires_at?;
            let left = expires_at - now;
            let stage = if left <= Duration::zero() {
                ClaudeSignInStage::Expired
            } else if left <= EXPIRES_TODAY_WITHIN {
                ClaudeSignInStage::ExpiresToday
            } else if left <= EXPIRES_SOON_WITHIN {
                ClaudeSignInStage::ExpiresSoon
            } else {
                return None;
            };
            (stage, Some(expires_at))
        }
    };

    if let Some(last) = sign_in.last_notice
        && last.signed_in_at == sign_in.signed_in_at
    {
        if last.stage == ClaudeSignInStage::Expired {
            return None;
        }
        if last.expires_at == expires_at && last.stage >= stage {
            return None;
        }
    }

    Some(ClaudeSignInNotice {
        signed_in_at: sign_in.signed_in_at,
        stage,
        expires_at,
    })
}

/// A notice to deliver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeSignInExpiry {
    /// The computer.
    pub computer_id: ComputerId,
    /// Its harness.
    pub harness_id: HarnessId,
    /// The computer's name.
    pub computer_name: String,
    /// What to say.
    pub notice: ClaudeSignInNotice,
}

/// The computers to watch, and the notices already sent for them.
pub trait ClaudeSignIns: Send + Sync + 'static {
    /// Adapter failure type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Every live computer whose Claude Code runs on an account signed in
    /// through Macro.
    fn signed_in(&self) -> impl Future<Output = Result<Vec<ClaudeSignIn>, Self::Err>> + Send;

    /// Remember that `notice` went out for the login `login_id`.
    fn record_notice(
        &self,
        login_id: Uuid,
        notice: ClaudeSignInNotice,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Who hears about a sign-in, and telling them.
pub trait ClaudeSignInNotices: Send + Sync + 'static {
    /// Adapter failure type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The team's owner and admins.
    fn team_admins(
        &self,
        team_id: Uuid,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Self::Err>> + Send;

    /// Deliver `expiry` to `recipients`. Delivering the same expiry again
    /// must not notify twice.
    fn send(
        &self,
        expiry: ClaudeSignInExpiry,
        recipients: HashSet<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// What one pass did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ClaudeSignInPass {
    /// Computers looked at.
    pub checked: usize,
    /// Notices sent.
    pub notified: usize,
    /// Computers whose notice could not be sent or recorded; retried next pass.
    pub failed: usize,
}

/// Send every notice due at `now`. One computer's failure is logged and
/// counted, and the rest still get theirs.
#[tracing::instrument(
    name = "computer.claude_sign_in.check",
    skip_all,
    fields(checked, notified, failed),
    err
)]
pub async fn notify_due<SignIns, Notices>(
    now: DateTime<Utc>,
    sign_ins: &SignIns,
    notices: &Notices,
) -> Result<ClaudeSignInPass, SignIns::Err>
where
    SignIns: ClaudeSignIns,
    Notices: ClaudeSignInNotices,
{
    let watched = sign_ins.signed_in().await?;
    let mut pass = ClaudeSignInPass {
        checked: watched.len(),
        ..ClaudeSignInPass::default()
    };

    for sign_in in watched {
        let Some(notice) = due_notice(now, &sign_in) else {
            continue;
        };
        let span = tracing::info_span!(
            "computer.claude_sign_in.notify",
            computer_id = %sign_in.computer_id,
            team_id = %sign_in.team_id,
            stage = notice.stage.as_ref(),
        );
        let sent = notify(sign_in, notice, sign_ins, notices)
            .instrument(span)
            .await;
        if sent {
            pass.notified += 1;
        } else {
            pass.failed += 1;
        }
    }

    let span = tracing::Span::current();
    span.record("checked", pass.checked);
    span.record("notified", pass.notified);
    span.record("failed", pass.failed);
    Ok(pass)
}

/// Send and record one notice; `false` (logged) when either failed.
async fn notify<SignIns, Notices>(
    sign_in: ClaudeSignIn,
    notice: ClaudeSignInNotice,
    sign_ins: &SignIns,
    notices: &Notices,
) -> bool
where
    SignIns: ClaudeSignIns,
    Notices: ClaudeSignInNotices,
{
    let computer_id = sign_in.computer_id;
    let admins = match notices.team_admins(sign_in.team_id).await {
        Ok(admins) => admins,
        Err(error) => {
            tracing::error!(%computer_id, error = ?error, "could not read a computer's team admins");
            return false;
        }
    };
    let mut recipients: HashSet<_> = sign_in.signed_in_by.into_iter().collect();
    recipients.extend(admins);

    let expiry = ClaudeSignInExpiry {
        computer_id,
        harness_id: sign_in.harness_id,
        computer_name: sign_in.computer_name,
        notice,
    };
    if let Err(error) = notices.send(expiry, recipients).await {
        tracing::error!(%computer_id, error = ?error, "could not send a Claude sign-in notice");
        return false;
    }
    if let Err(error) = sign_ins.record_notice(sign_in.login_id, notice).await {
        tracing::error!(%computer_id, error = ?error, "could not record a Claude sign-in notice");
        return false;
    }
    true
}
