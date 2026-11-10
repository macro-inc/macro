use super::*;

#[derive(Clone, Copy)]
enum Case {
    Disabled,
    Signal,
    Ordinary,
    Sent,
    Draft,
    StaffSignal,
    StaffInbox,
    StaffOutsideInbox,
    MissingSubject,
    NotificationSender,
    PublicationFailure,
    ContactFailure,
    CrmFailure,
    MultipleRecipients,
    QueryFault(usize),
    MixedDelegates,
    NoSender,
    SenderNoName,
    RemovedMessage,
    StaffTierFault,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Notification fixtures seed synthetic user and mailbox state"
)]
async fn staff_owner(lab: &mut Lab) {
    let id = Uuid::from_u128(0x7a000000000000000000000000000001);
    let owner = "macro|parity-staff@macro.com";
    lab.transcript.normalizer.symbol(id, "<staff-user>");
    lab.transcript.normalizer.symbol(owner, "<staff-owner>");
    sqlx::query("INSERT INTO macro_user(id,username,email,stripe_customer_id) VALUES($1,'parity-staff','parity-staff@macro.com','parity-staff')").bind(id).execute(&lab.db).await.expect("staff");
    sqlx::query(
        "INSERT INTO \"User\"(id,email,macro_user_id) VALUES($1,'parity-staff@macro.com',$2)",
    )
    .bind(owner)
    .bind(id)
    .execute(&lab.db)
    .await
    .expect("staff identity");
    sqlx::query("UPDATE email_links SET macro_id=$2 WHERE id=$1")
        .bind(lab.fixture.links[0])
        .bind(owner)
        .execute(&lab.db)
        .await
        .expect("staff link");
}

