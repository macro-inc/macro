//! Actual review -> edited tool execution -> PostgreSQL -> public booking HTTP API.
use super::*;
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
async fn review(
    context: Context,
    tool: &str,
    args: Value,
    outcome: ReviewOutcome,
) -> FinishedUserTool {
    let tools = Arc::new(booking_link_toolset());
    let deferred = tools
        .try_tool_call(context.clone(), RequestContext::new(owner()), tool, &args)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(deferred, json!("PendingUserExecution"));
    let reviewer = Arc::new(Scripted {
        asked: Mutex::new(vec![]),
        answer: Ok(outcome),
    });
    user_tool_finisher(tools, context, owner(), reviewer, CancellationToken::new())(
        PendingUserTool {
            tool_name: tool.into(),
            tool_call_id: "booking-link-call".into(),
            args,
        },
    )
    .await
    .unwrap()
}
fn accept(args: Value) -> ReviewOutcome {
    ReviewOutcome::Accepted(BTreeMap::from([(
        DRAFT_FIELD.into(),
        Value::String(args.to_string()),
    )]))
}
fn saved(result: FinishedUserTool) -> Value {
    let FinishedUserTool::Result(value) = result else {
        panic!("expected saved link: {result:?}")
    };
    value["UserAction"].clone()
}

#[sqlx::test(migrations = false)]
async fn edited_review_is_saved_and_bookable_without_touching_other_links(pool: sqlx::PgPool) {
    sqlx::raw_sql("CREATE TABLE \"User\" (id text PRIMARY KEY); CREATE TABLE team (id uuid PRIMARY KEY); INSERT INTO \"User\" VALUES ('macro|owner@macro.com');").execute(&pool).await.unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20260918164303_calendar_scheduling.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20260918175703_scheduling_recovery.sql"
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
    for outcome in [ReviewOutcome::Declined, ReviewOutcome::Cancelled] {
        review(context.clone(), "CreateBookingLink", args(), outcome).await;
        assert!(
            service
                .settings(owner().as_ref(), None)
                .await
                .unwrap()
                .event_types
                .is_empty()
        );
    }
    let mut invalid = args();
    invalid["draft"]["event"]["durationMinutes"] = json!(0);
    assert!(matches!(
        review(
            context.clone(),
            "CreateBookingLink",
            args(),
            accept(invalid)
        )
        .await,
        FinishedUserTool::Error(_)
    ));
    assert!(
        service
            .settings(owner().as_ref(), None)
            .await
            .unwrap()
            .event_types
            .is_empty()
    );
    let mut edited = args();
    edited["draft"]["event"]["title"] = json!("Reviewed title");
    let first = saved(
        review(
            context.clone(),
            "CreateBookingLink",
            args(),
            accept(edited.clone()),
        )
        .await,
    );
    assert_eq!(first["draft"]["event"]["title"], "Reviewed title");
    let retry = saved(
        review(
            context.clone(),
            "CreateBookingLink",
            edited.clone(),
            accept(edited.clone()),
        )
        .await,
    );
    assert_eq!(first, retry);
    let mut other = args();
    other["draft"]["event"]["slug"] = json!("other");
    let second = saved(
        review(
            context.clone(),
            "CreateBookingLink",
            other.clone(),
            accept(other),
        )
        .await,
    );
    let before = service.settings(owner().as_ref(), None).await.unwrap();
    let edit = json!({"teamId":null, "eventTypeId":first["eventTypeId"], "expectedRevision":second["revision"], "draft":edited["draft"]});
    let mut accepted = edit.clone();
    accepted["draft"]["event"]["durationMinutes"] = json!(45);
    let updated = saved(
        review(
            context.clone(),
            "EditBookingLink",
            edit.clone(),
            accept(accepted),
        )
        .await,
    );
    assert_eq!(updated["eventTypeId"], first["eventTypeId"]);
    let after = service.settings(owner().as_ref(), None).await.unwrap();
    assert_eq!(before.event_types[1], after.event_types[1]);
    assert!(matches!(
        review(
            context.clone(),
            "EditBookingLink",
            edit.clone(),
            accept(edit)
        )
        .await,
        FinishedUserTool::Error(_)
    ));
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
