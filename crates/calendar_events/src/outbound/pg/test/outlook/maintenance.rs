//! Claims without the maintenance tick before them: what a claim may hand out
//! while maintenance has yet to catch up with a grant or a month.
use super::*;

/// A synced calendar whose row is due now and whose account holds no lease.
async fn due_calendar(repo: &PgCalendarRepository, pool: &PgPool) -> OutlookCalendarLease {
    let lease = calendar(repo).await;
    repo.commit_outlook_calendar(&lease, Some(vec![]), Some("cursor".into()))
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at=now()-interval '1 second' WHERE id=$1",
        lease.id
    )
    .execute(pool)
    .await
    .unwrap();
    lease
}

async fn replace_grant(pool: &PgPool, link: Uuid) {
    sqlx::query!(
        "UPDATE email_links SET grant_generation=2,sync_generation=2 WHERE id=$1",
        link
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_link_microsoft_scopes SET grant_generation=2 WHERE link_id=$1",
        link
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn account_status(pool: &PgPool, link: Uuid) -> String {
    sqlx::query_scalar!(
        "SELECT sync_status FROM calendar_accounts WHERE email_link_id=$1",
        link
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_claim_never_hands_out_work_of_a_replaced_grant(pool: PgPool) {
    let (repo, link, _) = mailbox(&pool).await;
    let lease = due_calendar(&repo, &pool).await;
    replace_grant(&pool, link).await;

    assert!(
        claim_only(&repo, READER_REVISION).await.is_none(),
        "the row still carries the old generations and cursor"
    );

    assert!(maintain(&repo).await);
    let next = claim_only(&repo, READER_REVISION).await.unwrap();
    assert_eq!(
        (next.binding.sync_generation, next.binding.grant_generation),
        (2, 2)
    );
    let row = sqlx::query!(
        "SELECT sync_generation,grant_generation,cursor FROM calendar_outlook_work WHERE id=$1",
        lease.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((row.sync_generation, row.grant_generation), (2, 2));
    assert!(row.cursor.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_claim_never_hands_out_an_expired_window(pool: PgPool) {
    let (repo, _, _) = mailbox(&pool).await;
    let lease = due_calendar(&repo, &pool).await;
    sqlx::query!(
        "UPDATE calendar_outlook_work SET ends_at=ends_at-interval '1 month' WHERE id=$1",
        lease.id
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(claim_only(&repo, READER_REVISION).await.is_none());

    assert!(maintain(&repo).await);
    let rolled = claim_only(&repo, READER_REVISION).await.unwrap();
    assert_eq!(rolled.id, lease.id);
    assert!(rolled.cursor.is_none());
    assert_eq!(
        rolled.target.unwrap().range.ends_at,
        OccurrenceRange::maintenance_horizon(Utc::now()).ends_at
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn maintenance_ends_reauthorization_after_a_replacement_grant(pool: PgPool) {
    let (repo, link, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    repo.fail_outlook_calendar(&lease, CalendarProviderErrorKind::ReauthRequired)
        .await
        .unwrap();
    replace_grant(&pool, link).await;
    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at=now()-interval '1 second' WHERE account_id=$1",
        lease.account_id
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(claim_only(&repo, READER_REVISION).await.is_none());
    assert_eq!(account_status(&pool, link).await, "reauth_required");

    assert!(maintain(&repo).await);
    assert_eq!(account_status(&pool, link).await, "pending");
    let resumed = claim_only(&repo, READER_REVISION).await.unwrap();
    assert_eq!(resumed.binding.grant_generation, 2);
    assert_eq!(account_status(&pool, link).await, "syncing");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_revoked_calendar_grant_stops_claims_before_maintenance_disables_it(pool: PgPool) {
    let (repo, link, _) = mailbox(&pool).await;
    due_calendar(&repo, &pool).await;
    sqlx::query!(
        "UPDATE email_link_microsoft_scopes SET calendar_disabled_at=now() WHERE link_id=$1",
        link
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(claim_only(&repo, READER_REVISION).await.is_none());
    assert_ne!(account_status(&pool, link).await, "disabled");

    assert!(maintain(&repo).await);
    assert_eq!(account_status(&pool, link).await, "disabled");
    assert!(claim(&repo).await.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_lease_on_work_awaiting_its_reset_still_holds_the_account(pool: PgPool) {
    let (repo, _, _) = mailbox(&pool).await;
    let account = two_calendars(&repo).await;
    let leased = claim(&repo).await.unwrap();
    assert_eq!(leased.account_id, account);
    // The month turns while the lease runs; the other calendar is due.
    sqlx::query!(
        "UPDATE calendar_outlook_work SET ends_at=ends_at-interval '1 month' WHERE id=$1",
        leased.id
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(
        claim_only(&repo, READER_REVISION).await.is_none(),
        "the account's live lease counts whatever window its row has"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_claims_hold_at_most_one_lease_per_account(pool: PgPool) {
    let (repo, _, owner) = mailbox(&pool).await;
    for _ in 0..2 {
        outlook_link(&pool, &owner).await;
    }
    assert!(maintain(&repo).await);
    while let Some(lease) = claim_only(&repo, READER_REVISION).await {
        if lease.target.is_none() {
            repo.commit_outlook_calendars(
                &lease,
                vec![
                    discovered_calendar("primary"),
                    discovered_calendar("secondary"),
                ],
            )
            .await
            .unwrap();
        } else {
            repo.commit_outlook_calendar(&lease, Some(vec![]), Some("cursor".into()))
                .await
                .unwrap();
        }
    }
    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at=now()-interval '1 second' WHERE calendar_id IS NOT NULL"
    )
    .execute(&pool)
    .await
    .unwrap();

    // Eight loops race for six due calendars of three accounts.
    let leases =
        futures::future::join_all((0..8).map(|_| claim_only(&repo, READER_REVISION))).await;
    let mut accounts: Vec<_> = leases.iter().flatten().map(|l| l.account_id).collect();
    accounts.sort();
    let claimed = accounts.len();
    accounts.dedup();
    assert_eq!(claimed, accounts.len(), "no account holds two leases");
    assert_eq!(claimed, 3, "every account's first due calendar went out");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_task_maintains_at_a_time(pool: PgPool) {
    let (repo, _, _) = mailbox(&pool).await;
    let mut other_task = pool.begin().await.unwrap();
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended('calendar_outlook_maintenance', 0))"
    )
    .execute(&mut *other_task)
    .await
    .unwrap();

    assert!(!maintain(&repo).await);
    assert!(
        claim_only(&repo, READER_REVISION).await.is_none(),
        "the new link has no account until a maintenance runs"
    );

    other_task.commit().await.unwrap();
    assert!(maintain(&repo).await);
    assert!(claim_only(&repo, READER_REVISION).await.is_some());
}
