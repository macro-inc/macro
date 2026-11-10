use super::*;

#[derive(Clone, Copy)]
enum Site {
    Labels,
    Upsert,
    Thread,
    Catalog,
    History,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Independent provider cases reset only isolated fixture/token state"
)]
async fn providers(pool: PgPool, name: &'static str, shard: u32, retry: bool, site: Site) {
    let mut lab = start(pool, name, shard).await;
    let (op, id, path) = match site {
        Site::Labels => (Op::Labels, "m1a", "messages/m1a"),
        Site::Upsert => (Op::Upsert, "m1a", "messages/m1a"),
        Site::Thread => (Op::Upsert, "fresh", "threads/fresh-thread"),
        Site::Catalog => (Op::History, "", "labels"),
        Site::History => (Op::History, "", "history"),
    };
    for (status, flavor) in [
        (200, "success"),
        (400, "bad-request"),
        (401, "auth"),
        (401, "refresh success"),
        (403, "forbidden"),
        (404, "missing"),
        (409, "conflict"),
        (429, "quota"),
        (429, "concurrency"),
        (500, "internal"),
        (503, "unavailable"),
        (0, "disconnect"),
        (200, "malformed"),
    ] {
        lab.reset_admission().await;
        lab.seed_link_token(lab.fixture.links[0]).await;
        sqlx::query("UPDATE email_links SET needs_reauth=false WHERE id=$1")
            .bind(lab.fixture.links[0])
            .execute(&lab.db)
            .await
            .expect("token health");
        seed_history(&lab, "100").await;
        if matches!(site, Site::Thread) {
            sqlx::query("DELETE FROM email_messages WHERE link_id=$1 AND provider_id='fresh'")
                .bind(lab.fixture.links[0])
                .execute(&lab.db)
                .await
                .expect("reset inserted message");
            sqlx::query(
                "DELETE FROM email_threads WHERE link_id=$1 AND provider_id='fresh-thread'",
            )
            .bind(lab.fixture.links[0])
            .execute(&lab.db)
            .await
            .expect("reset inserted thread");
            provider_message(&lab, "fresh", "fresh-thread", &["INBOX"]);
        }
        if matches!(site, Site::History) {
            persistent(&lab, "labels", 200, catalog());
        }
        let good = match site {
            Site::Labels => json!({"id":"m1a","threadId":"t1","labelIds":["INBOX","UNREAD"]}),
            Site::Upsert => full_message("m1a", "t1", &["INBOX", "UNREAD"]),
            Site::Thread => {
                json!({"id":"fresh-thread","messages":[full_message("fresh","fresh-thread",&["INBOX"])]})
            }
            Site::Catalog => catalog(),
            Site::History => json!({"historyId":"200","history":[]}),
        };
        let retried = if flavor == "refresh success" {
            HttpReply::Status(200, good.clone())
        } else {
            HttpReply::Status(401, rejection(401))
        };
        let reply = if status == 0 {
            HttpReply::Disconnect
        } else {
            HttpReply::Status(
                status,
                if flavor == "malformed" {
                    json!({"id":0,"labels":false,"messages":false,"historyId":[]})
                } else if flavor == "concurrency" {
                    json!({"error":{"code":429,"message":"Too many concurrent requests for user."}})
                } else if status == 200 {
                    good
                } else {
                    rejection(status)
                },
            )
        };
        lab.gmail.lock().scripted_http.push_back((
            "GET".into(),
            format!("/gmail/v1/users/me/{path}"),
            reply,
        ));
        if status == 401 {
            lab.gmail.lock().scripted_http.push_back((
                "GET".into(),
                format!("/gmail/v1/users/me/{path}"),
                retried,
            ));
        }
        lab.gmail.lock().endpoint_headers.insert(
            format!("/gmail/v1/users/me/{path}"),
            vec![("retry-after".into(), "3600".into())],
        );
        let message = delivery(&lab, op, id);
        let first = lab
            .worker_step(
                &format!("provider status {status} {flavor}"),
                queue(retry),
                &message,
            )
            .await;
        first.result.expect("provider error classified");
        lab.gmail.lock().scripted_http.clear();
        if status == 429 && !first.sent.is_empty() {
            lab.reset_admission().await;
            lab.worker_step(
                "retry delivery from recorded send",
                Queue::InboxSyncRetry,
                &Delivery::from_sent(&first.sent[0]),
            )
            .await
            .result
            .expect("follow-up");
        }
    }
    lab.reset_admission().await;
    seed_history(&lab, "100").await;
    lab.sqs.fail_nth_send(1);
    lab.gmail.lock().scripted_http.push_back((
        "GET".into(),
        format!("/gmail/v1/users/me/{path}"),
        HttpReply::Status(429, rejection(429)),
    ));
    lab.worker_step(
        "retry publication failure",
        queue(retry),
        &delivery(&lab, op, id),
    )
    .await
    .result
    .expect("retry failure classified");
    lab.gmail.lock().scripted_http.clear();
    lab.reset_admission().await;
    seed_history(&lab, "100").await;
    for index in 0..5 {
        let _: () = redis::cmd("ZADD")
            .arg(format!("gmail:{{{}}}:inflight", lab.fixture.links[0]))
            .arg(4_000_000_000_000_i64)
            .arg(format!("occupied-{index}"))
            .query_async(&mut lab.redis_connection())
            .await
            .expect("occupy gate");
    }
    lab.worker_step(
        "local request gate refused",
        queue(retry),
        &delivery(&lab, op, id),
    )
    .await
    .result
    .expect("gate refused");
    lab.transcript.finish();
}

cases! { providers;
    providers_labels_primary, 75000, false, Site::Labels;
    providers_labels_retry, 75003, true, Site::Labels;
    providers_upsert_primary, 75006, false, Site::Upsert;
    providers_upsert_retry, 75009, true, Site::Upsert;
    providers_thread_primary, 75012, false, Site::Thread;
    providers_thread_retry, 75015, true, Site::Thread;
    providers_catalog_primary, 75018, false, Site::Catalog;
    providers_catalog_retry, 75021, true, Site::Catalog;
    providers_history_primary, 75024, false, Site::History;
    providers_history_retry, 75027, true, Site::History;
}
