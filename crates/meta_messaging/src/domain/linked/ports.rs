//! Object-safe capabilities composed by DSS for personal linked-device use cases.
use super::models::*;
use crate::domain::{
    connection::Conversation,
    ports::{ConversationRepository, PortResult},
};
use async_trait::async_trait;
use uuid::Uuid;

/// Personal account persistence, separate from business connections.
#[async_trait]
pub trait LinkedRepository: ConversationRepository {
    /// Account state visible only to its stable owner.
    async fn owned_account(&self, user: &str) -> PortResult<Option<Account>>;
    /// Stable account lookup for authenticated background events.
    async fn linked_account(&self, id: Uuid) -> PortResult<Option<Account>>;
    /// One active owner-bound transaction, with DB-time expiry.
    async fn begin_pairing(&self, user: &str, replace: bool) -> PortResult<Pairing>;
    /// Live consent for hosted pairing completion, independent of browser polling.
    async fn pending_pairing(&self, account: Uuid) -> PortResult<Option<Pairing>>;
    /// Owner-only non-sensitive status, including terminal transactions.
    async fn pairing_snapshot(&self, user: &str, id: Uuid) -> PortResult<Pairing>;
    /// Load an owner-bound, live, unconsumed flow.
    async fn pairing(&self, user: &str, id: Uuid) -> PortResult<Pairing>;
    /// Commit identity without stealing another owner's account.
    async fn complete_pairing(&self, pairing: &Pairing, identity: &str) -> PortResult<Account>;
    /// Cancel/expire the flow and revoke its sending authorization.
    async fn cancel_pairing(&self, pairing: &Pairing) -> PortResult<bool>;
    /// End observation consent and increment authorization, preserving native history/access.
    async fn disconnect_account(
        &self,
        user: &str,
        account: Uuid,
        generation: i64,
    ) -> PortResult<()>;
    /// Bound native channel; existence remains protected by a native receipt.
    async fn binding(&self, channel: Uuid) -> PortResult<Option<Binding>>;
    /// List only authorized observers for background reconciliation.
    async fn active_accounts(&self) -> PortResult<Vec<Account>>;
    /// Commit or quarantine a worker event through native composition before acknowledging it.
    async fn record_account_event(&self, event: &Event) -> PortResult<()>;
    /// Last reconciled roster, only read after native channel authorization.
    async fn roster(&self, channel: Uuid) -> PortResult<Option<GroupInfo>>;
    /// Current account publication grants across all workspaces, filtered by native access.
    async fn observing_groups(&self, account: &Account) -> PortResult<Vec<ObservationGrant>>;
    /// Retain a failed adopted-group event without blocking unrelated events/accounts.
    async fn defer_event(&self, event: &Event) -> PortResult<()>;
    /// Bounded due events, including out-of-order revisions and failed media.
    async fn pending_events(&self, account: &Account) -> PortResult<Vec<Event>>;
    /// Original commands with unresolved remote acceptance.
    async fn unresolved_commands(&self, account: Uuid) -> PortResult<Vec<(Uuid, i64)>>;
    /// Apply durable acceptance evidence without reopening external dispatch.
    async fn recover_outcome(
        &self,
        account: Uuid,
        generation: i64,
        command: Uuid,
        source: &str,
        state: &str,
    ) -> PortResult<()>;
    /// Refresh membership with a full roster and no native access inference.
    async fn reconcile_group(&self, account: &Account, group: &GroupInfo) -> PortResult<()>;
}
/// Authenticated session-service RPC, including physically fenced ownership.
#[async_trait]
pub trait Sessions: Send + Sync {
    /// Start/reuse only the exact owned session.
    async fn start(&self, account: &Account, pairing: Option<&Pairing>)
    -> PortResult<SessionScope>;
    /// Read volatile pairing state for this transaction.
    async fn pair_state(&self, scope: &SessionScope, pairing: Uuid) -> PortResult<PairState>;
    /// Submit the actual native authenticator assertion.
    async fn passkey(
        &self,
        scope: &SessionScope,
        pairing: Uuid,
        response: &serde_json::Value,
    ) -> PortResult<()>;
    /// Deliberately confirm the shown protocol code.
    async fn confirm(&self, scope: &SessionScope, pairing: Uuid) -> PortResult<()>;
    /// List only this account's joined groups.
    async fn groups(&self, scope: &SessionScope) -> PortResult<Vec<GroupInfo>>;
    /// Refresh current group metadata.
    async fn group(&self, scope: &SessionScope, group: &str) -> PortResult<GroupInfo>;
    /// Replace the per-account allowlist from current authorized bindings.
    async fn allowlist(
        &self,
        scope: &SessionScope,
        bindings: &[ObservationGrant],
    ) -> PortResult<()>;
    /// Read the original journal after retirement without starting a sender.
    async fn outcome(
        &self,
        account: &Account,
        generation: i64,
        command: Uuid,
    ) -> PortResult<TransportOutcome>;
    /// Stop the process; return whether remote unlink was confirmed when requested.
    async fn stop(&self, scope: &SessionScope, unlink: bool) -> PortResult<bool>;
    /// Bounded durable events; acknowledge only after the native transaction commits.
    async fn events(&self, scope: &SessionScope) -> PortResult<Vec<Event>>;
    /// Internal acknowledgment after canonical persistence.
    async fn acknowledge(&self, scope: &SessionScope, event: Uuid) -> PortResult<()>;
}
/// Owning-domain authorization and atomic native composition.
#[async_trait]
pub trait LinkedNative: Send + Sync {
    /// Native workspace creation/management authority and all requested audience members.
    async fn authorize_adoption(
        &self,
        user: &str,
        request: &AdoptGroup,
        group: &GroupInfo,
    ) -> PortResult<()>;
    /// Atomic bind/create; a hidden existing binding returns neutral Forbidden.
    async fn adopt(
        &self,
        user: &str,
        account: &Account,
        request: &AdoptGroup,
        group: &GroupInfo,
    ) -> PortResult<Binding>;
    /// Commit canonical content, documents and effect revisions through owning domains.
    async fn ingest_linked(&self, account: &Account, event: &Event) -> PortResult<()>;
    /// Grant a reviewed native audience after verified remote/workspace membership.
    async fn grant_access(
        &self,
        user: &str,
        binding: &Binding,
        users: &[String],
        group: &GroupInfo,
    ) -> PortResult<()>;
    /// Deliberately transfer ownership of future native content; existing files keep their owners.
    async fn transfer_owner(
        &self,
        user: &str,
        binding: &Binding,
        new_owner: &str,
        group: &GroupInfo,
    ) -> PortResult<()>;
    /// Local-only detach with native management authority.
    async fn detach(&self, user: &str, binding: &Binding) -> PortResult<()>;
}
/// Shared conversation DTO preserves legacy wire fields. For linked groups the
/// routing scope is the binding, while account_for_sender selects a real account.
pub fn conversation(
    binding: &Binding,
) -> Result<Conversation, crate::domain::models::MessagingError> {
    Ok(Conversation {
        channel_id: binding.channel_id,
        connection_id: binding.id,
        kind: crate::domain::groups::ConversationKind::Group,
        group_status: Some(if binding.state == "active" {
            crate::domain::groups::GroupStatus::Active
        } else {
            crate::domain::groups::GroupStatus::Suspended
        }),
        customer_id: binding.group_jid.clone().try_into()?,
        customer_display_name: None,
        customer_phone: None,
        customer_handle: None,
        last_customer_message_at: None,
    })
}
