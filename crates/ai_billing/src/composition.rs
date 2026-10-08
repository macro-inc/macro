//! Composition helpers for quota admission without payment collection.

use crate::{
    AiAdmissionService, AiPricing, AiUsageEnforcement, BillingAdmissionService,
    domain::BillingServiceImpl,
    outbound::{NoOpPaymentGateway, PgBillingRepo, PgUsageReader, RolesTeamsEntitlementSource},
};
use roles_and_permissions::domain::port::UserRolesAndPermissionsService;
use sqlx::PgPool;
use std::sync::Arc;
use teams::domain::team_repo::TeamRepository;

#[cfg(all(test, feature = "pg-admission"))]
mod test;

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
