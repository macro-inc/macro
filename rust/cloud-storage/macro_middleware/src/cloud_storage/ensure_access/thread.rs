use std::{marker::PhantomData, sync::Arc};

use super::get_users_access_level_v2;
use crate::cloud_storage::ensure_access::{AccessLevelErr, BuildAccessLevel};
use axum::{
    Extension, RequestPartsExt, async_trait,
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};
use comms_service_client::CommsServiceClient;
use model::thread::EmailThreadPermission;
use model::user::UserContext;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::PgPool;

/// Validates the user has the desired access level to the item
#[derive(Debug)]
pub struct ThreadAccessLevelExtractor<T> {
    pub access_level: AccessLevel,
    desired: PhantomData<T>,
}

#[async_trait]
impl<T, S> FromRequestParts<S> for ThreadAccessLevelExtractor<T>
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

        let user_context: Extension<UserContext> = parts
            .extract()
            .await
            .map_err(|_| AccessLevelErr::InternalErr)?;

        let thread_context: Extension<EmailThreadPermission> = parts
            .extract()
            .await
            .map_err(|_| AccessLevelErr::InternalErr)?;

        let access_level: Option<AccessLevel> = get_users_access_level_v2(
            &db,
            &comms_client,
            &user_context.user_id,
            &thread_context.thread_id,
            "thread",
        )
        .await
        .map_err(AccessLevelErr::DbErr)?;

        let desired = T::into_access_level();

        match access_level {
            Some(access_level) if access_level >= desired => Ok(Self {
                access_level,
                desired: PhantomData,
            }),
            None | Some(_) => Err(AccessLevelErr::UnAuthorized),
        }
    }
}
