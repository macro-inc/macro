//! Wire types for the invite link endpoints.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::domain::models::{CreateInviteLink, InviteLink, InviteLinkStatus};

/// Where a link is in its lifecycle.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum GtmInviteLinkStatus {
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

impl From<InviteLinkStatus> for GtmInviteLinkStatus {
    fn from(status: InviteLinkStatus) -> Self {
        match status {
            InviteLinkStatus::Active => Self::Active,
            InviteLinkStatus::Expired => Self::Expired,
            InviteLinkStatus::Revoked => Self::Revoked,
            InviteLinkStatus::Redeemed => Self::Redeemed,
            InviteLinkStatus::Converted => Self::Converted,
        }
    }
}

/// A link as shown on the staff dashboard.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GtmInviteLink {
    /// Primary key.
    pub id: Uuid,
    /// The secret to embed in the link URL.
    pub token: String,
    /// The recipient's first name.
    pub first_name: String,
    /// The recipient's email, when known.
    pub recipient_email: Option<String>,
    /// Internal note.
    pub note: Option<String>,
    /// The Stripe promotion code applied at checkout.
    pub promo_code: String,
    /// Free months the promotion grants.
    pub free_months: u8,
    /// Lifecycle status.
    pub status: GtmInviteLinkStatus,
    /// The Macro user id of the staff member who created the link.
    pub created_by: String,
    /// When the link was created.
    pub created_at: DateTime<Utc>,
    /// When the link stops being openable.
    pub expires_at: DateTime<Utc>,
    /// When staff revoked the link.
    pub revoked_at: Option<DateTime<Utc>>,
    /// How many times the welcome page loaded.
    pub open_count: i32,
    /// When the welcome page first loaded.
    pub first_opened_at: Option<DateTime<Utc>>,
    /// The Macro user id of the account that signed up through the link.
    pub redeemed_by: Option<String>,
    /// When that account redeemed the link.
    pub redeemed_at: Option<DateTime<Utc>>,
    /// When the account started a paid subscription.
    pub converted_at: Option<DateTime<Utc>>,
    /// The Stripe subscription id of that subscription.
    pub stripe_subscription_id: Option<String>,
}

impl GtmInviteLink {
    /// Flattens a domain link for the dashboard.
    pub fn from_link(link: InviteLink, free_months: u8, now: DateTime<Utc>) -> Self {
        let status = link.status(now).into();
        let (redeemed_by, redeemed_at, converted_at, stripe_subscription_id) = match link.redemption
        {
            Some(redemption) => {
                let (converted_at, stripe_subscription_id) = match redemption.conversion {
                    Some(conversion) => (
                        Some(conversion.converted_at),
                        conversion.stripe_subscription_id,
                    ),
                    None => (None, None),
                };
                (
                    Some(redemption.user_id.as_ref().to_owned()),
                    Some(redemption.redeemed_at),
                    converted_at,
                    stripe_subscription_id,
                )
            }
            None => (None, None, None, None),
        };
        Self {
            id: link.id,
            token: link.token.to_string(),
            first_name: link.first_name,
            recipient_email: link.recipient_email,
            note: link.note,
            promo_code: link.promo_code.to_string(),
            free_months,
            status,
            created_by: link.created_by.as_ref().to_owned(),
            created_at: link.created_at,
            expires_at: link.expires_at,
            revoked_at: link.revoked_at,
            open_count: link.open_count,
            first_opened_at: link.first_opened_at,
            redeemed_by,
            redeemed_at,
            converted_at,
            stripe_subscription_id,
        }
    }
}

/// Request body to create a link.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateGtmInviteLinkRequest {
    /// The recipient's first name, shown on the welcome page.
    pub first_name: String,
    /// The recipient's email, when the sender knows it.
    #[serde(default)]
    pub recipient_email: Option<String>,
    /// Free-form internal note for the dashboard.
    #[serde(default)]
    pub note: Option<String>,
}

impl From<CreateGtmInviteLinkRequest> for CreateInviteLink {
    fn from(request: CreateGtmInviteLinkRequest) -> Self {
        Self {
            first_name: request.first_name,
            recipient_email: request.recipient_email,
            note: request.note,
        }
    }
}

/// Query parameters for listing links.
#[derive(Debug, Default, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct ListGtmInviteLinksQuery {
    /// Only the caller's own links (default: every staff member's).
    #[serde(default)]
    pub mine: bool,
}

/// Links for the dashboard.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GtmInviteLinkList {
    /// Newest first.
    pub links: Vec<GtmInviteLink>,
}

/// What the public welcome page learns about a link.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicGtmInviteLink {
    /// The recipient's first name.
    pub first_name: String,
    /// Whether the link can still be used.
    pub status: GtmInviteLinkStatus,
    /// Free months the promotion grants.
    pub free_months: u8,
}

/// Request body to redeem a link.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RedeemGtmInviteLinkRequest {
    /// The token from the link URL.
    pub token: String,
}

/// The promotion a signed-in user's account holds.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GtmInviteOffer {
    /// The redeemed link.
    pub link_id: Uuid,
    /// The first name the link was made out to.
    pub first_name: String,
    /// The Stripe promotion code checkout applies.
    pub promo_code: String,
    /// Free months the promotion grants.
    pub free_months: u8,
    /// When the account redeemed the link.
    pub redeemed_at: DateTime<Utc>,
}

impl GtmInviteOffer {
    /// The offer carried by a redeemed link, or `None` for an unredeemed one.
    pub fn from_link(link: InviteLink, free_months: u8) -> Option<Self> {
        let redemption = link.redemption?;
        Some(Self {
            link_id: link.id,
            first_name: link.first_name,
            promo_code: link.promo_code.to_string(),
            free_months,
            redeemed_at: redemption.redeemed_at,
        })
    }
}

/// Whether the signed-in user holds an unused offer.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GtmInviteOfferStatus {
    /// The offer, when the account redeemed a link and has not subscribed yet.
    pub offer: Option<GtmInviteOffer>,
}
