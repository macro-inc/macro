use super::*;

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local runtime fixtures and query faults"
)]
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn create_jobs(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "create_jobs", 40027).await;
    for (name, inbox, count) in [
        ("own inbox", 0, json!(5)),
        ("second own inbox", 2, json!(null)),
        ("another owner inbox", 1, json!(0)),
    ] {
        let link = lab.fixture.links[inbox];
        let body = json!({"link_ids":[link],"num_threads":count});
        request(
            &mut lab,
            name,
            "POST",
            INTERNAL,
            Auth::InternalKeyOnly,
            None,
            body.clone(),
            200,
        )
        .await;
        request(
            &mut lab,
            "reuse active job without enqueue",
            "POST",
            INTERNAL,
            Auth::Internal,
            None,
            body,
            200,
        )
        .await;
    }
    let link = lab.fixture.links[0];
    request(
        &mut lab,
        "duplicates reuse same active job",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":[link,link]}),
        200,
    )
    .await;
    request(
        &mut lab,
        "empty link list",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":[]}),
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
async fn create_active_statuses(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "create_active_statuses", 40030).await;
    job(&mut lab, 1, Some(0), "Init").await;
    job(&mut lab, 2, Some(2), "InProgress").await;
    for status in ["Complete", "Failed", "Cancelled"] {
        job(&mut lab, 10 + status.len() as u32, Some(1), status).await;
    }
    let links = lab.fixture.links;
    request(
        &mut lab,
        "reuse both active statuses and create after terminals",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":links,"num_threads":91}),
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
async fn create_thread_bounds(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "create_thread_bounds", 40033).await;
    for (index, value) in [i32::MIN, -1, 0, 1, i32::MAX].into_iter().enumerate() {
        let link = lab.fixture.links[0];
        request(
            &mut lab,
            &format!("num_threads {value}"),
            "POST",
            INTERNAL,
            Auth::InternalKeyOnly,
            None,
            json!({"link_ids":[link],"num_threads":value}),
            200,
        )
        .await;
        let id: Uuid = sqlx::query_scalar(
            "SELECT id FROM email_backfill_jobs WHERE link_id=$1 AND status='Init'",
        )
        .bind(link)
        .fetch_one(&lab.db)
        .await
        .expect("created job");
        request(
            &mut lab,
            &format!("cancel bound {index}"),
            "DELETE",
            INTERNAL,
            Auth::InternalKeyOnly,
            None,
            json!({"job_id":id}),
            204,
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
async fn create_link_states(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "create_link_states", 40036).await;
    let link = lab.fixture.links[0];
    sqlx::query("UPDATE email_links SET is_sync_active=false WHERE id=$1")
        .bind(link)
        .execute(&lab.db)
        .await
        .expect("disable sync");
    request(
        &mut lab,
        "sync disabled",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":[link]}),
        400,
    )
    .await;
    sqlx::query("UPDATE email_links SET is_sync_active=true,needs_reauth=true WHERE id=$1")
        .bind(link)
        .execute(&lab.db)
        .await
        .expect("needs reauth");
    request(
        &mut lab,
        "needs reauth is accepted",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":[link]}),
        200,
    )
    .await;
    let outlook = OUTLOOK;
    request(
        &mut lab,
        "Outlook is enqueued to Gmail backfill",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":[outlook]}),
        200,
    )
    .await;
    request(
        &mut lab,
        "unknown link",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":[MISSING]}),
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
async fn create_partial_success(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "create_partial_success", 40039).await;
    let link = lab.fixture.links[0];
    request(
        &mut lab,
        "earlier link remains created when later link is missing",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":[link,MISSING]}),
        400,
    )
    .await;
    request(
        &mut lab,
        "retry partial request reuses earlier job",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":[link,MISSING]}),
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
async fn create_rejections(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "create_rejections", 40042).await;
    assert_eq!(
        lab.request(
            "absent JSON content type",
            "POST",
            INTERNAL,
            Auth::InternalKeyOnly,
            RequestBody::Empty
        )
        .await,
        415
    );
    for body in [
        json!({}),
        json!([]),
        json!(null),
        json!({"link_ids":null}),
        json!({"link_ids":["bad"]}),
        json!({"link_ids":[],"num_threads":2147483648_i64}),
        json!({"link_ids":[],"num_threads":-2147483649_i64}),
        json!({"link_ids":[],"num_threads":1.5}),
        json!({"link_ids":[],"num_threads":"1"}),
    ] {
        request(
            &mut lab,
            "invalid create JSON",
            "POST",
            INTERNAL,
            Auth::InternalKeyOnly,
            None,
            body,
            422,
        )
        .await;
    }
    for (name, bytes, content_type, status) in [
        ("malformed", b"{".to_vec(), "application/json", 400),
        ("empty", vec![], "application/json", 400),
        ("content type", b"{}".to_vec(), "text/plain", 415),
    ] {
        assert_eq!(
            lab.request(
                name,
                "POST",
                INTERNAL,
                Auth::InternalKeyOnly,
                RequestBody::Raw {
                    bytes,
                    content_type
                }
            )
            .await,
            status
        );
    }
    lab.transcript.finish();
}

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local runtime fixtures and query faults"
)]
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn create_queue_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "create_queue_failure", 40045).await;
    let link = lab.fixture.links[0];
    lab.sqs.set_outage(true);
    request(
        &mut lab,
        "queue failure persists failed job",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":[link]}),
        500,
    )
    .await;
    lab.sqs.set_outage(false);
    request(
        &mut lab,
        "retry after publication failure creates new job",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":[link]}),
        200,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn create_partial_queue_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "create_partial_queue_failure", 40400).await;
    let links = [lab.fixture.links[0], lab.fixture.links[2]];
    lab.sqs.fail_nth_send(2);
    request(
        &mut lab,
        "second publication fails after first succeeds",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":links}),
        500,
    )
    .await;
    request(
        &mut lab,
        "retry reuses first job and replaces failed second job",
        "POST",
        INTERNAL,
        Auth::InternalKeyOnly,
        None,
        json!({"link_ids":links}),
        200,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn create_cleanup_terminal_race(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "create_cleanup_terminal_race", 40403).await;
    // A terminal state reached before publication cleanup makes fail_backfill_job
    // return false; the handler still reports the enqueue error.
    sqlx::raw_sql("CREATE FUNCTION parity_complete_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.status='Complete'; RETURN NEW; END $$; CREATE TRIGGER parity_complete_insert BEFORE INSERT ON email_backfill_jobs FOR EACH ROW EXECUTE FUNCTION parity_complete_insert();")
        .execute(&lab.db).await.expect("terminal-state race");
    let link = lab.fixture.links[0];
    lab.sqs.set_outage(true);
    request(
        &mut lab,
        "publication cleanup finds a terminal job",
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
