use super::*;

#[derive(Clone, Copy)]
enum Site {
    Threads,
    Priority,
    Thread,
    Message,
    Seed,
    Labels,
    Profile,
    SeedList,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Provider matrix restores only its fixture between independent steps"
)]
async fn providers(pool: PgPool, name: &'static str, shard: u32, count: u32, site: Site) {
    let mut lab = start(pool, name, shard).await;
    for (status, flavor) in [
        (200, "success"),
        (400, "bad request"),
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
            .unwrap();
        seed_job(
            &lab,
            if matches!(site, Site::Labels | Site::Profile) {
                "Init"
            } else {
                "InProgress"
            },
            100,
        )
        .await;
        sqlx::query("DELETE FROM email_backfill_init_outbox WHERE backfill_job_id=$1")
            .bind(JOB)
            .execute(&lab.db)
            .await
            .unwrap();
        sqlx::query("DELETE FROM email_backfill_completion_outbox WHERE backfill_job_id=$1")
            .bind(JOB)
            .execute(&lab.db)
            .await
            .unwrap();
        persistent(&lab, "labels", 200, catalog());
        persistent(&lab, "threads", 200, json!({"threads":[]}));
        persistent(&lab, "messages", 200, json!({"messages":[]}));
        persistent(
            &lab,
            "profile",
            200,
            json!({"emailAddress":"mailbox@example.com","messagesTotal":10,"threadsTotal":100,"historyId":"200"}),
        );
        let (op, payload, path, good) = match site {
            Site::Threads | Site::Priority => (
                "list_threads",
                list_payload(matches!(site, Site::Priority)),
                "threads",
                json!({"threads":[]}),
            ),
            Site::Thread => (
                "backfill_thread",
                thread_payload("provider-new", false),
                "threads/provider-new",
                json!({"id":"provider-new","messages":[]}),
            ),
            Site::Message => (
                "backfill_message",
                message_payload(&lab, "m1a").await,
                "messages/m1a",
                full_message("m1a", "t1", &["INBOX", "UNREAD"]),
            ),
            Site::Seed => (
                "seed_sent_contact",
                json!({"message_provider_id":"m1a"}),
                "messages/m1a",
                full_message("m1a", "t1", &["SENT"]),
            ),
            Site::Labels => ("init", json!({}), "labels", catalog()),
            Site::Profile => (
                "init",
                json!({}),
                "profile",
                json!({"emailAddress":"mailbox@example.com","messagesTotal":10,"threadsTotal":100,"historyId":"200"}),
            ),
            Site::SeedList => (
                "list_threads",
                list_payload(true),
                "messages",
                json!({"messages":[]}),
            ),
        };
        if matches!(site, Site::Thread) {
            sqlx::query(
                "DELETE FROM email_threads WHERE link_id=$1 AND provider_id='provider-new'",
            )
            .bind(lab.fixture.links[0])
            .execute(&lab.db)
            .await
            .unwrap();
        }
        message_progress(&lab, 100, 0).await;
        let error = if flavor == "concurrency" {
            json!({"error":{"code":429,"message":"Too many concurrent requests for user."}})
        } else {
            rejection(status)
        };
        let reply = if status == 0 {
            HttpReply::Disconnect
        } else {
            HttpReply::Status(
                status,
                if flavor == "malformed" {
                    json!({"id":0,"labels":false,"messages":false,"threads":false,"threadsTotal":{}})
                } else if status == 200 {
                    good.clone()
                } else {
                    error
                },
            )
        };
        let endpoint = format!("/gmail/v1/users/me/{path}");
        lab.gmail.lock().endpoint_replies.remove(&endpoint);
        lab.gmail.lock().endpoint_headers.insert(
            endpoint.clone(),
            vec![("retry-after".into(), "3600".into())],
        );
        lab.gmail
            .lock()
            .scripted_http
            .push_back(("GET".into(), endpoint.clone(), reply));
        if status == 401 {
            lab.gmail.lock().scripted_http.push_back((
                "GET".into(),
                endpoint,
                if flavor == "refresh success" {
                    HttpReply::Status(200, good)
                } else {
                    HttpReply::Status(401, rejection(401))
                },
            ));
        }
        let message = delivery(&lab, op, payload, count);
        let outcome = step(&mut lab, &format!("provider {status} {flavor}"), &message).await;
        outcome.result.expect("provider failure classified");
        lab.gmail.lock().scripted_http.clear();
        if status == 429 && !matches!(site, Site::SeedList) {
            assert_eq!(outcome.sent.len(), 1, "rate limit deferred once");
            assert_eq!(outcome.sent[0].delay_seconds, 900);
            assert!(
                outcome.sent_deliveries[0]
                    .message_attributes
                    .to_string()
                    .contains("1")
            );
        }
    }
    lab.transcript.finish();
}

