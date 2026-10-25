use super::*;
use crate::domain::ics::{CalendarEventExport, CalendarEventExportAccess};

fn export(access: CalendarEventExportAccess) -> CalendarEventExport {
    CalendarEventExport {
        access,
        owner_id: "macro|organizer@example.com".to_string(),
        event_type: EventType::Default,
        ical_uid: "meeting@example.com".to_string(),
        sequence: 3,
        title: "Shared meeting".to_string(),
        description: Some("Agenda".to_string()),
        location: None,
        time: timed_time(),
        recurrence_lines: vec!["RRULE:FREQ=WEEKLY".to_string()],
        organizer_email: Some("organizer@example.com".to_string()),
        organizer_name: None,
        updated_at: Utc::now(),
    }
}

fn shared_repo() -> FakeRepo {
    FakeRepo {
        export: Some(export(CalendarEventExportAccess::ChannelShared)),
        creation_target: Some(creation_target(false)),
        ..FakeRepo::default()
    }
}

#[tokio::test]
async fn copy_imports_a_channel_shared_event_onto_the_requesters_calendar() {
    let applied_id = Uuid::now_v7();
    let repo = FakeRepo {
        persisted_event_id: Some(applied_id),
        ..shared_repo()
    };
    let upserts = repo.upserts.clone();
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let imported = provider.imported.clone();

    let copied = service(repo, provider, FakeTokens::ok())
        .copy_shared_event("macro|user", Uuid::now_v7(), None)
        .await
        .unwrap();

    assert_eq!(copied.id, applied_id);
    assert_eq!(upserts.lock().unwrap().len(), 1);
    let imported = imported.lock().unwrap();
    assert_eq!(imported.len(), 1);
    assert_eq!(imported[0].0, "primary");
    assert_eq!(imported[0].1.ical_uid, "meeting@example.com");
}

#[tokio::test]
async fn copy_leaves_the_meetings_macro_call_out() {
    let call = "https://macro.com/app/meet/join/0123456789abcdef0123456789abcdef";
    let (description, location) = crate::domain::meeting_links::attach_macro_call(
        Some("<p>Bring the budget draft</p>"),
        None,
        call,
    );
    let repo = FakeRepo {
        export: Some(CalendarEventExport {
            description: Some(description),
            location: Some(location),
            ..export(CalendarEventExportAccess::ChannelShared)
        }),
        ..shared_repo()
    };
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let imported = provider.imported.clone();

    service(repo, provider, FakeTokens::ok())
        .copy_shared_event("macro|user", Uuid::now_v7(), None)
        .await
        .unwrap();

    let imported = imported.lock().unwrap();
    let source = &imported[0].1;
    assert_eq!(
        source.description.as_deref(),
        Some("Bring the budget draft")
    );
    assert_eq!(source.location, None);
}

#[tokio::test]
async fn copy_refuses_before_the_provider_when_the_event_cannot_be_copied() {
    let out_of_office = CalendarEventExport {
        event_type: EventType::OutOfOffice,
        ..export(CalendarEventExportAccess::ChannelShared)
    };
    let outlook = CalendarCreationTarget {
        token_identity: CalendarLinkTokenIdentity {
            provider: crate::domain::models::CalendarProvider::Outlook,
            ..token_identity()
        },
        ..creation_target(false)
    };
    let cases = [
        // Not visible to the requester, or not there at all.
        (
            FakeRepo {
                export: None,
                ..shared_repo()
            },
            "not_found",
        ),
        // Any projection of the meeting already on their calendars.
        (
            FakeRepo {
                export: Some(export(CalendarEventExportAccess::OwnCopy)),
                ..shared_repo()
            },
            "already_on_calendar",
        ),
        (
            FakeRepo {
                export: Some(out_of_office),
                ..shared_repo()
            },
            "invalid_input",
        ),
        (
            FakeRepo {
                creation_target: None,
                ..shared_repo()
            },
            "no_writable_calendar",
        ),
        (
            FakeRepo {
                creation_target: Some(creation_target(true)),
                ..shared_repo()
            },
            "read_only",
        ),
        (
            FakeRepo {
                creation_target: Some(outlook),
                ..shared_repo()
            },
            "invalid_input",
        ),
    ];
    for (repo, expected) in cases {
        let upserts = repo.upserts.clone();
        let provider = FakeProvider::new(FakeProviderBehavior::Echo);
        let calls = provider.calls.clone();

        let result = service(repo, provider, FakeTokens::ok())
            .copy_shared_event("macro|user", Uuid::now_v7(), None)
            .await;

        assert_eq!(super::super::copy::copy_outcome(&result), expected);
        assert!(calls.lock().unwrap().is_empty(), "{expected}");
        assert!(upserts.lock().unwrap().is_empty(), "{expected}");
    }
}

