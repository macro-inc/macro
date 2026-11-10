//! HTTP routes for computers: team routes (members read, admins buy and
//! manage) and the internal purchase route other services call.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use entity_access::{
    domain::models::{
        AdminTeamRole, EntityAccessAuth, EntityAccessReceipt, MemberTeamRole, RequiredPermission,
    },
    domain::ports::EntityAccessService,
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::{
    InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::ids::ComputerId;
use crate::domain::models::{
    ComputerStatus, PurchaseBilling, PurchaseRequest, Quote, SizeOffer, SubscriptionItem,
};
use crate::domain::ports::{
    Billing, BillingError, CompPolicy, ComputerRepo, FleetAttachmentSource, NoComps,
};
use crate::domain::service::{Clock, ComputerError, ComputerService};
use crate::domain::size::ComputerSize;

/// Router state: the computer service plus what team access checks need.
pub struct ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy = NoComps> {
    /// Computer use cases.
    pub service: Arc<ComputerService<Repo, Bill, Time, Attachment, Policy>>,
    /// Team access receipt provider.
    pub entity_access_service: Arc<Eas>,
    /// Authentication services for route extractors.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<Repo, Bill, Time, Eas, Auth, Attachment, Policy> Clone
    for ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Repo, Bill, Time, Eas, Auth, Attachment, Policy>
    FromRef<ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>> for Arc<Eas>
{
    fn from_ref(
        state: &ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>,
    ) -> Self {
        state.entity_access_service.clone()
    }
}

impl<Repo, Bill, Time, Eas, Auth, Attachment, Policy>
    FromRef<ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(
        state: &ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>,
    ) -> Self {
        state.authorization_state.clone()
    }
}

/// Team routes, to merge at the service root.
pub fn team_router<Repo, Bill, Time, Eas, Auth, Attachment, Policy, S>(
    state: ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>,
) -> Router<S>
where
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
    S: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/team/computers",
            get(list::<Repo, Bill, Time, Eas, Auth, Attachment, Policy>)
                .post(purchase::<Repo, Bill, Time, Eas, Auth, Attachment, Policy>),
        )
        .route(
            "/team/computers/offers",
            get(offers::<Repo, Bill, Time, Eas, Auth, Attachment, Policy>),
        )
        .route(
            "/team/computers/quote",
            get(quote::<Repo, Bill, Time, Eas, Auth, Attachment, Policy>),
        )
        .route(
            "/team/computers/notify",
            post(notify_me::<Repo, Bill, Time, Eas, Auth, Attachment, Policy>),
        )
        .route(
            "/team/computers/{computer_id}",
            get(status::<Repo, Bill, Time, Eas, Auth, Attachment, Policy>),
        )
        .route(
            "/team/computers/{computer_id}/power",
            post(power::<Repo, Bill, Time, Eas, Auth, Attachment, Policy>),
        )
        .route(
            "/team/computers/{computer_id}/retry",
            post(retry::<Repo, Bill, Time, Eas, Auth, Attachment, Policy>),
        )
        .route(
            "/team/computers/{computer_id}/cancel",
            post(cancel::<Repo, Bill, Time, Eas, Auth, Attachment, Policy>)
                .delete(undo_cancel::<Repo, Bill, Time, Eas, Auth, Attachment, Policy>),
        )
        .route(
            "/team/computers/{computer_id}/release",
            post(release::<Repo, Bill, Time, Eas, Auth, Attachment, Policy>),
        )
        .with_state(state)
}

/// Internal routes, to nest under `/internal`. Each requires the internal
/// API key; callers have authorized the team admin themselves.
pub fn internal_router<Repo, Bill, Time, Eas, Auth, Attachment, Policy, S>(
    state: ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>,
) -> Router<S>
where
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
    S: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/computers",
            post(internal_purchase::<Repo, Bill, Time, Eas, Auth, Attachment, Policy>),
        )
        .route(
            "/computers/quote",
            get(internal_quote::<Repo, Bill, Time, Eas, Auth, Attachment, Policy>),
        )
        .route(
            "/computers/{computer_id}",
            get(internal_status::<Repo, Bill, Time, Eas, Auth, Attachment, Policy>),
        )
        .with_state(state)
}

fn team_id<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<Uuid, ComputersHttpError> {
    Uuid::parse_str(&receipt.entity().entity_id)
        .map_err(|_| ComputersHttpError(ComputerError::BadRequest("invalid team".to_owned())))
}

