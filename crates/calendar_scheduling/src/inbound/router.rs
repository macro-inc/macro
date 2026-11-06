//! Thin HTTP routes; membership, availability, and write policy live in the service.
use crate::domain::{
    booking_links::{BookingLink, BookingLinkDraft, BookingLinkListing, BookingLinks},
    insights::{BookingInsights, InsightQuery},
    management::BookingChange,
    models::*,
    ports::*,
    service::Service,
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRef, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::{IntoParams, ToSchema};
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
            get(get_booking_settings::<R, C, D, A>).put(save_booking_settings::<R, C, D, A>),
        )
        .route(
            "/links",
            get(list_booking_links::<R, C, D, A>).post(create_booking_link::<R, C, D, A>),
        )
        .route("/links/{id}", put(edit_booking_link::<R, C, D, A>))
        .route("/bookings", get(list_bookings::<R, C, D, A>))
        .route("/insights", post(get_booking_insights::<R, C, D, A>))
        .route("/bookings/{id}/change", post(change_booking::<R, C, D, A>))
        .route(
            "/bookings/{id}/slots",
            get(list_booking_reschedule_slots::<R, C, D, A>),
        )
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
/// Personal scheduling, or a team's when `teamId` is set.
#[derive(Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct Scope {
    /// Team whose booking page to act on; omit for the caller's personal page.
    team_id: Option<Uuid>,
}
/// Booking-link search within a personal or team page.
#[derive(Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct LinkSearch {
    /// Team whose links to list; omit for the caller's personal links.
    team_id: Option<Uuid>,
    /// Text to match in a link's title, slug or description; omit for every link.
    query: Option<String>,
}
/// Half-open range of booking start times.
#[derive(Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct BookingRange {
    /// Team whose bookings to read; omit for the caller's personal bookings.
    team_id: Option<Uuid>,
    /// Inclusive earliest start. Give both ends or neither.
    from: Option<chrono::DateTime<chrono::Utc>>,
    /// Exclusive latest start, at most 733 days after `from`.
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
/// Day to search for replacement times.
#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ReplacementQuery {
    /// Date in the booking schedule's time zone.
    date: chrono::NaiveDate,
}
/// A full edited draft at the revision it was read at.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditBookingLinkRequest {
    /// Profile revision the draft was read at; a stale revision conflicts.
    expected_revision: i64,
    /// The link's complete new configuration.
    draft: BookingLinkDraft,
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
/// Saved booking-page settings.
#[derive(Serialize, ToSchema)]
pub struct ProfileResponse {
    /// Full settings, including the revision for the next save.
    profile: Profile,
}
/// Bookings in the requested range.
#[derive(Serialize, ToSchema)]
pub struct BookingsResponse {
    /// Every matching booking.
    bookings: Vec<Booking>,
}
/// One booking after a change.
#[derive(Serialize, ToSchema)]
pub struct BookingResponse {
    /// The booking as saved.
    booking: Booking,
}
/// One saved booking link.
#[derive(Serialize, ToSchema)]
pub struct BookingLinkResponse {
    /// The link as saved, with the revision for its next edit.
    link: BookingLink,
}
/// A scheduling failure.
#[derive(Serialize, ToSchema)]
pub struct SchedulingApiError {
    /// What went wrong, safe to show the user.
    message: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptResponse {
    booking: Booking,
    token: Uuid,
    schedule_time_zone: chrono_tz::Tz,
}
/// Available start times.
#[derive(Serialize, ToSchema)]
pub struct SlotsResponse {
    /// Every available slot, earliest first.
    slots: Vec<Slot>,
}
#[derive(Serialize)]
struct PublicResponse {
    profile: PublicProfile,
}
/// A scheduling failure, rendered as [`SchedulingApiError`].
pub struct ApiError(Error);
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
            Json(SchedulingApiError {
                message: self.0.to_string(),
            }),
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
/// Read the personal or team booking page settings without creating them.
#[utoipa::path(
    get,
    path = "/scheduling/settings",
    tag = "calendar_scheduling",
    params(Scope),
    responses(
        (status = 200, description = "Current settings", body = ProfileResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "The caller may not manage this page", body = SchedulingApiError),
        (status = 503, description = "Scheduling is temporarily unavailable", body = SchedulingApiError),
    )
)]
pub async fn get_booking_settings<
    R: Repository,
    C: Calendars,
    D: Directory,
    A: MacroAuthorizationService,
