use super::*;

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
    assert_eq!(
        GuestId::parse_rtc_identity(&guest.to_string()),
        Some(guest)
    );
    assert!(GuestId::parse_rtc_identity("macro|a@b.com").is_none());
    assert!(GuestId::parse_rtc_identity("agent-transcriber").is_none());
    assert!(GuestId::parse_rtc_identity("guest:admin").is_none());
}

#[test]
fn scheduled_meetings_require_ordered_complete_times() {
    let start = Utc::now();
    let end = start + chrono::Duration::hours(1);
    let request = |scheduled_start, scheduled_end| CreateMeetingRequest {
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
