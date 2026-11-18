use super::*;
use chrono::{DateTime, TimeDelta, TimeZone, Utc};

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 17, 12, 0, 0).unwrap()
}

fn member(provider_id: &str, master_id: &str, hours_from_now: i64) -> OutlookPageMember {
    let starts_at = now() + TimeDelta::hours(hours_from_now);
    OutlookPageMember {
        provider_id: provider_id.into(),
        master_id: master_id.into(),
        occurs: Some((starts_at, starts_at + TimeDelta::hours(1))),
    }
}

#[test]
fn the_near_window_reads_the_events_closest_to_now_first() {
    let mut under_way = member("under-way", "under-way", -2);
    under_way.occurs = under_way
        .occurs
        .map(|(starts_at, _)| (starts_at, now() + TimeDelta::days(3)));
    let untimed = OutlookPageMember {
        occurs: None,
        ..member("untimed", "untimed", 0)
    };
    let members = vec![
        member("a-next-month", "a-next-month", 24 * 30),
        untimed,
        member("b-yesterday", "b-yesterday", -24),
        member("series-in-a-week", "series", 24 * 7),
        member("series-tomorrow", "series", 24),
        member("c-in-two-days", "c-in-two-days", 48),
        under_way,
    ];

    assert_eq!(
        nearest_first(&members, now()),
        [
            "under-way",
            "b-yesterday",
            "series",
            "c-in-two-days",
            "a-next-month",
            "untimed",
        ],
        "an event under way, then by distance from now in either direction, \
        a series by its nearest occurrence, and an untimed member last"
    );
}

#[test]
fn equally_near_events_and_untimed_ones_keep_id_order() {
    let untimed = |id: &str| OutlookPageMember {
        provider_id: id.into(),
        master_id: id.into(),
        occurs: None,
    };
    let members = vec![
        untimed("z-untimed"),
        member("b-in-an-hour", "b-in-an-hour", 1),
        untimed("y-untimed"),
        member("a-in-an-hour", "a-in-an-hour", 1),
    ];

    assert_eq!(
        nearest_first(&members, now()),
        ["a-in-an-hour", "b-in-an-hour", "y-untimed", "z-untimed"]
    );
}

/// The revisions waiting for the relay, and the ones it acknowledged. An
/// acknowledgement of an entity `unavailable` names fails.
#[derive(Clone, Default)]
struct Outbox {
    pending: std::sync::Arc<std::sync::Mutex<Vec<CalendarProjectionLease>>>,
    completed: std::sync::Arc<std::sync::Mutex<Vec<Uuid>>>,
    unavailable: Vec<Uuid>,
}

impl CalendarProjectionOutbox for Outbox {
    async fn claim_projections(
        &self,
        _: Uuid,
        limit: u16,
    ) -> Result<Vec<CalendarProjectionLease>, Report> {
        let mut pending = self.pending.lock().unwrap();
        let taken = pending.len().min(usize::from(limit));
        Ok(pending.drain(..taken).collect())
    }
    async fn complete_projection(&self, lease: &CalendarProjectionLease) -> Result<(), Report> {
        if self.unavailable.contains(&lease.event_id) {
            return Err(rootcause::report!("the outbox is unavailable"));
        }
        self.completed.lock().unwrap().push(lease.event_id);
        Ok(())
    }
}

/// Publishes every event but those of the entities `failing` names.
#[derive(Clone, Default)]
struct Broker {
    failing: Vec<Uuid>,
}

impl macro_event_broker::MacroEventBroker for Broker {
    fn send_event<E: macro_event_broker::MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<
        tokio::task::JoinHandle<Result<(), macro_event_broker::EventBrokerError>>,
        macro_event_broker::EventBrokerError,
    > {
        let fails = self.failing.iter().any(|id| event.key() == id.to_string());
        Ok(tokio::spawn(async move {
            if fails {
                Err(macro_event_broker::EventBrokerError::MissingMessageKey)
            } else {
                Ok(())
            }
        }))
    }
}

/// The inboxes refreshed, in order, with each refresh's team out-of-office hint.
#[derive(Clone, Default)]
struct Refreshes(std::sync::Arc<std::sync::Mutex<Vec<(String, Uuid, bool)>>>);

impl CalendarRefreshNotifier for Refreshes {
    async fn calendar_changed(&self, owner_id: &str, email_link_id: Uuid, team_ooo_changed: bool) {
        self.0
            .lock()
            .unwrap()
            .push((owner_id.to_owned(), email_link_id, team_ooo_changed));
    }
    async fn join_request_answered(&self, _: &str, _: Uuid) {}
}

fn revision(owner_id: &str, link_id: Uuid) -> CalendarProjectionLease {
    let event_id = Uuid::now_v7();
    CalendarProjectionLease {
        event_id,
        revision: 1,
        lease_id: Uuid::nil(),
        link_id,
        team_ooo_changed: false,
        event: crate::domain::events::CalendarTopicEvent::Updated(
            crate::domain::events::CalendarEventMetadata {
                event_id,
                owner_id: owner_id.to_owned(),
            },
        ),
    }
}

