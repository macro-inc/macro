use super::*;
use calendar_events::{
    domain::{mutations::CalendarMutationServiceImpl, service::CalendarService},
    outbound::pg::PgCalendarRepository,
};
use chrono::{Days, Duration};
use chrono_tz::America::Los_Angeles;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::NoopMacroEventBroker;
use sqlx::PgPool;
use std::sync::{Arc, Mutex};
use wiremock::{Request, Respond, matchers::path_regex};

const OWNER: &str = "macro|olivia@example.com";
const INBOX: &str = "olivia@example.com";
const TOKEN: &str = "graph-access-token";
const EVENTS: &str = r"^/v1\.0/me/(calendars/[^/]+/)?events(/|$)";

struct IssuedToken;

impl CalendarAccessTokenProvider for IssuedToken {
    async fn fetch_access_token(
        &self,
        _: &CalendarLinkTokenIdentity,
    ) -> Result<String, CalendarTokenError> {
        Ok(TOKEN.into())
    }
}

struct NoOpenClients;

impl CalendarRefreshNotifier for NoOpenClients {
    async fn calendar_changed(&self, _: &str, _: Uuid, _: bool) {}
}

#[derive(Clone, Default)]
struct GraphEvent(Arc<Mutex<Option<Value>>>);

impl Respond for GraphEvent {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let mut stored = self.0.lock().unwrap();
        match request.method.as_str() {
            "POST" => {
                let mut created: Value = serde_json::from_slice(&request.body).unwrap();
                created["id"] = json!("AAMkCreated");
                created["@odata.etag"] = json!("W/\"1\"");
                created["iCalUId"] = json!("040000008200E00074C5B7101A82E008000000001C7D");
                created["type"] = json!("singleInstance");
                created["organizer"] = json!({"emailAddress":{"address":INBOX,"name":"Olivia"}});
                created["createdDateTime"] = json!(Utc::now().to_rfc3339());
                created["lastModifiedDateTime"] = json!(Utc::now().to_rfc3339());
                *stored = Some(created.clone());
                ResponseTemplate::new(201).set_body_json(created)
            }
            "PATCH" => {
                let event = stored.as_mut().unwrap();
                let patch: serde_json::Map<String, Value> =
                    serde_json::from_slice(&request.body).unwrap();
                for (key, value) in patch {
                    event[key.as_str()] = value;
                }
                event["@odata.etag"] = json!("W/\"2\"");
                event["lastModifiedDateTime"] = json!(Utc::now().to_rfc3339());
                ResponseTemplate::new(200).set_body_json(event.clone())
            }
            "DELETE" => {
                *stored = None;
                ResponseTemplate::new(204)
            }
            _ => match stored.as_ref() {
                Some(event) => ResponseTemplate::new(200).set_body_json(event),
                None => ResponseTemplate::new(404),
            },
        }
    }
}

async fn connected_mailbox(
    pool: &PgPool,
    server: &MockServer,
    api: &OutlookApiClientRepository,
    calendars: Value,
) -> PgCalendarRepository {
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
        macro_user_id,
        OWNER,
        format!("cus_{macro_user_id}"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        OWNER,
        INBOX,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    let link = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, sync_generation, grant_generation, is_sync_active) VALUES ($1, $2, $2, $3, 'OUTLOOK', 1, 1, true)",
        link,
        OWNER,
        INBOX,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_link_microsoft_scopes (link_id, grant_generation, granted_scopes) VALUES ($1, 1, ARRAY['Calendars.ReadWrite'])",
        link,
    )
    .execute(pool)
    .await
    .unwrap();
    Mock::given(method("GET"))
        .and(path("/v1.0/me/mailboxSettings"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"timeZone":"Pacific Standard Time"})),
        )
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":calendars})))
        .mount(server)
        .await;
    let repo = PgCalendarRepository::new(pool.clone());
    let discovery = repo
        .claim_outlook_calendar(
            Uuid::now_v7(),
            OccurrenceRange::maintenance_horizon(Utc::now()),
        )
        .await
        .unwrap()
        .unwrap();
    let discovered = api.calendars(TOKEN, discovery.binding).await.unwrap();
    repo.commit_outlook_calendars(&discovery, discovered)
        .await
        .unwrap();
    repo
}

