//! Composition helpers for hosts that gate and record AI usage without owning
//! Stripe: quota admission, and the usage recorder that asks the
//! authentication service to settle.

use crate::{
    AiAdmissionService, AiPricing, AiUsageBilling, AiUsageEnforcement, BillingAdmissionService,
    domain::{BillingServiceImpl, ports::NoOpSettlementTrigger},
    outbound::{
        HttpPaymentGateway, HttpSettlementTrigger, NoOpPaymentGateway, PgBillingRepo,
        PgUsageReader, RolesTeamsEntitlementSource, SettlingUsageRecorder,
    },
};
use ai_usage::UsageRecorder;
use authentication_service_client::AuthServiceClient;
use roles_and_permissions::domain::port::UserRolesAndPermissionsService;
use sqlx::PgPool;
use std::sync::Arc;
use teams::domain::team_repo::TeamRepository;

#[cfg(all(test, feature = "pg-admission"))]
mod test;

/// Where a host's settlement requests go.
///
/// Settlement (credit consumption and automatic reloads) runs in the
/// authentication service, which owns Stripe. A host that records
/// counted usage asks it to settle the payer after each completion so a
/// reload fires when the balance runs low rather than on the next Billing
/// page view. The authentication service's own `ENABLE_AI_USAGE_BILLING`
/// policy decides whether a request does anything, and its reconciliation
/// sweep settles anyone whose request was lost; a host's route only decides
/// whether it asks at all.
#[derive(Clone)]
pub enum SettlementRoute {
    /// Never ask. Usage is still recorded and counted.
    Off,
    /// Ask the authentication service through its internal API.
    AuthService(Arc<AuthServiceClient>),
}

/// A host enabled `ENABLE_AI_USAGE_BILLING` without the authentication
/// service key its settlement requests must present.
#[derive(Debug, thiserror::Error)]
#[error(
    "ENABLE_AI_USAGE_BILLING is true but no authentication service client is configured; set AUTHENTICATION_SERVICE_SECRET_KEY or disable billing"
)]
pub struct MissingSettlementClient;

impl SettlementRoute {
    /// Resolve the route from the host's `ENABLE_AI_USAGE_BILLING` policy and
    /// the authentication service client its configuration could build.
    ///
    /// Billing enabled without a client is a misconfiguration worth failing
    /// startup over: the host would record chargeable usage that only the
    /// sweep ever settles. A client without billing is fine and goes unused.
    pub fn from_policy(
        billing: AiUsageBilling,
        auth_client: Option<Arc<AuthServiceClient>>,
    ) -> Result<Self, MissingSettlementClient> {
        match (billing, auth_client) {
            (AiUsageBilling::Disabled, _) => Ok(Self::Off),
            (AiUsageBilling::Enabled, Some(client)) => Ok(Self::AuthService(client)),
            (AiUsageBilling::Enabled, None) => Err(MissingSettlementClient),
        }
    }
}

/// Compose quota admission for hosts without an existing billing service.
/// Adapter construction stays in this owning-domain composition root. `pricing`
/// is the host's mandatory startup configuration.
#[cfg(feature = "pg-admission")]
pub fn pg_admission_service(
    pool: PgPool,
    enforcement: AiUsageEnforcement,
    pricing: AiPricing,
) -> Arc<dyn AiAdmissionService> {
    admission_service(
        pool.clone(),
        roles_and_permissions::domain::service::UserRolesAndPermissionsServiceImpl::new(
            roles_and_permissions::outbound::pgpool::MacroDB::new(pool.clone()),
            roles_and_permissions::outbound::pgpool::MacroDB::new(pool.clone()),
        ),
        teams::outbound::team_repo::TeamRepositoryImpl::new(pool),
        enforcement,
        pricing,
    )
}

