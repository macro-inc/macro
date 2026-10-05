//! Thin HTTP routes; membership, availability, and write policy live in the service.
use crate::domain::{models::*, ports::*, service::Service};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRef, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// Scheduling service and authentication state.
pub struct RouterState<R, C, D, A> {
    service: Arc<Service<R, C, D>>,
    auth: MacroAuthorizationState<A>,
}
impl<R, C, D, A> Clone for RouterState<R, C, D, A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            auth: self.auth.clone(),
        }
    }
}
impl<R, C, D, A> FromRef<RouterState<R, C, D, A>> for MacroAuthorizationState<A> {
    fn from_ref(s: &RouterState<R, C, D, A>) -> Self {
        s.auth.clone()
    }
}
impl<R, C, D, A> RouterState<R, C, D, A> {
    /// Bind the domain service to the host's authentication.
    pub fn new(service: Arc<Service<R, C, D>>, auth: MacroAuthorizationState<A>) -> Self {
        Self { service, auth }
    }
}
/// Scheduling API mounted beneath `/calendar/scheduling`.
pub fn router<
    R: Repository,
    C: Calendars,
    D: Directory,
    A: MacroAuthorizationService,
    T: Send + Sync + 'static,
>(
    state: RouterState<R, C, D, A>,
) -> Router<T> {
    Router::new()
        .route(
            "/settings",
            get(settings::<R, C, D, A>).put(save::<R, C, D, A>),
        )
        .route("/bookings", get(bookings::<R, C, D, A>))
        .route("/bookings/{id}/manage", get(manage::<R, C, D, A>))
        .route("/bookings/{id}/approve", post(approve::<R, C, D, A>))
        .route("/bookings/{id}/attendance", post(attendance::<R, C, D, A>))
        .route("/bookings/{id}/cancel", post(cancel::<R, C, D, A>))
        .route("/public/{profile}", get(public_profile::<R, C, D, A>))
        .route("/public/{profile}/{event}/slots", get(slots::<R, C, D, A>))
        .route("/public/{profile}/{event}/book", post(book::<R, C, D, A>))
        .route("/public/bookings/{id}", get(receipt::<R, C, D, A>))
        .route(
            "/public/bookings/{id}/cancel",
            post(cancel_public::<R, C, D, A>),
        )
        .route(
            "/public/bookings/{id}/slots",
            get(replacement_slots::<R, C, D, A>),
        )
        .route(
            "/public/bookings/{id}/reschedule",
            post(reschedule::<R, C, D, A>),
        )
        .layer(DefaultBodyLimit::max(128 * 1024))
        .layer(axum::middleware::from_fn(no_store))
        .with_state(state)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Scope {
    team_id: Option<Uuid>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BookingRange {
    team_id: Option<Uuid>,
    from: Option<chrono::DateTime<chrono::Utc>>,
    to: Option<chrono::DateTime<chrono::Utc>>,
}
#[derive(Deserialize)]
struct AttendanceRequest {
    attendance: BookingAttendance,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SlotQuery {
    date: chrono::NaiveDate,
    time_zone: Option<chrono_tz::Tz>,
}
#[derive(Deserialize)]
struct ReplacementQuery {
    date: chrono::NaiveDate,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RescheduleRequest {
    starts_at: chrono::DateTime<chrono::Utc>,
    token: Uuid,
}
#[derive(Deserialize)]
struct Token {
    token: Uuid,
}
#[derive(Serialize)]
struct ProfileResponse {
    profile: Profile,
}
#[derive(Serialize)]
struct BookingsResponse {
    bookings: Vec<Booking>,
}
#[derive(Serialize)]
struct BookingResponse {
    booking: Booking,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptResponse {
    booking: Booking,
    token: Uuid,
    schedule_time_zone: chrono_tz::Tz,
}
#[derive(Serialize)]
struct SlotsResponse {
    slots: Vec<Slot>,
}
#[derive(Serialize)]
struct PublicResponse {
    profile: PublicProfile,
}
struct ApiError(Error);
impl From<Error> for ApiError {
    fn from(e: Error) -> Self {
        Self(e)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            Error::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            Error::NotFound => StatusCode::NOT_FOUND,
            Error::Forbidden => StatusCode::FORBIDDEN,
            Error::Conflict => StatusCode::CONFLICT,
            Error::Invalid(_) => StatusCode::BAD_REQUEST,
            Error::CalendarUnavailable | Error::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
        };
        let mut response = (
            status,
            Json(serde_json::json!({"message": self.0.to_string()})),
        )
            .into_response();
        if status == StatusCode::TOO_MANY_REQUESTS {
            response.headers_mut().insert(
                axum::http::header::RETRY_AFTER,
                axum::http::HeaderValue::from_static("60"),
            );
        }
        response
    }
}
async fn settings<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
    State(s): State<RouterState<R, C, D, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Query(q): Query<Scope>,
) -> Result<Json<ProfileResponse>, ApiError> {
    Ok(Json(ProfileResponse {
        profile: s
            .service
            .settings(user.authorization.user.macro_user_id.as_ref(), q.team_id)
            .await?,
    }))
}
async fn save<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
    State(s): State<RouterState<R, C, D, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Query(q): Query<Scope>,
    Json(profile): Json<Profile>,
) -> Result<Json<ProfileResponse>, ApiError> {
    Ok(Json(ProfileResponse {
        profile: s
            .service
            .save(
                user.authorization.user.macro_user_id.as_ref(),
                q.team_id,
                profile,
            )
            .await?,
    }))
}
async fn bookings<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
    State(s): State<RouterState<R, C, D, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Query(q): Query<BookingRange>,
) -> Result<Json<BookingsResponse>, ApiError> {
    let user = user.authorization.user.macro_user_id.as_ref();
    let bookings = match (q.from, q.to) {
        (Some(start), Some(end)) => {
            s.service
                .bookings_in_range(user, q.team_id, start, end)
                .await?
        }
        (None, None) => s.service.bookings(user, q.team_id).await?,
        _ => return Err(Error::Invalid("Provide both booking range endpoints".into()).into()),
    };
    Ok(Json(BookingsResponse { bookings }))
}
async fn attendance<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
    State(s): State<RouterState<R, C, D, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Path(id): Path<Uuid>,
    Json(request): Json<AttendanceRequest>,
) -> Result<Json<BookingResponse>, ApiError> {
    Ok(Json(BookingResponse {
        booking: s
            .service
            .set_attendance(
                user.authorization.user.macro_user_id.as_ref(),
                id,
                request.attendance,
            )
            .await?,
    }))
}
async fn approve<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
    State(s): State<RouterState<R, C, D, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Result<Json<BookingResponse>, ApiError> {
    Ok(Json(BookingResponse {
        booking: s
            .service
            .approve(user.authorization.user.macro_user_id.as_ref(), id)
            .await?,
    }))
}
async fn cancel<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
    State(s): State<RouterState<R, C, D, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Result<Json<BookingResponse>, ApiError> {
    Ok(Json(BookingResponse {
        booking: s
            .service
            .cancel(
                id,
                None,
                Some(user.authorization.user.macro_user_id.as_ref()),
            )
            .await?,
    }))
}
async fn public_profile<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
    State(s): State<RouterState<R, C, D, A>>,
    Path(id): Path<Uuid>,
) -> Result<Json<PublicResponse>, ApiError> {
    Ok(Json(PublicResponse {
        profile: s.service.public_profile(id).await?,
    }))
}
async fn slots<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
    State(s): State<RouterState<R, C, D, A>>,
    Path((profile, event)): Path<(Uuid, Uuid)>,
    Query(q): Query<SlotQuery>,
) -> Result<Json<SlotsResponse>, ApiError> {
    Ok(Json(SlotsResponse {
        slots: s
            .service
            .slots_in_zone(
                profile,
                event,
                q.date,
                q.time_zone.unwrap_or(chrono_tz::UTC),
            )
            .await?,
    }))
}
async fn book<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
    State(s): State<RouterState<R, C, D, A>>,
    Path((profile, event)): Path<(Uuid, Uuid)>,
    Json(request): Json<BookingRequest>,
) -> Result<Json<ReceiptResponse>, ApiError> {
    let r = s.service.book(profile, event, request).await?;
    Ok(Json(ReceiptResponse {
        booking: r.booking,
        token: r.token,
        schedule_time_zone: r.schedule.time_zone,
    }))
}
async fn receipt<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
    State(s): State<RouterState<R, C, D, A>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<ReceiptResponse>, ApiError> {
    let r = s.service.receipt(id, booking_token(&headers)?).await?;
    Ok(Json(ReceiptResponse {
        booking: r.booking,
        token: r.token,
        schedule_time_zone: r.schedule.time_zone,
    }))
}
async fn cancel_public<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
    State(s): State<RouterState<R, C, D, A>>,
    Path(id): Path<Uuid>,
    Json(q): Json<Token>,
) -> Result<Json<BookingResponse>, ApiError> {
    Ok(Json(BookingResponse {
        booking: s.service.cancel(id, Some(q.token), None).await?,
    }))
}

