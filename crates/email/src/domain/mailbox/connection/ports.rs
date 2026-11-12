//! Facts and effects sequenced by inbox connection.

use super::super::initialization::{InitializationError, InitializeMailbox};
use super::{ConnectionError, ConnectionRequest, GoogleConnectionAttempt, SharedInboxPromotion};
use calendar_events::domain::models::{AppliedGoogleGrant, CalendarGrantIntent};
use email_api_client::domain::models::{AccessToken, EmailApiError};
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::link::Link;
use uuid::Uuid;

/// Keeps the original persistence cause when adding the legacy operation context.
pub trait ConnectionSourceError: std::error::Error + Send + Sync + 'static {
    fn into_original(self) -> anyhow::Error;
}

/// Existing repository lookups used while connecting a Gmail inbox.
pub trait ConnectionLinkLookup: Send + Sync + 'static {
    type Err: std::error::Error + Send + Sync + 'static;
    fn by_identity(
        &self,
        owner: &str,
        actor: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;
    fn by_grant(
        &self,
        owner: &str,
        email: &str,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;
}

/// Link and account facts, without connection policy.
pub trait ConnectionLinks: Send + Sync + 'static {
    type Err: ConnectionSourceError;
    fn attempt(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<GoogleConnectionAttempt, Self::Err>> + Send;
    fn account_for_email(
        &self,
        email: &str,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;
    fn link_for_email(
        &self,
        email: &str,
    ) -> impl Future<Output = Result<Option<Link>, Self::Err>> + Send;
    fn link_for_identity(
        &self,
        owner: &str,
        actor: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;
    fn link_for_grant(
        &self,
        owner: &str,
        email: &str,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;
    fn account_fusion_id(
        &self,
        email: &str,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;
    fn organization(
        &self,
        actor: &str,
    ) -> impl Future<Output = Result<Option<i32>, Self::Err>> + Send;
    fn set_credential_owner(
        &self,
        link: Uuid,
        owner: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    fn cleanup_attempt(&self, attempt: Uuid, owner: &str) -> impl Future<Output = ()> + Send;
}

/// Each method retains one existing transaction and its entitlement lock.
pub trait ConnectionTransactions: Send + Sync + 'static {
    fn delegate(
        &self,
        actor: &str,
        email: &str,
        child: &str,
        link: Uuid,
    ) -> impl Future<Output = Result<(), ConnectionError>> + Send;
    fn bootstrap(
        &self,
        actor: &str,
        email: &str,
        child: &str,
        link: Link,
        cursor: &str,
    ) -> impl Future<Output = Result<Link, ConnectionError>> + Send;
    fn create(
        &self,
        actor: &str,
        link: Link,
        cursor: &str,
    ) -> impl Future<Output = Result<Link, ConnectionError>> + Send;
    fn promote(
        &self,
        actor: &str,
        email: &str,
        existing: &Link,
        organization: Option<i32>,
    ) -> impl Future<Output = Result<SharedInboxPromotion, ConnectionError>> + Send;
}

/// Provider watch, credentials, scope discovery and grant relocation.
pub trait ConnectionProvider: Send + Sync + 'static {
    type ScopeErr: std::error::Error + Send + Sync + 'static;
    type RelocationErr: std::error::Error + Send + Sync + 'static;
    fn register_watch(
        &self,
        link: &Link,
    ) -> impl Future<Output = Result<String, EmailApiError>> + Send;
    fn fresh_token(
        &self,
        link: Uuid,
    ) -> impl Future<Output = Result<AccessToken, EmailApiError>> + Send;
    fn token_scopes(
        &self,
        token: &AccessToken,
    ) -> impl Future<Output = Result<Vec<String>, Self::ScopeErr>> + Send;
    fn relocate_grant(
        &self,
        email: &str,
        owner: &str,
        shared_owner: &str,
    ) -> impl Future<Output = Result<String, Self::RelocationErr>> + Send;
}

/// The existing calendar grant service and its connection bookkeeping.
pub trait ConnectionGrants: Send + Sync + 'static {
    fn unrecorded(&self, link: Uuid) -> impl Future<Output = bool> + Send;
    fn apply(
        &self,
        link: Uuid,
        scopes: &[String],
        intent: CalendarGrantIntent,
    ) -> impl Future<Output = Result<AppliedGoogleGrant, ConnectionError>> + Send;
    fn consume(&self, attempt: Uuid) -> impl Future<Output = Result<(), ConnectionError>> + Send;
    fn clear_reauth(&self, link: Uuid) -> impl Future<Output = ()> + Send;
}

/// Reuses the existing verified-mailbox initializer for recognized providers.
pub trait ConnectionInitializer: Send + Sync + 'static {
    fn recognizes(
        &self,
        request: &InitializeMailbox,
    ) -> impl Future<Output = Result<bool, InitializationError>> + Send;
    fn initialize(
        &self,
        request: InitializeMailbox,
    ) -> impl Future<Output = Result<Uuid, InitializationError>> + Send;
}

/// Starts or reuses the backfill through the existing backfill-job service.
pub trait ConnectionBackfill: Send + Sync + 'static {
    fn start(&self, link: &Link) -> impl Future<Output = Result<Uuid, ConnectionError>> + Send;
}

/// Retains the existing lazy login parsing and its diagnostic spans.
pub trait ConnectionIdentity: Send + Sync + 'static {
    fn login_email(&self, user: &str) -> Result<String, ConnectionError>;
}

/// Renders the existing transport-specific failure diagnostics without owning cleanup.
pub trait ConnectionFailureObserver: Send + Sync + 'static {
    fn observe_failure(&self, request: &ConnectionRequest, error: &ConnectionError);
}
