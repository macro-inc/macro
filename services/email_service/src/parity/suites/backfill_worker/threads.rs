use super::*;
use crate::pubsub::label_write_sim::fake_gmail::PauseAt;

#[derive(Clone, Copy)]
enum Case {
    Fresh,
    Attachments,
    AttachmentFailure,
    AttachmentSendFailure,
    Empty,
    Skip,
    Refresh,
    RefreshNone,
    Winner,
    Duplicate,
    Draft,
    BadMessage,
    BadContact,
    MetadataSend,
    CrmSend,
    ReadFault,
    RefreshReadFault,
    WriteFault(&'static str, bool, &'static str),
}

#[expect(
    clippy::disallowed_methods,
    reason = "Thread fixture and isolated statement/commit faults"
)]
async fn threads(pool: PgPool, name: &'static str, shard: u32, count: u32, case: Case) {
    let mut lab = start(pool, name, shard).await;
    let existing = matches!(
        case,
        Case::Skip | Case::Refresh | Case::RefreshNone | Case::RefreshReadFault
    );
    let thread = if existing { "t1" } else { "new-thread" };
    let mut messages = if matches!(case, Case::Empty) {
        vec![]
    } else {
        vec![full_message(
            if matches!(case, Case::RefreshNone) {
                "m1a"
            } else {
                "new-message"
            },
            thread,
            if matches!(case, Case::Draft) {
                &["DRAFT"]
            } else {
                &["INBOX", "UNREAD"]
            },
        )]
    };
    if matches!(
        case,
        Case::Refresh | Case::RefreshNone | Case::RefreshReadFault
    ) {
        messages.insert(0, full_message("m1a", "t1", &["INBOX"]));
    }
    if matches!(case, Case::Duplicate) {
        messages.push(messages[0].clone());
    }
    if matches!(case, Case::BadMessage) {
        messages.push(full_message("good-message", thread, &["INBOX"]));
        messages[0]["payload"]["headers"][2]["value"] = json!("x".repeat(10_000));
    }
    if matches!(case, Case::BadContact) {
        messages[0]["payload"]["headers"][0]["value"] =
            json!(format!("{} <sender@example.com>", "n".repeat(10000)));
    }
    if matches!(
        case,
        Case::Attachments | Case::AttachmentFailure | Case::AttachmentSendFailure
    ) {
        let full = &mut messages[0];
        let mut parts = vec![full["payload"].clone()];
        for (n, mime, file) in [
            (1, "application/pdf", "a.pdf"),
            (2, "image/png", "b.png"),
            (3, "video/mp4", "c.mp4"),
        ] {
            parts.push(json!({"partId":n.to_string(),"mimeType":mime,"filename":file,"body":{"attachmentId":format!("part-{n}"),"size":4}}));
            persistent(
                &lab,
                &format!("messages/new-message/attachments/part-{n}"),
                200,
                json!({"size":4,"data":"dGVzdA"}),
            );
        }
        full["payload"] = json!({"mimeType":"multipart/mixed","filename":"","partId":"","headers":full["payload"]["headers"],"parts":parts});
        lab.stub
            .reply("POST", "/internal/documents", 503, rejection(503));
        if matches!(case, Case::AttachmentSendFailure) {
            lab.sqs.fail_nth_send(2);
        }
    }
    if matches!(case, Case::AttachmentFailure) {
        sqlx::query("ALTER TABLE email_attachments RENAME TO parity_hidden_attachments")
            .execute(&lab.db)
            .await
            .unwrap();
        messages = vec![full_message("new-message", thread, &["INBOX"])];
    }
    persistent(
        &lab,
        &format!("threads/{thread}"),
        200,
        json!({"id":thread,"messages":messages}),
    );
    match case {
        Case::CrmSend => lab.sqs.fail_nth_send(1),
        Case::MetadataSend => lab.sqs.fail_nth_send(2),
        Case::ReadFault => lab.sql_fault.fail_acquisition(3),
        Case::RefreshReadFault => lab.sql_fault.fail_acquisition(5),
        Case::WriteFault(table, commit, code) => trigger(&lab, table, "INSERT", commit, code).await,
        _ => {}
    }
    let message = delivery(
        &lab,
        "backfill_thread",
        thread_payload(thread, existing && !matches!(case, Case::Skip)),
        count,
    );
    let first = if matches!(case, Case::Winner) {
        let pause = lab.gmail.pause_next_http(
            &format!("/gmail/v1/users/me/threads/{thread}"),
            PauseAt::BeforeApply,
        );
        let pool = lab.db.clone();
        let link = lab.fixture.links[0];
        let thread = thread.to_string();
        let change = async move {
            pause.arrived.await.unwrap();
            sqlx::query("INSERT INTO email_threads(id,link_id,provider_id,inbox_visible,is_read) VALUES($1,$2,$3,false,false)").bind(MISSING).bind(link).bind(thread).execute(&pool).await.unwrap();
            pause.release.send(()).unwrap();
        };
        let (result, ()) =
            tokio::join!(step(&mut lab, "concurrent thread winner", &message), change);
        result
    } else {
        step(&mut lab, "backfill thread", &message).await
    };
    first.result.expect("thread policy");
    if matches!(case, Case::Attachments) {
        if let Some(next) = first.sent_deliveries.iter().find(|d| {
            d.body
                .as_deref()
                .unwrap_or("")
                .contains("backfill_attachment")
        }) {
            step(&mut lab, "attachment from recorded send", next)
                .await
                .result
                .expect("attachment policy");
        }
    }
    if matches!(
        case,
        Case::Fresh
            | Case::Refresh
            | Case::Draft
            | Case::BadMessage
            | Case::Attachments
            | Case::AttachmentSendFailure
    ) {
        if let Some(next) = first.sent_deliveries.iter().find(|d| {
            d.body
                .as_deref()
                .unwrap_or("")
                .contains("update_thread_metadata")
        }) {
            step(&mut lab, "metadata from recorded send", next)
                .await
                .result
                .expect("metadata");
        }
        lab.reset_admission().await;
        step(
            &mut lab,
            "redelivery after committed write",
            &message.redelivered(),
        )
        .await
        .result
        .expect("repeat");
    }
    lab.transcript.finish();
}

