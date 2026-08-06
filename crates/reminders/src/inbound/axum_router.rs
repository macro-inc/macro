//! Axum router for reminders endpoints.

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post},
};
use entity_access::domain::{
    models::{AccessError, AnyEntityPermission, EntityAccessReceipt, OwnerAccessLevel},
    ports::EntityAccessService,
};
use entity_access::inbound::axum_extractors::ReminderAccessExtractor;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use model_error_response::ErrorResponse;
use serde::Deserialize;
use uuid::Uuid;

use crate::domain::{
    models::{
        CreateReminder, Reminder, ReminderCursor, ReminderError, ReminderFilter, ReminderPatch,
        ReminderSchedule, RemindersList,
    },
    ports::RemindersService,
};

/// Router state for reminders endpoints.
pub struct RemindersRouterState<S, Eas, Auth> {
    service: Arc<S>,
    entity_access_service: Arc<Eas>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Eas, Auth> Clone for RemindersRouterState<S, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Eas, Auth> RemindersRouterState<S, Eas, Auth>
where
    S: RemindersService,
    Eas: EntityAccessService,
{
    /// Create router state from shared service references and authorization state.
    pub fn new(
        service: Arc<S>,
        entity_access_service: Arc<Eas>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            entity_access_service,
            authorization_state,
        }
    }
}

impl<S, Eas, Auth> FromRef<RemindersRouterState<S, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &RemindersRouterState<S, Eas, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<S, Eas, Auth> FromRef<RemindersRouterState<S, Eas, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &RemindersRouterState<S, Eas, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the reminders router.
///
/// Routes:
/// - `GET /` — list the caller's reminders.
/// - `POST /` — create a reminder.
/// - `GET /{id}` — fetch one reminder.
/// - `PATCH /{id}` — modify a reminder.
/// - `DELETE /{id}` — delete a reminder.
pub fn reminders_router<S, Eas, Auth, T>(state: RemindersRouterState<S, Eas, Auth>) -> Router<T>
where
    S: RemindersService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/", get(list_reminders_handler::<S, Eas, Auth>))
        .route("/", post(create_reminder_handler::<S, Eas, Auth>))
        .route("/{id}", get(get_reminder_handler::<S, Eas, Auth>))
        .route("/{id}", patch(update_reminder_handler::<S, Eas, Auth>))
        .route("/{id}", delete(delete_reminder_handler::<S, Eas, Auth>))
        .with_state(state)
}

/// Request body for creating a reminder.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateReminderRequest {
    /// What to remind the caller about.
    pub description: String,
    /// Type of the entity to attach the reminder to. Requires `entityId`.
    // Inlined to avoid claiming the shared `EntityType` component name (see
    // `Reminder::entity_type`).
    #[schema(inline)]
    pub entity_type: Option<EntityType>,
    /// Id of the entity to attach the reminder to. Requires `entityType`.
    pub entity_id: Option<String>,
    /// When and how often the reminder fires.
    pub schedule: ReminderSchedule,
}

/// Request body for modifying a reminder. Omitted fields are left unchanged;
/// the entity association is not modifiable.
///
/// Every field is optional but **not** nullable. `Option` here means "absent",
/// and serde cannot tell an explicit `null` from an omitted key — so a body of
/// `{"enabled": null}` would deserialize to an empty patch and be rejected as
/// having no fields to update. `nullable = false` keeps the schema from
/// advertising a value the API has no meaning for; the deserializer still
/// tolerates `null` rather than erroring on it.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReminderRequest {
    /// Replacement description.
    #[schema(nullable = false)]
    pub description: Option<String>,
    /// Replacement schedule.
    #[schema(nullable = false)]
    pub schedule: Option<ReminderSchedule>,
    /// Whether the reminder should fire at all.
    #[schema(nullable = false)]
    pub enabled: Option<bool>,
}

/// Query params for listing reminders.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct ListRemindersParams {
    /// Restrict to reminders attached to this entity type. Requires `entityId`.
    #[param(inline)]
    pub entity_type: Option<EntityType>,
    /// Restrict to reminders attached to this entity id. Requires `entityType`.
    pub entity_id: Option<String>,
    /// Include reminders that have already fired.
    #[serde(default)]
    pub include_completed: bool,
    /// Page size. Defaults to 100; larger values are capped at 500. A value
    /// that is not a non-negative integer is rejected by the query extractor.
    pub limit: Option<u32>,
    /// `nextCursor` from a previous page.
    pub cursor: Option<String>,
}

