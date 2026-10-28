use super::*;

fn revision(sequence: u32, hour: Option<i64>, cancelled: bool) -> InvitationRevision {
    let stamp = chrono::DateTime::parse_from_rfc3339("2026-09-24T17:00:00Z")
        .unwrap()
        .to_utc();
    InvitationRevision {
        sequence,
        last_modified: hour.map(|hour| stamp + chrono::Duration::hours(hour)),
        cancelled,
    }
}

#[test]
fn undated_cancellations_survive_timestamped_requests() {
    let request = revision(2, Some(0), false);
    assert!(revision(2, None, true).ordering_key() > request.ordering_key());
    assert!(request.ordering_key() > revision(2, Some(-1), true).ordering_key());
    assert!(revision(3, Some(-1), false).ordering_key() > revision(2, None, true).ordering_key());
}

#[test]
fn a_series_cancellation_cancels_its_instances() {
    let mut identity = InvitationIdentity {
        uid: "series".into(),
        preferred_link_id: Uuid::now_v7(),
        occurrence_key: Some("2026-09-24T17:00:00Z".into()),
        unresolved_instance: false,
        revision: revision(8, None, false),
        series_revision: None,
        organizer_email: None,
    };
    assert!(!identity.is_cancelled());
    identity.series_revision = Some(revision(2, None, true));
    assert!(identity.is_cancelled());
}
