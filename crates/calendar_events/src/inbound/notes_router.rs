//! HTTP transport for meeting notes; policy lives in the domain service.

use crate::domain::notes::{
    DocumentNoteLink, MeetingNote, MeetingNotesService, NoteError, NotePicker, NoteTarget,
};
use axum::{
    Json, Router,
    extract::{FromRef, Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, put},
};
use entity_access::domain::{
    models::{AccessError, EntityType, OwnerAccessLevel},
    ports::EntityAccessService,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

/// Composed meeting-note, access, and authentication services.
pub struct NotesRouterState<S, E, A> {
    service: Arc<S>,
    access: Arc<E>,
    auth: MacroAuthorizationState<A>,
}

impl<S, E, A> Clone for NotesRouterState<S, E, A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access: self.access.clone(),
            auth: self.auth.clone(),
        }
    }
}

impl<S, E, A> NotesRouterState<S, E, A> {
    /// Supply concrete services at the composition root.
    pub fn new(service: Arc<S>, access: Arc<E>, auth: MacroAuthorizationState<A>) -> Self {
        Self {
            service,
            access,
            auth,
        }
    }
}

impl<S, E, A> FromRef<NotesRouterState<S, E, A>> for MacroAuthorizationState<A> {
    fn from_ref(state: &NotesRouterState<S, E, A>) -> Self {
        state.auth.clone()
    }
}

/// Authenticated note reads and owner-authorized link writes.
pub fn notes_router<
    S: MeetingNotesService,
    E: EntityAccessService,
    A: MacroAuthorizationService,
    T: Send + Sync + 'static,
>(
    state: NotesRouterState<S, E, A>,
) -> Router<T> {
    Router::new()
        .route("/meeting-notes/documents", get(note_documents::<S, E, A>))
        .route(
            "/meeting-notes/documents/{document_id}/links",
            get(document_note_links::<S, E, A>),
        )
        .route("/events/{event_id}/notes", get(event_notes::<S, E, A>))
        .route(
            "/events/{event_id}/notes/{document_id}",
            put(link_event_note::<S, E, A>).delete(unlink_event_note::<S, E, A>),
        )
        .layer(axum::middleware::map_response(
            |mut response: Response| async move {
                response.headers_mut().insert(
                    header::CACHE_CONTROL,
                    header::HeaderValue::from_static("private, no-store"),
                );
                response
            },
        ))
        .with_state(state)
}

/// Original occurrence key; independent of a later reschedule.
#[derive(Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct NotesQuery {
    /// Stable occurrence key returned by the calendar read API.
    pub occurrence_key: String,
}

/// Name fragment for owned markdown suggestions.
#[derive(Deserialize, utoipa::IntoParams)]
pub struct NoteDocumentsQuery {
    /// Empty returns recent documents.
    #[serde(default)]
    pub query: String,
}

/// Optional additional view access for one team.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LinkNoteRequest {
    /// Null means the meeting audience only.
    pub team_id: Option<Uuid>,
}

/// Safe HTTP error mapping for note policy failures.
pub struct NotesApiError(NoteError);

impl From<NoteError> for NotesApiError {
    fn from(error: NoteError) -> Self {
        Self(error)
    }
}

impl From<AccessError> for NotesApiError {
    fn from(error: AccessError) -> Self {
        Self(match error {
            AccessError::Unavailable(report) | AccessError::Internal(report) => {
                NoteError::Internal(report)
            }
            AccessError::BadRequest(_) => NoteError::InvalidInput,
            AccessError::NotFound(_) => NoteError::NotFound,
            AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
                NoteError::Forbidden
            }
        })
    }
}

impl IntoResponse for NotesApiError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            NoteError::NotFound => StatusCode::NOT_FOUND,
            NoteError::Forbidden => StatusCode::FORBIDDEN,
            NoteError::NotMarkdown | NoteError::InvalidInput => StatusCode::BAD_REQUEST,
            NoteError::Internal(error) => {
                tracing::error!(error=?error, "meeting notes request failed");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        (
            status,
            Json(serde_json::json!({"message": self.0.to_string()})),
        )
            .into_response()
    }
}

/// List notes visible through this meeting occurrence.
#[utoipa::path(get, path="/events/{event_id}/notes", params(("event_id" = Uuid, Path), NotesQuery), responses((status=200, body=Vec<MeetingNote>)), tag="calendar_events")]
pub async fn event_notes<
    S: MeetingNotesService,
    E: EntityAccessService,
    A: MacroAuthorizationService,
