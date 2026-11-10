use super::*;

enum Scenario {
    Recognize,
    Attempt,
    Owner,
    Existing,
    Dedup,
    Begin,
    Entitlement,
    LinkInsert,
    SettingsInsert,
    HistoryInsert,
    LinkCommit,
    GrantRead,
    GrantWrite,
    GrantCommit,
    Consume,
    Reauth,
    ActiveJob,
    CreateJob,
    LinkHistory,
    Queue,
    FailJob,
    Cleanup,
    DelegationInsert,
    DelegationCommit,
    Organization,
    Promotion,
    BootstrapLink,
    UnrecordedLookup,
}

async fn run(pool: PgPool, name: &'static str, shard: u32, scenario: Scenario) {
    let (mut lab, _redis) = start(pool, name, shard).await;
    let reconnect = matches!(
        scenario,
        Scenario::GrantRead
            | Scenario::GrantWrite
            | Scenario::GrantCommit
            | Scenario::Consume
            | Scenario::Reauth
    );
    let delegate = matches!(
        scenario,
        Scenario::DelegationInsert | Scenario::DelegationCommit
    );
    if matches!(scenario, Scenario::DelegationCommit) {
        sql(&lab, "DELETE FROM macro_user_links").await;
        professional(&lab, 0).await;
    }
    let shared = matches!(scenario, Scenario::Organization | Scenario::Promotion);
    let bootstrap = matches!(scenario, Scenario::BootstrapLink);
    let actor = if reconnect || delegate { 0 } else { 2 };
    let email = if reconnect {
        "parity-a@example.com".to_owned()
    } else if delegate || bootstrap {
        "parity-b@example.com".to_owned()
    } else if shared {
        format!("parity-{shard}-A2@example.com")
    } else {
        "new@example.com".to_owned()
    };
    if bootstrap {
        sql(
            &lab,
            "DELETE FROM email_links WHERE macro_id='macro|parity-b@example.com'",
        )
        .await;
    }
    let no_attempt = matches!(scenario, Scenario::UnrecordedLookup);
    if !no_attempt {
        attempt(
            &lab,
            actor,
            if matches!(scenario, Scenario::Cleanup) {
                None
            } else {
                Some(&email)
            },
            "GMAIL",
            &[GMAIL_SCOPE],
            &[GMAIL_SCOPE],
        )
        .await;
    }
    let mut status = 500;
    match scenario {
        Scenario::Recognize => {
            lab.sql_fault.fail_acquisition(1);
            status = 503;
        }
        Scenario::Attempt => lab.sql_fault.fail_acquisition(2),
        Scenario::Owner => lab.sql_fault.fail_acquisition(3),
        Scenario::Existing => lab.sql_fault.fail_acquisition(4),
        Scenario::Dedup => lab.sql_fault.fail_acquisition(5),
        Scenario::Begin => lab.sql_fault.fail_acquisition(7),
        Scenario::Entitlement => {
            sql(
                &lab,
                "ALTER TABLE \"RolesOnPermissions\" RENAME TO parity_hidden_permissions",
            )
            .await;
            status = 503;
        }
        Scenario::LinkInsert | Scenario::BootstrapLink => {
            fail_write(&lab, "email_links", "INSERT", false).await
        }
        Scenario::SettingsInsert => fail_write(&lab, "email_settings", "INSERT", false).await,
        Scenario::HistoryInsert => fail_write(&lab, "email_gmail_histories", "INSERT", false).await,
        Scenario::LinkCommit => fail_write(&lab, "email_gmail_histories", "INSERT", true).await,
        Scenario::GrantRead => {
            sql(
                &lab,
                "ALTER TABLE email_link_google_scopes RENAME TO parity_hidden_scopes",
            )
            .await
        }
        Scenario::GrantWrite => fail_write(&lab, "email_link_google_scopes", "INSERT", false).await,
        Scenario::GrantCommit => fail_write(&lab, "email_link_google_scopes", "INSERT", true).await,
        Scenario::Consume => fail_write(&lab, "in_progress_user_link", "DELETE", false).await,
        Scenario::Reauth => {
            sql(&lab,"UPDATE email_links SET needs_reauth=true WHERE email_address='parity-a@example.com'").await;
            fail_write(&lab, "email_links", "UPDATE", false).await;
            status = 200;
        }
        Scenario::ActiveJob => {
            sql(
                &lab,
                "ALTER TABLE email_backfill_jobs RENAME TO parity_hidden_jobs",
            )
            .await
        }
        Scenario::CreateJob => fail_write(&lab, "email_backfill_jobs", "INSERT", false).await,
        Scenario::LinkHistory => {
            fail_write(&lab, "email_links_history", "INSERT", false).await;
            status = 200;
        }
        Scenario::Queue => lab.sqs.set_outage(true),
        Scenario::FailJob => {
            fail_write(&lab, "email_backfill_jobs", "UPDATE", false).await;
            lab.sqs.set_outage(true);
        }
        Scenario::Cleanup => {
            fail_write(&lab, "in_progress_user_link", "DELETE", false).await;
            status = 400;
        }
        Scenario::DelegationInsert => fail_write(&lab, "macro_user_links", "INSERT", false).await,
        Scenario::DelegationCommit => fail_write(&lab, "macro_user_links", "INSERT", true).await,
        Scenario::Organization => {
            sql(
                &lab,
                "ALTER TABLE \"User\" RENAME COLUMN \"organizationId\" TO parity_hidden_org",
            )
            .await
        }
        Scenario::Promotion => {
            fail_write(&lab, "macro_user_email_verification", "INSERT", false).await
        }
        Scenario::UnrecordedLookup => {
            sql(
                &lab,
                "ALTER TABLE email_link_google_scopes RENAME TO parity_hidden_scopes",
            )
            .await;
            status = 200;
        }
    }
    let query = if no_attempt {
        String::new()
    } else if shared {
        format!("{}&force_share=true", query())
    } else {
        query()
    };
    init(
        &mut lab,
        "injected failure",
        Auth::User(actor),
        &query,
        status,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_recognize(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_recognize", 52600, Scenario::Recognize).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_attempt(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_attempt", 52603, Scenario::Attempt).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_owner(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_owner", 52606, Scenario::Owner).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_existing(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_existing", 52609, Scenario::Existing).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_dedup(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_dedup", 52612, Scenario::Dedup).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_begin(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_begin", 52615, Scenario::Begin).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_entitlement(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_entitlement", 52618, Scenario::Entitlement).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_link_insert(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_link_insert", 52621, Scenario::LinkInsert).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_settings_insert(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "fault_settings_insert",
        52624,
        Scenario::SettingsInsert,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_history_insert(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_history_insert", 52627, Scenario::HistoryInsert).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_link_commit(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_link_commit", 52630, Scenario::LinkCommit).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_grant_read(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_grant_read", 52633, Scenario::GrantRead).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_grant_write(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_grant_write", 52636, Scenario::GrantWrite).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_grant_commit(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_grant_commit", 52639, Scenario::GrantCommit).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_consume(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_consume", 52642, Scenario::Consume).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_reauth(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_reauth", 52645, Scenario::Reauth).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_active_job(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_active_job", 52648, Scenario::ActiveJob).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_create_job(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_create_job", 52651, Scenario::CreateJob).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_link_history(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_link_history", 52654, Scenario::LinkHistory).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_queue(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_queue", 52657, Scenario::Queue).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_fail_job(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_fail_job", 52660, Scenario::FailJob).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_cleanup(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_cleanup", 52663, Scenario::Cleanup).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_delegation_insert(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "fault_delegation_insert",
        52666,
        Scenario::DelegationInsert,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_delegation_commit(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "fault_delegation_commit",
        52669,
        Scenario::DelegationCommit,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_organization(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_organization", 52672, Scenario::Organization).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_promotion(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_promotion", 52675, Scenario::Promotion).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_bootstrap_link(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_bootstrap_link", 52678, Scenario::BootstrapLink).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_unrecorded_lookup(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "fault_unrecorded_lookup",
        52681,
        Scenario::UnrecordedLookup,
    )
    .await;
}