#[tokio::test]
async fn copy_waits_for_the_requesters_join_request_unless_it_was_declined() {
    use crate::domain::join_requests::{CalendarJoinRequest, CalendarJoinRequestStatus};
    let event_id = Uuid::now_v7();
    let cases = [
        (CalendarJoinRequestStatus::Pending, "join_request_open"),
        (CalendarJoinRequestStatus::Accepted, "join_request_open"),
        (CalendarJoinRequestStatus::Declined, "copied"),
    ];
    for (status, expected) in cases {
        let repo = shared_repo();
        repo.join_requests
            .lock()
            .unwrap()
            .push(CalendarJoinRequest {
                id: Uuid::now_v7(),
                event_id,
                requester_id: "macro|user".to_string(),
                requester_email: "user@example.com".to_string(),
                status,
                created_at: Utc::now(),
            });
        let provider = FakeProvider::new(FakeProviderBehavior::Echo);
        let imported = provider.imported.clone();

        let result = service(repo, provider, FakeTokens::ok())
            .copy_shared_event("macro|user", event_id, None)
            .await;

        assert_eq!(super::super::copy::copy_outcome(&result), expected);
        assert_eq!(
            imported.lock().unwrap().len(),
            usize::from(expected == "copied"),
            "{status:?}"
        );
    }
}

#[tokio::test]
async fn copy_ignores_join_requests_for_other_events_and_people() {
    use crate::domain::join_requests::{CalendarJoinRequest, CalendarJoinRequestStatus};
    let repo = shared_repo();
    let event_id = Uuid::now_v7();
    repo.join_requests.lock().unwrap().extend([
        CalendarJoinRequest {
            id: Uuid::now_v7(),
            event_id,
            requester_id: "macro|someone-else".to_string(),
            requester_email: "someone@example.com".to_string(),
            status: CalendarJoinRequestStatus::Pending,
            created_at: Utc::now(),
        },
        CalendarJoinRequest {
            id: Uuid::now_v7(),
            event_id: Uuid::now_v7(),
            requester_id: "macro|user".to_string(),
            requester_email: "user@example.com".to_string(),
            status: CalendarJoinRequestStatus::Pending,
            created_at: Utc::now(),
        },
    ]);

    service(
        repo,
        FakeProvider::new(FakeProviderBehavior::Echo),
        FakeTokens::ok(),
    )
    .copy_shared_event("macro|user", event_id, None)
    .await
    .unwrap();
}

#[tokio::test]
async fn copy_leaves_an_event_the_calendar_already_holds_and_syncs_it_in() {
    let target = creation_target(false);
    let email_link_id = target.email_link_id;
    let repo = FakeRepo {
        creation_target: Some(target),
        ..shared_repo()
    };
    let upserts = repo.upserts.clone();
    let scheduled_syncs = repo.scheduled_syncs.clone();

    let error = service(
        repo,
        FakeProvider::new(FakeProviderBehavior::Gone),
        FakeTokens::ok(),
    )
    .copy_shared_event("macro|user", Uuid::now_v7(), None)
    .await
    .unwrap_err();

    assert!(matches!(error, CalendarMutationError::AlreadyOnCalendar));
    assert!(upserts.lock().unwrap().is_empty());
    assert_eq!(*scheduled_syncs.lock().unwrap(), vec![email_link_id]);
}

#[tokio::test]
async fn copy_reports_a_refused_import_without_persisting_anything() {
    let repo = shared_repo();
    let upserts = repo.upserts.clone();

    let result = service(
        repo,
        FakeProvider::new(FakeProviderBehavior::Forbidden(GuestPolicy::default())),
        FakeTokens::ok(),
    )
    .copy_shared_event("macro|user", Uuid::now_v7(), None)
    .await;

    assert_eq!(super::super::copy::copy_outcome(&result), "copy_refused");
    assert!(matches!(
        result,
        Err(CalendarMutationError::CopyRefused(message))
            if message.contains("participantIsNeitherOrganizerNorAttendee")
    ));
    assert!(upserts.lock().unwrap().is_empty());
}

