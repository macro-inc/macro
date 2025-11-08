use super::get_users_access_level_v2;
use crate::cloud_storage::ensure_access::{AccessLevelErr, BuildAccessLevel};
use axum::{
    Extension, Json, RequestExt, RequestPartsExt, async_trait,
    extract::{FromRef, FromRequest, FromRequestParts, Request},
    http::request::Parts,
};
use comms_service_client::CommsServiceClient;
use model::{project::BasicProject, user::UserContext};
use models_permissions::share_permission::access_level::AccessLevel;
use serde::{Deserialize, de::DeserializeOwned};
use sqlx::PgPool;
use std::{marker::PhantomData, sync::Arc};

/// Validates the user has the desired access level to the item
#[derive(Debug)]
pub struct ProjectAccessLevelExtractor<T> {
    pub access_level: AccessLevel,
    desired: PhantomData<T>,
}

#[async_trait]
impl<T, S> FromRequestParts<S> for ProjectAccessLevelExtractor<T>
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

        let project_context: Extension<BasicProject> = parts
            .extract()
            .await
            .map_err(|_| AccessLevelErr::InternalErr)?;

        if project_context.user_id == user_context.user_id {
            return Ok(Self {
                access_level: AccessLevel::Owner,
                desired: PhantomData,
            });
        }

        // If the was deleted and you are not the owner, you can't access it
        if project_context.deleted_at.is_some() {
            return Err(AccessLevelErr::UnAuthorizedWithMsg(
                "only owner can access deleted resource",
            ));
        }

        let access_level: Option<AccessLevel> = get_users_access_level_v2(
            &db,
            &comms_client,
            &user_context.user_id,
            &project_context.id,
            "project",
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectId {
    project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectParentId {
    project_parent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum ProjectOrParentId {
    ProjectId(ProjectId),
    Parent(ProjectParentId),
}

impl ProjectOrParentId {
    fn id(&self) -> &str {
        match self {
            ProjectOrParentId::ProjectId(project_id) => project_id.project_id.as_str(),
            ProjectOrParentId::Parent(project_parent_id) => {
                project_parent_id.project_parent_id.as_str()
            }
        }
    }
}

/// extractor which checks the body for a project and validates the access level if it exists.
/// Downstream consumers also use the body (which is an antipattern) so we need to keep the value around
#[derive(Debug)]
pub enum ProjectBodyAccessLevelExtractor<T, V> {
    FoundProject {
        project: ProjectOrParentId,
        desired: PhantomData<T>,
        access_level: AccessLevel,
        body: V,
    },
    ProjectNotInBody {
        body: V,
    },
}

impl<T, V> ProjectBodyAccessLevelExtractor<T, V> {
    pub fn into_inner(self) -> V {
        match self {
            ProjectBodyAccessLevelExtractor::FoundProject { body, .. } => body,
            ProjectBodyAccessLevelExtractor::ProjectNotInBody { body } => body,
        }
    }
}

#[async_trait]
impl<T, S, V> FromRequest<S> for ProjectBodyAccessLevelExtractor<T, V>
where
    T: BuildAccessLevel,
    PgPool: FromRef<S>,
    Arc<CommsServiceClient>: FromRef<S>,
    S: Send + Sync + 'static,
    V: DeserializeOwned,
{
    type Rejection = AccessLevelErr;

    async fn from_request(mut req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let db = PgPool::from_ref(state);
        let comms_client = <Arc<CommsServiceClient>>::from_ref(state);

        let user_context: Extension<UserContext> = req
            .extract_parts()
            .await
            .map_err(|_| AccessLevelErr::InternalErr)?;

        let Json(json) = req
            .extract::<Json<serde_json::Value>, _>()
            .await
            .map_err(|_| AccessLevelErr::BadRequest)?;

        let json_clone = json.clone();
        let cb =
            move || serde_json::from_value::<V>(json_clone).map_err(|_| AccessLevelErr::BadRequest);

        let Ok(Some(project)) = serde_json::from_value::<Option<ProjectOrParentId>>(json) else {
            return Ok(Self::ProjectNotInBody { body: cb()? });
        };

        let access_level: Option<AccessLevel> = get_users_access_level_v2(
            &db,
            &comms_client,
            &user_context.user_id,
            project.id(),
            "project",
        )
        .await
        .map_err(AccessLevelErr::DbErr)?;

        let desired = T::into_access_level();

        match access_level {
            Some(access_level) if access_level >= desired => Ok(Self::FoundProject {
                access_level,
                project,
                desired: PhantomData,
                body: cb()?,
            }),
            None | Some(_) => Err(AccessLevelErr::UnAuthorized),
        }
    }
}