>(
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
/// Save booking page settings at the revision they were read at.
#[utoipa::path(
    put,
    path = "/scheduling/settings",
    tag = "calendar_scheduling",
    params(Scope),
    request_body = Profile,
    responses(
        (status = 200, description = "Saved settings", body = ProfileResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "The caller may not manage this page", body = SchedulingApiError),
        (status = 400, description = "Invalid settings", body = SchedulingApiError),
        (status = 409, description = "The settings changed since they were read", body = SchedulingApiError),
        (status = 503, description = "Scheduling is temporarily unavailable", body = SchedulingApiError),
    )
)]
pub async fn save_booking_settings<
    R: Repository,
    C: Calendars,
    D: Directory,
    A: MacroAuthorizationService,
>(
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
/// Read every booking starting in a half-open range, or fail when too many match.
#[utoipa::path(
    get,
    path = "/scheduling/bookings",
    tag = "calendar_scheduling",
    params(BookingRange),
    responses(
        (status = 200, description = "Matching bookings", body = BookingsResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "The caller may not manage this page", body = SchedulingApiError),
        (status = 400, description = "Invalid or oversized range", body = SchedulingApiError),
        (status = 503, description = "Scheduling is temporarily unavailable", body = SchedulingApiError),
    )
)]
pub async fn list_bookings<
    R: Repository,
    C: Calendars,
    D: Directory,
    A: MacroAuthorizationService,
>(
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
    Query(q): Query<SlotQuery>,
    headers: HeaderMap,
) -> Result<Json<SlotsResponse>, ApiError> {
    Ok(Json(SlotsResponse {
        slots: s
            .service
            .replacement_slots(id, booking_token(&headers)?, q.date, q.time_zone)
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

/// Booking statistics for a local-date period and the equally long period before it.
#[utoipa::path(
    post,
    path = "/scheduling/insights",
    tag = "calendar_scheduling",
    params(Scope),
    request_body = InsightQuery,
    responses(
        (status = 200, description = "Current and previous period statistics", body = BookingInsights),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "The caller may not manage this page", body = SchedulingApiError),
        (status = 400, description = "Invalid period", body = SchedulingApiError),
        (status = 503, description = "Scheduling is temporarily unavailable", body = SchedulingApiError),
    )
)]
pub async fn get_booking_insights<
    R: Repository,
    C: Calendars,
    D: Directory,
    A: MacroAuthorizationService,
>(
    State(s): State<RouterState<R, C, D, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Query(scope): Query<Scope>,
    Json(query): Json<InsightQuery>,
) -> Result<Json<BookingInsights>, ApiError> {
    Ok(Json(
        s.service
            .booking_insights(
                user.authorization.user.macro_user_id.as_ref(),
                scope.team_id,
                query,
            )
            .await?,
    ))
}
/// Cancel, approve, record attendance on, or reschedule a booking.
#[utoipa::path(
    post,
    path = "/scheduling/bookings/{id}/change",
    tag = "calendar_scheduling",
    params(("id" = Uuid, Path, description = "Booking id")),
    request_body = BookingChange,
    responses(
        (status = 200, description = "The booking as saved", body = BookingResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "The caller may not manage this page", body = SchedulingApiError),
        (status = 400, description = "The change is not allowed now", body = SchedulingApiError),
        (status = 404, description = "No such booking", body = SchedulingApiError),
        (status = 409, description = "The time is no longer available", body = SchedulingApiError),
        (status = 503, description = "Scheduling is temporarily unavailable", body = SchedulingApiError),
    )
)]
pub async fn change_booking<
    R: Repository,
    C: Calendars,
    D: Directory,
    A: MacroAuthorizationService,
>(
    State(s): State<RouterState<R, C, D, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Path(id): Path<Uuid>,
    Json(change): Json<BookingChange>,
) -> Result<Json<BookingResponse>, ApiError> {
    Ok(Json(BookingResponse {
        booking: s
            .service
            .change_booking(user.authorization.user.macro_user_id.as_ref(), id, change)
            .await?,
    }))
}
/// Replacement start times for a booking on one date in its schedule zone.
#[utoipa::path(
    get,
    path = "/scheduling/bookings/{id}/slots",
    tag = "calendar_scheduling",
    params(("id" = Uuid, Path, description = "Booking id"), ReplacementQuery),
    responses(
        (status = 200, description = "Available replacement slots", body = SlotsResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "The caller may not manage this page", body = SchedulingApiError),
        (status = 404, description = "No such booking", body = SchedulingApiError),
        (status = 503, description = "Scheduling is temporarily unavailable", body = SchedulingApiError),
    )
)]
pub async fn list_booking_reschedule_slots<
    R: Repository,
    C: Calendars,
    D: Directory,
    A: MacroAuthorizationService,
