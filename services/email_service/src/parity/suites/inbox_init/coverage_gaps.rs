use super::*;

async fn child_lookup_failure(pool: PgPool, name: &'static str, shard: u32, bootstrap: bool) {
    let (mut lab, _redis) = start(pool, name, shard).await;
    if bootstrap {
        sql(
            &lab,
            "DELETE FROM email_links WHERE macro_id='macro|parity-b@example.com'",
        )
        .await;
    }
    attempt(&lab, 2, Some("parity-b@example.com"), "GMAIL", &[], &[]).await;
    // Recognition, attempt and account precede the child link (4); only a
    // missing child link continues to the child's FusionAuth identity (5).
    lab.sql_fault
        .fail_acquisition(if bootstrap { 5 } else { 4 });
    init(
        &mut lab,
        if bootstrap {
            "child identity lookup fails before self-link bootstrap"
        } else {
            "child link lookup fails before delegation"
        },
        Auth::User(2),
        &query(),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_child_link_before_delegation(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    child_lookup_failure(pool, "fault_child_link_before_delegation", 53400, false).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_child_fusion_before_bootstrap(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    child_lookup_failure(pool, "fault_child_fusion_before_bootstrap", 53403, true).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_backfill_lookup_after_insert_conflict(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let (mut lab, _redis) = start(pool, "fault_backfill_lookup_after_insert_conflict", 53406).await;
    sql(
        &lab,
        "CREATE FUNCTION parity_competing_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER parity_competing_job BEFORE INSERT ON email_backfill_jobs FOR EACH ROW EXECUTE FUNCTION parity_competing_job();",
    )
    .await;
    // Identity, token health, the creation transaction, unrecorded grant,
    // token link, active job and insertion precede the conflict lookup (8).
    // A specific acquisition distinguishes the two identical active-job reads.
    lab.sql_fault.fail_acquisition(8);
    init(
        &mut lab,
        "active backfill lookup fails after insert returns no row",
        Auth::User(2),
        "",
        500,
    )
    .await;
    lab.transcript.finish();
}
