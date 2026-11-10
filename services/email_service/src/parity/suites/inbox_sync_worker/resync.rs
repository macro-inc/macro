use super::*;
use crate::pubsub::label_write_sim::fake_gmail::{Kind, PauseAt};

#[derive(Clone, Copy)]
enum Case {
    StoredLabelsFault,
    PendingBeforeFault,
    PendingAfterFault,
    ProviderAndAfterFault,
    Pending,
    Expired,
    ConfirmDuringRead,
    StageDuringRead,
    DeletedThread,
    EmptyThread,
    TargetAbsent,
    ManyMessages,
    MissingThreadId,
    GatewayFailure,
    InvalidAddresses,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Resync characterization mutates only isolated fixture rows"
)]
async fn resync(pool: PgPool, name: &'static str, shard: u32, retry: bool, case: Case) {
    let mut lab = start(pool, name, shard).await;
    let existing = !matches!(
        case,
        Case::DeletedThread
            | Case::EmptyThread
            | Case::TargetAbsent
            | Case::ManyMessages
            | Case::GatewayFailure
            | Case::InvalidAddresses
    );
    let id = if existing { "m1a" } else { "resync-new" };
    let thread = if matches!(
        case,
        Case::EmptyThread | Case::TargetAbsent | Case::ManyMessages
    ) {
        "resync-thread"
    } else {
        "t1"
    };
    provider_message(&lab, id, thread, &["INBOX", "UNREAD", "Label_work"]);
    let mut full = full_message(id, thread, &["INBOX", "UNREAD", "Label_work"]);
    if matches!(case, Case::MissingThreadId) {
        full.as_object_mut().expect("message").remove("threadId");
    }
    if matches!(case, Case::InvalidAddresses) {
        full["payload"]["headers"][0]["value"] = json!("Sender <invalid>");
        full["payload"]["headers"][1]["value"] =
            json!("A <a@example.com>, a@example.com, Empty <invalid>, robot@example.com");
        full["payload"]["headers"]
            .as_array_mut()
            .expect("headers")
            .push(json!({"name":"Bcc","value":"bcc@example.com"}));
    }
    persistent(&lab, &format!("messages/{id}"), 200, full);
    let messages = match case {
        Case::EmptyThread => vec![],
        Case::TargetAbsent => vec![full_message("different", thread, &["INBOX"])],
        Case::ManyMessages => {
            let mut missing_date = full_message("missing-date", thread, &["DRAFT"]);
            missing_date
                .as_object_mut()
                .expect("message")
                .remove("internalDate");
            let mut sent = full_message("last-sent", thread, &["SENT"]);
            sent["internalDate"] = json!("1790000090000");
            let mut spam = full_message("spam", thread, &["SPAM"]);
            spam["internalDate"] = json!("1790000100000");
            vec![
                sent,
                full_message(id, thread, &["INBOX", "UNREAD"]),
                spam,
                missing_date,
            ]
        }
        _ => vec![full_message(id, thread, &["INBOX", "UNREAD"])],
    };
    persistent(
        &lab,
        &format!("threads/{thread}"),
        200,
        json!({"id":thread,"messages":messages}),
    );
    let write = Uuid::from_u128(0x7d000000000000000000000000000001);
    lab.transcript.normalizer.symbol(write, "<resync-write>");
    if matches!(
        case,
        Case::Pending | Case::Expired | Case::ConfirmDuringRead
    ) {
        email_db_client::labels::pending_writes::mark_pending_label_writes(
            &lab.db,
            lab.fixture.links[0],
            &[lab.fixture.messages["m1a"]],
            "Label_work",
            false,
            write,
        )
        .await
        .expect("pending");
        if matches!(case, Case::Expired) {
            sqlx::query(
                "UPDATE email_gmail_pending_label_writes SET expires_at=now()-interval '1 hour'",
            )
            .execute(&lab.db)
            .await
            .expect("expire");
        }
    }
    let mut race = None;
    match case {
        Case::StoredLabelsFault => lab.sql_fault.fail_acquisition(3),
        Case::PendingBeforeFault => lab.sql_fault.fail_acquisition(4),
        Case::PendingAfterFault | Case::ProviderAndAfterFault => {
            lab.sql_fault.fail_acquisition(6);
            if matches!(case, Case::ProviderAndAfterFault) {
                persistent(&lab, "messages/m1a", 429, rejection(429));
                lab.gmail.lock().endpoint_headers.insert(
                    "/gmail/v1/users/me/messages/m1a".into(),
                    vec![("retry-after".into(), "3600".into())],
                );
            }
        }
        Case::StageDuringRead | Case::ConfirmDuringRead => {
            lab.gmail
                .lock()
                .endpoint_replies
                .remove("/gmail/v1/users/me/messages/m1a");
            let pause = lab
                .gmail
                .pause_next(Kind::ReadFull, Some("m1a"), PauseAt::AfterApply);
            let db = lab.db.clone();
            let message_id = lab.fixture.messages["m1a"];
            let link = lab.fixture.links[0];
            race = Some(tokio::spawn(async move {
                pause.arrived.await.expect("provider read arrived");
                if matches!(case, Case::StageDuringRead) {
                    email_db_client::labels::pending_writes::mark_pending_label_writes(
                        &db,
                        link,
                        &[message_id],
                        "Label_work",
                        false,
                        write,
                    )
                    .await
                    .expect("stage");
                } else {
                    let mut tx = db.begin().await.expect("confirmation");
                    email_db_client::labels::pending_writes::confirm_pending_label_writes(
                        &mut tx,
                        &[message_id],
                        write,
                    )
                    .await
                    .expect("confirm");
                    tx.commit().await.expect("commit");
                }
                pause.release.send(()).expect("release read");
            }));
        }
        Case::DeletedThread => {
            let (arrived, release) = lab.sql_fault.pause_acquisition(5);
            let db = lab.db.clone();
            let link = lab.fixture.links[0];
            race = Some(tokio::spawn(async move {
                arrived.await.expect("insert arrived");
                sqlx::query("DELETE FROM email_threads WHERE link_id=$1 AND provider_id='t1'")
                    .bind(link)
                    .execute(&db)
                    .await
                    .expect("delete thread");
                release.send(()).expect("release insert");
            }));
        }
        Case::GatewayFailure => lab.stub.reply(
            "POST",
            "/message/send/",
            500,
            json!({"error":"gateway failure"}),
        ),
        _ => {}
    }
    let message = delivery(&lab, Op::Upsert, id);
    lab.worker_step("resync edge", queue(retry), &message)
        .await
        .result
        .expect("classified");
    if let Some(task) = race {
        task.await.expect("race fixture");
    }
    if matches!(
        case,
        Case::DeletedThread
            | Case::Pending
            | Case::Expired
            | Case::ManyMessages
            | Case::GatewayFailure
    ) {
        duplicate(&mut lab, retry, &message).await;
    }
    lab.transcript.finish();
}

