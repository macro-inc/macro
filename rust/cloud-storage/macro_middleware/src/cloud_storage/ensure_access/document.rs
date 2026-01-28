use std::marker::PhantomData;

use axum::{
    Extension, RequestPartsExt, async_trait,
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};
use sqlx::PgPool;

use super::{EntityType, get_public_access_level, get_users_access_level_v2};
use crate::cloud_storage::ensure_access::{AccessLevelErr, BuildAccessLevel};
use model::document::DocumentBasic;
use model_user::axum_extractor::OptionalMacroUserExtractor;
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
    S: Send + Sync + 'static,
{
    type Rejection = AccessLevelErr;

    #[tracing::instrument(ret, err, skip(state, parts))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let db = PgPool::from_ref(state);

        let OptionalMacroUserExtractor {
            macro_user_id,
            user_context,
            ..
        } = parts
            .extract()
            .await
            .map_err(|_| AccessLevelErr::InternalErr)?;

        let document_context: Extension<DocumentBasic> =
            <Extension<DocumentBasic>>::from_request_parts(parts, state)
                .await
                .map_err(|_| AccessLevelErr::InternalErr)?;

        // Check ownership only if authenticated
        if let Some(ref user_id) = macro_user_id
            && document_context.owner == *user_id
        {
            return Ok(Self {
                access_level: AccessLevel::Owner,
                desired: PhantomData,
            });
        }

        // If the document was deleted and you are not the owner, you can't access it
        if document_context.deleted_at.is_some() {
            return Err(AccessLevelErr::UnAuthorizedWithMsg(
                "only owner can access deleted resource",
            ));
        }

        // Check access based on auth state
        let access_level: Option<AccessLevel> = match macro_user_id {
            Some(_) => {
                // Authenticated user: check user-specific and public access
                get_users_access_level_v2(
                    &db,
                    &user_context.user_id,
                    &document_context.document_id,
                    "document",
                )
                .await
                .map_err(AccessLevelErr::DbErr)?
            }
            None => {
                // Unauthenticated user: check public access only
                get_public_access_level(&db, &document_context.document_id, EntityType::Document)
                    .await
                    .map_err(AccessLevelErr::DbErr)?
            }
        };

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
