use std::{marker::PhantomData, sync::Arc};

use axum::{
    Extension, async_trait,
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};
use comms_service_client::CommsServiceClient;
use sqlx::PgPool;

use super::get_users_access_level_v2;
use crate::cloud_storage::ensure_access::{AccessLevelErr, BuildAccessLevel};
use model::{document::DocumentBasic, user::UserContext};
use models_permissions::share_permission::access_level::AccessLevel;

#[derive(Debug)]
pub struct DocumentAccessExtractor<T> {
    pub access_level: AccessLevel,
    desired: PhantomData<T>,
}

#[async_trait]
impl<T, S> FromRequestParts<S> for DocumentAccessExtractor<T>
where
    T: BuildAccessLevel,
    PgPool: FromRef<S>,
    Arc<CommsServiceClient>: FromRef<S>,
    S: Send + Sync + 'static,
{
    type Rejection = AccessLevelErr;

    #[tracing::instrument(ret, err, skip(state, parts))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let db = PgPool::from_ref(state);
        let comms_client = <Arc<CommsServiceClient>>::from_ref(state);

        let user_context: Extension<UserContext> =
            <Extension<UserContext>>::from_request_parts(parts, state)
                .await
                .map_err(|_| AccessLevelErr::InternalErr)?;
        let document_context: Extension<DocumentBasic> =
            <Extension<DocumentBasic>>::from_request_parts(parts, state)
                .await
                .map_err(|_| AccessLevelErr::InternalErr)?;

        if document_context.owner == user_context.user_id {
            return Ok(Self {
                access_level: AccessLevel::Owner,
                desired: PhantomData,
            });
        }

        // If the was deleted and you are not the owner, you can't access it
        if document_context.deleted_at.is_some() {
            return Err(AccessLevelErr::UnAuthorizedWithMsg(
                "only owner can access deleted resource",
            ));
        }

        let access_level: Option<AccessLevel> = get_users_access_level_v2(
            &db,
            &comms_client,
            &user_context.user_id,
            &document_context.document_id,
            "document",
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
