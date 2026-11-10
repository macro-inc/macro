use super::*;

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_lookup_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_lookup_failure", 41281).await;
    let link = lab.fixture.links[0];
    sqlx::raw_sql("ALTER TABLE email_links RENAME COLUMN is_primary TO parity_hidden_primary")
        .execute(&lab.db)
        .await
        .expect("calendar fault");
    request(
        &mut lab,
        "calendar database failure",
        "DELETE",
        &format!("/email/links/{link}/calendar"),
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_delegation_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_delegation_failure", 41284).await;
    let link = lab.fixture.links[0];
    sqlx::raw_sql("ALTER TABLE macro_user_links RENAME TO parity_hidden_edges")
        .execute(&lab.db)
        .await
        .expect("calendar fault");
    request(
        &mut lab,
        "calendar database failure",
        "DELETE",
        &format!("/email/links/{link}/calendar"),
        Auth::User(2),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_scope_read_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_scope_read_failure", 41287).await;
    let link = lab.fixture.links[0];
    sqlx::raw_sql(
        "ALTER TABLE email_link_google_scopes RENAME COLUMN granted_scopes TO parity_hidden_scopes",
    )
    .execute(&lab.db)
    .await
    .expect("calendar fault");
    request(
        &mut lab,
        "calendar database failure",
        "DELETE",
        &format!("/email/links/{link}/calendar"),
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_watch_read_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_watch_read_failure", 41290).await;
    let link = lab.fixture.links[0];
    calendar::calendar(&mut lab, link, false, false).await;
    sqlx::raw_sql("ALTER TABLE calendars RENAME COLUMN watch_channel_id TO parity_hidden_channel")
        .execute(&lab.db)
        .await
        .expect("calendar fault");
    request(
        &mut lab,
        "calendar database failure",
        "DELETE",
        &format!("/email/links/{link}/calendar"),
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_scope_update_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_scope_update_failure", 41293).await;
    let link = lab.fixture.links[0];
    calendar::calendar(&mut lab, link, false, false).await;
    sqlx::raw_sql("CREATE FUNCTION parity_scope_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'parity scope update failure'; END $$; CREATE TRIGGER parity_scope_failure BEFORE INSERT OR UPDATE ON email_link_google_scopes FOR EACH ROW EXECUTE FUNCTION parity_scope_failure();").execute(&lab.db).await.expect("calendar fault");
    request(
        &mut lab,
        "calendar database failure",
        "DELETE",
        &format!("/email/links/{link}/calendar"),
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_invalidate_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_invalidate_failure", 41296).await;
    let link = lab.fixture.links[0];
    calendar::calendar(&mut lab, link, false, false).await;
    sqlx::raw_sql(
        "ALTER TABLE calendar_backfill_jobs RENAME COLUMN grant_version TO parity_hidden_version",
    )
    .execute(&lab.db)
    .await
    .expect("calendar fault");
    request(
        &mut lab,
        "calendar database failure",
        "DELETE",
        &format!("/email/links/{link}/calendar"),
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_account_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_account_failure", 41299).await;
    let link = lab.fixture.links[0];
    calendar::calendar(&mut lab, link, false, false).await;
    sqlx::raw_sql(
        "ALTER TABLE calendar_accounts RENAME COLUMN sync_status TO parity_hidden_status",
    )
    .execute(&lab.db)
    .await
    .expect("calendar fault");
    request(
        &mut lab,
        "calendar database failure",
        "DELETE",
        &format!("/email/links/{link}/calendar"),
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_calendars_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_calendars_failure", 41302).await;
    let link = lab.fixture.links[0];
    calendar::calendar(&mut lab, link, false, false).await;
    sqlx::raw_sql(
        "ALTER TABLE calendars RENAME COLUMN materialized_starts_at TO parity_hidden_start",
    )
    .execute(&lab.db)
    .await
    .expect("calendar fault");
    request(
        &mut lab,
        "calendar database failure",
        "DELETE",
        &format!("/email/links/{link}/calendar"),
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_source_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_source_failure", 41305).await;
    let link = lab.fixture.links[0];
    calendar::calendar(&mut lab, link, false, false).await;
    sqlx::raw_sql(
        "ALTER TABLE calendar_event_sources RENAME COLUMN account_id TO parity_hidden_account",
    )
    .execute(&lab.db)
    .await
    .expect("calendar fault");
    request(
        &mut lab,
        "calendar database failure",
        "DELETE",
        &format!("/email/links/{link}/calendar"),
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_reminder_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_reminder_failure", 41308).await;
    let link = lab.fixture.links[0];
    calendar::calendar(&mut lab, link, false, false).await;
    sqlx::raw_sql("ALTER TABLE calendar_event_reminder_deliveries RENAME COLUMN event_id TO parity_hidden_event").execute(&lab.db).await.expect("calendar fault");
    request(
        &mut lab,
        "calendar database failure",
        "DELETE",
        &format!("/email/links/{link}/calendar"),
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_delete_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_delete_failure", 41311).await;
    let link = lab.fixture.links[0];
    calendar::calendar(&mut lab, link, false, false).await;
    sqlx::raw_sql("CREATE FUNCTION parity_delete_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'parity delete failure'; END $$; CREATE TRIGGER parity_delete_failure BEFORE DELETE ON calendar_accounts FOR EACH ROW EXECUTE FUNCTION parity_delete_failure();").execute(&lab.db).await.expect("calendar fault");
    request(
        &mut lab,
        "calendar database failure",
        "DELETE",
        &format!("/email/links/{link}/calendar"),
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_log_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_log_failure", 41314).await;
    let link = lab.fixture.links[0];
    calendar::calendar(&mut lab, link, false, false).await;
    sqlx::raw_sql(
        "ALTER TABLE calendar_change_counters RENAME COLUMN seq TO parity_hidden_sequence",
    )
    .execute(&lab.db)
    .await
    .expect("calendar fault");
    request(
        &mut lab,
        "calendar database failure",
        "DELETE",
        &format!("/email/links/{link}/calendar"),
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_begin_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_begin_failure", 41317).await;
    let link = lab.fixture.links[0];
    lab.sql_fault.fail_acquisition(2);
    request(
        &mut lab,
        "calendar transaction cannot begin",
        "DELETE",
        &format!("/email/links/{link}/calendar"),
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_commit_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_commit_failure", 41612).await;
    sqlx::raw_sql("CREATE FUNCTION parity_calendar_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'parity calendar commit failure'; END $$; CREATE CONSTRAINT TRIGGER parity_calendar_commit_failure AFTER INSERT ON email_link_google_scopes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION parity_calendar_commit_failure();")
        .execute(&lab.db).await.expect("commit fault");
    let link = lab.fixture.links[0];
    request(
        &mut lab,
        "calendar commit rolls back",
        "DELETE",
        &format!("/email/links/{link}/calendar"),
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local notification query fault"
)]
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_refresh_query_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_refresh_query_failure", 41615).await;
    lab.drain_background = true;
    sqlx::query("ALTER TABLE macro_user_links RENAME TO parity_hidden_edges")
        .execute(&lab.db)
        .await
        .expect("refresh query fault");
    let link = lab.fixture.links[0];
    request(
        &mut lab,
        "refresh lookup failure does not fail disconnect",
        "DELETE",
        &format!("/email/links/{link}/calendar"),
        Auth::User(0),
        None,
        json!(null),
        204,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_refresh_http_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_refresh_http_failure", 41618).await;
    lab.drain_background = true;
    lab.stub
        .reply("POST", "/", 503, json!({"message":"gateway unavailable"}));
    let link = lab.fixture.links[0];
    request(
        &mut lab,
        "refresh HTTP failure does not fail disconnect",
        "DELETE",
        &format!("/email/links/{link}/calendar"),
        Auth::User(0),
        None,
        json!(null),
        204,
    )
    .await;
    lab.transcript.finish();
}
