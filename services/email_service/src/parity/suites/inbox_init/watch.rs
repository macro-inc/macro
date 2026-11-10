use super::*;

async fn run(pool: PgPool, name: &'static str, shard: u32, stop: bool, code: u16) {
    let (mut lab, _redis) = start(pool, name, shard).await;
    attempt(&lab, 2, Some("new@example.com"), "GMAIL", &[], &[]).await;
    let conflict = (
        400,
        json!({"error":{"code":400,"message":"Only one push notification client allowed"}}),
    );
    let mut replies = vec![conflict];
    let path = if stop {
        "/gmail/v1/users/me/stop"
    } else {
        WATCH
    };
    if code == 429 {
        lab.gmail.lock().endpoint_headers.insert(
            path.into(),
            vec![("retry-after".into(), RETRY_AFTER_SECONDS.into())],
        );
    }
    if stop {
        lab.gmail
            .lock()
            .endpoint_replies
            .insert(WATCH.into(), replies.into());
        replies = Vec::new();
    }
    if code == 0 {
        lab.gmail
            .lock()
            .drop_after_requests
            .insert(path.into(), if stop { 0 } else { 1 });
    } else {
        replies.push((
            code,
            json!({"error":{"code":code,"message":"scripted provider rejection"}}),
        ));
    }
    if !replies.is_empty() {
        lab.gmail
            .lock()
            .endpoint_replies
            .insert(path.into(), replies.into());
    }
    init(
        &mut lab,
        "watch conflict recovery fails",
        Auth::User(2),
        &query(),
        match code {
            401 | 403 => 400,
            429 => 429,
            _ => 500,
        },
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn watch_stop_disconnect(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "watch_stop_disconnect", 53100, true, 0).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn watch_stop_400(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "watch_stop_400", 53103, true, 400).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn watch_stop_401(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "watch_stop_401", 53106, true, 401).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn watch_stop_403(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "watch_stop_403", 53109, true, 403).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn watch_stop_404(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "watch_stop_404", 53112, true, 404).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn watch_stop_429(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "watch_stop_429", 53115, true, 429).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn watch_stop_503(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "watch_stop_503", 53118, true, 503).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn watch_retry_disconnect(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "watch_retry_disconnect", 53130, false, 0).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn watch_retry_400(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "watch_retry_400", 53133, false, 400).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn watch_retry_401(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "watch_retry_401", 53136, false, 401).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn watch_retry_403(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "watch_retry_403", 53139, false, 403).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn watch_retry_404(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "watch_retry_404", 53142, false, 404).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn watch_retry_429(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "watch_retry_429", 53145, false, 429).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn watch_retry_503(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "watch_retry_503", 53148, false, 503).await;
}
