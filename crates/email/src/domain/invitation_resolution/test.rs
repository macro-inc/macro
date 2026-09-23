use super::*;
use crate::domain::calendar_invitation_parser::parse_invitation_parts;

fn invite(method: &str, occurrence: &str, sequence: u32) -> CalendarInvitation {
    let bytes = format!(
        "BEGIN:VCALENDAR\nMETHOD:{method}\nBEGIN:VEVENT\nUID:series\nORGANIZER:mailto:alex@example.com\nSEQUENCE:{sequence}\nRECURRENCE-ID{occurrence}\nEND:VEVENT\nEND:VCALENDAR\n"
    );
    parse_invitation_parts(&[bytes.as_bytes()])
        .invitations
        .remove(0)
}
#[test]
fn recurrence_revisions_use_original_instant_not_property_spelling() {
    let request = invite("REQUEST", ";TZID=America/Los_Angeles:20260924T100000", 1);
    let cancel = invite("CANCEL", ":20260924T170000Z", 2);
    assert!(same_occurrence(&request, &cancel));
    assert!(applicable_revision(&cancel, &request));
    let another = invite("CANCEL", ":20260925T170000Z", 3);
    assert!(!applicable_revision(&another, &request));
    let floating = invite("CANCEL", ":20260924T100000", 3);
    assert!(!applicable_revision(&floating, &request));
}

#[test]
fn master_cancellations_and_requests_keep_their_own_revision_stream() {
    let link = Uuid::now_v7();
    let request = invite("REQUEST", ":20260924T170000Z", 8);
    let mut master = request.clone();
    master.recurrence_id = None;
    master.recurrence_id_raw = None;
    master.sequence = 1;
    let mut cancel = master.clone();
    cancel.method = InvitationMethod::Cancel;
    cancel.sequence = 2;
    let mut impostor = cancel.clone();
    impostor.organizer.as_mut().unwrap().email = "other@example.com".into();
    impostor.sequence = 99;
    let identity = invitation_identity(
        Uuid::now_v7(),
        link,
        &request,
        &[
            (link, master),
            (link, cancel),
            (link, impostor),
            (link, invite("CANCEL", ":20260925T170000Z", 9)),
        ],
    );
    assert_eq!(identity.sequence, 8);
    assert!(!identity.cancelled);
    assert_eq!(identity.series_revisions.len(), 2);
    assert!(
        identity
            .series_revisions
            .iter()
            .any(|revision| revision.cancelled && revision.sequence == 2)
    );
    assert!(identity.related_revisions.is_empty());
}

#[test]
fn cancellation_with_missing_or_invalid_stamp_survives_a_timestamped_request() {
    let link = Uuid::now_v7();
    let mut request = invite("REQUEST", ":20260924T170000Z", 2);
    request.dtstamp = Some("20260924T170000Z".into());
    for dtstamp in [None, Some("invalid".into())] {
        let mut cancel = request.clone();
        cancel.method = InvitationMethod::Cancel;
        cancel.dtstamp = dtstamp;
        for revisions in [
            vec![(link, request.clone()), (link, cancel.clone())],
            vec![(link, cancel.clone()), (link, request.clone())],
        ] {
            let identity = invitation_identity(Uuid::now_v7(), link, &request, &revisions);
            assert!(identity.cancelled);
        }
        cancel.method = InvitationMethod::Request;
        cancel.status = Some("CANCELLED".into());
        assert!(invitation_identity(Uuid::now_v7(), link, &request, &[(link, cancel)]).cancelled);
    }
}
