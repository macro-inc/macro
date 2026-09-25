use super::*;
use crate::domain::ports::CallRepository;
use chrono::{Duration, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const OWNER: &str = "macro|user-b@test.com";
const PARTICIPANT_EMAIL: &str = "user-c@test.com";
const UNRELATED: &str = "macro|user-d@test.com";

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
