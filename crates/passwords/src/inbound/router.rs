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
use macro_auth::headers::AccessTokenExtractor;
use macro_authorization::{
    CredentialOrigin, MacroAuthorizationExtractor, MacroAuthorizationService,
    MacroAuthorizationState, UserOnly,
};
use serde::Deserialize;
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
        .layer(DefaultBodyLimit::max(256 * 1024))
        .layer(from_fn(csrf))
        .layer(map_response(no_store))
        .with_state(state)
}
async fn csrf(request: axum::extract::Request, next: Next) -> Response {
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
        *response.body_mut() = axum::body::Body::from(r#"{"code":"invalid_request"}"#);
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

/// Sanitized domain failure mapped to an HTTP status and fixed error code.
pub struct ApiError(Error);
impl From<Error> for ApiError {
    fn from(error: Error) -> Self {
        Self(error)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = match self.0 {
            Error::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            Error::Forbidden => (StatusCode::FORBIDDEN, "forbidden"),
            Error::ReauthenticationRequired => {
                (StatusCode::UNAUTHORIZED, "reauthentication_required")
            }
            Error::Invalid => (StatusCode::BAD_REQUEST, "invalid_request"),
            Error::Conflict => (StatusCode::CONFLICT, "version_conflict"),
            Error::Unavailable => (StatusCode::SERVICE_UNAVAILABLE, "vault_unavailable"),
        };
        (status, Json(serde_json::json!({"code":code}))).into_response()
    }
}
fn actor<A: MacroAuthorizationService>(
    user: MacroAuthorizationExtractor<A, UserOnly>,
    token: Option<AccessTokenExtractor>,
) -> Result<Actor, ApiError> {
    if user.authorization.origin != CredentialOrigin::Session {
        return Err(ApiError(Error::Forbidden));
    }
    Ok(Actor {
        user_id: user.authorization.macro_user_id,
        session_token: token.map(|token| SecretString(token.as_ref().into())),
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
#[schema(as=PasswordTotpBody)]
/// Private seed submitted only to the verification-code provider.
pub struct TotpBody {
    /// Confidential base32 verification-code seed.
    pub key: SecretString,
}

#[utoipa::path(operation_id = "passwords_teams",get,path="/passwords/teams",responses((status=200,body=Vec<TeamId>)),tag="passwords")]
/// List current teams available to the authenticated human.
pub async fn teams<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
) -> Result<Json<Vec<TeamId>>, ApiError> {
    Ok(Json(state.service.teams(&actor(user, None)?).await?))
}
#[utoipa::path(operation_id = "passwords_list",get,path="/passwords/teams/{team}/items",params(("team"=Uuid,Path),Search),responses((status=200,body=Vec<ItemMetadata>)),tag="passwords")]
/// Search authorized metadata without resolving private values.
pub async fn list<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path(team): Path<Uuid>,
    Query(query): Query<Search>,
) -> Result<Json<Vec<ItemMetadata>>, ApiError> {
    Ok(Json(
        state
            .service
            .list(
                &actor(user, None)?,
                TeamId(team),
                query.search.as_deref().unwrap_or(""),
            )
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_create",post,path="/passwords/teams/{team}/items",params(("team"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=WriteItem,responses((status=200,body=ItemMetadata)),tag="passwords")]
/// Create one item using an idempotent logical operation identifier.
pub async fn create<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path(team): Path<Uuid>,
    Json(command): Json<WriteItem>,
) -> Result<Json<ItemMetadata>, ApiError> {
    Ok(Json(
        state
            .service
            .create(&actor(user, None)?, TeamId(team), command)
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_detail",get,path="/passwords/teams/{team}/items/{item}",params(("team"=Uuid,Path),("item"=Uuid,Path)),responses((status=200,body=ItemMetadata)),tag="passwords")]
/// Read authorized item metadata only.
pub async fn detail<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
) -> Result<Json<ItemMetadata>, ApiError> {
    Ok(Json(
        state
            .service
            .get(&actor(user, None)?, TeamId(team), ItemId(item))
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_username",get,path="/passwords/teams/{team}/items/{item}/username",params(("team"=Uuid,Path),("item"=Uuid,Path)),responses((status=200,body=Username)),tag="passwords")]
/// Read only the current account identifier with normal human view authorization.
pub async fn username<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
) -> Result<Json<Username>, ApiError> {
    Ok(Json(
        state
            .service
            .username(&actor(user, None)?, TeamId(team), ItemId(item), false)
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_copy_username",post,path="/passwords/teams/{team}/items/{item}/username/copy",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),responses((status=200,body=Username)),tag="passwords")]
/// Read only the current account identifier and record an explicit clipboard action.
pub async fn copy_username<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
) -> Result<Json<Username>, ApiError> {
    Ok(Json(
        state
            .service
            .username(&actor(user, None)?, TeamId(team), ItemId(item), true)
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_update",put,path="/passwords/teams/{team}/items/{item}",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=WriteItem,responses((status=200,body=ItemMetadata)),tag="passwords")]
/// Save a new protected value version and its metadata.
pub async fn update<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
    Json(command): Json<WriteItem>,
) -> Result<Json<ItemMetadata>, ApiError> {
    Ok(Json(
        state
            .service
            .update(&actor(user, None)?, TeamId(team), ItemId(item), command)
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_patch",patch,path="/passwords/teams/{team}/items/{item}",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=PatchItem,responses((status=200,body=ItemMetadata)),tag="passwords")]
/// Change metadata without resolving private values.
pub async fn patch<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
    Json(command): Json<PatchItem>,
) -> Result<Json<ItemMetadata>, ApiError> {
    Ok(Json(
        state
            .service
            .patch(&actor(user, None)?, TeamId(team), ItemId(item), command)
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_remove",delete,path="/passwords/teams/{team}/items/{item}",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),responses((status=204)),tag="passwords")]
/// Delete an owned item with a resumable provider fence.
pub async fn remove<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .delete(&actor(user, None)?, TeamId(team), ItemId(item))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(operation_id = "passwords_reveal",post,path="/passwords/teams/{team}/items/{item}/reveal",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=RevealBody,responses((status=200,body=Revealed)),tag="passwords")]
/// Disclose a current or historical value after recent human authentication.
pub async fn reveal<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    token: AccessTokenExtractor,
    Path((team, item)): Path<(Uuid, Uuid)>,
    Json(body): Json<RevealBody>,
) -> Result<Json<Revealed>, ApiError> {
    Ok(Json(
        state
            .service
            .reveal(
                &actor(user, Some(token))?,
                TeamId(team),
                ItemId(item),
                body.version,
                false,
            )
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_copy",post,path="/passwords/teams/{team}/items/{item}/copy",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=RevealBody,responses((status=200,body=Revealed)),tag="passwords")]
/// Disclose values for an explicitly audited clipboard action.
pub async fn copy<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    token: AccessTokenExtractor,
    Path((team, item)): Path<(Uuid, Uuid)>,
    Json(body): Json<RevealBody>,
) -> Result<Json<Revealed>, ApiError> {
    Ok(Json(
        state
            .service
            .copy(
                &actor(user, Some(token))?,
                TeamId(team),
                ItemId(item),
                body.version,
            )
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_history",get,path="/passwords/teams/{team}/items/{item}/history",params(("team"=Uuid,Path),("item"=Uuid,Path)),responses((status=200,body=Vec<Version>)),tag="passwords")]
/// List protected-value version metadata.
pub async fn history<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<Version>>, ApiError> {
    Ok(Json(
        state
            .service
            .history(&actor(user, None)?, TeamId(team), ItemId(item))
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_activity",get,path="/passwords/teams/{team}/items/{item}/activity",params(("team"=Uuid,Path),("item"=Uuid,Path)),responses((status=200,body=Vec<Activity>)),tag="passwords")]
/// List recorded activity for an authorized item.
pub async fn activity<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<Activity>>, ApiError> {
    Ok(Json(
        state
            .service
            .activity(&actor(user, None)?, TeamId(team), ItemId(item))
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_grants",get,path="/passwords/teams/{team}/items/{item}/share",params(("team"=Uuid,Path),("item"=Uuid,Path)),responses((status=200,body=Vec<Grant>)),tag="passwords")]
/// Read the owned item’s explicit recipient set.
pub async fn grants<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<Grant>>, ApiError> {
    Ok(Json(
        state
            .service
            .grants(&actor(user, None)?, TeamId(team), ItemId(item))
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_share",put,path="/passwords/teams/{team}/items/{item}/share",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=ShareBody,responses((status=204)),tag="passwords")]
/// Replace the owned item’s explicit recipient set.
pub async fn share<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
    Json(body): Json<ShareBody>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .share(&actor(user, None)?, TeamId(team), ItemId(item), body.grants)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(operation_id = "passwords_folders",get,path="/passwords/teams/{team}/folders",params(("team"=Uuid,Path)),responses((status=200,body=Vec<Folder>)),tag="passwords")]
/// List the authenticated team’s folders.
pub async fn folders<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path(team): Path<Uuid>,
) -> Result<Json<Vec<Folder>>, ApiError> {
    Ok(Json(
        state
            .service
            .folders(&actor(user, None)?, TeamId(team))
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_create_folder",post,path="/passwords/teams/{team}/folders",params(("team"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=FolderBody,responses((status=200,body=Folder)),tag="passwords")]
/// Create a folder within the authenticated team.
pub async fn create_folder<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path(team): Path<Uuid>,
    Json(body): Json<FolderBody>,
) -> Result<Json<Folder>, ApiError> {
    Ok(Json(
        state
            .service
            .create_folder(&actor(user, None)?, TeamId(team), body.name)
            .await?,
    ))
}
#[utoipa::path(operation_id = "passwords_remove_folder",delete,path="/passwords/teams/{team}/folders/{folder}",params(("team"=Uuid,Path),("folder"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),responses((status=204)),tag="passwords")]
/// Delete a folder within the authenticated team.
pub async fn remove_folder<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, folder)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .delete_folder(&actor(user, None)?, TeamId(team), folder)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(operation_id = "passwords_set_totp",put,path="/passwords/teams/{team}/items/{item}/totp",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=TotpBody,responses((status=204)),tag="passwords")]
/// Enroll or replace a verification-code seed after recent authentication.
pub async fn set_totp<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    token: AccessTokenExtractor,
    Path((team, item)): Path<(Uuid, Uuid)>,
    Json(body): Json<TotpBody>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .configure_totp(
            &actor(user, Some(token))?,
            TeamId(team),
            ItemId(item),
            Some(body.key),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(operation_id = "passwords_remove_totp",delete,path="/passwords/teams/{team}/items/{item}/totp",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),responses((status=204)),tag="passwords")]
/// Remove a verification-code seed after recent authentication.
pub async fn remove_totp<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    token: AccessTokenExtractor,
    Path((team, item)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .configure_totp(&actor(user, Some(token))?, TeamId(team), ItemId(item), None)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(operation_id = "passwords_totp",post,path="/passwords/teams/{team}/items/{item}/totp/code",params(("team"=Uuid,Path),("item"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),responses((status=200,body=TotpCode)),tag="passwords")]
/// Resolve the current verification code after recent authentication.
pub async fn totp<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    token: AccessTokenExtractor,
    Path((team, item)): Path<(Uuid, Uuid)>,
) -> Result<Json<TotpCode>, ApiError> {
    Ok(Json(
        state
            .service
            .totp(&actor(user, Some(token))?, TeamId(team), ItemId(item))
            .await?,
    ))
}

#[utoipa::path(operation_id = "passwords_rename_folder",put,path="/passwords/teams/{team}/folders/{folder}",params(("team"=Uuid,Path),("folder"=Uuid,Path),("X-Macro-Passwords"=String,Header,description="Required CSRF header; send 1")),request_body=FolderBody,responses((status=200,body=Folder)),tag="passwords")]
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
            .rename_folder(&actor(user, None)?, TeamId(team), folder, body.name)
            .await?,
    ))
}

#[cfg(test)]
mod test;
