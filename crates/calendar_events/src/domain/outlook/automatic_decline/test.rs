use super::*;
use chrono::Duration;
fn occurrence() -> AwayOccurrence {
    let start = Utc::now() + Duration::days(1);
    AwayOccurrence {
        provider_id: "meeting".into(),
        starts_at: start,
        ends_at: start + Duration::hours(1),
        created_at: start - Duration::days(10),
        is_organizer: false,
        cancelled: false,
        response: AttendeeResponseStatus::NeedsAction,
        policy: None,
    }
}
fn away(invitation: &AwayOccurrence, mode: OutOfOfficeAutoDeclineMode) -> AwayOccurrence {
    let mut away = invitation.clone();
    away.provider_id = "away".into();
    away.is_organizer = true;
    away.policy = Some(AutomaticDeclinePolicy {
        id: Uuid::now_v7(),
        enabled_at: Utc::now(),
        properties: OutOfOfficeProperties {
            auto_decline_mode: mode,
            decline_message: Some("I'm away".into()),
        },
    });
    away
}
#[test]
fn new_only_excludes_existing_invitations_but_all_conflicts_includes_them() {
    let mut invitation = occurrence();
    let away = away(
        &invitation,
        OutOfOfficeAutoDeclineMode::DeclineOnlyNewConflictingInvitations,
    );
    assert!(!should_decline(&away, &invitation, Utc::now()));
    invitation.created_at = Utc::now();
    assert!(should_decline(&away, &invitation, Utc::now()));
    let mut all = away.clone();
    all.policy.as_mut().unwrap().properties.auto_decline_mode =
        OutOfOfficeAutoDeclineMode::DeclineAllConflictingInvitations;
    invitation.created_at -= Duration::days(10);
    assert!(should_decline(&all, &invitation, Utc::now()));
}
#[test]
fn only_live_conflicts_owned_by_the_policy_author_are_declined() {
    let invitation = occurrence();
    let away = away(
        &invitation,
        OutOfOfficeAutoDeclineMode::DeclineAllConflictingInvitations,
    );
    assert!(should_decline(&away, &invitation, Utc::now()));
    let mut cases = vec![];
    let mut owned = invitation.clone();
    owned.is_organizer = true;
    cases.push(owned);
    let mut cancelled = invitation.clone();
    cancelled.cancelled = true;
    cases.push(cancelled);
    let mut declined = invitation.clone();
    declined.response = AttendeeResponseStatus::Declined;
    cases.push(declined);
    let mut adjoining = invitation.clone();
    adjoining.starts_at = away.ends_at;
    cases.push(adjoining);
    let mut past = invitation.clone();
    past.ends_at = Utc::now() - Duration::seconds(1);
    cases.push(past);
    for candidate in cases {
        assert!(!should_decline(&away, &candidate, Utc::now()));
    }
    let mut cancelled_away = away.clone();
    cancelled_away.cancelled = true;
    assert!(!should_decline(&cancelled_away, &invitation, Utc::now()));
    let mut foreign_away = away.clone();
    foreign_away.is_organizer = false;
    assert!(!should_decline(&foreign_away, &invitation, Utc::now()));
    let mut disabled = away.clone();
    disabled
        .policy
        .as_mut()
        .unwrap()
        .properties
        .auto_decline_mode = OutOfOfficeAutoDeclineMode::DeclineNone;
    assert!(!should_decline(&disabled, &invitation, Utc::now()));
}
