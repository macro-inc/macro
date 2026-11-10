use super::*;

#[derive(Clone, Copy)]
enum Case {
    Received,
    Sent,
    Draft,
    Missing,
    LastMessage,
    BeginFault,
    LookupFault,
    SenderFault,
    RecipientFault,
    DeleteFault,
    CleanupFault,
    CommitFault,
    Deferred,
    NoSender,
    BlankAddress,
    SentDraft,
    MetadataFault,
    CalendarFault,
    ThreadDeleteFault,
    RollbackFault,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Deletion characterization uses isolated fixture rows and SQL faults"
)]
async fn deletion(pool: PgPool, name: &'static str, shard: u32, retry: bool, case: Case) {
    let mut lab = start(pool, name, shard).await;
    let id = lab.fixture.messages["m1a"];
    sqlx::query("INSERT INTO email_contacts(id,link_id,email_address,name) VALUES($1,$2,'sender@example.com','Sender')")
        .bind(Uuid::from_u128(0x79000000000000000000000000000001)).bind(lab.fixture.links[0]).execute(&lab.db).await.expect("sender");
    sqlx::query("UPDATE email_messages SET from_contact_id=$2,is_sent=$3,is_draft=$4 WHERE id=$1")
        .bind(id)
        .bind(Uuid::from_u128(0x79000000000000000000000000000001))
        .bind(matches!(
            case,
            Case::Sent | Case::RecipientFault | Case::SentDraft
        ))
        .bind(matches!(case, Case::Draft | Case::SentDraft))
        .execute(&lab.db)
        .await
        .expect("message flags");
    if matches!(case, Case::Sent | Case::RecipientFault | Case::SentDraft) {
        sqlx::query("INSERT INTO email_message_recipients(message_id,contact_id,recipient_type) VALUES($1,$2,'TO')")
            .bind(id).bind(Uuid::from_u128(0x79000000000000000000000000000001)).execute(&lab.db).await.expect("recipient");
    }
    if matches!(case, Case::LastMessage | Case::ThreadDeleteFault) {
        sqlx::query("DELETE FROM email_messages WHERE thread_id=(SELECT thread_id FROM email_messages WHERE id=$1) AND id<>$1").bind(id).execute(&lab.db).await.expect("last message");
    }
    match case {
        Case::BeginFault => lab.sql_fault.fail_acquisition(2),
        Case::LookupFault => {
            sqlx::query(
                "ALTER TABLE email_messages RENAME COLUMN provider_id TO parity_hidden_provider_id",
            )
            .execute(&lab.db)
            .await
            .expect("fault");
        }
        Case::SenderFault | Case::RecipientFault => {
            sqlx::query("ALTER TABLE email_contacts RENAME TO parity_hidden_contacts")
                .execute(&lab.db)
                .await
                .expect("fault");
        }
        Case::NoSender => {
            sqlx::query("UPDATE email_messages SET from_contact_id=NULL WHERE id=$1")
                .bind(id)
                .execute(&lab.db)
                .await
                .expect("no sender");
        }
        Case::BlankAddress => {
            sqlx::query("UPDATE email_contacts SET email_address='' WHERE id=$1")
                .bind(Uuid::from_u128(0x79000000000000000000000000000001))
                .execute(&lab.db)
                .await
                .expect("blank address");
        }
        Case::MetadataFault => {
            sqlx::query("ALTER TABLE email_mailbox_drafts RENAME TO parity_hidden_drafts")
                .execute(&lab.db)
                .await
                .expect("metadata fault");
        }
        Case::CalendarFault => {
            sqlx::query("ALTER TABLE email_attachments RENAME TO parity_hidden_attachments")
                .execute(&lab.db)
                .await
                .expect("calendar flag fault");
        }
        Case::ThreadDeleteFault => trigger(&lab, "email_threads", "DELETE", false).await,
        Case::RollbackFault => {
            sqlx::query("CREATE FUNCTION parity_disconnect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_terminate_backend(pg_backend_pid()); RETURN OLD; END $$").execute(&lab.db).await.expect("disconnect function");
            sqlx::query("CREATE TRIGGER parity_disconnect BEFORE DELETE ON email_messages FOR EACH STATEMENT EXECUTE FUNCTION parity_disconnect()").execute(&lab.db).await.expect("disconnect trigger");
        }
        Case::DeleteFault => trigger(&lab, "email_messages", "DELETE", false).await,
        Case::CleanupFault => trigger(&lab, "crm_cleanup_candidates", "INSERT", false).await,
        Case::CommitFault => trigger(&lab, "email_messages", "DELETE", true).await,
        Case::Deferred => {
            let attempt = Uuid::from_u128(0x79000000000000000000000000000002);
            lab.transcript.normalizer.symbol(attempt, "<send-attempt>");
            sqlx::query("INSERT INTO email_send_attempts(user_id,link_id,attempt_id,message_id) VALUES($1,$2,$3,$4)")
                .bind(&lab.fixture.users[0]).bind(lab.fixture.links[0]).bind(attempt).bind(id).execute(&lab.db).await.expect("active send");
        }
        _ => {}
    }
    let message = delivery(
        &lab,
        Op::Delete,
        if matches!(case, Case::Missing) {
            "missing"
        } else {
            "m1a"
        },
    );
    lab.worker_step("delete delivery", queue(retry), &message)
        .await
        .result
        .expect("delete handled");
    if matches!(
        case,
        Case::Received | Case::Sent | Case::Draft | Case::Missing | Case::LastMessage
    ) {
        duplicate(&mut lab, retry, &message).await;
    }
    if matches!(case, Case::Deferred) {
        duplicate(&mut lab, retry, &message).await;
        sqlx::query("UPDATE email_send_attempts SET cancelled=true WHERE message_id=$1")
            .bind(id)
            .execute(&lab.db)
            .await
            .expect("finish active send");
        duplicate(&mut lab, retry, &message).await;
    }
    lab.transcript.finish();
}

