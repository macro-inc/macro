use super::{
    BackfillCompletion, InitLeaseClaim, InitLeaseRenewal, claim_completion_effects,
    claim_init_lease, complete_backfill_job, completion_effects_pending, fail_backfill_job,
    finalize_initialization, mark_completion_effects_complete, release_completion_effects,
    release_init_lease, renew_completion_effects, renew_init_lease,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{PgPool, types::Uuid};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn initialization_lease_is_fenced_reclaimable_and_publishes_once(
    pool: PgPool,
) -> anyhow::Result<()> {
    let link_id = Uuid::new_v4();
    let email_job_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
        VALUES ($1, $2, $2, $3, 'GMAIL')
        "#,
        link_id,
        "macro|calendar-init-lease@corp.test",
        "calendar-init-lease@corp.test",
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO email_backfill_jobs (id, link_id, fusionauth_user_id, status)
        VALUES ($1, $2, $3, 'Init')
        "#,
        email_job_id,
        link_id,
        "fusion-calendar-init-lease",
    )
    .execute(&pool)
    .await?;

    let InitLeaseClaim::Claimed(first_lease) = claim_init_lease(&pool, email_job_id).await? else {
        panic!("initialization should be claimable");
    };
    assert_eq!(
        claim_init_lease(&pool, email_job_id).await?,
        InitLeaseClaim::Busy
    );
    assert_eq!(
        renew_init_lease(&pool, email_job_id, first_lease).await?,
        InitLeaseRenewal::Renewed
    );
    assert!(!release_init_lease(&pool, email_job_id, Uuid::new_v4()).await?);
    assert!(release_init_lease(&pool, email_job_id, first_lease).await?);

    let InitLeaseClaim::Claimed(current_lease) = claim_init_lease(&pool, email_job_id).await?
    else {
        panic!("released initialization should be reclaimable");
    };
    assert!(!finalize_initialization(&pool, email_job_id, Uuid::new_v4()).await?);
    assert!(finalize_initialization(&pool, email_job_id, current_lease).await?);
    assert_eq!(
        claim_init_lease(&pool, email_job_id).await?,
        InitLeaseClaim::Complete
    );
    assert_eq!(
        claim_init_lease(&pool, Uuid::new_v4()).await?,
        InitLeaseClaim::NotFound
    );
    assert_eq!(
        sqlx::query_scalar!(
            r#"
            SELECT count(*) AS "count!"
            FROM email_backfill_init_outbox
            WHERE backfill_job_id = $1
            "#,
            email_job_id,
        )
        .fetch_one(&pool)
        .await?,
        1
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failing_an_active_scan_marks_it_terminal(pool: PgPool) -> anyhow::Result<()> {
    let link_id = Uuid::new_v4();
    let email_job_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
        VALUES ($1, $2, $2, $3, 'GMAIL')
        "#,
        link_id,
        "macro|calendar-cleanup@corp.test",
        "calendar-cleanup@corp.test",
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO email_backfill_jobs (id, link_id, fusionauth_user_id, status)
        VALUES ($1, $2, $3, 'Init')
        "#,
        email_job_id,
        link_id,
        "fusion-calendar-cleanup",
    )
    .execute(&pool)
    .await?;

    assert!(fail_backfill_job(&pool, email_job_id).await?);
    assert_eq!(
        complete_backfill_job(&pool, email_job_id, None).await?,
        BackfillCompletion::AlreadyTerminal
    );

    let email_status = sqlx::query_scalar!(
        r#"SELECT status::text AS "status!" FROM email_backfill_jobs WHERE id = $1"#,
        email_job_id,
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(email_status, "Failed");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn completing_an_active_scan_runs_completion_effects_once(
    pool: PgPool,
) -> anyhow::Result<()> {
    let link_id = Uuid::new_v4();
    let email_job_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
        VALUES ($1, $2, $2, $3, 'GMAIL')
        "#,
        link_id,
        "macro|calendar-completion@corp.test",
        "calendar-completion@corp.test",
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO email_backfill_jobs (id, link_id, fusionauth_user_id, status)
        VALUES ($1, $2, $3, 'InProgress')
        "#,
        email_job_id,
        link_id,
        "fusion-calendar-completion",
    )
    .execute(&pool)
    .await?;

    assert_eq!(
        complete_backfill_job(&pool, email_job_id, None).await?,
        BackfillCompletion::Completed
    );
    assert_eq!(
        complete_backfill_job(&pool, email_job_id, None).await?,
        BackfillCompletion::AlreadyTerminal
    );

    let email_status = sqlx::query_scalar!(
        r#"SELECT status::text AS "status!" FROM email_backfill_jobs WHERE id = $1"#,
        email_job_id,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(email_status, "Complete");
    assert!(completion_effects_pending(&pool, email_job_id).await?);
    let lease_token = claim_completion_effects(&pool, email_job_id)
        .await?
        .expect("completion effects should be claimable");
    assert!(
        claim_completion_effects(&pool, email_job_id)
            .await?
            .is_none()
    );
    assert!(renew_completion_effects(&pool, email_job_id, lease_token).await?);
    assert!(!release_completion_effects(&pool, email_job_id, Uuid::new_v4()).await?);
    assert!(release_completion_effects(&pool, email_job_id, lease_token).await?);
    let lease_token = claim_completion_effects(&pool, email_job_id)
        .await?
        .expect("released completion effects should be reclaimable");
    assert!(
        mark_completion_effects_complete(&pool, email_job_id, Uuid::new_v4())
            .await
            .is_err()
    );
    mark_completion_effects_complete(&pool, email_job_id, lease_token).await?;
    assert!(!completion_effects_pending(&pool, email_job_id).await?);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn zero_thread_completion_is_fenced_by_init_lease(pool: PgPool) -> anyhow::Result<()> {
    let link_id = Uuid::new_v4();
    let email_job_id = Uuid::new_v4();
    let current_lease = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
        VALUES ($1, $2, $2, $3, 'GMAIL')
        "#,
        link_id,
        "macro|calendar-fenced-zero@corp.test",
        "calendar-fenced-zero@corp.test",
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO email_backfill_jobs (
            id, link_id, fusionauth_user_id, status,
            init_lease_token, init_lease_expires_at
        )
        VALUES ($1, $2, $3, 'Init', $4, now() + interval '2 minutes')
        "#,
        email_job_id,
        link_id,
        "fusion-calendar-fenced-zero",
        current_lease,
    )
    .execute(&pool)
    .await?;

    assert_eq!(
        complete_backfill_job(&pool, email_job_id, None).await?,
        BackfillCompletion::LeaseLost
    );
    assert_eq!(
        complete_backfill_job(&pool, email_job_id, Some(Uuid::new_v4())).await?,
        BackfillCompletion::LeaseLost
    );
    sqlx::query!(
        r#"
        UPDATE email_backfill_jobs
        SET init_lease_expires_at = now() - interval '1 second'
        WHERE id = $1
        "#,
        email_job_id,
    )
    .execute(&pool)
    .await?;
    assert_eq!(
        complete_backfill_job(&pool, email_job_id, Some(current_lease)).await?,
        BackfillCompletion::LeaseLost
    );
    assert_eq!(
        sqlx::query_scalar!(
            r#"
            SELECT count(*) AS "count!"
            FROM email_backfill_completion_outbox
            WHERE backfill_job_id = $1
            "#,
            email_job_id,
        )
        .fetch_one(&pool)
        .await?,
        0
    );
    let InitLeaseClaim::Claimed(reclaimed_lease) = claim_init_lease(&pool, email_job_id).await?
    else {
        panic!("expired zero-thread initialization should be reclaimable");
    };
    assert_eq!(
        complete_backfill_job(&pool, email_job_id, Some(reclaimed_lease)).await?,
        BackfillCompletion::Completed
    );

    let status = sqlx::query_scalar!(
        r#"SELECT status::text AS "status!" FROM email_backfill_jobs WHERE id = $1"#,
        email_job_id,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(status, "Complete");
    assert!(completion_effects_pending(&pool, email_job_id).await?);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failing_a_terminal_scan_is_an_idempotent_noop(pool: PgPool) -> anyhow::Result<()> {
    let link_id = Uuid::new_v4();
    let email_job_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
        VALUES ($1, $2, $2, $3, 'GMAIL')
        "#,
        link_id,
        "macro|calendar-terminal@corp.test",
        "calendar-terminal@corp.test",
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO email_backfill_jobs (id, link_id, fusionauth_user_id, status)
        VALUES ($1, $2, $3, 'Complete')
        "#,
        email_job_id,
        link_id,
        "fusion-calendar-terminal",
    )
    .execute(&pool)
    .await?;

    assert!(!fail_backfill_job(&pool, email_job_id).await?);
    assert!(!fail_backfill_job(&pool, Uuid::new_v4()).await?);

    let email_status = sqlx::query_scalar!(
        r#"SELECT status::text AS "status!" FROM email_backfill_jobs WHERE id = $1"#,
        email_job_id,
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(email_status, "Complete");
    Ok(())
}
