#[cfg(test)]
mod test;

use std::{collections::HashSet, future::Future, pin::Pin, sync::Arc};

use ::axum::{
    Json,
    extract::{FromRef, FromRequestParts},
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use macro_user_id::user_id::{BorrowedUserIdStr, MacroUserIdStr};
use model_error_response::ErrorResponse;
use model_user::UserContext;
use roles_and_permissions::domain::{
    model::{PermissionId, UserRolesAndPermissionsError},
    port::UserPermissionsService,
};
use thiserror::Error;

use super::MacroAuthorizationExtractor;
use crate::MacroAuthorizationServiceHandle;

const INTERNAL_ERROR_MESSAGE: &str = "internal server error";

type UserPermissionsFuture<'a> = Pin<
    Box<
        dyn Future<Output = Result<HashSet<PermissionId>, UserRolesAndPermissionsError>>
            + Send
            + 'a,
    >,
>;

trait ErasedUserPermissionsService: Send + Sync {
    fn get_user_permissions_erased<'a>(
        &'a self,
        user_id: &'a BorrowedUserIdStr<'_>,
    ) -> UserPermissionsFuture<'a>;
}

impl<T> ErasedUserPermissionsService for T
where
    T: UserPermissionsService,
{
    fn get_user_permissions_erased<'a>(
        &'a self,
        user_id: &'a BorrowedUserIdStr<'_>,
    ) -> UserPermissionsFuture<'a> {
        Box::pin(self.get_user_permissions_for_user_id(user_id))
    }
}

/// A cloneable, type-erased user-permissions service handle.
///
/// Store this handle by value in application state so permission-aware
/// extractors do not expose the concrete roles-and-permissions service type.
#[derive(Clone)]
pub struct UserPermissionsServiceHandle {
    inner: Arc<dyn ErasedUserPermissionsService>,
}

impl UserPermissionsServiceHandle {
    /// Wrap a user-permissions service implementation in a type-erased handle.
    pub fn new<T>(service: T) -> Self
    where
        T: UserPermissionsService,
    {
        Self {
            inner: Arc::new(service),
        }
    }
}

impl UserPermissionsService for UserPermissionsServiceHandle {
    async fn get_user_permissions_for_user_id(
        &self,
        user_id: &BorrowedUserIdStr<'_>,
    ) -> Result<HashSet<PermissionId>, UserRolesAndPermissionsError> {
        self.inner.get_user_permissions_erased(user_id).await
    }
}

/// Authorization enriched with the authenticated user's typed permissions.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct PermissionedMacroAuthorizationExtractor {
    /// The validated, normalized Macro user identifier.
    pub macro_user_id: MacroUserIdStr<'static>,
    /// The complete context returned by the authorization service.
    pub user_context: UserContext,
    /// The typed permissions loaded for the original-case context user ID.
    pub permissions: HashSet<PermissionId>,
}

/// Rejection returned by permission-aware authorization extraction.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum PermissionedMacroAuthorizationRejection {
    /// Credential authorization failed.
    #[error(transparent)]
    Authorization(#[from] super::MacroAuthorizationRejection),
    /// The authenticated user's permissions could not be loaded.
    #[error("permission lookup failed")]
    PermissionLookup(#[source] UserRolesAndPermissionsError),
}

impl IntoResponse for PermissionedMacroAuthorizationRejection {
    fn into_response(self) -> Response {
        match self {
            Self::Authorization(rejection) => rejection.into_response(),
            Self::PermissionLookup(error) => {
                tracing::error!(error=?error, "failed to load user permissions");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: INTERNAL_ERROR_MESSAGE.into(),
                    }),
                )
                    .into_response()
            }
        }
    }
}

impl<S> FromRequestParts<S> for PermissionedMacroAuthorizationExtractor
where
    MacroAuthorizationServiceHandle: FromRef<S>,
    UserPermissionsServiceHandle: FromRef<S>,
    S: Send + Sync + 'static,
{
    type Rejection = PermissionedMacroAuthorizationRejection;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let authorization = MacroAuthorizationExtractor::from_request_parts(parts, state).await?;
        let original_user_id =
            BorrowedUserIdStr::try_from(authorization.user_context.user_id.as_str())
                .expect("authorization validates user IDs before permission lookup");
        let permissions_service = UserPermissionsServiceHandle::from_ref(state);
        let permissions = permissions_service
            .get_user_permissions_for_user_id(&original_user_id)
            .await
            .map_err(PermissionedMacroAuthorizationRejection::PermissionLookup)?;

        Ok(Self {
            macro_user_id: authorization.macro_user_id,
            user_context: authorization.user_context,
            permissions,
        })
    }
}
