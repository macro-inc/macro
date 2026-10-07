//! Thin HTTP adapters for team projections and personal sharing preferences.

use crate::domain::{models::OccurrenceRange, team::*};
use axum::{
    Json, Router,
    extract::{FromRef, Path, Query, State},
    http::{HeaderValue, StatusCode, header::CACHE_CONTROL},
    middleware::map_response,
    response::{IntoResponse, Response},
    routing::{get, put},
};
use chrono::{DateTime, Utc};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// Shared services for either read or settings routes.
pub struct CalendarTeamRouterState<S, A> {
    service: Arc<S>,
    authorization_state: MacroAuthorizationState<A>,
}
impl<S, A> Clone for CalendarTeamRouterState<S, A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}
impl<S, A> CalendarTeamRouterState<S, A> {
    /// Compose the domain service and authentication boundary.
    pub fn new(service: Arc<S>, authorization_state: MacroAuthorizationState<A>) -> Self {
        Self {
            service,
            authorization_state,
        }
    }
}
impl<S, A> FromRef<CalendarTeamRouterState<S, A>> for MacroAuthorizationState<A> {
    fn from_ref(state: &CalendarTeamRouterState<S, A>) -> Self {
        state.authorization_state.clone()
    }
}

/// Storage-service reads; all masking is performed by the domain service.
pub fn team_calendar_router<
    S: CalendarTeamService,
    A: MacroAuthorizationService,
    T: Send + Sync + 'static,
>(
    state: CalendarTeamRouterState<S, A>,
) -> Router<T> {
    Router::new()
        .route("/calendar-events/team", get(list_team_calendar::<S, A>))
        .layer(map_response(private_no_store))
        .with_state(state)
}

/// Calendar-service settings; no Google ACL or provider event writes.
pub fn team_calendar_settings_router<
    S: CalendarTeamService,
    A: MacroAuthorizationService,
    T: Send + Sync + 'static,
>(
    state: CalendarTeamRouterState<S, A>,
) -> Router<T> {
    Router::new()
        .route(
            "/team-sharing",
            get(get_team_sharing::<S, A>).put(set_team_sharing::<S, A>),
        )
        .route(
            "/availability-calendars",
            get(get_availability_calendars::<S, A>),
        )
        .route(
            "/availability-calendars/{calendar_id}",
            put(set_availability_calendar::<S, A>),
        )
        .layer(map_response(private_no_store))
        .with_state(state)
}

async fn private_no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    response
}

/// Viewport and opaque continuation token.
#[derive(Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct TeamCalendarQuery {
    /// Inclusive instant.
    pub start: DateTime<Utc>,
    /// Exclusive instant.
    pub end: DateTime<Utc>,
    /// Continuation returned by the preceding page.
    pub cursor: Option<String>,
    /// Maximum source occurrences, at most 2,000.
    pub limit: Option<u16>,
}

/// Own-user sharing preference.
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
pub struct TeamCalendarSharingBody {
    /// Busy-only is the default, including when no setting has been saved.
    pub sharing: TeamCalendarSharing,
}

/// Own-user source inclusion preference.
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityCalendarBody {
    /// Whether this calendar contributes to personal availability.
    pub contributes_to_availability: bool,
}

/// Source calendar settings returned to their viewer.
#[derive(Serialize, utoipa::ToSchema)]
pub struct AvailabilityCalendarsResponse {
    /// Directly visible source calendars.
    pub calendars: Vec<AvailabilityCalendar>,
}

