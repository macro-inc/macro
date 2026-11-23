//! Verified-address IMAP connection and retry-safe promotion into durable streams.

use imap_engine::domain::models::{
    Binding, ConnectRequest, Discovery, DiscoverySteer, Login, Verification, VerifyRequest,
};
use macro_user_id::{
    cowlike::{ArcCowStr, CowLike},
    email::{Email, EmailStr, ReadEmailParts},
    user_id::MacroUserIdStr,
};
use std::future::Future;
use uuid::Uuid;

/// Public input never carries an owner identity or a credential binding.
#[derive(serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ImapConnectRequest {
    /// One id retained when retrying a connect request after a lost response.
    pub request_id: Uuid,
    /// Required by a reconnect surface to reject stale settings dialogs.
    pub link_id: Option<Uuid>,
    /// Must be an address Macro has independently verified for the actor.
    #[cfg_attr(feature = "axum", schema(value_type = String, format = Email))]
    pub email: EmailStr<'static>,
    /// IMAP login.
    pub imap: Login,
    /// SMTP login.
    pub smtp: Login,
    /// Endpoints the user explicitly approved before credentials leave Macro.
    pub confirmed_hosts: Vec<String>,
}

/// A durable promotion attempt has no plaintext credentials.
#[derive(Clone)]
pub struct ImapConnectionAttempt {
    pub id: Uuid,
    pub owner: MacroUserIdStr<'static>,
    pub credential_owner: String,
    pub email: EmailStr<'static>,
    pub verification_id: Uuid,
    pub binding: Binding,
    pub expected_generation: Option<i64>,
    pub completed: bool,
}

/// A nonce fences one promotion across the interactive and recovery paths.
#[derive(Clone)]
pub struct ImapConnectionLease {
    pub attempt: ImapConnectionAttempt,
    pub nonce: Uuid,
    /// Database age at acquisition, used for bounded retry policy.
    pub age: chrono::Duration,
}

/// Recovery yields after a full bounded cycle, or waits when no attempt is due.
#[derive(Debug, PartialEq, Eq)]
pub enum ConnectionRecoveryTick {
    Idle,
    Progress,
}

#[derive(Debug, thiserror::Error)]
pub enum ImapConnectionError {
    #[error("IMAP connections are not enabled")]
    Disabled,
    #[error("Verify this email address in Macro before connecting its mailbox")]
    AddressUnverified,
    #[error("This address is already connected through a different provider")]
    ProviderConflict,
    #[error("The inbox changed while connecting; retry")]
    Changed,
    #[error("A professional subscription is required to connect another inbox")]
    PaymentRequired,
    #[error("IMAP connection storage is temporarily unavailable")]
    Unavailable,
    #[error(transparent)]
    Provider(#[from] imap_engine::domain::models::Error),
}

/// Persistence keeps account promotion replayable across a process crash.
pub trait ImapConnectionRepository: Send + Sync + 'static {
    fn attempt(
        &self,
        actor: &MacroUserIdStr<'_>,
        request: Uuid,
    ) -> impl Future<Output = Result<Option<ImapConnectionAttempt>, ImapConnectionError>> + Send;
    fn reserve(
        &self,
        actor: &MacroUserIdStr<'_>,
        credential_owner: &str,
        input: &ImapConnectRequest,
        verification: &Verification,
    ) -> impl Future<Output = Result<ImapConnectionAttempt, ImapConnectionError>> + Send;
    /// Interactive retries acquire the same lease as background recovery.
    fn lease(
        &self,
        attempt: &ImapConnectionAttempt,
    ) -> impl Future<Output = Result<ImapConnectionLease, ImapConnectionError>> + Send;
    /// Claim only one due attempt; no connection survives this call.
    fn claim_pending(
        &self,
    ) -> impl Future<Output = Result<Option<ImapConnectionLease>, ImapConnectionError>> + Send;
    /// Schedule a failed attempt and release its nonce under the live lease fence.
    fn defer(
        &self,
        lease: &ImapConnectionLease,
        delay: chrono::Duration,
    ) -> impl Future<Output = Result<(), ImapConnectionError>> + Send;
    /// Link identity, binding, import stream and completion receipt commit together.
    fn activate(
        &self,
        lease: &ImapConnectionLease,
    ) -> impl Future<Output = Result<Uuid, ImapConnectionError>> + Send;
    fn abandon(
        &self,
        lease: &ImapConnectionLease,
    ) -> impl Future<Output = Result<(), ImapConnectionError>> + Send;
    fn owned_address_is_connected(
        &self,
        actor: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<bool, ImapConnectionError>> + Send;
}

pub trait ImapConnectionGateway: Send + Sync + 'static {
    /// Passive catalog/domain-only MX hint; never run address-bearing autoconfig.
    fn provider_hint(
        &self,
        email: &Email<ArcCowStr<'_>>,
    ) -> impl Future<Output = Result<Discovery, ImapConnectionError>> + Send;
    fn discover(
        &self,
        email: &Email<ArcCowStr<'_>>,
    ) -> impl Future<Output = Result<Discovery, ImapConnectionError>> + Send;
    fn verify(
        &self,
        request: &VerifyRequest,
    ) -> impl Future<Output = Result<Verification, ImapConnectionError>> + Send;
    fn connect(
        &self,
        link: Uuid,
        request: &ConnectRequest,
    ) -> impl Future<Output = Result<Binding, ImapConnectionError>> + Send;
}

