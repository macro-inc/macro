use super::*;
use crate::pubsub::label_write_sim::fake_gmail::PauseAt;

#[derive(Clone, Copy)]
enum Case {
    Pages,
    LatePageFailure,
    CursorChanged,
    Inactive,
    Disconnect,
    HistoryRemoved,
    ProviderChanged,
    BeginFault,
    LockFault,
    LaterInsertFault,
    RecoveryConflict,
    RecoveryWinnerGone,
    RecoveryRefetchFault,
    MaxCursor,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Cursor races use exact HTTP/acquisition barriers and isolated fixture SQL"
)]
async fn history_edges(pool: PgPool, name: &'static str, shard: u32, retry: bool, case: Case) {
    let mut lab = start(pool, name, shard).await;
    seed_history(&lab, "100").await;
    // Keep this catalog identical so the test's next acquisition belongs to history acceptance.
    persistent(
        &lab,
        "labels",
        200,
        json!({"labels":(["INBOX","UNREAD","STARRED","TRASH","SPAM","SENT","Label_work"].into_iter().map(|id|json!({"id":id,"name":if id=="Label_work"{"Work"}else{id},"type":if id=="Label_work"{"user"}else{"system"},"messageListVisibility":"show","labelListVisibility":"labelShow"})).collect::<Vec<_>>())}),
    );
    let stale = matches!(
        case,
        Case::RecoveryConflict | Case::RecoveryWinnerGone | Case::RecoveryRefetchFault
    );
    let work = json!({"historyId":"200","history":[{"id":"150","messagesAdded":[{"message":{"id":"new-one","threadId":"thread-one"}},{"message":{"id":"new-two","threadId":"thread-two"}}]}]});
    persistent(
        &lab,
        "history",
        if stale { 404 } else { 200 },
        if stale { rejection(404) } else { work },
    );
    if matches!(case, Case::Pages | Case::LatePageFailure) {
        lab.gmail.lock().endpoint_replies.insert("/gmail/v1/users/me/history".into(), [
            (200,json!({"historyId":"150","nextPageToken":"page-two","history":[{"id":"150","messagesAdded":[{"message":{"id":"duplicate","threadId":"thread-one"}}]}]})),
            if matches!(case,Case::LatePageFailure) {(503,rejection(503))} else {(200,json!({"historyId":"200","history":[{"id":"170","messagesAdded":[{"message":{"id":"duplicate","threadId":"thread-one"}}],"messagesDeleted":[{"message":{"id":"m1b","threadId":"t1"}}],"labelsRemoved":[{"message":{"id":"m1a","threadId":"t1"},"labelIds":["UNREAD"]}]}]}))}
        ].into());
    }
    if matches!(case, Case::MaxCursor) {
        persistent(
            &lab,
            "history",
            200,
            json!({"historyId":u64::MAX.to_string(),"history":[]}),
        );
    }
    if matches!(case, Case::LaterInsertFault) {
        sqlx::query("CREATE SEQUENCE parity_inserts")
            .execute(&lab.db)
            .await
            .expect("counter");
        sqlx::query("CREATE FUNCTION parity_second_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('parity_inserts')=2 THEN RAISE EXCEPTION 'parity second history insert failure'; END IF; RETURN NEW; END $$").execute(&lab.db).await.expect("function");
        sqlx::query("CREATE TRIGGER parity_second_insert BEFORE INSERT ON email_mailbox_lifecycle_outbox FOR EACH ROW EXECUTE FUNCTION parity_second_insert()").execute(&lab.db).await.expect("trigger");
    }
    let mut race = None;
    if !matches!(
        case,
        Case::Pages | Case::LatePageFailure | Case::LaterInsertFault | Case::MaxCursor
    ) {
        let pause = lab
            .gmail
            .pause_next_http("/gmail/v1/users/me/history", PauseAt::AfterApply);
        let db = lab.db.clone();
        let link = lab.fixture.links[0];
        let actor = lab.fixture.fusion[0].clone();
        let fault = lab.sql_fault.clone();
        race = Some(tokio::spawn(async move {
            pause.arrived.await.expect("history answer arrived");
            match case {
                Case::CursorChanged => {
                    sqlx::query(
                        "UPDATE email_gmail_histories SET history_id='150' WHERE link_id=$1",
                    )
                    .bind(link)
                    .execute(&db)
                    .await
                    .expect("cursor race");
                }
                Case::Inactive => {
                    sqlx::query("UPDATE email_links SET is_sync_active=false WHERE id=$1")
                        .bind(link)
                        .execute(&db)
                        .await
                        .expect("deactivate");
                }
                Case::Disconnect => {
                    sqlx::query("UPDATE email_links SET disconnect_requested_at=now() WHERE id=$1")
                        .bind(link)
                        .execute(&db)
                        .await
                        .expect("disconnect");
                }
                Case::HistoryRemoved => {
                    sqlx::query("DELETE FROM email_gmail_histories WHERE link_id=$1")
                        .bind(link)
                        .execute(&db)
                        .await
                        .expect("remove history");
                }
                Case::ProviderChanged => {
                    sqlx::query("UPDATE email_links SET provider='OUTLOOK' WHERE id=$1")
                        .bind(link)
                        .execute(&db)
                        .await
                        .expect("provider race");
                }
                Case::BeginFault => fault.fail_acquisition(1),
                Case::LockFault => {
                    sqlx::query("ALTER TABLE email_gmail_histories RENAME COLUMN history_id TO parity_hidden_history").execute(&db).await.expect("lock query fault");
                }
                Case::RecoveryConflict | Case::RecoveryWinnerGone | Case::RecoveryRefetchFault => {
                    let (arrived, release) = fault.pause_acquisition(2);
                    pause.release.send(()).expect("release history");
                    arrived.await.expect("recovery insert arrived");
                    let job = email_db_client::backfill::job::insert::create_backfill_job(
                        &db, link, &actor, None, true,
                    )
                    .await
                    .expect("other recovery")
                    .expect("winner");
                    if matches!(case, Case::RecoveryRefetchFault) {
                        fault.fail_acquisition(1);
                    }
                    if matches!(case, Case::RecoveryWinnerGone) {
                        let (refetch, resume) = fault.pause_acquisition(1);
                        release.send(()).expect("release conflict");
                        refetch.await.expect("refetch arrived");
                        sqlx::query("UPDATE email_backfill_jobs SET status='Complete' WHERE id=$1")
                            .bind(job.id)
                            .execute(&db)
                            .await
                            .expect("finish winner");
                        resume.send(()).expect("release missing winner");
                    } else {
                        release.send(()).expect("release conflict");
                    }
                    return;
                }
                _ => unreachable!("only race cases"),
            }
            pause.release.send(()).expect("release history");
        }));
    }
    let mut message = delivery(&lab, Op::History, "");
    if matches!(case, Case::MaxCursor) {
        message.body = Some(
            serde_json::to_string(&InboxSyncPubsubMessage {
                link_id: lab.fixture.links[0],
                operation: InboxSyncOperation::GmailMessage(GmailMessagePayload {
                    history_id: u64::MAX,
                }),
            })
            .expect("max cursor"),
        );
    }
    lab.worker_step("history edge", queue(retry), &message)
        .await
        .result
        .expect("classified");
    if let Some(task) = race {
        task.await.expect("race task");
    }
    if matches!(case, Case::Pages | Case::MaxCursor | Case::RecoveryConflict) {
        duplicate(&mut lab, retry, &message).await;
    }
    lab.transcript.finish();
}

