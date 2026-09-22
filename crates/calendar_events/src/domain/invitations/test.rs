use super::*;

#[test]
fn undated_cancellations_survive_timestamped_requests_in_both_revision_streams() {
    let link = Uuid::now_v7();
    let stamp = chrono::DateTime::parse_from_rfc3339("2026-09-24T17:00:00Z")
        .unwrap()
        .to_utc();
    let request = InvitationRevision {
        link_id: link,
        sequence: 2,
        last_modified: Some(stamp),
        cancelled: false,
    };
    let cancel = InvitationRevision {
        last_modified: None,
        cancelled: true,
        ..request.clone()
    };
    let mut identity = InvitationIdentity {
        id: "snapshot".into(),
        uid: "series".into(),
        preferred_link_id: link,
        occurrence_key: None,
        unresolved_instance: false,
        cancelled: false,
        related_revisions: Vec::new(),
        series_revisions: Vec::new(),
        organizer_email: None,
        last_modified: request.last_modified,
        sequence: request.sequence,
    };
    for revisions in [
        vec![request.clone(), cancel.clone()],
        vec![cancel.clone(), request.clone()],
    ] {
        identity.related_revisions = revisions.clone();
        assert!(identity.effective_revision(Some(link)).cancelled);
        identity.series_revisions = revisions;
        assert!(identity.series_revision(Some(link)).unwrap().cancelled);
        assert!(identity.is_cancelled(Some(link)));
    }
    let newer_request = InvitationRevision {
        sequence: 3,
        ..request.clone()
    };
    identity.related_revisions.push(newer_request.clone());
    identity.series_revisions.push(newer_request);
    identity.series_revisions.reverse();
    assert!(!identity.is_cancelled(Some(link)));

    let dated_cancel = InvitationRevision {
        last_modified: Some(stamp - chrono::Duration::hours(1)),
        ..cancel
    };
    assert!(request.ordering_key() > dated_cancel.ordering_key());
}
