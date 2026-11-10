use super::*;

#[derive(Clone, Copy)]
enum Case {
    Existing,
    NewMessage,
    NewThread,
    Draft,
    DraftToSent,
    Sent,
    Missing,
    LookupFault,
    ThreadLookupFault,
    MessageInsertFault,
    ThreadInsertFault,
    IdLookupFault,
    ContactsFault,
    CrmFault,
    GenericSender,
    NoSender,
    NoRecipients,
    NotificationDisabled,
    SentAndDraft,
    CleanContent,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Upsert characterization uses isolated fixture rows and SQL faults"
)]
async fn upsert(pool: PgPool, name: &'static str, shard: u32, retry: bool, case: Case) {
    let mut lab = start(pool, name, shard).await;
    let existing = matches!(
        case,
        Case::Existing
            | Case::DraftToSent
            | Case::LookupFault
            | Case::ThreadLookupFault
            | Case::MessageInsertFault
            | Case::IdLookupFault
            | Case::ContactsFault
            | Case::CrmFault
    );
    let id = if existing { "m1a" } else { "fresh" };
    let thread = if matches!(case, Case::NewThread | Case::ThreadInsertFault) {
        "fresh-thread"
    } else {
        "t1"
    };
    let labels = match case {
        Case::Draft | Case::SentAndDraft => vec!["INBOX", "DRAFT"],
        Case::DraftToSent | Case::Sent | Case::NoRecipients => vec!["SENT"],
        _ => vec!["INBOX", "UNREAD"],
    };
    provider_message(&lab, id, thread, &labels);
    let mut body = full_message(id, thread, &labels);
    if matches!(case, Case::Sent) {
        for (index, address) in [
            "recipient+one@example.net",
            "recipient+two@example.net",
            "noreply@example.net",
            "recipient@example.net",
            "recipient+three@example.net",
        ]
        .into_iter()
        .enumerate()
        {
            let contact = Uuid::from_u128(0x7c000000000000000000000000000100 + index as u128);
            lab.transcript
                .normalizer
                .symbol(contact, format!("<sent-contact:{index}>"));
            sqlx::query("INSERT INTO email_contacts(id,link_id,email_address) VALUES($1,$2,$3)")
                .bind(contact)
                .bind(lab.fixture.links[0])
                .bind(address)
                .execute(&lab.db)
                .await
                .expect("sent recipient identity");
        }
        body["payload"]["headers"][1]["value"] = json!(
            "Recipient <recipient+one@example.net>, Recipient <recipient+two@example.net>, noreply@example.net"
        );
        body["payload"]["headers"]
            .as_array_mut()
            .expect("headers")
            .extend([
                json!({"name":"Cc","value":"recipient@example.net"}),
                json!({"name":"Bcc","value":"recipient+three@example.net"}),
            ]);
    }
    if matches!(case, Case::SentAndDraft) {
        body["labelIds"] = json!(["SENT", "DRAFT"]);
    }
    if matches!(case, Case::GenericSender) {
        body["payload"]["headers"][0]["value"] = json!("Generic <noreply@example.com>");
    }
    if matches!(case, Case::NoSender) {
        body["payload"]["headers"]
            .as_array_mut()
            .expect("headers")
            .remove(0);
    }
    if matches!(case, Case::NoRecipients) {
        body["payload"]["headers"]
            .as_array_mut()
            .expect("headers")
            .remove(1);
    }
    if matches!(case, Case::CleanContent) {
        body["payload"]["headers"][2]["value"] = json!("Re:  Fixture &amp; subject");
        body["snippet"] = json!("body &lt;br&gt;");
    }
    persistent(&lab, &format!("messages/{id}"), 200, body.clone());
    persistent(
        &lab,
        &format!("threads/{thread}"),
        200,
        json!({"id":thread,"historyId":"200","messages":[body]}),
    );
    match case {
        Case::DraftToSent => {
            sqlx::query("UPDATE email_messages SET is_draft=true WHERE id=$1")
                .bind(lab.fixture.messages["m1a"])
                .execute(&lab.db)
                .await
                .expect("draft");
        }
        Case::Missing => persistent(&lab, &format!("messages/{id}"), 404, rejection(404)),
        Case::LookupFault => {
            sqlx::query(
                "ALTER TABLE email_messages RENAME COLUMN provider_id TO parity_hidden_provider_id",
            )
            .execute(&lab.db)
            .await
            .expect("fault");
        }
        Case::ThreadLookupFault => {
            sqlx::query(
                "ALTER TABLE email_threads RENAME COLUMN provider_id TO parity_hidden_provider_id",
            )
            .execute(&lab.db)
            .await
            .expect("fault");
        }
        Case::MessageInsertFault => trigger(&lab, "email_messages", "INSERT", false).await,
        Case::ThreadInsertFault => trigger(&lab, "email_threads", "INSERT", false).await,
        Case::IdLookupFault => lab.sql_fault.fail_acquisition(11),
        Case::ContactsFault => lab.sqs.fail_nth_send(1),
        Case::CrmFault => lab.sqs.fail_nth_send(2),
        _ => {}
    }
    let message = delivery(&lab, Op::Upsert, id);
    let outcome = lab
        .worker_step("upsert delivery", queue(retry), &message)
        .await;
    outcome.result.expect("upsert handled");
    if matches!(case, Case::GenericSender | Case::NoRecipients) {
        assert!(
            outcome
                .sent
                .iter()
                .all(|send| !send.queue_url.ends_with("/contacts")),
            "fixture must skip contact ingress"
        );
    }
    if matches!(case, Case::Draft | Case::Existing | Case::NewMessage) {
        let mut changed = full_message(id, thread, &labels);
        changed["payload"]["body"]["data"] = json!("dXBkYXRlZCBkcmFmdA");
        changed["payload"]["headers"][2]["value"] = json!("Changed provider subject");
        persistent(&lab, &format!("messages/{id}"), 200, changed);
    }
    if matches!(
        case,
        Case::Existing
            | Case::NewMessage
            | Case::NewThread
            | Case::Draft
            | Case::DraftToSent
            | Case::Sent
            | Case::GenericSender
            | Case::NoSender
            | Case::NoRecipients
            | Case::NotificationDisabled
            | Case::SentAndDraft
            | Case::CleanContent
    ) {
        duplicate(&mut lab, retry, &message).await;
    }
    lab.transcript.finish();
}

