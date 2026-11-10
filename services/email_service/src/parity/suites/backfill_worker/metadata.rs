use super::*;

#[derive(Clone, Copy)]
enum Case {
    Success,
    First,
    Fifty,
    Complete,
    Missing,
    Begin,
    Metadata,
    Replying,
    Commit,
    Counter,
    Kafka,
    Rollback,
}
#[expect(clippy::disallowed_methods, reason = "Metadata and progress fixtures")]
async fn metadata(pool: PgPool, name: &'static str, shard: u32, count: u32, case: Case) {
    let mut lab = start(pool, name, shard).await;
    let mut payload = message_payload(&lab, "m1a").await;
    payload
        .as_object_mut()
        .unwrap()
        .remove("message_provider_id");
    if matches!(case, Case::Missing) {
        payload["thread_db_id"] = json!(MISSING);
    }
    progress(
        &lab,
        if matches!(case, Case::Complete) {
            1
        } else {
            100
        },
        match case {
            Case::Fifty => 49,
            Case::Success => 5,
            _ => 0,
        },
    )
    .await;
    match case {
        Case::Begin => lab.sql_fault.fail_acquisition(3),
        Case::Metadata => trigger(&lab, "email_threads", "UPDATE", false, "P0001").await,
        Case::Replying => trigger(&lab, "email_messages", "UPDATE", false, "P0001").await,
        Case::Commit => trigger(&lab, "email_threads", "UPDATE", true, "P0001").await,
        Case::Counter => {
            let _: () = redis::cmd("SET")
                .arg(format!("bf_job_status:{JOB}"))
                .arg("wrong type")
                .query_async(&mut lab.redis_connection())
                .await
                .unwrap();
        }
        Case::Kafka => lab.reject_next_kafka_publish(),
        Case::Rollback => {
            sqlx::query("CREATE FUNCTION parity_disconnect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_terminate_backend(pg_backend_pid()); RETURN OLD; END $$").execute(&lab.db).await.unwrap();
            sqlx::query("CREATE TRIGGER parity_disconnect BEFORE UPDATE ON email_threads FOR EACH ROW EXECUTE FUNCTION parity_disconnect()").execute(&lab.db).await.unwrap();
        }
        _ => {}
    }
    let message = delivery(&lab, "update_thread_metadata", payload, count);
    step(&mut lab, "update metadata", &message)
        .await
        .result
        .expect("metadata policy");
    if matches!(
        case,
        Case::Success | Case::First | Case::Fifty | Case::Missing | Case::Kafka
    ) {
        step(&mut lab, "metadata duplicate", &message.redelivered())
            .await
            .result
            .expect("duplicate");
    }
    lab.transcript.finish();
}
cases! {metadata;
    metadata_rollback_failure,72506,1,Case::Rollback; metadata_rollback_failure_redelivery,75506,20,Case::Rollback;
    metadata_success,71500,1,Case::Success; metadata_success_redelivery,71503,20,Case::Success;
    metadata_first_progress,71506,1,Case::First;
    metadata_first_progress_redelivery,74506,20,Case::First; metadata_fiftieth_progress,71509,1,Case::Fifty;
    metadata_fiftieth_progress_redelivery,74509,20,Case::Fifty;
    metadata_completion,71512,1,Case::Complete;
    metadata_completion_redelivery,74512,20,Case::Complete; metadata_missing_thread,71515,1,Case::Missing;
    metadata_missing_thread_redelivery,74515,20,Case::Missing;
    metadata_begin_failure,71518,1,Case::Begin;
    metadata_begin_failure_redelivery,74518,20,Case::Begin; metadata_update_failure,71521,1,Case::Metadata;
    metadata_update_failure_redelivery,74521,20,Case::Metadata;
    metadata_replying_failure,71524,1,Case::Replying;
    metadata_replying_failure_redelivery,74524,20,Case::Replying; metadata_commit_failure,71527,1,Case::Commit;
    metadata_commit_failure_redelivery,74527,20,Case::Commit;
    metadata_counter_failure,71530,1,Case::Counter;
    metadata_counter_failure_redelivery,74530,20,Case::Counter; metadata_kafka_failure,71533,1,Case::Kafka;
    metadata_kafka_failure_redelivery,74533,20,Case::Kafka;
}
