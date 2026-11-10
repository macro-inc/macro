use super::*;

#[derive(Clone, Copy)]
enum Case {
    Page,
    EmptyFirst,
    EmptyLater,
    Priority,
    PriorityEmpty,
    PriorityZero,
    CountFault,
    ThreadSendFault,
    PageSendFault,
    PrioritySendFault,
    SeedSendFault,
    SeedProviderFault,
    PriorityRedisFault,
}

#[expect(clippy::disallowed_methods, reason = "List and priority-pass fixtures")]
async fn listing(pool: PgPool, name: &'static str, shard: u32, count: u32, case: Case) {
    let mut lab = start(pool, name, shard).await;
    let priority = matches!(
        case,
        Case::Priority
            | Case::PriorityEmpty
            | Case::PriorityZero
            | Case::PrioritySendFault
            | Case::SeedSendFault
            | Case::SeedProviderFault
            | Case::PriorityRedisFault
    );
    let empty = matches!(
        case,
        Case::EmptyFirst | Case::EmptyLater | Case::PriorityEmpty
    );
    let next = matches!(case, Case::Page | Case::PageSendFault);
    persistent(
        &lab,
        "threads",
        200,
        json!({"threads":if empty{json!([])}else{json!([{"id":"t1"},{"id":"t2"}])},"nextPageToken":if next{Some("page-two")}else{None}}),
    );
    persistent(
        &lab,
        "messages",
        if matches!(case, Case::SeedProviderFault) {
            503
        } else {
            200
        },
        if matches!(case, Case::SeedProviderFault) {
            rejection(503)
        } else {
            json!({"messages":[{"id":"m1a"},{"id":"m1b"}]})
        },
    );
    if matches!(case, Case::EmptyLater) {
        sqlx::query("UPDATE email_backfill_jobs SET threads_retrieved_count=4 WHERE id=$1")
            .bind(JOB)
            .execute(&lab.db)
            .await
            .unwrap();
    }
    if matches!(case, Case::PriorityZero) {
        seed_job(&lab, "InProgress", 0).await;
    }
    if matches!(case, Case::CountFault) {
        trigger(&lab, "email_backfill_jobs", "UPDATE", false, "P0001").await;
    }
    if matches!(case, Case::ThreadSendFault | Case::PrioritySendFault) {
        lab.sqs.fail_nth_send(2);
    }
    if matches!(case, Case::PageSendFault | Case::SeedSendFault) {
        lab.sqs.fail_nth_send(3);
    }
    if matches!(case, Case::PriorityRedisFault) {
        let _: () = redis::cmd("SET")
            .arg(format!("bf_job_status:{JOB}"))
            .arg("wrong type")
            .query_async(&mut lab.redis_connection())
            .await
            .unwrap();
    }
    let mut payload = list_payload(priority);
    payload["refresh_existing"] = json!(true);
    let message = delivery(&lab, "list_threads", payload, count);
    let first = step(&mut lab, "list threads", &message).await;
    first.result.expect("classified");
    if matches!(
        case,
        Case::Page | Case::Priority | Case::PriorityEmpty | Case::PriorityZero
    ) {
        // Consume the body actually emitted by the producer, preserving wire attributes.
        if let Some(next) = first.sent_deliveries.first() {
            step(&mut lab, "first recorded child", next)
                .await
                .result
                .expect("child");
        }
    }
    if matches!(case, Case::Page | Case::Priority) {
        lab.reset_admission().await;
        step(&mut lab, "duplicate listing", &message.redelivered())
            .await
            .result
            .expect("duplicate");
    }
    lab.transcript.finish();
}
cases! {listing;
    list_page,71100,1,Case::Page;
    list_page_redelivery,71103,2,Case::Page;
    list_empty_first,71106,1,Case::EmptyFirst;
    list_empty_first_redelivery,74106,20,Case::EmptyFirst;
    list_empty_later,71109,1,Case::EmptyLater;
    list_empty_later_redelivery,74109,20,Case::EmptyLater;
    list_priority,71112,1,Case::Priority;
    list_priority_redelivery,71115,2,Case::Priority;
    list_priority_empty,71118,1,Case::PriorityEmpty;
    list_priority_empty_redelivery,74118,20,Case::PriorityEmpty;
    list_priority_zero,71121,1,Case::PriorityZero;
    list_priority_zero_redelivery,74121,20,Case::PriorityZero;
    list_counter_failure,71124,1,Case::CountFault;
    list_counter_failure_redelivery,74124,20,Case::CountFault;
    list_child_send_failure,71127,1,Case::ThreadSendFault;
    list_child_send_failure_redelivery,74127,20,Case::ThreadSendFault;
    list_next_page_send_failure,71130,1,Case::PageSendFault;
    list_next_page_send_failure_redelivery,74130,20,Case::PageSendFault;
    priority_child_send_failure,71133,1,Case::PrioritySendFault;
    priority_child_send_failure_redelivery,74133,20,Case::PrioritySendFault;
    priority_seed_send_failure,71136,1,Case::SeedSendFault;
    priority_seed_send_failure_redelivery,74136,20,Case::SeedSendFault;
    priority_seed_provider_failure,71139,1,Case::SeedProviderFault;
    priority_seed_provider_failure_redelivery,74139,20,Case::SeedProviderFault;
    priority_redis_failure,71142,1,Case::PriorityRedisFault;
    priority_redis_failure_redelivery,74142,20,Case::PriorityRedisFault;
}