cases! { upsert;
    upsert_existing_primary, 73000, false, Case::Existing;
    upsert_existing_retry, 73003, true, Case::Existing;
    upsert_new_message_primary, 73006, false, Case::NewMessage;
    upsert_new_message_retry, 73009, true, Case::NewMessage;
    upsert_new_thread_primary, 73012, false, Case::NewThread;
    upsert_new_thread_retry, 73015, true, Case::NewThread;
    upsert_draft_primary, 73018, false, Case::Draft;
    upsert_draft_retry, 73021, true, Case::Draft;
    upsert_draft_to_sent_primary, 73024, false, Case::DraftToSent;
    upsert_draft_to_sent_retry, 73027, true, Case::DraftToSent;
    upsert_sent_primary, 73030, false, Case::Sent;
    upsert_sent_retry, 73033, true, Case::Sent;
    upsert_missing_primary, 73036, false, Case::Missing;
    upsert_missing_retry, 73039, true, Case::Missing;
    upsert_lookup_fault_primary, 73042, false, Case::LookupFault;
    upsert_lookup_fault_retry, 73045, true, Case::LookupFault;
    upsert_thread_lookup_fault_primary, 73048, false, Case::ThreadLookupFault;
    upsert_thread_lookup_fault_retry, 73051, true, Case::ThreadLookupFault;
    upsert_message_insert_fault_primary, 73054, false, Case::MessageInsertFault;
    upsert_message_insert_fault_retry, 73057, true, Case::MessageInsertFault;
    upsert_thread_insert_fault_primary, 73060, false, Case::ThreadInsertFault;
    upsert_thread_insert_fault_retry, 73063, true, Case::ThreadInsertFault;
    upsert_id_lookup_fault_primary, 73066, false, Case::IdLookupFault;
    upsert_id_lookup_fault_retry, 73069, true, Case::IdLookupFault;
    upsert_contacts_fault_primary, 73072, false, Case::ContactsFault;
    upsert_contacts_fault_retry, 73075, true, Case::ContactsFault;
    upsert_crm_fault_primary, 73078, false, Case::CrmFault;
    upsert_crm_fault_retry, 73081, true, Case::CrmFault;
    upsert_generic_sender_primary, 73084, false, Case::GenericSender;
    upsert_generic_sender_retry, 73087, true, Case::GenericSender;
    upsert_no_sender_primary, 73090, false, Case::NoSender;
    upsert_no_sender_retry, 73093, true, Case::NoSender;
    upsert_no_recipients_primary, 73096, false, Case::NoRecipients;
    upsert_no_recipients_retry, 73099, true, Case::NoRecipients;
    upsert_notification_disabled_primary, 73102, false, Case::NotificationDisabled;
    upsert_notification_disabled_retry, 73105, true, Case::NotificationDisabled;
    upsert_sent_and_draft_primary, 73108, false, Case::SentAndDraft;
    upsert_sent_and_draft_retry, 73111, true, Case::SentAndDraft;
    upsert_clean_content_primary, 73114, false, Case::CleanContent;
    upsert_clean_content_retry, 73117, true, Case::CleanContent;
}
