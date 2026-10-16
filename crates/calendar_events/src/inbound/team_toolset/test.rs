use super::*;
use std::sync::Mutex;

use ai_toolset::{ToolSet, schema::generate_validated_input_schema};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use uuid::Uuid;

use crate::domain::team::{
    AvailabilityCalendar, TeamCalendarCursor, TeamCalendarPage, TeamCalendarSharing,
};

#[derive(Default)]
struct FakeService {
    requests: Mutex<Vec<(String, OccurrenceRange, Option<Vec<String>>)>>,
    fail: bool,
}

impl CalendarTeamService for FakeService {
    async fn list_team_calendar(
        &self,
        _: &str,
        _: OccurrenceRange,
        _: Option<TeamCalendarCursor>,
        _: u16,
    ) -> Result<TeamCalendarPage, Report> {
        unreachable!("availability tool does not browse team content")
    }

    async fn team_sharing(&self, _: &str) -> Result<TeamCalendarSharing, Report> {
        unreachable!("availability policy belongs in the domain")
    }

    async fn set_team_sharing(
        &self,
        _: &str,
        _: TeamCalendarSharing,
    ) -> Result<TeamCalendarSharing, Report> {
        unreachable!("availability tool cannot change permissions")
    }

    async fn availability_calendars(&self, _: &str) -> Result<Vec<AvailabilityCalendar>, Report> {
        unreachable!("availability policy belongs in the domain")
    }

    async fn set_availability_calendar(&self, _: &str, _: Uuid, _: bool) -> Result<(), Report> {
        unreachable!("availability tool cannot change source inclusion")
    }

    async fn get_team_availability(
        &self,
        requester: &str,
        range: OccurrenceRange,
        user_ids: Option<&[String]>,
    ) -> Result<TeamAvailability, Report> {
        self.requests.lock().unwrap().push((
            requester.to_owned(),
            range.clone(),
            user_ids.map(<[String]>::to_vec),
        ));
        if self.fail {
            return Err(rootcause::report!(TeamCalendarError::Disabled).into());
        }
        Ok(TeamAvailability {
            start: range.starts_at,
            end: range.ends_at,
            members: vec![],
            free_windows: None,
            unknown_user_ids: vec!["unknown-person".into()],
            complete: false,
            summary: "Coverage is incomplete".into(),
        })
    }
}

fn request() -> RequestContext {
    RequestContext::new(
        MacroUserIdStr::try_from("macro|requester@example.com".to_string()).unwrap(),
    )
}

fn tool() -> GetTeamAvailability {
    GetTeamAvailability {
        start: "2026-10-07T09:00:00Z".parse().unwrap(),
        end: "2026-10-07T17:00:00Z".parse().unwrap(),
        user_ids: Some(vec!["unknown-person".into()]),
    }
}

#[test]
fn input_schema_is_strict_and_tool_is_registered() {
    let schema = generate_validated_input_schema::<GetTeamAvailability>().unwrap();
    assert_eq!(schema.name, "GetTeamAvailability");
    let set = team_calendar_toolset::<FakeService>();
    let schemas = set.request_schemas().unwrap();
    assert_eq!(schemas.len(), 1);
    assert_eq!(schemas[0].name, "GetTeamAvailability");
}

#[tokio::test]
async fn delegates_identity_and_selection_without_inventing_free_windows() {
    let service = Arc::new(FakeService::default());
    let context = ServiceContext(TeamCalendarToolContext {
        service: service.clone(),
    });
    let result = tool().call(context, request()).await.unwrap();
    assert!(!result.complete);
    assert!(result.free_windows.is_none());
    assert_eq!(result.unknown_user_ids, vec!["unknown-person"]);
    let requests = service.requests.lock().unwrap();
    assert_eq!(requests[0].0, "macro|requester@example.com");
    assert_eq!(requests[0].2, Some(vec!["unknown-person".to_string()]));
}

#[tokio::test]
async fn service_denial_remains_an_error() {
    let context = ServiceContext(TeamCalendarToolContext {
        service: Arc::new(FakeService {
            fail: true,
            ..Default::default()
        }),
    });
    let error = tool().call(context, request()).await.unwrap_err();
    assert!(error.description.contains("not enabled"));
}
