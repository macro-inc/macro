//! Axum router for game leaderboard endpoints.
//!
//! Leaderboards pass the caller's optional verified team receipt inward;
//! round reports carry the game room in the body so the extractor can prove
//! edit access before the domain sees the report.

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::{EntityBodyAccessLevelExtractor, OptionalMacroUserTeamExtractorV2},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;
use models_permissions::share_permission::access_level::EditAccessLevel;
use serde::Deserialize;

use crate::domain::{
    models::{
        GameKind, GameLeaderboards, GamesError, GamesReceipt, RoundRecorded, RoundReport,
        ScoreSubmission,
    },
    ports::GamesService,
};

/// Router state for game endpoints.
pub struct GamesRouterState<S, Eas, Auth> {
    service: Arc<S>,
    entity_access_service: Arc<Eas>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Eas, Auth> Clone for GamesRouterState<S, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Eas, Auth> GamesRouterState<S, Eas, Auth>
where
    S: GamesService,
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

impl<S, Eas, Auth> FromRef<GamesRouterState<S, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &GamesRouterState<S, Eas, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<S, Eas, Auth> FromRef<GamesRouterState<S, Eas, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &GamesRouterState<S, Eas, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the games router.
///
/// Routes:
/// - `GET /leaderboards` — every game's leaderboard for the caller's team.
/// - `POST /scores` — record a finished run of a high-score game.
/// - `POST /rounds` — record a finished round of a win-ranked game room.
pub fn games_router<S, Eas, Auth, T>(state: GamesRouterState<S, Eas, Auth>) -> Router<T>
where
    S: GamesService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/leaderboards",
            get(get_leaderboards_handler::<S, Eas, Auth>),
        )
        .route("/scores", post(submit_score_handler::<S, Eas, Auth>))
        .route("/rounds", post(report_round_handler::<S, Eas, Auth>))
        .with_state(state)
}

/// Request body for a finished run.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SubmitScoreRequest {
    /// The high-score game that was played.
    pub kind: GameKind,
    /// Points, words per minute, or clear time in milliseconds.
    pub score: i64,
}

/// The only kind of entity a round is reported for.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum GameRoomEntityType {
    /// A game room document.
    Document,
}

/// Request body for a finished round of a game room.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReportRoundRequest {
    /// Rounds are played in game room documents.
    pub entity_type: GameRoomEntityType,
    /// The game room's document id.
    pub entity_id: String,
    /// The game played in the room.
    pub kind: GameKind,
    /// Zero-based round index within the room.
    pub round: i32,
    /// The outright winner; omitted for a draw or a shared win.
    #[serde(default)]
    pub winner_user_id: Option<MacroUserIdStr<'static>>,
    /// Everyone seated for the round, including the reporter.
    pub player_user_ids: Vec<MacroUserIdStr<'static>>,
}

/// Every game's leaderboard for the caller's team, or the caller alone.
#[utoipa::path(
    get,
    tag = "games",
    operation_id = "get_game_leaderboards",
    path = "/games/leaderboards",
    responses(
        (status = 200, body = GameLeaderboards),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_leaderboards_handler<S, Eas, Auth>(
    State(state): State<GamesRouterState<S, Eas, Auth>>,
    access: OptionalMacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<GameLeaderboards>, GamesError>
where
    S: GamesService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let receipt = GamesReceipt::from_access(
        user.authorization.macro_user_id,
        access.entity_access_receipt,
    )?;
    Ok(Json(state.service.leaderboards(&receipt).await?))
}

/// Record a finished run; the caller's best score only ever improves.
#[utoipa::path(
    post,
    tag = "games",
    operation_id = "submit_game_score",
    path = "/games/scores",
    request_body = SubmitScoreRequest,
    responses(
        (status = 200, body = ScoreSubmission),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn submit_score_handler<S, Eas, Auth>(
    State(state): State<GamesRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Json(request): Json<SubmitScoreRequest>,
) -> Result<Json<ScoreSubmission>, GamesError>
where
    S: GamesService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .submit_score(
                &user.authorization.macro_user_id,
                request.kind,
                request.score,
            )
            .await?,
    ))
}

/// Report a finished round of a game room the caller can edit and played in.
/// The round counts on leaderboards once two of its players report the same
/// result.
#[utoipa::path(
    post,
    tag = "games",
    operation_id = "report_game_round",
    path = "/games/rounds",
    request_body = ReportRoundRequest,
    responses(
        (status = 200, body = RoundRecorded),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn report_round_handler<S, Eas, Auth>(
    State(state): State<GamesRouterState<S, Eas, Auth>>,
    access: EntityBodyAccessLevelExtractor<EditAccessLevel, Eas, ReportRoundRequest, Auth>,
) -> Result<Json<RoundRecorded>, GamesError>
where
    S: GamesService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let request = access.inner;
    let report = RoundReport {
        kind: request.kind,
        round: request.round,
        winner: request.winner_user_id,
        players: request.player_user_ids,
    };
    Ok(Json(
        state
            .service
            .report_round(access.entity_access_receipt, report)
            .await?,
    ))
}

impl IntoResponse for GamesError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            GamesError::BadRequest(_) => StatusCode::BAD_REQUEST,
            GamesError::Unauthorized => StatusCode::FORBIDDEN,
            GamesError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = match &self {
            GamesError::Internal(_) => {
                tracing::error!(error=?self, "games internal server error");
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
