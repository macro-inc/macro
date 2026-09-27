use super::*;
use crate::domain::calendar_invitation_parser::parse_invitation_parts;

const LINK: Uuid = uuid::uuid!("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

fn invite(method: &str, occurrence: &str, sequence: u32) -> CalendarInvitation {
    let bytes = format!(
        "BEGIN:VCALENDAR\nMETHOD:{method}\nBEGIN:VEVENT\nUID:series\nORGANIZER:mailto:alex@example.com\nSEQUENCE:{sequence}\nRECURRENCE-ID{occurrence}\nEND:VEVENT\nEND:VCALENDAR\n"
    );
    parse_invitation_parts(&[bytes.as_bytes()]).remove(0)
}
fn saved(invitation: CalendarInvitation) -> ThreadInvitation {
    ThreadInvitation {
        message_id: Uuid::now_v7(),
        link_id: LINK,
        invitation,
    }
}
fn identity(invite: &CalendarInvitation, thread: Vec<CalendarInvitation>) -> InvitationIdentity {
    let thread = thread.into_iter().map(saved).collect::<Vec<_>>();
    invitation_identity(&saved(invite.clone()), &thread)
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
    let identity = identity(
        &request,
        vec![
            master,
            cancel,
            impostor,
            invite("CANCEL", ":20260925T170000Z", 9),
        ],
    );
    assert_eq!(identity.revision.sequence, 8);
    assert!(!identity.revision.cancelled);
    let series = identity.series_revision.unwrap();
    assert!(series.cancelled && series.sequence == 2);
}

#[test]
fn cancellation_with_missing_or_invalid_stamp_survives_a_timestamped_request() {
    let mut request = invite("REQUEST", ":20260924T170000Z", 2);
    request.dtstamp = Some("20260924T170000Z".into());
    for dtstamp in [None, Some("invalid".into())] {
        let mut cancel = request.clone();
        cancel.method = InvitationMethod::Cancel;
        cancel.dtstamp = dtstamp;
        for thread in [
            vec![request.clone(), cancel.clone()],
            vec![cancel.clone(), request.clone()],
        ] {
            assert!(identity(&request, thread).revision.cancelled);
        }
        cancel.method = InvitationMethod::Request;
        cancel.status = Some("CANCELLED".into());
        assert!(identity(&request, vec![cancel]).revision.cancelled);
    }
}
