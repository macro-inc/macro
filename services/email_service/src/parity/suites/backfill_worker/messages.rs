use super::*;

#[derive(Clone, Copy)]
enum Case {
    New,
    Existing,
    Draft,
    Missing,
    Pending,
    CrmFailure,
    LookupFault(usize),
    WriteFault(&'static str, bool, &'static str),
    CounterWrongType,
    Complete,
    MetadataFailure,
    Rollback,
}
#[expect(
    clippy::disallowed_methods,
    reason = "Legacy message fixtures and isolated SQL faults"
)]
async fn messages(pool: PgPool, name: &'static str, shard: u32, count: u32, case: Case) {
    let mut lab = start(pool, name, shard).await;
    let id = if matches!(
        case,
        Case::Existing | Case::Pending | Case::LookupFault(4..)
    ) {
        "m1a"
    } else {
        "legacy-new"
    };
    let full = full_message(
        id,
        "t1",
        if matches!(case, Case::Draft) {
            &["DRAFT"]
        } else {
            &["INBOX", "UNREAD"]
        },
    );
    persistent(
        &lab,
        &format!("messages/{id}"),
        if matches!(case, Case::Missing) {
            404
        } else {
            200
        },
        if matches!(case, Case::Missing) {
            rejection(404)
        } else {
            full
        },
    );
    message_progress(
        &lab,
        if matches!(case, Case::Complete | Case::MetadataFailure) {
            1
        } else {
            100
        },
        0,
    )
    .await;
    match case {
        Case::CrmFailure | Case::MetadataFailure => {
            lab.sqs
                .fail_nth_send(if matches!(case, Case::MetadataFailure) {
                    2
                } else {
                    1
                })
        }
        Case::LookupFault(n) => lab.sql_fault.fail_acquisition(n),
        Case::WriteFault(table, commit, code) => trigger(&lab, table, "INSERT", commit, code).await,
        Case::CounterWrongType => {
            let _: () = redis::cmd("SET")
                .arg(format!("bf_thread_status:{JOB}:t1"))
                .arg("wrong type")
                .query_async(&mut lab.redis_connection())
                .await
                .unwrap();
        }
        Case::Rollback => {
            sqlx::query("CREATE FUNCTION parity_disconnect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_terminate_backend(pg_backend_pid()); RETURN NEW; END $$").execute(&lab.db).await.unwrap();
            sqlx::query("CREATE TRIGGER parity_disconnect BEFORE INSERT ON email_messages FOR EACH ROW EXECUTE FUNCTION parity_disconnect()").execute(&lab.db).await.unwrap();
        }
        Case::Pending => {
            email_db_client::labels::pending_writes::mark_pending_label_writes(
                &lab.db,
                lab.fixture.links[0],
                &[lab.fixture.messages["m1a"]],
                "STARRED",
                true,
                MISSING,
            )
            .await
            .unwrap();
        }
        _ => {}
    }
    let message = delivery(
        &lab,
        "backfill_message",
        message_payload(&lab, id).await,
        count,
    );
    let first = step(&mut lab, "legacy backfill message", &message).await;
    first.result.expect("message policy");
    if matches!(
        case,
        Case::New | Case::Existing | Case::Draft | Case::Pending | Case::Complete
    ) {
        if let Some(next) = first.sent_deliveries.iter().find(|d| {
            d.body
                .as_deref()
                .unwrap_or("")
                .contains("update_thread_metadata")
        }) {
            step(&mut lab, "metadata follow-up", next)
                .await
                .result
                .expect("metadata");
        }
        lab.reset_admission().await;
        step(&mut lab, "legacy message duplicate", &message.redelivered())
            .await
            .result
            .expect("duplicate");
    }
    lab.transcript.finish();
}
cases! {messages;
    message_rollback_failure,72509,1,Case::Rollback; message_rollback_failure_redelivery,75509,20,Case::Rollback;
    message_new,71400,1,Case::New; message_new_redelivery,71403,20,Case::New;
    message_existing,71406,1,Case::Existing;
    message_existing_redelivery,74406,20,Case::Existing; message_draft,71409,1,Case::Draft;
    message_draft_redelivery,74409,20,Case::Draft;
    message_missing,71412,1,Case::Missing;
    message_missing_redelivery,74412,20,Case::Missing; message_pending_labels,71415,1,Case::Pending;
    message_pending_labels_redelivery,74415,20,Case::Pending;
    message_crm_send_failure,71418,1,Case::CrmFailure;
    message_crm_send_failure_redelivery,74418,20,Case::CrmFailure; message_counter_wrong_type,71421,1,Case::CounterWrongType;
    message_counter_wrong_type_redelivery,74421,20,Case::CounterWrongType;
    message_last_in_thread,71424,1,Case::Complete;
    message_last_in_thread_redelivery,74424,20,Case::Complete; message_metadata_send_failure,71427,1,Case::MetadataFailure;
    message_metadata_send_failure_redelivery,74427,20,Case::MetadataFailure;
    message_lookup_failure,71430,1,Case::LookupFault(3);
    message_lookup_failure_redelivery,74430,20,Case::LookupFault(3); message_stored_labels_failure,71433,1,Case::LookupFault(4);
    message_stored_labels_failure_redelivery,74433,20,Case::LookupFault(4);
    message_pending_before_failure,71436,1,Case::LookupFault(5);
    message_pending_before_failure_redelivery,74436,20,Case::LookupFault(5); message_pending_after_failure,71439,1,Case::LookupFault(7);
    message_pending_after_failure_redelivery,74439,20,Case::LookupFault(7);
    message_insert_failure,71442,1,Case::WriteFault("email_messages",false,"P0001");
    message_insert_failure_redelivery,74442,20,Case::WriteFault("email_messages",false,"P0001");
    message_commit_failure,71445,1,Case::WriteFault("email_messages",true,"P0001");
    message_commit_failure_redelivery,74445,20,Case::WriteFault("email_messages",true,"P0001");
    message_invalid_data,71448,1,Case::WriteFault("email_messages",false,"22001");
    message_invalid_data_redelivery,74448,20,Case::WriteFault("email_messages",false,"22001");
    message_recipient_failure,71451,1,Case::WriteFault("email_message_recipients",false,"P0001");
    message_recipient_failure_redelivery,74451,20,Case::WriteFault("email_message_recipients",false,"P0001");
    message_label_failure,71454,1,Case::WriteFault("email_message_labels",false,"P0001");
    message_label_failure_redelivery,74454,20,Case::WriteFault("email_message_labels",false,"P0001");
    message_contact_failure,71457,1,Case::WriteFault("email_contacts",false,"P0001");
    message_contact_failure_redelivery,74457,20,Case::WriteFault("email_contacts",false,"P0001");
}
