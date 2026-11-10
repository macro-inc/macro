use super::*;

#[derive(Clone, Copy)]
enum Case {
    Malformed,
    MissingBody,
    Shape,
    Unknown,
    MissingLink,
    LinkFault,
    DeleteFault,
    DecodeDeleteFault,
    MissingReceipt,
    Inactive(Op),
    Reauth(Op),
    WireMatrix,
    LinkMatrix,
    Outlook,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Isolated worker envelope fixtures use runtime SQL"
)]
async fn envelope(pool: PgPool, name: &'static str, shard: u32, retry: bool, case: Case) {
    let mut lab = start(pool, name, shard).await;
    let mut message = delivery(&lab, Op::Labels, "m1a");
    if matches!(case, Case::WireMatrix) {
        let link = lab.fixture.links[0];
        let mut bodies = vec![
            "".to_owned(),
            "null".to_owned(),
            "{}".to_owned(),
            json!({"linkId":"bad", "operation":{"delete_message":{"provider_message_id":"m1a"}}})
                .to_string(),
            json!({"linkId":link, "operation":{"DeleteMessage":{"provider_message_id":"m1a"}}})
                .to_string(),
            json!({"linkId":link, "operation":{"upsert_message":{}}}).to_string(),
            json!({"linkId":link, "operation":{"update_labels":{"provider_message_id":42}}})
                .to_string(),
        ];
        for value in [
            json!(-1),
            json!("200"),
            json!(null),
            json!(18446744073709551616_f64),
        ] {
            bodies.push(
                json!({"linkId":link,"operation":{"gmail_message":{"history_id":value}}})
                    .to_string(),
            );
        }
        for (index, body) in bodies.into_iter().enumerate() {
            let result = lab
                .worker_step(
                    &format!("invalid wire {index}"),
                    queue(retry),
                    &Delivery::new(body),
                )
                .await;
            assert!(result.deleted && result.result.is_err());
        }
        let mut accepted: Value =
            serde_json::from_str(message.body.as_ref().expect("body")).expect("json");
        accepted["extra"] = json!(true);
        lab.worker_step(
            "unknown fields accepted",
            queue(retry),
            &Delivery::new(accepted.to_string()),
        )
        .await
        .result
        .expect("extra field");
        lab.transcript.finish();
        return;
    }
    if matches!(case, Case::Outlook) {
        sqlx::query("UPDATE email_links SET provider='OUTLOOK' WHERE id=$1")
            .bind(lab.fixture.links[0])
            .execute(&lab.db)
            .await
            .expect("outlook link");
        for (index, op) in [Op::History, Op::Upsert, Op::Labels, Op::Delete]
            .into_iter()
            .enumerate()
        {
            lab.worker_step(
                &format!("outlook operation {index}"),
                queue(retry),
                &delivery(&lab, op, "m1a"),
            )
            .await
            .result
            .expect("handled");
        }
        lab.transcript.finish();
        return;
    }
    if matches!(case, Case::LinkMatrix) {
        for (index, op) in [Op::History, Op::Upsert, Op::Delete, Op::Labels]
            .into_iter()
            .enumerate()
        {
            let mut value: Value =
                serde_json::from_str(delivery(&lab, op, "m1a").body.as_ref().expect("body"))
                    .expect("json");
            value["linkId"] = json!(lab.fixture.links[2]);
            lab.worker_step(
                &format!("cross-link identity {index}"),
                queue(retry),
                &Delivery::new(value.to_string()),
            )
            .await
            .result
            .expect("cross link");
            value["linkId"] = json!(Uuid::nil());
            lab.worker_step(
                &format!("missing link {index}"),
                queue(retry),
                &Delivery::new(value.to_string()),
            )
            .await
            .result
            .expect("missing link");
        }
        lab.transcript.finish();
        return;
    }
    match case {
        Case::Malformed | Case::DecodeDeleteFault => message.body = Some("not-json".into()),
        Case::MissingBody => message.body = None,
        Case::Shape => message.body = Some("[]".into()),
        Case::Unknown => {
            message.body =
                Some(json!({"linkId":lab.fixture.links[0],"operation":{"unknown":{}}}).to_string())
        }
        Case::MissingLink => {
            let mut body: Value =
                serde_json::from_str(message.body.as_ref().expect("body")).expect("JSON");
            let missing = Uuid::from_u128(0x77000000000000000000000000000001);
            lab.transcript.normalizer.symbol(missing, "<missing-link>");
            body["linkId"] = json!(missing);
            message.body = Some(body.to_string());
        }
        Case::LinkFault => {
            sqlx::query("ALTER TABLE email_links RENAME TO parity_hidden_links")
                .execute(&lab.db)
                .await
                .expect("fault");
        }
        Case::DeleteFault | Case::MissingReceipt => {
            message = delivery(&lab, Op::Labels, "m1a");
            persistent(
                &lab,
                "messages/m1a",
                200,
                json!({"id":"m1a","threadId":"t1","labelIds":["INBOX","UNREAD"]}),
            );
        }
        Case::WireMatrix | Case::LinkMatrix | Case::Outlook => unreachable!("handled above"),
        Case::Inactive(op) | Case::Reauth(op) => {
            message = delivery(&lab, op, "m1a");
            sqlx::query("UPDATE email_links SET is_sync_active=$2,needs_reauth=$3 WHERE id=$1")
                .bind(lab.fixture.links[0])
                .bind(!matches!(case, Case::Inactive(_)))
                .bind(matches!(case, Case::Reauth(_)))
                .execute(&lab.db)
                .await
                .expect("link state");
        }
    }
    if matches!(case, Case::DeleteFault | Case::DecodeDeleteFault) {
        lab.sqs.lock().fail_delete = true;
    }
    if matches!(case, Case::MissingReceipt) {
        message.receipt_handle = None;
    }
    let first = lab.worker_step("delivery", queue(retry), &message).await;
    if !first.deleted && first.result.is_ok() {
        let mut again = message.redelivered();
        again.receive_count = if retry { 100 } else { 3 };
        lab.worker_step("last receive before redrive", queue(retry), &again)
            .await;
    }
    lab.transcript.finish();
}

