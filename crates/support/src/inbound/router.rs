use crate::domain::{model::*, service::Service};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRef, Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use entity_access::{
    domain::{
        models::{AdminTeamRole, MemberTeamRole},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use std::sync::Arc;
use uuid::Uuid;
pub struct SupportState<E, A> {
    pub service: Service,
    pub access: Arc<E>,
    pub authorization: MacroAuthorizationState<A>,
}
impl<E, A> Clone for SupportState<E, A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access: self.access.clone(),
            authorization: self.authorization.clone(),
        }
    }
}
impl<E, A> FromRef<SupportState<E, A>> for Arc<E> {
    fn from_ref(s: &SupportState<E, A>) -> Self {
        s.access.clone()
    }
}
impl<E, A> FromRef<SupportState<E, A>> for MacroAuthorizationState<A> {
    fn from_ref(s: &SupportState<E, A>) -> Self {
        s.authorization.clone()
    }
}
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::Invalid(_) => StatusCode::BAD_REQUEST,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Forbidden => StatusCode::FORBIDDEN,
            Self::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let text = if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error=?self,"Support request failed");
            "Support request failed".into()
        } else {
            self.to_string()
        };
        (status, Json(serde_json::json!({"message":text}))).into_response()
    }
}
pub fn router<E: EntityAccessService, A: MacroAuthorizationService, S: Send + Sync + 'static>(
    state: SupportState<E, A>,
) -> Router<S> {
    Router::new()
        .route("/settings", get(settings::<E, A>).put(configure::<E, A>))
        .route("/inboxes", get(inboxes::<E, A>))
        .route("/tickets", get(list::<E, A>).post(create::<E, A>))
        .route("/tickets/{id}", get(detail::<E, A>).patch(patch::<E, A>))
        .route("/tickets/{id}/messages", post(reply::<E, A>))
        .route("/tickets/{id}/tasks", post(link_task::<E, A>))
        .route("/tickets/{id}/tasks/{task}", delete(unlink_task::<E, A>))
        .layer(DefaultBodyLimit::max(192000))
        .with_state(state)
}
type Access<E, A> = MacroUserTeamExtractorV2<MemberTeamRole, E, A>;
async fn settings<E: EntityAccessService, A: MacroAuthorizationService>(
    access: Access<E, A>,
    State(s): State<SupportState<E, A>>,
) -> Result<Json<Settings>> {
    Ok(Json(
        s.service.settings(&access.entity_access_receipt).await?,
    ))
}
async fn configure<E: EntityAccessService, A: MacroAuthorizationService>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, E, A>,
    State(s): State<SupportState<E, A>>,
    Json(value): Json<Settings>,
) -> Result<Json<Settings>> {
    Ok(Json(
        s.service
            .configure(&access.entity_access_receipt, value)
            .await?,
    ))
}
async fn inboxes<E: EntityAccessService, A: MacroAuthorizationService>(
    access: Access<E, A>,
    State(s): State<SupportState<E, A>>,
) -> Result<Json<Vec<Inbox>>> {
    Ok(Json(
        s.service.inboxes(&access.entity_access_receipt).await?,
    ))
}
async fn list<E: EntityAccessService, A: MacroAuthorizationService>(
    access: Access<E, A>,
    State(s): State<SupportState<E, A>>,
    Query(filter): Query<TicketFilter>,
) -> Result<Json<Vec<Ticket>>> {
    Ok(Json(
        s.service
            .list(&access.entity_access_receipt, &filter)
            .await?,
    ))
}
async fn create<E: EntityAccessService, A: MacroAuthorizationService>(
    access: Access<E, A>,
    State(s): State<SupportState<E, A>>,
    Json(value): Json<NewTicket>,
) -> Result<Json<Ticket>> {
    Ok(Json(
        s.service
            .create(&access.entity_access_receipt, value)
            .await?,
    ))
}
async fn detail<E: EntityAccessService, A: MacroAuthorizationService>(
    access: Access<E, A>,
    State(s): State<SupportState<E, A>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Detail>> {
    Ok(Json(
        s.service.detail(&access.entity_access_receipt, id).await?,
    ))
}
async fn patch<E: EntityAccessService, A: MacroAuthorizationService>(
    access: Access<E, A>,
    State(s): State<SupportState<E, A>>,
    Path(id): Path<Uuid>,
    Json(value): Json<TicketPatch>,
) -> Result<Json<Ticket>> {
    Ok(Json(
        s.service
            .patch(&access.entity_access_receipt, id, value)
            .await?,
    ))
}
async fn reply<E: EntityAccessService, A: MacroAuthorizationService>(
    access: Access<E, A>,
    State(s): State<SupportState<E, A>>,
    Path(id): Path<Uuid>,
    Json(value): Json<Reply>,
) -> Result<Json<Ticket>> {
    Ok(Json(
        s.service
            .reply(&access.entity_access_receipt, id, value)
            .await?,
    ))
}
async fn link_task<E: EntityAccessService, A: MacroAuthorizationService>(
    access: Access<E, A>,
    State(s): State<SupportState<E, A>>,
    Path(id): Path<Uuid>,
    Json(value): Json<TaskInput>,
) -> Result<Json<LinkedTask>> {
    Ok(Json(
        s.service
            .link_task(&access.entity_access_receipt, id, value)
            .await?,
    ))
}
async fn unlink_task<E: EntityAccessService, A: MacroAuthorizationService>(
    access: Access<E, A>,
    State(s): State<SupportState<E, A>>,
    Path((id, task)): Path<(Uuid, String)>,
) -> Result<StatusCode> {
    s.service
        .unlink_task(&access.entity_access_receipt, id, &task)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
pub fn public_router(service: Service) -> Router {
    Router::new()
        .route("/widget.js", get(script))
        .route("/widget/{key}", get(widget).post(open))
        .route(
            "/visitor/messages",
            get(visitor_messages).post(visitor_reply),
        )
        .layer(DefaultBodyLimit::max(40000))
        .with_state(service)
}
async fn script() -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, "text/javascript; charset=utf-8"),
            (header::CACHE_CONTROL, "public,max-age=300"),
        ],
        include_str!("widget.js"),
    )
}
fn origin(headers: &HeaderMap) -> Result<&str> {
    headers
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .ok_or(Error::Forbidden)
}
fn token(headers: &HeaderMap) -> Result<&str> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(Error::Forbidden)
}
async fn widget(
    State(s): State<Service>,
    Path(key): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>> {
    Ok(Json(s.widget_config(key, origin(&headers)?).await?))
}
async fn open(
    State(s): State<Service>,
    Path(key): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<NewTicket>,
) -> Result<Json<serde_json::Value>> {
    Ok(Json(s.open_visitor(key, origin(&headers)?, input).await?))
}
async fn visitor_messages(
    State(s): State<Service>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>> {
    Ok(Json(
        s.visitor_messages(token(&headers)?, origin(&headers)?)
            .await?,
    ))
}
async fn visitor_reply(
    State(s): State<Service>,
    headers: HeaderMap,
    Json(reply): Json<Reply>,
) -> Result<StatusCode> {
    s.visitor_reply(token(&headers)?, origin(&headers)?, reply)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
