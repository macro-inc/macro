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
        .route("/insights", post(insights::<R, C, D, A>))
        .route(
            "/links",
            get(list_links::<R, C, D, A>).post(create_link::<R, C, D, A>),
        )
        .route("/links/{id}", put(edit_link::<R, C, D, A>))
        .route("/bookings/{id}/change", post(change::<R, C, D, A>))
        .route("/bookings/{id}/slots", get(host_slots::<R, C, D, A>))
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
/// Personal settings when `teamId` is omitted, otherwise that team's.
#[derive(Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct Scope {
    /// Existing Macro team; omit for the caller's personal booking links.
    team_id: Option<Uuid>,
}
/// Bookings of one profile, optionally limited to a half-open start range.
#[derive(Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct BookingRange {
    /// Existing Macro team; omit for personal bookings.
    team_id: Option<Uuid>,
    /// Inclusive start; supply together with `to`, at most 733 days apart.
    from: Option<chrono::DateTime<chrono::Utc>>,
    /// Exclusive end; supply together with `from`.
    to: Option<chrono::DateTime<chrono::Utc>>,
}
/// Booking links of one profile, optionally searched.
#[derive(Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct LinkSearch {
    /// Existing Macro team; omit for personal links.
    team_id: Option<Uuid>,
    /// Text matched against link title, slug and description; omit for all links.
    query: Option<String>,
}
/// A new booking link, saved after the user approved it.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateBookingLinkRequest {
    /// Full booking rules and availability the user approved.
    draft: BookingLinkDraft,
    /// The user's reply approving this proposal, quoted verbatim.
    user_confirmation: String,
}
/// Replacement configuration for one booking link, saved after the user approved it.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditBookingLinkRequest {
    /// Profile revision the edit was prepared from; a newer revision conflicts.
    expected_revision: i64,
    /// Full edited booking rules and availability the user approved.
    draft: BookingLinkDraft,
    /// The user's reply approving this proposal, quoted verbatim.
    user_confirmation: String,
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
/// One local date of replacement times.
#[derive(Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ReplacementQuery {
    /// Date in the booking's schedule time zone.
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
/// Booking settings of one profile.
#[derive(Serialize, utoipa::ToSchema)]
pub struct ProfileResponse {
    /// Full settings, including the revision to save against.
    profile: Profile,
}
/// Bookings of one profile.
#[derive(Serialize, utoipa::ToSchema)]
pub struct BookingsResponse {
    /// Every matching booking.
    bookings: Vec<Booking>,
}
/// One booking after a change.
#[derive(Serialize, utoipa::ToSchema)]
pub struct BookingResponse {
    /// The saved booking.
    booking: Booking,
}
/// A booking with its booker management capability.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptResponse {
    /// The booking.
    booking: Booking,
    /// Bearer capability for the booker's receipt, reschedule and cancel pages.
    token: Uuid,
    /// IANA time zone of the booking's availability schedule.
    #[schema(value_type = String)]
    schedule_time_zone: chrono_tz::Tz,
}
/// Available start times.
#[derive(Serialize, utoipa::ToSchema)]
pub struct SlotsResponse {
    /// Every available slot.
    slots: Vec<Slot>,
}
#[derive(Serialize)]
struct PublicResponse {
    profile: PublicProfile,
}
/// Scheduling error rendered as its HTTP status and a `message`.
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
/// Read personal or team booking settings without creating them.
#[utoipa::path(get, path = "/scheduling/settings", operation_id = "get_booking_settings", params(Scope), responses((status = 200, body = ProfileResponse), (status = 403), (status = 404)), tag = "scheduling")]
pub async fn settings<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
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
/// Save booking settings at the revision they were read with.
#[utoipa::path(put, path = "/scheduling/settings", operation_id = "save_booking_settings", params(Scope), request_body = Profile, responses((status = 200, body = ProfileResponse), (status = 400), (status = 403), (status = 409)), tag = "scheduling")]
pub async fn save<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
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
/// List the profile's bookings, optionally those starting in a half-open range.
#[utoipa::path(get, path = "/scheduling/bookings", operation_id = "list_bookings", params(BookingRange), responses((status = 200, body = BookingsResponse), (status = 400), (status = 403)), tag = "scheduling")]
pub async fn bookings<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
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

