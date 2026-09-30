//! Axum extractors specific to the CRM domain.
//!
//! These live in the `crm` crate rather than `entity_access` because
//! they mint CRM-domain capability tokens ([`crate::domain::auth`]) —
//! and the comment extractor additionally crosses the [`CrmService`]
//! boundary (comment → owning entity). `entity_access` deliberately
//! knows nothing about CRM models, so the CRM-typed extractors and the
//! receipts they produce are the trusted seam that lives here.

#[cfg(test)]
mod test;

use std::collections::HashMap;
use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    RequestPartsExt,
    extract::{FromRef, FromRequestParts, Path},
    http::request::Parts,
};
use entity_access::{
    domain::{
        models::{Entity, EntityAccessReceipt, EntityType, RequiredPermission},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::ExtractorError,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use uuid::Uuid;

use crate::domain::auth::{CrmCompanyReceipt, CrmContactReceipt};

/// Validates that the user satisfies the required permission for a CRM
/// company and mints a [`CrmCompanyReceipt`] for downstream service calls.
/// The acting user is authenticated through the authorization service in
/// router state, supporting direct credentials and internal service callers.
///
/// Access derives from the caller's role on the owning team: team owners
/// get `Owner`, admins and members get `Edit`. Hidden companies are
/// invisible to plain members — the extractor returns `Unauthorized` rather
/// than leak existence. The caller's team role rides along in the receipt
/// so the service can gate hidden-row visibility and governance mutations
/// on admin/owner.
///
/// Reads `company_id` from the path. The access check resolves the company's
/// owning `team_id` from the same ownership row and bundles it into the
/// receipt, so the service scopes its queries by the entity's team rather
/// than the caller's default team.
#[derive(Debug)]
pub struct CrmCompanyAccessLevelExtractor<T: RequiredPermission, Svc, Auth> {
    /// Capability token authorizing CRM company service calls.
    pub receipt: CrmCompanyReceipt<T>,
    _marker: PhantomData<(T, Svc, Auth)>,
}

impl<T, S, Svc, Auth> FromRequestParts<S> for CrmCompanyAccessLevelExtractor<T, Svc, Auth>
where
    T: RequiredPermission,
    Arc<Svc>: FromRef<S>,
    MacroAuthorizationState<Auth>: FromRef<S>,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(state, parts))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        let Path(path_params): Path<HashMap<String, String>> = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::BadRequest("missing company_id path parameter"))?;
        let company_id = extract_company_id(&path_params)?.to_string();

        let authorization =
            MacroAuthorizationExtractor::<Auth, UserOrInternal>::from_request_parts(parts, state)
                .await
                .map_err(ExtractorError::from)?;
        let macro_user_id = authorization.authorization.user.macro_user_id.clone();

        let (permission, team_id, team_role) = service
            .get_crm_entity_permission_with_team(
                Some(&macro_user_id),
                &company_id,
                EntityType::CrmCompany,
            )
            .await
            .map_err(ExtractorError::from)?;

        if !permission.satisfies::<T>() {
            return Err(ExtractorError::Unauthorized);
        }

        let receipt = EntityAccessReceipt::try_new_authenticated_user(
            macro_user_id,
            Entity {
                entity_id: company_id,
                entity_type: EntityType::CrmCompany,
            },
            permission,
        )?;

        Ok(Self {
            receipt: CrmCompanyReceipt::new(receipt, team_id, team_role),
            _marker: PhantomData,
        })
    }
}

/// Validates that the user satisfies the required permission for a CRM
/// contact and mints a [`CrmContactReceipt`] for downstream service calls.
/// The acting user is authenticated through the authorization service in
/// router state, supporting direct credentials and internal service callers.
///
/// Access derives from the caller's role on the team that owns the
/// contact's parent company, with the same role-to-level mapping as
/// [`CrmCompanyAccessLevelExtractor`]. Hidden contacts (or contacts whose
/// parent company is hidden) are invisible to plain members.
///
/// Reads `contact_id` from the path. The access check resolves the contact's
/// owning `team_id` (its parent company's team) from the same ownership row
/// and bundles it into the receipt.
#[derive(Debug)]
pub struct CrmContactAccessLevelExtractor<T: RequiredPermission, Svc, Auth> {
    /// Capability token authorizing CRM contact service calls.
    pub receipt: CrmContactReceipt<T>,
    _marker: PhantomData<(T, Svc, Auth)>,
}

impl<T, S, Svc, Auth> FromRequestParts<S> for CrmContactAccessLevelExtractor<T, Svc, Auth>
where
    T: RequiredPermission,
    Arc<Svc>: FromRef<S>,
    MacroAuthorizationState<Auth>: FromRef<S>,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(state, parts))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        let Path(path_params): Path<HashMap<String, String>> = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::BadRequest("missing contact_id path parameter"))?;
        let contact_id = extract_contact_id(&path_params)?.to_string();

        let authorization =
            MacroAuthorizationExtractor::<Auth, UserOrInternal>::from_request_parts(parts, state)
                .await
                .map_err(ExtractorError::from)?;
        let macro_user_id = authorization.authorization.user.macro_user_id.clone();

        let (permission, team_id, team_role) = service
            .get_crm_entity_permission_with_team(
                Some(&macro_user_id),
                &contact_id,
                EntityType::CrmContact,
            )
            .await
            .map_err(ExtractorError::from)?;

        if !permission.satisfies::<T>() {
            return Err(ExtractorError::Unauthorized);
        }

        let receipt = EntityAccessReceipt::try_new_authenticated_user(
            macro_user_id,
            Entity {
                entity_id: contact_id,
                entity_type: EntityType::CrmContact,
            },
            permission,
        )?;

        Ok(Self {
            receipt: CrmContactReceipt::new(receipt, team_id, team_role),
            _marker: PhantomData,
        })
    }
}

fn extract_company_id(path_params: &HashMap<String, String>) -> Result<Uuid, ExtractorError> {
    let raw_id = path_params
        .get("company_id")
        .ok_or(ExtractorError::BadRequest(
            "missing company_id path parameter",
        ))?;
    Uuid::parse_str(raw_id).map_err(|_| ExtractorError::BadRequest("invalid CRM company ID format"))
}

fn extract_contact_id(path_params: &HashMap<String, String>) -> Result<Uuid, ExtractorError> {
    let raw_id = path_params
        .get("contact_id")
        .ok_or(ExtractorError::BadRequest(
            "missing contact_id path parameter",
        ))?;
    Uuid::parse_str(raw_id).map_err(|_| ExtractorError::BadRequest("invalid CRM contact ID format"))
}