fn user_id<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<MacroUserIdStr<'static>, ComputersHttpError> {
    match receipt.auth() {
        EntityAccessAuth::Authenticated(user_id) => Ok(user_id.clone()),
        _ => Err(ComputersHttpError(ComputerError::BadRequest(
            "computers are managed by signed-in team members".to_owned(),
        ))),
    }
}

/// The team's computers, oldest first.
#[utoipa::path(
    get,
    path = "/team/computers",
    operation_id = "list_team_computers",
    responses(
        (status = 200, body = Vec<ComputerStatus>),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn list<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>>,
) -> Result<Json<Vec<ComputerStatus>>, ComputersHttpError> {
    let team_id = team_id(&access.entity_access_receipt)?;
    Ok(Json(state.service.list(team_id).await?))
}

/// One computer, with setup progress until it first connects.
#[utoipa::path(
    get,
    path = "/team/computers/{computer_id}",
    operation_id = "get_team_computer",
    params(("computer_id" = Uuid, Path)),
    responses(
        (status = 200, body = ComputerStatus),
        (status = 404, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(computer_id = %computer_id), err)]
pub async fn status<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>>,
    Path(computer_id): Path<ComputerId>,
) -> Result<Json<ComputerStatus>, ComputersHttpError> {
    let team_id = team_id(&access.entity_access_receipt)?;
    Ok(Json(state.service.status(team_id, computer_id).await?))
}

/// Every size with its price and availability.
#[utoipa::path(
    get,
    path = "/team/computers/offers",
    operation_id = "list_team_computer_offers",
    responses((status = 200, body = Vec<SizeOffer>), (status = 503, body = ErrorResponse)),
)]
#[tracing::instrument(skip_all, err)]
pub async fn offers<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>>,
) -> Result<Json<Vec<SizeOffer>>, ComputersHttpError> {
    let receipt = &access.entity_access_receipt;
    Ok(Json(
        state
            .service
            .offers(team_id(receipt)?, user_id(receipt)?)
            .await?,
    ))
}

/// Query of a quote.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct QuoteQuery {
    /// Purchased catalog size.
    pub size: ComputerSize,
}

/// The price of one computer of a size for the team.
#[utoipa::path(
    get,
    path = "/team/computers/quote",
    operation_id = "quote_team_computer",
    params(QuoteQuery),
    responses((status = 200, body = Quote), (status = 503, body = ErrorResponse)),
)]
#[tracing::instrument(skip_all, err)]
pub async fn quote<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>>,
    Query(query): Query<QuoteQuery>,
) -> Result<Json<Quote>, ComputersHttpError> {
    let team_id = team_id(&access.entity_access_receipt)?;
    Ok(Json(
        state
            .service
            .quote_for_team(
                &user_id(&access.entity_access_receipt)?,
                team_id,
                query.size,
            )
            .await?,
    ))
}

/// Body of a team purchase.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PurchaseBody {
    /// Purchased catalog size.
    pub size: ComputerSize,
    /// Display name.
    pub name: Option<String>,
}

/// Answer of a purchase.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Purchased {
    /// Computer this operation addresses.
    #[schema(value_type = Uuid)]
    pub computer_id: ComputerId,
}

/// Buy a computer for the team, billed on the team subscription.
#[utoipa::path(
    post,
    path = "/team/computers",
    operation_id = "purchase_team_computer",
    request_body = PurchaseBody,
    responses(
        (status = 200, body = Purchased),
        (status = 402, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 503, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn purchase<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>>,
    Json(body): Json<PurchaseBody>,
) -> Result<Json<Purchased>, ComputersHttpError> {
    let receipt = &access.entity_access_receipt;
    let computer_id = state
        .service
        .purchase_for_team(PurchaseRequest {
            billing: PurchaseBilling::Stripe,
            team_id: team_id(receipt)?,
            created_by: user_id(receipt)?,
            size: body.size,
            name: body.name,
            extra_items: vec![],
        })
        .await?;
    Ok(Json(Purchased { computer_id }))
}

/// Body of a power change.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PowerBody {
    /// Requested power state.
    pub on: bool,
}

/// Turn a computer on or off. A computer that is off keeps its disk and stays billed.
#[utoipa::path(
    post,
    path = "/team/computers/{computer_id}/power",
    operation_id = "set_team_computer_power",
    params(("computer_id" = Uuid, Path)),
    request_body = PowerBody,
    responses((status = 200, body = ComputerStatus)),
)]
#[tracing::instrument(skip_all, fields(computer_id = %computer_id), err)]
pub async fn power<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>>,
    Path(computer_id): Path<ComputerId>,
    Json(body): Json<PowerBody>,
) -> Result<Json<ComputerStatus>, ComputersHttpError> {
    let team_id = team_id(&access.entity_access_receipt)?;
    Ok(Json(
        state
            .service
            .set_power(team_id, computer_id, body.on)
            .await?,
    ))
}

