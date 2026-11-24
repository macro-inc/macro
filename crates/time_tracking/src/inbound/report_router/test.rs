use std::sync::Mutex;

use axum::{
    body::Body,
    http::{Request, header},
};
use entity_access::domain::models::AccessLevel;
use http_body_util::BodyExt;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;
use tower::ServiceExt;

use super::*;
use crate::test_support::{BearerIsUser, FakeAccess, VIEWER};

const PROJECT: &str = "01a1fa5b-0000-7000-8000-000000000001";

/// What one report request reached the domain with.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Asked {
    user: String,
    scope: &'static str,
    project: Option<String>,
    from: NaiveDate,
    to: NaiveDate,
    breakdown: Option<TimeBreakdown>,
}

/// Records each request and answers an empty report.
#[derive(Default)]
struct RecordingReports(Mutex<Vec<Asked>>);

impl RecordingReports {
    fn asked(&self) -> Vec<Asked> {
        self.0.lock().unwrap().clone()
    }

    fn record(
        &self,
        user: &MacroUserIdStr<'static>,
        scope: &TimeScope,
        period: TimePeriod,
        breakdown: Option<TimeBreakdown>,
    ) {
        let project = match scope {
            TimeScope::Project(receipt) => {
                assert_eq!(receipt.entity().entity_type, EntityType::Initiative);
                Some(receipt.entity().entity_id.clone())
            }
            TimeScope::Mine | TimeScope::Team => None,
        };
        self.0.lock().unwrap().push(Asked {
            user: user.as_ref().to_string(),
            scope: scope.name(),
            project,
            from: period.from(),
            to: period.to(),
            breakdown,
        });
    }
}

impl TimeReportService for RecordingReports {
    async fn summary(
        &self,
        user_id: &MacroUserIdStr<'static>,
        scope: TimeScope,
        period: TimePeriod,
        breakdown: TimeBreakdown,
    ) -> Result<TimeSummary, TimeTrackingError> {
        self.record(user_id, &scope, period, Some(breakdown));
        Ok(TimeSummary {
            from: period.from(),
            to: period.to(),
            total_minutes: 0,
            task_count: 0,
            scope_task_count: None,
            complete: true,
            groups: Vec::new(),
            then_totals: Vec::new(),
        })
    }

    async fn export(
        &self,
        user_id: &MacroUserIdStr<'static>,
        scope: TimeScope,
        period: TimePeriod,
    ) -> Result<TimeExport, TimeTrackingError> {
        self.record(user_id, &scope, period, None);
        Ok(TimeExport {
            csv: "Date\n".to_string(),
            rows: 0,
            complete: true,
        })
    }
}

fn app(reports: Arc<RecordingReports>, access: FakeAccess) -> Router {
    time_report_router(TimeReportRouterState::new(
        reports,
        Arc::new(access),
        MacroAuthorizationState::new(Arc::new(BearerIsUser)),
    ))
}

async fn get_json(router: &Router, user_id: &str, path: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .uri(path)
        .header(header::AUTHORIZATION, format!("Bearer {user_id}"))
        .body(Body::empty())
        .unwrap();
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

fn day(date: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 11, date).unwrap()
}

#[tokio::test]
async fn a_team_summary_reaches_the_domain_with_its_period_and_grouping() {
    let reports = Arc::new(RecordingReports::default());
    let router = app(reports.clone(), FakeAccess::default());

    let (status, body) = get_json(
        &router,
        VIEWER,
        "/summary?scope=team&from=2026-11-23&to=2026-11-29&groupBy=person&thenBy=day",
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["from"], "2026-11-23");
    assert_eq!(body["thenTotals"], Value::Array(Vec::new()));
    assert_eq!(
        reports.asked(),
        [Asked {
            user: VIEWER.to_string(),
            scope: "team",
            project: None,
            from: day(23),
            to: day(29),
            breakdown: Some(
                TimeBreakdown::new(TimeGrouping::Person, Some(TimeGrouping::Day)).unwrap()
            ),
        }]
    );
}

#[tokio::test]
async fn a_project_summary_needs_view_access_to_the_project() {
    let reports = Arc::new(RecordingReports::default());
    let router = app(
        reports.clone(),
        FakeAccess::default().grant(VIEWER, PROJECT, AccessLevel::View),
    );

    let path = format!(
        "/summary?scope=project&projectId={PROJECT}&from=2026-11-01&to=2026-11-30&groupBy=task"
    );
    let (allowed, _) = get_json(&router, VIEWER, &path).await;
    let (refused, refusal) = get_json(&router, "macro|outsider@example.com", &path).await;

    assert_eq!(allowed, StatusCode::OK);
    assert_eq!(refused, StatusCode::NOT_FOUND);
    assert_eq!(refusal["code"], "not_found");
    assert_eq!(refusal["message"], "project not found");
    assert_eq!(reports.asked().len(), 1);
    assert_eq!(reports.asked()[0].project.as_deref(), Some(PROJECT));
}

#[tokio::test]
async fn reports_refuse_requests_outside_their_bounds() {
    let reports = Arc::new(RecordingReports::default());
    let router = app(reports.clone(), FakeAccess::default());

    for path in [
        "/summary?scope=project&from=2026-11-01&to=2026-11-30&groupBy=task".to_string(),
        format!(
            "/summary?scope=mine&projectId={PROJECT}&from=2026-11-01&to=2026-11-30&groupBy=task"
        ),
        "/summary?scope=mine&from=2026-01-01&to=2027-01-02&groupBy=day".to_string(),
        "/summary?scope=mine&from=2026-11-30&to=2026-11-01&groupBy=day".to_string(),
        "/summary?scope=mine&from=2026-11-01&to=2026-11-30&groupBy=day&thenBy=day".to_string(),
        "/export?scope=team&from=2025-01-01&to=2026-11-30".to_string(),
    ] {
        let (status, body) = get_json(&router, VIEWER, &path).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}");
        assert_eq!(body["code"], "invalid_input", "{path}");
    }
    assert!(reports.asked().is_empty());
}

#[tokio::test]
async fn an_export_answers_the_csv_as_json() {
    let reports = Arc::new(RecordingReports::default());
    let router = app(reports.clone(), FakeAccess::default());

    let (status, body) = get_json(
        &router,
        VIEWER,
        "/export?scope=mine&from=2026-11-01&to=2026-11-30",
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["csv"], "Date\n");
    assert_eq!(body["rows"], 0);
    assert_eq!(body["complete"], true);
    assert_eq!(reports.asked()[0].scope, "mine");
}