#[expect(
    clippy::disallowed_methods,
    reason = "Notifications are exercised with isolated mailbox fixtures"
)]
async fn notifications(pool: PgPool, name: &'static str, shard: u32, retry: bool, case: Case) {
    let mut lab = start(pool, name, shard).await;
    lab.inbox_notifications(!matches!(case, Case::Disabled));
    sqlx::query("DELETE FROM email_messages WHERE thread_id=(SELECT id FROM email_threads WHERE link_id=$1 AND provider_id='t1')")
        .bind(lab.fixture.links[0]).execute(&lab.db).await.expect("isolated notification thread");
    if matches!(
        case,
        Case::StaffSignal
            | Case::StaffInbox
            | Case::StaffOutsideInbox
            | Case::MixedDelegates
            | Case::QueryFault(13)
            | Case::StaffTierFault
    ) {
        staff_owner(&mut lab).await;
    }
    let labels = match case {
        Case::Sent => vec!["SENT"],
        Case::Draft => vec!["INBOX", "DRAFT"],
        Case::StaffOutsideInbox => vec![],
        Case::Ordinary | Case::StaffInbox | Case::QueryFault(13) | Case::StaffTierFault => {
            vec!["INBOX", "CATEGORY_PROMOTIONS"]
        }
        _ => vec!["INBOX", "UNREAD", "IMPORTANT"],
    };
    if labels.contains(&"CATEGORY_PROMOTIONS") {
        let category = Uuid::from_u128(0x7a000000000000000000000000000003);
        lab.transcript
            .normalizer
            .symbol(category, "<promotions-label>");
        sqlx::query("INSERT INTO email_labels (id,link_id,provider_label_id,name,message_list_visibility,label_list_visibility,type) VALUES($1,$2,'CATEGORY_PROMOTIONS','CATEGORY_PROMOTIONS','Show','LabelShow','System')")
            .bind(category).bind(lab.fixture.links[0]).execute(&lab.db).await.expect("promotions catalog");
    }
    if matches!(case, Case::MixedDelegates) {
        macro_db_client::macro_user_links::insert_edge(
            &lab.db,
            &lab.fixture.users[1],
            "macro|parity-staff@macro.com",
            lab.fixture.links[0],
        )
        .await
        .expect("delegate");
    }
    provider_message(&lab, "notifiable", "t1", &labels);
    let mut full = full_message("notifiable", "t1", &labels);
    full["payload"]["headers"][0]["value"] = json!("Sender <sender@outside.test>");
    if matches!(case, Case::NoSender) {
        full["payload"]["headers"]
            .as_array_mut()
            .expect("headers")
            .remove(0);
    }
    if matches!(case, Case::SenderNoName) {
        full["payload"]["headers"][0]["value"] = json!("sender@outside.test");
    }
    if matches!(case, Case::MissingSubject) {
        full["payload"]["headers"]
            .as_array_mut()
            .expect("headers")
            .retain(|h| h["name"] != "Subject");
        full.as_object_mut().expect("message").remove("snippet");
    }
    if matches!(case, Case::NotificationSender) {
        let sender = format!(
            "no-reply-parity@{}",
            email_utils::MACRO_NOTIFICATION_SENDER_DOMAIN
        );
        lab.transcript
            .normalizer
            .symbol(&sender, "<notification-sender>");
        full["payload"]["headers"][0]["value"] = json!(format!("Macro <{sender}>"));
    }
    if matches!(case, Case::MultipleRecipients) {
        for (index, address) in [
            "recipient@example.com",
            "other@example.com",
            "third@example.com",
        ]
        .into_iter()
        .enumerate()
        {
            let id = Uuid::from_u128(0x7a000000000000000000000000000100 + index as u128);
            lab.transcript
                .normalizer
                .symbol(id, format!("<recipient-contact:{index}>"));
            sqlx::query("INSERT INTO email_contacts(id,link_id,email_address) VALUES($1,$2,$3)")
                .bind(id)
                .bind(lab.fixture.links[0])
                .bind(address)
                .execute(&lab.db)
                .await
                .expect("stable recipient identity");
        }
        full["payload"]["headers"][1]["value"] = json!(
            "Recipient <recipient@example.com>, recipient@example.com, Other <other@example.com>"
        );
        full["payload"]["headers"]
            .as_array_mut()
            .expect("headers")
            .push(json!({"name":"Cc","value":"other@example.com, third@example.com"}));
    }
    persistent(&lab, "messages/notifiable", 200, full);
    match case {
        Case::PublicationFailure => {
            lab.sqs.lock().fixed_date = Some("Mon, 21 Sep 2026 14:13:20 GMT".into());
            lab.sqs.fail_nth_send(3);
        }
        Case::ContactFailure => lab.sqs.fail_nth_send(1),
        Case::CrmFailure => lab.sqs.fail_nth_send(2),
        Case::StaffTierFault => lab.sql_fault.fail_acquisition(12),
        Case::QueryFault(n) => lab.sql_fault.fail_acquisition(n),
        _ => {}
    }
    let race = if matches!(case, Case::RemovedMessage) {
        let (arrived, release) = lab.sql_fault.pause_acquisition(9);
        let db = lab.db.clone();
        let link = lab.fixture.links[0];
        Some(tokio::spawn(async move {
            arrived.await.expect("notification lookup");
            sqlx::query("DELETE FROM email_messages WHERE link_id=$1 AND provider_id='notifiable'")
                .bind(link)
                .execute(&db)
                .await
                .expect("concurrent deletion");
            release.send(()).expect("release notification");
        }))
    } else {
        None
    };
    let message = delivery(&lab, Op::Upsert, "notifiable");
    let outcome = lab
        .worker_step("new mail notification path", queue(retry), &message)
        .await;
    outcome.result.expect("notification handled");
    let notification = outcome
        .sent
        .iter()
        .find(|sent| sent.queue_url.ends_with("/notifications"));
    match case {
        Case::Ordinary
        | Case::StaffOutsideInbox
        | Case::Disabled
        | Case::Sent
        | Case::Draft
        | Case::NotificationSender => assert!(notification.is_none(), "fixture must not notify"),
        Case::StaffInbox => {
            let body: Value =
                serde_json::from_str(&notification.expect("staff inbox notification").body)
                    .expect("notification JSON");
            assert_eq!(body["request"]["send_conn_gateway"], false);
            assert_eq!(body["request"]["build_apns"], Value::Null);
        }
        Case::QueryFault(13) | Case::StaffTierFault => {
            assert!(!outcome.deleted, "fault must reach notification SQL")
        }
        _ => {}
    }
    if let Some(task) = race {
        task.await.expect("notification race");
    }
    if !matches!(
        case,
        Case::QueryFault(_) | Case::RemovedMessage | Case::StaffTierFault
    ) {
        duplicate(&mut lab, retry, &message).await;
    }
    lab.transcript.finish();
}