cases! { resync;
    resync_stored_labels_fault_primary, 80000, false, Case::StoredLabelsFault;
    resync_stored_labels_fault_retry, 80003, true, Case::StoredLabelsFault;
    resync_pending_before_fault_primary, 80006, false, Case::PendingBeforeFault;
    resync_pending_before_fault_retry, 80009, true, Case::PendingBeforeFault;
    resync_pending_after_fault_primary, 80012, false, Case::PendingAfterFault;
    resync_pending_after_fault_retry, 80015, true, Case::PendingAfterFault;
    resync_provider_and_after_fault_primary, 80018, false, Case::ProviderAndAfterFault;
    resync_provider_and_after_fault_retry, 80021, true, Case::ProviderAndAfterFault;
    resync_pending_primary, 80024, false, Case::Pending;
    resync_pending_retry, 80027, true, Case::Pending;
    resync_expired_primary, 80030, false, Case::Expired;
    resync_expired_retry, 80033, true, Case::Expired;
    resync_confirm_during_read_primary, 80036, false, Case::ConfirmDuringRead;
    resync_confirm_during_read_retry, 80039, true, Case::ConfirmDuringRead;
    resync_stage_during_read_primary, 80042, false, Case::StageDuringRead;
    resync_stage_during_read_retry, 80045, true, Case::StageDuringRead;
    resync_deleted_thread_primary, 80048, false, Case::DeletedThread;
    resync_deleted_thread_retry, 80051, true, Case::DeletedThread;
    resync_empty_thread_primary, 80054, false, Case::EmptyThread;
    resync_empty_thread_retry, 80057, true, Case::EmptyThread;
    resync_target_absent_primary, 80060, false, Case::TargetAbsent;
    resync_target_absent_retry, 80063, true, Case::TargetAbsent;
    resync_many_messages_primary, 80066, false, Case::ManyMessages;
    resync_many_messages_retry, 80069, true, Case::ManyMessages;
    resync_missing_thread_id_primary, 80072, false, Case::MissingThreadId;
    resync_missing_thread_id_retry, 80075, true, Case::MissingThreadId;
    resync_gateway_failure_primary, 80078, false, Case::GatewayFailure;
    resync_gateway_failure_retry, 80081, true, Case::GatewayFailure;
    resync_invalid_addresses_primary, 80084, false, Case::InvalidAddresses;
    resync_invalid_addresses_retry, 80087, true, Case::InvalidAddresses;
}