/// The requester's snapshot of a shared meeting: they are its only guest,
/// already accepted, so Google imported it.
fn snapshot_repo() -> FakeRepo {
    let mut owner = echo_attendee("self@example.com", false);
    owner.response_status = AttendeeResponseStatus::Accepted;
    FakeRepo {
        mutation_target: Some(CalendarEventMutationTarget {
            organizer_email: Some("organizer@example.com".to_string()),
            is_snapshot: true,
            ..mutation_target(false)
        }),
        stored_attendees: vec![owner],
        ..FakeRepo::default()
    }
}

#[tokio::test]
async fn a_snapshot_refuses_answers_and_guests_before_the_provider() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();
    let service = service(snapshot_repo(), provider, FakeTokens::ok());

    let answered = service
        .respond_to_event(
            "macro|user",
            Uuid::now_v7(),
            None,
            AttendeeResponseStatus::Declined,
            CalendarRsvpScope::All,
            None,
        )
        .await;
    let invited = service
        .invite_guests(
            "macro|user",
            Uuid::now_v7(),
            None,
            vec![CalendarAttendeeInput {
                email: "ada@example.com".to_string(),
                is_optional: false,
                response_status: None,
            }],
            CalendarUpdateScope::All,
        )
        .await;
    // The editor's guest list goes through the invite path for anyone who
    // may not remove guests.
    let edited = service
        .update_event(
            "macro|user",
            Uuid::now_v7(),
            None,
            CalendarEventPatch {
                attendees: Some(vec![CalendarAttendeeInput {
                    email: "ada@example.com".to_string(),
                    is_optional: false,
                    response_status: None,
                }]),
                ..CalendarEventPatch::default()
            },
            CalendarUpdateScope::All,
        )
        .await;

    assert!(matches!(answered, Err(CalendarMutationError::Snapshot)));
    assert!(matches!(invited, Err(CalendarMutationError::Snapshot)));
    assert!(matches!(edited, Err(CalendarMutationError::Snapshot)));
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_snapshot_can_still_be_deleted() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    service(snapshot_repo(), provider, FakeTokens::ok())
        .delete_event(
            "macro|user",
            Uuid::now_v7(),
            None,
            CalendarDeletionScope::All,
        )
        .await
        .unwrap();

    assert_eq!(calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_snapshot_keeps_its_details_but_takes_its_owners_reminders() {
    let details = crate::domain::models::EventDetails {
        title: "Shared meeting".to_string(),
        description: None,
        location: None,
        visibility: crate::domain::models::EventVisibility::Default,
        time: Some(timed_time()),
        recurrence_lines: Vec::new(),
        has_conference: false,
    };
    let reminders = EventReminders {
        use_default: false,
        overrides: vec![crate::domain::models::EventReminderOverride {
            method: crate::domain::models::REMINDER_METHOD_POPUP.to_string(),
            minutes: 15,
        }],
    };
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();
    let service = service(
        FakeRepo {
            event_details: Some(details),
            ..snapshot_repo()
        },
        provider,
        FakeTokens::ok(),
    );

    let renamed = service
        .update_event(
            "macro|user",
            Uuid::now_v7(),
            None,
            CalendarEventPatch {
                title: Some("Renamed".to_string()),
                ..CalendarEventPatch::default()
            },
            CalendarUpdateScope::All,
        )
        .await;
    assert!(matches!(
        renamed,
        Err(CalendarMutationError::GuestsCannotModify)
    ));
    assert!(calls.lock().unwrap().is_empty());

    // The editor resends the unchanged title with the owner's reminders.
    service
        .update_event(
            "macro|user",
            Uuid::now_v7(),
            None,
            CalendarEventPatch {
                title: Some("Shared meeting".to_string()),
                reminders: Some(reminders),
                ..CalendarEventPatch::default()
            },
            CalendarUpdateScope::All,
        )
        .await
        .unwrap();
    assert_eq!(calls.lock().unwrap().len(), 1);
}
