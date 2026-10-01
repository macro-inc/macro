//! Composition helpers for quota admission without payment collection.

use crate::{
    AiAdmissionService, AiUsageEnforcement, BillingAdmissionService,
    domain::BillingServiceImpl,
    outbound::{NoOpPaymentGateway, PgBillingRepo, PgUsageReader, RolesTeamsEntitlementSource},
};
use macro_env::Environment;
use roles_and_permissions::domain::port::UserRolesAndPermissionsService;
use sqlx::PgPool;
use std::sync::Arc;
use teams::domain::team_repo::TeamRepository;

#[cfg(all(test, feature = "pg-admission"))]
mod test;

/// Compose quota admission for hosts without an existing billing service.
/// Adapter construction stays in this owning-domain composition root.
#[cfg(feature = "pg-admission")]
pub fn pg_admission_service(
    pool: PgPool,
    environment: Environment,
    enforcement: AiUsageEnforcement,
) -> Arc<dyn AiAdmissionService> {
    admission_service(
        pool.clone(),
        roles_and_permissions::domain::service::UserRolesAndPermissionsServiceImpl::new(
            roles_and_permissions::outbound::pgpool::MacroDB::new(pool.clone()),
            roles_and_permissions::outbound::pgpool::MacroDB::new(pool.clone()),
        ),
        teams::outbound::team_repo::TeamRepositoryImpl::new(pool),
        environment,
        enforcement,
    )
}

/// Compose admission from the host's existing roles service, team repository and
/// database pool. Both admission and billing receive the same explicit policy.
/// This service never settles usage, requests collection, or installs financial funding.
/// Hosts already owning a billing instance can wrap it with [`BillingAdmissionService`].
pub fn admission_service<P, T>(
    pool: PgPool,
    permissions: P,
    teams: T,
    environment: Environment,
    enforcement: AiUsageEnforcement,
) -> Arc<dyn AiAdmissionService>
where
    P: UserRolesAndPermissionsService,
    T: TeamRepository,
{
    let billing = BillingServiceImpl::new(
        RolesTeamsEntitlementSource::new(permissions, teams),
        PgUsageReader::new(pool.clone()),
        PgBillingRepo::new(pool),
        NoOpPaymentGateway,
        environment,
    )
    .with_enforcement(enforcement);
    Arc::new(BillingAdmissionService::new(Arc::new(billing), enforcement))
}
