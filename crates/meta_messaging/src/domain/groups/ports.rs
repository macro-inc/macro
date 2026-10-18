//! Narrow capabilities for the group lifecycle, supplied by the existing adapters.

use super::*;
use crate::domain::{
    connection::{AccessToken, Connection},
    ports::PortResult,
};
use async_trait::async_trait;
use uuid::Uuid;

/// Required native permission for an external control.
#[derive(Clone, Copy)]
pub enum GroupPermission {
    /// Native message posting.
    Reply,
    /// Native participant admin.
    Remove,
    /// Native channel owner.
    Delete,
}

/// Group-owned state, with current-attempt and authorization generation fencing.
#[async_trait]
pub trait GroupRepository: Send + Sync {
    /// Current unbound attempt for a native channel.
    async fn group_attempt(&self, channel: Uuid) -> PortResult<Option<GroupAttempt>>;
    /// Completed creation for this channel, account and authorization generation.
    /// Only signed bindings with retained creation evidence qualify.
    async fn completed_group(
        &self,
        connection: &Connection,
        channel: Uuid,
    ) -> PortResult<Option<GroupSetup>>;
    /// Replace only a settled failed/unknown attempt; never an in-flight request.
    async fn retry_group(&self, connection: &Connection, channel: Uuid)
    -> PortResult<GroupAttempt>;
    /// Save one result only if its attempt/generation still owns the binding.
    async fn finish_group_create(
        &self,
        connection: &Connection,
        attempt: &GroupAttempt,
        result: GroupCreateResult,
    ) -> PortResult<()>;
    /// Current confirmed members, bounded by the provider's group size.
    async fn group_participants(&self, channel: Uuid) -> PortResult<Vec<GroupParticipant>>;
    /// Fetch a bound, non-deleted group's link after domain authorization.
    async fn group_link(&self, channel: Uuid) -> PortResult<GroupInviteLink>;
    /// Resolve an incoming group without adopting unknown groups.
    async fn group_channel(
        &self,
        connection: &Connection,
        group: &ProviderId,
    ) -> PortResult<Option<Uuid>>;
    /// Mark confirmed deletion before native deletion, preserving the send fence.
    async fn confirm_group_deleted(&self, connection: &Connection, channel: Uuid)
    -> PortResult<()>;
}

/// Official provider group operations. No automatic retry is performed here.
#[async_trait]
pub trait GroupProvider: Send + Sync {
    /// Read-only OBA, platform, permission/subscription preflight for this account.
    async fn require_group_eligibility(
        &self,
        connection: &Connection,
        token: &AccessToken,
    ) -> PortResult<()>;
    /// Submit exactly once; only a returned request ID can correlate a callback.
    async fn create_group(
        &self,
        connection: &Connection,
        token: &AccessToken,
        subject: &str,
    ) -> GroupCreateResult;
    /// Succeeds only on the documented positive success body.
    async fn delete_group(
        &self,
        connection: &Connection,
        token: &AccessToken,
        group: &ProviderId,
    ) -> PortResult<()>;
    /// Request removal; only the signed confirmation changes local membership.
    async fn remove_group_participant(
        &self,
        connection: &Connection,
        token: &AccessToken,
        group: &ProviderId,
        participant: &ProviderId,
    ) -> PortResult<()>;
}

/// Native channel operations retain their existing ownership and publication path.
#[async_trait]
pub trait NativeGroups: Send + Sync {
    /// Revalidate native permission; account-team membership belongs to the domain.
    async fn require_group_permission(
        &self,
        channel: Uuid,
        user: &str,
        permission: GroupPermission,
    ) -> PortResult<()>;
    /// Atomically create the private native channel and pending external binding.
    async fn create_group_channel(
        &self,
        connection: &Connection,
        request: &CreateGroup,
    ) -> PortResult<GroupAttempt>;
    /// Delete a failed/unknown local setup under the domain's deletion guard.
    async fn delete_group_channel(
        &self,
        connection: &Connection,
        channel: Uuid,
        user: &str,
        discard: bool,
    ) -> PortResult<()>;
    /// Apply a signed fact and native subject mutation in one transaction, then publish.
    async fn apply_group_event(
        &self,
        connection: &Connection,
        event: &GroupEvent,
    ) -> PortResult<()>;
}
