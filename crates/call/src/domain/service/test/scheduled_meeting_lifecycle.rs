//! End to end through the call service and the real Postgres repository: how
//! long a meeting link stays one call as people leave and rejoin.

use super::*;
use crate::domain::meetings::CreateMeetingRequest;
use crate::outbound::pg_call_repo::PgCallRepo;
use sqlx::{Pool, Postgres};

const HOST_ID: Uuid = Uuid::from_u128(0x5c4e_d000_0000_0000_0000_0000_0000_00a1);
const GUEST_ID: Uuid = Uuid::from_u128(0x5c4e_d000_0000_0000_0000_0000_0000_00b2);

type LifecycleService = CallServiceImpl<
    PgCallRepo,
    MockRtcClient,
    StubConnectionService,
    NoOpEntityAccessService,
    StubNotificationIngress,
    StubRecordingStorage,
>;

async fn setup(
    pool: &Pool<Postgres>,
) -> anyhow::Result<(
    LifecycleService,
    MacroUserIdStr<'static>,
    MacroUserIdStr<'static>,
)> {
    let host = user("scheduled-host@example.com");
    let guest = user("scheduled-guest@example.com");
    insert_user_mapping(pool, &host, HOST_ID).await?;
    insert_user_mapping(pool, &guest, GUEST_ID).await?;
    let service = CallServiceImpl::new(
        PgCallRepo::new(pool.clone()),
        MockRtcClient::new(),
        StubConnectionService,
        NoOpEntityAccessService,
        StubNotificationIngress,
        StubRecordingStorage,
        "wss://livekit.example.com",
    );
    Ok((service, host, guest))
}

async fn is_live(pool: &Pool<Postgres>, call_id: Uuid) -> anyhow::Result<bool> {
    Ok(sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM calls WHERE id = $1) AS "live!""#,
        call_id
    )
    .fetch_one(pool)
    .await?)
}

async fn call_records_for_meeting(pool: &Pool<Postgres>, meeting_id: Uuid) -> anyhow::Result<i64> {
    Ok(sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM call_records WHERE meeting_id = $1"#,
        meeting_id
    )
    .fetch_one(pool)
    .await?)
}

/// Moves the meeting's slot so it ended an hour ago, and backdates the call
/// past the stale-call sweeper's grace period.
async fn end_slot(pool: &Pool<Postgres>, meeting_id: Uuid, call_id: Uuid) -> anyhow::Result<()> {
    let now = Utc::now();
    sqlx::query!(
        "UPDATE call_meetings SET scheduled_start = $2, scheduled_end = $3 WHERE id = $1",
        meeting_id,
        now - chrono::Duration::hours(2),
        now - chrono::Duration::hours(1)
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "UPDATE calls SET created_at = $2 WHERE id = $1",
        call_id,
        now - chrono::Duration::hours(2)
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn scheduled_meeting_is_one_call_until_its_end(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let (service, host, guest) = setup(&pool).await?;
    let now = Utc::now();
    let meeting = service
        .create_meeting(
            host.copied(),
            CreateMeetingRequest {
                preparation_id: None,
                title: Some("Weekly review".to_string()),
                scheduled_start: Some(now - chrono::Duration::minutes(5)),
                scheduled_end: Some(now + chrono::Duration::minutes(55)),
            },
        )
        .await?;
    let token = meeting.share_token.clone();

    // The host starts the call and is alone in it.
    let first = service.join_meeting(token.clone(), host.copied()).await?;
    assert!(first.started);
    let call_id = first.call_id;

    // The host leaves before anyone else arrives: the room empties, but the
    // slot is still running, so the call stays live.
    let left = service.leave_call(&call_id, host.copied()).await?;
    assert!(!left.call_ended);
    assert!(is_live(&pool, call_id).await?);

    // The guest arrives later and lands in the same call, not a new one.
    let late = service.join_meeting(token.clone(), guest.copied()).await?;
    assert_eq!(late.call_id, call_id);
    assert!(!late.started);

    // The host rejoins while the guest is there, then both drop at once.
    let rejoined = service.join_meeting(token.clone(), host.copied()).await?;
    assert_eq!(rejoined.call_id, call_id);
    assert!(
        !service
            .leave_call(&call_id, guest.copied())
            .await?
            .call_ended
    );
    assert!(
        !service
            .leave_call(&call_id, host.copied())
            .await?
            .call_ended
    );

    // The stale-call sweeper leaves the empty call alone before the end.
    service.reconcile_stale_calls().await?;
    assert!(is_live(&pool, call_id).await?);

    // Rejoining the emptied call still returns to it, and no record was made.
    let back = service.join_meeting(token.clone(), guest.copied()).await?;
    assert_eq!(back.call_id, call_id);
    assert!(!back.started);
    assert_eq!(call_records_for_meeting(&pool, meeting.id).await?, 0);

    // Once the slot is over, the last person leaving ends the call.
    end_slot(&pool, meeting.id, call_id).await?;
    assert!(
        service
            .leave_call(&call_id, guest.copied())
            .await?
            .call_ended
    );
    assert!(!is_live(&pool, call_id).await?);
    assert_eq!(call_records_for_meeting(&pool, meeting.id).await?, 1);

    // Joining the link after the end starts a new call.
    let next = service.join_meeting(token, host.copied()).await?;
    assert!(next.started);
    assert_ne!(next.call_id, call_id);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn an_empty_scheduled_meeting_ends_after_its_slot(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let (service, host, _) = setup(&pool).await?;
    let now = Utc::now();
    let meeting = service
        .create_meeting(
            host.copied(),
            CreateMeetingRequest {
                preparation_id: None,
                title: None,
                scheduled_start: Some(now),
                scheduled_end: Some(now + chrono::Duration::minutes(30)),
            },
        )
        .await?;
    let call_id = service
        .join_meeting(meeting.share_token.clone(), host.copied())
        .await?
        .call_id;
    assert!(
        !service
            .leave_call(&call_id, host.copied())
            .await?
            .call_ended
    );

    // Nobody comes back; after the slot the sweeper archives the empty call.
    end_slot(&pool, meeting.id, call_id).await?;
    service.reconcile_stale_calls().await?;
    assert!(!is_live(&pool, call_id).await?);
    assert_eq!(call_records_for_meeting(&pool, meeting.id).await?, 1);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn an_instant_meeting_ends_when_it_empties(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let (service, host, _) = setup(&pool).await?;
    let meeting = service
        .create_meeting(
            host.copied(),
            CreateMeetingRequest {
                preparation_id: None,
                title: None,
                scheduled_start: None,
                scheduled_end: None,
            },
        )
        .await?;
    let token = meeting.share_token.clone();
    let first = service.join_meeting(token.clone(), host.copied()).await?;
    assert!(
        service
            .leave_call(&first.call_id, host.copied())
            .await?
            .call_ended
    );
    assert!(!is_live(&pool, first.call_id).await?);

    let second = service.join_meeting(token, host.copied()).await?;
    assert!(second.started);
    assert_ne!(second.call_id, first.call_id);
    Ok(())
}