pub trait ImapConnectionEnrollment: Send + Sync + 'static {
    fn enabled(&self, actor: &MacroUserIdStr<'_>) -> impl Future<Output = bool> + Send;
}

/// Provider offered using a catalog entry or a domain-only DNS hint.
#[derive(serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ImapConnectionOffer {
    None,
    Gmail,
    Outlook,
    Imap,
}

pub struct ImapConnectionService<R, G, F> {
    pub repository: R,
    pub gateway: G,
    pub enrollment: F,
}
impl<R: ImapConnectionRepository, G: ImapConnectionGateway, F: ImapConnectionEnrollment>
    ImapConnectionService<R, G, F>
{
    /// Offering the signed-in address does not infer access from mail-server auth.
    pub async fn suggestion(
        &self,
        actor: &MacroUserIdStr<'_>,
    ) -> Result<ImapConnectionOffer, ImapConnectionError> {
        if !self.enrollment.enabled(actor).await
            || actor
                .email_part()
                .domain_part()
                .eq_ignore_ascii_case("privaterelay.appleid.com")
            || self.repository.owned_address_is_connected(actor).await?
        {
            return Ok(ImapConnectionOffer::None);
        }
        // A passive visit may resolve a domain, but never disclose the address
        // to an autoconfig server. Uncertain hints keep the generic chooser.
        let Ok(discovery) = self.gateway.provider_hint(&actor.email_part()).await else {
            return Ok(ImapConnectionOffer::None);
        };
        Ok(match discovery.steer {
            Some(DiscoverySteer::Gmail) => ImapConnectionOffer::Gmail,
            Some(DiscoverySteer::Outlook) => ImapConnectionOffer::Outlook,
            Some(DiscoverySteer::NoMailbox) => ImapConnectionOffer::None,
            None if discovery.imap.is_some() && discovery.smtp.is_some() => {
                ImapConnectionOffer::Imap
            }
            None => ImapConnectionOffer::None,
        })
    }
    pub async fn discover(
        &self,
        actor: &MacroUserIdStr<'_>,
        email: &Email<ArcCowStr<'_>>,
    ) -> Result<Discovery, ImapConnectionError> {
        if !self.enrollment.enabled(actor).await {
            return Err(ImapConnectionError::Disabled);
        }
        if !actor.email_str().eq_ignore_ascii_case(email.email_str())
            || actor
                .email_part()
                .domain_part()
                .eq_ignore_ascii_case("privaterelay.appleid.com")
        {
            return Err(ImapConnectionError::AddressUnverified);
        }
        self.gateway.discover(email).await
    }
    #[tracing::instrument(skip_all, fields(connection.request_id = %input.request_id), err)]
    pub async fn connect(
        &self,
        actor: MacroUserIdStr<'static>,
        credential_owner: &str,
        input: ImapConnectRequest,
    ) -> Result<Uuid, ImapConnectionError> {
        if !self.enrollment.enabled(&actor).await {
            return Err(ImapConnectionError::Disabled);
        }
        if !actor
            .email_str()
            .eq_ignore_ascii_case(input.email.0.as_ref())
            || actor
                .email_part()
                .domain_part()
                .eq_ignore_ascii_case("privaterelay.appleid.com")
        {
            return Err(ImapConnectionError::AddressUnverified);
        }
        let attempt = match self.repository.attempt(&actor, input.request_id).await? {
            Some(attempt) => {
                if input
                    .link_id
                    .is_some_and(|link| link != attempt.binding.link_id)
                {
                    return Err(ImapConnectionError::Changed);
                }
                attempt
            }
            None => {
                let verification = self
                    .gateway
                    .verify(&VerifyRequest {
                        user_id: actor.to_string(),
                        email: EmailStr(actor.email_part().into_owned()),
                        imap: input.imap.clone(),
                        smtp: input.smtp.clone(),
                        confirmed_hosts: input.confirmed_hosts.clone(),
                    })
                    .await?;
                self.repository
                    .reserve(&actor, credential_owner, &input, &verification)
                    .await?
            }
        };
        if attempt.completed {
            return Ok(attempt.binding.link_id);
        }
        let lease = match self.repository.lease(&attempt).await {
            Ok(lease) => lease,
            Err(ImapConnectionError::Changed) => {
                // A worker may finish or hold this attempt after our first read.
                // Return its durable receipt, or a retryable contention outcome;
                // neither case permits another credential probe or promotion.
                return match self.repository.attempt(&actor, input.request_id).await? {
                    Some(current) if current.completed => Ok(current.binding.link_id),
                    Some(_) => Err(imap_engine::domain::models::Error::AccountBusy.into()),
                    None => Err(ImapConnectionError::Changed),
                };
            }
            Err(error) => return Err(error),
        };
        self.finish_promotion(&lease).await
    }
    async fn promote(&self, lease: &ImapConnectionLease) -> Result<Uuid, ImapConnectionError> {
        let attempt = &lease.attempt;
        let bound = self
            .gateway
            .connect(
                attempt.binding.link_id,
                &ConnectRequest {
                    verification_id: attempt.verification_id,
                    owner_user_id: attempt.owner.to_string(),
                    sync_generation: attempt.binding.sync_generation,
                    grant_generation: attempt.binding.grant_generation,
                },
            )
            .await?;
        if bound.link_id != attempt.binding.link_id
            || bound.sync_generation != attempt.binding.sync_generation
            || bound.grant_generation != attempt.binding.grant_generation
        {
            return Err(ImapConnectionError::Changed);
        }
        self.repository.activate(lease).await
    }
    /// A crash after engine promotion resumes the same binding, never a new login.
    pub async fn recover_once(&self) -> Result<ConnectionRecoveryTick, ImapConnectionError> {
        for _ in 0..32 {
            let Some(lease) = self.repository.claim_pending().await? else {
                return Ok(ConnectionRecoveryTick::Idle);
            };
            // An individual provider failure is settled and never stops the cycle.
            if let Err(error) = self.finish_promotion(&lease).await {
                tracing::warn!(request_id = %lease.attempt.id, error = %error,
                    "IMAP connection recovery attempt did not complete");
            }
        }
        Ok(ConnectionRecoveryTick::Progress)
    }

    #[tracing::instrument(skip_all, name = "email.imap.connection.promote", fields(
        connection.request_id = %lease.attempt.id,
        connection.expired = tracing::field::Empty,
    ), err)]
    async fn finish_promotion(
        &self,
        lease: &ImapConnectionLease,
    ) -> Result<Uuid, ImapConnectionError> {
        if lease.attempt.completed {
            return Ok(lease.attempt.binding.link_id);
        }
        let expired = lease.age >= chrono::Duration::hours(24);
        tracing::Span::current().record("connection.expired", expired);
        if expired {
            self.repository.abandon(lease).await?;
            tracing::warn!(
                reason = "attempt_age_limit",
                "IMAP connection attempt expired"
            );
            return Err(ImapConnectionError::Changed);
        }
        let result = self.promote(lease).await;
        if let Err(error) = &result {
            use imap_engine::domain::models::Error;
            if matches!(
                error,
                ImapConnectionError::Changed
                    | ImapConnectionError::Provider(
                        Error::NotFound
                            | Error::Invalid
                            | Error::Forbidden
                            | Error::CredentialsRejected
                    )
            ) {
                self.repository.abandon(lease).await?;
            } else {
                let delay = (lease.age / 4)
                    .clamp(chrono::Duration::minutes(1), chrono::Duration::minutes(30));
                self.repository.defer(lease, delay).await?;
            }
        }
        result
    }
}

#[cfg(test)]
mod test;
