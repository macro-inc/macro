use std::sync::{Arc, Mutex};

use axum::http::header;
use chrono::{TimeZone, Utc};
use entity_access::domain::models::EntityAccessReceipt;
use entity_access::domain::ports::NoOpEntityAccessService;
use http_body_util::BodyExt;
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
};
use model_user::UserContext;
use rootcause::Report;
use tower::ServiceExt;

use super::*;
use crate::domain::models::{GameLeaderboard, GameScoring, LeaderboardEntry, LeaderboardScope};

const USER_ID: &str = "macro|games-router@macro.com";
const VALID_JWT: &str = "valid";

#[derive(Clone)]
struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != VALID_JWT {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(UserContext {
            user_id: USER_ID.to_string(),
            fusion_user_id: "cccccccc-cccc-cccc-cccc-cccccccccccc".to_string(),
            permissions: None,
            organization_id: None,
        })
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

#[derive(Clone, Default)]
struct FakeGamesService {
    scopes: Arc<Mutex<Vec<LeaderboardScope>>>,
    scores: Arc<Mutex<Vec<(GameKind, i64)>>>,
    rounds: Arc<Mutex<Vec<RoundReport>>>,
}

impl GamesService for FakeGamesService {
    async fn leaderboards(&self, receipt: &GamesReceipt) -> Result<GameLeaderboards, GamesError> {
        self.scopes.lock().unwrap().push(receipt.scope().clone());
        Ok(GameLeaderboards {
            team_id: None,
            games: vec![GameLeaderboard {
                kind: GameKind::Snake,
                scoring: GameScoring::HighScore,
                entries: vec![LeaderboardEntry {
                    user_id: receipt.user_id().clone(),
                    rank: 1,
                    value: 120,
                    at: Utc.with_ymd_and_hms(2026, 9, 1, 12, 0, 0).unwrap(),
                }],
                viewer: None,
            }],
        })
    }

    async fn submit_score(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        kind: GameKind,
        score: i64,
    ) -> Result<ScoreSubmission, GamesError> {
        self.scores.lock().unwrap().push((kind, score));
        Ok(ScoreSubmission {
            best: score,
            achieved_at: Utc.with_ymd_and_hms(2026, 9, 1, 12, 0, 0).unwrap(),
            improved: true,
        })
    }

    async fn report_round(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        report: RoundReport,
    ) -> Result<RoundRecorded, GamesError> {
        self.rounds.lock().unwrap().push(report);
        Ok(RoundRecorded { recorded: true })
    }
}

fn build_router(service: FakeGamesService) -> axum::Router {
    games_router(GamesRouterState::new(
        Arc::new(service),
        Arc::new(NoOpEntityAccessService),
        macro_authorization::MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
    ))
}

async fn send(
    service: &FakeGamesService,
    request: axum::http::request::Builder,
    body: Option<serde_json::Value>,
) -> (StatusCode, serde_json::Value) {
    let request = request.header(header::AUTHORIZATION, format!("Bearer {VALID_JWT}"));
    let request = match body {
        Some(body) => request
            .header(header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(body.to_string())),
        None => request.body(axum::body::Body::empty()),
    }
    .expect("request should build");
    let response = build_router(service.clone())
        .oneshot(request)
        .await
        .expect("router should respond");
    let status = response.status();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body should collect")
        .to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

#[tokio::test]
async fn a_player_without_a_team_gets_their_own_leaderboard() {
    let service = FakeGamesService::default();
    let (status, body) = send(&service, axum::http::Request::get("/leaderboards"), None).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["games"][0]["kind"], "snake");
    assert_eq!(body["games"][0]["scoring"], "high_score");
    assert_eq!(body["games"][0]["entries"][0]["userId"], USER_ID);
    let user = MacroUserIdStr::try_from(USER_ID.to_owned()).unwrap();
    assert_eq!(
        service.scopes.lock().unwrap().as_slice(),
        [LeaderboardScope::User(user)]
    );
}

#[tokio::test]
async fn scores_reach_the_service_with_their_game() {
    let service = FakeGamesService::default();
    let (status, body) = send(
        &service,
        axum::http::Request::post("/scores"),
        Some(serde_json::json!({ "kind": "twenty_forty_eight", "score": 2048 })),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["improved"], true);
    assert_eq!(
        service.scores.lock().unwrap().as_slice(),
        [(GameKind::TwentyFortyEight, 2048)]
    );
}

#[tokio::test]
async fn an_unknown_game_is_rejected_before_the_service() {
    let service = FakeGamesService::default();
    let (status, _) = send(
        &service,
        axum::http::Request::post("/scores"),
        Some(serde_json::json!({ "kind": "pinball", "score": 10 })),
    )
    .await;

    assert!(status.is_client_error(), "{status}");
    assert!(service.scores.lock().unwrap().is_empty());
}

#[tokio::test]
async fn rounds_require_access_to_the_room_before_the_service() {
    let service = FakeGamesService::default();
    let (status, _) = send(
        &service,
        axum::http::Request::post("/rounds"),
        Some(serde_json::json!({
            "entityType": "document",
            "entityId": "room-1",
            "kind": "connect_four",
            "round": 0,
            "winnerUserId": USER_ID,
            "playerUserIds": [USER_ID, "macro|opponent@macro.com"],
        })),
    )
    .await;

    assert_ne!(status, StatusCode::OK);
    assert!(service.rounds.lock().unwrap().is_empty());
}