cases! { notifications;
    notifications_disabled_primary, 76000, false, Case::Disabled;
    notifications_disabled_retry, 76003, true, Case::Disabled;
    notifications_signal_primary, 76006, false, Case::Signal;
    notifications_signal_retry, 76009, true, Case::Signal;
    notifications_ordinary_primary, 76012, false, Case::Ordinary;
    notifications_ordinary_retry, 76015, true, Case::Ordinary;
    notifications_sent_primary, 76018, false, Case::Sent;
    notifications_sent_retry, 76021, true, Case::Sent;
    notifications_draft_primary, 76024, false, Case::Draft;
    notifications_draft_retry, 76027, true, Case::Draft;
    notifications_staff_signal_primary, 76030, false, Case::StaffSignal;
    notifications_staff_signal_retry, 76033, true, Case::StaffSignal;
    notifications_staff_inbox_primary, 76036, false, Case::StaffInbox;
    notifications_staff_inbox_retry, 76039, true, Case::StaffInbox;
    notifications_staff_outside_inbox_primary, 76042, false, Case::StaffOutsideInbox;
    notifications_staff_outside_inbox_retry, 76045, true, Case::StaffOutsideInbox;
    notifications_missing_subject_primary, 76048, false, Case::MissingSubject;
    notifications_missing_subject_retry, 76051, true, Case::MissingSubject;
    notifications_notification_sender_primary, 76054, false, Case::NotificationSender;
    notifications_notification_sender_retry, 76057, true, Case::NotificationSender;
    notifications_publication_failure_primary, 76060, false, Case::PublicationFailure;
    notifications_publication_failure_retry, 76063, true, Case::PublicationFailure;
    notifications_contact_failure_primary, 76066, false, Case::ContactFailure;
    notifications_contact_failure_retry, 76069, true, Case::ContactFailure;
    notifications_crm_failure_primary, 76072, false, Case::CrmFailure;
    notifications_crm_failure_retry, 76075, true, Case::CrmFailure;
    notifications_multiple_recipients_primary, 76078, false, Case::MultipleRecipients;
    notifications_multiple_recipients_retry, 76081, true, Case::MultipleRecipients;
    notification_query_1_primary, 78006, false, Case::QueryFault(1);
    notification_query_1_retry, 78009, true, Case::QueryFault(1);
    notification_query_2_primary, 78012, false, Case::QueryFault(2);
    notification_query_2_retry, 78015, true, Case::QueryFault(2);
    notification_query_3_primary, 78018, false, Case::QueryFault(3);
    notification_query_3_retry, 78021, true, Case::QueryFault(3);
    notification_query_4_primary, 78024, false, Case::QueryFault(4);
    notification_query_4_retry, 78027, true, Case::QueryFault(4);
    notification_query_5_primary, 78030, false, Case::QueryFault(5);
    notification_query_5_retry, 78033, true, Case::QueryFault(5);
    notification_query_6_primary, 78036, false, Case::QueryFault(6);
    notification_query_6_retry, 78039, true, Case::QueryFault(6);
    notification_query_7_primary, 78042, false, Case::QueryFault(7);
    notification_query_7_retry, 78045, true, Case::QueryFault(7);
    notification_query_8_primary, 78048, false, Case::QueryFault(8);
    notification_query_8_retry, 78051, true, Case::QueryFault(8);
    notification_query_9_primary, 78054, false, Case::QueryFault(9);
    notification_query_9_retry, 78057, true, Case::QueryFault(9);
    notification_query_10_primary, 78060, false, Case::QueryFault(10);
    notification_query_10_retry, 78063, true, Case::QueryFault(10);
    notification_query_11_primary, 78066, false, Case::QueryFault(11);
    notification_query_11_retry, 78069, true, Case::QueryFault(11);
    notification_query_12_primary, 78072, false, Case::QueryFault(12);
    notification_query_12_retry, 78075, true, Case::QueryFault(12);
    notification_query_13_primary, 78078, false, Case::QueryFault(13);
    notification_query_13_retry, 78081, true, Case::QueryFault(13);
}

cases! { notifications; notifications_mixed_delegates_primary, 79120, false, Case::MixedDelegates; notifications_mixed_delegates_retry, 79123, true, Case::MixedDelegates; }

cases! { notifications; notifications_no_sender_primary, 86010, false, Case::NoSender; notifications_no_sender_retry, 86013, true, Case::NoSender; notifications_sender_no_name_primary, 86016, false, Case::SenderNoName; notifications_sender_no_name_retry, 86019, true, Case::SenderNoName; notifications_removed_message_primary, 86022, false, Case::RemovedMessage; notifications_removed_message_retry, 86025, true, Case::RemovedMessage; }

cases! { notifications; notifications_staff_tier_fault_primary, 86030, false, Case::StaffTierFault; notifications_staff_tier_fault_retry, 86033, true, Case::StaffTierFault; }
