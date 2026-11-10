use super::*;

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local runtime fixtures and query faults"
)]
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn list_jobs(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "list_jobs", 40000).await;
    for (index, status) in ["Init", "Complete", "Failed", "Cancelled"]
        .into_iter()
        .enumerate()
    {
        job(&mut lab, index as u32, Some(0), status).await;
    }
    job(&mut lab, 10, Some(2), "InProgress").await;
    job(&mut lab, 11, Some(1), "Init").await;
    job(&mut lab, 12, None, "Complete").await;
    for (name, auth) in [
        ("all own inboxes including deleted link", Auth::User(0)),
        ("other owner", Auth::User(1)),
        ("no jobs", Auth::User(2)),
        ("internal acting user", Auth::Internal),
    ] {
        request(&mut lab, name, "GET", PUBLIC, auth, None, json!(null), 200).await;
    }
    request(
        &mut lab,
        "collection ignores unknown query",
        "GET",
        &format!("{PUBLIC}?limit=0&offset=-1"),
        Auth::User(0),
        Some(MISSING),
        json!(null),
        200,
    )
    .await;
    assert_eq!(
        lab.request_with_headers(
            "collection ignores malformed inbox header",
            "GET",
            PUBLIC,
            Auth::User(0),
            RequestBody::Empty,
            &[("x-email-link-id", b"bad")]
        )
        .await,
        200
    );
    request(
        &mut lab,
        "repeat collection",
        "GET",
        PUBLIC,
        Auth::User(0),
        None,
        json!(null),
        200,
    )
    .await;
    lab.transcript.finish();
}

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local runtime fixtures and query faults"
)]
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn list_limit(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "list_limit", 40003).await;
    for index in 0..103 {
        job(
            &mut lab,
            index,
            Some(if index % 2 == 0 { 0 } else { 2 }),
            "Complete",
        )
        .await;
    }
    request(
        &mut lab,
        "newest one hundred across owned inboxes",
        "GET",
        PUBLIC,
        Auth::User(0),
        None,
        json!(null),
        200,
    )
    .await;
    lab.transcript.finish();
}

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local runtime fixtures and query faults"
)]
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn read_jobs(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "read_jobs", 40006).await;
    let own = job(&mut lab, 1, Some(0), "Init").await;
    let second = job(&mut lab, 2, Some(2), "InProgress").await;
    let delegated = job(&mut lab, 3, Some(1), "Complete").await;
    let outlook = job(&mut lab, 4, Some(3), "Complete").await;
    for (name, id, inbox, auth, status) in [
        ("primary inbox", own, None, Auth::User(0), 200),
        ("Outlook inbox", outlook, Some(OUTLOOK), Auth::User(0), 200),
        (
            "second own inbox",
            second,
            Some(lab.fixture.links[2]),
            Auth::User(0),
            200,
        ),
        (
            "delegated inbox",
            delegated,
            Some(lab.fixture.links[1]),
            Auth::User(0),
            200,
        ),
        (
            "internal still scoped",
            delegated,
            None,
            Auth::Internal,
            404,
        ),
        (
            "internal explicit delegated inbox",
            delegated,
            Some(lab.fixture.links[1]),
            Auth::Internal,
            200,
        ),
        (
            "wrong inbox",
            own,
            Some(lab.fixture.links[2]),
            Auth::User(0),
            404,
        ),
        ("missing job", MISSING, None, Auth::User(0), 404),
        (
            "inaccessible inbox",
            own,
            Some(lab.fixture.links[0]),
            Auth::User(1),
            404,
        ),
        ("unknown inbox", own, Some(MISSING), Auth::User(0), 404),
        ("repeat read", own, None, Auth::User(0), 200),
    ] {
        request(
            &mut lab,
            name,
            "GET",
            &format!("{PUBLIC}/{id}"),
            auth,
            inbox,
            json!(null),
            status,
        )
        .await;
    }
    request(
        &mut lab,
        "malformed job id",
        "GET",
        &format!("{PUBLIC}/bad"),
        Auth::User(0),
        None,
        json!(null),
        400,
    )
    .await;
    request(
        &mut lab,
        "internal unscoped read",
        "GET",
        &format!("{INTERNAL}/{delegated}"),
        Auth::InternalKeyOnly,
        None,
        json!(null),
        200,
    )
    .await;
    request(
        &mut lab,
        "internal missing job",
        "GET",
        &format!("{INTERNAL}/{MISSING}"),
        Auth::Internal,
        None,
        json!(null),
        404,
    )
    .await;
    request(
        &mut lab,
        "internal malformed job id",
        "GET",
        &format!("{INTERNAL}/bad"),
        Auth::InternalKeyOnly,
        None,
        json!(null),
        400,
    )
    .await;
    lab.transcript.finish();
}

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local runtime fixtures and query faults"
)]
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn active_jobs(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "active_jobs", 40009).await;
    request(
        &mut lab,
        "no active job",
        "GET",
        &format!("{PUBLIC}/active"),
        Auth::User(0),
        None,
        json!(null),
        204,
    )
    .await;
    for (index, status) in ["Complete", "Failed", "Cancelled"].into_iter().enumerate() {
        job(&mut lab, index as u32, Some(0), status).await;
    }
    request(
        &mut lab,
        "terminal jobs excluded",
        "GET",
        &format!("{PUBLIC}/active"),
        Auth::User(0),
        None,
        json!(null),
        204,
    )
    .await;
    job(&mut lab, 4, Some(0), "Init").await;
    job(&mut lab, 5, Some(2), "InProgress").await;
    job(&mut lab, 6, Some(1), "Init").await;
    for (name, inbox, auth, status) in [
        ("init job", None, Auth::User(0), 200),
        (
            "in progress on second inbox",
            Some(lab.fixture.links[2]),
            Auth::User(0),
            200,
        ),
        (
            "delegated init",
            Some(lab.fixture.links[1]),
            Auth::User(0),
            200,
        ),
        ("internal active", None, Auth::Internal, 200),
        (
            "other owner denied",
            Some(lab.fixture.links[0]),
            Auth::User(1),
            404,
        ),
        ("repeat active", None, Auth::User(0), 200),
    ] {
        request(
            &mut lab,
            name,
            "GET",
            &format!("{PUBLIC}/active"),
            auth,
            inbox,
            json!(null),
            status,
        )
        .await;
    }
    lab.transcript.finish();
}

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local runtime fixtures and query faults"
)]
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn backfill_auth(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "backfill_auth", 40012).await;
    let id = job(&mut lab, 1, Some(0), "Init").await;
    for (method, path, body) in [
        ("GET", PUBLIC.to_string(), json!(null)),
        ("GET", format!("{PUBLIC}/{id}"), json!(null)),
        ("GET", format!("{PUBLIC}/active"), json!(null)),
        ("DELETE", PUBLIC.to_string(), json!({"job_id":id})),
    ] {
        for (name, auth, status) in [
            ("unauthenticated", Auth::MissingCredentials, 401),
            ("invalid bearer", Auth::InvalidBearer, 401),
            ("wrong internal key", Auth::WrongInternalKey, 401),
            ("key without identity", Auth::InternalKeyOnly, 401),
            ("identity without key", Auth::MissingInternalKey, 401),
        ] {
            let status = if matches!(auth, Auth::InternalKeyOnly) {
                if method == "GET" && path == PUBLIC {
                    200
                } else {
                    400
                }
            } else {
                status
            };
            request(
                &mut lab,
                name,
                method,
                &path,
                auth,
                None,
                body.clone(),
                status,
            )
            .await;
        }
    }
    for (method, path, body) in [
        ("GET", format!("{INTERNAL}/{id}"), json!(null)),
        ("POST", INTERNAL.to_string(), json!({"link_ids":[]})),
        ("DELETE", INTERNAL.to_string(), json!({"job_id":id})),
    ] {
        for (name, auth, status) in [
            ("unauthenticated", Auth::MissingCredentials, 401),
            ("invalid bearer", Auth::InvalidBearer, 401),
            ("wrong internal key", Auth::WrongInternalKey, 401),
            ("identity without key", Auth::MissingInternalKey, 401),
            ("user is not internal", Auth::User(0), 403),
        ] {
            request(
                &mut lab,
                name,
                method,
                &path,
                auth,
                None,
                body.clone(),
                status,
            )
            .await;
        }
    }
    lab.transcript.finish();
}

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local runtime fixtures and query faults"
)]
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn backfill_headers(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "backfill_headers", 40015).await;
    for path in [format!("{PUBLIC}/active"), format!("{PUBLIC}/{MISSING}")] {
        for (name, header) in [
            ("malformed", b"bad".as_slice()),
            ("empty", b""),
            ("non UTF8", b"\xff"),
        ] {
            assert_eq!(
                lab.request_with_headers(
                    name,
                    "GET",
                    &path,
                    Auth::User(0),
                    RequestBody::Empty,
                    &[("x-email-link-id", header)]
                )
                .await,
                400
            );
        }
    }
    request(
        &mut lab,
        "no primary for unrelated user",
        "GET",
        &format!("{PUBLIC}/active"),
        Auth::User(2),
        None,
        json!(null),
        400,
    )
    .await;
    lab.transcript.finish();
}
