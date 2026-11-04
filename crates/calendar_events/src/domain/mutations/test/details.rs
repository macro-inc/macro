use super::*;

const ORGANIZER: &str = "olivia@example.com";
const RECURRENCE_ID: &str = "2026-08-06T14:00:00+00:00";

const CAN_MODIFY: GuestPolicy = GuestPolicy {
    can_modify: true,
    can_invite_others: true,
    can_see_other_guests: true,
};

/// Olivia's meeting with the actor (`self@example.com`) as one of its
/// guests, under `guest_policy`.
fn guest_repo(guest_policy: GuestPolicy) -> FakeRepo {
    let mut organizer = echo_attendee(ORGANIZER, false);
    organizer.is_organizer = true;
    FakeRepo {
        mutation_target: Some(CalendarEventMutationTarget {
            organizer_email: Some(ORGANIZER.to_string()),
            guest_policy,
            ..mutation_target(false)
        }),
        stored_attendees: vec![organizer, echo_attendee("self@example.com", false)],
        event_details: Some(stored_details()),
        ..FakeRepo::default()
    }
}

fn stored_details() -> EventDetails {
    EventDetails {
        title: "Planning".to_string(),
        description: Some("Agenda".to_string()),
        location: None,
        visibility: EventVisibility::Default,
        time: Some(timed_time()),
        recurrence_lines: vec!["RRULE:FREQ=WEEKLY".to_string()],
        has_conference: true,
    }
}

fn popup_reminders() -> EventReminders {
    EventReminders {
        use_default: false,
        overrides: vec![crate::domain::models::EventReminderOverride {
            method: "popup".to_string(),
            minutes: 10,
        }],
    }
}

async fn update(
    repo: FakeRepo,
    provider: FakeProvider,
    patch: CalendarEventPatch,
    scope: CalendarUpdateScope,
) -> Result<CalendarEvent, CalendarMutationError> {
    service(repo, provider, FakeTokens::ok())
        .update_event("macro|user", Uuid::now_v7(), None, patch, scope)
        .await
}

#[tokio::test]
async fn a_guest_the_organizer_does_not_let_modify_cannot_change_details() {
    let changes = [
        CalendarEventPatch {
            title: Some("Retro".to_string()),
            ..CalendarEventPatch::default()
        },
        CalendarEventPatch {
            description: Some(String::new()),
            ..CalendarEventPatch::default()
        },
        CalendarEventPatch {
            location: Some("Room 4".to_string()),
            ..CalendarEventPatch::default()
        },
        CalendarEventPatch {
            time: Some(EventTime::AllDay {
                start_date: chrono::NaiveDate::from_ymd_opt(2026, 8, 6).unwrap(),
                end_date: chrono::NaiveDate::from_ymd_opt(2026, 8, 7).unwrap(),
            }),
            ..CalendarEventPatch::default()
        },
        CalendarEventPatch {
            recurrence_lines: Some(Vec::new()),
            ..CalendarEventPatch::default()
        },
        CalendarEventPatch {
            visibility: Some(EventVisibility::Private),
            ..CalendarEventPatch::default()
        },
        CalendarEventPatch {
            conference: Some(ConferenceChange::Removed),
            ..CalendarEventPatch::default()
        },
    ];
    for patch in changes {
        let provider = FakeProvider::new(FakeProviderBehavior::Echo);
        let calls = provider.calls.clone();

        let error = update(
            guest_repo(GuestPolicy::default()),
            provider,
            patch.clone(),
            CalendarUpdateScope::All,
        )
        .await
        .unwrap_err();

        assert!(
            matches!(error, CalendarMutationError::GuestsCannotModify),
            "{patch:?}: {error:?}"
        );
        assert!(calls.lock().unwrap().is_empty(), "{patch:?}");
    }
}

#[tokio::test]
async fn any_guest_changes_their_own_reminders_and_availability() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let patches = provider.updated_patches.clone();
    let repo = guest_repo(GuestPolicy::default());
    let details_requests = repo.details_requests.clone();

    update(
        repo,
        provider,
        CalendarEventPatch {
            reminders: Some(popup_reminders()),
            transparency: Some(EventTransparency::Transparent),
            ..CalendarEventPatch::default()
        },
        CalendarUpdateScope::All,
    )
    .await
    .unwrap();

    assert_eq!(
        patches.lock().unwrap().as_slice(),
        [CalendarEventPatch {
            reminders: Some(popup_reminders()),
            transparency: Some(EventTransparency::Transparent),
            ..CalendarEventPatch::default()
        }]
    );
    assert!(
        details_requests.lock().unwrap().is_empty(),
        "nothing to compare without a detail in the patch"
    );
}

#[tokio::test]
async fn a_guest_resending_unchanged_details_saves_only_their_own_fields() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let patches = provider.updated_patches.clone();
    let EventTime::Timed {
        starts_at, ends_at, ..
    } = timed_time()
    else {
        unreachable!("the fixture time is timed");
    };

    update(
        guest_repo(GuestPolicy::default()),
        provider,
        CalendarEventPatch {
            title: Some("Planning".to_string()),
            description: Some("Agenda".to_string()),
            location: Some(String::new()),
            // The same span, named in the guest's own zone.
            time: Some(EventTime::Timed {
                starts_at,
                ends_at,
                time_zone: Some("America/New_York".to_string()),
            }),
            recurrence_lines: Some(vec!["RRULE:FREQ=WEEKLY".to_string()]),
            visibility: Some(EventVisibility::Default),
            reminders: Some(popup_reminders()),
            ..CalendarEventPatch::default()
        },
        CalendarUpdateScope::All,
    )
    .await
    .unwrap();

    assert_eq!(
        patches.lock().unwrap().as_slice(),
        [CalendarEventPatch {
            reminders: Some(popup_reminders()),
            ..CalendarEventPatch::default()
        }],
        "Google never receives a guest's copy of the shared details"
    );
}

