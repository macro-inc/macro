//! HTTP + real PostgreSQL contract checks; only identity and external calendar are controlled.
use super::*;
use crate::outbound::postgres::PostgresRepository;
use chrono::{DateTime, Duration, Utc};
use macro_authorization::{InternalIdentityClaims, MacroAuthorizationError};
use model_user::UserContext;
use rootcause::Report;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone)]
struct Identity;
impl MacroAuthorizationService for Identity {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if !matches!(jwt, "host" | "member" | "stranger") {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(UserContext {
            user_id: format!("macro|{jwt}@example.test"),
            fusion_user_id: jwt.into(),
            ..Default::default()
        })
    }
    async fn authorize_internal(
        &self,
        _: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}
struct People;
impl Directory for People {
    async fn members(&self, _: Uuid) -> Result<Vec<TeamMember>, Error> {
        Ok(vec![
            TeamMember {
                user_id: "macro|host@example.test".into(),
                admin: true,
            },
            TeamMember {
                user_id: "macro|member@example.test".into(),
                admin: false,
            },
        ])
    }
}
struct Calendar(AtomicBool);
impl Calendars for Calendar {
    async fn creation_calendar(&self, _: &str) -> Result<Uuid, Error> {
        Ok(Uuid::nil())
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
    async fn create(&self, r: &BookingRecord, _: &EventType) -> Result<(Uuid, String), Error> {
        if self.0.swap(false, Ordering::SeqCst) {
            return Err(Error::CalendarUnavailable);
        }
        Ok((r.booking.id, "Test location".into()))
    }
    async fn cancel(&self, _: &BookingRecord) -> Result<(), Error> {
        Ok(())
    }
    async fn reschedule(&self, _: &BookingRecord) -> Result<(), Error> {
        Ok(())
    }
}

#[sqlx::test(migrations = false)]
async fn http_booking_receipt_recovery_reschedule_cancel_and_team_auth(pool: sqlx::PgPool) {
    sqlx::raw_sql("CREATE TABLE \"User\" (id text PRIMARY KEY); CREATE TABLE team (id uuid PRIMARY KEY); INSERT INTO \"User\" VALUES ('macro|host@example.test');").execute(&pool).await.unwrap();
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
        PostgresRepository::new(pool.clone()),
        Calendar(AtomicBool::new(true)),
        People,
    ));
    let app: Router = router(RouterState::new(
        service.clone(),
        MacroAuthorizationState::new(Arc::new(Identity)),
    ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = reqwest::Client::new();
    assert_eq!(
        client
            .get(format!("{base}/settings"))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    let response: serde_json::Value = client
        .get(format!("{base}/settings"))
        .bearer_auth("host")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let id: Uuid = serde_json::from_value(response["profile"]["id"].clone()).unwrap();
    let schedule = Uuid::now_v7();
    let event = Uuid::now_v7();
    let profile = serde_json::json!({
        "id":id,"name":"Integration host","description":"","revision":0,"defaultScheduleId":schedule,
        "schedules":[{"id":schedule,"name":"Work","timeZone":"UTC","overrides":[],"weekly":(0..7).map(|day| serde_json::json!({"day":day,"windows":[{"start":"09:00","end":"17:00"}]})).collect::<Vec<_>>() }],
        "eventTypes":[{"id":event,"title":"Integration meeting","slug":"meeting","description":"","durationMinutes":30,"location":"","googleMeet":false,"enabled":true,"scheduleId":schedule,"mode":"individual","hosts":["macro|host@example.test"],"beforeMinutes":0,"afterMinutes":0,"noticeMinutes":0,"horizonDays":30,"intervalMinutes":30,"dailyLimit":null,"requiresConfirmation":false,"questions":[]}]
    });
    let saved = client
        .put(format!("{base}/settings"))
        .bearer_auth("host")
        .json(&profile)
        .send()
        .await
        .unwrap();
    assert_eq!(saved.status(), 200);
    assert_eq!(
        client
            .put(format!("{base}/settings"))
            .bearer_auth("stranger")
            .json(&profile)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let day = (Utc::now() + Duration::days(2)).date_naive();
    let slots: serde_json::Value = client
        .get(format!(
            "{base}/public/{id}/{event}/slots?date={day}&time_zone=UTC"
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let start = slots["slots"][0]["startsAt"].as_str().unwrap();
    let request = serde_json::json!({"startsAt":start,"name":"Test Guest","email":"guest@example.test","timeZone":"UTC","answers":{},"requestId":Uuid::now_v7()});
    let booked = client
        .post(format!("{base}/public/{id}/{event}/book"))
        .json(&request)
        .send()
        .await
        .unwrap();
    assert_eq!(
        booked.status(),
        200,
        "durable reservations return their receipt even on provider failure"
    );
    assert_eq!(booked.headers()["cache-control"], "private, no-store");
    let receipt: serde_json::Value = booked.json().await.unwrap();
    assert_eq!(receipt["booking"]["status"], "failed");
    let booking = Uuid::parse_str(receipt["booking"]["id"].as_str().unwrap()).unwrap();
    let token = receipt["token"].as_str().unwrap();
    assert_eq!(
        client
            .get(format!("{base}/public/bookings/{booking}"))
            .bearer_auth(Uuid::new_v4())
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    let retry: serde_json::Value = client
        .post(format!("{base}/public/{id}/{event}/book"))
        .json(&request)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(retry["booking"]["id"], receipt["booking"]["id"]);
    sqlx::query!(
        "UPDATE scheduling_booking SET recovery_at = now() - interval '1 second' WHERE id = $1",
        booking
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(service.recover_once().await.unwrap());
    let confirmed: serde_json::Value = client
        .get(format!("{base}/public/bookings/{booking}"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(confirmed["booking"]["status"], "confirmed");
    let next = slots["slots"][2]["startsAt"].as_str().unwrap();
    let moved: serde_json::Value = client
        .post(format!("{base}/public/bookings/{booking}/reschedule"))
        .json(&serde_json::json!({"token":token,"startsAt":next}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(moved["booking"]["rescheduleCount"], 1);
    let cancelled: serde_json::Value = client
        .post(format!("{base}/public/bookings/{booking}/cancel"))
        .json(&serde_json::json!({"token":token}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(cancelled["booking"]["status"], "cancelled");
    let team = Uuid::now_v7();
    assert_eq!(
        client
            .get(format!("{base}/settings?teamId={team}"))
            .bearer_auth("stranger")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .get(format!("{base}/settings?teamId={team}"))
            .bearer_auth("member")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    task.abort();
}
