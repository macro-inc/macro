use super::*;

mod cases;
mod transactions;

#[derive(Clone, Copy)]
enum Fault {
    Decode,
    Unknown,
    MissingBody,
    MissingLink,
    MissingReceipt,
    Delete,
    DecodeAndDelete,
    RetryQueue,
    LinkQuery,
    TurnQuery,
    TokenQuery,
    ConfirmBegin,
    ConfirmThreads,
    ConfirmLock,
    ConfirmWrite,
    ConfirmCommit,
    AbandonBegin,
    AbandonThreads,
    AbandonLock,
    AbandonWrite,
    AbandonCommit,
    RevertBegin,
    RevertThreads,
    RevertLock,
    RevertWrite,
    RevertInsert,
    RevertDelete,
    RevertFlags,
    RevertReceived,
    RevertMetadata,
    RevertSignal,
    RevertCommit,
    LegacyInsert,
    LegacyDelete,
    LegacyRead,
    LegacyStarred,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Faults target only the test database and use uncached runtime SQL"
)]
async fn trigger(lab: &Lab, table: &str, operation: &str, commit: bool) {
    sqlx::query("CREATE FUNCTION parity_worker_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'parity injected worker failure'; END $$")
        .execute(&lab.db).await.expect("fault function");
    let sql = if commit {
        format!(
            "CREATE CONSTRAINT TRIGGER parity_worker_fault AFTER {operation} ON {table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION parity_worker_fault()"
        )
    } else {
        format!(
            "CREATE TRIGGER parity_worker_fault BEFORE {operation} ON {table} FOR EACH STATEMENT EXECUTE FUNCTION parity_worker_fault()"
        )
    };
    sqlx::query(&sql)
        .execute(&lab.db)
        .await
        .expect("fault trigger");
}

