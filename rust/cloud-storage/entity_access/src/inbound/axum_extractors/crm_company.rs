//! CRM company access extractor.

use std::collections::HashMap;
use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    RequestPartsExt,
    extract::{FromRef, FromRequestParts, Path},
    http::request::Parts,
};
use uuid::Uuid;

use super::{ExtractorError, RequiredPermission};
use crate::domain::{
    models::{Entity, EntityAccessAuth, EntityAccessReceipt, EntityType},
    ports::EntityAccessService,
};
use model_user::axum_extractor::MacroUserExtractor;

/// Validates that the user satisfies the required permission for a CRM
/// company and exposes the owning `team_id` for downstream service calls.
///
/// Access derives from the caller's role on the owning team: team owners
/// get `Owner`, admins get `Edit`, members get `View`. Hidden companies are
/// invisible to plain members — the extractor returns `Unauthorized` rather
/// than leak existence.
///
/// Reads `company_id` from the path. The owning `team_id` is resolved via
/// the user's `team_user` membership so handlers can keep passing it to
/// existing team-scoped service methods without a second query in the
/// handler.
#[derive(Debug)]
pub struct CrmCompanyAccessLevelExtractor<T: RequiredPermission, Svc> {
    /// The entity access receipt.
    pub entity_access_receipt: EntityAccessReceipt<T>,
    /// The id of the team that owns the company. Looked up alongside the
    /// access check so handlers don't need to re-query.
    pub team_id: Uuid,
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

        let permission = service
            .get_entity_permission(
                Some(&macro_user_id),
                &company_id,
                EntityType::CrmCompany,
                None,
            )
            .await
            .map_err(ExtractorError::from)?;

        if !permission.satisfies::<T>() {
            return Err(ExtractorError::Unauthorized);
        }

        let team_id = service
            .get_user_team(&macro_user_id)
            .await
            .map_err(ExtractorError::from)?
            .ok_or(ExtractorError::Unauthorized)?
            .team_id;

        Ok(Self {
            entity_access_receipt: EntityAccessReceipt {
                entity: Entity {
                    entity_id: company_id,
                    entity_type: EntityType::CrmCompany,
                },
                auth: EntityAccessAuth::Authenticated(macro_user_id),
                entity_permission: permission,
                _marker: PhantomData,
            },
            team_id,
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