cases! { envelope;
    malformed_primary, 70000, false, Case::Malformed;
    malformed_retry, 70003, true, Case::Malformed;
    missing_body_primary, 70006, false, Case::MissingBody;
    missing_body_retry, 70009, true, Case::MissingBody;
    shape_primary, 70012, false, Case::Shape;
    shape_retry, 70015, true, Case::Shape;
    unknown_primary, 70018, false, Case::Unknown;
    unknown_retry, 70021, true, Case::Unknown;
    missing_link_primary, 70024, false, Case::MissingLink;
    missing_link_retry, 70027, true, Case::MissingLink;
    link_fault_primary, 70030, false, Case::LinkFault;
    link_fault_retry, 70033, true, Case::LinkFault;
    delete_fault_primary, 70036, false, Case::DeleteFault;
    delete_fault_retry, 70039, true, Case::DeleteFault;
    decode_delete_fault_primary, 70042, false, Case::DecodeDeleteFault;
    decode_delete_fault_retry, 70045, true, Case::DecodeDeleteFault;
    missing_receipt_primary, 70048, false, Case::MissingReceipt;
    missing_receipt_retry, 70051, true, Case::MissingReceipt;
    inactive_history_primary, 70054, false, Case::Inactive(Op::History);
    inactive_history_retry, 70057, true, Case::Inactive(Op::History);
    inactive_upsert_primary, 70060, false, Case::Inactive(Op::Upsert);
    inactive_upsert_retry, 70063, true, Case::Inactive(Op::Upsert);
    inactive_labels_primary, 70066, false, Case::Inactive(Op::Labels);
    inactive_labels_retry, 70069, true, Case::Inactive(Op::Labels);
    inactive_delete_primary, 70072, false, Case::Inactive(Op::Delete);
    inactive_delete_retry, 70075, true, Case::Inactive(Op::Delete);
    reauth_history_primary, 70078, false, Case::Reauth(Op::History);
    reauth_history_retry, 70081, true, Case::Reauth(Op::History);
    reauth_upsert_primary, 70084, false, Case::Reauth(Op::Upsert);
    reauth_upsert_retry, 70087, true, Case::Reauth(Op::Upsert);
    reauth_labels_primary, 70090, false, Case::Reauth(Op::Labels);
    reauth_labels_retry, 70093, true, Case::Reauth(Op::Labels);
    reauth_delete_primary, 70096, false, Case::Reauth(Op::Delete);
    reauth_delete_retry, 70099, true, Case::Reauth(Op::Delete);
}

cases! { envelope; wire_matrix_primary, 79100, false, Case::WireMatrix; wire_matrix_retry, 79103, true, Case::WireMatrix; link_matrix_primary, 79106, false, Case::LinkMatrix; link_matrix_retry, 79109, true, Case::LinkMatrix; }

cases! { envelope; outlook_primary, 86000, false, Case::Outlook; outlook_retry, 86003, true, Case::Outlook; }
