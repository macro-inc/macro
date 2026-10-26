//! Port definitions for the referral domain.
//!
//! These traits define the contracts that adapters must implement.

use macro_user_id::{
    email::EmailStr,
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use std::future::Future;

use crate::domain::models::{ReferralCode, ReferralError, TrackedReferral};

/// Repository for accessing referral data from the database.
///
/// All methods perform database operations — SQL queries are written
/// directly in the outbound adapter implementation.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait ReferralRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// Gets the referral code for the user
    /// This is generated from the users FusionAuth user id
    fn get_referral_code_for_user<'a>(
        &self,
        user_id: &MacroUserId<Lowercase<'a>>,
    ) -> impl Future<Output = Result<ReferralCode, Self::Err>> + Send;

    /// Records that `referral_code` referred the user. Returns `None` when the
    /// user was already referred, so a referral is only ever recorded once.
    fn track_referral<'a>(
        &self,
        referred_user_id: &MacroUserId<Lowercase<'a>>,
        referral_code: &ReferralCode,
    ) -> impl Future<Output = Result<Option<TrackedReferral>, Self::Err>> + Send;

    /// Completes a referral
    fn complete_referral<'a>(
        &self,
        referred_user_id: &MacroUserId<Lowercase<'a>>,
        referral_code: &ReferralCode,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Gets the sender's profile picture URL and display name in a single query.
    /// Returns `(profile_picture_url, display_name)`, either of which may be `None`.
    fn get_sender_info<'a>(
        &self,
        user_id: &MacroUserId<Lowercase<'a>>,
    ) -> impl Future<Output = Result<(Option<String>, Option<String>), Self::Err>> + Send;
}

/// Rewards a referrer when someone signs up through their link.
#[cfg_attr(test, mockall::automock)]
pub trait ReferralRewarder: Send + Sync + 'static {
    /// Rewards `referrer` for `referred`. `event_key` identifies the
    /// referral, so a retry never pays twice.
    fn reward_referrer(
        &self,
        referrer: MacroUserIdStr<'static>,
        referred: MacroUserIdStr<'static>,
        event_key: String,
    ) -> impl Future<Output = Result<(), anyhow::Error>> + Send;
}

/// Service interface for referral operations.
///
/// Orchestrates business logic using the repository and external services.
pub trait ReferralService: Send + Sync + 'static {
    /// Gets the referral code for the user
    fn get_referral_code_for_user<'a>(
        &self,
        user_id: &MacroUserId<Lowercase<'a>>,
    ) -> impl Future<Output = Result<ReferralCode, ReferralError>> + Send;

    /// Records that a new user signed up with `referral_code` and rewards the
    /// referrer. A user can only be referred once.
    fn track_referral<'a>(
        &self,
        referred_user_id: &MacroUserId<Lowercase<'a>>,
        referral_code: &ReferralCode,
    ) -> impl Future<Output = Result<(), ReferralError>> + Send;

    /// Send a referral to an external user via email
    fn send_referral_invite(
        &self,
        sending_user: MacroUserIdStr<'_>,
        recipient: EmailStr<'static>,
    ) -> impl Future<Output = Result<(), ReferralError>> + Send;
}
