//! Requests to join a private or team channel.
//!
//! A request is announced in the channel's timeline and to every participant,
//! and any participant may answer it. Approval adds the requester as a member.

use crate::domain::models::ChannelType;
use chrono::{DateTime, TimeDelta, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Wait after an attempt before asking again, so withdrawing and re-asking
/// cannot flood a channel with announcements.
pub const REQUEST_COOLDOWN: TimeDelta = TimeDelta::seconds(60);
/// Wait after a denial before the same person may ask again.
pub const DENIAL_COOLDOWN: TimeDelta = TimeDelta::hours(24);

/// Outcome of one attempt to join.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ChannelAccessRequestStatus {
    /// Awaiting a participant's answer.
    Pending,
    /// A participant added the requester.
    Approved,
    /// A participant declined.
    Denied,
    /// The requester withdrew it.
    Cancelled,
}

/// One attempt to join a channel. Attempts are never reused, so each timeline
/// entry keeps showing the outcome of the attempt it announced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ChannelAccessRequest {
    /// Attempt id.
    pub id: Uuid,
    /// Channel the requester asked to join.
    pub channel_id: Uuid,
    /// Person asking to join.
    pub requester_id: MacroUserIdStr<'static>,
    /// Current outcome.
    pub status: ChannelAccessRequestStatus,
    /// When the requester asked.
    pub created_at: DateTime<Utc>,
    /// When the attempt stopped being pending.
    pub resolved_at: Option<DateTime<Utc>>,
    /// Participant who approved or denied it.
    pub resolved_by: Option<MacroUserIdStr<'static>>,
}

impl ChannelAccessRequest {
    /// Earliest time the requester may ask again after this attempt. A pending
    /// attempt is answered by replaying it, and approval leaves no wait.
    pub fn retry_after(&self) -> Option<DateTime<Utc>> {
        match self.status {
            ChannelAccessRequestStatus::Pending | ChannelAccessRequestStatus::Approved => None,
            ChannelAccessRequestStatus::Cancelled => Some(self.created_at + REQUEST_COOLDOWN),
            ChannelAccessRequestStatus::Denied => self
                .resolved_at
                .map(|resolved_at| resolved_at + DENIAL_COOLDOWN),
        }
    }
}

/// Whether people outside a channel may ask to join it. Public channels are
/// already open and direct messages never gain members.
pub fn accepts_requests(channel_type: ChannelType) -> bool {
    match channel_type {
        ChannelType::Private | ChannelType::Team => true,
        ChannelType::Public | ChannelType::DirectMessage => false,
    }
}

/// A requester's view of their access to a channel they cannot read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ChannelAccessRequestState {
    /// The caller's latest attempt, if any.
    pub request: Option<ChannelAccessRequest>,
    /// Whether this channel accepts requests.
    pub can_request: bool,
    /// Earliest time the caller may ask again, while they must wait.
    pub retry_after: Option<DateTime<Utc>>,
}

/// A participant's answer to a pending request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ChannelAccessDecision {
    /// Add the requester to the channel.
    Approve,
    /// Decline the request.
    Deny,
}

/// Body of a participant's answer.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ResolveChannelAccessRequest {
    /// The answer.
    pub decision: ChannelAccessDecision,
}

/// A resolved attempt and whether approving it added a member. A requester
/// who already joined some other way is not added again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedChannelAccessRequest {
    /// The attempt after resolution.
    pub request: ChannelAccessRequest,
    /// Whether the requester became an active participant.
    pub joined: bool,
}

/// Access request failures, translated to HTTP only at the inbound boundary.
#[derive(Debug, thiserror::Error)]
pub enum ChannelAccessRequestErr {
    /// The channel does not exist.
    #[error("channel not found")]
    ChannelNotFound,
    /// The attempt does not exist in this channel.
    #[error("access request not found")]
    NotFound,
    /// This channel or person cannot use requests.
    #[error("{0}")]
    NotRequestable(&'static str),
    /// The caller may not answer this request.
    #[error("you cannot answer your own request")]
    Forbidden,
    /// Someone answered or withdrew the request first.
    #[error("this request was already answered")]
    Conflict,
    /// The requester must wait before asking again.
    #[error("you can ask to join again after {0}")]
    Cooldown(DateTime<Utc>),
    /// Persistence failed.
    #[error(transparent)]
    Repo(anyhow::Error),
}

#[cfg(feature = "ports")]
pub use ports::*;

#[cfg(feature = "ports")]
mod ports {
    use super::*;
    use crate::domain::models::ChannelInfo;
    use entity_access::domain::models::{EntityAccessReceipt, MemberParticipantRole};

