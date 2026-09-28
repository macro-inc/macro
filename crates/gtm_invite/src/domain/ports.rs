//! Port definitions for the GTM invite domain.
//!
//! These traits define the contracts that adapters must implement.

use std::future::Future;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::models::{
    CreateInviteLink, GtmInviteConfig, GtmInviteError, InviteLink, InviteToken, ListInviteLinks,
};

/// Repository for invite links.
///
/// All methods perform database operations — SQL queries are written
/// directly in the outbound adapter implementation.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait GtmInviteRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// Stores a freshly created link.
    fn insert_link(&self, link: &InviteLink) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Looks a link up by the token in its URL.
    fn get_link_by_token(
        &self,
        token: &InviteToken,
    ) -> impl Future<Output = Result<Option<InviteLink>, Self::Err>> + Send;

    /// Looks a link up by primary key.
    fn get_link_by_id(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<InviteLink>, Self::Err>> + Send;

    /// Lists links newest first, optionally scoped to one creator.
    fn list_links(
        &self,
        filter: &ListInviteLinks,
    ) -> impl Future<Output = Result<Vec<InviteLink>, Self::Err>> + Send;

    /// Counts a welcome-page open of the link.
    fn record_open(
        &self,
        id: Uuid,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Revokes an unredeemed, unrevoked link. Returns whether a row changed.
    fn revoke_link(
        &self,
        id: Uuid,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Atomically attributes the link to `user_id` if it is still open to be
    /// redeemed (or was already redeemed by the same user). Returns the
    /// updated link, or `None` when another account holds it or its window
    /// closed.
    fn redeem_link<'a>(
        &self,
        id: Uuid,
        user_id: &MacroUserIdStr<'a>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<InviteLink>, Self::Err>> + Send;

    /// The link `user_id` signed up through, if any.
    fn get_redeemed_link_for_user<'a>(
        &self,
        user_id: &MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<Option<InviteLink>, Self::Err>> + Send;

    /// Records that the user's redeemed link turned into a paid subscription.
    /// Returns whether a row changed.
    fn mark_converted<'a>(
        &self,
        user_id: &MacroUserIdStr<'a>,
        stripe_subscription_id: &str,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Service interface for invite link operations.
///
/// Orchestrates business logic using the repository.
pub trait GtmInviteService: Send + Sync + 'static {
    /// The offer configuration links are created with.
    fn config(&self) -> &GtmInviteConfig;

    /// Creates a link. Only Macro staff may create links.
    fn create_link(
        &self,
        creator: &MacroUserIdStr<'_>,
        request: CreateInviteLink,
    ) -> impl Future<Output = Result<InviteLink, GtmInviteError>> + Send;

    /// Lists links for the dashboard. Only Macro staff may list links.
    fn list_links(
        &self,
        caller: &MacroUserIdStr<'_>,
        only_mine: bool,
    ) -> impl Future<Output = Result<Vec<InviteLink>, GtmInviteError>> + Send;

    /// Revokes a link nobody has signed up through. Only Macro staff may revoke.
    fn revoke_link(
        &self,
        caller: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> impl Future<Output = Result<InviteLink, GtmInviteError>> + Send;

    /// Resolves a link for the public welcome page and counts the open.
    fn resolve_link(
        &self,
        token: &InviteToken,
    ) -> impl Future<Output = Result<InviteLink, GtmInviteError>> + Send;

    /// Attributes the signed-in user's account to the link and grants them
    /// its offer. Idempotent for the same user.
    fn redeem_link(
        &self,
        token: &InviteToken,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<InviteLink, GtmInviteError>> + Send;

    /// The redeemed link whose offer the user has not yet used at checkout.
    fn active_offer_for_user(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<InviteLink>, GtmInviteError>> + Send;

    /// Records the user's redeemed link as converted into a paid
    /// subscription. Returns whether the user held a redeemed link.
    fn mark_converted(
        &self,
        user: &MacroUserIdStr<'_>,
        stripe_subscription_id: &str,
    ) -> impl Future<Output = Result<bool, GtmInviteError>> + Send;
}
