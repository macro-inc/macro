//! Axum extractors specific to the CRM domain.
//!
//! Lives in the `crm` crate rather than `entity_access` because the
//! lookups it performs (e.g. comment → owning entity) cross the
//! `CrmService` boundary, and `entity_access` deliberately knows nothing
//! about CRM models.

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
    domain::{comment::CrmCommentEntityType, service::CrmService},
    inbound::axum_router::CrmServiceRef,
};

/// Validates that the user satisfies the required permission for the CRM
/// entity (company or contact) a given comment belongs to. Reads
/// `comment_id` from the path and resolves the owning entity via
/// `CrmService::get_comment_entity`. The same role-to-AccessLevel
/// mapping as the company / contact extractors applies; hidden parents
/// are invisible to plain members.
///
/// Returns `NotFound` when the comment doesn't exist or is soft-deleted,
/// so cross-team callers can't probe for comment existence.
#[derive(Debug)]
pub struct CrmCommentAccessLevelExtractor<T: RequiredPermission, C, Eas> {
    /// The entity access receipt for the comment's owning entity.
    pub entity_access_receipt: EntityAccessReceipt<T>,
    /// Which CRM entity kind the comment is attached to.
    pub entity_type: CrmCommentEntityType,
    /// The owning team id, looked up alongside the access check.
    pub team_id: Uuid,
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
        let permission = match access_service
            .get_entity_permission(Some(&macro_user_id), &entity_id_str, entity_type, None)
            .await
        {
            Ok(p) => p,
            Err(AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_)) => {
                return Err(ExtractorError::NotFound("CRM comment not found"));
            }
            Err(e) => return Err(ExtractorError::from(e)),
        };

        if !permission.satisfies::<T>() {
            return Err(ExtractorError::NotFound("CRM comment not found"));
        }

        let team_id = access_service
            .get_user_team(&macro_user_id)
            .await
            .map_err(ExtractorError::from)?
            .ok_or(ExtractorError::Unauthorized)?
            .team_id;

        Ok(Self {
            entity_access_receipt: EntityAccessReceipt::try_new_authenticated_user(
                macro_user_id,
                Entity {
                    entity_id: entity_id_str,
                    entity_type,
                },
                permission,
            )?,
            entity_type: crm_entity_type,
            team_id,
            _marker: PhantomData,
        })
    }
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
