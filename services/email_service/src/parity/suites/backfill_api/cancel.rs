use super::*;

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local runtime fixtures and query faults"
)]
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn cancel_public_statuses(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "cancel_public_statuses", 40018).await;
    for (index, status) in ["Init", "InProgress", "Complete", "Failed", "Cancelled"]
        .into_iter()
        .enumerate()
    {
        let id = job(&mut lab, index as u32, Some(0), status).await;
        let expected = if index < 2 { 204 } else { 400 };
        request(
            &mut lab,
            &format!("cancel {status}"),
            "DELETE",
            PUBLIC,
            Auth::User(0),
            None,
            json!({"job_id":id}),
            expected,
        )
        .await;
        request(
            &mut lab,
            &format!("repeat cancel {status}"),
            "DELETE",
            PUBLIC,
            Auth::User(0),
            None,
            json!({"job_id":id}),
            400,
        )
        .await;
    }
    let own = job(&mut lab, 8, Some(2), "Init").await;
    let delegated = job(&mut lab, 9, Some(1), "Init").await;
    for (name, id, inbox, auth, status) in [
        ("wrong inbox", own, None, Auth::User(0), 404),
        (
            "second own inbox",
            own,
            Some(lab.fixture.links[2]),
            Auth::User(0),
            204,
        ),
        (
            "inaccessible inbox",
            delegated,
            Some(lab.fixture.links[1]),
            Auth::User(2),
            404,
        ),
        (
            "delegated cancellation",
            delegated,
            Some(lab.fixture.links[1]),
            Auth::User(0),
            204,
        ),
        ("missing job", MISSING, None, Auth::User(0), 404),
    ] {
        request(
            &mut lab,
            name,
            "DELETE",
            PUBLIC,
            auth,
            inbox,
            json!({"job_id":id}),
            status,
        )
        .await;
    }
    let id = job(&mut lab, 10, Some(0), "Init").await;
    request(
        &mut lab,
        "internal acting user cancellation",
        "DELETE",
        PUBLIC,
        Auth::Internal,
        None,
        json!({"job_id":id}),
        204,
    )
    .await;
    lab.transcript.finish();
}

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local runtime fixtures and query faults"
)]
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn cancel_internal_statuses(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "cancel_internal_statuses", 40021).await;
    for (index, status) in ["Init", "InProgress", "Complete", "Failed", "Cancelled"]
        .into_iter()
        .enumerate()
    {
        let id = job(&mut lab, index as u32, Some(1), status).await;
        request(
            &mut lab,
            &format!("internal cancel {status}"),
            "DELETE",
            INTERNAL,
            Auth::InternalKeyOnly,
            None,
            json!({"job_id":id}),
            if index < 2 { 204 } else { 400 },
        )
        .await;
        request(
            &mut lab,
            &format!("repeat internal cancel {status}"),
            "DELETE",
            INTERNAL,
            Auth::Internal,
            None,
            json!({"job_id":id}),
            400,
        )
        .await;
    }
    request(
        &mut lab,
        "internal missing job",
        "DELETE",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"job_id":MISSING}),
        404,
    )
    .await;
    lab.transcript.finish();
}

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local runtime fixtures and query faults"
)]
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn cancel_rejections(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "cancel_rejections", 40024).await;
    for path in [PUBLIC, INTERNAL] {
        let auth = if path == PUBLIC {
            Auth::User(0)
        } else {
            Auth::InternalKeyOnly
        };
        assert_eq!(
            lab.request(
                "absent JSON content type",
                "DELETE",
                path,
                auth,
                RequestBody::Empty
            )
            .await,
            415
        );
        for body in [
            json!({}),
            json!({"job_id":"bad"}),
            json!({"job_id":null}),
            json!({"job_id":42}),
            json!([]),
            json!(null),
        ] {
            request(
                &mut lab,
                "invalid cancel JSON shape",
                "DELETE",
                path,
                auth,
                None,
                body,
                422,
            )
            .await;
        }
        for (name, bytes, content_type, status) in [
            ("malformed JSON", b"{".to_vec(), "application/json", 400),
            ("empty body", vec![], "application/json", 400),
            ("wrong content type", b"{}".to_vec(), "text/plain", 415),
        ] {
            assert_eq!(
                lab.request(
                    name,
                    "DELETE",
                    path,
                    auth,
                    RequestBody::Raw {
                        bytes,
                        content_type
                    }
                )
                .await,
                status
            );
        }
    }
    lab.transcript.finish();
}
