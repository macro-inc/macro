use super::*;

#[test]
fn teammate_invitations_reject_bot_and_invalid_principals() {
    for recipient in [
        "bot|00000000-0000-0000-0000-00000000a1a1",
        "00000000-0000-0000-0000-00000000a1a1",
        "teammate@example.com",
        "invalid",
    ] {
        assert!(
            serde_json::from_value::<InviteMeetingUsersRequest>(serde_json::json!({
                "userIds": [recipient]
            }))
            .is_err()
        );
    }
}

#[test]
fn teammate_invitation_batches_are_bounded_distinct_and_exclude_self() {
    let actor = MacroUserIdStr::try_from_email("owner@example.com").unwrap();
    let teammate = MacroUserIdStr::try_from_email("teammate@example.com").unwrap();
    let request = |user_ids| InviteMeetingUsersRequest { user_ids };
    assert!(request(vec![]).recipients(&actor).is_err());
    assert!(request(vec![actor.clone()]).recipients(&actor).is_err());
    assert!(
        request(vec![teammate.clone(); 51])
            .recipients(&actor)
            .is_err()
    );
    assert_eq!(
        request(vec![actor.clone(), teammate.clone(), teammate.clone()])
            .recipients(&actor)
            .unwrap(),
        vec![teammate]
    );
}

#[test]
fn capabilities_are_random_valid_and_redacted() {
    let first = MeetingToken::generate();
    let second = MeetingToken::generate();
    assert_ne!(first.as_str(), second.as_str());
    assert_eq!(first.as_str().len(), 64);
    assert!(MeetingToken::try_from(first.as_str().to_string()).is_ok());
    assert!(!format!("{first:?}").contains(first.as_str()));
    assert!(MeetingToken::try_from("a".repeat(63)).is_err());
    assert!(MeetingToken::try_from("z".repeat(64)).is_err());
}

#[test]
fn guest_names_are_bounded_normalized_and_not_identities() {
    assert_eq!(
        GuestJoinRequest {
            display_name: "  Ada  ".to_string()
        }
        .validate()
        .unwrap(),
        "Ada"
    );
    for name in [
        "".to_string(),
        "   ".to_string(),
        "a\nb".to_string(),
        "a".repeat(81),
    ] {
        assert!(GuestJoinRequest { display_name: name }.validate().is_err());
    }
    let guest = GuestId::generate();
    assert_eq!(GuestId::parse_rtc_identity(&guest.to_string()), Some(guest));
    assert!(GuestId::parse_rtc_identity("macro|a@b.com").is_none());
    assert!(GuestId::parse_rtc_identity("agent-transcriber").is_none());
    assert!(GuestId::parse_rtc_identity("guest:admin").is_none());
}

#[test]
fn scheduled_meetings_require_ordered_complete_times() {
    let start = Utc::now();
    let end = start + chrono::Duration::hours(1);
    let request = |scheduled_start, scheduled_end| CreateMeetingRequest {
        preparation_id: None,
        title: None,
        scheduled_start,
        scheduled_end,
    };
    assert!(request(None, None).validate().is_ok());
    assert!(request(Some(start), Some(end)).validate().is_ok());
    assert!(request(Some(start), None).validate().is_err());
    assert!(request(Some(end), Some(start)).validate().is_err());
    assert!(request(Some(start), Some(start)).validate().is_err());
}

#[test]
fn clearing_schedule_is_explicit_and_cannot_conflict_with_new_times() {
    assert!(
        UpdateMeetingRequest {
            title: None,
            scheduled_start: None,
            scheduled_end: None,
            clear_schedule: true
        }
        .validate()
        .is_ok()
    );
    assert!(
        UpdateMeetingRequest {
            title: None,
            scheduled_start: Some(Utc::now()),
            scheduled_end: None,
            clear_schedule: true
        }
        .validate()
        .is_err()
    );
}

fn scheduled_meeting(start: DateTime<Utc>, end: DateTime<Utc>) -> Meeting {
    Meeting {
        id: Uuid::from_u128(1),
        share_token: MeetingToken::generate(),
        title: "Weekly review".to_string(),
        scheduled_start: Some(start),
        scheduled_end: Some(end),
        channel_id: None,
        call_id: None,
        user_id: "macro|owner@example.com".to_string(),
        channel_call_id: None,
    }
}

#[test]
fn a_scheduled_meeting_resumes_a_call_that_ended_inside_its_slot_until_its_end() {
    let start = DateTime::parse_from_rfc3339("2026-11-22T10:00:00Z")
        .unwrap()
        .to_utc();
    let end = start + TimeDelta::hours(1);
    let meeting = scheduled_meeting(start, end);
    let minutes = TimeDelta::minutes;

    // Rejoined mid-meeting after a session that ended during it.
    assert!(meeting.resumes_call(start + minutes(20), start + minutes(25)));
    // A session that ended in the early-join window belongs to the slot.
    assert!(meeting.resumes_call(start - minutes(15), start + minutes(1)));
    // At or after the scheduled end a join starts a new call.
    assert!(!meeting.resumes_call(start + minutes(50), end));
    assert!(!meeting.resumes_call(start + minutes(50), end + minutes(5)));
    // A session that ended before the slot opened is a separate call.
    assert!(!meeting.resumes_call(start - minutes(16), start + minutes(1)));
    assert!(!meeting.resumes_call(start - TimeDelta::days(7), start + minutes(1)));
}

#[test]
fn instant_meetings_and_channel_links_never_resume() {
    let start = DateTime::parse_from_rfc3339("2026-11-22T10:00:00Z")
        .unwrap()
        .to_utc();
    let during = start + TimeDelta::minutes(10);

    let mut instant = scheduled_meeting(start, start + TimeDelta::hours(1));
    instant.scheduled_start = None;
    instant.scheduled_end = None;
    assert!(!instant.resumes_call(during, during));

    let mut channel_link = scheduled_meeting(start, start + TimeDelta::hours(1));
    channel_link.channel_id = Some(Uuid::from_u128(2));
    channel_link.channel_call_id = Some(Uuid::from_u128(3));
    assert!(!channel_link.resumes_call(during, during));
}
