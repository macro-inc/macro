use super::get_users_access_level_v2;
use crate::cloud_storage::ensure_access::{AccessLevelErr, BuildAccessLevel};
use axum::{
    Extension, async_trait,
    extract::{FromRef, FromRequestParts, Path},
    http::request::Parts,
};
use comms_service_client::CommsServiceClient;
use model::user::UserContext;
use models_permissions::share_permission::access_level::AccessLevel;
use serde::Deserialize;
use sqlx::PgPool;
use std::{marker::PhantomData, sync::Arc};

#[derive(Deserialize)]
pub struct Params {
    pub macro_prompt_id: String,
}

/// Validates the user has the desired access level to the item
/// Returns the [AccessLevel] for the user to the handler
#[derive(Debug)]
#[must_use]
pub struct MacrosAccessLevelExtractor<T> {
    /// The access level for the user
    pub access_level: AccessLevel,
    desired: PhantomData<T>,
}

#[async_trait]
impl<T, S> FromRequestParts<S> for MacrosAccessLevelExtractor<T>
where
    T: BuildAccessLevel,
    PgPool: FromRef<S>,
    Arc<CommsServiceClient>: FromRef<S>,
    S: Send + Sync + 'static,
{
    type Rejection = AccessLevelErr;

    #[tracing::instrument(ret, err, skip(parts, state))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let db = PgPool::from_ref(state);
        let comms_client = <Arc<CommsServiceClient>>::from_ref(state);
        let Extension(user_context) = <Extension<UserContext>>::from_request_parts(parts, state)
            .await
            .map_err(|_| AccessLevelErr::UnAuthorized)?;
        let Path(Params { macro_prompt_id }) = <Path<Params>>::from_request_parts(parts, state)
            .await
            .map_err(|_| AccessLevelErr::BadRequest)?;

        let access_level: Option<AccessLevel> = get_users_access_level_v2(
            &db,
            &comms_client,
            &user_context.user_id,
            &macro_prompt_id,
            "macro",
        )
        .await
        .map_err(AccessLevelErr::DbErr)?;

        let desired_level = T::into_access_level();

        match access_level {
            Some(access_level) if access_level >= desired_level => Ok(Self {
                access_level,
                desired: PhantomData,
            }),
            None | Some(_) => Err(AccessLevelErr::UnAuthorized),
        }
    }
}
