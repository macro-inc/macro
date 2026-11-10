use super::*;
use crate::pubsub::label_write_sim::fake_gmail::{Kind, PauseAt};

#[derive(Clone, Copy)]
enum Case {
    Noop,
    Add,
    Remove,
    Mixed,
    Unknown,
    Missing,
    MissingQueue,
    MissingProvider,
    Pending,
    Expired,
    ConfirmDuringRead,
    StageDuringRead,
    FailLookup,
    FailLabels,
    FailPending,
    FailAdd,
    FailRemove,
    FailAddCommit,
    FailRemoveCommit,
    FailAddRead,
    FailRemoveRead,
    FailMetadata,
    FailRemoveBegin,
    MissingThreadEvent,
    FailEventRead,
    EventAll,
    EventExcluded,
    EventRemove,
    DuplicateProvider,
    FailAddBegin,
    FailPendingAfter,
    ProviderAndPendingAfter,
    MixedRemoveFault,
    MixedRemoveCommit,
    FailRemoveMetadata,
    RollbackFault,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Label characterization fixtures and fault injection use the private database"
)]
async fn labels(pool: PgPool, name: &'static str, shard: u32, retry: bool, case: Case) {
    let mut lab = start(pool, name, shard).await;
    let link = lab.fixture.links[0];
    let id = lab.fixture.messages["m1a"];
    let message = delivery(
        &lab,
        Op::Labels,
        if matches!(case, Case::Missing | Case::MissingQueue) {
            "missing"
        } else {
            "m1a"
        },
    );
    let add = matches!(
        case,
        Case::Add
            | Case::Mixed
            | Case::Unknown
            | Case::Pending
            | Case::Expired
            | Case::StageDuringRead
            | Case::ConfirmDuringRead
            | Case::FailAdd
            | Case::FailAddCommit
            | Case::FailMetadata
            | Case::FailRemoveBegin
            | Case::MissingThreadEvent
            | Case::FailEventRead
            | Case::FailAddBegin
            | Case::DuplicateProvider
    );
    let mut provider: Vec<&str> = if add {
        vec!["INBOX", "UNREAD", "Label_work"]
    } else {
        vec!["INBOX"]
    };
    if matches!(
        case,
        Case::Noop | Case::FailLookup | Case::FailLabels | Case::FailPending
    ) {
        provider = vec!["INBOX", "UNREAD"];
    }
    if matches!(
        case,
        Case::Mixed | Case::FailRemoveBegin | Case::MixedRemoveFault | Case::MixedRemoveCommit
    ) {
        provider = vec!["Label_work"];
    }
    if matches!(case, Case::Unknown) {
        provider.push("Label_unknown");
    }
    if matches!(case, Case::FailAddRead) {
        sqlx::query("DELETE FROM email_message_labels WHERE message_id=$1 AND label_id=$2")
            .bind(id)
            .bind(lab.fixture.labels["A/UNREAD"])
            .execute(&lab.db)
            .await
            .expect("remove unread");
        provider = vec!["INBOX", "UNREAD"];
    }
    if matches!(case, Case::MissingThreadEvent | Case::FailEventRead) {
        provider = vec!["UNREAD", "Label_work"];
    }
    if matches!(case, Case::EventAll) {
        provider = vec!["TRASH", "SPAM", "STARRED", "Label_work"];
    }
    if matches!(case, Case::EventExcluded) {
        provider = vec![
            "INBOX",
            "UNREAD",
            "IMPORTANT",
            "SENT",
            "DRAFT",
            "CATEGORY_SOCIAL",
        ];
    }
    if matches!(case, Case::DuplicateProvider) {
        provider.extend(["Label_work", "Label_work"]);
    }
    if matches!(case, Case::EventRemove) {
        sqlx::query("INSERT INTO email_message_labels(message_id,label_id) SELECT $1,id FROM email_labels WHERE link_id=$2 AND provider_label_id IN ('TRASH','SPAM','STARRED','Label_work') ON CONFLICT DO NOTHING").bind(id).bind(link).execute(&lab.db).await.expect("event removal labels");
        provider.clear();
    }
    persistent(
        &lab,
        "messages/m1a",
        if matches!(case, Case::MissingProvider) {
            404
        } else {
            200
        },
        if matches!(case, Case::MissingProvider) {
            rejection(404)
        } else {
            json!({"id":"m1a","threadId":"t1","labelIds":provider})
        },
    );
    let write = Uuid::from_u128(0x78000000000000000000000000000001);
    if matches!(
        case,
        Case::Pending | Case::Expired | Case::ConfirmDuringRead
    ) {
        lab.transcript.normalizer.symbol(write, "<pending-write>");
        email_db_client::labels::pending_writes::mark_pending_label_writes(
            &lab.db,
            link,
            &[id],
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
    if matches!(case, Case::ConfirmDuringRead | Case::StageDuringRead) {
        lab.gmail
            .lock()
            .endpoint_replies
            .remove("/gmail/v1/users/me/messages/m1a");
        lab.gmail
            .lock()
            .messages
            .get_mut("m1a")
            .expect("provider message")
            .labels = provider.iter().map(|label| label.to_string()).collect();
    }
    let mut race = None;
    if matches!(case, Case::ConfirmDuringRead | Case::StageDuringRead) {
        let pause = lab
            .gmail
            .pause_next(Kind::ReadLabels, Some("m1a"), PauseAt::AfterApply);
        let db = lab.db.clone();
        race = Some(tokio::spawn(async move {
            pause.arrived.await.expect("read arrived");
            if matches!(case, Case::StageDuringRead) {
                email_db_client::labels::pending_writes::mark_pending_label_writes(
                    &db,
                    link,
                    &[id],
                    "Label_work",
                    false,
                    write,
                )
                .await
                .expect("stage");
            } else {
                let mut tx = db.begin().await.expect("race transaction");
                email_db_client::labels::pending_writes::confirm_pending_label_writes(
                    &mut tx,
                    &[id],
                    write,
                )
                .await
                .expect("confirm");
                tx.commit().await.expect("race commit");
            }
            pause.release.send(()).expect("release");
        }));
    }
    match case {
        Case::FailAddBegin => lab.sql_fault.fail_acquisition(7),
        Case::FailPendingAfter | Case::ProviderAndPendingAfter => {
            lab.sql_fault.fail_acquisition(6);
            if matches!(case, Case::ProviderAndPendingAfter) {
                persistent(&lab, "messages/m1a", 429, rejection(429));
                lab.gmail.lock().endpoint_headers.insert(
                    "/gmail/v1/users/me/messages/m1a".into(),
                    vec![("retry-after".into(), "3600".into())],
                );
            }
        }
        Case::MixedRemoveFault => trigger(&lab, "email_message_labels", "DELETE", false).await,
        Case::MixedRemoveCommit => trigger(&lab, "email_message_labels", "DELETE", true).await,
        Case::FailRemoveMetadata => trigger(&lab, "email_threads", "UPDATE", false).await,
        Case::RollbackFault => {
            sqlx::query("CREATE FUNCTION parity_disconnect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_terminate_backend(pg_backend_pid()); RETURN OLD; END $$").execute(&lab.db).await.expect("disconnect function");
            sqlx::query("CREATE TRIGGER parity_disconnect BEFORE DELETE ON email_message_labels FOR EACH STATEMENT EXECUTE FUNCTION parity_disconnect()").execute(&lab.db).await.expect("disconnect trigger");
        }
        Case::MissingQueue => lab.sqs.set_outage(true),
        Case::FailLookup => {
            sqlx::query(
                "ALTER TABLE email_messages RENAME COLUMN provider_id TO parity_hidden_provider_id",
            )
            .execute(&lab.db)
            .await
            .expect("fault");
        }
        Case::FailLabels => {
            sqlx::query("ALTER TABLE email_message_labels RENAME TO parity_hidden_labels")
                .execute(&lab.db)
                .await
                .expect("fault");
        }
        Case::FailPending => {
            sqlx::query(
                "ALTER TABLE email_gmail_pending_label_writes RENAME TO parity_hidden_pending",
            )
            .execute(&lab.db)
            .await
            .expect("fault");
        }
        Case::FailAdd => trigger(&lab, "email_message_labels", "INSERT", false).await,
        Case::FailRemove => trigger(&lab, "email_message_labels", "DELETE", false).await,
        Case::FailAddCommit => trigger(&lab, "email_message_labels", "INSERT", true).await,
        Case::FailRemoveCommit => trigger(&lab, "email_message_labels", "DELETE", true).await,
        Case::FailAddRead | Case::FailRemoveRead => {
            trigger(&lab, "email_messages", "UPDATE", false).await
        }
        Case::FailMetadata => {
            sqlx::query("ALTER TABLE email_mailbox_drafts RENAME TO parity_hidden_drafts")
                .execute(&lab.db)
                .await
                .expect("fault");
        }
        Case::FailRemoveBegin => lab.sql_fault.fail_acquisition(8),
        Case::FailEventRead => lab.sql_fault.fail_acquisition(9),
        Case::MissingThreadEvent => {
            let (arrived, release) = lab.sql_fault.pause_acquisition(9);
            let db = lab.db.clone();
            let thread = crate::pubsub::label_write_sim::world::thread_uuid(shard, 0);
            race = Some(tokio::spawn(async move {
                arrived.await.expect("event state query arrived");
                sqlx::query("DELETE FROM email_threads WHERE id=$1")
                    .bind(thread)
                    .execute(&db)
                    .await
                    .expect("concurrent thread deletion");
                release.send(()).expect("release state query");
            }));
        }
        _ => {}
    }
    let first = lab
        .worker_step("label synchronization", queue(retry), &message)
        .await;
    if let Some(task) = race {
        task.await.expect("race fixture");
    }
    if matches!(case, Case::Missing) && !first.sent.is_empty() {
        let follow = Delivery::from_sent(&first.sent[0]);
        lab.worker_step("queued missing-message upsert", Queue::InboxSync, &follow)
            .await
            .result
            .expect("follow-up");
    } else if matches!(
        case,
        Case::Noop
            | Case::Add
            | Case::Remove
            | Case::Mixed
            | Case::Pending
            | Case::Expired
            | Case::EventAll
            | Case::EventExcluded
    ) {
        duplicate(&mut lab, retry, &message).await;
    }
    if matches!(case, Case::MixedRemoveFault | Case::MixedRemoveCommit) {
        sqlx::query("DROP TRIGGER parity_inbox_fault ON email_message_labels")
            .execute(&lab.db)
            .await
            .expect("repair fault");
        duplicate(&mut lab, retry, &message).await;
    }
    lab.transcript.finish();
}

cases! { labels;
    labels_noop_primary, 71000, false, Case::Noop;
    labels_noop_retry, 71003, true, Case::Noop;
    labels_add_primary, 71006, false, Case::Add;
    labels_add_retry, 71009, true, Case::Add;
    labels_remove_primary, 71012, false, Case::Remove;
    labels_remove_retry, 71015, true, Case::Remove;
    labels_mixed_primary, 71018, false, Case::Mixed;
    labels_mixed_retry, 71021, true, Case::Mixed;
    labels_unknown_primary, 71024, false, Case::Unknown;
    labels_unknown_retry, 71027, true, Case::Unknown;
    labels_missing_primary, 71030, false, Case::Missing;
    labels_missing_retry, 71033, true, Case::Missing;
    labels_missing_queue_primary, 71036, false, Case::MissingQueue;
    labels_missing_queue_retry, 71039, true, Case::MissingQueue;
    labels_missing_provider_primary, 71042, false, Case::MissingProvider;
    labels_missing_provider_retry, 71045, true, Case::MissingProvider;
    labels_pending_primary, 71048, false, Case::Pending;
    labels_pending_retry, 71051, true, Case::Pending;
    labels_expired_primary, 71054, false, Case::Expired;
    labels_expired_retry, 71057, true, Case::Expired;
    labels_confirm_during_read_primary, 71060, false, Case::ConfirmDuringRead;
    labels_confirm_during_read_retry, 71063, true, Case::ConfirmDuringRead;
    labels_stage_during_read_primary, 71066, false, Case::StageDuringRead;
    labels_stage_during_read_retry, 71069, true, Case::StageDuringRead;
    labels_fail_lookup_primary, 71072, false, Case::FailLookup;
    labels_fail_lookup_retry, 71075, true, Case::FailLookup;
    labels_fail_labels_primary, 71078, false, Case::FailLabels;
    labels_fail_labels_retry, 71081, true, Case::FailLabels;
    labels_fail_pending_primary, 71084, false, Case::FailPending;
    labels_fail_pending_retry, 71087, true, Case::FailPending;
    labels_fail_add_primary, 71090, false, Case::FailAdd;
    labels_fail_add_retry, 71093, true, Case::FailAdd;
    labels_fail_remove_primary, 71096, false, Case::FailRemove;
    labels_fail_remove_retry, 71099, true, Case::FailRemove;
    labels_fail_add_commit_primary, 71102, false, Case::FailAddCommit;
    labels_fail_add_commit_retry, 71105, true, Case::FailAddCommit;
    labels_fail_remove_commit_primary, 71108, false, Case::FailRemoveCommit;
    labels_fail_remove_commit_retry, 71111, true, Case::FailRemoveCommit;
    labels_fail_add_read_primary, 71114, false, Case::FailAddRead;
    labels_fail_add_read_retry, 71117, true, Case::FailAddRead;
    labels_fail_remove_read_primary, 71120, false, Case::FailRemoveRead;
    labels_fail_remove_read_retry, 71123, true, Case::FailRemoveRead;
    labels_fail_metadata_primary, 71126, false, Case::FailMetadata;
    labels_fail_metadata_retry, 71129, true, Case::FailMetadata;
    labels_fail_remove_begin_primary, 71132, false, Case::FailRemoveBegin;
    labels_fail_remove_begin_retry, 71135, true, Case::FailRemoveBegin;
    labels_missing_thread_event_primary, 71138, false, Case::MissingThreadEvent;
    labels_missing_thread_event_retry, 71141, true, Case::MissingThreadEvent;
    labels_fail_event_read_primary, 71144, false, Case::FailEventRead;
    labels_fail_event_read_retry, 71147, true, Case::FailEventRead;
    labels_event_all_primary, 71150, false, Case::EventAll;
    labels_event_all_retry, 71153, true, Case::EventAll;
    labels_event_excluded_primary, 71156, false, Case::EventExcluded;
    labels_event_excluded_retry, 71159, true, Case::EventExcluded;
}

cases! { labels;
 labels_event_remove_primary, 85000, false, Case::EventRemove;
 labels_event_remove_retry, 85003, true, Case::EventRemove;
 labels_duplicate_provider_primary, 85006, false, Case::DuplicateProvider;
 labels_duplicate_provider_retry, 85009, true, Case::DuplicateProvider;
 labels_fail_add_begin_primary, 85012, false, Case::FailAddBegin;
 labels_fail_add_begin_retry, 85015, true, Case::FailAddBegin;
 labels_fail_pending_after_primary, 85018, false, Case::FailPendingAfter;
 labels_fail_pending_after_retry, 85021, true, Case::FailPendingAfter;
 labels_provider_and_pending_after_primary, 85024, false, Case::ProviderAndPendingAfter;
 labels_provider_and_pending_after_retry, 85027, true, Case::ProviderAndPendingAfter;
 labels_mixed_remove_fault_primary, 85030, false, Case::MixedRemoveFault;
 labels_mixed_remove_fault_retry, 85033, true, Case::MixedRemoveFault;
 labels_mixed_remove_commit_primary, 85036, false, Case::MixedRemoveCommit;
 labels_mixed_remove_commit_retry, 85039, true, Case::MixedRemoveCommit;
 labels_fail_remove_metadata_primary, 85042, false, Case::FailRemoveMetadata;
 labels_fail_remove_metadata_retry, 85045, true, Case::FailRemoveMetadata;
 labels_rollback_fault_primary, 85048, false, Case::RollbackFault;
 labels_rollback_fault_retry, 85051, true, Case::RollbackFault;
}