cases! {threads;
    thread_attachments,72400,1,Case::Attachments; thread_attachments_redelivery,75400,20,Case::Attachments;
    thread_attachment_lookup_failure,72403,1,Case::AttachmentFailure; thread_attachment_lookup_failure_redelivery,75403,20,Case::AttachmentFailure;
    thread_attachment_send_failure,72406,1,Case::AttachmentSendFailure; thread_attachment_send_failure_redelivery,75406,20,Case::AttachmentSendFailure;
    thread_new,71300,1,Case::Fresh; thread_new_redelivery,71303,20,Case::Fresh;
    thread_empty,71306,1,Case::Empty;
    thread_empty_redelivery,74306,20,Case::Empty; thread_existing,71309,1,Case::Skip;
    thread_existing_redelivery,74309,20,Case::Skip;
    thread_refresh_missing,71312,1,Case::Refresh; thread_refresh_missing_redelivery,71315,20,Case::Refresh;
    thread_refresh_no_missing,71318,1,Case::RefreshNone;
    thread_refresh_no_missing_redelivery,74318,20,Case::RefreshNone; thread_concurrent_winner,71321,1,Case::Winner;
    thread_concurrent_winner_redelivery,74321,20,Case::Winner;
    thread_duplicate_provider_id,71324,1,Case::Duplicate;
    thread_duplicate_provider_id_redelivery,74324,20,Case::Duplicate; thread_draft,71327,1,Case::Draft;
    thread_draft_redelivery,74327,20,Case::Draft;
    thread_unstorable_subject,71330,1,Case::BadMessage;
    thread_unstorable_subject_redelivery,74330,20,Case::BadMessage; thread_unstorable_contact,71333,1,Case::BadContact;
    thread_unstorable_contact_redelivery,74333,20,Case::BadContact;
    thread_metadata_send_failure,71336,1,Case::MetadataSend;
    thread_metadata_send_failure_redelivery,74336,20,Case::MetadataSend; thread_crm_send_failure,71339,1,Case::CrmSend;
    thread_crm_send_failure_redelivery,74339,20,Case::CrmSend;
    thread_lookup_failure,71342,1,Case::ReadFault;
    thread_lookup_failure_redelivery,74342,20,Case::ReadFault; thread_refresh_lookup_failure,71345,1,Case::RefreshReadFault;
    thread_refresh_lookup_failure_redelivery,74345,20,Case::RefreshReadFault;
    thread_insert_failure,71348,1,Case::WriteFault("email_threads",false,"P0001");
    thread_insert_failure_redelivery,74348,20,Case::WriteFault("email_threads",false,"P0001");
    thread_insert_commit_failure,71351,1,Case::WriteFault("email_threads",true,"P0001");
    thread_insert_commit_failure_redelivery,74351,20,Case::WriteFault("email_threads",true,"P0001");
    thread_message_failure,71354,1,Case::WriteFault("email_messages",false,"P0001");
    thread_message_failure_redelivery,74354,20,Case::WriteFault("email_messages",false,"P0001");
    thread_message_commit_failure,71357,1,Case::WriteFault("email_messages",true,"P0001");
    thread_message_commit_failure_redelivery,74357,20,Case::WriteFault("email_messages",true,"P0001");
    thread_message_check_skipped,71360,1,Case::WriteFault("email_messages",false,"23514");
    thread_message_check_skipped_redelivery,74360,20,Case::WriteFault("email_messages",false,"23514");
    thread_message_notnull_skipped,71363,1,Case::WriteFault("email_messages",false,"23502");
    thread_message_notnull_skipped_redelivery,74363,20,Case::WriteFault("email_messages",false,"23502");
    thread_message_data_skipped,71366,1,Case::WriteFault("email_messages",false,"22001");
    thread_message_data_skipped_redelivery,74366,20,Case::WriteFault("email_messages",false,"22001");
    thread_message_unique_retry,71369,1,Case::WriteFault("email_messages",false,"23505");
    thread_message_unique_retry_redelivery,74369,20,Case::WriteFault("email_messages",false,"23505");
    thread_message_fk_retry,71372,1,Case::WriteFault("email_messages",false,"23503");
    thread_message_fk_retry_redelivery,74372,20,Case::WriteFault("email_messages",false,"23503");
    thread_contacts_failure,71375,1,Case::WriteFault("email_contacts",false,"P0001");
    thread_contacts_failure_redelivery,74375,20,Case::WriteFault("email_contacts",false,"P0001");
    thread_contacts_skipped,71378,1,Case::WriteFault("email_contacts",false,"22001");
    thread_contacts_skipped_redelivery,74378,20,Case::WriteFault("email_contacts",false,"22001");
    thread_recipients_failure,71381,1,Case::WriteFault("email_message_recipients",false,"P0001");
    thread_recipients_failure_redelivery,74381,20,Case::WriteFault("email_message_recipients",false,"P0001");
    thread_labels_failure,71384,1,Case::WriteFault("email_message_labels",false,"P0001");
    thread_labels_failure_redelivery,74384,20,Case::WriteFault("email_message_labels",false,"P0001");
}
