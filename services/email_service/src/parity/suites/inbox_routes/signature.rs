use super::*;

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn import_alias_selection(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "import_alias_selection", 41021).await;
    sqlx::query("INSERT INTO email_settings (link_id,signature_on_replies_forwards,read_receipts_enabled,signature) VALUES ($1,true,false,'Previous signature')")
        .bind(lab.fixture.links[0]).execute(&lab.db).await.expect("settings preserved by import");
    // Read the actual fixture address instead of relying on shard formatting.
    let own: String = sqlx::query_scalar("SELECT email_address FROM email_links WHERE id=$1")
        .bind(lab.fixture.links[0])
        .fetch_one(&lab.db)
        .await
        .expect("address");
    for (name, aliases, status) in [
        (
            "own alias wins over primary",
            json!({"sendAs":[{"sendAsEmail":"primary@example.com","isPrimary":true,"signature":"wrong"},{"sendAsEmail":own.to_uppercase(),"signature":"<b>Own</b><script>bad()</script>"}]}),
            200,
        ),
        (
            "fallback primary",
            json!({"sendAs":[{"sendAsEmail":"other@example.com","isPrimary":false,"signature":"wrong"},{"sendAsEmail":"primary@example.com","isPrimary":true,"signature":"Primary"}]}),
            200,
        ),
        (
            "no primary flag",
            json!({"sendAs":[{"sendAsEmail":"other@example.com","signature":"wrong"}]}),
            404,
        ),
        ("missing aliases", json!({}), 404),
        ("empty aliases", json!({"sendAs":[]}), 404),
        ("null aliases", json!({"sendAs":null}), 404),
        (
            "own alias without signature does not fall back",
            json!({"sendAs":[{"sendAsEmail":own,"signature":null},{"sendAsEmail":"primary@example.com","isPrimary":true,"signature":"Primary"}]}),
            404,
        ),
        (
            "whitespace signature",
            json!({"sendAs":[{"sendAsEmail":own,"signature":"  \n "}]}),
            404,
        ),
        (
            "empty signature",
            json!({"sendAs":[{"sendAsEmail":own,"signature":""}]}),
            404,
        ),
        (
            "first matching alias",
            json!({"sendAs":[{"sendAsEmail":own,"signature":"first"},{"sendAsEmail":own,"signature":"second"}]}),
            200,
        ),
    ] {
        fixture::gmail(&lab, aliases);
        request(
            &mut lab,
            name,
            "POST",
            IMPORT,
            Auth::User(0),
            None,
            json!(null),
            status,
        )
        .await;
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn import_inboxes(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "import_inboxes", 41024).await;
    fixture::gmail(
        &lab,
        json!({"sendAs":[{"sendAsEmail":"primary@example.com","isPrimary":true,"signature":"Imported"}]}),
    );
    for (name, auth, inbox, status) in [
        ("own", Auth::User(0), None, 200),
        ("second own", Auth::User(0), Some(lab.fixture.links[2]), 200),
        ("delegated", Auth::User(0), Some(lab.fixture.links[1]), 200),
        ("internal", Auth::Internal, None, 200),
        ("repeat", Auth::User(0), None, 200),
        (
            "Outlook stops before Graph",
            Auth::User(0),
            Some(fixture::OUTLOOK),
            502,
        ),
        ("missing", Auth::User(0), Some(MISSING), 404),
        (
            "inaccessible",
            Auth::User(2),
            Some(lab.fixture.links[0]),
            404,
        ),
    ] {
        request(
            &mut lab,
            name,
            "POST",
            IMPORT,
            auth,
            inbox,
            json!(null),
            status,
        )
        .await;
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn import_provider_errors(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "import_provider_errors", 41027).await;
    fixture::gmail(&lab, json!({"sendAs":[]}));
    for status in [400, 401, 403, 404, 429, 500, 503] {
        lab.gmail.lock().send_as = Some((
            status,
            json!({"error":{"code":status,"message":"scripted provider error"}}),
        ));
        request(
            &mut lab,
            &format!("Gmail HTTP {status}"),
            "POST",
            IMPORT,
            Auth::User(0),
            None,
            json!(null),
            502,
        )
        .await;
    }
    lab.gmail.lock().send_as = Some((200, json!({"sendAs":"malformed"})));
    request(
        &mut lab,
        "invalid Gmail response schema",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!(null),
        502,
    )
    .await;
    lab.gmail.lock().drop_send_as = true;
    request(
        &mut lab,
        "Gmail drops connection",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!(null),
        502,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn import_token_errors(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "import_token_errors", 41030).await;
    for status in [401, 403, 404, 429, 500] {
        lab.stub.reply(
            "GET",
            "/internal/google_access_token",
            status,
            json!({"message":"scripted token failure"}),
        );
        request(
            &mut lab,
            &format!("token HTTP {status}"),
            "POST",
            IMPORT,
            Auth::User(0),
            None,
            json!(null),
            502,
        )
        .await;
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn import_images(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "import_images", 41033).await;
    let url = fixture::image(&lab);
    fixture::gmail(
        &lab,
        json!({"sendAs":[{"sendAsEmail":"primary@example.com","isPrimary":true,"signature":format!("<p>Imported</p><img src=\"{url}\">")}]}),
    );
    request(
        &mut lab,
        "import rehosts image",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!(null),
        200,
    )
    .await;
    request(
        &mut lab,
        "repeat uses image mapping",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!(null),
        200,
    )
    .await;
    lab.stub.reply("GET", "/private", 404, json!({}));
    fixture::gmail(
        &lab,
        json!({"sendAs":[{"sendAsEmail":"primary@example.com","isPrimary":true,"signature":format!("<img src=\"{}/private\">",lab.stub.url)}]}),
    );
    request(
        &mut lab,
        "unresolved import saves nothing",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!(null),
        422,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn import_reauth_recovery(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "import_reauth_recovery", 41621).await;
    lab.stub.reply(
        "GET",
        "/internal/google_access_token",
        403,
        json!({"message":"revoked grant"}),
    );
    request(
        &mut lab,
        "revoked grant marks reauth",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!(null),
        502,
    )
    .await;
    request(
        &mut lab,
        "already marked reauth does not renotify",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!(null),
        502,
    )
    .await;
    fixture::gmail(
        &lab,
        json!({"sendAs":[{"sendAsEmail":"primary@example.com","isPrimary":true,"signature":"Recovered"}]}),
    );
    request(
        &mut lab,
        "successful token clears reauth",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!(null),
        200,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn import_reauth_notification_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "import_reauth_notification_failure", 41624).await;
    lab.sqs.set_outage(true);
    lab.stub.reply(
        "GET",
        "/internal/google_access_token",
        403,
        json!({"message":"revoked grant"}),
    );
    request(
        &mut lab,
        "reauth notification queue outage",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!(null),
        502,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn import_reauth_write_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "import_reauth_write_failure", 41627).await;
    lab.stub.reply(
        "GET",
        "/internal/google_access_token",
        403,
        json!({"message":"revoked grant"}),
    );
    lab.sql_fault.fail_acquisition(3);
    request(
        &mut lab,
        "reauth state write failure",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!(null),
        502,
    )
    .await;
    lab.transcript.finish();
}
