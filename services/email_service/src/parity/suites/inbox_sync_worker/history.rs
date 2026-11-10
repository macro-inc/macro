use super::*;

#[derive(Clone, Copy)]
enum Case {
    Missing,
    Equal,
    Newer,
    Empty,
    Work,
    Regress,
    Malformed,
    Stale,
    ExistingRecovery,
    RecoveryQueue,
    ExistingQueue,
    RepairFail,
    ReadFail,
    CatalogRead,
    CatalogDelete,
    CatalogUpsert,
    JournalInsert,
    JournalCommit,
    RecoveryRead,
    RecoveryInsert,
    RecoveryCleanup,
    CursorUpdate,
    CatalogMixed,
}

#[expect(
    clippy::disallowed_methods,
    reason = "History fixtures and faults use the private database"
)]
async fn history(pool: PgPool, name: &'static str, shard: u32, retry: bool, case: Case) {
    let mut lab = start(pool, name, shard).await;
    if !matches!(case, Case::Missing) {
        seed_history(
            &lab,
            match case {
                Case::Equal => "200",
                Case::Newer => "201",
                Case::Malformed => "malformed",
                _ => "100",
            },
        )
        .await;
    }
    let stale = matches!(
        case,
        Case::Stale
            | Case::ExistingRecovery
            | Case::RecoveryQueue
            | Case::ExistingQueue
            | Case::RepairFail
            | Case::RecoveryRead
            | Case::RecoveryInsert
            | Case::RecoveryCleanup
    );
    if matches!(case, Case::ExistingRecovery | Case::ExistingQueue) {
        email_db_client::backfill::job::insert::create_backfill_job(
            &lab.db,
            lab.fixture.links[0],
            &lab.fixture.fusion[0],
            None,
            true,
        )
        .await
        .expect("job")
        .expect("created");
    }
    if matches!(case, Case::Empty) {
        sqlx::query("DELETE FROM email_labels WHERE link_id=$1 AND provider_label_id<>'INBOX'")
            .bind(lab.fixture.links[0])
            .execute(&lab.db)
            .await
            .expect("single-label empty catalog fixture");
    }
    let labels = if matches!(case, Case::Empty) {
        json!({"labels":[]})
    } else if matches!(case, Case::CatalogDelete) {
        json!({"labels":(["INBOX","UNREAD","STARRED","SPAM","SENT","Label_work"].into_iter().map(|id|json!({"id":id,"name":if id=="Label_work"{"Work"}else{id},"type":if id=="Label_work"{"user"}else{"system"},"messageListVisibility":"show","labelListVisibility":"labelShow"})).collect::<Vec<_>>())})
    } else if matches!(
        case,
        Case::CatalogMixed | Case::CatalogDelete | Case::CatalogUpsert
    ) {
        {
            let mut values = catalog();
            let labels = values["labels"].as_array_mut().expect("catalog");
            labels.retain(|label| label["id"] != "TRASH");
            labels
                .iter_mut()
                .find(|label| label["id"] == "INBOX")
                .expect("inbox")["name"] = json!("Inbox renamed");
            labels.push(json!({"id":"Label_new","name":"New","type":"user","messageListVisibility":"show","labelListVisibility":"labelShow"}));
            values
        }
    } else {
        json!({"labels": (["INBOX","UNREAD","STARRED","TRASH","SPAM","SENT","Label_work"].into_iter().map(|id|json!({"id":id,"name":if id=="Label_work"{"Work"}else{id},"type":if id=="Label_work"{"user"}else{"system"}})).collect::<Vec<_>>())})
    };
    persistent(&lab, "labels", 200, labels);
    let changes = if matches!(case, Case::Work) {
        json!({"historyId":"200","history":[{"id":"150","messagesAdded":[{"message":{"id":"new-message","threadId":"new-thread"}}],"messagesDeleted":[{"message":{"id":"m2b","threadId":"t2"}}],"labelsAdded":[{"message":{"id":"m1a","threadId":"t1"},"labelIds":["STARRED"]}]}]})
    } else {
        json!({"historyId":if matches!(case,Case::Regress){"90"}else{"200"},"history":[]})
    };
    persistent(
        &lab,
        "history",
        if stale { 404 } else { 200 },
        if stale { rejection(404) } else { changes },
    );
    match case {
        Case::RecoveryQueue | Case::ExistingQueue | Case::RecoveryCleanup => {
            lab.sqs.set_outage(true)
        }
        _ => {}
    }
    match case {
        Case::ReadFail => {
            sqlx::query("ALTER TABLE email_gmail_histories RENAME TO parity_hidden_histories")
                .execute(&lab.db)
                .await
                .expect("fault");
        }
        Case::CatalogRead => {
            sqlx::query("ALTER TABLE email_labels RENAME TO parity_hidden_labels")
                .execute(&lab.db)
                .await
                .expect("fault");
        }
        Case::CatalogDelete => trigger(&lab, "email_labels", "DELETE", false).await,
        Case::CatalogUpsert => trigger(&lab, "email_labels", "INSERT", false).await,
        Case::JournalInsert => {
            persistent(
                &lab,
                "history",
                200,
                json!({"historyId":"200","history":[{"id":"150","messagesAdded":[{"message":{"id":"new-message","threadId":"new-thread"}}]}]}),
            );
            trigger(&lab, "email_mailbox_lifecycle_outbox", "INSERT", false).await;
        }
        Case::JournalCommit => trigger(&lab, "email_gmail_histories", "UPDATE", true).await,
        Case::CursorUpdate => trigger(&lab, "email_gmail_histories", "UPDATE", false).await,
        Case::RepairFail => trigger(&lab, "email_gmail_histories", "UPDATE", false).await,
        Case::RecoveryRead => {
            sqlx::query("ALTER TABLE email_backfill_jobs RENAME TO parity_hidden_jobs")
                .execute(&lab.db)
                .await
                .expect("fault");
        }
        Case::RecoveryInsert => trigger(&lab, "email_backfill_jobs", "INSERT", false).await,
        Case::RecoveryCleanup => trigger(&lab, "email_backfill_jobs", "UPDATE", false).await,
        _ => {}
    }
    let message = delivery(&lab, Op::History, "");
    lab.worker_step("history notification", queue(retry), &message)
        .await
        .result
        .expect("handled history");
    if matches!(case, Case::Empty | Case::Work | Case::CatalogMixed) {
        let cursor: String =
            sqlx::query_scalar("SELECT history_id FROM email_gmail_histories WHERE link_id=$1")
                .bind(lab.fixture.links[0])
                .fetch_one(&lab.db)
                .await
                .expect("accepted cursor");
        assert_eq!(cursor, "200", "fixture must reach history acceptance");
    }
    if matches!(case, Case::Work) {
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM email_mailbox_lifecycle_outbox")
            .fetch_one(&lab.db)
            .await
            .expect("outbox");
        assert_eq!(count, 3, "all history work was journaled");
    }
    if matches!(
        case,
        Case::Empty
            | Case::Work
            | Case::Stale
            | Case::Malformed
            | Case::ExistingRecovery
            | Case::CatalogMixed
    ) {
        duplicate(&mut lab, retry, &message).await;
    }
    lab.transcript.finish();
}