/// Retry a failed computer without changing billing.
#[utoipa::path(
    post,
    path = "/team/computers/{computer_id}/retry",
    operation_id = "retry_team_computer",
    params(("computer_id" = Uuid, Path)),
    responses(
        (status = 200, body = ComputerStatus),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(computer_id = %computer_id), err)]
pub async fn retry<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>>,
    Path(computer_id): Path<ComputerId>,
) -> Result<Json<ComputerStatus>, ComputersHttpError> {
    let team_id = team_id(&access.entity_access_receipt)?;
    Ok(Json(state.service.retry(team_id, computer_id).await?))
}

/// Stop billing at the end of the current period.
#[utoipa::path(
    post,
    path = "/team/computers/{computer_id}/cancel",
    operation_id = "cancel_team_computer",
    params(("computer_id" = Uuid, Path)),
    responses((status = 200, body = ComputerStatus)),
)]
#[tracing::instrument(skip_all, fields(computer_id = %computer_id), err)]
pub async fn cancel<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>>,
    Path(computer_id): Path<ComputerId>,
) -> Result<Json<ComputerStatus>, ComputersHttpError> {
    let team_id = team_id(&access.entity_access_receipt)?;
    Ok(Json(state.service.cancel(team_id, computer_id).await?))
}

/// Keep a computer that was canceled at period end.
#[utoipa::path(
    delete,
    path = "/team/computers/{computer_id}/cancel",
    operation_id = "undo_cancel_team_computer",
    params(("computer_id" = Uuid, Path)),
    responses((status = 200, body = ComputerStatus)),
)]
#[tracing::instrument(skip_all, fields(computer_id = %computer_id), err)]
pub async fn undo_cancel<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>>,
    Path(computer_id): Path<ComputerId>,
) -> Result<Json<ComputerStatus>, ComputersHttpError> {
    let team_id = team_id(&access.entity_access_receipt)?;
    Ok(Json(state.service.undo_cancel(team_id, computer_id).await?))
}

/// Body of a release.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseBody {
    /// The computer's name, typed to confirm.
    pub confirm_name: String,
}

/// Stop billing and destroy the computer now, without a refund.
#[utoipa::path(
    post,
    path = "/team/computers/{computer_id}/release",
    operation_id = "release_team_computer",
    params(("computer_id" = Uuid, Path)),
    request_body = ReleaseBody,
    responses(
        (status = 200, body = ComputerStatus),
        (status = 400, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(computer_id = %computer_id), err)]
pub async fn release<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>>,
    Path(computer_id): Path<ComputerId>,
    Json(body): Json<ReleaseBody>,
) -> Result<Json<ComputerStatus>, ComputersHttpError> {
    let team_id = team_id(&access.entity_access_receipt)?;
    Ok(Json(
        state
            .service
            .release_now(team_id, computer_id, &body.confirm_name)
            .await?,
    ))
}

/// Body of a notify-me request.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotifyBody {
    /// Purchased catalog size.
    pub size: ComputerSize,
}

/// Ask to hear when a sold-out size is back.
#[utoipa::path(
    post,
    path = "/team/computers/notify",
    operation_id = "notify_team_computer_available",
    request_body = NotifyBody,
    responses((status = 204)),
)]
#[tracing::instrument(skip_all, err)]
pub async fn notify_me<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>>,
    Json(body): Json<NotifyBody>,
) -> Result<StatusCode, ComputersHttpError> {
    let receipt = &access.entity_access_receipt;
    state
        .service
        .notify_me(team_id(receipt)?, user_id(receipt)?, body.size)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Body of an internal purchase.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InternalPurchaseBody {
    /// Purchase funding or billing state.
    pub billing: PurchaseBilling,
    /// Team that owns the computer.
    pub team_id: Uuid,
    /// The team admin or owner the caller authorized.
    pub created_by: String,
    /// Purchased catalog size.
    pub size: ComputerSize,
    /// Display name.
    pub name: Option<String>,
    /// Joined into the same subscription update, e.g. an agent seat.
    #[serde(default)]
    pub extra_items: Vec<SubscriptionItem>,
}

/// Buy a computer for a team; one subscription update covers the computer
/// and `extraItems`.
#[utoipa::path(
    post,
    path = "/internal/computers",
    operation_id = "internal_purchase_computer",
    request_body = InternalPurchaseBody,
    responses((status = 200, body = Purchased), (status = 503, body = ErrorResponse)),
)]
#[tracing::instrument(skip_all, fields(team_id = %body.team_id), err)]
pub async fn internal_purchase<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
>(
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    State(state): State<ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>>,
    Json(body): Json<InternalPurchaseBody>,
) -> Result<Json<Purchased>, ComputersHttpError> {
    let computer_id = state
        .service
        .purchase(PurchaseRequest {
            billing: body.billing,
            team_id: body.team_id,
            created_by: MacroUserIdStr::try_from(body.created_by).map_err(|error| {
                ComputersHttpError(ComputerError::BadRequest(error.to_string()))
            })?,
            size: body.size,
            name: body.name,
            extra_items: body.extra_items,
        })
        .await?;
    Ok(Json(Purchased { computer_id }))
}

