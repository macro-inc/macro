//! Domain models for GTM invite links.

use std::{fmt, str::FromStr};

use chrono::{DateTime, Duration, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use rand::{Rng, distr::Alphanumeric};
use rate_limit::RateLimitExceeded;
use uuid::Uuid;

/// Number of characters in a generated invite token.
pub const INVITE_TOKEN_LENGTH: usize = 32;
const MIN_INVITE_TOKEN_LENGTH: usize = 16;
const MAX_INVITE_TOKEN_LENGTH: usize = 64;
const MAX_PROMO_CODE_LENGTH: usize = 64;
/// Longest accepted first name on a link.
pub const MAX_FIRST_NAME_LENGTH: usize = 80;
/// Longest accepted internal note on a link.
pub const MAX_NOTE_LENGTH: usize = 500;

/// Errors that can occur during invite link operations.
#[derive(Debug, thiserror::Error)]
pub enum GtmInviteError {
    /// A rate limit was exceeded.
    #[error("rate limit exceeded")]
    RateLimitExceeded(#[from] RateLimitExceeded),
    /// No link exists for the given token or id.
    #[error("invite link not found")]
    NotFound,
    /// The caller is not Macro staff.
    #[error("only Macro staff can manage invite links")]
    Forbidden,
    /// The link's 48-hour window has passed.
    #[error("this invite link has expired")]
    Expired,
    /// The link was revoked by staff.
    #[error("this invite link has been revoked")]
    Revoked,
    /// Another account already signed up through this link.
    #[error("this invite link was already used by another account")]
    AlreadyRedeemed,
    /// The token does not have the shape of a generated token.
    #[error("invalid invite token")]
    InvalidToken,
    /// The request was malformed.
    #[error("bad request: {0}")]
    BadRequest(String),
    /// An internal error occurred.
    #[error("{0}")]
    Internal(#[from] anyhow::Error),
}

/// The opaque secret carried in an invite link URL.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct InviteToken(String);

impl InviteToken {
    /// Generate a fresh, cryptographically random token.
    pub fn generate() -> Self {
        let token: String = rand::rng()
            .sample_iter(Alphanumeric)
            .take(INVITE_TOKEN_LENGTH)
            .map(char::from)
            .collect();
        Self(token)
    }

    /// The token as a string slice.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl FromStr for InviteToken {
    type Err = GtmInviteError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let valid_length = (MIN_INVITE_TOKEN_LENGTH..=MAX_INVITE_TOKEN_LENGTH).contains(&s.len());
        let valid_chars = s
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'));
        if valid_length && valid_chars {
            Ok(Self(s.to_owned()))
        } else {
            Err(GtmInviteError::InvalidToken)
        }
    }
}

impl fmt::Display for InviteToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A promo code is not a valid Stripe promotion code.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error("promo code must be 1-64 characters of letters, digits, '-' or '_'")]
pub struct InvalidPromoCode;

/// A Stripe promotion code such as `1MF`, as customers type it at checkout.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct PromoCode(String);

impl PromoCode {
    /// The code as a string slice.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl FromStr for PromoCode {
    type Err = InvalidPromoCode;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let trimmed = s.trim();
        let valid_length = (1..=MAX_PROMO_CODE_LENGTH).contains(&trimmed.len());
        let valid_chars = trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'));
        if valid_length && valid_chars {
            Ok(Self(trimmed.to_owned()))
        } else {
            Err(InvalidPromoCode)
        }
    }
}

impl fmt::Display for PromoCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Static configuration for the offer every link carries.
#[derive(Clone, Debug)]
pub struct GtmInviteConfig {
    /// The Stripe promotion code applied at checkout for redeemed links.
    pub promo_code: PromoCode,
    /// How long a link can be opened and redeemed after it is created.
    pub link_ttl: Duration,
    /// Number of free months the promotion grants, for user-facing copy.
    pub free_months: u8,
}

/// What Macro staff supply to create a link.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreateInviteLink {
    /// The recipient's first name, shown on the welcome page.
    pub first_name: String,
    /// The recipient's email, when the sender knows it.
    pub recipient_email: Option<String>,
    /// Free-form internal note (company, context) for the dashboard.
    pub note: Option<String>,
}

