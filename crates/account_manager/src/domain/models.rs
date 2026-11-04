//! Domain models for account managers.

use std::time::Duration;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// How long a request can wait for a response, and an approval for its claim.
pub const RESPONSE_WINDOW: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// Message tag that renders a grant's card. Mirrors `ACCOUNT_MANAGER_REQUEST_TAG`
/// in `packages/lexical-core`.
pub const CARD_TAG: &str = "m-account-manager-request";

/// One side of a grant.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::Display, strum::EnumString,
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
pub enum AccountManagerRole {
    /// The account being managed.
    Managed,
    /// The agent account doing the managing.
    Manager,
}

/// Where a grant is in its lifecycle.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::Display, strum::EnumString,
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
pub enum AccountManagerGrantStatus {
    /// Waiting for the side that didn't ask.
    Pending,
    /// Approved, with the credential not yet claimed.
    Approved,
    /// The side that didn't ask said no.
    Declined,
    /// The credential is claimed and works.
    Active,
    /// Withdrawn, or the credential no longer works.
    Revoked,
    /// Nobody responded or claimed in time.
    Expired,
}

/// A request for manager access and what became of it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AccountManagerGrant {
    /// Grant id.
    pub id: Uuid,
    /// The account being managed.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub managed_user_id: MacroUserIdStr<'static>,
    /// The agent account doing the managing.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub manager_user_id: MacroUserIdStr<'static>,
    /// The side that asked.
    pub requested_by: AccountManagerRole,
    /// Lifecycle status.
    pub status: AccountManagerGrantStatus,
    /// When the pending request or unclaimed approval stops being usable.
    pub expires_at: Option<DateTime<Utc>>,
    /// When the request was made.
    pub created_at: DateTime<Utc>,
    /// When the manager claimed the credential.
    pub claimed_at: Option<DateTime<Utc>>,
    /// When the credential was last used, to the minute.
    pub last_used_at: Option<DateTime<Utc>>,
}

impl AccountManagerGrant {
    /// The side `user` is on, or `None` when they aren't part of this grant.
    pub fn role_of(&self, user: &MacroUserIdStr<'_>) -> Option<AccountManagerRole> {
        if user.as_ref() == self.managed_user_id.as_ref() {
            return Some(AccountManagerRole::Managed);
        }

        if user.as_ref() == self.manager_user_id.as_ref() {
            return Some(AccountManagerRole::Manager);
        }

        None
    }

    /// The account that may respond: whichever side didn't ask.
    pub fn responder(&self) -> &MacroUserIdStr<'static> {
        match self.requested_by {
            AccountManagerRole::Managed => &self.manager_user_id,
            AccountManagerRole::Manager => &self.managed_user_id,
        }
    }

    /// Show a lapsed request or approval as expired, before anything has
    /// written that down.
    pub fn at(mut self, now: DateTime<Utc>) -> Self {
        let lapsed = self.expires_at.is_some_and(|expires_at| expires_at <= now);
        let open = matches!(
            self.status,
            AccountManagerGrantStatus::Pending | AccountManagerGrantStatus::Approved
        );

        if lapsed && open {
            self.status = AccountManagerGrantStatus::Expired;
        }

        self
    }
}

/// A response to a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum AccountManagerDecision {
    /// Grant access.
    Approve,
    /// Refuse access.
    Decline,
}

/// Errors returned by the account manager service.
#[derive(Debug, thiserror::Error)]
pub enum AccountManagerError {
    /// The grant doesn't exist, or the caller isn't part of it.
    #[error("account manager grant not found")]
    NotFound,
    /// The caller is part of the grant but it isn't theirs to do this to.
    #[error("{0}")]
    Forbidden(&'static str),
    /// The grant has moved on, for example it expired or was already claimed.
    #[error("{0}")]
    Conflict(&'static str),
    /// The request was invalid.
    #[error("{0}")]
    BadRequest(&'static str),
    /// Any other internal error.
    #[error("internal account manager error: {0:?}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for AccountManagerError {
    fn from(report: rootcause::Report) -> Self {
        AccountManagerError::Internal(report)
    }
}