async fn replacement_slots<
    R: Repository,
    C: Calendars,
    D: Directory,
    A: MacroAuthorizationService,
>(
    State(s): State<RouterState<R, C, D, A>>,
    Path(id): Path<Uuid>,
    Query(q): Query<ReplacementQuery>,
    headers: HeaderMap,
) -> Result<Json<SlotsResponse>, ApiError> {
    Ok(Json(SlotsResponse {
        slots: s
            .service
            .replacement_slots(id, booking_token(&headers)?, q.date)
            .await?,
    }))
}
async fn reschedule<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
    State(s): State<RouterState<R, C, D, A>>,
    Path(id): Path<Uuid>,
    Json(q): Json<RescheduleRequest>,
) -> Result<Json<ReceiptResponse>, ApiError> {
    let r = s.service.reschedule(id, q.token, q.starts_at).await?;
    Ok(Json(ReceiptResponse {
        booking: r.booking,
        token: r.token,
        schedule_time_zone: r.schedule.time_zone,
    }))
}

async fn manage<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
    State(s): State<RouterState<R, C, D, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Result<Json<ReceiptResponse>, ApiError> {
    let r = s
        .service
        .manage(user.authorization.user.macro_user_id.as_ref(), id)
        .await?;
    Ok(Json(ReceiptResponse {
        booking: r.booking,
        token: r.token,
        schedule_time_zone: r.schedule.time_zone,
    }))
}

fn booking_token(headers: &HeaderMap) -> Result<Uuid, ApiError> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or(ApiError(Error::NotFound))
}

async fn no_store(request: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("private, no-store"),
    );
    response
}

#[cfg(all(test, feature = "postgres"))]
mod test;