/// Compose admission from the host's existing roles service, team repository and
/// database pool. Both admission and billing receive the same explicit policy.
/// This service never settles usage, requests collection, or installs financial
/// funding: its settlement policy stays disabled regardless of the host's
/// `ENABLE_AI_USAGE_BILLING`. Hosts already owning a billing instance can wrap
/// it with [`BillingAdmissionService`].
pub fn admission_service<P, T>(
    pool: PgPool,
    permissions: P,
    teams: T,
    enforcement: AiUsageEnforcement,
    pricing: AiPricing,
) -> Arc<dyn AiAdmissionService>
where
    P: UserRolesAndPermissionsService,
    T: TeamRepository,
{
    let billing = BillingServiceImpl::new(
        RolesTeamsEntitlementSource::new(permissions, teams),
        PgUsageReader::new(pool.clone()),
        PgBillingRepo::new(pool, pricing),
        NoOpPaymentGateway,
        pricing,
    )
    .with_enforcement(enforcement);
    Arc::new(BillingAdmissionService::new(Arc::new(billing), enforcement))
}

/// Compose the production usage recorder for a host without an existing
/// billing service: configured counting and per-attempt tracking, inside the
/// settling wrapper that asks the authentication service to settle after
/// counted usage lands ([`SettlingUsageRecorder`]).
#[cfg(feature = "pg-admission")]
pub fn pg_settling_recorder(
    pool: PgPool,
    enforcement: AiUsageEnforcement,
    pricing: AiPricing,
    route: SettlementRoute,
) -> Arc<dyn UsageRecorder> {
    settling_recorder(
        pool.clone(),
        roles_and_permissions::domain::service::UserRolesAndPermissionsServiceImpl::new(
            roles_and_permissions::outbound::pgpool::MacroDB::new(pool.clone()),
            roles_and_permissions::outbound::pgpool::MacroDB::new(pool.clone()),
        ),
        teams::outbound::team_repo::TeamRepositoryImpl::new(pool),
        enforcement,
        pricing,
        route,
    )
}

/// Compose the settling usage recorder from the host's existing roles service,
/// team repository and database pool.
///
/// The wrapper is used whatever the route: it retries a usage write that
/// fails, which the bare recorder does not. With
/// [`SettlementRoute::AuthService`] it reads the payer's position after each
/// counted write and asks the authentication service to settle when usage is
/// uncovered; the position's subscription period is read through the same
/// service, as the document cognition service does. With
/// [`SettlementRoute::Off`] the billing position is never read. Neither
/// settles anything in this process.
pub fn settling_recorder<P, T>(
    pool: PgPool,
    permissions: P,
    teams: T,
    enforcement: AiUsageEnforcement,
    pricing: AiPricing,
    route: SettlementRoute,
) -> Arc<dyn UsageRecorder>
where
    P: UserRolesAndPermissionsService,
    T: TeamRepository,
{
    let usage = Arc::new(
        ai_usage::domain::service::UsageServiceImpl::new(ai_usage::outbound::PgUsageRepo::new(
            pool.clone(),
        ))
        .with_enforcement(enforcement),
    );
    let entitlements = RolesTeamsEntitlementSource::new(permissions, teams);
    let analytics: Arc<dyn UsageRecorder> = match route {
        SettlementRoute::Off => Arc::new(SettlingUsageRecorder::new(
            usage,
            Arc::new(
                BillingServiceImpl::new(
                    entitlements,
                    PgUsageReader::new(pool.clone()),
                    PgBillingRepo::new(pool.clone(), pricing),
                    NoOpPaymentGateway,
                    pricing,
                )
                .with_enforcement(enforcement),
            ),
            NoOpSettlementTrigger,
            AiUsageBilling::Disabled,
        )),
        SettlementRoute::AuthService(client) => Arc::new(SettlingUsageRecorder::new(
            usage,
            Arc::new(
                BillingServiceImpl::new(
                    entitlements,
                    PgUsageReader::new(pool.clone()),
                    PgBillingRepo::new(pool.clone(), pricing),
                    HttpPaymentGateway::new(client.clone()),
                    pricing,
                )
                .with_enforcement(enforcement),
            ),
            HttpSettlementTrigger::new(client),
            AiUsageBilling::Enabled,
        )),
    };
    ai_usage::with_tracking(analytics, ai_usage::pg_tracking(pool))
}