async fn sync_event(repo: &PgCalendarRepository, api: &OutlookApiClientRepository, graph_id: &str) {
    let lease = repo
        .claim_outlook_calendar(
            Uuid::now_v7(),
            OccurrenceRange::maintenance_horizon(Utc::now()),
        )
        .await
        .unwrap()
        .unwrap();
    let upsert = api
        .refresh_calendar_event(TOKEN, lease.target.as_ref().unwrap(), graph_id)
        .await
        .unwrap()
        .unwrap();
    repo.upsert_event(CalendarEventWrite::OutlookSync {
        lease: Box::new(lease),
        upsert,
    })
    .await
    .unwrap();
}

fn two_weeks() -> OccurrenceRange {
    let now = Utc::now();
    OccurrenceRange {
        starts_at: now,
        ends_at: now + Duration::days(14),
        start_date: now.date_naive(),
        end_date: now.date_naive() + Days::new(14),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_event_created_on_a_chosen_outlook_calendar_is_posted_there_and_listed_at_its_time(
    pool: PgPool,
) {
    let (server, api) = setup().await;
    let repo = connected_mailbox(
        &pool,
        &server,
        &api,
        json!([
            {"id":"AAMkCalendar","name":"Calendar","canEdit":true,"isDefaultCalendar":true},
            {"id":"AAMkDesign","name":"Design reviews","canEdit":true,"isDefaultCalendar":false},
        ]),
    )
    .await;
    Mock::given(path_regex(EVENTS))
        .respond_with(GraphEvent::default())
        .mount(&server)
        .await;
    let reads = CalendarService::new(repo.clone());
    let design = reads
        .list_visible_calendars(OWNER)
        .await
        .unwrap()
        .into_iter()
        .find(|calendar| calendar.name == "Design reviews")
        .unwrap();
    let day = Utc::now().date_naive() + Days::new(7);
    let starts_at = day
        .and_hms_opt(10, 0, 0)
        .unwrap()
        .and_local_timezone(Los_Angeles)
        .unwrap()
        .to_utc();
    let ends_at = day
        .and_hms_opt(10, 45, 0)
        .unwrap()
        .and_local_timezone(Los_Angeles)
        .unwrap()
        .to_utc();
    let time = EventTime::Timed {
        starts_at,
        ends_at,
        time_zone: Some("America/Los_Angeles".into()),
    };

    let created = CalendarMutationServiceImpl::new(
        repo,
        api,
        IssuedToken,
        NoopMacroEventBroker,
        NoOpenClients,
    )
    .create_event(
        OWNER,
        None,
        Some(design.id),
        CalendarEventDraft {
            idempotency_key: None,
            title: "Design review".into(),
            description: None,
            location: None,
            time: time.clone(),
            attendees: vec![guest("ada@example.com")],
            recurrence_lines: vec![],
            visibility: None,
            transparency: None,
            reminders: None,
            conference: None,
            out_of_office: None,
            guest_policy: None,
        },
    )
    .await
    .unwrap();

    let requests = server.received_requests().await.unwrap();
    let posts: Vec<_> = requests
        .iter()
        .filter(|r| r.method.as_str() == "POST")
        .collect();
    assert_eq!(posts.len(), 1);
    assert_eq!(posts[0].url.path(), "/v1.0/me/calendars/AAMkDesign/events");
    assert_eq!(
        posts[0].headers.get("authorization").unwrap(),
        "Bearer graph-access-token"
    );
    let body: Value = serde_json::from_slice(&posts[0].body).unwrap();
    assert_eq!(body["subject"], "Design review");
    assert_eq!(
        body["start"],
        json!({"dateTime":format!("{day}T10:00:00"),"timeZone":"America/Los_Angeles"})
    );
    assert_eq!(
        body["end"],
        json!({"dateTime":format!("{day}T10:45:00"),"timeZone":"America/Los_Angeles"})
    );
    assert_eq!(body["isAllDay"], false);
    assert_eq!(
        body["attendees"],
        json!([
            {"emailAddress":{"address":"olivia@example.com"},"type":"required"},
            {"emailAddress":{"address":"ada@example.com"},"type":"required"},
        ]),
        "Ada is invited alongside Olivia, who organizes"
    );
    assert!(
        requests
            .iter()
            .all(|r| !r.url.path().contains("AAMkCalendar")),
        "the default calendar is left alone"
    );
    assert_eq!(created.calendar_id, Some(design.id));
    assert_eq!(created.title, "Design review");
    assert_eq!(created.time, time);

    let listed = reads
        .list_occurrences(OWNER, two_weeks(), None, 100)
        .await
        .unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].event.id, created.id);
    assert_eq!(listed[0].event.calendar_id, Some(design.id));
    assert_eq!(listed[0].event.title, "Design review");
    assert_eq!(listed[0].event.time, time);
    assert_eq!(
        listed[0].occurrence.time,
        EventTime::Timed {
            starts_at,
            ends_at,
            time_zone: None
        }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_all_day_outlook_event_is_sent_as_utc_midnights_and_listed_on_its_dates(pool: PgPool) {
    let (server, api) = setup().await;
    let repo = connected_mailbox(
        &pool,
        &server,
        &api,
        json!([{"id":"AAMkCalendar","name":"Calendar","canEdit":true,"isDefaultCalendar":true}]),
    )
    .await;
    Mock::given(path_regex(EVENTS))
        .respond_with(GraphEvent::default())
        .mount(&server)
        .await;
    let reads = CalendarService::new(repo.clone());
    let first_day = Utc::now().date_naive() + Days::new(7);
    let day_after_last = first_day + Days::new(2);
    let time = EventTime::AllDay {
        start_date: first_day,
        end_date: day_after_last,
    };

    let created = CalendarMutationServiceImpl::new(
        repo,
        api,
        IssuedToken,
        NoopMacroEventBroker,
        NoOpenClients,
    )
    .create_event(
        OWNER,
        None,
        None,
        CalendarEventDraft {
            idempotency_key: None,
            title: "Team offsite".into(),
            description: None,
            location: None,
            time: time.clone(),
            attendees: vec![],
            recurrence_lines: vec![],
            visibility: None,
            transparency: None,
            reminders: None,
            conference: None,
            out_of_office: None,
            guest_policy: None,
        },
    )
    .await
    .unwrap();

    let requests = server.received_requests().await.unwrap();
    let post = requests
        .iter()
        .find(|r| r.method.as_str() == "POST")
        .unwrap();
    assert_eq!(post.url.path(), "/v1.0/me/calendars/AAMkCalendar/events");
    let body: Value = serde_json::from_slice(&post.body).unwrap();
    assert_eq!(
        body["start"],
        json!({"dateTime":format!("{first_day}T00:00:00"),"timeZone":"UTC"})
    );
    assert_eq!(
        body["end"],
        json!({"dateTime":format!("{day_after_last}T00:00:00"),"timeZone":"UTC"}),
        "Graph's all-day end is the exclusive day after the last one"
    );
    assert_eq!(body["isAllDay"], true);
    assert_eq!(created.time, time);

    let listed = reads
        .list_occurrences(OWNER, two_weeks(), None, 100)
        .await
        .unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].event.id, created.id);
    assert_eq!(listed[0].occurrence.time, time);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn moving_a_synced_outlook_meeting_patches_only_its_times_and_lists_it_at_the_new_slot(
    pool: PgPool,
) {
    let (server, api) = setup().await;
    let repo = connected_mailbox(
        &pool,
        &server,
        &api,
        json!([{"id":"AAMkCalendar","name":"Calendar","canEdit":true,"isDefaultCalendar":true}]),
    )
    .await;
    let day = Utc::now().date_naive() + Days::new(7);
    let ten = day
        .and_hms_opt(10, 0, 0)
        .unwrap()
        .and_local_timezone(Los_Angeles)
        .unwrap()
        .to_utc();
    let half_past_ten = day
        .and_hms_opt(10, 30, 0)
        .unwrap()
        .and_local_timezone(Los_Angeles)
        .unwrap()
        .to_utc();
    let graph = GraphEvent(Arc::new(Mutex::new(Some(json!({
        "id":"AAMkRoadmap",
        "@odata.etag":"W/\"1\"",
        "iCalUId":"040000008200E00074C5B7101A82E00800000000A9F3",
        "type":"singleInstance",
        "subject":"Roadmap sync",
        "location":{"displayName":"Room 4"},
        "createdDateTime":(Utc::now() - Duration::days(2)).to_rfc3339(),
        "lastModifiedDateTime":(Utc::now() - Duration::days(1)).to_rfc3339(),
        "originalStartTimeZone":"Pacific Standard Time",
        "start":{"dateTime":ten.format("%Y-%m-%dT%H:%M:%S.0000000").to_string(),"timeZone":"UTC"},
        "end":{"dateTime":half_past_ten.format("%Y-%m-%dT%H:%M:%S.0000000").to_string(),"timeZone":"UTC"},
        "isAllDay":false,
        "organizer":{"emailAddress":{"address":INBOX,"name":"Olivia"}},
        "attendees":[{
            "emailAddress":{"address":"ada@example.com","name":"Ada"},
            "type":"required",
            "status":{"response":"accepted","time":(Utc::now() - Duration::days(1)).to_rfc3339()}
        }]
    })))));
    Mock::given(path_regex(EVENTS))
        .respond_with(graph)
        .mount(&server)
        .await;
    sync_event(&repo, &api, "AAMkRoadmap").await;
    let reads = CalendarService::new(repo.clone());
    let synced = reads
        .list_occurrences(OWNER, two_weeks(), None, 100)
        .await
        .unwrap();
    assert_eq!(synced.len(), 1);
    let one = day
        .and_hms_opt(13, 0, 0)
        .unwrap()
        .and_local_timezone(Los_Angeles)
        .unwrap()
        .to_utc();
    let half_past_one = day
        .and_hms_opt(13, 30, 0)
        .unwrap()
        .and_local_timezone(Los_Angeles)
        .unwrap()
        .to_utc();
    let moved = EventTime::Timed {
        starts_at: one,
        ends_at: half_past_one,
        time_zone: Some("America/Los_Angeles".into()),
    };

    let updated = CalendarMutationServiceImpl::new(
        repo,
        api,
        IssuedToken,
        NoopMacroEventBroker,
        NoOpenClients,
    )
    .update_event(
        OWNER,
        synced[0].event.id,
        None,
        CalendarEventPatch {
            time: Some(moved.clone()),
            ..Default::default()
        },
        CalendarUpdateScope::All,
    )
    .await
    .unwrap();

    let requests = server.received_requests().await.unwrap();
    let patches: Vec<_> = requests
        .iter()
        .filter(|r| r.method.as_str() == "PATCH")
        .collect();
    assert_eq!(patches.len(), 1);
    assert_eq!(patches[0].url.path(), "/v1.0/me/events/AAMkRoadmap");
    assert_eq!(
        serde_json::from_slice::<Value>(&patches[0].body).unwrap(),
        json!({
            "start":{"dateTime":format!("{day}T13:00:00"),"timeZone":"America/Los_Angeles"},
            "end":{"dateTime":format!("{day}T13:30:00"),"timeZone":"America/Los_Angeles"},
            "isAllDay":false
        }),
        "a time move rewrites neither the guest list nor the details"
    );
    assert_eq!(updated.id, synced[0].event.id);
    assert_eq!(updated.time, moved);

    let listed = reads
        .list_occurrences(OWNER, two_weeks(), None, 100)
        .await
        .unwrap();
    assert_eq!(listed.len(), 1, "the old slot is not left behind");
    assert_eq!(listed[0].event.id, synced[0].event.id);
    assert_eq!(listed[0].event.time, moved);
    assert_eq!(
        listed[0].occurrence.time,
        EventTime::Timed {
            starts_at: one,
            ends_at: half_past_one,
            time_zone: None
        }
    );
    assert_eq!(listed[0].event.title, "Roadmap sync");
    assert_eq!(listed[0].event.location.as_deref(), Some("Room 4"));
    assert!(listed[0].event.attendees.iter().any(|attendee| {
        attendee.email == "ada@example.com"
            && attendee.response_status == AttendeeResponseStatus::Accepted
    }));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_synced_outlook_event_deletes_it_in_graph_and_drops_it_from_the_calendar(
    pool: PgPool,
) {
    let (server, api) = setup().await;
    let repo = connected_mailbox(
        &pool,
        &server,
        &api,
        json!([{"id":"AAMkCalendar","name":"Calendar","canEdit":true,"isDefaultCalendar":true}]),
    )
    .await;
    let day = Utc::now().date_naive() + Days::new(7);
    let nine = day
        .and_hms_opt(9, 0, 0)
        .unwrap()
        .and_local_timezone(Los_Angeles)
        .unwrap()
        .to_utc();
    let ten = day
        .and_hms_opt(10, 0, 0)
        .unwrap()
        .and_local_timezone(Los_Angeles)
        .unwrap()
        .to_utc();
    let graph = GraphEvent(Arc::new(Mutex::new(Some(json!({
        "id":"AAMkDentist",
        "@odata.etag":"W/\"1\"",
        "iCalUId":"040000008200E00074C5B7101A82E00800000000B214",
        "type":"singleInstance",
        "subject":"Dentist",
        "createdDateTime":(Utc::now() - Duration::days(2)).to_rfc3339(),
        "lastModifiedDateTime":(Utc::now() - Duration::days(1)).to_rfc3339(),
        "originalStartTimeZone":"Pacific Standard Time",
        "start":{"dateTime":nine.format("%Y-%m-%dT%H:%M:%S.0000000").to_string(),"timeZone":"UTC"},
        "end":{"dateTime":ten.format("%Y-%m-%dT%H:%M:%S.0000000").to_string(),"timeZone":"UTC"},
        "isAllDay":false,
        "organizer":{"emailAddress":{"address":INBOX,"name":"Olivia"}},
        "attendees":[]
    })))));
    Mock::given(path_regex(EVENTS))
        .respond_with(graph)
        .mount(&server)
        .await;
    sync_event(&repo, &api, "AAMkDentist").await;
    let reads = CalendarService::new(repo.clone());
    let synced = reads
        .list_occurrences(OWNER, two_weeks(), None, 100)
        .await
        .unwrap();
    assert_eq!(synced.len(), 1);

    CalendarMutationServiceImpl::new(repo, api, IssuedToken, NoopMacroEventBroker, NoOpenClients)
        .delete_event(OWNER, synced[0].event.id, None, CalendarDeletionScope::All)
        .await
        .unwrap();

    let deletes: Vec<_> = server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .filter(|r| r.method.as_str() == "DELETE")
        .map(|r| r.url.path().to_owned())
        .collect();
    assert_eq!(deletes, ["/v1.0/me/events/AAMkDentist"]);
    assert!(
        reads
            .list_occurrences(OWNER, two_weeks(), None, 100)
            .await
            .unwrap()
            .is_empty()
    );
}