/// Filter for listing links on the dashboard.
#[derive(Clone, Debug)]
pub struct ListInviteLinks {
    /// Restrict to links created by this user.
    pub created_by: Option<MacroUserIdStr<'static>>,
    /// Maximum number of links to return, newest first.
    pub limit: i64,
}

/// The Stripe subscription that a redeemed link converted into.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InviteConversion {
    /// When the subscription became active.
    pub converted_at: DateTime<Utc>,
    /// The Stripe subscription id, when known.
    pub stripe_subscription_id: Option<String>,
}

/// The account that signed up through a link.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InviteRedemption {
    /// The user who redeemed the link.
    pub user_id: MacroUserIdStr<'static>,
    /// When the link was redeemed.
    pub redeemed_at: DateTime<Utc>,
    /// The paid subscription the redemption turned into, once it did.
    pub conversion: Option<InviteConversion>,
}

/// A stored invite link.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InviteLink {
    /// Primary key.
    pub id: Uuid,
    /// The secret embedded in the link URL.
    pub token: InviteToken,
    /// The recipient's first name.
    pub first_name: String,
    /// The recipient's email, when known.
    pub recipient_email: Option<String>,
    /// Internal note for the dashboard.
    pub note: Option<String>,
    /// The promotion applied when the recipient checks out.
    pub promo_code: PromoCode,
    /// The staff member who created the link.
    pub created_by: MacroUserIdStr<'static>,
    /// When the link was created.
    pub created_at: DateTime<Utc>,
    /// When the link stops being openable and redeemable.
    pub expires_at: DateTime<Utc>,
    /// When staff revoked the link, if they did.
    pub revoked_at: Option<DateTime<Utc>>,
    /// How many times the welcome page resolved this link.
    pub open_count: i32,
    /// When the welcome page first resolved this link.
    pub first_opened_at: Option<DateTime<Utc>>,
    /// The signup attributed to this link, once there is one.
    pub redemption: Option<InviteRedemption>,
}

/// Where a link is in its lifecycle, derived at read time.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InviteLinkStatus {
    /// Openable and redeemable.
    Active,
    /// The window passed without a signup.
    Expired,
    /// Staff revoked it before anyone signed up.
    Revoked,
    /// Someone signed up through it; no paid subscription yet.
    Redeemed,
    /// The signup turned into a paid subscription.
    Converted,
}

impl InviteLinkStatus {
    /// The status in its wire spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Expired => "expired",
            Self::Revoked => "revoked",
            Self::Redeemed => "redeemed",
            Self::Converted => "converted",
        }
    }
}

impl fmt::Display for InviteLinkStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A string is not an [`InviteLinkStatus`].
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error("unknown invite link status: {0}")]
pub struct UnknownInviteLinkStatus(pub String);

impl FromStr for InviteLinkStatus {
    type Err = UnknownInviteLinkStatus;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "active" => Ok(Self::Active),
            "expired" => Ok(Self::Expired),
            "revoked" => Ok(Self::Revoked),
            "redeemed" => Ok(Self::Redeemed),
            "converted" => Ok(Self::Converted),
            other => Err(UnknownInviteLinkStatus(other.to_owned())),
        }
    }
}

impl InviteLink {
    /// The link's lifecycle status as of `now`.
    ///
    /// A redemption outranks expiry and revocation: a recipient who signed
    /// up keeps their attribution even after the window closes.
    pub fn status(&self, now: DateTime<Utc>) -> InviteLinkStatus {
        match &self.redemption {
            Some(redemption) if redemption.conversion.is_some() => InviteLinkStatus::Converted,
            Some(_) => InviteLinkStatus::Redeemed,
            None if self.revoked_at.is_some() => InviteLinkStatus::Revoked,
            None if now >= self.expires_at => InviteLinkStatus::Expired,
            None => InviteLinkStatus::Active,
        }
    }

    /// Whether this link was redeemed by `user`.
    pub fn is_redeemed_by(&self, user: &MacroUserIdStr<'_>) -> bool {
        self.redemption
            .as_ref()
            .is_some_and(|redemption| redemption.user_id.as_ref() == user.as_ref())
    }
}
