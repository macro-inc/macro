//! Project access extractors.

#[cfg(test)]
mod test;

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    Extension, Json, RequestExt, RequestPartsExt,
    extract::{FromRef, FromRequest, FromRequestParts, Request},
    http::request::Parts,
};
use macro_authorization::{
    AnyPrincipal, MacroAuthorization, MacroAuthorizationService, MacroAuthorizationState,
    OptionalMacroAuthorizationExtractor,
};
use macro_user_id::user_id::MacroUserIdStr;
use serde::de::DeserializeOwned;

use super::{ExtractorError, RequiredPermission, bot::generate_bot_entity_access_receipt};
use crate::domain::{
    models::{
        AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    },
    ports::EntityAccessService,
};
use model::project::BasicProject;

/// Validates that the user has at least the required access level to a project.
///
/// Type parameter `T` specifies the required access level.
/// Type parameter `Svc` is the entity access service implementation.
/// Type parameter `Auth` is the authorization service implementation.
///
/// # Prerequisites
///
/// - Project context must be loaded (`BasicProject` in extensions)
#[derive(Debug)]
pub struct ProjectAccessLevelExtractor<T: RequiredPermission, Svc, Auth> {
    /// The entity access receipt
    pub entity_access_receipt: EntityAccessReceipt<T>,
    _marker: PhantomData<(T, Svc, Auth)>,
}

impl<T, S, Svc, Auth> FromRequestParts<S> for ProjectAccessLevelExtractor<T, Svc, Auth>
where
    T: RequiredPermission,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
    MacroAuthorizationState<Auth>: FromRef<S>,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(state, parts))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        let authorization =
            OptionalMacroAuthorizationExtractor::<Auth, AnyPrincipal>::from_request_parts(
                parts, state,
            )
            .await
            .map_err(ExtractorError::from)?;

        let project_context: Extension<BasicProject> = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Internal)?;

        if matches!(
            authorization.authorization.as_ref(),
            Some(MacroAuthorization::Internal(None))
        ) {
            return Ok(Self {
                entity_access_receipt: project_access_receipt(
                    &project_context.id,
                    EntityAccessAuth::Internal,
                    EntityPermission::AccessLevel {
                        access_level: AccessLevel::Owner,
                    },
                ),
                _marker: PhantomData,
            });
        }

        let macro_user_id = match authorization.authorization.as_ref() {
            Some(MacroAuthorization::User(user))
            | Some(MacroAuthorization::Internal(Some(user))) => Some(user.macro_user_id.clone()),
            Some(MacroAuthorization::Bot(_))
            | Some(MacroAuthorization::Harness(_))
            | Some(MacroAuthorization::Internal(None))
            | None => None,
        };

        if let Some(ref user_id) = macro_user_id
            && project_context.user_id == *user_id
        {
            return Ok(Self {
                entity_access_receipt: project_access_receipt(
                    &project_context.id,
                    EntityAccessAuth::Authenticated(user_id.clone()),
                    EntityPermission::AccessLevel {
                        access_level: AccessLevel::Owner,
                    },
                ),
                _marker: PhantomData,
            });
        }

        if let Some(MacroAuthorization::Bot(bot)) = authorization.authorization.as_ref() {
            let entity_access_receipt = generate_bot_entity_access_receipt::<T>(
                service.as_ref(),
                bot,
                &project_context.id,
                EntityType::Project,
            )
            .await?;

            if project_context.deleted_at.is_some()
                && !matches!(
                    entity_access_receipt.entity_permission(),
                    EntityPermission::AccessLevel {
                        access_level: AccessLevel::Owner
                    }
                )
            {
                return Err(ExtractorError::UnauthorizedWithMessage(
                    "only owner can access deleted resource",
                ));
            }

            return Ok(Self {
                entity_access_receipt,
                _marker: PhantomData,
            });
        }

        // Deleted items are only accessible by owner.
        if project_context.deleted_at.is_some() {
            return Err(ExtractorError::UnauthorizedWithMessage(
                "only owner can access deleted resource",
            ));
        }

        let entity_access_receipt =
            get_project_access_receipt(service.as_ref(), macro_user_id, &project_context.id)
                .await?;

        Ok(Self {
            entity_access_receipt,
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
/// Downstream consumers also use the body (which is an antipattern) so we need
/// to keep the value around. Identity is resolved through
/// [`OptionalMacroAuthorizationExtractor`], which natively supports all
/// principals. Type parameter `T` specifies the required project access
/// level, `V` is the request body, `Svc` is the entity access service, and
/// `Auth` is the authorization service.
#[derive(Debug)]
pub enum ProjectBodyAccessLevelExtractorV2<T: RequiredPermission, V, Svc, Auth> {
    /// A project was found in the body and access was validated.
    FoundProject {
        /// The project ID that was found.
        project: ProjectOrParentId,
        /// Marker for the extractor's service and permission types.
        desired: PhantomData<(T, Svc, Auth)>,
        /// The entity access receipt.
        entity_access_receipt: EntityAccessReceipt<T>,
        /// The parsed body.
        body: V,
    },
    /// No project was found in the body.
    ProjectNotInBody {
        /// The parsed body.
        body: V,
        /// Marker for the extractor's service and permission types.
        _marker: PhantomData<(T, Svc, Auth)>,
    },
}

impl<T: RequiredPermission, V, Svc, Auth> ProjectBodyAccessLevelExtractorV2<T, V, Svc, Auth> {
    /// Extract the body from this extractor.
    pub fn into_inner(self) -> V {
        match self {
            Self::FoundProject { body, .. } | Self::ProjectNotInBody { body, .. } => body,
        }
    }

    fn from_outcome(outcome: ProjectBodyAccessOutcome<T, V>) -> Self {
        match outcome {
            ProjectBodyAccessOutcome::FoundProject {
                project,
                entity_access_receipt,
                body,
            } => Self::FoundProject {
                project,
                desired: PhantomData,
                entity_access_receipt,
                body,
            },
            ProjectBodyAccessOutcome::ProjectNotInBody { body } => Self::ProjectNotInBody {
                body,
                _marker: PhantomData,
            },
        }
    }
}

impl<T, S, V, Svc, Auth> FromRequest<S> for ProjectBodyAccessLevelExtractorV2<T, V, Svc, Auth>
where
    T: RequiredPermission,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
    MacroAuthorizationState<Auth>: FromRef<S>,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
    V: DeserializeOwned,
{
    type Rejection = ExtractorError;

    async fn from_request(mut req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);
        let authorization: OptionalMacroAuthorizationExtractor<Auth, AnyPrincipal> = req
            .extract_parts_with_state(state)
            .await
            .map_err(ExtractorError::from)?;

        extract_project_body_access(req, service, authorization.authorization)
            .await
            .map(Self::from_outcome)
    }
}

enum ProjectBodyAccessOutcome<T: RequiredPermission, V> {
    FoundProject {
        project: ProjectOrParentId,
        entity_access_receipt: EntityAccessReceipt<T>,
        body: V,
    },
    ProjectNotInBody {
        body: V,
    },
}

async fn extract_project_body_access<T, V, Svc>(
    req: Request,
    service: Arc<Svc>,
    authorization: Option<MacroAuthorization>,
) -> Result<ProjectBodyAccessOutcome<T, V>, ExtractorError>
where
    T: RequiredPermission,
    V: DeserializeOwned,
    Svc: EntityAccessService,
{
    let Json(json) = req
        .extract::<Json<serde_json::Value>, _>()
        .await
        .map_err(|_| ExtractorError::BadRequest("Invalid JSON body"))?;
    let project = serde_json::from_value::<Option<ProjectOrParentId>>(json.clone());

    let Ok(Some(project)) = project else {
        return Ok(ProjectBodyAccessOutcome::ProjectNotInBody {
            body: deserialize_body(json)?,
        });
    };

    // An empty id clears the entity's project: no target project to authorize.
    if project.id().is_empty() {
        return Ok(ProjectBodyAccessOutcome::ProjectNotInBody {
            body: deserialize_body(json)?,
        });
    }

    let entity_access_receipt = match authorization {
        Some(MacroAuthorization::Internal(None)) => project_access_receipt(
            project.id(),
            EntityAccessAuth::Internal,
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Owner,
            },
        ),
        Some(MacroAuthorization::Bot(bot)) => {
            generate_bot_entity_access_receipt::<T>(
                service.as_ref(),
                &bot,
                project.id(),
                EntityType::Project,
            )
            .await?
        }
        Some(MacroAuthorization::User(user)) | Some(MacroAuthorization::Internal(Some(user))) => {
            get_project_access_receipt(service.as_ref(), Some(user.macro_user_id), project.id())
                .await?
        }
        Some(MacroAuthorization::Harness(_)) => return Err(ExtractorError::Unauthorized),
        None => get_project_access_receipt(service.as_ref(), None, project.id()).await?,
    };

    Ok(ProjectBodyAccessOutcome::FoundProject {
        project,
        entity_access_receipt,
        body: deserialize_body(json)?,
    })
}