/// Adapter error without internal/provider details.
#[derive(Debug)]
pub struct TeamCalendarApiError(StatusCode);
impl IntoResponse for TeamCalendarApiError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({"message": self.0.canonical_reason().unwrap_or("calendar request failed")}))).into_response()
    }
}
impl From<rootcause::Report> for TeamCalendarApiError {
    fn from(error: rootcause::Report) -> Self {
        let status = match error
            .as_ref()
            .downcast_current_context::<TeamCalendarError>()
        {
            Some(TeamCalendarError::InvalidQuery) => StatusCode::BAD_REQUEST,
            Some(TeamCalendarError::NotFound | TeamCalendarError::Disabled) => {
                StatusCode::NOT_FOUND
            }
            None => {
                tracing::error!(error=?error, "team calendar request failed");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        Self(status)
    }
}

/// Query authorized projections in a bounded viewport.
#[utoipa::path(get, path="/calendar-events/team", params(TeamCalendarQuery), responses((status=200, body=TeamCalendarPage)), tag="calendar_events")]
pub async fn list_team_calendar<S: CalendarTeamService, A: MacroAuthorizationService>(
    State(state): State<CalendarTeamRouterState<S, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Query(query): Query<TeamCalendarQuery>,
) -> Result<Json<TeamCalendarPage>, TeamCalendarApiError> {
    let cursor = query
        .cursor
        .map(|cursor| serde_json::from_str(&cursor))
        .transpose()
        .map_err(|_| TeamCalendarApiError(StatusCode::BAD_REQUEST))?;
    let range = OccurrenceRange {
        starts_at: query.start,
        ends_at: query.end,
        start_date: query.start.date_naive(),
        end_date: if query.end.time() == chrono::NaiveTime::MIN {
            query.end.date_naive()
        } else {
            query
                .end
                .date_naive()
                .succ_opt()
                .ok_or(TeamCalendarApiError(StatusCode::BAD_REQUEST))?
        },
    };
    Ok(Json(
        state
            .service
            .list_team_calendar(
                user.authorization.user.macro_user_id.as_ref(),
                range,
                cursor,
                query.limit.unwrap_or(500),
            )
            .await?,
    ))
}

/// Read the authenticated user's sharing choice.
#[utoipa::path(get, path="/team-sharing", responses((status=200, body=TeamCalendarSharingBody)), tag="calendar_events")]
pub async fn get_team_sharing<S: CalendarTeamService, A: MacroAuthorizationService>(
    State(state): State<CalendarTeamRouterState<S, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
) -> Result<Json<TeamCalendarSharingBody>, TeamCalendarApiError> {
    Ok(Json(TeamCalendarSharingBody {
        sharing: state
            .service
            .team_sharing(user.authorization.user.macro_user_id.as_ref())
            .await?,
    }))
}

/// Set the authenticated user's sharing choice.
#[utoipa::path(put, path="/team-sharing", request_body=TeamCalendarSharingBody, responses((status=200, body=TeamCalendarSharingBody)), tag="calendar_events")]
pub async fn set_team_sharing<S: CalendarTeamService, A: MacroAuthorizationService>(
    State(state): State<CalendarTeamRouterState<S, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Json(body): Json<TeamCalendarSharingBody>,
) -> Result<Json<TeamCalendarSharingBody>, TeamCalendarApiError> {
    Ok(Json(TeamCalendarSharingBody {
        sharing: state
            .service
            .set_team_sharing(user.authorization.user.macro_user_id.as_ref(), body.sharing)
            .await?,
    }))
}

/// List calendars and their personal-availability inclusion.
#[utoipa::path(get, path="/availability-calendars", responses((status=200, body=AvailabilityCalendarsResponse)), tag="calendar_events")]
pub async fn get_availability_calendars<S: CalendarTeamService, A: MacroAuthorizationService>(
    State(state): State<CalendarTeamRouterState<S, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
) -> Result<Json<AvailabilityCalendarsResponse>, TeamCalendarApiError> {
    Ok(Json(AvailabilityCalendarsResponse {
        calendars: state
            .service
            .availability_calendars(user.authorization.user.macro_user_id.as_ref())
            .await?,
    }))
}

/// Change which source calendars normally occupy this user's time.
#[utoipa::path(put, path="/availability-calendars/{calendar_id}", params(("calendar_id"=Uuid, Path)), request_body=AvailabilityCalendarBody, responses((status=204)), tag="calendar_events")]
pub async fn set_availability_calendar<S: CalendarTeamService, A: MacroAuthorizationService>(
    State(state): State<CalendarTeamRouterState<S, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Path(calendar): Path<Uuid>,
    Json(body): Json<AvailabilityCalendarBody>,
) -> Result<StatusCode, TeamCalendarApiError> {
    state
        .service
        .set_availability_calendar(
            user.authorization.user.macro_user_id.as_ref(),
            calendar,
            body.contributes_to_availability,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