cases! { deletion;
    deletion_received_primary, 74000, false, Case::Received;
    deletion_received_retry, 74003, true, Case::Received;
    deletion_sent_primary, 74006, false, Case::Sent;
    deletion_sent_retry, 74009, true, Case::Sent;
    deletion_draft_primary, 74012, false, Case::Draft;
    deletion_draft_retry, 74015, true, Case::Draft;
    deletion_missing_primary, 74018, false, Case::Missing;
    deletion_missing_retry, 74021, true, Case::Missing;
    deletion_last_message_primary, 74024, false, Case::LastMessage;
    deletion_last_message_retry, 74027, true, Case::LastMessage;
    deletion_begin_fault_primary, 74030, false, Case::BeginFault;
    deletion_begin_fault_retry, 74033, true, Case::BeginFault;
    deletion_lookup_fault_primary, 74036, false, Case::LookupFault;
    deletion_lookup_fault_retry, 74039, true, Case::LookupFault;
    deletion_sender_fault_primary, 74042, false, Case::SenderFault;
    deletion_sender_fault_retry, 74045, true, Case::SenderFault;
    deletion_recipient_fault_primary, 74048, false, Case::RecipientFault;
    deletion_recipient_fault_retry, 74051, true, Case::RecipientFault;
    deletion_delete_fault_primary, 74054, false, Case::DeleteFault;
    deletion_delete_fault_retry, 74057, true, Case::DeleteFault;
    deletion_cleanup_fault_primary, 74060, false, Case::CleanupFault;
    deletion_cleanup_fault_retry, 74063, true, Case::CleanupFault;
    deletion_commit_fault_primary, 74066, false, Case::CommitFault;
    deletion_commit_fault_retry, 74069, true, Case::CommitFault;
    deletion_deferred_primary, 74072, false, Case::Deferred;
    deletion_deferred_retry, 74075, true, Case::Deferred;
}

cases! { deletion;
 deletion_no_sender_primary, 83000, false, Case::NoSender;
 deletion_no_sender_retry, 83003, true, Case::NoSender;
 deletion_blank_address_primary, 83006, false, Case::BlankAddress;
 deletion_blank_address_retry, 83009, true, Case::BlankAddress;
 deletion_sent_draft_primary, 83012, false, Case::SentDraft;
 deletion_sent_draft_retry, 83015, true, Case::SentDraft;
 deletion_metadata_fault_primary, 83018, false, Case::MetadataFault;
 deletion_metadata_fault_retry, 83021, true, Case::MetadataFault;
 deletion_calendar_fault_primary, 83024, false, Case::CalendarFault;
 deletion_calendar_fault_retry, 83027, true, Case::CalendarFault;
 deletion_thread_delete_fault_primary, 83030, false, Case::ThreadDeleteFault;
 deletion_thread_delete_fault_retry, 83033, true, Case::ThreadDeleteFault;
 deletion_rollback_fault_primary, 83036, false, Case::RollbackFault;
 deletion_rollback_fault_retry, 83039, true, Case::RollbackFault;
}
