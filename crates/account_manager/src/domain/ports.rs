//! Ports (trait contracts) for the account manager domain.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use user_api_key::domain::models::UserApiKey;
use uuid::Uuid;

use crate::domain::models::{
    AccountManagerDecision, AccountManagerError, AccountManagerGrant, AccountManagerRole,
};

/// Outbound persistence port for grants. Every status change is one conditional
/// write, returning `None` when the grant isn't in the required state.
pub trait AccountManagerRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Whether the user is an agent account. `None` when there is no such user.
    fn is_agent(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<bool>, Self::Err>> + Send;

    /// Open a request, or return the pair's request that is already pending.
    fn open_request(
        &self,
        id: Uuid,
        managed: &MacroUserIdStr<'_>,
        manager: &MacroUserIdStr<'_>,
        requested_by: AccountManagerRole,
        expires_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<OpenedRequest, Self::Err>> + Send;

    /// Load one grant.
    fn get(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<AccountManagerGrant>, Self::Err>> + Send;

    /// List the grants on an account that are approved or active.
    fn list_for_managed(
        &self,
        managed: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<AccountManagerGrant>, Self::Err>> + Send;

    /// Resolve an unexpired pending request.
    fn respond(
        &self,
        id: Uuid,
        decision: AccountManagerDecision,
        claim_expires_at: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<AccountManagerGrant>, Self::Err>> + Send;

    /// Activate an unclaimed, unexpired approval with this credential hash,
    /// revoking any earlier active grant for the same pair.
    fn claim(
        &self,
        id: Uuid,
        key_hash: &[u8; 32],
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<AccountManagerGrant>, Self::Err>> + Send;

    /// End a pending, approved, or active grant, invalidating its credential.
    fn revoke(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<AccountManagerGrant>, Self::Err>> + Send;
}

/// The result of opening a request.
#[derive(Debug, Clone)]
pub struct OpenedRequest {
    /// The pending request.
    pub grant: AccountManagerGrant,
    /// `false` when the pair already had this request pending.
    pub created: bool,
}

/// Outbound port that tells the other side, in the pair's DM.
pub trait AccountManagerDelivery: Send + Sync + 'static {
    /// Post the request card as `sender`.
    fn deliver_request(
        &self,
        sender: &MacroUserIdStr<'static>,
        recipient: &MacroUserIdStr<'static>,
        grant_id: Uuid,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;

    /// Post the one-time link as `sender`, the side that approved.
    fn deliver_approval(
        &self,
        sender: &MacroUserIdStr<'static>,
        recipient: &MacroUserIdStr<'static>,
        grant_id: Uuid,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
}

/// A credential freshly claimed, shown only this once.
#[derive(Debug, Clone)]
pub struct ClaimedCredential {
    /// The grant, now active.
    pub grant: AccountManagerGrant,
    /// The secret. Its `Debug` output is redacted.
    pub key: UserApiKey,
}

/// Inbound service port: the account manager API used by drivers (HTTP).
pub trait AccountManagerService: Send + Sync + 'static {
    /// Ask `counterparty` for a grant in which the caller takes `caller_role`.
    fn request(
        &self,
        caller: &MacroUserIdStr<'static>,
        counterparty: &MacroUserIdStr<'static>,
        caller_role: AccountManagerRole,
    ) -> impl Future<Output = Result<AccountManagerGrant, AccountManagerError>> + Send;

    /// Read a grant the caller is part of.
    fn get(
        &self,
        caller: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<AccountManagerGrant, AccountManagerError>> + Send;

    /// List the managers of the caller's account.
    fn list_managers(
        &self,
        caller: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<AccountManagerGrant>, AccountManagerError>> + Send;

    /// Approve or decline a request the caller didn't make.
    fn respond(
        &self,
        caller: &MacroUserIdStr<'static>,
        id: Uuid,
        decision: AccountManagerDecision,
    ) -> impl Future<Output = Result<AccountManagerGrant, AccountManagerError>> + Send;

    /// Issue the credential to the manager. Works once.
    fn claim(
        &self,
        caller: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<ClaimedCredential, AccountManagerError>> + Send;

    /// End a grant: either side may withdraw it at any point.
    fn revoke(
        &self,
        caller: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<AccountManagerGrant, AccountManagerError>> + Send;
}