#[expect(
    clippy::disallowed_methods,
    reason = "Faults target distinct worker queries and transactions in the test database"
)]
async fn fault(pool: PgPool, name: &'static str, shard: u32, retry: bool, fault: Fault) {
    let mut lab = start(pool, name, shard).await;
    let queue = if retry {
        Queue::GmailOpsRetry
    } else {
        Queue::GmailOps
    };
    let write = Uuid::from_u128(0x6000_0000_0000_0000_0000_0000_0000_0001);
    let newer = Uuid::from_u128(0x6000_0000_0000_0000_0000_0000_0000_0002);
    lab.transcript.normalizer.symbol(write, "<write:older>");
    lab.transcript.normalizer.symbol(newer, "<write:newer>");
    let abandon = matches!(
        fault,
        Fault::AbandonBegin
            | Fault::AbandonThreads
            | Fault::AbandonLock
            | Fault::AbandonWrite
            | Fault::AbandonCommit
    );
    let revert = matches!(
        fault,
        Fault::RevertBegin
            | Fault::RevertThreads
            | Fault::RevertLock
            | Fault::RevertWrite
            | Fault::RevertInsert
            | Fault::RevertDelete
            | Fault::RevertFlags
            | Fault::RevertReceived
            | Fault::RevertMetadata
            | Fault::RevertSignal
            | Fault::RevertCommit
            | Fault::LegacyInsert
            | Fault::LegacyDelete
            | Fault::LegacyRead
            | Fault::LegacyStarred
    );
    let legacy = matches!(
        fault,
        Fault::LegacyInsert | Fault::LegacyDelete | Fault::LegacyRead | Fault::LegacyStarred
    );
    let adding = !matches!(fault, Fault::RevertInsert | Fault::LegacyInsert);
    let label = match fault {
        Fault::LegacyRead => "UNREAD",
        Fault::LegacyStarred => "STARRED",
        _ => "Label_work",
    };
    if !legacy {
        mark(&mut lab, &["m1a"], write, adding, label).await;
    }
    if abandon {
        mark(&mut lab, &["m1a"], newer, false, label).await;
        sqlx::query("UPDATE email_gmail_pending_label_writes SET expires_at=now()-interval '1 hour' WHERE write_id=$1")
            .bind(newer).execute(&lab.db).await.expect("expired newer write");
    }
    let mut message = delivery(
        &lab,
        label_operation(
            &lab,
            &["m1a"],
            (!legacy).then_some(write),
            true,
            label,
            adding,
        ),
    );
    if revert {
        script(&lab, "POST", "messages/m1a/modify", rejection(400));
    }
    match fault {
        Fault::Decode | Fault::DecodeAndDelete => message.body = Some("not-json".into()),
        Fault::Unknown => {
            message.body =
                Some(json!({"linkId":lab.fixture.links[0], "operation":{"unknown":{}}}).to_string())
        }
        Fault::MissingBody => message.body = None,
        Fault::MissingLink => {
            let absent = Uuid::from_u128(0x9000_0000_0000_0000_0000_0000_0000_0001);
            lab.transcript.normalizer.symbol(absent, "<missing>");
            let mut body: Value =
                serde_json::from_str(message.body.as_ref().expect("body")).expect("JSON");
            body["linkId"] = json!(absent);
            message.body = Some(body.to_string());
        }
        Fault::MissingReceipt => message.receipt_handle = None,
        Fault::Delete => lab.sqs.lock().fail_delete = true,
        Fault::RetryQueue => {
            script(&lab, "POST", "messages/m1a/modify", rejection(503));
            lab.sqs.set_outage(true);
        }
        Fault::LinkQuery => {
            sqlx::query("ALTER TABLE email_links RENAME TO parity_hidden_links")
                .execute(&lab.db)
                .await
                .expect("link fault");
        }
        Fault::TurnQuery => {
            sqlx::query(
                "ALTER TABLE email_gmail_pending_label_writes RENAME TO parity_hidden_writes",
            )
            .execute(&lab.db)
            .await
            .expect("turn fault");
        }
        Fault::TokenQuery => lab.sql_fault.fail_acquisition(3),
        Fault::ConfirmBegin | Fault::RevertBegin => lab.sql_fault.fail_acquisition(4),
        Fault::AbandonBegin => lab.sql_fault.fail_acquisition(3),
        Fault::ConfirmThreads | Fault::AbandonThreads | Fault::RevertThreads => {
            sqlx::query(
                "ALTER TABLE email_messages RENAME COLUMN thread_id TO parity_hidden_thread_id",
            )
            .execute(&lab.db)
            .await
            .expect("threads fault");
        }
        Fault::ConfirmLock | Fault::AbandonLock | Fault::RevertLock => {
            // Exact integer argument beats pg_catalog's bigint overload without changing search_path.
            sqlx::query("CREATE FUNCTION public.hashtextextended(text,integer) RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'parity injected lock failure'; END $$")
                .execute(&lab.db).await.expect("lock fault");
        }
        Fault::ConfirmWrite | Fault::AbandonWrite | Fault::RevertWrite => {
            trigger(&lab, "email_gmail_pending_label_writes", "DELETE", false).await
        }
        Fault::ConfirmCommit | Fault::AbandonCommit | Fault::RevertCommit => {
            trigger(&lab, "email_gmail_pending_label_writes", "DELETE", true).await
        }
        Fault::RevertInsert | Fault::LegacyInsert => {
            trigger(&lab, "email_message_labels", "INSERT", false).await
        }
        Fault::RevertDelete | Fault::LegacyDelete => {
            trigger(&lab, "email_message_labels", "DELETE", false).await
        }
        Fault::RevertFlags | Fault::LegacyRead | Fault::LegacyStarred => {
            trigger(&lab, "email_messages", "UPDATE", false).await
        }
        Fault::RevertReceived => {
            sqlx::query("ALTER TABLE email_message_recipients RENAME TO parity_hidden_recipients")
                .execute(&lab.db)
                .await
                .expect("received-mail fault");
        }
        Fault::RevertMetadata => {
            sqlx::query("ALTER TABLE email_mailbox_drafts RENAME TO parity_hidden_drafts")
                .execute(&lab.db)
                .await
                .expect("thread metadata fault");
        }
        Fault::RevertSignal => {
            sqlx::query("ALTER TABLE email_filters RENAME TO parity_hidden_filters")
                .execute(&lab.db)
                .await
                .expect("thread signal fault");
        }
    }
    if matches!(fault, Fault::DecodeAndDelete) {
        lab.sqs.lock().fail_delete = true;
    }
    let first = lab.worker_step("faulted delivery", queue, &message).await;
    // Query failures intentionally return Ok while retaining the delivery. Pin receive
    // counts through the primary queue's last receive and the retry queue's limit.
    if !first.deleted {
        let mut again = message.redelivered();
        again.receive_count = if retry { 100 } else { 3 };
        lab.reset_admission().await;
        lab.worker_step("last receive before queue redrive", queue, &again)
            .await;
    }
    lab.transcript.finish();
}
