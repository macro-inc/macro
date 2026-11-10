use super::*;

enum Scenario {
    FirstInbox,
    AdditionalInbox,
    Reconnect,
    ReconnectReauth,
    SameUser,
    Delegate,
    Bootstrap,
    SharedConflict,
    SharedPromote,
    SharedRelocationFailure,
    Calendar,
    IncidentalOptOut,
    CalendarReenable,
    ExistingBackfill,
    RecordedGrant,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local inbox and grant fixture SQL"
)]
async fn run(pool: PgPool, name: &'static str, shard: u32, scenario: Scenario) {
    let (mut lab, _redis) = start(pool, name, shard).await;
    match scenario {
        Scenario::FirstInbox => {
            init(&mut lab, "first inbox", Auth::User(2), "", 200).await;
            init(&mut lab, "same init twice", Auth::User(2), "", 400).await;
        }
        Scenario::AdditionalInbox => {
            professional(&lab, 0).await;
            attempt(
                &lab,
                0,
                Some("additional@example.com"),
                "GMAIL",
                &[GMAIL_SCOPE],
                &[GMAIL_SCOPE],
            )
            .await;
            init(&mut lab, "additional inbox", Auth::User(0), &query(), 200).await;
            init(&mut lab, "consumed attempt", Auth::User(0), &query(), 500).await;
        }
        Scenario::Reconnect | Scenario::ReconnectReauth | Scenario::SameUser => {
            let email = if matches!(scenario, Scenario::SameUser) {
                "parity-a@example.com".to_owned()
            } else {
                sqlx::query_scalar("SELECT email_address::text FROM email_links WHERE id=$1")
                    .bind(lab.fixture.links[2])
                    .fetch_one(&lab.db)
                    .await
                    .expect("secondary address")
            };
            if matches!(scenario, Scenario::ReconnectReauth) {
                sqlx::query("UPDATE email_links SET needs_reauth=true,is_sync_active=false,last_sync_error_at='2026-01-01' WHERE id=$1")
                    .bind(lab.fixture.links[2]).execute(&lab.db).await.expect("reauth inbox");
            }
            attempt(
                &lab,
                0,
                Some(&email),
                "GMAIL",
                &[GMAIL_SCOPE],
                &[GMAIL_SCOPE],
            )
            .await;
            init(
                &mut lab,
                "completed consent on existing inbox",
                Auth::User(0),
                &query(),
                200,
            )
            .await;
            if matches!(scenario, Scenario::Reconnect) {
                sqlx::query(
                    "UPDATE email_links SET fusionauth_user_id='previous-grant-owner' WHERE id=$1",
                )
                .bind(lab.fixture.links[2])
                .execute(&lab.db)
                .await
                .expect("replaced grant identity");
                attempt(
                    &lab,
                    0,
                    Some(&email),
                    "GMAIL",
                    &[GMAIL_SCOPE],
                    &[GMAIL_SCOPE],
                )
                .await;
                init(
                    &mut lab,
                    "own inbox with a different stored grant identity",
                    Auth::User(0),
                    &query(),
                    200,
                )
                .await;
            }
        }
        Scenario::Delegate => {
            attempt(&lab, 0, Some("parity-b@example.com"), "GMAIL", &[], &[]).await;
            init(
                &mut lab,
                "idempotent existing delegation",
                Auth::User(0),
                &query(),
                200,
            )
            .await;
        }
        Scenario::Bootstrap => {
            sqlx::query("DELETE FROM email_links WHERE id=$1")
                .bind(lab.fixture.links[1])
                .execute(&lab.db)
                .await
                .expect("child without inbox");
            attempt(
                &lab,
                2,
                Some("parity-b@example.com"),
                "GMAIL",
                &[GMAIL_SCOPE],
                &[GMAIL_SCOPE],
            )
            .await;
            init(
                &mut lab,
                "bootstrap child identity",
                Auth::User(2),
                &query(),
                200,
            )
            .await;
        }
        Scenario::SharedConflict | Scenario::SharedPromote | Scenario::SharedRelocationFailure => {
            let email: String =
                sqlx::query_scalar("SELECT email_address::text FROM email_links WHERE id=$1")
                    .bind(lab.fixture.links[2])
                    .fetch_one(&lab.db)
                    .await
                    .expect("shared address");
            attempt(&lab, 2, Some(&email), "GMAIL", &[], &[]).await;
            if matches!(scenario, Scenario::SharedRelocationFailure) {
                lab.stub.reply(
                    "POST",
                    "/internal/relocate_inbox_grant",
                    503,
                    json!({"error":"unavailable"}),
                );
            }
            init(
                &mut lab,
                "shared inbox needs confirmation",
                Auth::User(2),
                &query(),
                409,
            )
            .await;
            if !matches!(scenario, Scenario::SharedConflict) {
                init(
                    &mut lab,
                    "confirm shared inbox",
                    Auth::User(2),
                    &format!("{}&force_share=true", query()),
                    200,
                )
                .await;
            }
        }
        Scenario::Calendar | Scenario::IncidentalOptOut | Scenario::CalendarReenable => {
            let link = lab.fixture.links[0];
            let requested = if matches!(scenario, Scenario::IncidentalOptOut) {
                vec![GMAIL_SCOPE]
            } else {
                vec![GMAIL_SCOPE, CALENDAR_SCOPE, CALENDAR_LIST_SCOPE]
            };
            if !matches!(scenario, Scenario::Calendar) {
                sqlx::query("INSERT INTO email_link_google_scopes(link_id,grant_version,granted_scopes,calendar_disabled_at) VALUES($1,2,ARRAY[$2], '2026-01-01')")
                    .bind(link).bind(GMAIL_SCOPE).execute(&lab.db).await.expect("calendar opt out");
            }
            attempt(
                &lab,
                0,
                Some("parity-a@example.com"),
                "GMAIL",
                &requested,
                &[GMAIL_SCOPE, CALENDAR_SCOPE, CALENDAR_LIST_SCOPE],
            )
            .await;
            init(
                &mut lab,
                "calendar grant follows requested consent",
                Auth::User(0),
                &query(),
                200,
            )
            .await;
        }
        Scenario::ExistingBackfill => {
            sql(&lab,"CREATE FUNCTION parity_active_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO email_backfill_jobs(id,link_id,fusionauth_user_id,status) VALUES('6a000000-0000-0000-0000-000000000003',NEW.id,NEW.fusionauth_user_id,'InProgress'); RETURN NEW; END $$; CREATE TRIGGER parity_active_job AFTER INSERT ON email_links FOR EACH ROW EXECUTE FUNCTION parity_active_job();").await;
            init(&mut lab, "reuse active backfill", Auth::User(2), "", 200).await;
        }
        Scenario::RecordedGrant => {
            sql(&lab,"CREATE FUNCTION parity_record_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO email_link_google_scopes(link_id,grant_version) VALUES(NEW.id,1); RETURN NEW; END $$; CREATE TRIGGER parity_record_grant AFTER INSERT ON email_links FOR EACH ROW EXECUTE FUNCTION parity_record_grant();").await;
            init(
                &mut lab,
                "recorded grant skips token discovery",
                Auth::User(2),
                "",
                200,
            )
            .await;
        }
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn init_first_inbox(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "init_first_inbox", 52000, Scenario::FirstInbox).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn init_additional_inbox(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "init_additional_inbox",
        52003,
        Scenario::AdditionalInbox,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn init_reconnect(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "init_reconnect", 52006, Scenario::Reconnect).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn init_reconnect_reauth(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "init_reconnect_reauth",
        52009,
        Scenario::ReconnectReauth,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn init_same_user(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "init_same_user", 52012, Scenario::SameUser).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn init_delegate(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "init_delegate", 52015, Scenario::Delegate).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn init_bootstrap(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "init_bootstrap", 52018, Scenario::Bootstrap).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn init_shared_conflict(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "init_shared_conflict",
        52021,
        Scenario::SharedConflict,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn init_shared_promote(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "init_shared_promote", 52024, Scenario::SharedPromote).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn init_shared_relocation_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "init_shared_relocation_failure",
        52027,
        Scenario::SharedRelocationFailure,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn init_calendar(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "init_calendar", 52030, Scenario::Calendar).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn init_incidental_opt_out(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "init_incidental_opt_out",
        52033,
        Scenario::IncidentalOptOut,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn init_calendar_reenable(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "init_calendar_reenable",
        52036,
        Scenario::CalendarReenable,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn init_existing_backfill(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "init_existing_backfill",
        52039,
        Scenario::ExistingBackfill,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn init_recorded_grant(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "init_recorded_grant", 52042, Scenario::RecordedGrant).await;
}
