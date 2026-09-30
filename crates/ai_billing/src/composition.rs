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
