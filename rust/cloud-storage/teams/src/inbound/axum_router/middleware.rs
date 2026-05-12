//! Middleware for team access control.

use std::marker::PhantomData;

use axum::{
    Json, RequestPartsExt,
    extract::{FromRef, FromRequestParts},
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use entity_access::domain::ports::EntityAccessService;
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;

use crate::domain::team_repo::TeamService;

use super::TeamRouterState;

/// Extractor that verifies the user has a specific permission, exposing the
/// user context so the handler doesn't need to extract it again.
pub struct TeamPremiumUserExtractor<TS: TeamService, Eas: EntityAccessService> {
    /// The authenticated user context, available for use by the handler.
    pub user_context: MacroUserExtractor,
    _ts: PhantomData<TS>,
    _eas: PhantomData<Eas>,
}

/// Errors from premium user extraction
#[derive(Debug, thiserror::Error)]
pub enum PremiumUserErr {
    /// User context failed to extract
    #[error("Internal server error")]
    UserContextErr,
    /// Failed to fetch permissions
    #[error("Failed to fetch permissions")]
    InternalErr(#[from] crate::domain::model::TeamError),
    /// User does not have the required permission
    #[error("User does not have the required permission")]
    MissingPermission,
}

impl IntoResponse for PremiumUserErr {
    fn into_response(self) -> Response {
        let err = Json(ErrorResponse {
            message: self.to_string().into(),
        });
        match self {
            PremiumUserErr::UserContextErr | PremiumUserErr::InternalErr(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, err)
            }
            PremiumUserErr::MissingPermission => (StatusCode::FORBIDDEN, err),
        }
        .into_response()
    }
}

use roles_and_permissions::domain::model::PermissionId;

/// The permission ID required to create a team.
const CREATE_TEAM_PERMISSION: [PermissionId; 2] = [
    PermissionId::ReadProfessionalFeatures,
    PermissionId::WriteStripeSubscription,
];

impl<S, TS, Eas> FromRequestParts<S> for TeamPremiumUserExtractor<TS, Eas>
where
    TeamRouterState<TS, Eas>: FromRef<S>,
    S: Send + Sync + Clone + 'static,
    TS: TeamService,
    Eas: EntityAccessService,
{
    type Rejection = PremiumUserErr;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let router_state = TeamRouterState::<TS, Eas>::from_ref(state);

        let user_context: MacroUserExtractor = parts
            .extract()
            .await
            .map_err(|_| PremiumUserErr::UserContextErr)?;

        let permissions: std::collections::HashSet<PermissionId> = router_state
            .service
            .get_team_user_permissions(&user_context.macro_user_id)
            .await?;

        for perm in CREATE_TEAM_PERMISSION {
            if !permissions.contains(&perm) {
                return Err(PremiumUserErr::MissingPermission);
            }
        }

        Ok(Self {
            user_context,
            _ts: PhantomData,
            _eas: PhantomData,
        })
    }
}
