use super::*;
use crate::domain::ports::CallRepository;
use chrono::{Duration, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const OWNER: &str = "macro|user-b@test.com";
const PARTICIPANT_EMAIL: &str = "user-c@test.com";
const UNRELATED: &str = "macro|user-d@test.com";

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn room_preparations_are_owner_bound_and_consumed_once(pool: PgPool) {
    let repo = repo(pool).await;
    let meeting = repo.create_meeting(meeting()).await.unwrap();
    let preparation = crate::domain::meetings::MeetingPreparation {
        id: Uuid::now_v7(),
        expires_at: Utc::now() + Duration::minutes(5),
    };
    repo.insert_meeting_preparation(OWNER, &preparation)
        .await
        .unwrap();
    repo.claim_meeting_preparation(&preparation.id, UNRELATED, &meeting.id)
        .await
        .unwrap();
    assert!(
        repo.get_meeting_preparation(&meeting.id)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        !repo
            .cancel_meeting_preparation(&preparation.id, UNRELATED)
            .await
            .unwrap()
    );
    repo.claim_meeting_preparation(&preparation.id, OWNER, &meeting.id)
        .await
        .unwrap();
    assert_eq!(
        repo.get_meeting_preparation(&meeting.id)
            .await
            .unwrap()
            .unwrap()
            .id,
        preparation.id
    );
    assert!(
        !repo
            .cancel_meeting_preparation(&preparation.id, OWNER)
            .await
            .unwrap()
    );
    let (call, created) = repo
        .get_or_create_meeting_call(&meeting.id, &preparation.id)
        .await
        .unwrap();
    assert!(created);
    assert_eq!(call.id, preparation.id);
    assert!(
        repo.get_meeting_preparation(&meeting.id)
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn cancellation_racing_claim_never_deletes_a_claimed_room(pool: PgPool) {
    let repo = repo(pool).await;
    for _ in 0..10 {
        let meeting = repo.create_meeting(meeting()).await.unwrap();
        let preparation = crate::domain::meetings::MeetingPreparation {
            id: Uuid::now_v7(),
            expires_at: Utc::now() + Duration::minutes(5),
        };
        repo.insert_meeting_preparation(OWNER, &preparation)
            .await
            .unwrap();
        let (claim, cancel) = tokio::join!(
            repo.claim_meeting_preparation(&preparation.id, OWNER, &meeting.id),
            repo.cancel_meeting_preparation(&preparation.id, OWNER),
        );
        claim.unwrap();
        assert_eq!(
            repo.get_meeting_preparation(&meeting.id)
                .await
                .unwrap()
                .is_some(),
            !cancel.unwrap()
        );
    }
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn expired_preparation_is_not_claimed(pool: PgPool) {
    let repo = repo(pool).await;
    let meeting = repo.create_meeting(meeting()).await.unwrap();
    let preparation = crate::domain::meetings::MeetingPreparation {
        id: Uuid::now_v7(),
        expires_at: Utc::now() - Duration::seconds(1),
    };
    repo.insert_meeting_preparation(OWNER, &preparation)
        .await
        .unwrap();
    repo.claim_meeting_preparation(&preparation.id, OWNER, &meeting.id)
        .await
        .unwrap();
    assert!(
        repo.get_meeting_preparation(&meeting.id)
            .await
            .unwrap()
            .is_none()
    );
}

async fn repo(pool: PgPool) -> PgCallRepo {
    for user in [
        MacroUserIdStr::parse_from_str(OWNER).unwrap(),
        MacroUserIdStr::try_from_email(PARTICIPANT_EMAIL).unwrap(),
    ] {
        crate::outbound::pg_call_repo::test::insert_user_mapping(&pool, &user, Uuid::now_v7())
            .await
            .unwrap();
    }
    PgCallRepo::new(pool)
}

fn meeting() -> Meeting {
    Meeting {
        id: Uuid::now_v7(),
        share_token: MeetingToken::generate(),
        title: "Quick call".to_string(),
        scheduled_start: None,
        scheduled_end: None,
        channel_id: None,
        channel_call_id: None,
        call_id: None,
        user_id: OWNER.to_string(),
    }
}

async fn start_with_guest(repo: &PgCallRepo, meeting: Meeting) -> (Meeting, Uuid, GuestId) {
    let meeting = repo.create_meeting(meeting).await.unwrap();
    let (call, _) = repo
        .get_or_create_meeting_call(&meeting.id, &Uuid::now_v7())
        .await
        .unwrap();
    let guest = GuestId::generate();
    repo.add_guest(&call.id, guest, "Guest").await.unwrap();
    (meeting, call.id, guest)
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn active_meetings_include_owner_and_same_session_attendee_only(pool: PgPool) {
    let repo = repo(pool).await;
    let (meeting, call_id, _) = start_with_guest(&repo, meeting()).await;
    let participant = MacroUserIdStr::try_from_email(PARTICIPANT_EMAIL).unwrap();

    // A guest can keep the owner's call live before the owner joins.
    let owned = repo.list_active_meetings(OWNER).await.unwrap();
    assert_eq!(owned.len(), 1);
    assert_eq!(owned[0].id, meeting.id);
    assert_eq!(owned[0].call_id, Some(call_id));
    assert_eq!(owned[0].share_token.as_str(), meeting.share_token.as_str());
    assert!(
        repo.list_active_meetings(UNRELATED)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        repo.list_active_meetings(participant.as_ref())
            .await
            .unwrap()
            .is_empty()
    );

    repo.add_meeting_participant(&call_id, participant.clone())
        .await
        .unwrap();
    let joined = repo
        .list_active_meetings(participant.as_ref())
        .await
        .unwrap();
    assert_eq!(joined.len(), 1);
    assert_eq!(joined[0].id, meeting.id);
    repo.remove_participant(&call_id, participant.clone())
        .await
        .unwrap();
    let rejoinable = repo
        .list_active_meetings(participant.as_ref())
        .await
        .unwrap();
    assert_eq!(rejoinable.len(), 1);
    assert_eq!(rejoinable[0].id, meeting.id);

    // The management list remains owner-only for the same attendee.
    assert!(
        repo.list_meetings(participant.as_ref())
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(repo.list_meetings(OWNER).await.unwrap().len(), 1);
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn active_meetings_exclude_empty_cancelled_scheduled_and_channel_calls(pool: PgPool) {
    let repo = repo(pool).await;
    let (quick, call_id, guest) = start_with_guest(&repo, meeting()).await;

    repo.create_meeting(meeting()).await.unwrap();
    let empty = repo.create_meeting(meeting()).await.unwrap();
    repo.get_or_create_meeting_call(&empty.id, &Uuid::now_v7())
        .await
        .unwrap();

    let (cancelled, _, _) = start_with_guest(&repo, meeting()).await;
    repo.cancel_meeting(&cancelled.id, OWNER).await.unwrap();

    let mut scheduled = meeting();
    scheduled.scheduled_start = Some(Utc::now());
    scheduled.scheduled_end = Some(Utc::now() + Duration::hours(1));
    start_with_guest(&repo, scheduled).await;

    let mut channel = meeting();
    channel.channel_id = Some(Uuid::from_u128(0xc01));
    channel.channel_call_id = Some(Uuid::from_u128(0xca110));
    channel.call_id = channel.channel_call_id;
    repo.create_meeting(channel).await.unwrap();

    let active = repo.list_active_meetings(OWNER).await.unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].id, quick.id);

    // A persisted room awaiting the sweeper is no longer active when empty.
    repo.reconcile_guest(&call_id, guest, false).await.unwrap();
    assert!(repo.list_active_meetings(OWNER).await.unwrap().is_empty());

    // Signed-in occupancy also counts when every guest has left.
    let participant = MacroUserIdStr::try_from_email(PARTICIPANT_EMAIL).unwrap();
    repo.add_meeting_participant(&call_id, participant.clone())
        .await
        .unwrap();
    assert_eq!(repo.list_active_meetings(OWNER).await.unwrap().len(), 1);
    repo.remove_participant(&call_id, participant)
        .await
        .unwrap();
    assert!(repo.list_active_meetings(OWNER).await.unwrap().is_empty());
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn active_meetings_do_not_grant_discovery_from_an_earlier_session(pool: PgPool) {
    let repo = repo(pool).await;
    let (meeting, call_id, guest) = start_with_guest(&repo, meeting()).await;
    let participant = MacroUserIdStr::try_from_email(PARTICIPANT_EMAIL).unwrap();
    repo.add_meeting_participant(&call_id, participant.clone())
        .await
        .unwrap();
    repo.remove_participant(&call_id, participant.clone())
        .await
        .unwrap();
    repo.reconcile_guest(&call_id, guest, false).await.unwrap();
    repo.archive_call(&call_id).await.unwrap();
    assert!(repo.list_active_meetings(OWNER).await.unwrap().is_empty());

    let (next, _) = repo
        .get_or_create_meeting_call(&meeting.id, &Uuid::now_v7())
        .await
        .unwrap();
    repo.add_guest(&next.id, GuestId::generate(), "Next guest")
        .await
        .unwrap();
    assert_ne!(next.id, call_id);
    assert_eq!(repo.list_active_meetings(OWNER).await.unwrap().len(), 1);
    assert!(
        repo.list_active_meetings(participant.as_ref())
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn invitees_discover_only_the_invited_session_without_becoming_participants(pool: PgPool) {
    let repo = repo(pool.clone()).await;
    let (meeting, call_id, guest) = start_with_guest(&repo, meeting()).await;
    let invitee = MacroUserIdStr::try_from_email(PARTICIPANT_EMAIL).unwrap();
    for _ in 0..2 {
        repo.add_meeting_invitees(&meeting.id, &call_id, std::slice::from_ref(&invitee))
            .await
            .unwrap();
    }
    let visible = repo.list_active_meetings(invitee.as_ref()).await.unwrap();
    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].id, meeting.id);
    assert_eq!(visible[0].call_id, Some(call_id));
    assert!(repo.get_participants(&call_id).await.unwrap().is_empty());
    assert!(
        repo.find_active_call_for_user(invitee.clone())
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        repo.list_meetings(invitee.as_ref())
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        repo.list_active_meetings(UNRELATED)
            .await
            .unwrap()
            .is_empty()
    );

    repo.reconcile_guest(&call_id, guest, false).await.unwrap();
    repo.archive_call(&call_id).await.unwrap();
    assert!(
        repo.list_active_meetings(invitee.as_ref())
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM call_invitees WHERE call_id = $1",
            call_id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(0)
    );
    let (next, _) = repo
        .get_or_create_meeting_call(&meeting.id, &Uuid::now_v7())
        .await
        .unwrap();
    repo.add_guest(&next.id, GuestId::generate(), "Next guest")
        .await
        .unwrap();
    assert!(
        repo.list_active_meetings(invitee.as_ref())
            .await
            .unwrap()
            .is_empty()
    );
    assert!(matches!(
        repo.add_meeting_invitees(&meeting.id, &call_id, std::slice::from_ref(&invitee))
            .await,
        Err(CallError::NotFound(_))
    ));
    assert!(matches!(
        repo.add_meeting_invitees(&Uuid::now_v7(), &next.id, std::slice::from_ref(&invitee))
            .await,
        Err(CallError::NotFound(_))
    ));
    assert!(
        repo.list_active_meetings(invitee.as_ref())
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn invitations_do_not_make_empty_cancelled_or_scheduled_calls_live(pool: PgPool) {
    let repo = repo(pool).await;
    let invitee = MacroUserIdStr::try_from_email(PARTICIPANT_EMAIL).unwrap();
    let (quick, quick_call_id, guest) = start_with_guest(&repo, meeting()).await;
    let (empty, empty_call_id, empty_guest) = start_with_guest(&repo, meeting()).await;
    repo.reconcile_guest(&empty_call_id, empty_guest, false)
        .await
        .unwrap();
    let (cancelled, cancelled_call_id, _) = start_with_guest(&repo, meeting()).await;
    let mut scheduled = meeting();
    scheduled.scheduled_start = Some(Utc::now());
    scheduled.scheduled_end = Some(Utc::now() + Duration::hours(1));
    let (scheduled, scheduled_call_id, _) = start_with_guest(&repo, scheduled).await;
    for (meeting_id, call_id) in [
        (quick.id, quick_call_id),
        (empty.id, empty_call_id),
        (cancelled.id, cancelled_call_id),
        (scheduled.id, scheduled_call_id),
    ] {
        repo.add_meeting_invitees(&meeting_id, &call_id, std::slice::from_ref(&invitee))
            .await
            .unwrap();
    }
    repo.cancel_meeting(&cancelled.id, OWNER).await.unwrap();
    assert!(matches!(
        repo.add_meeting_invitees(
            &cancelled.id,
            &cancelled_call_id,
            std::slice::from_ref(&invitee)
        )
        .await,
        Err(CallError::NotFound(_))
    ));
    let visible = repo.list_active_meetings(invitee.as_ref()).await.unwrap();
    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].id, quick.id);
    repo.reconcile_guest(&quick_call_id, guest, false)
        .await
        .unwrap();
    assert!(
        repo.list_active_meetings(invitee.as_ref())
            .await
            .unwrap()
            .is_empty()
    );
}

fn attendance_event(
    call_id: Uuid,
    participant_sid: &str,
    user_id: Option<&str>,
    joined_at: chrono::DateTime<Utc>,
    left_at: Option<chrono::DateTime<Utc>>,
) -> crate::domain::models::CallWebhookEvent {
    crate::domain::models::CallWebhookEvent {
        event: if left_at.is_some() {
            "participant_left"
        } else {
            "participant_joined"
        }
        .into(),
        id: "attendance-event".into(),
        room_name: Some(call_id.to_string()),
        participant_identity: user_id.map(|id| MacroUserIdStr::try_from(id.to_owned()).unwrap()),
        guest_identity: user_id.is_none().then(GuestId::generate),
        bot_identity: None,
        egress_id: None,
        file_url: None,
        created_at: left_at.unwrap_or(joined_at).timestamp(),
        attendance: Some(crate::domain::attendance::RtcAttendance {
            participant_sid: participant_sid.into(),
            joined_at,
            left_at,
        }),
    }
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn rtc_attendance_requires_finished_tracked_sessions_and_survives_archival(pool: PgPool) {
    use crate::domain::attendance::{MeetingAttendanceReader, MeetingAttendanceRequest};
    use crate::outbound::meeting_attendance::PgMeetingAttendanceReader;
    let repo = repo(pool.clone()).await;
    let meeting = repo.create_meeting(meeting()).await.unwrap();
    let (call, _) = repo
        .get_or_create_meeting_call(&meeting.id, &Uuid::now_v7())
        .await
        .unwrap();
    let start: chrono::DateTime<Utc> = "2026-11-01T10:00:00Z".parse().unwrap();
    let end = start + Duration::minutes(30);
    sqlx::query!(
        "UPDATE calls SET created_at = $2 WHERE id = $1",
        call.id,
        start - Duration::minutes(10)
    )
    .execute(&pool)
    .await
    .unwrap();
    let requests = [MeetingAttendanceRequest {
        token: meeting.share_token.clone(),
        starts_at: start,
        ends_at: end,
    }];
    let reader = PgMeetingAttendanceReader::new(pool.clone());
    // Allocating a call and issuing a join token are not proof of connection.
    repo.add_meeting_participant(
        &call.id,
        MacroUserIdStr::try_from_email(PARTICIPANT_EMAIL).unwrap(),
    )
    .await
    .unwrap();
    assert!(reader.read(&requests).await.unwrap()[0].is_none());
    repo.archive_call(&call.id).await.unwrap();
    let empty = reader
        .read(&requests)
        .await
        .unwrap()
        .pop()
        .unwrap()
        .unwrap();
    assert!(empty.user_ids.is_empty());
    assert!(!empty.guest_present);

    let host = attendance_event(
        call.id,
        "PA_host",
        Some(OWNER),
        start - Duration::minutes(5),
        None,
    );
    repo.record_attendance(&host).await.unwrap();
    let guest_left = attendance_event(
        call.id,
        "PA_guest",
        None,
        start + Duration::minutes(5),
        Some(start + Duration::minutes(15)),
    );
    repo.record_attendance(&guest_left).await.unwrap();
    // A delayed join and duplicates cannot erase the already-observed departure.
    let mut guest_joined = guest_left.clone();
    guest_joined.attendance.as_mut().unwrap().left_at = None;
    repo.record_attendance(&guest_joined).await.unwrap();
    repo.record_attendance(&guest_left).await.unwrap();
    let observed = reader
        .read(&requests)
        .await
        .unwrap()
        .pop()
        .unwrap()
        .unwrap();
    assert_eq!(observed.user_ids.len(), 1);
    assert_eq!(observed.user_ids[0].as_ref(), OWNER);
    assert!(observed.guest_present);
    repo.cancel_meeting(&meeting.id, OWNER).await.unwrap();
    assert!(
        reader.read(&requests).await.unwrap()[0]
            .as_ref()
            .unwrap()
            .guest_present
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM call_rtc_attendance WHERE call_id = $1",
            call.id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(2)
    );

    let later = [MeetingAttendanceRequest {
        token: meeting.share_token.clone(),
        starts_at: start + Duration::minutes(16),
        ends_at: end,
    }];
    assert!(
        !reader.read(&later).await.unwrap()[0]
            .as_ref()
            .unwrap()
            .guest_present
    );
    sqlx::query!(
        "UPDATE call_entities SET attendance_tracked = false WHERE id = $1",
        call.id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(reader.read(&requests).await.unwrap()[0].is_none());
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn rtc_attendance_uses_half_open_windows_and_ignores_recreated_archived_rooms(pool: PgPool) {
    use crate::domain::attendance::{MeetingAttendanceReader, MeetingAttendanceRequest};
    use crate::outbound::meeting_attendance::PgMeetingAttendanceReader;
    let repo = repo(pool.clone()).await;
    let meeting = repo.create_meeting(meeting()).await.unwrap();
    let (call, _) = repo
        .get_or_create_meeting_call(&meeting.id, &Uuid::now_v7())
        .await
        .unwrap();
    let start: chrono::DateTime<Utc> = "2026-11-01T10:00:00Z".parse().unwrap();
    let end = start + Duration::minutes(30);
    sqlx::query!(
        "UPDATE calls SET created_at = $2 WHERE id = $1",
        call.id,
        start - Duration::minutes(10)
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.archive_call(&call.id).await.unwrap();
    for (sid, joined, left) in [
        ("PA_before", start - Duration::minutes(5), Some(start)),
        ("PA_after", end, Some(end + Duration::minutes(5))),
        ("PA_recreated", Utc::now() + Duration::days(1), None),
    ] {
        repo.record_attendance(&attendance_event(call.id, sid, None, joined, left))
            .await
            .unwrap();
    }
    let reader = PgMeetingAttendanceReader::new(pool.clone());
    let requests = [MeetingAttendanceRequest {
        token: meeting.share_token.clone(),
        starts_at: start,
        ends_at: end,
    }];
    assert!(
        !reader.read(&requests).await.unwrap()[0]
            .as_ref()
            .unwrap()
            .guest_present
    );
    repo.delete_call_record(&call.id).await.unwrap();
    assert!(reader.read(&requests).await.unwrap()[0].is_none());
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM call_rtc_attendance WHERE call_id = $1",
            call.id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(0)
    );
}