/// Read one booking as its personal owner, a host, or a team administrator.
#[utoipa::path(get, path = "/scheduling/bookings/{id}/manage", operation_id = "get_managed_booking", params(("id" = Uuid, Path, description = "Booking identity")), responses((status = 200, body = ReceiptResponse), (status = 403), (status = 404)), tag = "scheduling")]
pub async fn manage<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
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

/// Booking statistics for a local date range and the equally long period before it.
#[utoipa::path(post, path = "/scheduling/insights", operation_id = "get_booking_insights", params(Scope), request_body = InsightQuery, responses((status = 200, body = BookingInsights), (status = 400), (status = 403)), tag = "scheduling")]
pub async fn insights<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
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
/// Approve, cancel, record attendance for, or reschedule one booking.
#[utoipa::path(post, path = "/scheduling/bookings/{id}/change", operation_id = "change_booking", params(("id" = Uuid, Path, description = "Booking identity")), request_body = BookingChange, responses((status = 200, body = BookingResponse), (status = 400), (status = 403), (status = 404), (status = 409)), tag = "scheduling")]
pub async fn change<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
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
/// Replacement start times for one booking on a schedule-local date.
#[utoipa::path(get, path = "/scheduling/bookings/{id}/slots", operation_id = "list_booking_reschedule_slots", params(("id" = Uuid, Path, description = "Booking identity"), ReplacementQuery), responses((status = 200, body = SlotsResponse), (status = 403), (status = 404)), tag = "scheduling")]
pub async fn host_slots<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
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

/// List and search booking links with their full drafts and reusable schedules.
#[utoipa::path(get, path = "/scheduling/links", operation_id = "list_booking_links", params(LinkSearch), responses((status = 200, body = BookingLinkListing), (status = 403)), tag = "scheduling")]
pub async fn list_links<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
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

/// Create a booking link; an identical replay at the same slug returns the saved link.
#[utoipa::path(post, path = "/scheduling/links", operation_id = "create_booking_link", params(Scope), request_body = CreateBookingLinkRequest, responses((status = 200, body = BookingLink), (status = 400), (status = 403), (status = 409)), tag = "scheduling")]
pub async fn create_link<
    R: Repository,
    C: Calendars,
    D: Directory,
    A: MacroAuthorizationService,
>(
    State(s): State<RouterState<R, C, D, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Query(q): Query<Scope>,
    Json(request): Json<CreateBookingLinkRequest>,
) -> Result<Json<BookingLink>, ApiError> {
    require_confirmation(&request.user_confirmation)?;
    Ok(Json(
        s.service
            .create_link(
                user.authorization.user.macro_user_id.as_ref(),
                q.team_id,
                request.draft,
            )
            .await?,
    ))
}

/// Replace one booking link's configuration at the profile revision it was read with.
#[utoipa::path(put, path = "/scheduling/links/{id}", operation_id = "edit_booking_link", params(("id" = Uuid, Path, description = "Booking link (event type) identity"), Scope), request_body = EditBookingLinkRequest, responses((status = 200, body = BookingLink), (status = 400), (status = 403), (status = 404), (status = 409)), tag = "scheduling")]
pub async fn edit_link<R: Repository, C: Calendars, D: Directory, A: MacroAuthorizationService>(
    State(s): State<RouterState<R, C, D, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Path(id): Path<Uuid>,
    Query(q): Query<Scope>,
    Json(request): Json<EditBookingLinkRequest>,
) -> Result<Json<BookingLink>, ApiError> {
    require_confirmation(&request.user_confirmation)?;
    Ok(Json(
        s.service
            .edit_link(
                user.authorization.user.macro_user_id.as_ref(),
                q.team_id,
                id,
                request.expected_revision,
                request.draft,
            )
            .await?,
    ))
}

/// Booking-link writes save immediately, so they carry the user's approving reply.
fn require_confirmation(confirmation: &str) -> Result<(), ApiError> {
    if confirmation.trim().is_empty() {
        return Err(ApiError(Error::Invalid(
            "Quote the user's reply approving the booking link in userConfirmation".into(),
        )));
    }
    Ok(())
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
