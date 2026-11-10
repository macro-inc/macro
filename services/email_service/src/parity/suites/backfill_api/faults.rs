use super::*;

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn list_query_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "list_query_failure", 40200).await;
    lab.sql_fault.fail_acquisition(1);
    request(
        &mut lab,
        "database failure",
        "GET",
        PUBLIC,
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn read_link_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "read_link_failure", 40203).await;
    let id = job(&mut lab, 1, Some(0), "Init").await;
    lab.sql_fault.fail_acquisition(1);
    request(
        &mut lab,
        "database failure",
        "GET",
        &format!("{PUBLIC}/{id}"),
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn read_job_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "read_job_failure", 40206).await;
    let id = job(&mut lab, 1, Some(0), "Init").await;
    lab.sql_fault.fail_acquisition(2);
    request(
        &mut lab,
        "database failure",
        "GET",
        &format!("{PUBLIC}/{id}"),
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn active_query_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "active_query_failure", 40209).await;
    lab.sql_fault.fail_acquisition(2);
    request(
        &mut lab,
        "database failure",
        "GET",
        &format!("{PUBLIC}/active"),
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn cancel_lookup_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "cancel_lookup_failure", 40212).await;
    let id = job(&mut lab, 1, Some(0), "Init").await;
    lab.sql_fault.fail_acquisition(2);
    request(
        &mut lab,
        "database failure",
        "DELETE",
        PUBLIC,
        Auth::User(0),
        None,
        json!({"job_id":id}),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn cancel_update_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "cancel_update_failure", 40215).await;
    let id = job(&mut lab, 1, Some(0), "Init").await;
    lab.sql_fault.fail_acquisition(3);
    request(
        &mut lab,
        "database failure",
        "DELETE",
        PUBLIC,
        Auth::User(0),
        None,
        json!({"job_id":id}),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn internal_read_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "internal_read_failure", 40218).await;
    let id = job(&mut lab, 1, Some(0), "Init").await;
    lab.sql_fault.fail_acquisition(1);
    request(
        &mut lab,
        "database failure",
        "GET",
        &format!("{INTERNAL}/{id}"),
        Auth::InternalKeyOnly,
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn internal_cancel_lookup_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "internal_cancel_lookup_failure", 40221).await;
    let id = job(&mut lab, 1, Some(0), "Init").await;
    lab.sql_fault.fail_acquisition(1);
    request(
        &mut lab,
        "database failure",
        "DELETE",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"job_id":id}),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn internal_cancel_update_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "internal_cancel_update_failure", 40224).await;
    let id = job(&mut lab, 1, Some(0), "Init").await;
    lab.sql_fault.fail_acquisition(2);
    request(
        &mut lab,
        "database failure",
        "DELETE",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"job_id":id}),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn create_link_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "create_link_failure", 40227).await;
    let link = lab.fixture.links[0];
    lab.sql_fault.fail_acquisition(1);
    request(
        &mut lab,
        "database failure",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":[link]}),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn create_insert_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "create_insert_failure", 40230).await;
    let link = lab.fixture.links[0];
    lab.sql_fault.fail_acquisition(2);
    request(
        &mut lab,
        "database failure",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":[link]}),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn create_active_lookup_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "create_active_lookup_failure", 40233).await;
    job(&mut lab, 1, Some(0), "Init").await;
    let link = lab.fixture.links[0];
    lab.sql_fault.fail_acquisition(3);
    request(
        &mut lab,
        "database failure",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":[link]}),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn create_cleanup_begin_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "create_cleanup_begin_failure", 40236).await;
    let link = lab.fixture.links[0];
    lab.sqs.set_outage(true);
    lab.sql_fault.fail_acquisition(3);
    request(
        &mut lab,
        "database failure",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":[link]}),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn create_conflict_without_active_job(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "create_conflict_without_active_job", 40239).await;
    sqlx::raw_sql("CREATE FUNCTION parity_skip_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER parity_skip_insert BEFORE INSERT ON email_backfill_jobs FOR EACH ROW EXECUTE FUNCTION parity_skip_insert();").execute(&lab.db).await.expect("install deterministic fault");
    let link = lab.fixture.links[0];
    lab.sqs.set_outage(false);
    request(
        &mut lab,
        "failed create",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":[link]}),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn create_cleanup_update_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "create_cleanup_update_failure", 40242).await;
    sqlx::raw_sql("CREATE FUNCTION parity_fail_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'parity injected cleanup failure'; END $$; CREATE TRIGGER parity_fail_update BEFORE UPDATE ON email_backfill_jobs FOR EACH ROW EXECUTE FUNCTION parity_fail_update();").execute(&lab.db).await.expect("install deterministic fault");
    let link = lab.fixture.links[0];
    lab.sqs.set_outage(true);
    request(
        &mut lab,
        "failed create",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":[link]}),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn create_cleanup_commit_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "create_cleanup_commit_failure", 40245).await;
    sqlx::raw_sql("CREATE FUNCTION parity_fail_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'parity injected cleanup commit failure'; END $$; CREATE CONSTRAINT TRIGGER parity_fail_commit AFTER UPDATE ON email_backfill_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION parity_fail_commit();").execute(&lab.db).await.expect("install deterministic fault");
    let link = lab.fixture.links[0];
    lab.sqs.set_outage(true);
    request(
        &mut lab,
        "failed create",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":[link]}),
        500,
    )
    .await;
    lab.transcript.finish();
}
