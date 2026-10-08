use super::*;
use crate::domain::models::{
    CalendarEvent, CalendarEventOverride, CalendarOccurrence, EventStart, EventTime, EventType,
    EventVisibility,
};
use std::sync::{
    Mutex,
    atomic::{AtomicUsize, Ordering},
};

fn source() -> TeamSourceOccurrence {
    let id = Uuid::now_v7();
    let time = EventTime::Timed {
        starts_at: Utc::now(),
        ends_at: Utc::now() + chrono::Duration::hours(1),
        time_zone: Some("UTC".into()),
    };
    let event: CalendarEvent = serde_json::from_value(serde_json::json!({
        "id": id, "ownerId": "owner", "icalUid": "sensitive-provider-uid", "title": "Sensitive appointment",
        "description": "Sensitive body", "location": "Sensitive location", "status": "confirmed",
        "visibility": "default", "transparency": "opaque", "eventType": "focus_time", "time": time,
        "recurrenceLines": [], "organizerEmail": "owner@example.com", "organizerName": "Owner",
        "conferenceUrl": "https://meet.example.com/private", "sequence": 1, "isReadOnly": false,
        "attendees": [{"email":"owner@example.com","displayName":"Owner","responseStatus":"accepted","isOrganizer":true,"isOptional":false,"isSelf":true}],
        "createdAt": Utc::now(), "updatedAt": Utc::now()
    })).unwrap();
    TeamSourceOccurrence {
        shared_by: "owner".into(),
        source_id: Uuid::now_v7(),
        calendar_id: Uuid::now_v7(),
        calendar_name: "Sensitive calendar".into(),
        calendar_time_zone: Some("UTC".into()),
        contributes_to_availability: true,
        owner_emails: vec!["owner@example.com".into()],
        occurrence: CalendarOccurrence {
            event_id: id,
            occurrence_key: "instance".into(),
            recurrence_id: None,
            time,
            is_cancelled: false,
        },
        event,
        overrides: vec![],
    }
}

fn range() -> OccurrenceRange {
    let now = Utc::now();
    OccurrenceRange {
        starts_at: now,
        ends_at: now + chrono::Duration::days(1),
        start_date: now.date_naive(),
        end_date: now.date_naive().succ_opt().unwrap(),
    }
}

#[test]
fn busy_and_private_projection_has_no_event_content_or_ids() {
    let mut row = source();
    for (sharing, visibility) in [
        (TeamCalendarSharing::BusyOnly, EventVisibility::Default),
        (TeamCalendarSharing::All, EventVisibility::Private),
        (TeamCalendarSharing::All, EventVisibility::Confidential),
    ] {
        row.event.visibility = visibility;
        let json = serde_json::to_value(project(&row, sharing, &[]).unwrap()).unwrap();
        assert_eq!(json["kind"], "busy");
        let serialized = json.to_string();
        for forbidden in [
            "Sensitive",
            "focus_time",
            "sensitive-provider-uid",
            "owner@example.com",
            "meet.example",
            &row.event.id.to_string(),
        ] {
            assert!(!serialized.contains(forbidden), "leaked {forbidden}");
        }
        assert_eq!(json.as_object().unwrap().len(), 5);
    }
    assert!(project(&row, TeamCalendarSharing::None, &[]).is_none());
}

#[test]
fn subscribed_busy_block_is_shared_without_claiming_personal_busyness() {
    let mut row = source();
    row.contributes_to_availability = false;
    row.owner_emails = vec!["subscriber@example.com".into()];
    let item = project(&row, TeamCalendarSharing::BusyOnly, &[]).unwrap();
    assert!(!item.contributes_to_availability);
    row.event.event_type = EventType::WorkingLocation;
    assert!(project(&row, TeamCalendarSharing::BusyOnly, &[]).is_none());
}

#[test]
fn detailed_attendee_flags_are_viewer_relative_and_copies_have_one_identity() {
    let row = source();
    let item = project(
        &row,
        TeamCalendarSharing::All,
        &["viewer@example.com".into()],
    )
    .unwrap();
    let TeamCalendarContent::Details { details } = item.content else {
        panic!("expected details")
    };
    assert!(!details.attendees[0].is_self);
    let mut other_source = row.clone();
    other_source.source_id = Uuid::now_v7();
    other_source.event.id = Uuid::now_v7();
    assert_eq!(
        item.id,
        project(&other_source, TeamCalendarSharing::BusyOnly, &[])
            .unwrap()
            .id
    );
}

