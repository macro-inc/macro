//! Thin HTTP mapping: human authentication and CSRF at the edge, policy in PasswordService.
use crate::domain::{models::*, service::PasswordService};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRef, Path, Query, State},
    http::{HeaderValue, StatusCode, header::CACHE_CONTROL},
    middleware::{Next, from_fn, map_response},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
};
use macro_authorization::{
    CredentialOrigin, InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService,
    MacroAuthorizationState, UserOnly,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// Composition-owned domain service and authenticated transport state.
pub struct PasswordRouterState<A> {
    /// Vault use-case service; owns all product authorization decisions.
    pub service: Arc<PasswordService>,
    /// Shared Macro credential-validation boundary.
    pub authorization: MacroAuthorizationState<A>,
}
impl<A> Clone for PasswordRouterState<A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization: self.authorization.clone(),
        }
    }
}
impl<A> FromRef<PasswordRouterState<A>> for MacroAuthorizationState<A> {
    fn from_ref(state: &PasswordRouterState<A>) -> Self {
        state.authorization.clone()
    }
}

/// Build authenticated vault routes with CSRF and no-store response protections.
pub fn router<A: MacroAuthorizationService, T: Send + Sync + 'static>(
    state: PasswordRouterState<A>,
) -> Router<T> {
    Router::new()
        .route("/teams", get(teams::<A>))
        .route("/teams/{team}/items", get(list::<A>).post(create::<A>))
        .route(
            "/teams/{team}/items/{item}",
            get(detail::<A>)
                .put(update::<A>)
                .patch(patch::<A>)
                .delete(remove::<A>),
        )
        .route("/teams/{team}/items/{item}/reveal", post(reveal::<A>))
        .route("/teams/{team}/items/{item}/copy", post(copy::<A>))
        .route("/teams/{team}/items/{item}/username", get(username::<A>))
        .route(
            "/teams/{team}/items/{item}/username/copy",
            post(copy_username::<A>),
        )
        .route("/teams/{team}/items/{item}/history", get(history::<A>))
        .route("/teams/{team}/items/{item}/activity", get(activity::<A>))
        .route(
            "/teams/{team}/items/{item}/share",
            get(grants::<A>).put(share::<A>),
        )
        .route(
            "/teams/{team}/items/{item}/totp",
            put(set_totp::<A>).delete(remove_totp::<A>),
        )
        .route("/teams/{team}/items/{item}/totp/code", post(totp::<A>))
        .route(
            "/teams/{team}/folders",
            get(folders::<A>).post(create_folder::<A>),
        )
        .route(
            "/teams/{team}/folders/{folder}",
            delete(remove_folder::<A>).put(rename_folder::<A>),
        )
        .route(
            "/teams/{team}/folders/{folder}/parent",
            put(move_folder::<A>),
        )
        .layer(DefaultBodyLimit::max(256 * 1024))
        .layer(from_fn(csrf))
        .layer(map_response(no_store))
        .with_state(state)
}
/// Internal lifecycle routes accept only authenticated service identities.
/// They deliberately remain outside the public Swagger and human CSRF routes.
pub fn internal_router<A: MacroAuthorizationService, T: Send + Sync + 'static>(
    state: PasswordRouterState<A>,
) -> Router<T> {
    Router::new()
        .route("/teams/{team}", delete(purge_team_internal::<A>))
        .layer(map_response(no_store))
        .with_state(state)
}
#[tracing::instrument(skip_all,err,name="passwords.team.purge.internal",fields(team_id=%team))]
async fn purge_team_internal<A: MacroAuthorizationService>(
    _: MacroAuthorizationExtractor<A, InternalOnly>,
    State(state): State<PasswordRouterState<A>>,
    Path(team): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    state.service.purge_team(TeamId(team)).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn csrf(request: axum::extract::Request, next: Next) -> Response {
    if !matches!(
        *request.method(),
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    ) && (request
        .headers()
        .get("x-macro-passwords")
        .and_then(|value| value.to_str().ok())
        != Some("1")
        || request
            .headers()
            .get("sec-fetch-site")
            .and_then(|value| value.to_str().ok())
            == Some("cross-site"))
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    next.run(request).await
}
async fn no_store(mut response: Response) -> Response {
    if matches!(
        response.status(),
        StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY
    ) {
        *response.body_mut() = Json(Failure {
            code: FailureCode::InvalidRequest,
        })
        .into_response()
        .into_body();
        response.headers_mut().insert(
            axum::http::header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        response
            .headers_mut()
            .remove(axum::http::header::CONTENT_LENGTH);
    }
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    response
}

/// Closed, payload-free failure codes exposed by the human vault API.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = PasswordErrorCode)]
pub enum FailureCode {
    /// Absent or concealed by the caller's access boundary.
    NotFound,
    /// The caller lacks the required capability.
    Forbidden,
    /// Invalid request syntax or a violated domain invariant.
    InvalidRequest,
    /// The item's observed version no longer matches.
    VersionConflict,
    /// Lease admission or the team lease is temporarily unavailable.
    VaultBusy,
    /// The referenced folder was deleted; choose another folder and retry.
    FolderMissing,
    /// A required vault dependency is unavailable.
    VaultUnavailable,
}

/// Sanitized vault failure shared with generated HTTP clients.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
#[schema(as = PasswordFailure)]
pub struct Failure {
    /// Machine-readable category; never contains request or secret values.
    pub code: FailureCode,
}

/// Sanitized domain failure mapped to an HTTP status and fixed error code.
#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct ApiError(Error);
impl From<Error> for ApiError {
    fn from(error: Error) -> Self {
        Self(error)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = match self.0 {
            Error::NotFound => (StatusCode::NOT_FOUND, FailureCode::NotFound),
            Error::Forbidden => (StatusCode::FORBIDDEN, FailureCode::Forbidden),
            Error::Invalid => (StatusCode::BAD_REQUEST, FailureCode::InvalidRequest),
            Error::Conflict => (StatusCode::CONFLICT, FailureCode::VersionConflict),
            Error::Busy => (StatusCode::CONFLICT, FailureCode::VaultBusy),
            Error::FolderMissing => (StatusCode::CONFLICT, FailureCode::FolderMissing),
            Error::Unavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                FailureCode::VaultUnavailable,
            ),
        };
        (status, Json(Failure { code })).into_response()
    }
}
fn actor<A: MacroAuthorizationService>(
    user: MacroAuthorizationExtractor<A, UserOnly>,
) -> Result<Actor, ApiError> {
    if user.authorization.origin != CredentialOrigin::Session {
        return Err(ApiError(Error::Forbidden));
    }
    Ok(Actor {
        user_id: user.authorization.macro_user_id,
    })
}
#[derive(Deserialize, utoipa::IntoParams)]
/// Metadata-only search parameters.
pub struct Search {
    /// Optional metadata search text; never a value search.
    pub search: Option<String>,
}
#[derive(Deserialize, utoipa::ToSchema)]
#[schema(as=PasswordRevealBody)]
/// Explicit historical version selection for protected disclosure.
pub struct RevealBody {
    /// Requested historic version, or the currently committed version.
    pub version: Option<i32>,
}
#[derive(Deserialize, utoipa::ToSchema)]
#[schema(as=PasswordShareBody)]
/// Owner-requested replacement of the explicit grant set.
pub struct ShareBody {
    /// Complete desired recipient set; an empty list revokes sharing.
    pub grants: Vec<Grant>,
}
#[derive(Deserialize, utoipa::ToSchema)]
#[schema(as=PasswordFolderBody)]
/// Validated folder display-name request.
pub struct FolderBody {
    /// Folder display name.
    pub name: String,
}
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as=PasswordCreateFolderBody)]
/// New folder, at the top level or inside another folder of the team.
pub struct CreateFolderBody {
    /// Folder display name.
    pub name: String,
    /// Containing folder; absent or null for a top-level folder.
    #[serde(default)]
    pub parent_id: Option<Uuid>,
}
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as=PasswordMoveFolderBody)]
/// New containing folder for an existing folder.
pub struct MoveFolderBody {
    /// Containing folder; null moves the folder to the top level.
    pub parent_id: Option<Uuid>,
}
#[derive(Deserialize, utoipa::ToSchema)]
#[schema(as=PasswordTotpBody)]
/// Private seed submitted only to the verification-code provider.
pub struct TotpBody {
    /// Confidential base32 verification-code seed.
    pub key: SecretString,
}

