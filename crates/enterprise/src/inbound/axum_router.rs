use crate::domain::{
    DisableMemberReport, EnterpriseAdminService, EnterpriseError, RuntimePresetAllowlist,
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{post, put},
};
use entity_access::{
    domain::{models::AdminTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;
use std::sync::Arc;

/// Shared team-admin router dependencies.
pub struct EnterpriseRouterState<S, Eas, Auth> {
    /// Enterprise use cases.
    pub service: Arc<S>,
    /// Team receipt minting.
    pub entity_access_service: Arc<Eas>,
    /// Caller authentication.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Eas, Auth> Clone for EnterpriseRouterState<S, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Eas, Auth> FromRef<EnterpriseRouterState<S, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &EnterpriseRouterState<S, Eas, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<S, Eas, Auth> FromRef<EnterpriseRouterState<S, Eas, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &EnterpriseRouterState<S, Eas, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

use axum::extract::FromRef;

/// Team-admin enterprise actions. No launcher, mailbox call, or destructive account route exists.
pub fn enterprise_router<S, Eas, Auth>(state: EnterpriseRouterState<S, Eas, Auth>) -> Router
where
    S: EnterpriseAdminService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Router::new()
        .route(
            "/team/members/{member_user_id}/disable",
            post(disable_member::<S, Eas, Auth>),
        )
        .route(
            "/team/members/{member_user_id}/enable",
            post(enable_member::<S, Eas, Auth>),
        )
        .route(
            "/team/runtime-presets",
            put(set_runtime_allowlist::<S, Eas, Auth>)
                .delete(clear_runtime_allowlist::<S, Eas, Auth>),
        )
        .with_state(state)
}

#[derive(serde::Deserialize)]
struct MemberPath {
    member_user_id: MacroUserIdStr<'static>,
}

async fn disable_member<S, Eas, Auth>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<EnterpriseRouterState<S, Eas, Auth>>,
    Path(path): Path<MemberPath>,
) -> Result<Json<DisableMemberReport>, EnterpriseError>
where
    S: EnterpriseAdminService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .disable_member(access.entity_access_receipt, path.member_user_id)
            .await?,
    ))
}

async fn enable_member<S, Eas, Auth>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<EnterpriseRouterState<S, Eas, Auth>>,
    Path(path): Path<MemberPath>,
) -> Result<StatusCode, EnterpriseError>
where
    S: EnterpriseAdminService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .enable_member(access.entity_access_receipt, path.member_user_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn set_runtime_allowlist<S, Eas, Auth>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<EnterpriseRouterState<S, Eas, Auth>>,
    Json(allowlist): Json<RuntimePresetAllowlist>,
) -> Result<Json<RuntimePresetAllowlist>, EnterpriseError>
where
    S: EnterpriseAdminService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .set_runtime_allowlist(access.entity_access_receipt, allowlist)
            .await?,
    ))
}

async fn clear_runtime_allowlist<S, Eas, Auth>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<EnterpriseRouterState<S, Eas, Auth>>,
) -> Result<StatusCode, EnterpriseError>
where
    S: EnterpriseAdminService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .clear_runtime_allowlist(access.entity_access_receipt)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

impl IntoResponse for EnterpriseError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::BrokerExchangeGap => StatusCode::NOT_IMPLEMENTED,
            Self::MemberDisabled | Self::RuntimePresetDenied | Self::NotTeamMember => {
                StatusCode::FORBIDDEN
            }
            Self::BindingConflict => StatusCode::CONFLICT,
            Self::UnknownUser => StatusCode::NOT_FOUND,
            Self::InvalidInput(_) => StatusCode::BAD_REQUEST,
            Self::Access(_) => StatusCode::UNAUTHORIZED,
            Self::InvalidTeam | Self::UnknownStoredPreset(_) | Self::Storage(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        let message = match self {
            Self::Storage(_) | Self::UnknownStoredPreset(_) | Self::InvalidTeam => {
                "internal server error".to_owned()
            }
            other => other.to_string(),
        };
        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}
