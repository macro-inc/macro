use super::*;

enum Scenario {
    CalendarAccount,
    CalendarJob,
    CalendarOutbox,
    PromotionUser,
    PromotionMarker,
    PromotionLink,
    PromotionEdge,
    BootstrapSettings,
    BootstrapHistory,
    BootstrapEdge,
    BootstrapCommit,
}

async fn run(pool: PgPool, name: &'static str, shard: u32, scenario: Scenario) {
    let (mut lab, _redis) = start(pool, name, shard).await;
    let (actor, email, table, operation, deferred) = match scenario {
        Scenario::CalendarAccount => (
            0,
            "parity-a@example.com".to_owned(),
            "calendar_accounts",
            "INSERT",
            false,
        ),
        Scenario::CalendarJob => (
            0,
            "parity-a@example.com".to_owned(),
            "calendar_backfill_jobs",
            "INSERT",
            false,
        ),
        Scenario::CalendarOutbox => (
            0,
            "parity-a@example.com".to_owned(),
            "calendar_sync_outbox",
            "INSERT",
            false,
        ),
        Scenario::PromotionUser => (
            2,
            format!("parity-{shard}-A2@example.com"),
            "macro_user",
            "INSERT",
            false,
        ),
        Scenario::PromotionMarker => (
            2,
            format!("parity-{shard}-A2@example.com"),
            "promoted_shared_mailboxes",
            "INSERT",
            false,
        ),
        Scenario::PromotionLink => (
            2,
            format!("parity-{shard}-A2@example.com"),
            "email_links",
            "UPDATE",
            false,
        ),
        Scenario::PromotionEdge => (
            2,
            format!("parity-{shard}-A2@example.com"),
            "macro_user_links",
            "INSERT",
            false,
        ),
        Scenario::BootstrapSettings => (
            2,
            "parity-b@example.com".to_owned(),
            "email_settings",
            "INSERT",
            false,
        ),
        Scenario::BootstrapHistory => (
            2,
            "parity-b@example.com".to_owned(),
            "email_gmail_histories",
            "INSERT",
            false,
        ),
        Scenario::BootstrapEdge => (
            2,
            "parity-b@example.com".to_owned(),
            "macro_user_links",
            "INSERT",
            false,
        ),
        Scenario::BootstrapCommit => (
            2,
            "parity-b@example.com".to_owned(),
            "macro_user_links",
            "INSERT",
            true,
        ),
    };
    let bootstrap = email == "parity-b@example.com";
    if bootstrap {
        sql(
            &lab,
            "DELETE FROM email_links WHERE macro_id='macro|parity-b@example.com'",
        )
        .await;
    }
    attempt(
        &lab,
        actor,
        Some(&email),
        "GMAIL",
        &[GMAIL_SCOPE, CALENDAR_SCOPE, CALENDAR_LIST_SCOPE],
        &[GMAIL_SCOPE, CALENDAR_SCOPE, CALENDAR_LIST_SCOPE],
    )
    .await;
    fail_write(&lab, table, operation, deferred).await;
    let query = if actor == 2 && !bootstrap {
        format!("{}&force_share=true", query())
    } else {
        query()
    };
    init(
        &mut lab,
        "nested write fails",
        Auth::User(actor),
        &query,
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_calendar_account(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "fault_calendar_account",
        53200,
        Scenario::CalendarAccount,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_calendar_job(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_calendar_job", 53203, Scenario::CalendarJob).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_calendar_outbox(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "fault_calendar_outbox",
        53206,
        Scenario::CalendarOutbox,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_promotion_user(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_promotion_user", 53209, Scenario::PromotionUser).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_promotion_marker(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "fault_promotion_marker",
        53212,
        Scenario::PromotionMarker,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_promotion_link(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_promotion_link", 53215, Scenario::PromotionLink).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_promotion_edge(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_promotion_edge", 53218, Scenario::PromotionEdge).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_bootstrap_settings(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "fault_bootstrap_settings",
        53221,
        Scenario::BootstrapSettings,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_bootstrap_history(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "fault_bootstrap_history",
        53224,
        Scenario::BootstrapHistory,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_bootstrap_edge(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "fault_bootstrap_edge", 53227, Scenario::BootstrapEdge).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_bootstrap_commit(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "fault_bootstrap_commit",
        53230,
        Scenario::BootstrapCommit,
    )
    .await;
}
