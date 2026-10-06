//! Confirmed tool execution -> PostgreSQL -> public booking HTTP API.
use ai_toolset::RequestContext;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::{Value, json};
use std::sync::Arc;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@macro.com").unwrap()
}
use ai_toolset::ToolSet;
use calendar_scheduling::{
    domain::{models::*, ports::*, service::Service},
    inbound::{
        router::{RouterState, router},
        toolset::{BookingLinkToolContext, booking_link_toolset},
    },
    outbound::postgres::PostgresRepository,
};
use chrono::{DateTime, Duration, Utc};
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState,
};
use model_user::UserContext;
use rootcause::Report;
use uuid::Uuid;

#[derive(Clone)]
struct NoAuth;
impl MacroAuthorizationService for NoAuth {
    async fn authorize(&self, _: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
    async fn authorize_internal(
        &self,
        _: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}
struct Members;
impl Directory for Members {
    async fn user_teams(&self, _: &str) -> Result<Vec<Uuid>, Error> {
        Ok(vec![])
    }
    async fn members(&self, _: Uuid) -> Result<Vec<TeamMember>, Error> {
        Ok(vec![])
    }
}
struct FakeCalendar;
impl Calendars for FakeCalendar {
    async fn creation_calendar(&self, _: &str) -> Result<Uuid, Error> {
        Ok(Uuid::now_v7())
    }
    async fn busy(
        &self,
        _: &[String],
        _: DateTime<Utc>,
        _: DateTime<Utc>,
        _: Option<Uuid>,
    ) -> Result<Vec<BusyRange>, Error> {
        Ok(vec![])
    }
    async fn create(&self, record: &BookingRecord, _: &EventType) -> Result<(Uuid, String), Error> {
        Ok((record.booking.id, "Test room".into()))
    }
    async fn cancel(&self, _: &BookingRecord) -> Result<(), Error> {
        Ok(())
    }
    async fn reschedule(&self, _: &BookingRecord) -> Result<(), Error> {
        Ok(())
    }
}
type Context = BookingLinkToolContext<Service<PostgresRepository, FakeCalendar, Members>>;

fn args() -> Value {
    json!({"teamId": null, "draft": {
        "event": {"title":"Original", "slug":"intro", "description":"", "durationMinutes":30, "location":"Test room", "googleMeet":false, "enabled":true, "mode":"individual", "hosts":[owner().as_ref()], "beforeMinutes":0, "afterMinutes":0, "noticeMinutes":0, "horizonDays":30, "intervalMinutes":30, "dailyLimit":null, "requiresConfirmation":false, "questions":[]},
        "schedule":{"name":"Working hours", "timeZone":"UTC", "weekly":(0..7).map(|day| json!({"day":day, "windows":[{"start":"09:00", "end":"17:00"}]})).collect::<Vec<_>>(), "overrides":[]}
    }})
}
async fn execute(context: Context, tool: &str, args: Value) -> Result<Value, String> {
    booking_link_toolset()
        .try_tool_call(context, RequestContext::new(owner()), tool, &args)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[sqlx::test(migrations = false)]
async fn confirmed_booking_is_saved_and_bookable_without_touching_other_links(pool: sqlx::PgPool) {
    sqlx::raw_sql("CREATE TABLE \"User\" (id text PRIMARY KEY); CREATE TABLE team (id uuid PRIMARY KEY); INSERT INTO \"User\" VALUES ('macro|owner@macro.com');").execute(&pool).await.unwrap();
    sqlx::raw_sql(include_str!(
        "../../../macro_db_client/migrations/20260918164303_calendar_scheduling.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../macro_db_client/migrations/20260918175703_scheduling_recovery.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    let service = Arc::new(Service::new(
        PostgresRepository::new(pool),
        FakeCalendar,
        Members,
    ));
    let context = Context {
        service: service.clone(),
        public_origin: "https://booking.example.test".into(),
    };
    for confirmation in [None, Some(" ")] {
        let mut unconfirmed = args();
        if let Some(quote) = confirmation {
            unconfirmed["userConfirmation"] = json!(quote);
        }
        assert!(
            execute(context.clone(), "CreateBookingLink", unconfirmed)
                .await
                .is_err()
        );
        assert!(
            service
                .settings(owner().as_ref(), None)
                .await
                .unwrap()
                .event_types
                .is_empty()
        );
    }
    let mut edited = args();
    edited["userConfirmation"] = json!("Yes, create that booking link.");
    edited["draft"]["event"]["title"] = json!("Reviewed title");
    let mut invalid = edited.clone();
    invalid["draft"]["event"]["durationMinutes"] = json!(0);
    assert!(
        execute(context.clone(), "CreateBookingLink", invalid)
            .await
            .is_err()
    );
    assert!(
        service
            .settings(owner().as_ref(), None)
            .await
            .unwrap()
            .event_types
            .is_empty()
    );
    let first = execute(context.clone(), "CreateBookingLink", edited.clone())
        .await
        .unwrap();
    assert_eq!(first["draft"]["event"]["title"], "Reviewed title");
    let retry = execute(context.clone(), "CreateBookingLink", edited.clone())
        .await
        .unwrap();
    assert_eq!(first, retry);
    let mut other = edited.clone();
    other["draft"]["event"]["slug"] = json!("other");
    let second = execute(context.clone(), "CreateBookingLink", other)
        .await
        .unwrap();
    let before = service.settings(owner().as_ref(), None).await.unwrap();
    let edit = json!({"teamId":null, "eventTypeId":first["eventTypeId"], "expectedRevision":second["revision"], "draft":edited["draft"], "userConfirmation":"Yes, change the duration to 45 minutes."});
    let mut accepted = edit.clone();
    accepted["draft"]["event"]["durationMinutes"] = json!(45);
    let updated = execute(context.clone(), "EditBookingLink", accepted)
        .await
        .unwrap();
    assert_eq!(updated["eventTypeId"], first["eventTypeId"]);
    let after = service.settings(owner().as_ref(), None).await.unwrap();
    assert_eq!(before.event_types[1], after.event_types[1]);
    assert!(
        execute(context.clone(), "EditBookingLink", edit)
            .await
            .is_err()
    );
    let app: axum::Router = router(RouterState::new(
        service.clone(),
        MacroAuthorizationState::new(Arc::new(NoAuth)),
    ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = reqwest::Client::new();
    let profile_id = first["profileId"].as_str().unwrap();
    let event_id = first["eventTypeId"].as_str().unwrap();
    assert_eq!(
        first["url"],
        format!("https://booking.example.test/app/book/{profile_id}/intro")
    );
    let public: Value = client
        .get(format!("{base}/public/{profile_id}"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(public["profile"]["eventTypes"].as_array().unwrap().len(), 2);
    let date = Utc::now().date_naive() + Duration::days(2);
    let slots: Value = client
        .get(format!(
            "{base}/public/{profile_id}/{event_id}/slots?date={date}&time_zone=UTC"
        ))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let start = &slots["slots"][0]["startsAt"];
    assert!(start.is_string(), "{slots}");
    let booking: Value = client.post(format!("{base}/public/{profile_id}/{event_id}/book")).json(&json!({"startsAt":start, "name":"QA guest", "email":"guest@example.test", "timeZone":"UTC", "answers":{}, "requestId":Uuid::now_v7()})).send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    assert_eq!(booking["booking"]["title"], "Reviewed title");
    assert_eq!(booking["booking"]["status"], "confirmed");
    task.abort();
}