/// Query naming a team and size.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct InternalQuoteQuery {
    /// Team that owns the computer.
    pub team_id: Uuid,
    /// Purchased catalog size.
    pub size: ComputerSize,
}

#[utoipa::path(
    get,
    path = "/internal/computers/quote",
    operation_id = "internal_quote_computer",
    params(InternalQuoteQuery),
    responses((status = 200, body = Quote), (status = 503, body = ErrorResponse)),
)]
/// Quote a computer for an authenticated internal caller.
#[tracing::instrument(skip_all, err)]
pub async fn internal_quote<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
>(
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    State(state): State<ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>>,
    Query(query): Query<InternalQuoteQuery>,
) -> Result<Json<Quote>, ComputersHttpError> {
    Ok(Json(
        state
            .service
            .quote(query.team_id, query.size, &PurchaseBilling::Stripe)
            .await?,
    ))
}

/// Query naming a team.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct InternalTeamQuery {
    /// Team that owns the computer.
    pub team_id: Uuid,
}

#[utoipa::path(
    get,
    path = "/internal/computers/{computer_id}",
    operation_id = "internal_get_computer",
    params(("computer_id" = Uuid, Path), InternalTeamQuery),
    responses((status = 200, body = ComputerStatus)),
)]
/// Read computer status for an authenticated internal caller.
#[tracing::instrument(skip_all, fields(computer_id = %computer_id), err)]
pub async fn internal_status<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
>(
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    State(state): State<ComputerRouterState<Repo, Bill, Time, Eas, Auth, Attachment, Policy>>,
    Path(computer_id): Path<ComputerId>,
    Query(query): Query<InternalTeamQuery>,
) -> Result<Json<ComputerStatus>, ComputersHttpError> {
    Ok(Json(
        state.service.status(query.team_id, computer_id).await?,
    ))
}

/// An HTTP view of [`ComputerError`].
#[derive(Debug)]
pub struct ComputersHttpError(ComputerError);

impl From<ComputerError> for ComputersHttpError {
    fn from(error: ComputerError) -> Self {
        Self(error)
    }
}

impl std::fmt::Display for ComputersHttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl IntoResponse for ComputersHttpError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            ComputerError::FleetUnavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            ComputerError::RolloutDisabled => StatusCode::FORBIDDEN,
            ComputerError::NotFound => StatusCode::NOT_FOUND,
            ComputerError::SoldOut(_) | ComputerError::NotFailed => StatusCode::CONFLICT,
            ComputerError::BadRequest(_) | ComputerError::ConfirmationMismatch => {
                StatusCode::BAD_REQUEST
            }
            ComputerError::Billing(BillingError::NotAvailable) => StatusCode::SERVICE_UNAVAILABLE,
            ComputerError::Billing(BillingError::PaymentFailed) => StatusCode::PAYMENT_REQUIRED,
            ComputerError::Billing(BillingError::NoSubscription)
            | ComputerError::Billing(BillingError::IntervalNotSold(_)) => {
                StatusCode::UNPROCESSABLE_ENTITY
            }
            ComputerError::Billing(BillingError::Provider(_)) => StatusCode::BAD_GATEWAY,
            ComputerError::Internal(report) => {
                tracing::error!(error = ?report, "computer request failed");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        let message = match &self.0 {
            ComputerError::Internal(_) => "internal error".to_owned(),
            other => other.to_string(),
        };
        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

#[cfg(test)]
mod test;
