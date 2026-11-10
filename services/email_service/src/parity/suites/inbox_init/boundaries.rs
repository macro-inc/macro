use super::*;

async fn shared_update(pool: PgPool, name: &'static str, shard: u32, recover: bool) {
    let (mut lab, _redis) = start(pool, name, shard).await;
    let email = format!("parity-{shard}-A2@example.com");
    attempt(&lab, 2, Some(&email), "GMAIL", &[], &[]).await;
    let condition = if recover {
        "nextval('parity_rehome_attempt') < 3"
    } else {
        "true"
    };
    sql(&lab, &format!("CREATE SEQUENCE parity_rehome_attempt; CREATE FUNCTION parity_rehome_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.fusionauth_user_id = 'shared-provider-principal' AND {condition} THEN RAISE EXCEPTION 'parity rehome update failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER parity_rehome_fault BEFORE UPDATE OF fusionauth_user_id ON email_links FOR EACH ROW EXECUTE FUNCTION parity_rehome_fault();")).await;
    init(
        &mut lab,
        "shared credential relocation update",
        Auth::User(2),
        &format!("{}&force_share=true", query()),
        200,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn shared_update_retries(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    shared_update(pool, "shared_update_retries", 53000, true).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn shared_update_exhausted(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    shared_update(pool, "shared_update_exhausted", 53003, false).await;
}

async fn backfill_conflict(pool: PgPool, name: &'static str, shard: u32, insert_competitor: bool) {
    let (mut lab, _redis) = start(pool, name, shard).await;
    let body = if insert_competitor {
        "IF pg_trigger_depth()=1 THEN INSERT INTO email_backfill_jobs(id,link_id,fusionauth_user_id,status) VALUES('6a000000-0000-0000-0000-000000000003',NEW.link_id,NEW.fusionauth_user_id,'InProgress'); END IF; RETURN NEW;"
    } else {
        "RETURN NULL;"
    };
    sql(&lab,&format!("CREATE FUNCTION parity_competing_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN {body} END $$; CREATE TRIGGER parity_competing_job BEFORE INSERT ON email_backfill_jobs FOR EACH ROW EXECUTE FUNCTION parity_competing_job();")).await;
    init(
        &mut lab,
        "backfill insert returns no row",
        Auth::User(2),
        "",
        if insert_competitor { 200 } else { 500 },
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn backfill_insert_conflict(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    backfill_conflict(pool, "backfill_insert_conflict", 53006, true).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn backfill_conflict_without_job(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    backfill_conflict(pool, "backfill_conflict_without_job", 53009, false).await;
}

#[expect(
    clippy::disallowed_methods,
    reason = "A deterministic acquisition barrier reproduces an account deletion"
)]
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn bootstrap_child_disappears(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let (mut lab, _redis) = start(pool, "bootstrap_child_disappears", 53012).await;
    sql(
        &lab,
        "DELETE FROM email_links WHERE macro_id='macro|parity-b@example.com'",
    )
    .await;
    attempt(&lab, 2, Some("parity-b@example.com"), "GMAIL", &[], &[]).await;
    let (arrived, release) = lab.sql_fault.pause_acquisition(5);
    let db = lab.db.clone();
    let change = async move {
        arrived.await.expect("child owner and inbox read");
        sqlx::query("DELETE FROM \"User\" WHERE email='parity-b@example.com'")
            .execute(&db)
            .await
            .expect("child deleted");
        release.send(()).expect("resume child lookup");
    };
    let request_query = query();
    tokio::join!(
        change,
        init(
            &mut lab,
            "child account disappeared",
            Auth::User(2),
            &request_query,
            500
        )
    );
    lab.transcript.finish();
}

async fn discovery_reauth(pool: PgPool, name: &'static str, shard: u32, fault: u8) {
    let (mut lab, _redis) = start(pool, name, shard).await;
    lab.stub.reply_sequence(
        "GET",
        "/internal/google_access_token",
        vec![
            (200, json!({"access_token":"fake-access-token"})),
            (403, json!({"message":"grant revoked"})),
        ],
    );
    if fault == 1 {
        lab.sqs.fail_nth_send(1);
    }
    if fault == 2 {
        fail_write(&lab, "email_links", "UPDATE", false).await;
    }
    init(
        &mut lab,
        "discovery credential revoked",
        Auth::User(2),
        "",
        200,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn discovery_reauth_notification(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    discovery_reauth(pool, "discovery_reauth_notification", 53015, 0).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn discovery_notification_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    discovery_reauth(pool, "discovery_notification_failure", 53018, 1).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn discovery_reauth_write_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    discovery_reauth(pool, "discovery_reauth_write_failure", 53021, 2).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_token_health_clear(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let (mut lab, _redis) = start(pool, "fault_token_health_clear", 53024).await;
    attempt(&lab, 2, Some("new@example.com"), "GMAIL", &[], &[]).await;
    lab.sql_fault.fail_acquisition(6);
    init(
        &mut lab,
        "token health clear loses the database",
        Auth::User(2),
        &query(),
        500,
    )
    .await;
    lab.transcript.finish();
}