#[tokio::test]
async fn a_guest_resending_only_unchanged_details_changes_nothing() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    let error = update(
        guest_repo(GuestPolicy::default()),
        provider,
        CalendarEventPatch {
            title: Some("Planning".to_string()),
            ..CalendarEventPatch::default()
        },
        CalendarUpdateScope::All,
    )
    .await
    .unwrap_err();

    assert!(
        matches!(&error, CalendarMutationError::InvalidInput(message) if message == "the patch changes nothing"),
        "{error:?}"
    );
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_refused_detail_change_invites_nobody() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    let error = update(
        guest_repo(GuestPolicy::default()),
        provider,
        CalendarEventPatch {
            title: Some("Retro".to_string()),
            attendees: Some(vec![
                CalendarAttendeeInput {
                    email: ORGANIZER.to_string(),
                    is_optional: false,
                    response_status: None,
                },
                CalendarAttendeeInput {
                    email: "ada@example.com".to_string(),
                    is_optional: false,
                    response_status: None,
                },
            ]),
            ..CalendarEventPatch::default()
        },
        CalendarUpdateScope::All,
    )
    .await
    .unwrap_err();

    assert!(matches!(error, CalendarMutationError::GuestsCannotModify));
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_guest_the_organizer_lets_modify_changes_details() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let patches = provider.updated_patches.clone();
    let repo = guest_repo(CAN_MODIFY);
    let details_requests = repo.details_requests.clone();

    update(
        repo,
        provider,
        CalendarEventPatch {
            title: Some("Retro".to_string()),
            ..CalendarEventPatch::default()
        },
        CalendarUpdateScope::All,
    )
    .await
    .unwrap();

    assert_eq!(patches.lock().unwrap()[0].title.as_deref(), Some("Retro"));
    assert!(details_requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_organizer_changes_details_whatever_the_guest_policy() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let patches = provider.updated_patches.clone();
    let mut repo = guest_repo(GuestPolicy::default());
    repo.mutation_target.as_mut().unwrap().organizer_email = Some("self@example.com".to_string());

    update(
        repo,
        provider,
        CalendarEventPatch {
            title: Some("Retro".to_string()),
            ..CalendarEventPatch::default()
        },
        CalendarUpdateScope::All,
    )
    .await
    .unwrap();

    assert_eq!(patches.lock().unwrap()[0].title.as_deref(), Some("Retro"));
}

#[tokio::test]
async fn someone_neither_organizing_nor_invited_is_left_to_their_calendar_access() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let patches = provider.updated_patches.clone();
    let mut repo = guest_repo(GuestPolicy::default());
    // A delegate writing to the organizer's calendar holds no seat of their own.
    repo.stored_attendees
        .retain(|attendee| attendee.is_organizer);

    update(
        repo,
        provider,
        CalendarEventPatch {
            title: Some("Retro".to_string()),
            ..CalendarEventPatch::default()
        },
        CalendarUpdateScope::All,
    )
    .await
    .unwrap();

    assert_eq!(patches.lock().unwrap()[0].title.as_deref(), Some("Retro"));
}

#[tokio::test]
async fn an_occurrence_scoped_update_is_compared_with_that_occurrence() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let patches = provider.updated_patches.clone();
    let mut repo = guest_repo(GuestPolicy::default());
    let moved_starts_at = Utc.with_ymd_and_hms(2026, 8, 6, 16, 0, 0).unwrap();
    let moved = EventTime::Timed {
        starts_at: moved_starts_at,
        ends_at: moved_starts_at + Duration::hours(1),
        time_zone: None,
    };
    repo.event_details = Some(EventDetails {
        title: "Planning (moved)".to_string(),
        time: Some(moved.clone()),
        ..stored_details()
    });
    let details_requests = repo.details_requests.clone();

    update(
        repo,
        provider,
        CalendarEventPatch {
            title: Some("Planning (moved)".to_string()),
            time: Some(moved),
            reminders: Some(popup_reminders()),
            ..CalendarEventPatch::default()
        },
        CalendarUpdateScope::ThisEvent {
            recurrence_id: RECURRENCE_ID.to_string(),
        },
    )
    .await
    .unwrap();

    assert_eq!(
        details_requests.lock().unwrap().as_slice(),
        [Some(RECURRENCE_ID.to_string())]
    );
    assert_eq!(
        patches.lock().unwrap().as_slice(),
        [CalendarEventPatch {
            reminders: Some(popup_reminders()),
            ..CalendarEventPatch::default()
        }]
    );
}

#[tokio::test]
async fn an_occurrence_time_that_is_not_stored_counts_as_a_change() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();
    let mut repo = guest_repo(GuestPolicy::default());
    repo.event_details = Some(EventDetails {
        time: None,
        ..stored_details()
    });

    let error = update(
        repo,
        provider,
        CalendarEventPatch {
            time: Some(timed_time()),
            ..CalendarEventPatch::default()
        },
        CalendarUpdateScope::ThisEvent {
            recurrence_id: RECURRENCE_ID.to_string(),
        },
    )
    .await
    .unwrap_err();

    assert!(matches!(error, CalendarMutationError::GuestsCannotModify));
    assert!(calls.lock().unwrap().is_empty());
}
