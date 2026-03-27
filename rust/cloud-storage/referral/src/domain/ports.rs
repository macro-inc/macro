//! Port definitions for the referral domain.
//!
//! These traits define the contracts that adapters must implement.

use macro_user_id::{
    email::EmailStr,
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use std::future::Future;

use crate::domain::models::{ReferralCode, ReferralError};

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

    /// Tracks a referral
    fn track_referral<'a>(
        &self,
        referred_user_id: &MacroUserId<Lowercase<'a>>,
        referral_code: &ReferralCode,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Completes a referral
    fn complete_referral<'a>(
        &self,
        referred_user_id: &MacroUserId<Lowercase<'a>>,
        referral_code: &ReferralCode,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Gets the referral code of the user who referred the given user, if any
    fn get_referred_by(
        &self,
        referred_user_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<Option<ReferralCode>, Self::Err>> + Send;

    /// Gets the referrs customer id using their code
    fn get_referrers_customer_id(
        &self,
        referral_code: &ReferralCode,
    ) -> impl Future<Output = Result<String, Self::Err>> + Send;

    /// Gets the sender's profile picture URL and display name in a single query.
    /// Returns `(profile_picture_url, display_name)`, either of which may be `None`.
    fn get_sender_info<'a>(
        &self,
        user_id: &MacroUserId<Lowercase<'a>>,
    ) -> impl Future<Output = Result<(Option<String>, Option<String>), Self::Err>> + Send;
}

/// Repository to handle applying discounts to the referrer when a referral is
/// completed
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait DiscountClient: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// Applies the discount to the referrer
    fn apply_discount(
        &self,
        referrer_customer_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
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

    /// Starts tracking the referral
    /// The referral is completed when the user pays through stripe
    fn track_referral<'a>(
        &self,
        referred_user_id: &MacroUserId<Lowercase<'a>>,
        referral_code: &ReferralCode,
    ) -> impl Future<Output = Result<(), ReferralError>> + Send;

    /// Gets the referral code of the user who referred the given user, if any
    fn get_referred_by(
        &self,
        referred_user_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<Option<ReferralCode>, ReferralError>> + Send;

    /// Processes a referral
    /// - tracks the referral
    /// - assigns the discount to the referrers' stripe
    fn process_referral<'a>(
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
