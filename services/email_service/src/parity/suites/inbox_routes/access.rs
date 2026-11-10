use super::*;

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn inbox_auth(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "inbox_auth", 41600).await;
    let calendar = format!("/email/links/{}/calendar", lab.fixture.links[0]);
    for (method, path) in [
        ("GET", CONTACTS),
        ("GET", SCHEDULED),
        ("PATCH", SETTINGS),
        ("POST", IMPORT),
        ("DELETE", calendar.as_str()),
    ] {
        for (name, auth) in [
            ("missing credentials", Auth::MissingCredentials),
            ("invalid bearer", Auth::InvalidBearer),
            ("wrong internal key", Auth::WrongInternalKey),
            ("identity without key", Auth::MissingInternalKey),
            ("internal key without user", Auth::InternalKeyOnly),
        ] {
            let status = if matches!(auth, Auth::InternalKeyOnly) {
                if path == CONTACTS {
                    200
                } else if method == "DELETE" {
                    403
                } else {
                    400
                }
            } else {
                401
            };
            request(
                &mut lab,
                name,
                method,
                path,
                auth,
                None,
                json!({"settings":{}}),
                status,
            )
            .await;
        }
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn inbox_headers(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "inbox_headers", 41603).await;
    for (method, path) in [("GET", SCHEDULED), ("PATCH", SETTINGS), ("POST", IMPORT)] {
        for (name, value) in [
            ("malformed header", b"bad".as_slice()),
            ("empty header", b""),
            ("non UTF8 header", b"\xff"),
        ] {
            let body = if method == "PATCH" {
                RequestBody::Json(json!({"settings":{}}))
            } else {
                RequestBody::Empty
            };
            assert_eq!(
                lab.request_with_headers(
                    name,
                    method,
                    path,
                    Auth::User(0),
                    body,
                    &[("x-email-link-id", value)]
                )
                .await,
                400
            );
        }
    }
    let header = format!("  {}  ", lab.fixture.links[2]);
    assert_eq!(
        lab.request_with_headers(
            "header whitespace trimmed",
            "GET",
            SCHEDULED,
            Auth::User(0),
            RequestBody::Empty,
            &[("x-email-link-id", header.as_bytes())]
        )
        .await,
        200
    );
    let compact = lab.fixture.links[2].simple().to_string();
    assert_eq!(
        lab.request_with_headers(
            "compact UUID accepted",
            "GET",
            SCHEDULED,
            Auth::User(0),
            RequestBody::Empty,
            &[("x-email-link-id", compact.as_bytes())]
        )
        .await,
        200
    );
    lab.transcript.finish();
}

#[expect(
    clippy::disallowed_methods,
    reason = "Fixture primary selection is mutated without touching production"
)]
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn no_owned_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "no_owned_primary", 41606).await;
    sqlx::query(
        "UPDATE email_links SET email_address='nonprimary-' || email_address WHERE macro_id=$1",
    )
    .bind(&lab.fixture.users[0])
    .execute(&lab.db)
    .await
    .expect("remove owned primary");
    for (method, path) in [("GET", SCHEDULED), ("PATCH", SETTINGS), ("POST", IMPORT)] {
        request(
            &mut lab,
            "delegated primary cannot select default",
            method,
            path,
            Auth::User(0),
            None,
            json!({"settings":{}}),
            400,
        )
        .await;
    }
    let link = lab.fixture.links[0];
    request(
        &mut lab,
        "explicit inbox works without primary",
        "PATCH",
        SETTINGS,
        Auth::User(0),
        Some(link),
        json!({"settings":{}}),
        200,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn repeated_inbox_header(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "repeated_inbox_header", 41630).await;
    let selected = lab.fixture.links[2].to_string();
    assert_eq!(
        lab.request_with_headers(
            "first valid header wins",
            "GET",
            SCHEDULED,
            Auth::User(0),
            RequestBody::Empty,
            &[
                ("x-email-link-id", selected.as_bytes()),
                ("x-email-link-id", b"bad")
            ]
        )
        .await,
        200
    );
    assert_eq!(
        lab.request_with_headers(
            "first invalid header wins",
            "GET",
            SCHEDULED,
            Auth::User(0),
            RequestBody::Empty,
            &[
                ("x-email-link-id", b"bad"),
                ("x-email-link-id", selected.as_bytes())
            ]
        )
        .await,
        400
    );
    lab.transcript.finish();
}