/// Path params for the single-reminder routes.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct ReminderIdParams {
    /// The reminder id.
    pub id: Uuid,
}

/// Pair an optional entity type and id into an entity, rejecting half-supplied
/// associations and blank ids before they reach the domain. Applies to both
/// create and list, so a filter can never carry an empty entity id.
fn build_entity(
    entity_type: Option<EntityType>,
    entity_id: Option<String>,
) -> Result<Option<Entity<'static>>, ReminderError> {
    match (entity_type, entity_id) {
        (Some(entity_type), Some(entity_id)) => {
            // Stored as uuid, so reject a malformed id here rather than let it
            // surface as an opaque repository error.
            let entity_id = entity_id.trim();
            Uuid::parse_str(entity_id)
                .map_err(|_| ReminderError::BadRequest("entityId must be a uuid".to_string()))?;
            Ok(Some(entity_type.with_entity_string(entity_id.to_string())))
        }
        (None, None) => Ok(None),
        _ => Err(ReminderError::BadRequest(
            "entityType and entityId must be provided together".to_string(),
        )),
    }
}

/// Mint the receipt that proves the caller may attach a reminder to `entity`.
/// Access policy itself stays in the domain service, which checks the receipt
/// matches the requested entity and user.
///
/// The requirement is [`AnyEntityPermission`], not `ViewAccessLevel`: entity
/// permissions come in two shapes, and `ViewAccessLevel` only ever matches the
/// `AccessLevel` one. A channel resolves to `ChannelRole`/`ChannelViewOnly`, so
/// requiring `ViewAccessLevel` rejected every channel — including ones the
/// caller owns. `get_entity_permission` already fails closed for an entity the
/// caller cannot reach at all (`AccessLevel` has no "none" variant; no access is
/// an error, not a value), so "holds any permission" is the right bar for
/// attaching a reminder.
async fn mint_entity_receipt<Eas: EntityAccessService>(
    entity_access_service: &Eas,
    user_id: &MacroUserIdStr<'_>,
    user_org_id: Option<i64>,
    entity: &Entity<'_>,
) -> Result<EntityAccessReceipt<AnyEntityPermission>, ReminderError> {
    entity_access_service
        .generate_entity_access_receipt::<AnyEntityPermission>(
            user_id,
            user_org_id,
            entity.entity_id.as_ref(),
            entity.entity_type,
        )
        .await
        // Report what actually went wrong. Collapsing every variant into a 403
        // told a caller with a malformed id or a missing entity that they lacked
        // access, which sent debugging in the wrong direction.
        .map_err(|e| match e {
            AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
                ReminderError::EntityAccessDenied
            }
            AccessError::NotFound(_) => ReminderError::EntityNotFound,
            AccessError::BadRequest(msg) => ReminderError::BadRequest(msg.to_string()),
            other => ReminderError::Internal(rootcause::Report::new(other).into_dynamic()),
        })
}