#[test]
fn a_private_exception_cannot_expose_its_replacement_title() {
    let mut row = source();
    row.occurrence.recurrence_id = Some("original".into());
    row.overrides.push(CalendarEventOverride {
        sequence: None,
        source_updated_at: None,
        recurrence_id: "original".into(),
        original_time: EventStart::Timed(Utc::now()),
        time: row.occurrence.time.clone(),
        title: Some("Private exception appointment".into()),
        description: None,
        location: None,
        status: None,
        visibility: Some(EventVisibility::Private),
        transparency: None,
        attendees: None,
    });
    let item = project(&row, TeamCalendarSharing::All, &[]).unwrap();
    assert!(matches!(item.content, TeamCalendarContent::Busy));
    let serialized = serde_json::to_string(&item).unwrap();
    assert!(!serialized.contains("Private exception"));
    assert!(!serialized.contains("Sensitive"));
}

#[derive(Default)]
struct Repository {
    owners: Mutex<Vec<String>>,
    rows: Vec<TeamSourceOccurrence>,
    forbid_event_reads: bool,
    change_revision: bool,
    revision_reads: AtomicUsize,
}
impl CalendarTeamRepository for Repository {
    async fn projection_revision(&self, _: &str) -> Result<String, Report> {
        if self.revision_reads.fetch_add(1, Ordering::Relaxed) > 0 && self.change_revision {
            return Ok("changed".into());
        }
        Ok("current".into())
    }
    async fn members(
        &self,
        requester: &str,
        include_self: bool,
        _: &OccurrenceRange,
    ) -> Result<Vec<TeamCalendarMember>, Report> {
        let mut members = vec![TeamCalendarMember {
            user_id: "owner".into(),
            sharing: TeamCalendarSharing::BusyOnly,
            coverage: TeamCalendarCoverage::Ready,
        }];
        if include_self {
            members.push(TeamCalendarMember {
                user_id: requester.into(),
                sharing: TeamCalendarSharing::All,
                coverage: TeamCalendarCoverage::Ready,
            });
        }
        Ok(members)
    }
    async fn sources(
        &self,
        _: &str,
        _: OccurrenceRange,
        owners: &[String],
        cursor: Option<&TeamCalendarCursor>,
        limit: u32,
    ) -> Result<Vec<TeamSourceOccurrence>, Report> {
        assert!(!self.forbid_event_reads, "roster must not load occurrences");
        *self.owners.lock().unwrap() = owners.to_vec();
        let mut rows: Vec<_> = self
            .rows
            .iter()
            .filter(|row| owners.contains(&row.shared_by))
            .filter(|row| {
                cursor.is_none_or(|cursor| {
                    (
                        &row.shared_by,
                        row.source_id,
                        &row.occurrence.occurrence_key,
                    ) > (&cursor.user_id, cursor.source_id, &cursor.occurrence_key)
                })
            })
            .cloned()
            .collect();
        rows.sort_by_key(|row| {
            (
                row.shared_by.clone(),
                row.source_id,
                row.occurrence.occurrence_key.clone(),
            )
        });
        rows.truncate(limit as usize);
        Ok(rows)
    }
    async fn owned_emails(&self, _: &str) -> Result<Vec<String>, Report> {
        assert!(
            !self.forbid_event_reads,
            "roster must not load owned emails"
        );
        Ok(vec![])
    }
    async fn sharing(&self, _: &str) -> Result<TeamCalendarSharing, Report> {
        Ok(TeamCalendarSharing::default())
    }
    async fn set_sharing(&self, _: &str, _: TeamCalendarSharing) -> Result<(), Report> {
        Ok(())
    }
    async fn availability_calendars(&self, _: &str) -> Result<Vec<AvailabilityCalendar>, Report> {
        Ok(vec![])
    }
    async fn set_availability_calendar(&self, _: &str, _: Uuid, _: bool) -> Result<bool, Report> {
        Ok(false)
    }
}

