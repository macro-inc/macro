use std::marker::PhantomData;
use std::sync::Arc;

use crate::cloud_storage::ensure_access::{
    AccessLevelErr, BuildAccessLevel, get_users_access_level_v2,
};
use axum::extract::FromRef;
use axum::{
    Extension, async_trait,
    extract::{FromRequest, Path, Request},
};
use axum::{Json, RequestExt};
use comms_service_client::CommsServiceClient;
use model::user::UserContext;
use models_permissions::share_permission::access_level::AccessLevel;
use serde::de::DeserializeOwned;
use sqlx::PgPool;

#[derive(serde::Deserialize)]
pub struct Params {
    pub pinned_item_id: String,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonBodyWithPinType {
    pub pin_type: String,
}

/// Validates the user has access to pin the particular item
#[derive(Debug)]
pub struct PinAccessLevelExtractor<T, V> {
    /// the access level the user has, guaranteed to be >= T
    pub access_level: AccessLevel,
    /// the type of pin extracted from the request body
    pub pin_type: JsonBodyWithPinType,
    pub inner: V,
    desired: PhantomData<T>,
}

#[async_trait]
impl<T, S, V> FromRequest<S> for PinAccessLevelExtractor<T, V>
where
    T: BuildAccessLevel,
    PgPool: FromRef<S>,
    Arc<CommsServiceClient>: FromRef<S>,
    V: DeserializeOwned + std::fmt::Debug,
    S: Send + Sync + 'static,
{
    type Rejection = AccessLevelErr;

    #[tracing::instrument(ret, err, skip(req, state))]
    async fn from_request(mut req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let db = PgPool::from_ref(state);
        let comms_client = <Arc<CommsServiceClient>>::from_ref(state);

        let user_context: Extension<UserContext> = req
            .extract_parts()
            .await
            .map_err(|_| AccessLevelErr::InternalErr)?;

        let Path(Params { pinned_item_id }) = req
            .extract_parts_with_state(state)
            .await
            .map_err(|_| AccessLevelErr::BadRequest)?;

        let Json(json): Json<serde_json::Value> = req
            .extract()
            .await
            .map_err(|_| AccessLevelErr::BadRequest)?;

        let json_clone = json.clone();

        let JsonBodyWithPinType { pin_type } =
            serde_json::from_value(json).map_err(|_| AccessLevelErr::BadRequest)?;

        let access_level: Option<AccessLevel> = get_users_access_level_v2(
            &db,
            &comms_client,
            &user_context.user_id,
            &pinned_item_id,
            &pin_type,
        )
        .await
        .map_err(AccessLevelErr::DbErr)?;

        let desired = T::into_access_level();

        match access_level {
            Some(access_level) if access_level >= desired => Ok(Self {
                access_level,
                pin_type: JsonBodyWithPinType { pin_type },
                inner: serde_json::from_value(json_clone)
                    .map_err(|_| AccessLevelErr::BadRequest)?,
                desired: PhantomData,
            }),
            None | Some(_) => Err(AccessLevelErr::UnAuthorized),
        }
    }
}