>(
    State(s): State<RouterState<R, C, D, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Path(id): Path<Uuid>,
    Query(query): Query<ReplacementQuery>,
) -> Result<Json<SlotsResponse>, ApiError> {
    Ok(Json(SlotsResponse {
        slots: s
            .service
            .host_replacement_slots(
                user.authorization.user.macro_user_id.as_ref(),
                id,
                query.date,
            )
            .await?,
    }))
}

/// List booking links with their full drafts, plus the page's reusable schedules.
#[utoipa::path(
    get,
    path = "/scheduling/links",
    tag = "calendar_scheduling",
    params(LinkSearch),
    responses(
        (status = 200, description = "Matching links and reusable availability", body = BookingLinkListing),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "The caller may not manage this page", body = SchedulingApiError),
        (status = 503, description = "Scheduling is temporarily unavailable", body = SchedulingApiError),
    )
)]
pub async fn list_booking_links<
    R: Repository,
    C: Calendars,
    D: Directory,
    A: MacroAuthorizationService,
>(
    State(s): State<RouterState<R, C, D, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Query(q): Query<LinkSearch>,
) -> Result<Json<BookingLinkListing>, ApiError> {
    Ok(Json(
        s.service
            .list_links(
                user.authorization.user.macro_user_id.as_ref(),
                q.team_id,
                q.query.as_deref(),
            )
            .await?,
    ))
}
/// Create a booking link; an identical draft at the same slug returns the saved link.
#[utoipa::path(
    post,
    path = "/scheduling/links",
    tag = "calendar_scheduling",
    params(Scope),
    request_body = BookingLinkDraft,
    responses(
        (status = 200, description = "The saved link", body = BookingLinkResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "The caller may not manage this page", body = SchedulingApiError),
        (status = 400, description = "Invalid draft", body = SchedulingApiError),
        (status = 409, description = "A different link already uses this slug", body = SchedulingApiError),
        (status = 503, description = "Scheduling is temporarily unavailable", body = SchedulingApiError),
    )
)]
pub async fn create_booking_link<
    R: Repository,
    C: Calendars,
    D: Directory,
    A: MacroAuthorizationService,
>(
    State(s): State<RouterState<R, C, D, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Query(q): Query<Scope>,
    Json(draft): Json<BookingLinkDraft>,
) -> Result<Json<BookingLinkResponse>, ApiError> {
    Ok(Json(BookingLinkResponse {
        link: s
            .service
            .create_link(
                user.authorization.user.macro_user_id.as_ref(),
                q.team_id,
                draft,
            )
            .await?,
    }))
}
/// Replace one booking link's draft; other links and schedules keep their settings.
#[utoipa::path(
    put,
    path = "/scheduling/links/{id}",
    tag = "calendar_scheduling",
    params(("id" = Uuid, Path, description = "Booking link id"), Scope),
    request_body = EditBookingLinkRequest,
    responses(
        (status = 200, description = "The saved link", body = BookingLinkResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "The caller may not manage this page", body = SchedulingApiError),
        (status = 400, description = "Invalid draft", body = SchedulingApiError),
        (status = 404, description = "No such link", body = SchedulingApiError),
        (status = 409, description = "The page changed since the link was read", body = SchedulingApiError),
        (status = 503, description = "Scheduling is temporarily unavailable", body = SchedulingApiError),
    )
)]
pub async fn edit_booking_link<
    R: Repository,
    C: Calendars,
    D: Directory,
    A: MacroAuthorizationService,
>(
    State(s): State<RouterState<R, C, D, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Path(id): Path<Uuid>,
    Query(q): Query<Scope>,
    Json(request): Json<EditBookingLinkRequest>,
) -> Result<Json<BookingLinkResponse>, ApiError> {
    Ok(Json(BookingLinkResponse {
        link: s
            .service
            .edit_link(
                user.authorization.user.macro_user_id.as_ref(),
                q.team_id,
                id,
                request.expected_revision,
                request.draft,
            )
            .await?,
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