#[tokio::test]
async fn a_batch_refreshes_each_inbox_it_changed_once() {
    let (ada, grace) = (Uuid::now_v7(), Uuid::now_v7());
    let away = CalendarProjectionLease {
        team_ooo_changed: true,
        ..revision("macro|ada@example.com", ada)
    };
    let outbox = Outbox::default();
    *outbox.pending.lock().unwrap() = vec![
        revision("macro|ada@example.com", ada),
        revision("macro|grace@example.com", grace),
        away,
        revision("macro|ada@example.com", ada),
    ];
    let refreshes = Refreshes::default();
    let relay = CalendarProjectionRelay::new(outbox.clone(), Broker::default(), refreshes.clone());

    assert!(
        !relay.run_once().await.unwrap(),
        "everything due fit in one batch"
    );
    assert_eq!(
        *refreshes.0.lock().unwrap(),
        [
            ("macro|ada@example.com".to_owned(), ada, true),
            ("macro|grace@example.com".to_owned(), grace, false)
        ],
        "an inbox's refresh carries the hint of any of its changes"
    );
    assert_eq!(outbox.completed.lock().unwrap().len(), 4);
}

#[tokio::test]
async fn a_revision_that_fails_to_publish_stays_for_its_retry() {
    let (ada, grace) = (Uuid::now_v7(), Uuid::now_v7());
    let published = revision("macro|ada@example.com", ada);
    let failed = revision("macro|ada@example.com", ada);
    let alone = revision("macro|grace@example.com", grace);
    let (published_id, failing) = (published.event_id, vec![failed.event_id, alone.event_id]);
    let outbox = Outbox::default();
    *outbox.pending.lock().unwrap() = vec![published, failed, alone];
    let refreshes = Refreshes::default();
    let relay = CalendarProjectionRelay::new(outbox.clone(), Broker { failing }, refreshes.clone());

    relay.run_once().await.unwrap();
    assert_eq!(
        *refreshes.0.lock().unwrap(),
        [("macro|ada@example.com".to_owned(), ada, false)],
        "an inbox whose every change failed waits for the retry"
    );
    assert_eq!(*outbox.completed.lock().unwrap(), [published_id]);
}

#[tokio::test]
async fn a_full_batch_asks_for_the_next_one_at_once() {
    let ada = Uuid::now_v7();
    let outbox = Outbox::default();
    *outbox.pending.lock().unwrap() = (0..=PROJECTION_BATCH)
        .map(|_| revision("macro|ada@example.com", ada))
        .collect();
    let refreshes = Refreshes::default();
    let relay = CalendarProjectionRelay::new(outbox.clone(), Broker::default(), refreshes.clone());

    assert!(relay.run_once().await.unwrap(), "more may be due");
    assert!(!relay.run_once().await.unwrap(), "the last one was taken");
    assert_eq!(refreshes.0.lock().unwrap().len(), 2, "one per batch");
    assert_eq!(
        outbox.completed.lock().unwrap().len(),
        usize::from(PROJECTION_BATCH) + 1
    );
}

#[tokio::test]
async fn a_failed_acknowledgement_leaves_the_rest_acknowledged() {
    let ada = Uuid::now_v7();
    let stuck = revision("macro|ada@example.com", ada);
    let acknowledged = revision("macro|ada@example.com", ada);
    let (stuck_id, acknowledged_id) = (stuck.event_id, acknowledged.event_id);
    let outbox = Outbox {
        unavailable: vec![stuck_id],
        ..Outbox::default()
    };
    *outbox.pending.lock().unwrap() = vec![stuck, acknowledged];
    let relay =
        CalendarProjectionRelay::new(outbox.clone(), Broker::default(), Refreshes::default());

    assert!(
        relay.run_once().await.is_err(),
        "the round reports the failure"
    );
    assert_eq!(
        *outbox.completed.lock().unwrap(),
        [acknowledged_id],
        "the revision after it is not published again"
    );
}

fn listed_calendar(
    access_role: &str,
    owner: Option<&str>,
    shared_with_me: bool,
) -> OutlookCalendar {
    OutlookCalendar {
        calendar: ProviderCalendar {
            provider_calendar_id: "calendar".into(),
            name: "United States holidays".into(),
            description: None,
            time_zone: None,
            color: None,
            access_role: Some(access_role.into()),
            is_primary: false,
            is_selected: true,
            default_reminders: vec![],
        },
        online_meeting_providers: vec![],
        owner_address: owner.map(str::to_owned),
        shared_with_me,
    }
}

#[test]
fn only_the_mailboxs_own_read_only_calendars_are_system_calendars() {
    let mailbox = "olivia@example.com";
    assert!(listed_calendar("reader", Some("Olivia@Example.com"), false).is_system(mailbox));
    assert!(
        !listed_calendar("writer", Some(mailbox), false).is_system(mailbox),
        "a calendar the mailbox can edit is its own work"
    );
    assert!(
        !listed_calendar("reader", Some("ada@example.com"), false).is_system(mailbox),
        "a colleague's calendar shared read-only is their schedule"
    );
    assert!(
        !listed_calendar("reader", Some(mailbox), true).is_system(mailbox),
        "shared with the mailbox, whoever Graph names as owner"
    );
    assert!(!listed_calendar("reader", None, false).is_system(mailbox));
    assert!(
        !listed_calendar("reader", None, true).is_system(mailbox),
        "Graph lists a calendar subscribed from the web as shared, with no owner"
    );
    let mut primary = listed_calendar("reader", Some(mailbox), false);
    primary.calendar.is_primary = true;
    assert!(!primary.is_system(mailbox));
}
