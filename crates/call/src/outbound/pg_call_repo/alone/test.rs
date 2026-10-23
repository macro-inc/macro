use super::*;
use chrono::Duration;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

/// The fixture's active call, with `macro|user-a` and `macro|user-b` in it.
const CALL1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_0000000ca110);
const PARTICIPANT: &str = "macro|user-a@test.com";
/// A channel member who never joined the call.
const NON_PARTICIPANT: &str = "macro|user-c@test.com";

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

fn now() -> DateTime<Utc> {
    Utc::now().trunc_subsecs(6)
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn the_alone_period_keeps_its_first_start(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgCallRepo::new(pool);
    let started = now() - Duration::minutes(6);

    let first = repo.mark_call_alone(&CALL1, started).await?;
    let later = repo.mark_call_alone(&CALL1, now()).await?;

    assert_eq!(
        first,
        Some(AloneCallState {
            alone_since: started,
            warned_at: None,
            newly_alone: true,
        })
    );
    assert_eq!(
        later,
        Some(AloneCallState {
            alone_since: started,
            warned_at: None,
            newly_alone: false,
        })
    );
    assert_eq!(repo.mark_call_alone(&Uuid::now_v7(), now()).await?, None);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn concurrent_sweeps_record_the_warning_once(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgCallRepo::new(pool);
    let started = now() - Duration::minutes(6);
    repo.mark_call_alone(&CALL1, started).await?;
    let warned_at = now();

    // Not alone since the cutoff yet.
    assert_eq!(
        repo.warn_alone_call(&CALL1, warned_at, started - Duration::seconds(1))
            .await?,
        None
    );
    let (first, second) = tokio::join!(
        repo.warn_alone_call(&CALL1, warned_at, started),
        repo.warn_alone_call(&CALL1, warned_at, started),
    );

    let recorded: Vec<_> = [first?, second?].into_iter().flatten().collect();
    assert_eq!(recorded, vec![warned_at]);
    assert_eq!(
        repo.mark_call_alone(&CALL1, now()).await?,
        Some(AloneCallState {
            alone_since: started,
            warned_at: Some(warned_at),
            newly_alone: false,
        })
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn clearing_a_sent_warning_is_reported_to_one_sweep(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgCallRepo::new(pool);

    // An unwarned alone period clears silently.
    repo.mark_call_alone(&CALL1, now()).await?;
    assert!(!repo.clear_call_alone(&CALL1).await?);
    assert!(
        repo.mark_call_alone(&CALL1, now())
            .await?
            .expect("active call")
            .newly_alone
    );

    let warned_at = now();
    repo.warn_alone_call(&CALL1, warned_at, warned_at).await?;
    let (first, second) =
        tokio::join!(repo.clear_call_alone(&CALL1), repo.clear_call_alone(&CALL1));

    assert_eq!(
        [first?, second?]
            .into_iter()
            .filter(|cleared| *cleared)
            .count(),
        1
    );
    assert!(
        repo.mark_call_alone(&CALL1, now())
            .await?
            .expect("active call")
            .newly_alone
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn only_an_active_participant_can_restart_the_alone_period(
    pool: PgPool,
) -> anyhow::Result<()> {
    let repo = PgCallRepo::new(pool);
    let started = now() - Duration::minutes(8);
    repo.mark_call_alone(&CALL1, started).await?;
    let warned_at = now() - Duration::minutes(1);
    repo.warn_alone_call(&CALL1, warned_at, warned_at).await?;
    let stayed_at = now();

    assert!(
        !repo
            .reset_call_alone(&CALL1, user(NON_PARTICIPANT), stayed_at)
            .await?
    );
    assert!(
        !repo
            .reset_call_alone(&Uuid::now_v7(), user(PARTICIPANT), stayed_at)
            .await?
    );
    assert_eq!(
        repo.mark_call_alone(&CALL1, now())
            .await?
            .expect("active call")
            .warned_at,
        Some(warned_at)
    );

    assert!(
        repo.reset_call_alone(&CALL1, user(PARTICIPANT), stayed_at)
            .await?
    );
    assert_eq!(
        repo.mark_call_alone(&CALL1, now()).await?,
        Some(AloneCallState {
            alone_since: stayed_at,
            warned_at: None,
            newly_alone: false,
        })
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn an_alone_archive_needs_an_expired_warning_and_closes_attendance(
    pool: PgPool,
) -> anyhow::Result<()> {
    let repo = PgCallRepo::new(pool.clone());
    assert!(repo.archive_alone_call(&CALL1, now()).await?.is_none());

    let warned_at = now() - Duration::minutes(3);
    repo.mark_call_alone(&CALL1, warned_at - Duration::minutes(5))
        .await?;
    repo.warn_alone_call(&CALL1, warned_at, warned_at).await?;
    // The grace period has not run out at this cutoff.
    assert!(
        repo.archive_alone_call(&CALL1, warned_at - Duration::seconds(1))
            .await?
            .is_none()
    );
    assert!(repo.get_call_by_id(&CALL1).await?.is_some());

    let archived = repo
        .archive_alone_call(&CALL1, warned_at)
        .await?
        .expect("an expired warning archives the call");

    assert_eq!(archived.call_id, CALL1);
    assert_eq!(archived.participants.len(), 2);
    assert!(repo.get_call_by_id(&CALL1).await?.is_none());
    let still_present = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM call_record_participants WHERE call_record_id = $1 AND left_at IS NULL"#,
        CALL1,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(still_present, 0);
    Ok(())
}