cases! { history_edges;
    history_pages_primary, 82000, false, Case::Pages;
    history_pages_retry, 82003, true, Case::Pages;
    history_late_page_failure_primary, 82006, false, Case::LatePageFailure;
    history_late_page_failure_retry, 82009, true, Case::LatePageFailure;
    history_cursor_changed_primary, 82012, false, Case::CursorChanged;
    history_cursor_changed_retry, 82015, true, Case::CursorChanged;
    history_inactive_primary, 82018, false, Case::Inactive;
    history_inactive_retry, 82021, true, Case::Inactive;
    history_disconnect_primary, 82024, false, Case::Disconnect;
    history_disconnect_retry, 82027, true, Case::Disconnect;
    history_history_removed_primary, 82030, false, Case::HistoryRemoved;
    history_history_removed_retry, 82033, true, Case::HistoryRemoved;
    history_provider_changed_primary, 82036, false, Case::ProviderChanged;
    history_provider_changed_retry, 82039, true, Case::ProviderChanged;
    history_begin_fault_primary, 82042, false, Case::BeginFault;
    history_begin_fault_retry, 82045, true, Case::BeginFault;
    history_lock_fault_primary, 82048, false, Case::LockFault;
    history_lock_fault_retry, 82051, true, Case::LockFault;
    history_later_insert_fault_primary, 82054, false, Case::LaterInsertFault;
    history_later_insert_fault_retry, 82057, true, Case::LaterInsertFault;
    history_recovery_conflict_primary, 82060, false, Case::RecoveryConflict;
    history_recovery_conflict_retry, 82063, true, Case::RecoveryConflict;
    history_recovery_winner_gone_primary, 82066, false, Case::RecoveryWinnerGone;
    history_recovery_winner_gone_retry, 82069, true, Case::RecoveryWinnerGone;
    history_recovery_refetch_fault_primary, 82072, false, Case::RecoveryRefetchFault;
    history_recovery_refetch_fault_retry, 82075, true, Case::RecoveryRefetchFault;
    history_max_cursor_primary, 82078, false, Case::MaxCursor;
    history_max_cursor_retry, 82081, true, Case::MaxCursor;
}
