//! Project access extractors.

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    Extension, Json, RequestExt, RequestPartsExt, async_trait,
    extract::{FromRef, FromRequest, FromRequestParts, Request},
    http::request::Parts,
};
use serde::de::DeserializeOwned;

use super::{ExtractorError, RequiredAccessLevel};
use crate::domain::{
    models::{AccessLevel, EntityType},
    ports::EntityAccessService,
};
use model::project::BasicProject;
use model_user::axum_extractor::MacroUserExtractor;

/// Validates that the user has at least the required access level to a project.
///
/// Type parameter `T` specifies the required access level.
/// Type parameter `Svc` is the entity access service implementation.
///
/// # Prerequisites
///
/// - User must be authenticated (MacroUserExtractor in extensions)
/// - Project context must be loaded (BasicProject in extensions)
#[derive(Debug)]
pub struct ProjectAccessLevelExtractor<T, Svc> {
    /// The actual access level the user has.
    pub access_level: AccessLevel,
    _marker: PhantomData<(T, Svc)>,
}

#[async_trait]
impl<T, S, Svc> FromRequestParts<S> for ProjectAccessLevelExtractor<T, Svc>
where
    T: RequiredAccessLevel,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(state, parts))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        let MacroUserExtractor { macro_user_id, .. } = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Internal)?;

        let project_context: Extension<BasicProject> = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Internal)?;

        // Owner always has full access
        if project_context.user_id == macro_user_id {
            return Ok(Self {
                access_level: AccessLevel::Owner,
                _marker: PhantomData,
            });
        }

        // Deleted items are only accessible by owner
        if project_context.deleted_at.is_some() {
            return Err(ExtractorError::UnauthorizedWithMessage(
                "only owner can access deleted resource",
            ));
        }

        // Check access via service
        let required_level = T::required_level();
        let access_level = service
            .check_access(
                &macro_user_id,
                &project_context.id,
                EntityType::Project,
                required_level,
            )
            .await
            .map_err(ExtractorError::from)?;

        Ok(Self {
            access_level,
            _marker: PhantomData,
        })
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectId {
    project_id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectParentId {
    project_parent_id: String,
}

/// Represents either a projectId or projectParentId from a request body.
#[derive(Debug, serde::Deserialize)]
#[serde(untagged)]
pub enum ProjectOrParentId {
    /// A direct project ID.
    ProjectId(ProjectId),
    /// A parent project ID.
    Parent(ProjectParentId),
}

impl From<ProjectId> for ProjectOrParentId {
    fn from(p: ProjectId) -> Self {
        ProjectOrParentId::ProjectId(p)
    }
}

impl From<ProjectParentId> for ProjectOrParentId {
    fn from(p: ProjectParentId) -> Self {
        ProjectOrParentId::Parent(p)
    }
}

impl ProjectOrParentId {
    /// Get the project ID string.
    pub fn id(&self) -> &str {
        match self {
            ProjectOrParentId::ProjectId(project_id) => project_id.project_id.as_str(),
            ProjectOrParentId::Parent(project_parent_id) => {
                project_parent_id.project_parent_id.as_str()
            }
        }
    }
}

/// Extractor which checks the body for a project and validates the access level if it exists.
///
/// Downstream consumers also use the body (which is an antipattern) so we need to keep the value around.
#[derive(Debug)]
pub enum ProjectBodyAccessLevelExtractor<T, V, Svc> {
    /// A project was found in the body and access was validated.
    FoundProject {
        /// The project ID that was found.
        project: ProjectOrParentId,
        /// Marker for the desired access level.
        desired: PhantomData<(T, Svc)>,
        /// The actual access level the user has.
        access_level: AccessLevel,
        /// The parsed body.
        body: V,
    },
    /// No project was found in the body.
    ProjectNotInBody {
        /// The parsed body.
        body: V,
        /// Marker for type parameters.
        _marker: PhantomData<(T, Svc)>,
    },
}

impl<T, V, Svc> ProjectBodyAccessLevelExtractor<T, V, Svc> {
    /// Extract the body from this extractor.
    pub fn into_inner(self) -> V {
        match self {
            ProjectBodyAccessLevelExtractor::FoundProject { body, .. } => body,
            ProjectBodyAccessLevelExtractor::ProjectNotInBody { body, .. } => body,
        }
    }
}

#[async_trait]
impl<T, S, V, Svc> FromRequest<S> for ProjectBodyAccessLevelExtractor<T, V, Svc>
where
    T: RequiredAccessLevel,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
    S: Send + Sync + 'static,
    V: DeserializeOwned,
{
    type Rejection = ExtractorError;

    async fn from_request(mut req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        let MacroUserExtractor { macro_user_id, .. } = req
            .extract_parts()
            .await
            .map_err(|_| ExtractorError::Internal)?;

        let Json(json) = req
            .extract::<Json<serde_json::Value>, _>()
            .await
            .map_err(|_| ExtractorError::BadRequest("Invalid JSON body"))?;

        let json_clone = json.clone();
        let cb = move || {
            serde_json::from_value::<V>(json_clone)
                .map_err(|_| ExtractorError::BadRequest("Invalid request body"))
        };

        let Ok(Some(project)) = serde_json::from_value::<Option<ProjectOrParentId>>(json) else {
            return Ok(Self::ProjectNotInBody {
                body: cb()?,
                _marker: PhantomData,
            });
        };

        let required_level = T::required_level();
        let access_level = service
            .check_access(
                &macro_user_id,
                project.id(),
                EntityType::Project,
                required_level,
            )
            .await
            .map_err(ExtractorError::from)?;

        Ok(Self::FoundProject {
            access_level,
            project,
            desired: PhantomData,
            body: cb()?,
        })
    }
}