async fn get_project_access_receipt<T: RequiredPermission>(
    service: &impl EntityAccessService,
    macro_user_id: Option<MacroUserIdStr<'static>>,
    project_id: &str,
) -> Result<EntityAccessReceipt<T>, ExtractorError> {
    let access_level = service
        .get_access_level(macro_user_id.as_deref(), project_id, EntityType::Project)
        .await
        .map_err(ExtractorError::from)?
        .ok_or(ExtractorError::Unauthorized)?;
    let permission = EntityPermission::AccessLevel { access_level };
    if !permission.satisfies::<T>() {
        return Err(ExtractorError::Unauthorized);
    }
    let auth = macro_user_id
        .map(EntityAccessAuth::Authenticated)
        .unwrap_or(EntityAccessAuth::Unauthenticated);

    Ok(project_access_receipt(project_id, auth, permission))
}

fn deserialize_body<V: DeserializeOwned>(json: serde_json::Value) -> Result<V, ExtractorError> {
    serde_json::from_value(json).map_err(|_| ExtractorError::BadRequest("Invalid request body"))
}

fn project_access_receipt<T: RequiredPermission>(
    project_id: &str,
    auth: EntityAccessAuth,
    entity_permission: EntityPermission,
) -> EntityAccessReceipt<T> {
    EntityAccessReceipt {
        entity: Entity {
            entity_id: project_id.to_owned(),
            entity_type: EntityType::Project,
        },
        auth,
        entity_permission,
        _marker: PhantomData,
    }
}