#[utoipa::path(operation_id = "passwords_teams",get,path="/passwords/teams",responses((status=200,body=Vec<TeamId>),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// List current teams available to the authenticated human.
pub async fn teams<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
) -> Result<Json<Vec<TeamId>>, ApiError> {
    Ok(Json(state.service.teams(&actor(user)?).await?))
}
#[utoipa::path(operation_id = "passwords_list",get,path="/passwords/teams/{team}/items",params(("team"=Uuid,Path),Search),responses((status=200,body=Vec<ItemView>),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Search authorized metadata without resolving private values.
pub async fn list<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path(team): Path<Uuid>,
    Query(query): Query<Search>,
) -> Result<Json<Vec<ItemView>>, ApiError> {
    Ok(Json(
        state
            .service
            .list(
                &actor(user)?,
                TeamId(team),
                query.search.as_deref().unwrap_or(""),
            )
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_create",post,path="/passwords/teams/{team}/items",params(("team"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=WriteItem,responses((status=200,body=ItemView),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Create one item using an idempotent logical operation identifier.
pub async fn create<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path(team): Path<Uuid>,
    Json(command): Json<WriteItem>,
) -> Result<Json<ItemView>, ApiError> {
    Ok(Json(
        state
            .service
            .create(&actor(user)?, TeamId(team), command)
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_detail",get,path="/passwords/teams/{team}/items/{item}",params(("team"=Uuid,Path),("item"=Uuid,Path)),responses((status=200,body=ItemView),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Read authorized item metadata only.
pub async fn detail<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
) -> Result<Json<ItemView>, ApiError> {
    Ok(Json(
        state
            .service
            .get(&actor(user)?, TeamId(team), ItemId(item))
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_username",get,path="/passwords/teams/{team}/items/{item}/username",params(("team"=Uuid,Path),("item"=Uuid,Path)),responses((status=200,body=Username),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Read only the current account identifier with normal human view authorization.
pub async fn username<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
) -> Result<Json<Username>, ApiError> {
    Ok(Json(
        state
            .service
            .username(&actor(user)?, TeamId(team), ItemId(item), false)
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_copy_username",post,path="/passwords/teams/{team}/items/{item}/username/copy",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),responses((status=200,body=Username),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Read only the current account identifier and record an explicit clipboard action.
pub async fn copy_username<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
) -> Result<Json<Username>, ApiError> {
    Ok(Json(
        state
            .service
            .username(&actor(user)?, TeamId(team), ItemId(item), true)
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_update",put,path="/passwords/teams/{team}/items/{item}",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=WriteItem,responses((status=200,body=ItemView),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Save a new protected value version and its metadata.
pub async fn update<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
    Json(command): Json<WriteItem>,
) -> Result<Json<ItemView>, ApiError> {
    Ok(Json(
        state
            .service
            .update(&actor(user)?, TeamId(team), ItemId(item), command)
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_patch",patch,path="/passwords/teams/{team}/items/{item}",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=PatchItem,responses((status=200,body=ItemView),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Change metadata without resolving private values.
pub async fn patch<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
    Json(command): Json<PatchItem>,
) -> Result<Json<ItemView>, ApiError> {
    Ok(Json(
        state
            .service
            .patch(&actor(user)?, TeamId(team), ItemId(item), command)
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_remove",delete,path="/passwords/teams/{team}/items/{item}",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),responses((status=204),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Delete an owned item with a resumable provider fence.
pub async fn remove<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .delete(&actor(user)?, TeamId(team), ItemId(item))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(operation_id = "passwords_reveal",post,path="/passwords/teams/{team}/items/{item}/reveal",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=RevealBody,responses((status=200,body=Revealed),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Disclose a current or historical value with normal human-session item access.
pub async fn reveal<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
    Json(body): Json<RevealBody>,
) -> Result<Json<Revealed>, ApiError> {
    Ok(Json(
        state
            .service
            .reveal(
                &actor(user)?,
                TeamId(team),
                ItemId(item),
                body.version,
                false,
            )
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_copy",post,path="/passwords/teams/{team}/items/{item}/copy",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=RevealBody,responses((status=200,body=Revealed),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Disclose values for an explicitly audited clipboard action.
pub async fn copy<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
    Json(body): Json<RevealBody>,
) -> Result<Json<Revealed>, ApiError> {
    Ok(Json(
        state
            .service
            .copy(&actor(user)?, TeamId(team), ItemId(item), body.version)
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_history",get,path="/passwords/teams/{team}/items/{item}/history",params(("team"=Uuid,Path),("item"=Uuid,Path)),responses((status=200,body=Vec<Version>),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// List protected-value version metadata.
pub async fn history<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<Version>>, ApiError> {
    Ok(Json(
        state
            .service
            .history(&actor(user)?, TeamId(team), ItemId(item))
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_activity",get,path="/passwords/teams/{team}/items/{item}/activity",params(("team"=Uuid,Path),("item"=Uuid,Path)),responses((status=200,body=Vec<Activity>),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// List recorded activity for an authorized item.
pub async fn activity<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<Activity>>, ApiError> {
    Ok(Json(
        state
            .service
            .activity(&actor(user)?, TeamId(team), ItemId(item))
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_grants",get,path="/passwords/teams/{team}/items/{item}/share",params(("team"=Uuid,Path),("item"=Uuid,Path)),responses((status=200,body=Vec<Grant>),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Read the owned item’s explicit recipient set.
pub async fn grants<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<Grant>>, ApiError> {
    Ok(Json(
        state
            .service
            .grants(&actor(user)?, TeamId(team), ItemId(item))
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_share",put,path="/passwords/teams/{team}/items/{item}/share",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=ShareBody,responses((status=204),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Replace the owned item’s explicit recipient set.
pub async fn share<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
    Json(body): Json<ShareBody>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .share(&actor(user)?, TeamId(team), ItemId(item), body.grants)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(operation_id = "passwords_folders",get,path="/passwords/teams/{team}/folders",params(("team"=Uuid,Path)),responses((status=200,body=Vec<Folder>),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// List the authenticated team’s folders.
pub async fn folders<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path(team): Path<Uuid>,
) -> Result<Json<Vec<Folder>>, ApiError> {
    Ok(Json(
        state.service.folders(&actor(user)?, TeamId(team)).await?,
    ))
}
#[utoipa::path(operation_id = "passwords_create_folder",post,path="/passwords/teams/{team}/folders",params(("team"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=CreateFolderBody,responses((status=200,body=Folder),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Create a folder within the authenticated team.
pub async fn create_folder<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path(team): Path<Uuid>,
    Json(body): Json<CreateFolderBody>,
) -> Result<Json<Folder>, ApiError> {
    Ok(Json(
        state
            .service
            .create_folder(&actor(user)?, TeamId(team), body.name, body.parent_id)
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_remove_folder",delete,path="/passwords/teams/{team}/folders/{folder}",params(("team"=Uuid,Path),("folder"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),responses((status=204),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Delete a folder within the authenticated team.
pub async fn remove_folder<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, folder)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .delete_folder(&actor(user)?, TeamId(team), folder)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(operation_id = "passwords_set_totp",put,path="/passwords/teams/{team}/items/{item}/totp",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=TotpBody,responses((status=204),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Enroll or replace a verification-code seed with normal human-session edit access.
pub async fn set_totp<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
    Json(body): Json<TotpBody>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .configure_totp(&actor(user)?, TeamId(team), ItemId(item), Some(body.key))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(operation_id = "passwords_remove_totp",delete,path="/passwords/teams/{team}/items/{item}/totp",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),responses((status=204),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Remove a verification-code seed with normal human-session edit access.
pub async fn remove_totp<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .configure_totp(&actor(user)?, TeamId(team), ItemId(item), None)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(operation_id = "passwords_totp",post,path="/passwords/teams/{team}/items/{item}/totp/code",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),responses((status=200,body=TotpCode),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Resolve the current verification code with normal human-session item access.
pub async fn totp<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
) -> Result<Json<TotpCode>, ApiError> {
    Ok(Json(
        state
            .service
            .totp(&actor(user)?, TeamId(team), ItemId(item))
            .await?,
    ))
}

#[utoipa::path(operation_id = "passwords_rename_folder",put,path="/passwords/teams/{team}/folders/{folder}",params(("team"=Uuid,Path),("folder"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=FolderBody,responses((status=200,body=Folder),(status=403,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Rename a folder within the authenticated team.
pub async fn rename_folder<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, folder)): Path<(Uuid, Uuid)>,
    Json(body): Json<FolderBody>,
) -> Result<Json<Folder>, ApiError> {
    Ok(Json(
        state
            .service
            .rename_folder(&actor(user)?, TeamId(team), folder, body.name)
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_move_folder",put,path="/passwords/teams/{team}/folders/{folder}/parent",params(("team"=Uuid,Path),("folder"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=MoveFolderBody,responses((status=200,body=Folder),(status=400,body=Failure),(status=403,body=Failure),(status=404,body=Failure),(status=409,body=Failure)),tag="passwords")]
/// Move a folder under another folder of the team, or to the top level.
pub async fn move_folder<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, folder)): Path<(Uuid, Uuid)>,
    Json(body): Json<MoveFolderBody>,
) -> Result<Json<Folder>, ApiError> {
    Ok(Json(
        state
            .service
            .move_folder(&actor(user)?, TeamId(team), folder, body.parent_id)
            .await?,
    ))
}

#[cfg(test)]
pub(crate) mod test;
