use super::*;

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-specific calendar and scope fixtures"
)]
pub(super) async fn calendar(lab: &mut Lab, inbox: Uuid, watch: bool, outlook: bool) {
    let account = Uuid::from_u128(0x6100_0000_0000_0000_0000_0000_0000_0001);
    let calendar = Uuid::from_u128(0x6100_0000_0000_0000_0000_0000_0000_0002);
    lab.transcript
        .normalizer
        .symbol(account, "<calendar-account>");
    lab.transcript.normalizer.symbol(calendar, "<calendar>");
    sqlx::query("INSERT INTO calendar_accounts (id,owner_id,email_link_id,provider,provider_account_id) VALUES ($1,$2,$3,$4,'account')")
        .bind(account).bind(&lab.fixture.users[0]).bind(inbox).bind(if outlook {"outlook"} else {"google"})
        .execute(&lab.db).await.expect("calendar account");
    sqlx::query("INSERT INTO calendars (id,account_id,provider_calendar_id,name,watch_channel_id,watch_resource_id,sync_token) VALUES ($1,$2,'calendar','Calendar',$3,$4,'cursor')")
        .bind(calendar).bind(account).bind(watch.then_some("watch-channel")).bind(watch.then_some("watch-resource"))
        .execute(&lab.db).await.expect("calendar");
    if watch {
        // Use an uncached credential identity so the denying auth stub stops
        // channel cleanup before Google's fixed public endpoint.
        sqlx::query(
            "UPDATE email_links SET fusionauth_user_id=fusionauth_user_id || '-watch' WHERE id=$1",
        )
        .bind(inbox)
        .execute(&lab.db)
        .await
        .expect("uncached watch identity");
    }
    if outlook {
        sqlx::query("INSERT INTO email_link_microsoft_scopes (link_id,grant_generation,granted_scopes) VALUES ($1,0,ARRAY['Mail.ReadWrite','Calendars.ReadWrite'])")
            .bind(inbox).execute(&lab.db).await.expect("Outlook scopes");
    } else {
        sqlx::query("INSERT INTO email_link_google_scopes (link_id,granted_scopes,grant_version) VALUES ($1,ARRAY['https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/calendar'],2)")
            .bind(inbox).execute(&lab.db).await.expect("Google scopes");
    }
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_access(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_access", 41110).await;
    for (name, link, auth, status) in [
        (
            "delegated may not disconnect",
            lab.fixture.links[1],
            Auth::User(0),
            403,
        ),
        ("unrelated user", lab.fixture.links[0], Auth::User(2), 403),
        ("other owner", lab.fixture.links[0], Auth::User(1), 403),
        ("missing link", MISSING, Auth::User(0), 404),
    ] {
        request(
            &mut lab,
            name,
            "DELETE",
            &format!("/email/links/{link}/calendar"),
            auth,
            None,
            json!(null),
            status,
        )
        .await;
    }
    request(
        &mut lab,
        "invalid path UUID",
        "DELETE",
        "/email/links/bad/calendar",
        Auth::User(0),
        None,
        json!(null),
        400,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_without_account(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_without_account", 41113).await;
    lab.drain_background = true;
    for (name, link, auth) in [
        ("own empty calendar", lab.fixture.links[0], Auth::User(0)),
        ("repeat disconnect", lab.fixture.links[0], Auth::User(0)),
        ("second own inbox", lab.fixture.links[2], Auth::User(0)),
        ("internal acting user", lab.fixture.links[0], Auth::Internal),
    ] {
        request(
            &mut lab,
            name,
            "DELETE",
            &format!("/email/links/{link}/calendar"),
            auth,
            None,
            json!(null),
            204,
        )
        .await;
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_disconnect(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_disconnect", 41116).await;
    lab.drain_background = true;
    let link = lab.fixture.links[0];
    calendar(&mut lab, link, false, false).await;
    request(
        &mut lab,
        "remove calendar and scopes without provider call",
        "DELETE",
        &format!("/email/links/{link}/calendar"),
        Auth::User(0),
        None,
        json!(null),
        204,
    )
    .await;
    request(
        &mut lab,
        "repeat calendar disconnect",
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
async fn calendar_outlook(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_outlook", 41119).await;
    lab.drain_background = true;
    calendar(&mut lab, fixture::OUTLOOK, false, true).await;
    request(
        &mut lab,
        "Outlook disconnect does not call Graph",
        "DELETE",
        &format!("/email/links/{}/calendar", fixture::OUTLOOK),
        Auth::User(0),
        None,
        json!(null),
        204,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_watch_token_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_watch_token_failure", 41122).await;
    lab.drain_background = true;
    let link = lab.fixture.links[0];
    calendar(&mut lab, link, true, false).await;
    // The uncached watch identity reaches only the rejecting local auth stub.
    request(
        &mut lab,
        "calendar removed when watch credentials fail",
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

#[expect(
    clippy::disallowed_methods,
    reason = "An acquisition barrier reproduces a disappearing inbox without polling"
)]
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn calendar_disappears_after_authorization(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "calendar_disappears_after_authorization", 41609).await;
    let link = lab.fixture.links[0];
    let db = lab.db.clone();
    let (arrived, release) = lab.sql_fault.pause_acquisition(2);
    let change = async move {
        arrived.await.expect("authorized lookup completed");
        sqlx::query("DELETE FROM email_links WHERE id=$1")
            .bind(link)
            .execute(&db)
            .await
            .expect("concurrent deletion");
        release.send(()).expect("resume transaction");
    };
    let path = format!("/email/links/{link}/calendar");
    let request = request(
        &mut lab,
        "inbox disappears after authorization",
        "DELETE",
        &path,
        Auth::User(0),
        None,
        json!(null),
        404,
    );
    tokio::join!(change, request);
    lab.transcript.finish();
}
