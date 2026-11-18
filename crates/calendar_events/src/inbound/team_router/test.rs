use std::sync::Mutex;

use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService, ValidatedCredential,
};
use model_user::UserContext;
use rootcause::Report;
use tower::ServiceExt;

use super::*;
use crate::domain::team_availability::{
    AvailabilityCoverage, AvailabilityInterval, TeamAvailability, TeamMemberAvailability,
};

const REQUESTER: &str = "macro|requester@example.com";
const VALID_JWT: &str = "valid";

#[derive(Clone)]
struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != VALID_JWT {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(UserContext {
            user_id: REQUESTER.to_string(),
            fusion_user_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
            permissions: None,
            organization_id: None,
        })
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        self.authorize(jwt).await.map(ValidatedCredential::session)
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

/// The requester, range and member selection of one availability read.
type AvailabilityRequest = (String, OccurrenceRange, Option<Vec<String>>);

#[derive(Default)]
struct FakeService {
    requests: Mutex<Vec<AvailabilityRequest>>,
    too_many: bool,
}

impl CalendarTeamService for FakeService {
    async fn list_team_calendar(
        &self,
        _: &str,
        _: OccurrenceRange,
        _: Option<TeamCalendarCursor>,
        _: u16,
    ) -> Result<TeamCalendarPage, rootcause::Report> {
        unreachable!("availability does not browse team content")
    }

    async fn team_sharing(&self, _: &str) -> Result<TeamCalendarSharing, rootcause::Report> {
        unreachable!("availability does not read sharing settings")
    }

    async fn set_team_sharing(
        &self,
        _: &str,
        _: TeamCalendarSharing,
    ) -> Result<TeamCalendarSharing, rootcause::Report> {
        unreachable!("availability does not change sharing settings")
    }

    async fn availability_calendars(
        &self,
        _: &str,
    ) -> Result<Vec<AvailabilityCalendar>, rootcause::Report> {
        unreachable!("availability does not list source calendars")
    }

    async fn set_availability_calendar(
        &self,
        _: &str,
        _: Uuid,
        _: bool,
    ) -> Result<(), rootcause::Report> {
        unreachable!("availability does not change source inclusion")
    }

    async fn get_team_availability(
        &self,
        requester: &str,
        range: OccurrenceRange,
        user_ids: Option<&[String]>,
    ) -> Result<TeamAvailability, rootcause::Report> {
        self.requests.lock().unwrap().push((
            requester.to_owned(),
            range.clone(),
            user_ids.map(<[String]>::to_vec),
        ));
        if self.too_many {
            return Err(rootcause::report!(TeamCalendarError::TooManyMembers).into());
        }
        Ok(TeamAvailability {
            start: range.starts_at,
            end: range.ends_at,
            members: vec![TeamMemberAvailability {
                user_id: REQUESTER.to_string(),
                busy: vec![AvailabilityInterval {
                    start: "2026-10-07T10:00:00Z".parse().unwrap(),
                    end: "2026-10-07T11:00:00Z".parse().unwrap(),
                }],
                coverage: AvailabilityCoverage::Complete,
                unknown_reasons: vec![],
            }],
            free_windows: None,
            unknown_user_ids: vec!["macro|unknown@example.com".to_string()],
            complete: false,
            summary: "Coverage is incomplete".to_string(),
        })
    }
}

async fn post_availability(
    service: Arc<FakeService>,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let router: Router = team_calendar_router(CalendarTeamRouterState::new(
        service,
        MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
    ));
    let response = router
        .oneshot(
            Request::post("/calendar-events/team/availability")
                .header(
                    axum::http::header::AUTHORIZATION,
                    format!("Bearer {VALID_JWT}"),
                )
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
async fn availability_reads_the_selected_teammates_for_the_requester() {
    let service = Arc::new(FakeService::default());

    let (status, body) = post_availability(
        service.clone(),
        serde_json::json!({
            "start": "2026-10-07T09:00:00Z",
            "end": "2026-10-07T17:00:00Z",
            "userIds": ["macro|unknown@example.com"],
        }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        serde_json::json!({
            "start": "2026-10-07T09:00:00Z",
            "end": "2026-10-07T17:00:00Z",
            "members": [{
                "userId": REQUESTER,
                "busy": [{"start": "2026-10-07T10:00:00Z", "end": "2026-10-07T11:00:00Z"}],
                "coverage": "complete",
                "unknownReasons": [],
            }],
            "unknownUserIds": ["macro|unknown@example.com"],
            "complete": false,
            "summary": "Coverage is incomplete",
        })
    );
    let requests = service.requests.lock().unwrap();
    assert_eq!(
        *requests,
        vec![(
            REQUESTER.to_string(),
            OccurrenceRange {
                starts_at: "2026-10-07T09:00:00Z".parse().unwrap(),
                ends_at: "2026-10-07T17:00:00Z".parse().unwrap(),
                start_date: "2026-10-07".parse().unwrap(),
                end_date: "2026-10-08".parse().unwrap(),
            },
            Some(vec!["macro|unknown@example.com".to_string()]),
        )]
    );
}

#[tokio::test]
async fn availability_without_user_ids_selects_the_whole_team() {
    let service = Arc::new(FakeService::default());

    let (status, _) = post_availability(
        service.clone(),
        serde_json::json!({
            "start": "2026-10-07T00:00:00Z",
            "end": "2026-10-08T00:00:00Z",
        }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let requests = service.requests.lock().unwrap();
    assert_eq!(requests[0].1.end_date, "2026-10-08".parse().unwrap());
    assert_eq!(requests[0].2, None);
}

#[tokio::test]
async fn availability_for_too_many_teammates_is_a_bad_request() {
    let service = Arc::new(FakeService {
        too_many: true,
        ..Default::default()
    });

    let (status, _) = post_availability(
        service,
        serde_json::json!({
            "start": "2026-10-07T09:00:00Z",
            "end": "2026-10-07T17:00:00Z",
            "userIds": [],
        }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}