>(
    State(state): State<NotesRouterState<S, E, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Path(event_id): Path<Uuid>,
    Query(query): Query<NotesQuery>,
) -> Result<Json<Vec<MeetingNote>>, NotesApiError> {
    Ok(Json(
        state
            .service
            .list(
                user.authorization.user.macro_user_id.as_ref(),
                NoteTarget {
                    event_id,
                    occurrence_key: query.occurrence_key,
                },
            )
            .await?,
    ))
}

/// Suggest the caller's markdown documents and extra team audiences.
#[utoipa::path(get, path="/meeting-notes/documents", params(NoteDocumentsQuery), responses((status=200, body=NotePicker)), tag="calendar_events")]
pub async fn note_documents<
    S: MeetingNotesService,
    E: EntityAccessService,
    A: MacroAuthorizationService,
>(
    State(state): State<NotesRouterState<S, E, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Query(query): Query<NoteDocumentsQuery>,
) -> Result<Json<NotePicker>, NotesApiError> {
    Ok(Json(
        state
            .service
            .picker(user.authorization.user.macro_user_id.as_ref(), &query.query)
            .await?,
    ))
}

/// List an owned document's meeting grants, including unavailable meetings.
#[utoipa::path(get, path="/meeting-notes/documents/{document_id}/links", params(("document_id" = String, Path)), responses((status=200, body=Vec<DocumentNoteLink>)), tag="calendar_events")]
pub async fn document_note_links<
    S: MeetingNotesService,
    E: EntityAccessService,
    A: MacroAuthorizationService,
>(
    State(state): State<NotesRouterState<S, E, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Path(document_id): Path<String>,
) -> Result<Json<Vec<DocumentNoteLink>>, NotesApiError> {
    let receipt = state
        .access
        .generate_entity_access_receipt::<OwnerAccessLevel>(
            &user.authorization.user.macro_user_id,
            user.authorization
                .user
                .user_context
                .organization_id
                .map(i64::from),
            &document_id,
            EntityType::Document,
        )
        .await?;
    Ok(Json(state.service.document_links(receipt).await?))
}

/// Idempotently link a markdown document and its optional team audience.
#[utoipa::path(put, path="/events/{event_id}/notes/{document_id}", params(("event_id" = Uuid, Path), ("document_id" = String, Path), NotesQuery), request_body=LinkNoteRequest, responses((status=204)), tag="calendar_events")]
pub async fn link_event_note<
    S: MeetingNotesService,
    E: EntityAccessService,
    A: MacroAuthorizationService,
>(
    State(state): State<NotesRouterState<S, E, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Path((event_id, document_id)): Path<(Uuid, String)>,
    Query(query): Query<NotesQuery>,
    Json(body): Json<LinkNoteRequest>,
) -> Result<StatusCode, NotesApiError> {
    let receipt = state
        .access
        .generate_entity_access_receipt::<OwnerAccessLevel>(
            &user.authorization.user.macro_user_id,
            user.authorization
                .user
                .user_context
                .organization_id
                .map(i64::from),
            &document_id,
            EntityType::Document,
        )
        .await?;
    state
        .service
        .link(
            receipt,
            NoteTarget {
                event_id,
                occurrence_key: query.occurrence_key,
            },
            body.team_id,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Remove this meeting's grant without deleting the document.
#[utoipa::path(delete, path="/events/{event_id}/notes/{document_id}", params(("event_id" = Uuid, Path), ("document_id" = String, Path), NotesQuery), responses((status=204)), tag="calendar_events")]
pub async fn unlink_event_note<
    S: MeetingNotesService,
    E: EntityAccessService,
    A: MacroAuthorizationService,
>(
    State(state): State<NotesRouterState<S, E, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Path((event_id, document_id)): Path<(Uuid, String)>,
    Query(query): Query<NotesQuery>,
) -> Result<StatusCode, NotesApiError> {
    let receipt = state
        .access
        .generate_entity_access_receipt::<OwnerAccessLevel>(
            &user.authorization.user.macro_user_id,
            user.authorization
                .user
                .user_context
                .organization_id
                .map(i64::from),
            &document_id,
            EntityType::Document,
        )
        .await?;
    state
        .service
        .unlink(
            receipt,
            NoteTarget {
                event_id,
                occurrence_key: query.occurrence_key,
            },
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
