use super::*;

enum Scenario {
    Existing,
    Auth,
    Query,
    WrongOwner,
    Pending,
    OtherProvider,
    Missing,
    InvalidEmail,
    FreeLimit,
    BoundaryLimit,
    DelegationLimit,
}

async fn run(pool: PgPool, name: &'static str, shard: u32, scenario: Scenario) {
    let (mut lab, _redis) = start(pool, name, shard).await;
    match scenario {
        Scenario::Existing => {
            init(&mut lab, "existing primary", Auth::User(0), "", 400).await;
            init(
                &mut lab,
                "force share does not bypass initialization",
                Auth::User(0),
                "?force_share=true",
                400,
            )
            .await;
        }
        Scenario::Auth => {
            for auth in [
                Auth::InvalidBearer,
                Auth::MissingInternalKey,
                Auth::WrongInternalKey,
            ] {
                init(&mut lab, "invalid credentials", auth, "", 401).await;
            }
            init(
                &mut lab,
                "internal acting identity",
                Auth::Internal,
                "",
                400,
            )
            .await;
            init(
                &mut lab,
                "key without a fusion UUID",
                Auth::InternalKeyOnly,
                &query(),
                400,
            )
            .await;
        }
        Scenario::Query => {
            for query in [
                "?link_id=",
                "?link_id=bad",
                "?force_share=1",
                "?force_share=",
                "?force_share=FALSE",
                "?force_share=true&force_share=false",
                "?link_id=6a000000-0000-0000-0000-000000000001&link_id=6a000000-0000-0000-0000-000000000002",
            ] {
                init(&mut lab, "query rejection", Auth::User(0), query, 400).await;
            }
            init(
                &mut lab,
                "unknown query ignored",
                Auth::User(0),
                "?unrecognized=true",
                400,
            )
            .await;
        }
        Scenario::WrongOwner => {
            attempt(&lab, 1, Some("new@example.com"), "GMAIL", &[], &[]).await;
            init(
                &mut lab,
                "another user owns consent",
                Auth::User(0),
                &query(),
                400,
            )
            .await;
        }
        Scenario::Pending => {
            attempt(&lab, 0, None, "GMAIL", &[], &[]).await;
            init(
                &mut lab,
                "consent has not completed",
                Auth::User(0),
                &query(),
                400,
            )
            .await;
            init(
                &mut lab,
                "pending consent was cleaned",
                Auth::User(0),
                &query(),
                500,
            )
            .await;
        }
        Scenario::OtherProvider => {
            attempt(&lab, 1, Some("new@example.com"), "OUTLOOK", &[], &[]).await;
            init(
                &mut lab,
                "unrecognized Outlook attempt rejected by Gmail",
                Auth::User(0),
                &query(),
                400,
            )
            .await;
        }
        Scenario::Missing => {
            init(
                &mut lab,
                "missing consent",
                Auth::User(0),
                &format!("?link_id={MISSING}"),
                500,
            )
            .await;
        }
        Scenario::InvalidEmail => {
            attempt(&lab, 2, Some("not an email"), "GMAIL", &[], &[]).await;
            init(
                &mut lab,
                "invalid linked email",
                Auth::User(2),
                &query(),
                400,
            )
            .await;
        }
        Scenario::FreeLimit => {
            attempt(&lab, 0, Some("third@example.com"), "GMAIL", &[], &[]).await;
            init(
                &mut lab,
                "owned and delegated inboxes count toward free limit",
                Auth::User(0),
                &query(),
                402,
            )
            .await;
        }
        Scenario::BoundaryLimit => {
            attempt(&lab, 1, Some("second@example.com"), "GMAIL", &[], &[]).await;
            init(
                &mut lab,
                "second inbox is free",
                Auth::User(1),
                &query(),
                200,
            )
            .await;
        }
        Scenario::DelegationLimit => {
            sql(&lab, "DELETE FROM macro_user_links").await;
            attempt(&lab, 0, Some("parity-b@example.com"), "GMAIL", &[], &[]).await;
            init(
                &mut lab,
                "new delegation is limited",
                Auth::User(0),
                &query(),
                402,
            )
            .await;
        }
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn access_existing(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "access_existing", 52200, Scenario::Existing).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn access_auth(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "access_auth", 52203, Scenario::Auth).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn access_query(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "access_query", 52206, Scenario::Query).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn access_wrong_owner(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "access_wrong_owner", 52209, Scenario::WrongOwner).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn access_pending(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "access_pending", 52212, Scenario::Pending).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn access_other_provider(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "access_other_provider",
        52215,
        Scenario::OtherProvider,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn access_missing(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "access_missing", 52218, Scenario::Missing).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn access_invalid_email(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "access_invalid_email", 52221, Scenario::InvalidEmail).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn access_free_limit(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "access_free_limit", 52224, Scenario::FreeLimit).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn access_boundary_limit(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "access_boundary_limit",
        52227,
        Scenario::BoundaryLimit,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn access_delegation_limit(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "access_delegation_limit",
        52230,
        Scenario::DelegationLimit,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn access_ignored_headers_and_body(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let (mut lab, _redis) = start(pool, "access_ignored_headers_and_body", 52300).await;
    for header in [b"not-a-uuid".as_slice(), b"".as_slice(), &[0xff]] {
        assert_eq!(
            lab.request_with_headers(
                "init ignores inbox-selection header and body",
                "POST",
                "/email/init",
                Auth::User(0),
                RequestBody::Raw {
                    bytes: b"not JSON".to_vec(),
                    content_type: "text/plain"
                },
                &[("x-email-link-id", header)]
            )
            .await,
            400
        );
    }
    lab.transcript.finish();
}
