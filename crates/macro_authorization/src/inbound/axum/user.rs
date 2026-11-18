#[cfg(test)]
mod test;

use ::axum::extract::FromRef;
#[cfg(feature = "local_auth")]
use macro_env_var::maybe_env_vars;
#[cfg(feature = "local_auth")]
use model_user::UserContext;
use rootcause::Report;

use crate::{MacroAuthorizationError, MacroAuthorizationService, MacroUserAuthentication};

use super::{
    MacroAuthorizationRejection, MacroAuthorizationState, authenticated_user,
    log_authorization_failure, rejection,
};

#[cfg(feature = "local_auth")]
maybe_env_vars! {
    struct LocalUserId;
    struct LocalFusionUserId;
}

/// A user's JWT as [`macro_auth::credential::request_credential`] found it.
pub(super) struct UserToken {
    pub(super) token: String,
    /// Sent as a bearer or query parameter, not only as the ambient cookie.
    pub(super) explicit: bool,
}

/// Authenticate `token`, the request's one user token if it has one. A
/// token sent explicitly is always the one used; locally, a configured user
/// stands in for an ambient cookie or none.
pub(super) async fn authorize_optional_user_request<S, Svc>(
    state: &S,
    token: Option<UserToken>,
) -> Result<Option<MacroUserAuthentication>, MacroAuthorizationRejection>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    if let Some(UserToken {
        token,
        explicit: true,
    }) = &token
    {
        return authorize_user_token::<S, Svc>(state, token).await.map(Some);
    }

    #[cfg(feature = "local_auth")]
    if let Some(user_context) = local_user_context() {
        return authenticated_user(user_context, crate::CredentialOrigin::Session).map(Some);
    }

    match token {
        Some(UserToken { token, .. }) => authorize_user_token::<S, Svc>(state, &token)
            .await
            .map(Some),
        None => Ok(None),
    }
}

#[cfg(feature = "local_auth")]
fn local_user_context() -> Option<UserContext> {
    Some(UserContext {
        user_id: LocalUserId::new()?.to_string(),
        fusion_user_id: LocalFusionUserId::new()
            .map(|fusion_user_id| fusion_user_id.to_string())
            .unwrap_or_else(|| "set me!".to_string()),
        organization_id: Some(1),
        permissions: None,
    })
}

async fn authorize_user_token<S, Svc>(
    state: &S,
    token: &str,
) -> Result<MacroUserAuthentication, MacroAuthorizationRejection>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
{
    let authorization = MacroAuthorizationState::<Svc>::from_ref(state);
    let credential = authorization
        .service
        .authorize_identity(token)
        .await
        .map_err(authorization_rejection)?;

    let identity = credential.identity;
    let mut user = authenticated_user(
        model_user::UserContext {
            user_id: identity.user_id,
            fusion_user_id: identity.fusion_user_id,
            organization_id: identity.organization_id,
            permissions: identity.permissions,
        },
        credential.origin,
    )?;
    user.agent_id = identity.agent_id;
    user.agent_via = identity.agent_via;
    user.routine_id = identity.routine_id;
    Ok(user)
}

fn authorization_rejection(error: Report<MacroAuthorizationError>) -> MacroAuthorizationRejection {
    let message = match error.current_context() {
        MacroAuthorizationError::CredentialsExpired => "jwt expired",
        MacroAuthorizationError::InvalidCredentials
        | MacroAuthorizationError::ActingUserNotAuthorized
        | MacroAuthorizationError::BotScopeNotAuthorized
        | MacroAuthorizationError::Unavailable => "unauthorized",
    };
    log_authorization_failure(&error, "credential authorization failed");
    rejection(message)
}