cases! { history;
    history_missing_primary, 72000, false, Case::Missing;
    history_missing_retry, 72003, true, Case::Missing;
    history_equal_primary, 72006, false, Case::Equal;
    history_equal_retry, 72009, true, Case::Equal;
    history_newer_primary, 72012, false, Case::Newer;
    history_newer_retry, 72015, true, Case::Newer;
    history_empty_primary, 72018, false, Case::Empty;
    history_empty_retry, 72021, true, Case::Empty;
    history_work_primary, 72024, false, Case::Work;
    history_work_retry, 72027, true, Case::Work;
    history_regress_primary, 72030, false, Case::Regress;
    history_regress_retry, 72033, true, Case::Regress;
    history_malformed_primary, 72036, false, Case::Malformed;
    history_malformed_retry, 72039, true, Case::Malformed;
    history_stale_primary, 72042, false, Case::Stale;
    history_stale_retry, 72045, true, Case::Stale;
    history_existing_recovery_primary, 72048, false, Case::ExistingRecovery;
    history_existing_recovery_retry, 72051, true, Case::ExistingRecovery;
    history_recovery_queue_primary, 72054, false, Case::RecoveryQueue;
    history_recovery_queue_retry, 72057, true, Case::RecoveryQueue;
    history_existing_queue_primary, 72060, false, Case::ExistingQueue;
    history_existing_queue_retry, 72063, true, Case::ExistingQueue;
    history_repair_fail_primary, 72066, false, Case::RepairFail;
    history_repair_fail_retry, 72069, true, Case::RepairFail;
    history_read_fail_primary, 72072, false, Case::ReadFail;
    history_read_fail_retry, 72075, true, Case::ReadFail;
    history_catalog_read_primary, 72078, false, Case::CatalogRead;
    history_catalog_read_retry, 72081, true, Case::CatalogRead;
    history_catalog_delete_primary, 72084, false, Case::CatalogDelete;
    history_catalog_delete_retry, 72087, true, Case::CatalogDelete;
    history_catalog_upsert_primary, 72090, false, Case::CatalogUpsert;
    history_catalog_upsert_retry, 72093, true, Case::CatalogUpsert;
    history_journal_insert_primary, 72096, false, Case::JournalInsert;
    history_journal_insert_retry, 72099, true, Case::JournalInsert;
    history_journal_commit_primary, 72102, false, Case::JournalCommit;
    history_journal_commit_retry, 72105, true, Case::JournalCommit;
    history_recovery_read_primary, 72108, false, Case::RecoveryRead;
    history_recovery_read_retry, 72111, true, Case::RecoveryRead;
    history_recovery_insert_primary, 72114, false, Case::RecoveryInsert;
    history_recovery_insert_retry, 72117, true, Case::RecoveryInsert;
    history_recovery_cleanup_primary, 72120, false, Case::RecoveryCleanup;
    history_recovery_cleanup_retry, 72123, true, Case::RecoveryCleanup;
    history_cursor_update_primary, 72126, false, Case::CursorUpdate;
    history_cursor_update_retry, 72129, true, Case::CursorUpdate;
    history_catalog_mixed_primary, 72132, false, Case::CatalogMixed;
    history_catalog_mixed_retry, 72135, true, Case::CatalogMixed;
}
