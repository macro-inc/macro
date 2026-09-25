//! Database-backed admission wiring for application composition roots.

use crate::{
    domain::{AiAdmissionService, BillingAdmissionService, BillingServiceImpl},
    outbound::{NoOpPaymentGateway, PgBillingRepo, PgUsageReader, RolesTeamsEntitlementSource},
};
use roles_and_permissions::{
    domain::service::UserRolesAndPermissionsServiceImpl, outbound::pgpool::MacroDB,
};
use sqlx::PgPool;
use std::sync::Arc;
use teams::outbound::team_repo::TeamRepositoryImpl;

/// Construct shared admission using the same entitlement and billing adapters as DCS.
///
/// This only reads billing state. Settlement and payment collection remain with
/// the existing usage recorder and authentication service; no Stripe client is needed.
/// Callers that already own a billing service can wrap it in
/// [`BillingAdmissionService`] instead of constructing another one.
pub fn ai_admission_service(pool: PgPool) -> Arc<dyn AiAdmissionService> {
    let permissions = UserRolesAndPermissionsServiceImpl::new(
        MacroDB::new(pool.clone()),
        MacroDB::new(pool.clone()),
    );
    let billing = BillingServiceImpl::new(
        RolesTeamsEntitlementSource::new(permissions, TeamRepositoryImpl::new(pool.clone())),
        PgUsageReader::new(pool.clone()),
        PgBillingRepo::new(pool),
        NoOpPaymentGateway,
    );
    Arc::new(BillingAdmissionService::new(billing))
}