/// List the caller's reminders, soonest firing first.
#[utoipa::path(
    get,
    tag = "reminders",
    operation_id = "list_reminders",
    path = "/reminders",
    params(ListRemindersParams),
    responses(
        (status = 200, body = RemindersList),
        (status = 400, body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_reminders_handler<S, Eas, Auth>(
    State(state): State<RemindersRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    axum::extract::Query(params): axum::extract::Query<ListRemindersParams>,
) -> Result<Json<RemindersList>, ReminderError>
where
    S: RemindersService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let filter = ReminderFilter {
        entity: build_entity(params.entity_type, params.entity_id)?,
        include_completed: params.include_completed,
        cursor: params
            .cursor
            .as_deref()
            .map(ReminderCursor::decode)
            .transpose()?,
        limit: params.limit,
    };
    let page = state
        .service
        .list_reminders(&user.authorization.user.macro_user_id, filter)
        .await?;
    Ok(Json(RemindersList {
        reminders: page.reminders,
        next_cursor: page.next_cursor.map(|cursor| cursor.encode()),
    }))
}

/// Create a reminder, optionally attached to an entity the caller can view.
#[utoipa::path(
    post,
    tag = "reminders",
    operation_id = "create_reminder",
    path = "/reminders",
    request_body = CreateReminderRequest,
    responses(
        (status = 201, body = Reminder),
        (status = 400, body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, description = "No access to the requested entity", body = ErrorResponse),
        (status = 404, description = "The requested entity does not exist", body = ErrorResponse),
        // Body deserialization is rejected by the framework before the handler
        // runs, so this response carries a plain-text body, not `ErrorResponse`.
        (status = 422, description = "Malformed request body (plain text)"),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_reminder_handler<S, Eas, Auth>(
    State(state): State<RemindersRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<CreateReminderRequest>,
) -> Result<(StatusCode, Json<Reminder>), ReminderError>
where
    S: RemindersService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let CreateReminderRequest {
        description,
        entity_type,
        entity_id,
        schedule,
    } = req;
    let user_id = &user.authorization.user.macro_user_id;
    // Organization channels grant access by matching org, so the org must be
    // carried through or a member of one reads as a non-participant.
    let user_org_id = user
        .authorization
        .user
        .user_context
        .organization_id
        .map(i64::from);

    let entity = build_entity(entity_type, entity_id)?;
    // A standalone reminder points at nothing, so there is no access to check.
    let entity_receipt = match &entity {
        Some(entity) => Some(
            mint_entity_receipt(
                state.entity_access_service.as_ref(),
                user_id,
                user_org_id,
                entity,
            )
            .await?,
        ),
        None => None,
    };

    let reminder = state
        .service
        .create_reminder(
            user_id,
            CreateReminder {
                description,
                schedule,
            },
            entity_receipt,
        )
        .await?;
    // No `Location` header: this router is mounted under a path prefix the
    // service cannot see (clients reach it via `SERVER_HOSTS` + `/dss`, which the
    // proxy strips before forwarding), so any absolute path built here would be
    // wrong for the caller. The created reminder's `id` is in the body.
    Ok((StatusCode::CREATED, Json(reminder)))
}

/// Fetch one of the caller's reminders.
#[utoipa::path(
    get,
    tag = "reminders",
    operation_id = "get_reminder",
    path = "/reminders/{id}",
    params(ReminderIdParams),
    responses(
        (status = 200, body = Reminder),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_reminder_handler<S, Eas, Auth>(
    State(state): State<RemindersRouterState<S, Eas, Auth>>,
    access: ReminderAccessExtractor<OwnerAccessLevel, Eas, Auth>,
) -> Result<Json<Reminder>, ReminderError>
where
    S: RemindersService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let reminder = state
        .service
        .get_reminder(access.entity_access_receipt)
        .await?;
    Ok(Json(reminder))
}

/// Modify one of the caller's reminders.
#[utoipa::path(
    patch,
    tag = "reminders",
    operation_id = "update_reminder",
    path = "/reminders/{id}",
    params(ReminderIdParams),
    request_body = UpdateReminderRequest,
    responses(
        (status = 200, body = Reminder),
        (status = 400, body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        // As on create: a malformed body is rejected before the handler runs and
        // carries a plain-text body, not `ErrorResponse`.
        (status = 422, description = "Malformed request body (plain text)"),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn update_reminder_handler<S, Eas, Auth>(
    State(state): State<RemindersRouterState<S, Eas, Auth>>,
    access: ReminderAccessExtractor<OwnerAccessLevel, Eas, Auth>,
    Json(req): Json<UpdateReminderRequest>,
) -> Result<Json<Reminder>, ReminderError>
where
    S: RemindersService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let patch = ReminderPatch {
        description: req.description,
        schedule: req.schedule,
        enabled: req.enabled,
    };
    let reminder = state
        .service
        .update_reminder(access.entity_access_receipt, patch)
        .await?;
    Ok(Json(reminder))
}

/// Delete one of the caller's reminders.
#[utoipa::path(
    delete,
    tag = "reminders",
    operation_id = "delete_reminder",
    path = "/reminders/{id}",
    params(ReminderIdParams),
    responses(
        (status = 204, description = "Reminder deleted"),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn delete_reminder_handler<S, Eas, Auth>(
    State(state): State<RemindersRouterState<S, Eas, Auth>>,
    access: ReminderAccessExtractor<OwnerAccessLevel, Eas, Auth>,
) -> Result<StatusCode, ReminderError>
where
    S: RemindersService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .delete_reminder(access.entity_access_receipt)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

impl IntoResponse for ReminderError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            ReminderError::NotFound | ReminderError::EntityNotFound => StatusCode::NOT_FOUND,
            ReminderError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ReminderError::EntityAccessDenied => StatusCode::FORBIDDEN,
            ReminderError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = match &self {
            ReminderError::Internal(_) => {
                tracing::error!(error=?self, "reminders internal server error");
                "internal server error".to_string()
            }
            error => error.to_string(),
        };

        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}