#[derive(Clone, Copy)]
enum Gate {
    Busy,
    WriteWrongType,
    SendFailure,
    DeleteFailure,
    DeferralAttributes,
}
async fn gates(pool: PgPool, name: &'static str, shard: u32, count: u32, case: Gate) {
    let mut lab = start(pool, name, shard).await;
    let mut message = delivery(&lab, "list_threads", list_payload(false), count);
    persistent(&lab, "threads", 429, rejection(429));
    lab.gmail.lock().endpoint_headers.insert(
        "/gmail/v1/users/me/threads".into(),
        vec![("retry-after".into(), "3600".into())],
    );
    if matches!(case, Gate::Busy) {
        for (kind, n) in [("inflight", 3), ("waiting", 12)] {
            for i in 0..n {
                let _: () = redis::cmd("ZADD")
                    .arg(format!("gmail:{{{}}}:{kind}", lab.fixture.links[0]))
                    .arg(4_000_000_000_000_i64)
                    .arg(format!("held-{i}"))
                    .query_async(&mut lab.redis_connection())
                    .await
                    .unwrap();
            }
        }
    }
    if matches!(case, Gate::WriteWrongType) {
        let _: () = redis::cmd("SET")
            .arg("email:backfill:write_slots")
            .arg("wrong type")
            .query_async(&mut lab.redis_connection())
            .await
            .unwrap();
        persistent(
            &lab,
            "threads/slot",
            200,
            json!({"id":"slot","messages":[]}),
        );
        message = delivery(
            &lab,
            "backfill_thread",
            thread_payload("slot", false),
            count,
        );
    }
    if matches!(case, Gate::SendFailure) {
        lab.sqs.fail_nth_send(1);
    }
    if matches!(case, Gate::DeleteFailure) {
        lab.sqs.lock().fail_delete = true;
    }
    if matches!(case, Gate::DeferralAttributes) {
        for value in [
            json!({}),
            json!({"DataType":"Number","StringValue":"no"}),
            json!({"DataType":"Number","StringValue":"4294967294"}),
            json!({"DataType":"String","StringValue":"6"}),
        ] {
            lab.reset_admission().await;
            message.message_attributes =
                json!({sqs_client::email::BACKFILL_DEFERRALS_ATTRIBUTE:value});
            let result = step(&mut lab, "counter attribute", &message).await;
            result.result.expect("deferral");
            assert!(result.deleted);
        }
    } else {
        let first = step(&mut lab, "refusal", &message).await;
        if matches!(case, Gate::DeleteFailure) {
            assert!(first.result.is_err());
        } else {
            first.result.expect("policy");
        }
        if !first.sent_deliveries.is_empty() && !matches!(case, Gate::DeleteFailure) {
            let _: () = redis::cmd("DEL")
                .arg("email:backfill:write_slots")
                .query_async(&mut lab.redis_connection())
                .await
                .unwrap();
            lab.reset_admission().await;
            persistent(&lab, "threads", 200, json!({"threads":[]}));
            step(
                &mut lab,
                "delivery from recorded deferred send",
                &first.sent_deliveries[0],
            )
            .await
            .result
            .expect("follow-up");
        }
    }
    lab.transcript.finish();
}
cases! {providers;
    providers_list,71200,1,Site::Threads; providers_list_redelivery,71203,20,Site::Threads;
    providers_priority,71206,1,Site::Priority; providers_priority_redelivery,71209,20,Site::Priority;
    providers_thread,71212,1,Site::Thread; providers_thread_redelivery,71215,20,Site::Thread;
    providers_message,71218,1,Site::Message; providers_message_redelivery,71221,20,Site::Message;
    providers_seed,71224,1,Site::Seed; providers_seed_redelivery,71227,20,Site::Seed;
    providers_init_labels,71230,1,Site::Labels; providers_init_labels_redelivery,71233,20,Site::Labels;
    providers_init_profile,71236,1,Site::Profile; providers_init_profile_redelivery,71239,20,Site::Profile;
    providers_seed_list,71242,1,Site::SeedList; providers_seed_list_redelivery,71245,20,Site::SeedList;
}
cases! {gates;
    gate_no_waiter_room,71248,1,Gate::Busy; gate_no_waiter_room_redelivery,71251,20,Gate::Busy;
    write_slots_unavailable,71254,1,Gate::WriteWrongType; write_slots_unavailable_redelivery,71257,20,Gate::WriteWrongType;
    deferral_send_failure,71260,1,Gate::SendFailure; deferral_send_failure_redelivery,71263,20,Gate::SendFailure;
    deferral_delete_failure,71266,1,Gate::DeleteFailure;
    deferral_delete_failure_redelivery,74266,20,Gate::DeleteFailure;
    deferral_attributes,71269,20,Gate::DeferralAttributes;
}
