use std::marker::PhantomData;
use std::sync::Arc;

use crate::cloud_storage::ensure_access::{
    AccessLevelErr, BuildAccessLevel, get_users_access_level_v2,
};
use axum::async_trait;
use axum::extract::FromRef;
use axum::http::request::Parts;
use axum::{
    Extension,
    extract::{FromRequestParts, Path},
};
use comms_service_client::CommsServiceClient;
use model::user::UserContext;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::PgPool;

#[derive(serde::Deserialize)]
pub struct Params {
    pub item_id: String,
    pub item_type: String,
}

#[derive(Clone)]
pub struct HistoryAccessExtractor<T> {
    pub access_level: AccessLevel,
    desired: PhantomData<T>,
}

#[async_trait]
impl<T, S> FromRequestParts<S> for HistoryAccessExtractor<T>
where
    T: BuildAccessLevel,
    PgPool: FromRef<S>,
    Arc<CommsServiceClient>: FromRef<S>,
    S: Send + Sync + 'static,
{
    type Rejection = AccessLevelErr;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let db = PgPool::from_ref(state);
        let comms_client = <Arc<CommsServiceClient>>::from_ref(state);
        let user_context: Extension<UserContext> =
            <Extension<UserContext>>::from_request_parts(parts, state)
                .await
                .map_err(|_| AccessLevelErr::InternalErr)?;
        let Path(Params { item_id, item_type }) = <Path<Params>>::from_request_parts(parts, state)
            .await
            .map_err(|_| AccessLevelErr::BadRequest)?;

        let access_level: Option<AccessLevel> = get_users_access_level_v2(
            &db,
            &comms_client,
            &user_context.user_id,
            &item_id,
            &item_type,
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