    /// Persistence for channel access requests.
    pub trait ChannelAccessRequestRepo: Send + Sync + 'static {
        /// Channel facts, or `None` when the channel does not exist.
        fn find_channel_info(
            &self,
            channel_id: Uuid,
        ) -> impl Future<Output = anyhow::Result<Option<ChannelInfo>>> + Send;

        /// The requester's most recent attempt to join.
        fn latest_access_request(
            &self,
            channel_id: Uuid,
            requester: &MacroUserIdStr<'static>,
        ) -> impl Future<Output = anyhow::Result<Option<ChannelAccessRequest>>> + Send;

        /// One attempt in this channel.
        fn get_access_request(
            &self,
            channel_id: Uuid,
            request_id: Uuid,
        ) -> impl Future<Output = anyhow::Result<Option<ChannelAccessRequest>>> + Send;

        /// Store a pending attempt. When the requester already has one, return
        /// that attempt and `false` instead.
        fn create_access_request(
            &self,
            request: &ChannelAccessRequest,
        ) -> impl Future<Output = anyhow::Result<(ChannelAccessRequest, bool)>> + Send;

        /// Withdraw the requester's pending attempt, returning it when one existed.
        fn cancel_access_request(
            &self,
            channel_id: Uuid,
            requester: &MacroUserIdStr<'static>,
            at: DateTime<Utc>,
        ) -> impl Future<Output = anyhow::Result<Option<ChannelAccessRequest>>> + Send;

        /// Answer a pending attempt. Approval adds the requester as a member in
        /// the same transaction. Returns `None` when the attempt is not pending.
        fn resolve_access_request(
            &self,
            channel_id: Uuid,
            request_id: Uuid,
            resolver: &MacroUserIdStr<'static>,
            decision: ChannelAccessDecision,
            at: DateTime<Utc>,
        ) -> impl Future<Output = anyhow::Result<Option<ResolvedChannelAccessRequest>>> + Send;
    }

    /// Requesting, withdrawing, and answering requests to join a channel.
    pub trait ChannelAccessRequestService: Send + Sync + 'static {
        /// The caller's latest attempt and whether they may ask now. Needs no
        /// access to the channel.
        fn my_access_request(
            &self,
            user: MacroUserIdStr<'static>,
            channel_id: Uuid,
        ) -> impl Future<Output = Result<ChannelAccessRequestState, ChannelAccessRequestErr>> + Send;

        /// Ask to join. Replaying a pending attempt returns it unchanged.
        fn request_access(
            &self,
            user: MacroUserIdStr<'static>,
            channel_id: Uuid,
        ) -> impl Future<Output = Result<ChannelAccessRequest, ChannelAccessRequestErr>> + Send;

        /// Withdraw the caller's pending attempt; having none is not an error.
        fn cancel_access_request(
            &self,
            user: MacroUserIdStr<'static>,
            channel_id: Uuid,
        ) -> impl Future<Output = Result<(), ChannelAccessRequestErr>> + Send;

        /// An attempt to join a channel the caller participates in.
        fn get_access_request(
            &self,
            access: EntityAccessReceipt<MemberParticipantRole>,
            request_id: Uuid,
        ) -> impl Future<Output = Result<ChannelAccessRequest, ChannelAccessRequestErr>> + Send;

        /// Approve or deny a pending attempt as a participant.
        fn resolve_access_request(
            &self,
            access: EntityAccessReceipt<MemberParticipantRole>,
            request_id: Uuid,
            decision: ChannelAccessDecision,
        ) -> impl Future<Output = Result<ChannelAccessRequest, ChannelAccessRequestErr>> + Send;
    }
}