#[tokio::test]
async fn roster_only_skips_event_reads_and_rejects_cursors_or_invalid_ranges() {
    let service = CalendarTeamServiceImpl::new(
        Repository {
            forbid_event_reads: true,
            ..Repository::default()
        },
        true,
    );
    let page = service
        .list_team_calendar("viewer", range(), None, 0)
        .await
        .unwrap();
    assert_eq!(page.members.len(), 1);
    assert_eq!(page.members[0].user_id, "owner");
    assert!(page.items.is_empty());
    assert!(page.next_cursor.is_none());
    assert_eq!(service.repository.revision_reads.load(Ordering::Relaxed), 2);

    let cursor = TeamCalendarCursor {
        revision: "current".into(),
        user_id: "owner".into(),
        source_id: Uuid::now_v7(),
        occurrence_key: "x".into(),
    };
    assert!(
        service
            .list_team_calendar("viewer", range(), Some(cursor), 0)
            .await
            .is_err()
    );
    let mut invalid_range = range();
    invalid_range.ends_at = invalid_range.starts_at;
    assert!(
        service
            .list_team_calendar("viewer", invalid_range, None, 0)
            .await
            .is_err()
    );
    assert_eq!(service.repository.revision_reads.load(Ordering::Relaxed), 2);
}

#[tokio::test]
async fn roster_only_enforces_the_gate_and_rechecks_authorization_revision() {
    for (enabled, change_revision) in [(false, false), (true, true)] {
        let service = CalendarTeamServiceImpl::new(
            Repository {
                forbid_event_reads: true,
                change_revision,
                ..Repository::default()
            },
            enabled,
        );
        assert!(
            service
                .list_team_calendar("viewer", range(), None, 0)
                .await
                .is_err()
        );
        assert_eq!(
            service.repository.revision_reads.load(Ordering::Relaxed),
            if enabled { 2 } else { 0 }
        );
    }
}

#[tokio::test]
async fn disabled_reads_and_stale_cursor_fail_closed() {
    let service = CalendarTeamServiceImpl::new(Repository::default(), false);
    assert!(
        service
            .list_team_calendar("viewer", range(), None, 10)
            .await
            .is_err()
    );
    assert!(
        service
            .get_team_availability("viewer", range(), None)
            .await
            .is_err()
    );
    assert_eq!(
        service.team_sharing("viewer").await.unwrap(),
        TeamCalendarSharing::BusyOnly
    );
    let service = CalendarTeamServiceImpl::new(Repository::default(), true);
    let cursor = TeamCalendarCursor {
        revision: "old".into(),
        user_id: "owner".into(),
        source_id: Uuid::now_v7(),
        occurrence_key: "x".into(),
    };
    assert!(
        service
            .list_team_calendar("viewer", range(), Some(cursor), 10)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn selected_unknown_ids_do_not_broaden_and_requester_is_always_included() {
    let service = CalendarTeamServiceImpl::new(Repository::default(), true);
    let result = service
        .get_team_availability("viewer", range(), Some(&["outsider".into()]))
        .await
        .unwrap();
    assert_eq!(
        service.repository.owners.lock().unwrap().as_slice(),
        &["viewer"]
    );
    assert_eq!(result.unknown_user_ids, vec!["outsider"]);
    assert!(!result.complete);
    assert!(result.free_windows.is_none());
    let result = service
        .get_team_availability("viewer", range(), Some(&[]))
        .await
        .unwrap();
    assert_eq!(result.members.len(), 1);
    assert_eq!(result.members[0].user_id, "viewer");
}

#[tokio::test]
async fn duplicate_source_selection_is_independent_of_page_size() {
    let first = source();
    let mut second = first.clone();
    second.source_id = Uuid::now_v7();
    second.occurrence.time = EventTime::Timed {
        starts_at: Utc::now() + chrono::Duration::hours(2),
        ends_at: Utc::now() + chrono::Duration::hours(3),
        time_zone: None,
    };
    let service = CalendarTeamServiceImpl::new(
        Repository {
            rows: vec![first, second],
            ..Repository::default()
        },
        true,
    );
    let all = service
        .list_team_calendar("viewer", range(), None, 100)
        .await
        .unwrap();
    let mut paged = service
        .list_team_calendar("viewer", range(), None, 1)
        .await
        .unwrap();
    let cursor = serde_json::from_str(paged.next_cursor.as_ref().unwrap()).unwrap();
    paged.items.extend(
        service
            .list_team_calendar("viewer", range(), Some(cursor), 1)
            .await
            .unwrap()
            .items,
    );
    let collect = |items: Vec<TeamCalendarItem>| {
        items
            .into_iter()
            .map(|item| (item.id.clone(), serde_json::to_value(item).unwrap()))
            .collect::<HashMap<_, _>>()
    };
    assert_eq!(collect(all.items), collect(paged.items));
}
