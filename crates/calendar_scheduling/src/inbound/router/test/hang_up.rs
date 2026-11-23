//! A visitor whose connection drops while the host's calendar is being written.
use super::*;
use std::sync::Mutex;
use tokio::io::AsyncWriteExt;
use tokio::sync::{Notify, oneshot};

/// The host's calendar, holding its first create until the test releases it.
struct Held {
    entered: Mutex<Option<oneshot::Sender<()>>>,
    release: Mutex<Option<oneshot::Receiver<()>>>,
}
impl Calendars for Held {
    async fn creation_calendar(&self, _: &str, _: Option<Uuid>) -> Result<Uuid, Error> {
        Ok(Uuid::nil())
    }
    async fn busy(
        &self,
        _: &[String],
        _: DateTime<Utc>,
        _: DateTime<Utc>,
        _: Option<Uuid>,
        _: Option<Uuid>,
    ) -> Result<Vec<BusyRange>, Error> {
        Ok(vec![])
    }
    async fn create(&self, r: &BookingRecord, _: &EventType) -> Result<(Uuid, String), Error> {
        if let Some(entered) = self.entered.lock().unwrap().take() {
            entered.send(()).unwrap();
        }
        let release = self.release.lock().unwrap().take();
        if let Some(release) = release {
            release.await.unwrap();
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
impl BookingAccounts for Held {
    async fn booking_accounts(
        &self,
        _: &str,
    ) -> Result<Vec<crate::domain::booking_link_models::BookingAccount>, Error> {
        Ok(vec![])
    }
}

/// PostgreSQL storage that says when a booking's outcome is saved.
struct Saving {
    inner: PostgresRepository,
    saved: Arc<Notify>,
}
impl Repository for Saving {
    async fn consume_budget(&self, profile: Uuid, budget: PublicBudget) -> Result<(), Error> {
        self.inner.consume_budget(profile, budget).await
    }
    async fn claim_recovery(&self) -> Result<Option<BookingRecord>, Error> {
        self.inner.claim_recovery().await
    }
    async fn profile(&self, id: Uuid) -> Result<Option<OwnedProfile>, Error> {
        self.inner.profile(id).await
    }
    async fn save_profile(&self, profile: OwnedProfile) -> Result<Profile, Error> {
        self.inner.save_profile(profile).await
    }
    async fn bookings(
        &self,
        profile: Uuid,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<BookingRecord>, Error> {
        self.inner.bookings(profile, start, end).await
    }
    async fn host_booking_counts(
        &self,
        profile: Uuid,
        hosts: &[String],
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<std::collections::BTreeMap<String, i64>, Error> {
        self.inner
            .host_booking_counts(profile, hosts, start, end)
            .await
    }
    async fn busy(
        &self,
        hosts: &[String],
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        exclude: Option<Uuid>,
    ) -> Result<Vec<BusyRange>, Error> {
        self.inner.busy(hosts, start, end, exclude).await
    }
    async fn daily_bookings(
        &self,
        profile: Uuid,
        event_type: Uuid,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        exclude: Option<Uuid>,
    ) -> Result<i64, Error> {
        self.inner
            .daily_bookings(profile, event_type, start, end, exclude)
            .await
    }
    async fn reserve(
        &self,
        record: BookingRecord,
        limit: Option<u16>,
        day_start: DateTime<Utc>,
        day_end: DateTime<Utc>,
    ) -> Result<BookingRecord, Error> {
        self.inner.reserve(record, limit, day_start, day_end).await
    }
    async fn booking(&self, id: Uuid) -> Result<Option<BookingRecord>, Error> {
        self.inner.booking(id).await
    }
    async fn booking_request(&self, request: Uuid) -> Result<Option<BookingRecord>, Error> {
        self.inner.booking_request(request).await
    }
    async fn move_booking(
        &self,
        record: BookingRecord,
        expected: BookingStatus,
        day_start: DateTime<Utc>,
        day_end: DateTime<Utc>,
    ) -> Result<BookingRecord, Error> {
        self.inner
            .move_booking(record, expected, day_start, day_end)
            .await
    }
    async fn update_booking(
        &self,
        record: BookingRecord,
        expected: BookingStatus,
    ) -> Result<BookingRecord, Error> {
        let saved = self.inner.update_booking(record, expected).await;
        self.saved.notify_one();
        saved
    }
}

type HangUp = Arc<Mutex<Option<oneshot::Sender<()>>>>;
/// Fires when the server drops a request before answering it.
struct Unanswered(Option<oneshot::Sender<()>>);
impl Drop for Unanswered {
    fn drop(&mut self) {
        if let Some(hung_up) = self.0.take() {
            let _ = hung_up.send(());
        }
    }
}
async fn watch_hang_up(
    State(hang_up): State<HangUp>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    if !request.uri().path().ends_with("/book") {
        return next.run(request).await;
    }
    let mut unanswered = Unanswered(hang_up.lock().unwrap().take());
    let response = next.run(request).await;
    unanswered.0 = None;
    response
}

#[sqlx::test(migrations = false)]
async fn a_visitor_who_hangs_up_mid_booking_is_booked_without_recovery(pool: sqlx::PgPool) {
    scheduling_schema(&pool).await;
    let (entered, calendar_entered) = oneshot::channel();
    let (release_calendar, release) = oneshot::channel();
    let (hang_up, hung_up) = oneshot::channel();
    let saved = Arc::new(Notify::new());
    let service = Arc::new(Service::new(
        Saving {
            inner: PostgresRepository::new(pool.clone()),
            saved: saved.clone(),
        },
        Held {
            entered: Mutex::new(Some(entered)),
            release: Mutex::new(Some(release)),
        },
        People,
    ));
    let app: Router = router(RouterState::new(
        service,
        MacroAuthorizationState::new(Arc::new(Identity)),
    ))
    .layer(axum::middleware::from_fn_with_state(
        HangUp::new(Mutex::new(Some(hang_up))),
        watch_hang_up,
    ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let base = format!("http://{address}");
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = reqwest::Client::new();
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
    let saved_profile = client
        .put(format!("{base}/settings"))
        .bearer_auth("host")
        .json(&profile)
        .send()
        .await
        .unwrap();
    assert_eq!(saved_profile.status(), 200);
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
    let body = request.to_string();
    let mut visitor = tokio::net::TcpStream::connect(address).await.unwrap();
    visitor
        .write_all(
            format!(
                "POST /public/{id}/{event}/book HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    calendar_entered.await.unwrap();
    drop(visitor);
    tokio::time::timeout(std::time::Duration::from_secs(10), hung_up)
        .await
        .expect("the server drops a request whose visitor hung up")
        .unwrap();
    release_calendar
        .send(())
        .expect("the calendar write outlives the request that started it");
    tokio::time::timeout(std::time::Duration::from_secs(10), saved.notified())
        .await
        .expect("the booking's outcome is saved without waiting for recovery");
    // The visitor's page retries the same request once it is back online.
    let retry: serde_json::Value = client
        .post(format!("{base}/public/{id}/{event}/book"))
        .json(&request)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(retry["booking"]["status"], "confirmed");
    assert_eq!(retry["booking"]["location"], "Test location");
    server.abort();
}
