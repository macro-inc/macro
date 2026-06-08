//! Axum extractors specific to the CRM domain.
//!
//! These live in the `crm` crate rather than `entity_access` because
//! they mint CRM-domain capability tokens ([`crate::domain::auth`]) —
//! and the comment extractor additionally crosses the [`CrmService`]
//! boundary (comment → owning entity). `entity_access` deliberately
//! knows nothing about CRM models, so the CRM-typed extractors and the
//! receipts they produce are the trusted seam that lives here.

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
        models::{AccessError, Entity, EntityAccessReceipt, EntityType, RequiredPermission},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::ExtractorError,
};
use model_user::axum_extractor::MacroUserExtractor;
use uuid::Uuid;

use crate::{
    domain::{
        auth::{CrmCommentReceipt, CrmCompanyReceipt, CrmContactReceipt},
        comment::CrmCommentEntityType,
        service::CrmService,
    },
    inbound::axum_router::CrmServiceRef,
};

/// Validates that the user satisfies the required permission for a CRM
/// company and mints a [`CrmCompanyReceipt`] for downstream service calls.
///
/// Access derives from the caller's role on the owning team: team owners
/// get `Owner`, admins get `Edit`, members get `View`. Hidden companies are
/// invisible to plain members — the extractor returns `Unauthorized` rather
/// than leak existence.
///
/// Reads `company_id` from the path. The access check resolves the company's
/// owning `team_id` from the same ownership row and bundles it into the
/// receipt, so the service scopes its queries by the entity's team rather
/// than the caller's default team.
#[derive(Debug)]
pub struct CrmCompanyAccessLevelExtractor<T: RequiredPermission, Svc> {
    /// Capability token authorizing CRM company service calls.
    pub receipt: CrmCompanyReceipt<T>,
    _marker: PhantomData<(T, Svc)>,
}

impl<T, S, Svc> FromRequestParts<S> for CrmCompanyAccessLevelExtractor<T, Svc>
where
    T: RequiredPermission,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
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

        let MacroUserExtractor { macro_user_id, .. } = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Unauthorized)?;

        let (permission, team_id) = service
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
            receipt: CrmCompanyReceipt::new(receipt, team_id),
            _marker: PhantomData,
        })
    }
}

/// Validates that the user satisfies the required permission for a CRM
/// contact and mints a [`CrmContactReceipt`] for downstream service calls.
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
pub struct CrmContactAccessLevelExtractor<T: RequiredPermission, Svc> {
    /// Capability token authorizing CRM contact service calls.
    pub receipt: CrmContactReceipt<T>,
    _marker: PhantomData<(T, Svc)>,
}

impl<T, S, Svc> FromRequestParts<S> for CrmContactAccessLevelExtractor<T, Svc>
where
    T: RequiredPermission,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
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

        let MacroUserExtractor { macro_user_id, .. } = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Unauthorized)?;

        let (permission, team_id) = service
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
            receipt: CrmContactReceipt::new(receipt, team_id),
            _marker: PhantomData,
        })
    }
}

/// Validates that the user satisfies the required permission for the CRM
/// entity (company or contact) a given comment belongs to and mints a
/// [`CrmCommentReceipt`]. Reads `comment_id` from the path and resolves
/// the owning entity via `CrmService::get_comment_entity`. The same
/// role-to-AccessLevel mapping as the company / contact extractors
/// applies; hidden parents are invisible to plain members.
///
/// Returns `NotFound` when the comment doesn't exist or is soft-deleted,
/// so cross-team callers can't probe for comment existence.
#[derive(Debug)]
pub struct CrmCommentAccessLevelExtractor<T: RequiredPermission, C, Eas> {
    /// Capability token authorizing CRM comment service calls.
    pub receipt: CrmCommentReceipt<T>,
    _marker: PhantomData<(T, C, Eas)>,
}

impl<T, S, C, Eas> FromRequestParts<S> for CrmCommentAccessLevelExtractor<T, C, Eas>
where
    T: RequiredPermission,
    CrmServiceRef<C>: FromRef<S>,
    Arc<Eas>: FromRef<S>,
    C: CrmService,
    Eas: EntityAccessService,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(state, parts))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let CrmServiceRef(crm_service) = <CrmServiceRef<C>>::from_ref(state);
        let access_service = <Arc<Eas>>::from_ref(state);

        let Path(path_params): Path<HashMap<String, String>> = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::BadRequest("missing comment_id path parameter"))?;
        let comment_id = extract_comment_id(&path_params)?;

        let MacroUserExtractor { macro_user_id, .. } = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Unauthorized)?;

        let (crm_entity_type, entity_id) = crm_service
            .get_comment_entity(&comment_id)
            .await
            .map_err(|_| ExtractorError::Internal)?
            .ok_or(ExtractorError::NotFound("CRM comment not found"))?;

        let entity_type = entity_type_for(crm_entity_type);
        let entity_id_str = entity_id.to_string();

        // Map an "access denied" outcome to NotFound so a cross-team caller
        // can't tell apart "this comment doesn't exist" (404) from "this
        // comment exists but isn't yours" (401) — comment ids would
        // otherwise be a probable existence oracle.
        let (permission, team_id) = match access_service
            .get_crm_entity_permission_with_team(Some(&macro_user_id), &entity_id_str, entity_type)
            .await
        {
            Ok(pair) => pair,
            Err(AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_)) => {
                return Err(ExtractorError::NotFound("CRM comment not found"));
            }
            Err(e) => return Err(ExtractorError::from(e)),
        };

        if !permission.satisfies::<T>() {
            return Err(ExtractorError::NotFound("CRM comment not found"));
        }

        let receipt = EntityAccessReceipt::try_new_authenticated_user(
            macro_user_id,
            Entity {
                entity_id: entity_id_str,
                entity_type,
            },
            permission,
        )?;

        // entity_type is CrmCompany / CrmContact by construction, so this
        // never errors; surface any future mismatch as Internal.
        let receipt =
            CrmCommentReceipt::new(receipt, team_id).map_err(|_| ExtractorError::Internal)?;

        Ok(Self {
            receipt,
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

fn extract_comment_id(path_params: &HashMap<String, String>) -> Result<Uuid, ExtractorError> {
    let raw_id = path_params
        .get("comment_id")
        .ok_or(ExtractorError::BadRequest(
            "missing comment_id path parameter",
        ))?;
    Uuid::parse_str(raw_id).map_err(|_| ExtractorError::BadRequest("invalid comment ID format"))
}

fn entity_type_for(t: CrmCommentEntityType) -> EntityType {
    match t {
        CrmCommentEntityType::CrmCompany => EntityType::CrmCompany,
        CrmCommentEntityType::CrmContact => EntityType::CrmContact,
    }
}
